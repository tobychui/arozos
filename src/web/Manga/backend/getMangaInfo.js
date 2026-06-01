/*
    Manga – getMangaInfo.js
    Returns pages and sibling chapter list for a given chapter folder.

    Required parameter: folder (URL-encoded vpath of the chapter directory)

    Structure detection:
      Metadata: chapter path = MangaName/GroupName/ChapterFolder
                → grandparent (MangaName) contains a *.json file
      Legacy:   chapter path = MangaName/ChapterFolder
                → parent (MangaName) has no *.json sibling

    For metadata, siblings are collected from ALL group dirs under MangaName,
    then natural-sorted so "10 第10回" follows "9 第09回" correctly.
*/

requirelib("filelib");
requirelib("imagelib");

var rawFolder    = decodeURIComponent(folder);
var targetFolder = rawFolder + "/";
var allParts     = rawFolder.split("/");

// segment names (allParts still intact)
var chapterName  = allParts[allParts.length - 1];            // e.g. "1 第01回"  or  "Ch01"
var parentParts  = allParts.slice(0, -1);
var parentPath   = parentParts.join("/");                    // MangaName/GroupName  or  MangaName
var grandParts   = allParts.slice(0, -2);
var grandPath    = grandParts.join("/");                     // MangaName  or  Photo/Manga

// ── Detect metadata structure ─────────────────────────────────────────────
// If grandPath contains a *.json → we are 3 levels deep (metadata layout)
var gcContents = filelib.aglob(grandPath + "/*", "smart");
var hasJson    = false;
for (var i = 0; i < gcContents.length; i++) {
    if (!filelib.isDir(gcContents[i])) {
        var ext = gcContents[i].split(".").pop().toLowerCase();
        if (ext === "json") { hasJson = true; break; }
    }
}

var mangaRoot, mangaTitle;
if (hasJson) {
    // Metadata: grandPath = MangaName dir
    mangaRoot  = grandPath;
    mangaTitle = grandParts[grandParts.length - 1];
} else {
    // Legacy: parentPath = MangaName dir
    mangaRoot  = parentPath;
    mangaTitle = parentParts[parentParts.length - 1];
}
var titleArr = [mangaTitle, chapterName];

// ── Collect image pages ───────────────────────────────────────────────────
var rawPages   = filelib.aglob(targetFolder + "*", "smart");
var validPages = [];

for (var i = 0; i < rawPages.length; i++) {
    var thisPage  = rawPages[i];
    var base      = thisPage.split("/").pop();
    var dotPos    = base.lastIndexOf(".");
    var ext       = dotPos > -1 ? base.substr(dotPos + 1).toLowerCase() : "";
    var nameNoExt = dotPos > -1 ? base.substr(0, dotPos) : base;

    if (filelib.isDir(thisPage)) continue;
    if (ext !== "jpg" && ext !== "png") continue;
    if (nameNoExt.indexOf("-left") > -1 || nameNoExt.indexOf("-right") > -1) continue;

    var dim    = imagelib.getImageDimension(thisPage);
    var width  = dim[0];
    var height = dim[1];

    if (width > height) {
        // Landscape spread – split into right then left pages
        var dir    = thisPage.split("/").slice(0, -1).join("/");
        var tLeft  = dir + "/" + nameNoExt + "-left."  + ext;
        var tRight = dir + "/" + nameNoExt + "-right." + ext;
        if (!filelib.fileExists(tLeft) || !filelib.fileExists(tRight)) {
            imagelib.cropImage(thisPage, tLeft,  0,         0, width / 2, height);
            imagelib.cropImage(thisPage, tRight, width / 2, 0, width / 2, height);
        }
        validPages.push(tRight);
        validPages.push(tLeft);
    } else {
        validPages.push(thisPage);
    }
}

// ── Collect sibling chapters ──────────────────────────────────────────────
var otherChapters = [];

if (hasJson) {
    // Metadata layout: enumerate all group dirs, then their chapter dirs
    for (var i = 0; i < gcContents.length; i++) {
        var gname = gcContents[i].split("/").pop();
        if (!filelib.isDir(gcContents[i]) || gname.substr(0, 1) === ".") continue;
        var cands = filelib.aglob(gcContents[i] + "/*", "smart");
        for (var c = 0; c < cands.length; c++) {
            var cn = cands[c].split("/").pop();
            if (filelib.isDir(cands[c]) && cn.substr(0, 1) !== ".") {
                otherChapters.push(cands[c]);
            }
        }
    }
} else {
    // Legacy layout: siblings are direct children of mangaRoot
    var cands = filelib.aglob(mangaRoot + "/*", "smart");
    for (var i = 0; i < cands.length; i++) {
        var cn = cands[i].split("/").pop();
        if (filelib.isDir(cands[i]) && cn.substr(0, 1) !== ".") {
            otherChapters.push(cands[i]);
        }
    }
}

// Sort by chapter number embedded in folder name.
// Strip the leading "N " order prefix (e.g. "2 第05回" → "第05回")
// then extract the first number ("第05回" → 5) for correct reading order.
otherChapters.sort(function (a, b) {
    var an = a.split("/").pop().replace(/^\d+\s+/, "");
    var bn = b.split("/").pop().replace(/^\d+\s+/, "");
    var am = an.match(/\d+/);
    var bm = bn.match(/\d+/);
    if (am && bm) return parseInt(am[0], 10) - parseInt(bm[0], 10);
    return an < bn ? -1 : an > bn ? 1 : 0;
});

sendJSONResp(JSON.stringify({
    title:           titleArr,
    pages:           validPages,
    dir:             targetFolder,
    otherChapterDir: otherChapters,
    mangaRoot:       mangaRoot
}));
