/*
    Regression: file names that contain URL/HTML special characters.

    Issue #206 was "fixed" upstream by hiding names containing %, ?, etc. from
    the listing and refusing to create them. These names are valid on the
    supported file systems, so this spec drives the real file manager API and
    UI with %, +, #, & and spaces to make sure they are listed, opened,
    created, renamed, copied and uploaded without being altered.

    The checks deliberately use the same form-encoded and WebSocket calls the
    front end makes, because the original bug was double URL-decoding on the
    server (which turned "50%" into an invalid escape sequence).
*/
"use strict";

const h = require("../lib/system-harness");

async function postJSON(page, url, form) {
    const res = await page.request.post(url, { form: form });
    const text = (await res.text()).trim();
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error("Expected JSON from " + url + " but got: " + text.slice(0, 300));
    }
}

async function listDir(page, base, dir) {
    return postJSON(page, base + "/system/file_system/listDir", { dir: dir });
}

function hasEntry(listing, filename) {
    return Array.isArray(listing) && listing.some(function (entry) {
        return entry.Filename === filename;
    });
}

function expectEntry(listing, filename, label) {
    if (!hasEntry(listing, filename)) {
        h.fail(label + " (missing " + JSON.stringify(filename) + "): " + JSON.stringify(listing).slice(0, 400));
    }
}

function expectNoEntry(listing, filename, label) {
    if (hasEntry(listing, filename)) {
        h.fail(label + " (unexpected " + JSON.stringify(filename) + "): " + JSON.stringify(listing).slice(0, 400));
    }
}

h.run("SPECIAL-FILENAMES", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    const pageErrors = [];
    // Only collect errors that point at URL decoding / parsing. The test
    // instance has no /system/disk/space/tmp implementation, which makes an
    // unrelated upload-mode probe fail on every File Manager load.
    page.on("pageerror", function (e) {
        const text = String((e && (e.stack || e.message)) || e);
        if (/URIError|decodeURIComponent|JSON parse|illegal character/i.test(text)) {
            pageErrors.push(text);
        }
    });

    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    const folderName = "e2e 50% & #1 + plus";
    const folderPath = "user:/" + folderName;
    const fileName = "note 25% [draft].txt";
    const filePath = folderPath + "/" + fileName;
    const renamedFileName = "report 75% & clean.txt";
    const renamedFilePath = folderPath + "/" + renamedFileName;
    const copyTarget = "user:/e2e-copy-target";
    const wsTarget = "user:/e2e-ws-target";
    const uploadedName = "upload 33% + #.txt";

    // 1. Create the special-character folder and file through the same
    //    form-encoded endpoint the UI uses.
    let csrft = await h.csrfToken(page, base);
    let resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: folderName, csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("newItem folder failed: " + resp);

    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/newItem", {
        type: "file", src: folderPath, filename: fileName, csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("newItem file failed: " + resp);

    let listing = await listDir(page, base, "user:/");
    expectEntry(listing, folderName, "special-character folder is missing from listDir");
    h.ok("creates and lists a folder containing %, +, # and &");

    listing = await listDir(page, base, folderPath);
    expectEntry(listing, fileName, "special-character file is missing from listDir");
    h.ok("creates and lists a file containing %, +, #, &, spaces and brackets");

    // 2. validateFileOpr used to return "Source file JSON parse error" for
    //    these names because it unescaped an already-decoded parameter.
    const validation = await postJSON(page, base + "/system/file_system/validateFileOpr", {
        src: JSON.stringify([filePath]),
        dest: "user:/"
    });
    if (!Array.isArray(validation)) {
        h.fail("validateFileOpr returned an error instead of a duplicate list: " + JSON.stringify(validation));
    }
    h.ok("validateFileOpr accepts a source path containing %");

    // 3. Rename the file, still through the form-encoded endpoint.
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "rename",
        src: JSON.stringify([filePath]),
        new: JSON.stringify([renamedFileName]),
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("rename failed: " + resp);

    listing = await listDir(page, base, folderPath);
    expectEntry(listing, renamedFileName, "renamed file is missing from listDir");
    expectNoEntry(listing, fileName, "old file name is still present after rename");
    h.ok("renames a file to a name containing % and &");

    // 4. Copy the folder through the HTTP file operation endpoint.
    csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: "e2e-copy-target", csrft: csrft
    });
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "copy",
        src: JSON.stringify([folderPath]),
        dest: copyTarget,
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("copy failed: " + resp);

    listing = await listDir(page, base, copyTarget + "/" + folderName);
    expectEntry(listing, renamedFileName, "copied folder does not contain the renamed file");
    h.ok("copies a folder whose name contains % and +");

    // 5. Open the folder in the real File Manager UI. The old front end threw
    //    a URIError here (decodeURIComponent of a literal %), leaving the
    //    folder unopenable.
    await page.goto(base + "/SystemAO/file_system/file_explorer.html#" + encodeURIComponent(folderPath + "/"), {
        waitUntil: "domcontentloaded"
    });
    await page.waitForSelector("#navibar", { state: "visible", timeout: 20000 });
    await page.waitForFunction(function (name) {
        return document.body.innerText.indexOf(name) !== -1;
    }, renamedFileName, { timeout: 20000 });
    if (pageErrors.length > 0) {
        h.fail("File Manager raised a page error while opening the folder: " + pageErrors.join(" | "));
    }
    h.ok("opens a special-character folder directly from the URL hash");

    // 6. Upload a file whose name contains % through the standard multipart
    //    upload endpoint, then rename it.
    const upload = await page.request.post(base + "/system/file_system/upload", {
        params: { path: folderPath },
        multipart: {
            path: folderPath,
            file: {
                name: uploadedName,
                mimeType: "text/plain",
                buffer: Buffer.from("special character upload")
            }
        }
    });
    resp = (await upload.text()).trim();
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("upload failed: " + resp);

    listing = await listDir(page, base, folderPath);
    expectEntry(listing, uploadedName, "uploaded file is missing from listDir");
    h.ok("uploads a file whose name contains % and +");

    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "rename",
        src: JSON.stringify([folderPath + "/" + uploadedName]),
        new: JSON.stringify(["uploaded 90% done.txt"]),
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("rename uploaded file failed: " + resp);
    listing = await listDir(page, base, folderPath);
    expectEntry(listing, "uploaded 90% done.txt", "renamed upload is missing from listDir");
    h.ok("renames an uploaded file containing %");

    // 7. Upload names must not be able to escape the selected directory.
    //    Playwright's multipart helper sanitizes the name, so send a raw
    //    multipart body with a traversal filename the way a crafted client
    //    would.
    const boundary = "----arozos-e2e-boundary";
    const multipartBody =
        "--" + boundary + "\r\n" +
        "Content-Disposition: form-data; name=\"path\"\r\n\r\n" +
        folderPath + "\r\n" +
        "--" + boundary + "\r\n" +
        "Content-Disposition: form-data; name=\"file\"; filename=\"../escape.txt\"\r\n" +
        "Content-Type: text/plain\r\n\r\n" +
        "traversal\r\n" +
        "--" + boundary + "--\r\n";
    const badUpload = await page.request.post(base + "/system/file_system/upload?path=" +
        encodeURIComponent(folderPath), {
        headers: {
            // Firefox >= 94 takes the relative path from the raw header, which
            // is the code path that must validate the traversal segments.
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:100.0) Gecko/20100101 Firefox/100.0",
            "Content-Type": "multipart/form-data; boundary=" + boundary
        },
        data: multipartBody
    });
    const badUploadBody = (await badUpload.text()).trim();
    if (badUploadBody.toLowerCase().indexOf("error") === -1) {
        h.fail("multipart upload with ../ in its filename was not rejected: " + badUploadBody);
    }
    listing = await listDir(page, base, "user:/");
    expectNoEntry(listing, "escape.txt", "traversal upload escaped the target directory");

    const badLowMem = await page.request.get(base + "/system/file_system/lowmemUpload?filename=" +
        encodeURIComponent("../escape-lowmem.txt") +
        "&path=" + encodeURIComponent(folderPath));
    const badLowMemBody = (await badLowMem.text()).trim();
    if (badLowMem.status() !== 400 || !/invalid filename/i.test(badLowMemBody)) {
        h.fail("low-memory upload with ../ in its filename was not rejected: HTTP " +
            badLowMem.status() + " " + badLowMemBody.slice(0, 200));
    }
    listing = await listDir(page, base, "user:/");
    expectNoEntry(listing, "escape-lowmem.txt", "low-memory traversal upload escaped the target directory");
    h.ok("upload endpoints reject traversal in the uploaded file name");

    // 8. The desktop UI copies through the WebSocket endpoint. Exercise it
    //    with the same {{plug_sign}} workaround the front end uses for "+".
    csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/newItem", {
        type: "folder", src: "user:/", filename: "e2e-ws-target", csrft: csrft
    });

    const wsSource = folderPath + "/" + renamedFileName;
    const wsURL = await page.evaluate(function (source) {
        const filtered = [source.split("+").join("{{plug_sign}}")];
        const protocol = location.protocol === "https:" ? "wss://" : "ws://";
        return protocol + location.host + "/system/file_system/ws/fileOpr" +
            "?opr=copy&src=" + encodeURIComponent(JSON.stringify(filtered)) +
            "&dest=" + encodeURIComponent("user:/e2e-ws-target") +
            "&existsresp=keep";
    }, wsSource);

    const wsResult = await page.evaluate(function (url) {
        return new Promise(function (resolve) {
            const messages = [];
            let settled = false;
            const socket = new WebSocket(url);
            const timer = setTimeout(function () {
                if (!settled) {
                    settled = true;
                    try { socket.close(); } catch (e) {}
                    resolve({ messages: messages, timeout: true });
                }
            }, 20000);
            socket.onmessage = function (event) { messages.push(String(event.data)); };
            socket.onerror = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ messages: messages, error: true });
            };
            socket.onclose = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ messages: messages });
            };
        });
    }, wsURL);

    if (wsResult.timeout || wsResult.error) {
        h.fail("WebSocket copy did not complete: " + JSON.stringify(wsResult));
    }
    const wsFailed = wsResult.messages.some(function (m) {
        try {
            const progress = JSON.parse(m);
            return progress && progress.Error !== undefined && progress.Error !== "";
        } catch (e) {
            return false;
        }
    });
    if (wsFailed) {
        h.fail("WebSocket copy reported an error: " + wsResult.messages.join(" | "));
    }
    listing = await listDir(page, base, wsTarget);
    expectEntry(listing, renamedFileName, "WebSocket copy did not create the file");
    h.ok("WebSocket copy accepts a source path containing % and +");

    // 9. Clean up the working folders.
    csrft = await h.csrfToken(page, base);
    resp = await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete",
        src: JSON.stringify([folderPath, copyTarget, wsTarget]),
        csrft: csrft
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("cleanup delete failed: " + resp);
    listing = await listDir(page, base, "user:/");
    expectNoEntry(listing, folderName, "special-character folder still present after cleanup");
    h.ok("cleans up the special-character test folders");

    await page.close();
});
