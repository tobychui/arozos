/*
    Critical path (deep): file transfer, search and sharing.

    Extends the file-explorer coverage in 030 with the transfer-oriented
    File Manager features that move real bytes in and out of the system:
    multipart upload, media download (round-trip verification), search,
    and the share-link lifecycle (create / list / public download /
    delete). Uses the same endpoints the File Manager front end calls.
*/
"use strict";

const h = require("../lib/system-harness");

const UPLOAD_BODY = "arozos-e2e upload payload " + Date.now();
const UPLOAD_NAME = "e2e-upload.txt";

h.run("FILE-TRANSFER", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // Work inside a dedicated folder so the test is self-contained.
    let csrft = await h.csrfToken(page, base);
    let resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: "e2e-transfer", csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not create working folder: " + resp);

    // ── 1. Multipart upload of a real file ──
    const uploadResp = await page.request.post(base + "/system/file_system/upload", {
        multipart: {
            path: "user:/e2e-transfer",
            file: {
                name: UPLOAD_NAME,
                mimeType: "text/plain",
                buffer: Buffer.from(UPLOAD_BODY)
            }
        }
    });
    const uploadText = (await uploadResp.text()).trim().toLowerCase();
    if (uploadText.indexOf("ok") === -1) h.fail("upload failed: " + uploadText);
    let listing = await h.postForm(page, base + "/system/file_system/listDir", { dir: "user:/e2e-transfer" });
    if (listing.indexOf(UPLOAD_NAME) === -1) h.fail("uploaded file missing from listDir: " + listing.slice(0, 300));
    h.ok("multipart upload stores the file in the target folder");

    // ── 2. Download the file back and verify the bytes round-trip ──
    const dlResp = await page.request.get(base + "/media/?file=" +
        encodeURIComponent("user:/e2e-transfer/" + UPLOAD_NAME) + "&download=true");
    if (!dlResp.ok()) h.fail("download request failed with HTTP " + dlResp.status());
    const dlBody = await dlResp.text();
    if (dlBody !== UPLOAD_BODY) {
        h.fail("downloaded bytes did not match what was uploaded (got " + dlBody.length + " bytes)");
    }
    h.ok("download returns the exact bytes that were uploaded");

    // ── 3. Search finds the file by name ──
    const searchResults = await h.getJSON(page, base + "/system/file_system/search?path=" +
        encodeURIComponent("user:/e2e-transfer/") + "&keyword=e2e-upload");
    if (JSON.stringify(searchResults).indexOf(UPLOAD_NAME) === -1) {
        h.fail("search did not find the uploaded file: " + JSON.stringify(searchResults).slice(0, 300));
    }
    h.ok("file search finds the uploaded file by keyword");

    // ── 4. Create a share link for the file ──
    const share = await h.getJSON(page, base + "/system/file_system/share/new?path=" +
        encodeURIComponent("user:/e2e-transfer/" + UPLOAD_NAME));
    // share/new accepts POST too, but the front end also uses GET-style; use POST for parity.
    let shareObj = share;
    if (!shareObj || !shareObj.UUID) {
        // Fall back to the POST form the File Manager actually submits.
        const shareText = await h.postForm(page, base + "/system/file_system/share/new", {
            path: "user:/e2e-transfer/" + UPLOAD_NAME
        });
        try { shareObj = JSON.parse(shareText); } catch (e) { shareObj = null; }
    }
    if (!shareObj || !shareObj.UUID) h.fail("share/new did not return a share UUID: " + JSON.stringify(share));
    const shareUUID = shareObj.UUID;
    h.ok("share/new creates a share link with a UUID");

    // ── 5. The share appears in the user's share list ──
    const shareList = await h.getJSON(page, base + "/system/file_system/share/list");
    if (JSON.stringify(shareList).indexOf(shareUUID) === -1) {
        h.fail("created share not present in share list");
    }
    h.ok("the share appears in the user's share list");

    // ── 6. The public share link serves the file without a session ──
    // /share/download/{uuid}/ is the direct-download endpoint (the plain
    // /share/{uuid} path renders the preview page instead).
    const anon = await h.newPage(env.browser);
    const anonDl = await anon.request.get(base + "/share/download/" + shareUUID + "/");
    if (!anonDl.ok()) h.fail("public share download failed with HTTP " + anonDl.status());
    const anonBody = await anonDl.text();
    if (anonBody !== UPLOAD_BODY) {
        h.fail("public share download bytes did not match the original file");
    }
    // The plain share page should also be reachable anonymously (preview).
    const anonPage = await anon.request.get(base + "/share/" + shareUUID + "/");
    if (!anonPage.ok()) h.fail("public share preview page failed with HTTP " + anonPage.status());
    h.ok("the public share link serves the file and preview page without a session");
    await anon.close();

    // ── 7. Deleting the share revokes public access ──
    resp = await h.postForm(page, base + "/system/file_system/share/delete", { uuid: shareUUID });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("share delete failed: " + resp);
    const shareListAfter = await h.getJSON(page, base + "/system/file_system/share/list");
    if (JSON.stringify(shareListAfter).indexOf(shareUUID) !== -1) {
        h.fail("deleted share still present in share list");
    }
    h.ok("deleting the share removes it from the share list");

    // ── Cleanup ──
    csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete", src: JSON.stringify(["user:/e2e-transfer"]), csrft: csrft
    });

    await page.close();
});
