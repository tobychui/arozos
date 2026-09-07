/*
    ArozOS Office Suite - native container unit tests (common/container.js)
    Run with: node test_container.js   (exits 1 on failure)

    container.js is the browser-side twin of mod/office/packed.go, so the
    tests that matter are the ones pinning the two together:

      - GO_PACKED below is a real .ppta written by office.PackEnvelope. Its
        document.json is deflated (dynamic Huffman) and its asset is STORED,
        so unpacking it exercises the whole inflate and central-directory
        path against genuine Go output rather than a stream this file
        produced itself.
      - Everything this file writes is read back by the same library; the Go
        reader is covered by mod/office's own tests.

    Regenerating GO_PACKED: pack any envelope with office.PackEnvelope and
    paste its base64 here. The assertions read their expected values out of
    the fixture where they can, so only the ones naming specific content
    (revision, title, the repeated-paragraph probe) would need revisiting.
*/
var C = require("./container.js");

var failures = 0, passes = 0;
function eq(name, got, want) {
    var ok = (got === want);
    if (!ok && got !== null && want !== null &&
        typeof got === "object" && typeof want === "object") {
        ok = JSON.stringify(got) === JSON.stringify(want);
    }
    if (ok) { passes++; }
    else {
        failures++;
        console.log("FAIL " + name + ": got " + JSON.stringify(got) +
            ", want " + JSON.stringify(want));
    }
}
function ok(name, cond) { eq(name, !!cond, true); }
function throws(name, fn) {
    try { fn(); } catch (e) { passes++; return; }
    failures++;
    console.log("FAIL " + name + ": expected a throw, got none");
}
function bytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
    return out;
}
function fromBase64(b64) { return new Uint8Array(Buffer.from(b64, "base64")); }

/* A real container written by office.PackEnvelope (Go). Its envelope is a
   presentation whose body carries 120 repetitive paragraphs (so Go picked a
   dynamic Huffman block) and the same 4x4 PNG referenced twice (so Go
   deduplicated it into a single asset). */
var GO_PACKED =
    "UEsDBBQACAAIAAAAAAAAAAAAAAAAAAAAAAANAAAAZG9jdW1lbnQuanNvbrzaPW4jNxjG8asM3rSERQ7nk52btAaS0nEx" +
    "GnGkCaSZAYd2bAmqc4PcwUX69L5KkHME+lhvsV5gt/gvCwn64POKFH7dc5BmmsTJFPzsh9jEfhxEyXJcvYg7yDBGP4uT" +
    "3x61tu10fvK/+Mk30a+Srt9ufUimJjTr0EybZHjcLX1IdNKNIYkbn6x8t22iT+YYfLO7ucQsrjnfF2qI0JQItURoRoTm" +
    "RGhBhJZEaEWE1kSoYUghpgyCyiCqDMLKIK4MAssgsgxCyyC2UsRWithKEVspYitFbKWIrRSxlSK2UsRWitiyiC2L2LKI" +
    "LYvYsogti9iyiC2L2LKILYvYyhBbGWIrQ2xliK0MsZUhtjLEVobYyhBbGWIrR2zliK0csZUjtnLEVo7YyhFbOWIrR2zl" +
    "iK0CsVUgtgrEVoHYKhBbBWKrQGwViK0CsVUgtkrEVonYKhFbJWKrRGyViK0SsVUitkrEVonYqhBbFWKrQmxViK0KsVUh" +
    "tirEVoXYqhBbFWKrRmzViK0asVUjtmrEVo3YqhFbNWKrRmzViC2jEVxGI7qMRngZjfgyGgFmNCLMaISY0YgxoxFkRjPK" +
    "qIoGowwqaUAtDaimAfU0oKIG1NSAqhrf2tUQJXO/9+Lu60KrPNMPSuZtv/KzuPuDLNfi5KfuvERJvxInsxH13kwcTi/G" +
    "5e++jZcdG3FGayVTGKdZ3EHm0IqTZp59dItF6421bZqXnS1vpmEtRyVhjOK0kvgyeXHS75r16Xf9cU16Pn/4cn7cizNH" +
    "9QOmpB9O2cTd9r2OubzcYNt0b6/XS72+lfz7z9///fXnB1Ojf45fH2qPD8cHJXHjd6cvb/v1Jp5Cdj42p/FtOP/rt1Gc" +
    "KfNCf1pK1n7woYljECe3Ydzf/ZrcdV3f+oW50aJkN676rv9yq1ES/FM/9+MgrlQS+7g9jf65f46PwSdvr5+Pcj1CE8b9" +
    "OC/Gc7woefLhst0c/w8AAP//UEsHCN0IpL/eAgAAzioAAFBLAwQUAAgAAAAAAAAAAAAAAAAAAAAAAAAAFwAAAGFzc2V0" +
    "cy9jZTEzM2MyNTdmMzcucG5niVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8z8Dwn4GK" +
    "gImaho0aOHwMBADvxwPtjB1flQAAAABJRU5ErkJgglBLBwikyBwcUgAAAFIAAABQSwECFAAUAAgACAAAAAAA3Qikv94C" +
    "AADOKgAADQAAAAAAAAAAAAAAAAAAAAAAZG9jdW1lbnQuanNvblBLAQIUABQACAAAAAAAAACkyBwcUgAAAFIAAAAXAAAA" +
    "AAAAAAAAAAAAABkDAABhc3NldHMvY2UxMzNjMjU3ZjM3LnBuZ1BLBQYAAAAAAgACAIAAAACwAwAAAAA=";

/* ---------- CRC32 ---------- */
eq("crc32 of nothing", C.crc32(new Uint8Array(0)), 0);
eq("crc32 of 'a'", C.crc32(bytes("a")), 0xE8B7BE43);
eq("crc32 of '123456789'", C.crc32(bytes("123456789")), 0xCBF43926);

/* ---------- reading what Go wrote ---------- */
var goBytes = fromBase64(GO_PACKED);
var goFiles = C.readZip(goBytes);
var goNames = Object.keys(goFiles).sort();
eq("go container entry count", goNames.length, 2);
ok("go container has an asset", /^assets\//.test(goNames[0]));
eq("go container has document.json", goNames[1], "document.json");
// the fixture's document.json is ~11 KB raw but under 1 KB on disk: getting
// this far at all means the deflate decoder ran and produced the right size
ok("inflate expanded the deflated document.json", goFiles["document.json"].length > 5000);

var env = JSON.parse(C.unpack(goBytes));
eq("envelope type", env.type, "arozos/office");
eq("envelope app", env.app, "presentation");
eq("envelope revision", env.meta.revision, 7);
eq("non-ASCII metadata survives inflate", env.meta.title, "Fixture é中文");
eq("non-ASCII body text survives inflate",
    env.body.slides[0].objects[2].props.html, "<b>café</b> 中文");
ok("the long deflated body is intact end to end",
    env.body.notes.indexOf("Repeated filler paragraph number 119") > 0);

var img0 = env.body.slides[0].objects[0].props.src;
var img1 = env.body.slides[0].objects[1].props.src;
ok("asset:// became a data URL", img0.indexOf("data:image/png;base64,") === 0);
eq("both references resolve to the same asset", img0, img1);

/* ---------- writing a container back ---------- */
var repacked = C.pack(JSON.stringify(env));
eq("repacked container is a zip", String.fromCharCode(repacked[0], repacked[1]), "PK");
var back = JSON.parse(C.unpack(repacked));
eq("round trip preserves the envelope", JSON.stringify(back), JSON.stringify(env));

var repackedFiles = C.readZip(repacked);
eq("repack deduplicates identical media", Object.keys(repackedFiles).length, 2);
ok("media moved out of document.json",
    repackedFiles["document.json"].length < JSON.stringify(env).length);

/* ---------- data URL handling (mirrors packed.go's rules) ---------- */
var inlineImg = '<img src="data:image/png;base64,iVBORw0KGgo=">';
var withMedia = JSON.stringify({
    type: "arozos/office", app: "document", version: 1, meta: {},
    body: {
        a: "data:image/png;base64,iVBORw0KGgo=",
        b: "data:image/jpeg;base64,/9j/4AAQ",
        c: "not a data url",
        d: inlineImg
    }
});
var packedMedia = C.pack(withMedia);
var mediaNames = Object.keys(C.readZip(packedMedia)).sort();
eq("two distinct media become two assets", mediaNames.length, 3);
ok("png asset keeps its extension", mediaNames.some(function (n) { return /\.png$/.test(n); }));
ok("jpeg asset keeps its extension", mediaNames.some(function (n) { return /\.jpeg$/.test(n); }));
var mediaBack = JSON.parse(C.unpack(packedMedia));
eq("plain strings are untouched", mediaBack.body.c, "not a data url");
eq("standalone data URLs round trip", mediaBack.body.a, "data:image/png;base64,iVBORw0KGgo=");
// only whole-string data URLs are extracted, exactly as transformStrings in
// packed.go does it - one inside markup stays inline on both sides
eq("a data URL inside markup is left inline", mediaBack.body.d, inlineImg);

/* ---------- legacy and error paths ---------- */
var legacy = '{"type":"arozos/office","app":"document","version":1,"meta":{},"body":{"html":"hi"}}';
eq("plain-JSON documents pass through", C.unpack(C.utf8Encode(legacy)), legacy);

throws("a truncated container is rejected", function () {
    C.unpack(bytes("PK not really a zip"));
});
var noDoc = C.writeZip([{ name: "assets/x.png", data: bytes("xx") }]);
throws("a container with no document.json is rejected", function () { C.unpack(noDoc); });

/* ---------- zip writer basics ---------- */
var zip = C.writeZip([
    { name: "document.json", data: C.utf8Encode('{"k":"v"}') },
    { name: "assets/a.bin", data: bytes("binary\u0000data") }
]);
var read = C.readZip(zip);
eq("writeZip/readZip name round trip",
    Object.keys(read).sort().join(","), "assets/a.bin,document.json");
eq("writeZip/readZip content round trip", C.utf8Decode(read["document.json"]), '{"k":"v"}');
eq("binary payloads survive, NUL included", read["assets/a.bin"].length, 11);
eq("a NUL byte is preserved", read["assets/a.bin"][6], 0);

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
