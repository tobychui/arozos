/*
    publish.js

    Preview, publishing and exporting.

    Publishing writes a complete static site into a folder of its own inside
    the user's ArozOS Personal Site web root:

        <web root>/<site slug>/index.html
        <web root>/<site slug>/<page>.html
        <web root>/<site slug>/assets/site.css
        <web root>/<site slug>/assets/<referenced media>

    which the server then serves at /www/<username>/<site slug>/. Keeping every
    site in its own folder means publishing can never clobber an existing home
    page that the user put in the web root by other means.

    Personal Site endpoints used (registered in src/network.go, only when the
    server runs with -allow_homepage):
        GET ../system/network/www/toggle          -> bool
        GET ../system/network/www/toggle?set=     -> enable / disable
        GET ../system/network/www/webRoot         -> virtual path
        GET ../system/network/www/webRoot?set=    -> set the web root
*/

var WBPublish = (function () {

    var state = { enabled: null, webroot: "", username: "", available: true, loaded: false };
    var previewOn = false;

    /* --------------------------------------------------------- helpers -- */

    function getJSON(url) {
        return fetch(url, { credentials: "same-origin" }).then(function (r) {
            if (r.status === 404) { return { __missing: true }; }
            return r.text().then(function (t) {
                try { return JSON.parse(t); } catch (e) { return t; }
            });
        });
    }

    /* ---------------------------------------------------- site  state -- */

    function getSiteState(cb) {
        Promise.all([
            getJSON("../system/network/www/toggle"),
            getJSON("../system/network/www/webRoot"),
            getJSON("../system/desktop/user")
        ]).then(function (res) {
            var toggle = res[0], root = res[1], user = res[2];
            state.available = !(toggle && toggle.__missing);
            state.enabled = (toggle === true || toggle === "true");
            state.webroot = (typeof root === "string" && root.indexOf(":/") > 0) ? root : "";
            state.username = (user && user.Username) ? user.Username : "";
            state.loaded = true;
            if (cb) { cb(state); }
        }).catch(function () {
            state.loaded = true;
            if (cb) { cb(state); }
        });
    }

    function setHomepageEnabled(v, cb) {
        getJSON("../system/network/www/toggle?set=" + (v ? "true" : "false")).then(function (r) {
            cb(!(r && r.error));
        }).catch(function () { cb(false); });
    }

    function setWebRoot(vpath, cb) {
        getJSON("../system/network/www/webRoot?set=" + encodeURIComponent(vpath)).then(function (r) {
            cb(!(r && r.error));
        }).catch(function () { cb(false); });
    }

    /* --------------------------------------------------------- preview -- */

    function isPreview() { return previewOn; }

    function togglePreview(force) {
        previewOn = force === undefined ? !previewOn : force;
        WBCanvas.setPreview(previewOn);
        renderPreviewBar();
        WBApp.renderPreviewState(previewOn);
        WBApp.rerenderCanvas();
    }

    function renderPreviewBar() {
        var bar = document.getElementById("wb-preview-bar");
        bar.classList.toggle("wb-hidden", !previewOn);
    }

    /* Open the current page in a real browser tab. */
    function openInNewTab() {
        var project = WBModel.get();
        var page = WBModel.activePage();
        var html = "<!DOCTYPE html><html lang=\"" + (project.settings.lang || "en") + "\"><head>" +
            '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            "<title>" + WBRender.esc(page.title || page.name) + "</title>" +
            "<style>" + WBRender.resetCss() + "\n" + WBRender.pageCss(page) + "</style>" +
            "</head>" + WBRender.nodeHtml(page.root, { mode: "preview" }) + "</html>";

        var w = window.open("", "_blank");
        if (!w) {
            WBUI.toast("Your browser blocked the preview window", "err");
            return;
        }
        /* the blank window inherits this origin, so ../media links still work */
        w.document.open();
        w.document.write(html.replace(/\.\.\/media\?file=/g, location.origin + "/media?file="));
        w.document.close();
    }

    /* --------------------------------------------------------- building -- */

    /*
        Produce every file of the static site.
        Returns { files: [{path, content}], assets: [virtual paths] }
    */
    function buildSite() {
        var project = WBModel.get();
        var assets = WBRender.buildAssetPlan(project);

        var files = [];
        var used = {};
        project.pages.forEach(function (page) {
            if (page.visibility === "hidden") { return; }
            var name = WBModel.pageFileName(page);
            while (used[name]) { name = name.replace(/\.html$/, "") + "-2.html"; }
            used[name] = true;
            files.push({ path: name, content: WBRender.pageHtml(project, page, assets.map) });
        });
        files.push({ path: "assets/site.css", content: WBRender.siteCss(project, assets.map) });

        /* collector scripts for forms that save submissions to a file */
        var formFiles = WBFormGen.files(project);
        formFiles.forEach(function (f) { files.push(f); });

        return { files: files, assets: assets.plan, assetMap: assets.map, forms: formFiles.length };
    }

    /* ------------------------------------------------------- publishing -- */

    function publish() {
        if (!state.loaded) {
            getSiteState(function () { publish(); });
            return;
        }
        if (!state.available) {
            WBUI.modal({
                title: "Personal Site Unavailable",
                body: WBUI.el("div", {
                    text: "This ArozOS server was started without the personal home page feature " +
                          "(-allow_homepage=false), so there is nowhere to publish to. You can still " +
                          "export the site into any folder and serve it yourself."
                }),
                buttons: [
                    { label: "Close", value: null },
                    { label: "Export To Folder", value: "export", primary: true }
                ]
            }).then(function (v) { if (v === "export") { exportToFolder(); } });
            return;
        }
        if (!state.webroot) {
            WBUI.modal({
                title: "Choose A Web Root",
                body: WBUI.el("div", {
                    text: "Your personal site does not have a web root folder yet. Pick the folder that " +
                          "ArozOS should serve publicly - your site will be published into a subfolder of it."
                }),
                buttons: [
                    { label: "Cancel", value: null },
                    { label: "Choose Folder", value: "pick", primary: true }
                ]
            }).then(function (v) {
                if (v !== "pick") { return; }
                WBFileIO.pickFolder(function (vpath) {
                    setWebRoot(vpath, function (ok) {
                        if (!ok) { WBUI.toast("Could not save the web root", "err"); return; }
                        getSiteState(function () { publish(); });
                    });
                });
            });
            return;
        }
        confirmAndRun();
    }

    function confirmAndRun() {
        var project = WBModel.get();
        var slug = project.slug || WBModel.slugify(project.name);
        var target = joinPath(state.webroot, slug);
        var built = buildSite();

        var slugInput = WBUI.textInput(slug, function () {}, { mono: true });
        var enableSwitch = WBUI.switchControl(!!state.enabled, function () {});

        var pageList = WBUI.el("ul", {
            style: "margin:8px 0 0;padding-left:18px;color:var(--wb-text-dim);font-size:11.5px;line-height:1.7"
        });
        built.files.forEach(function (f) {
            pageList.appendChild(WBUI.el("li", { text: f.path }));
        });

        var body = WBUI.el("div", {}, [
            WBUI.field("Publish folder", slugInput),
            WBUI.el("div", { class: "wb-note", id: "wb-pub-target" }),
            WBUI.el("div", { class: "wb-row" }, [
                WBUI.el("div", { class: "wb-row-text" }, [
                    WBUI.el("div", { class: "wb-row-label", text: "Personal site enabled" }),
                    WBUI.el("div", { class: "wb-row-desc",
                        text: "Without this, the published files exist but are not served publicly." })
                ]),
                enableSwitch
            ]),
            WBUI.el("div", { class: "wb-section-title", style: "margin-top:14px",
                text: built.files.length + " files, " + built.assets.length + " media assets" }),
            pageList
        ]);

        function updateTarget() {
            var s2 = WBModel.slugify(slugInput.value) || "site";
            var note = body.querySelector("#wb-pub-target");
            note.innerHTML = "Writes to <code>" + WBRender.esc(joinPath(state.webroot, s2)) + "</code>" +
                (state.username
                    ? "<br>Public address <code>/www/" + WBRender.esc(state.username) + "/" +
                      WBRender.esc(s2) + "/</code>"
                    : "");
        }
        slugInput.addEventListener("input", updateTarget);
        updateTarget();

        WBUI.modal({
            title: "Publish Site",
            body: body,
            buttons: [
                { label: "Cancel", value: null },
                { label: "Publish", value: "go", primary: true }
            ]
        }).then(function (v) {
            if (v !== "go") { return; }
            var finalSlug = WBModel.slugify(slugInput.value) || "site";
            if (finalSlug !== project.slug) {
                project.slug = finalSlug;
                WBModel.commit("Set publish folder");
            }
            var wantEnabled = enableSwitch.querySelector("input").checked;
            target = joinPath(state.webroot, finalSlug);

            var chain = Promise.resolve();
            if (wantEnabled !== state.enabled) {
                chain = new Promise(function (res) {
                    setHomepageEnabled(wantEnabled, function () { state.enabled = wantEnabled; res(); });
                });
            }
            chain.then(function () { runPublish(target, buildSite(), finalSlug); });
        });
    }

    function runPublish(target, built, slug) {
        WBUI.busy(true, "Publishing...");
        copyAssets(target, built.assets, function (i, total, name) {
            WBUI.busy(true, "Copying media " + i + " of " + total + " - " + name);
        }).then(function (copyResult) {
            WBUI.busy(true, "Writing pages...");
            return writeFiles(target, built.files).then(function () {
                WBUI.busy(false);
                showSuccess(target, slug, built, copyResult);
            });
        }).catch(function (err) {
            WBUI.busy(false);
            WBUI.toast(String(err && err.message ? err.message : err), "err");
        });
    }

    function writeFiles(target, files) {
        return new Promise(function (resolve, reject) {
            ao_module_agirun("Web Builder/backend/publish.agi", {
                target: target,
                files: JSON.stringify(files)
            }, function (resp) {
                if (resp && resp.error !== undefined) { reject(new Error(resp.error)); return; }
                resolve(resp);
            }, function () {
                reject(new Error("Could not write the site files"));
            }, 120000);
        });
    }

    /*
        Copy referenced media into <target>/assets.

        AGI's filelib is text-only, so binaries cannot go through publish.agi -
        they would be corrupted. The bytes are instead read back through the
        media server and re-uploaded under the name buildAssetPlan() chose, so
        the file that lands on disk is exactly the one the markup points at.

        Each file is handled on its own: one unreadable image reports itself
        instead of silently taking the whole publish down with it.
    */
    function copyAssets(target, plan, onProgress) {
        if (!plan || !plan.length) { return Promise.resolve({ copied: 0, failed: [] }); }
        var dest = joinPath(target, "assets");
        var copied = 0;
        var failed = [];

        function uploadOne(item) {
            return fetch("../media?file=" + encodeURIComponent(item.vpath), { credentials: "same-origin" })
                .then(function (r) {
                    if (!r.ok) { throw new Error("could not read the file (HTTP " + r.status + ")"); }
                    return r.blob();
                })
                .then(function (blob) {
                    if (!blob.size) { throw new Error("the file is empty"); }
                    var fd = new FormData();
                    fd.append("file", blob, item.name);
                    fd.append("path", dest);
                    return fetch("../system/file_system/upload", {
                        method: "POST",
                        credentials: "same-origin",
                        body: fd
                    });
                })
                .then(function (r) { return r.text(); })
                .then(function (text) {
                    var parsed = null;
                    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
                    if (parsed && parsed.error) { throw new Error(parsed.error); }
                    copied++;
                })
                .catch(function (err) {
                    failed.push({
                        name: WBRender.baseName(item.vpath),
                        reason: (err && err.message) ? err.message : "upload failed"
                    });
                });
        }

        /* make sure the assets folder exists before the first upload */
        return new Promise(function (resolve) {
            ao_module_agirun("Web Builder/backend/publish.agi", { target: dest, files: "[]" },
                function () { resolve(); },
                function () { resolve(); });
        }).then(function () {
            /* sequential: keeps ordering, progress and server load sane */
            var chain = Promise.resolve();
            plan.forEach(function (item, i) {
                chain = chain.then(function () {
                    if (onProgress) { onProgress(i + 1, plan.length, item.name); }
                    return uploadOne(item);
                });
            });
            return chain;
        }).then(function () {
            return { copied: copied, failed: failed };
        });
    }

    function showSuccess(target, slug, built, copyResult) {
        var url = state.username
            ? location.origin + "/www/" + state.username + "/" + slug + "/"
            : "";
        var body = WBUI.el("div");
        body.appendChild(WBUI.el("div", {
            text: built.files.length + " page files written to " + target +
                  (built.assets.length ? ", " + copyResult.copied + " of " + built.assets.length + " media files copied." : ".")
        }));
        if (copyResult.failed && copyResult.failed.length) {
            var list = copyResult.failed.map(function (f) {
                return f.name + " (" + f.reason + ")";
            }).join("\n");
            body.appendChild(WBUI.el("div", {
                class: "wb-note warn",
                text: "These media files could not be copied, so they will show as broken on the " +
                      "published page:\n" + list,
                style: "white-space:pre-wrap"
            }));
        }
        if (!state.enabled) {
            body.appendChild(WBUI.el("div", {
                class: "wb-note warn",
                text: "Your personal site is currently disabled, so the published files are not reachable " +
                      "from the internet yet. Enable it in Settings."
            }));
        }
        if (url) {
            body.appendChild(WBUI.el("div", { class: "wb-note" }, [
                WBUI.el("div", { text: "Your site is live at:", style: "margin-bottom:4px" }),
                WBUI.el("a", {
                    href: url, target: "_blank",
                    style: "color:var(--wb-accent);text-decoration:none;word-break:break-all",
                    text: url
                })
            ]));
        }

        WBUI.modal({
            title: "Site Published",
            body: body,
            buttons: [
                { label: "Close", value: null },
                url ? { label: "Open Site", value: "open", primary: true } : null
            ].filter(Boolean)
        }).then(function (v) {
            if (v === "open" && url) { window.open(url, "_blank"); }
        });
    }

    /* --------------------------------------------------------- exporting -- */

    function exportToFolder() {
        WBFileIO.pickFolder(function (vpath) {
            var built = buildSite();
            WBUI.busy(true, "Exporting...");
            copyAssets(vpath, built.assets, function (i, total, name) {
                WBUI.busy(true, "Copying media " + i + " of " + total + " - " + name);
            }).then(function (copyResult) {
                WBUI.busy(true, "Writing pages...");
                return writeFiles(vpath, built.files).then(function () {
                    WBUI.busy(false);
                    WBUI.toast("Exported " + built.files.length + " files to " + vpath, "ok");
                    if (copyResult.failed && copyResult.failed.length) {
                        WBUI.toast(copyResult.failed.length + " media file(s) could not be copied", "err");
                    }
                });
            }).catch(function (err) {
                WBUI.busy(false);
                WBUI.toast(String(err && err.message ? err.message : err), "err");
            });
        });
    }

    function joinPath(a, b) {
        if (!a) { return b; }
        return a.replace(/\/+$/, "") + "/" + String(b).replace(/^\/+/, "");
    }

    return {
        getSiteState: getSiteState,
        setHomepageEnabled: setHomepageEnabled,
        setWebRoot: setWebRoot,
        publish: publish,
        exportToFolder: exportToFolder,
        buildSite: buildSite,
        togglePreview: togglePreview,
        isPreview: isPreview,
        openInNewTab: openInNewTab,
        state: function () { return state; }
    };
})();
