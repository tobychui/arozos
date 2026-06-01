/*
    Manga – listTitles.js
    Scans [vroot]:/Photo/Manga/ across all virtual roots.

    Supported folder structures:
      1. Legacy:   MangaName/ChapterName/*.img
      2. Metadata: MangaName/<groupName>/<prefixedChapterTitle>/*.img
                   + MangaName/*.json  (manhuadown schema)
                   The group folder name matches the key in meta.groups
                   (e.g. "单话" → MangaName/单话/1 第01回/)

    Return: JSON array of objects
    {
        path, title, cover, chapterCount,
        chapters: [{name, displayName, path, order, group}],
        type: "legacy" | "metadata"
    }
*/

requirelib("filelib");
requirelib("imagelib");

if (!filelib.fileExists("user:/Photo/Manga")) {
    filelib.mkdir("user:/Photo/Manga");
}

var rootList      = filelib.glob("/");
var scannedTitles = [];

// Natural sort key: inflate every digit sequence to 8 digits so that
// lexicographic order matches numeric order (e.g. "CH2" < "CH10").
function padNum(s) {
    return (s || "").replace(/\d+/g, function (n) {
        return ("00000000" + n).slice(-8);
    });
}

for (var r = 0; r < rootList.length; r++) {
    var thisRoot = rootList[r];
    if (!filelib.fileExists(thisRoot + "Photo/Manga")) continue;

    var titleList = filelib.aglob(thisRoot + "Photo/Manga/*", "smart");
    for (var t = 0; t < titleList.length; t++) {
        var titlePath = titleList[t];
        if (!filelib.isDir(titlePath)) continue;
        var titleName = titlePath.split("/").pop();
        if (titleName.substr(0, 1) === ".") continue;

        // ── Inspect title folder ───────────────────────────────────────────
        var contents = filelib.aglob(titlePath + "/*", "smart");
        var jsonFile = null;
        var subDirs  = [];
        for (var i = 0; i < contents.length; i++) {
            var item     = contents[i];
            var itemBase = item.split("/").pop();
            var dotIdx   = itemBase.lastIndexOf(".");
            var itemExt  = dotIdx > -1 ? itemBase.substr(dotIdx + 1).toLowerCase() : "";
            if (!filelib.isDir(item) && itemExt === "json") {
                jsonFile = item;
            } else if (filelib.isDir(item) && itemBase.substr(0, 1) !== ".") {
                subDirs.push(item);
            }
        }

        var entry = {
            path:         titlePath,
            title:        titleName,
            cover:        "",
            chapterCount: 0,
            chapters:     [],
            type:         "legacy"
        };

        if (jsonFile !== null) {
            // ════════════════════════════════════════════════════════════════
            //  Metadata structure
            //  MangaName/
            //    meta.json
            //    GroupName/           ← folder name = key in meta.groups
            //      prefixedTitle/     ← actual chapter folder
            //        *.jpg
            // ════════════════════════════════════════════════════════════════
            entry.type = "metadata";
            var meta = null;
            try { meta = JSON.parse(filelib.readFile(jsonFile)); } catch (e) {}

            if (meta !== null) {
                if (meta.title) entry.title = meta.title;

                var groups = meta.groups || {};
                var gKeys  = Object.keys(groups);

                // Build map: prefixedChapterTitle → full chapter folder path
                // by walking titlePath/<groupName>/<prefixedTitle>
                var cpMap = {};
                for (var g = 0; g < gKeys.length; g++) {
                    var groupDirPath = titlePath + "/" + gKeys[g];
                    if (!filelib.fileExists(groupDirPath) || !filelib.isDir(groupDirPath)) continue;
                    var groupContents = filelib.aglob(groupDirPath + "/*", "smart");
                    for (var c = 0; c < groupContents.length; c++) {
                        var chBase = groupContents[c].split("/").pop();
                        if (filelib.isDir(groupContents[c]) && chBase.substr(0, 1) !== ".") {
                            cpMap[chBase] = groupContents[c];
                        }
                    }
                }

                // Flatten all groups, sort globally by order
                var allCh = [];
                for (var g = 0; g < gKeys.length; g++) {
                    var grp = groups[gKeys[g]];
                    for (var c = 0; c < grp.length; c++) {
                        allCh.push({ group: gKeys[g], ch: grp[c] });
                    }
                }
                allCh.sort(function (a, b) { return a.ch.order - b.ch.order; });

                for (var c = 0; c < allCh.length; c++) {
                    var ch     = allCh[c].ch;
                    var chPath = cpMap[ch.prefixedChapterTitle] || "";
                    entry.chapters.push({
                        name:        ch.chapterTitle,
                        displayName: ch.prefixedChapterTitle,
                        path:        chPath,
                        order:       ch.order,
                        group:       allCh[c].group
                    });
                    if (chPath !== "") entry.chapterCount++;
                }

                // Natural sort: pad all digit sequences to 8 digits so that
                // e.g. "CH2" < "CH10" < "CH11" sorts correctly.
                entry.chapters.sort(function (a, b) {
                    var ak = padNum(a.name || "");
                    var bk = padNum(b.name || "");
                    return ak < bk ? -1 : ak > bk ? 1 : 0;
                });

                // Cover: thumbnail.png → cover.jpg → title.png →
                //        first chapter that actually has images on disk
                if (filelib.fileExists(titlePath + "/thumbnail.png")) {
                    entry.cover = titlePath + "/thumbnail.png";
                } else if (filelib.fileExists(titlePath + "/cover.jpg")) {
                    entry.cover = titlePath + "/cover.jpg";
                } else if (filelib.fileExists(titlePath + "/title.png")) {
                    entry.cover = titlePath + "/title.png";
                } else {
                    for (var fb = 0; fb < entry.chapters.length; fb++) {
                        if (!entry.chapters[fb].path) continue;
                        var imgs = filelib.aglob(entry.chapters[fb].path + "/*.jpg", "smart");
                        if (imgs.length === 0) imgs = filelib.aglob(entry.chapters[fb].path + "/*.png", "smart");
                        if (imgs.length > 0) { entry.cover = imgs[0]; break; }
                    }
                }
            }

        } else {
            // ════════════════════════════════════════════════════════════════
            //  Legacy structure  MangaName/ChapterName/*.img
            // ════════════════════════════════════════════════════════════════
            subDirs.sort(function (a, b) {
                var ak = padNum(a.split("/").pop());
                var bk = padNum(b.split("/").pop());
                return ak < bk ? -1 : ak > bk ? 1 : 0;
            });
            entry.chapterCount = subDirs.length;
            for (var s = 0; s < subDirs.length; s++) {
                var chName = subDirs[s].split("/").pop();
                entry.chapters.push({
                    name:        chName,
                    displayName: chName,
                    path:        subDirs[s],
                    order:       s + 1,
                    group:       ""
                });
            }

            // Cover: thumbnail.png → title.png →
            //        first chapter dir that has images (portrait preferred)
            if (filelib.fileExists(titlePath + "/thumbnail.png")) {
                entry.cover = titlePath + "/thumbnail.png";
            } else if (filelib.fileExists(titlePath + "/title.png")) {
                entry.cover = titlePath + "/title.png";
            } else {
                for (var fb = 0; fb < subDirs.length; fb++) {
                    var imgs = filelib.aglob(subDirs[fb] + "/*.jpg", "smart");
                    if (imgs.length === 0) imgs = filelib.aglob(subDirs[fb] + "/*.png", "smart");
                    if (imgs.length === 0) continue;
                    var cover = imgs[0];
                    for (var idx = 0; idx < imgs.length; idx++) {
                        var sz = imagelib.getImageDimension(imgs[idx]);
                        if (sz[0] <= sz[1]) { cover = imgs[idx]; break; }
                    }
                    entry.cover = cover;
                    break;
                }
            }
        }

        scannedTitles.push(entry);
    }
}

sendJSONResp(JSON.stringify(scannedTitles));
