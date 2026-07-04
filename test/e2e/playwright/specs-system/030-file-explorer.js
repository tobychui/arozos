/*
    Critical path: file explorer (File Manager).

    Renders the real File Manager UI against a live server, then walks
    the whole file lifecycle through the same endpoints the UI calls:
    list roots, list directory, create folder/file, rename, copy, move,
    properties, recycle to trash, restore from trash and empty trash.
    Mutating calls carry a CSRF token exactly like the front end does.
*/
"use strict";

const h = require("../lib/system-harness");

h.run("FILE-EXPLORER", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // ── 1. File Manager UI renders ──
    await page.goto(base + "/SystemAO/file_system/file_explorer.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#navibar", { state: "visible", timeout: 20000 });
    await page.waitForSelector("#folderView", { state: "attached", timeout: 20000 });
    // The sidebar lists the user's roots once listRoots returns.
    await page.waitForFunction(function () {
        var el = document.getElementById("userroot");
        return el && el.textContent.trim().length > 0;
    }, { timeout: 20000 });
    h.ok("File Manager UI renders navibar, folder view and storage roots");

    // ── 2. Storage roots include the user home ──
    const roots = await h.getJSON(page, base + "/system/file_system/listRoots");
    if (JSON.stringify(roots).indexOf("user") === -1) {
        h.fail("listRoots does not include the user root: " + JSON.stringify(roots));
    }
    h.ok("listRoots includes the user: home root");

    // ── 3. Create a folder ──
    let csrft = await h.csrfToken(page, base);
    let resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: "e2e-folder", csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("newItem folder failed: " + resp);
    let listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/" });
    if (listing.indexOf("e2e-folder") === -1) h.fail("created folder missing from listDir: " + listing.slice(0, 300));
    h.ok("newItem creates a folder that shows up in listDir");

    // ── 4. Create a file inside it ──
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "file", src: "user:/e2e-folder", filename: "e2e-note.txt", csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("newItem file failed: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/e2e-folder" });
    if (listing.indexOf("e2e-note.txt") === -1) h.fail("created file missing from listDir: " + listing.slice(0, 300));
    h.ok("newItem creates a file inside the new folder");

    // ── 5. Rename the file ──
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "rename",
        src: JSON.stringify(["user:/e2e-folder/e2e-note.txt"]),
        new: JSON.stringify(["e2e-renamed.txt"]),
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("rename failed: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/e2e-folder" });
    if (listing.indexOf("e2e-renamed.txt") === -1 || listing.indexOf("e2e-note.txt") !== -1) {
        h.fail("rename result wrong: " + listing.slice(0, 300));
    }
    h.ok("fileOpr rename renames the file");

    // ── 6. Copy the file to the home root ──
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "copy",
        src: JSON.stringify(["user:/e2e-folder/e2e-renamed.txt"]),
        dest: "user:/",
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("copy failed: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/" });
    if (listing.indexOf("e2e-renamed.txt") === -1) h.fail("copied file missing at destination: " + listing.slice(0, 300));
    h.ok("fileOpr copy duplicates the file to user:/");

    // ── 7. Move the copy into a second folder ──
    csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: "e2e-folder2", csrft: csrft
    });
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "move",
        src: JSON.stringify(["user:/e2e-renamed.txt"]),
        dest: "user:/e2e-folder2",
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("move failed: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/" });
    if (listing.indexOf("e2e-renamed.txt") !== -1) h.fail("moved file still present at source root");
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/e2e-folder2" });
    if (listing.indexOf("e2e-renamed.txt") === -1) h.fail("moved file missing at destination");
    h.ok("fileOpr move relocates the file into the second folder");

    // ── 8. File properties ──
    const props = await h.getJSON(page, base + "/system/file_system/getProperties?path=" + encodeURIComponent("user:/e2e-folder"));
    if (!props.IsDirectory || props.Basename !== "e2e-folder") {
        h.fail("getProperties returned unexpected data: " + JSON.stringify(props));
    }
    h.ok("getProperties reports the folder correctly");

    // ── 9. Recycle (delete to trash) ──
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "recycle",
        src: JSON.stringify(["user:/e2e-folder/e2e-renamed.txt"]),
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("recycle failed: " + resp);
    let trash = await h.getJSON(page, base + "/system/file_system/listTrash");
    let entry = trash.find(function (t) { return t.OriginalFilename === "e2e-renamed.txt"; });
    if (!entry) h.fail("recycled file not found in trash: " + JSON.stringify(trash).slice(0, 300));
    h.ok("recycle moves the file into the trash bin");

    // ── 10. Restore from trash ──
    resp = await h.postForm(page, base + "/system/file_system/restoreTrash", { src: entry.Filepath });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("restoreTrash failed: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/e2e-folder" });
    if (listing.indexOf("e2e-renamed.txt") === -1) h.fail("restored file missing from original folder");
    h.ok("restoreTrash puts the file back where it came from");

    // ── 11. Recycle again and empty the trash ──
    csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "recycle",
        src: JSON.stringify(["user:/e2e-folder/e2e-renamed.txt"]),
        csrft: csrft
    });
    resp = await h.postForm(page, base + "/system/file_system/clearTrash", {});
    trash = await h.getJSON(page, base + "/system/file_system/listTrash");
    entry = trash.find(function (t) { return t.OriginalFilename === "e2e-renamed.txt"; });
    if (entry) h.fail("trash still contains the file after clearTrash");
    h.ok("clearTrash empties the trash bin");

    // ── 12. Permanent delete of the working folders (cleanup + coverage) ──
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete",
        src: JSON.stringify(["user:/e2e-folder", "user:/e2e-folder2"]),
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("permanent delete failed: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/" });
    if (listing.indexOf("e2e-folder") !== -1) h.fail("folder still present after permanent delete");
    h.ok("fileOpr delete permanently removes the folders");

    // ── 13. Mutations without a CSRF token are refused ──
    // (Match on "csrf" - the rejection text "Invalid CSRF token" itself
    // contains the letters "ok", so a plain ok-check would misfire.)
    resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: "no-csrf-folder"
    });
    if (resp.toLowerCase().indexOf("csrf") === -1) h.fail("newItem without CSRF token was not refused: " + resp);
    listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/" });
    if (listing.indexOf("no-csrf-folder") !== -1) h.fail("folder was created despite missing CSRF token");
    h.ok("mutating file API refuses requests without a CSRF token");

    await page.close();
});
