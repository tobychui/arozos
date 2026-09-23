/*
    settings.js

    The "Settings" panel: site metadata, the project file, and the ArozOS
    Personal Site configuration (the /www/<user>/ web root) so the whole
    publish story can be set up without leaving the builder.
*/

var WBSettings = (function () {

    var bodyEl;
    var siteState = { enabled: null, webroot: "", username: "", available: true };

    function init() {
        bodyEl = document.querySelector("#wb-panel-settings .wb-panel-bd");
        render();
        refreshSiteState();
    }

    function s() { return WBModel.get().settings; }

    function refreshSiteState() {
        WBPublish.getSiteState(function (state) {
            siteState = state;
            render();
        });
    }

    function render() {
        if (!bodyEl) { return; }
        var scroll = bodyEl.scrollTop;
        WBUI.clear(bodyEl);
        var project = WBModel.get();

        /* ------------------------------------------------ site ---- */
        var site = section("Site");
        site.appendChild(WBUI.field("Site Name", WBUI.textInput(project.name, function (v) {
            project.name = v;
            WBModel.commit("Rename site", "sitename");
            WBApp.refreshTitles();
        })));

        site.appendChild(WBUI.field("Publish Folder", WBUI.textInput(project.slug, function (v) {
            project.slug = WBModel.slugify(v);
            WBModel.commit("Set publish folder", "siteslug");
            render();
        }, { mono: true, placeholder: "my-website" }), null));

        site.appendChild(publishTargetNote());

        site.appendChild(WBUI.field("Language", WBUI.textInput(s().lang || "en", function (v) {
            s().lang = v.trim() || "en";
            WBModel.commit("Set language", "lang");
        }, { mono: true, placeholder: "en" })));

        site.appendChild(WBUI.field("Description", WBUI.textArea(s().description || "", function (v) {
            s().description = v;
            WBModel.commit("Set description", "sitedesc");
        }, { rows: 2, placeholder: "Used as the default meta description" })));

        site.appendChild(WBUI.field("Author", WBUI.textInput(s().author || "", function (v) {
            s().author = v;
            WBModel.commit("Set author", "author");
        })));

        var favRow = WBUI.el("div", { class: "wb-path-row" }, [
            WBUI.textInput(s().favicon || "", function (v) {
                s().favicon = v;
                WBModel.commit("Set favicon", "favicon");
            }, { mono: true, placeholder: "user:/Pictures/favicon.png" }),
            WBUI.el("button", {
                class: "wb-btn wb-btn-sm",
                type: "button",
                html: WBIcon("open", 13),
                title: "Choose an image",
                onclick: function () {
                    WBFileIO.pickMedia("image", function (vpath) {
                        s().favicon = vpath;
                        WBModel.commit("Set favicon");
                        render();
                    });
                }
            })
        ]);
        site.appendChild(WBUI.field("Favicon", favRow));
        bodyEl.appendChild(site);

        /* --------------------------------------- personal site ---- */
        bodyEl.appendChild(personalSiteSection());

        /* --------------------------------------- project file ---- */
        var file = section("Project File");
        var pathInput = WBUI.textInput(WBFileIO.currentPath() || "(not saved yet)", function () {});
        pathInput.readOnly = true;
        pathInput.classList.add("mono");
        file.appendChild(WBUI.field("Saved To", pathInput));

        file.appendChild(WBUI.el("div", { class: "wb-path-row" }, [
            WBUI.el("button", {
                class: "wb-btn wb-btn-sm", type: "button", style: "flex:1",
                html: WBIcon("save", 13) + "<span>Save</span>",
                onclick: function () { WBApp.save(); }
            }),
            WBUI.el("button", {
                class: "wb-btn wb-btn-sm", type: "button", style: "flex:1",
                html: WBIcon("new-file", 13) + "<span>Save As</span>",
                onclick: function () { WBApp.saveAs(); }
            })
        ]));

        file.appendChild(WBUI.el("div", { class: "wb-row" }, [
            WBUI.el("div", { class: "wb-row-text" }, [
                WBUI.el("div", { class: "wb-row-label", text: "Autosave" }),
                WBUI.el("div", { class: "wb-row-desc", text: "Write changes back to the project file a few seconds after you stop editing." })
            ]),
            WBUI.switchControl(WBApp.getAutosave(), function (v) { WBApp.setAutosave(v); })
        ]));
        bodyEl.appendChild(file);

        bodyEl.scrollTop = scroll;
    }

    function publishTargetNote() {
        var project = WBModel.get();
        var folder = project.slug || "site";
        var note = WBUI.el("div", { class: "wb-note" });
        if (siteState.username) {
            note.innerHTML = "Publishes to <code>/www/" + WBRender.esc(siteState.username) + "/" +
                WBRender.esc(folder) + "/</code>";
        } else {
            note.innerHTML = "Publishes to <code>&lt;web root&gt;/" + WBRender.esc(folder) + "/</code>";
        }
        return note;
    }

    function personalSiteSection() {
        var sec = section("Personal Site");

        if (!siteState.available) {
            sec.appendChild(WBUI.el("div", {
                class: "wb-note warn",
                text: "Personal home pages are turned off on this ArozOS server (the -allow_homepage flag). " +
                      "You can still export your site to a folder from the menu."
            }));
            return sec;
        }

        sec.appendChild(WBUI.el("div", { class: "wb-row" }, [
            WBUI.el("div", { class: "wb-row-text" }, [
                WBUI.el("div", { class: "wb-row-label", text: "Personal site enabled" }),
                WBUI.el("div", { class: "wb-row-desc", text: "Serves your web root publicly under /www/" +
                    (siteState.username || "you") + "/" })
            ]),
            WBUI.switchControl(!!siteState.enabled, function (v) {
                WBPublish.setHomepageEnabled(v, function (ok) {
                    if (!ok) { WBUI.toast("Could not change the personal site setting", "err"); }
                    else { WBUI.toast(v ? "Personal site enabled" : "Personal site disabled", "ok"); }
                    refreshSiteState();
                });
            })
        ]));

        var rootRow = WBUI.el("div", { class: "wb-path-row" }, [
            (function () {
                var i = WBUI.textInput(siteState.webroot || "", function () {}, { mono: true });
                i.readOnly = true;
                i.placeholder = "No web root selected";
                return i;
            })(),
            WBUI.el("button", {
                class: "wb-btn wb-btn-sm",
                type: "button",
                title: "Choose the folder served as your personal site",
                html: WBIcon("folder", 13),
                onclick: function () { chooseWebRoot(); }
            })
        ]);
        sec.appendChild(WBUI.field("Web Root Folder", rootRow));

        if (!siteState.webroot) {
            sec.appendChild(WBUI.el("div", {
                class: "wb-note warn",
                text: "Pick a web root folder before publishing. Everything inside it becomes publicly readable."
            }));
        } else if (siteState.username) {
            var url = location.protocol + "//" + location.host + "/www/" + siteState.username + "/" +
                      (WBModel.get().slug || "site") + "/";
            var link = WBUI.el("a", {
                href: url, target: "_blank",
                style: "color:var(--wb-accent);text-decoration:none;word-break:break-all;font-size:11px",
                text: url
            });
            sec.appendChild(WBUI.el("div", { class: "wb-note" }, [
                WBUI.el("div", { text: "Your published address:", style: "margin-bottom:3px" }),
                link
            ]));
        }

        sec.appendChild(WBUI.el("button", {
            class: "wb-btn wb-btn-block wb-btn-sm",
            type: "button",
            style: "margin-top:10px",
            html: WBIcon("gear", 13) + "<span>Open system settings</span>",
            onclick: function () {
                try { ao_module_openSetting("Network", "Personal Page"); }
                catch (e) { WBUI.toast("Open ArozOS Settings > Network > Personal Page", "err"); }
            }
        }));

        return sec;
    }

    function chooseWebRoot() {
        WBFileIO.pickFolder(function (vpath) {
            WBPublish.setWebRoot(vpath, function (ok) {
                if (!ok) { WBUI.toast("Could not save the web root", "err"); return; }
                WBUI.toast("Web root updated", "ok");
                refreshSiteState();
            });
        });
    }

    function section(title) {
        return WBUI.el("div", { class: "wb-section" }, [
            WBUI.el("div", { class: "wb-section-title", text: title })
        ]);
    }

    return {
        init: init,
        render: render,
        refreshSiteState: refreshSiteState,
        getSiteState: function () { return siteState; }
    };
})();
