/*
    ArozOS Office Suite - share link unit tests (common/share.js)
    Run with: node test_share.js   (exits 1 on failure)

    parse() is the security boundary of ?request=: whatever it returns is
    fetched, so most of these pin what it refuses.
*/
var S = require("./share.js");

var failures = 0, passes = 0;
function eq(name, got, want) {
    if (got === want) { passes++; return; }
    failures++;
    console.log("FAIL " + name + "\n  got:  " + JSON.stringify(got) + "\n  want: " + JSON.stringify(want));
}
function throws(name, fn) {
    try { fn(); } catch (e) { passes++; return; }
    failures++;
    console.log("FAIL " + name + ": expected an error");
}

var ID = "f7453c19-66c8-4e84-8288-76b84ec0da9f";
var PREVIEW = "http://localhost:8080/share/preview/" + ID + "/";

/* ---- parse: accepted link shapes ---- */
[
    ["share page, trailing slash", "http://localhost:8080/share/" + ID + "/", PREVIEW],
    ["share page, no slash", "http://localhost:8080/share/" + ID, PREVIEW],
    ["preview link", PREVIEW, PREVIEW],
    ["download link", "http://localhost:8080/share/download/" + ID + "/HelloWorld.docx", PREVIEW],
    ["legacy ?id=", "http://localhost:8080/share?id=" + ID, PREVIEW],
    ["surrounding space", "  http://localhost:8080/share/" + ID + "/  ", PREVIEW],
    ["query and hash ignored", "http://localhost:8080/share/" + ID + "/?x=1#top", PREVIEW],
    ["https + reverse-proxy prefix", "https://example.com/aroz/share/" + ID + "/",
        "https://example.com/aroz/share/preview/" + ID + "/"],
    ["prefix folder called share", "https://example.com/share/share/" + ID + "/",
        "https://example.com/share/share/preview/" + ID + "/"]
].forEach(function (c) {
    var info;
    try { info = S.parse(c[1]); } catch (e) { eq("parse " + c[0], "threw: " + e.message, c[2]); return; }
    eq("parse " + c[0], info.previewUrl, c[2]);
});
eq("download link name hint",
    S.parse("http://localhost:8080/share/download/" + ID + "/My%20Doc.docx").nameHint, "My Doc.docx");
eq("share page has no name hint", S.parse("http://localhost:8080/share/" + ID + "/").nameHint, "");

/* ---- parse: refused ---- */
[
    ["empty", ""],
    ["not a url", "share/" + ID],
    ["relative", "/share/" + ID + "/"],
    ["javascript scheme", "javascript:alert(1)//share/" + ID],
    ["file scheme", "file:///share/" + ID],
    ["data scheme", "data:text/plain,share/" + ID],
    ["credentials", "http://user:pw@localhost:8080/share/" + ID + "/"],
    ["not a share path", "http://localhost:8080/files/" + ID],
    ["bad id chars", "http://localhost:8080/share/..%2F..%2Fsystem/"],
    ["id too short", "http://localhost:8080/share/abc/"],
    ["folder listing", "http://localhost:8080/share/"],
    ["other share op", "http://localhost:8080/share/opg/123/" + ID]
].forEach(function (c) { throws("parse refuses " + c[0], function () { S.parse(c[1]); }); });

/* ---- file names ---- */
eq("name kept", S.fileName("document", ["Report.docx"]), "Report.docx");
eq("first usable wins", S.fileName("document", [null, "", "B.docx"]), "B.docx");
eq("wrong ext replaced", S.fileName("spreadsheet", ["Budget.docx"]), "Budget.xlsx");
eq("no ext added", S.fileName("presentation", ["Pitch"]), "Pitch.pptx");
eq("ext case-insensitive", S.fileName("document", ["A.DOCX"]), "A.DOCX");
eq("default name", S.fileName("spreadsheet", []), "Shared spreadsheet.xlsx");
eq("path stripped", S.fileName("document", ["../../etc/x.docx"]), "x.docx");
eq("backslash path stripped", S.fileName("document", ["C:\\a\\y.docx"]), "y.docx");
eq("control chars stripped", S.fileName("document", ["a\u0000b\n.docx"]), "ab.docx");
eq("bare extension gets default", S.fileName("document", [".docx"]), "Shared document.docx");

/* ---- Content-Disposition ---- */
eq("disposition quoted", S.dispositionName('inline; filename="HelloWorld.docx"'), "HelloWorld.docx");
eq("disposition bare", S.dispositionName("inline; filename=Plain.xlsx"), "Plain.xlsx");
eq("disposition escaped quote", S.dispositionName('inline; filename="say \\"hi\\".pptx"'), 'say "hi".pptx');
eq("disposition rfc2231 wins", S.dispositionName(
    "inline; filename*=utf-8''%E5%A0%B1%E5%91%8A.docx; filename=\"fallback.docx\""), "\u5831\u544a.docx");
eq("disposition absent", S.dispositionName(null), "");
eq("disposition without name", S.dispositionName("inline"), "");

/* ---- appOf ---- */
// a minimal stored zip holding empty files under the given names
function zipOf(names) {
    var local = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    names.forEach(function (name) {
        var nb = Array.from(Buffer.from(name, "utf8"));
        var head = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(0), u32(0), u32(0), u16(nb.length), u16(0), nb);
        central = central.concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
            u32(0), u32(0), u32(0), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nb);
        local = local.concat(head);
        offset += head.length;
    });
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(names.length), u16(names.length),
        u32(central.length), u32(offset), u16(0));
    return new Uint8Array(local.concat(central, end));
}
eq("appOf document", S.appOf(zipOf(["[Content_Types].xml", "word/document.xml", "arozos/document.json"])), "document");
eq("appOf spreadsheet", S.appOf(zipOf(["[Content_Types].xml", "xl/workbook.xml"])), "spreadsheet");
eq("appOf presentation", S.appOf(zipOf(["ppt/presentation.xml", "ppt/slides/slide1.xml"])), "presentation");
eq("appOf other zip", S.appOf(zipOf(["content.xml", "mimetype"])), null);
eq("appOf html page", S.appOf(Buffer.from("<!DOCTYPE html><html>")), null);
eq("appOf garbage zip", S.appOf(new Uint8Array([0x50, 0x4B, 1, 2, 3])), null);
eq("appOf empty", S.appOf(new Uint8Array(0)), null);

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
