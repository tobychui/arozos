/*
    ArozOS Office Suite - share link unit tests (common/share.js)
    Run with: node test_share.js   (exits 1 on failure)

    parse() is the security boundary of ?request=: whatever it returns is
    fetched, so most of these pin what it refuses.
*/
global.OfficeContainer = require("./container.js");
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
    ["download link", "http://localhost:8080/share/download/" + ID + "/HelloWorld.doca", PREVIEW],
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
    S.parse("http://localhost:8080/share/download/" + ID + "/My%20Doc.doca").nameHint, "My Doc.doca");
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
eq("name kept", S.fileName("document", ["Report.doca"]), "Report.doca");
eq("first usable wins", S.fileName("document", [null, "", "B.doca"]), "B.doca");
eq("wrong ext replaced", S.fileName("spreadsheet", ["Budget.doca"]), "Budget.xlsa");
eq("no ext added", S.fileName("presentation", ["Pitch"]), "Pitch.ppta");
eq("ext case-insensitive", S.fileName("document", ["A.DOCA"]), "A.DOCA");
eq("default name", S.fileName("spreadsheet", []), "Shared spreadsheet.xlsa");
eq("path stripped", S.fileName("document", ["../../etc/x.doca"]), "x.doca");
eq("backslash path stripped", S.fileName("document", ["C:\\a\\y.doca"]), "y.doca");
eq("control chars stripped", S.fileName("document", ["a\u0000b\n.doca"]), "ab.doca");
eq("bare extension gets default", S.fileName("document", [".doca"]), "Shared document.doca");

/* ---- Content-Disposition ---- */
eq("disposition quoted", S.dispositionName('inline; filename="HelloWorld.doca"'), "HelloWorld.doca");
eq("disposition bare", S.dispositionName("inline; filename=Plain.xlsa"), "Plain.xlsa");
eq("disposition escaped quote", S.dispositionName('inline; filename="say \\"hi\\".ppta"'), 'say "hi".ppta');
eq("disposition rfc2231 wins", S.dispositionName(
    "inline; filename*=utf-8''%E5%A0%B1%E5%91%8A.doca; filename=\"fallback.doca\""), "\u5831\u544a.doca");
eq("disposition absent", S.dispositionName(null), "");
eq("disposition without name", S.dispositionName("inline"), "");

/* ---- appOf ---- */
function containerFor(app) {
    return OfficeContainer.pack(JSON.stringify({
        type: "arozos-office", app: app, version: 1, body: {}
    }));
}
eq("appOf document", S.appOf(containerFor("document")), "document");
eq("appOf spreadsheet", S.appOf(containerFor("spreadsheet")), "spreadsheet");
eq("appOf presentation", S.appOf(containerFor("presentation")), "presentation");
eq("appOf unknown app", S.appOf(containerFor("paint")), null);
eq("appOf plain JSON document",
    S.appOf(OfficeContainer.utf8Encode('{"app":"spreadsheet","body":{}}')), "spreadsheet");
eq("appOf html page", S.appOf(OfficeContainer.utf8Encode("<!DOCTYPE html><html>")), null);
eq("appOf garbage zip", S.appOf(new Uint8Array([0x50, 0x4B, 1, 2, 3])), null);
eq("appOf empty", S.appOf(new Uint8Array(0)), null);

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
