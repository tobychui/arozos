/*
    fileio.js

    Project file handling: new / open / save / save-as, importing a plain HTML
    file into the element tree, and the file-picker helpers used by the
    inspector and the settings panel.

    Native format: .wbsite - the project JSON straight from js/model.js.
    The app also opens .html/.htm so the pages made by the previous version of
    Web Builder (and any hand-written page) can be brought into the builder.
*/

var WBFileIO = (function () {

    var filePath = "";      /* virtual path of the open project file */

    function currentPath() { return filePath; }
    function setPath(p) { filePath = p || ""; }

    function fileName() {
        if (!filePath) { return "untitled.wbsite"; }
        return WBRender.baseName(filePath);
    }

    /* ---------------------------------------------------------- pickers -- */

    function pickMedia(accept, cb, allowMultiple) {
        var opts = {};
        if (accept === "image") { opts.filter = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp"]; }
        else if (accept === "video") { opts.filter = [".mp4", ".webm", ".ogv", ".mov", ".mkv"]; }
        opts.path_memory_key = "media";

        ao_module_openFileSelector(function (files) {
            if (!files || !files.length) { return; }
            var paths = files.map(function (f) { return f.filepath; });
            cb(paths[0], paths);
        }, "user:/", "file", !!allowMultiple, opts);
    }

    /* Choose a file that does not exist yet (the "save as" style picker). */
    function pickNewFile(defaultName, cb, root) {
        ao_module_openFileSelector(function (files) {
            if (!files || !files.length) { return; }
            cb(files[0].filepath);
        }, root || "user:/", "new", false, {
            defaultName: defaultName || "data.csv",
            path_memory_key: "formdata"
        });
    }

    function pickFolder(cb) {
        ao_module_openFileSelector(function (files) {
            if (!files || !files.length) { return; }
            cb(files[0].filepath);
        }, "user:/", "folder", false, { path_memory_key: "folder" });
    }

    /* -------------------------------------------------------- open/save -- */

    function openDialog() {
        ao_module_openFileSelector(function (files) {
            if (!files || !files.length) { return; }
            openPath(files[0].filepath);
        }, "user:/", "file", false, {
            filter: [".wbsite", ".html", ".htm"],
            path_memory_key: "project"
        });
    }

    function openPath(vpath, done) {
        WBUI.busy(true, "Opening " + WBRender.baseName(vpath) + "...");
        ao_module_agirun("Web Builder/backend/load.agi", { filepath: vpath }, function (resp) {
            WBUI.busy(false);
            if (resp && resp.error !== undefined) {
                WBUI.toast(resp.error, "err");
                if (done) { done(false); }
                return;
            }
            var content = typeof resp === "string" ? resp : (resp.content || "");
            try {
                if (/\.html?$/i.test(vpath)) {
                    importHtmlString(content, WBRender.baseName(vpath));
                    filePath = "";                    /* force Save As to a .wbsite */
                    WBUI.toast("Imported " + WBRender.baseName(vpath) + " - save it as a .wbsite project");
                } else {
                    WBModel.loadProject(JSON.parse(content));
                    filePath = vpath;
                }
                if (done) { done(true); }
            } catch (e) {
                WBUI.toast("This file could not be read as a site project", "err");
                console.error(e);
                if (done) { done(false); }
            }
        }, function () {
            WBUI.busy(false);
            WBUI.toast("Server communication error while opening the file", "err");
            if (done) { done(false); }
        });
    }

    function save(done) {
        if (!filePath) { return saveAs(done); }
        writeProject(filePath, done);
    }

    function saveAs(done) {
        var suggested = WBModel.slugify(WBModel.get().name) + ".wbsite";
        ao_module_openFileSelector(function (files) {
            if (!files || !files.length) { return; }
            var p = files[0].filepath;
            if (!/\.wbsite$/i.test(p)) { p = p.replace(/\.[^./]*$/, "") + ".wbsite"; }
            filePath = p;
            writeProject(p, done);
        }, "user:/Desktop", "new", false, {
            defaultName: suggested,
            path_memory_key: "project"
        });
    }

    function writeProject(vpath, done) {
        var json = JSON.stringify(WBModel.get());
        ao_module_agirun("Web Builder/backend/save.agi", {
            filepath: vpath,
            content: json
        }, function (resp) {
            if (resp && resp.error !== undefined) {
                WBUI.toast(resp.error, "err");
                if (done) { done(false); }
                return;
            }
            WBModel.markClean();
            if (done) { done(true); }
        }, function () {
            WBUI.toast("Could not save the project file", "err");
            if (done) { done(false); }
        });
    }

    /* ---------------------------------------------------- HTML importing -- */

    /*
        Convert an HTML document into a page in the current project.
        Anything the builder has no first-class element for is preserved as a
        raw HTML element, so importing never silently loses content.
    */
    function importHtmlString(html, label) {
        var docu = new DOMParser().parseFromString(html, "text/html");
        var name = (docu.title || label || "Imported").replace(/\.html?$/i, "");

        WBModel.newProject(name);
        var project = WBModel.get();
        var page = project.pages[0];
        page.name = name;
        page.title = docu.title || name;
        page.slug = "";
        page.root.children = [];

        /* keep the document's own CSS working by attaching it to the body */
        var styleText = "";
        var styles = docu.querySelectorAll("style");
        for (var i = 0; i < styles.length; i++) { styleText += styles[i].textContent + "\n"; }
        if (styleText.trim()) { page.root.customCss = styleText.trim(); }

        var bodyStyle = docu.body.getAttribute("style");
        if (bodyStyle) {
            var parsed = parseInlineStyle(bodyStyle);
            for (var k in parsed) { page.root.styles.base[k] = parsed[k]; }
        }

        var kids = docu.body.children;
        for (var c = 0; c < kids.length; c++) {
            var node = elementToNode(kids[c]);
            if (node) { page.root.children.push(node); }
        }
        if (!page.root.children.length) {
            page.root.children.push(WBModel.createNode("text", {
                props: { html: docu.body.innerHTML || "Empty document" }
            }));
        }
        WBModel.commit("Import HTML");
        WBModel.markClean();
    }

    var TAG_MAP = {
        h1: "heading", h2: "heading", h3: "heading", h4: "heading",
        h5: "heading", h6: "heading",
        p: "text", blockquote: "text", span: "text", strong: "text", em: "text",
        img: "image", hr: "divider", a: "button", br: null,
        section: "section", header: "section", footer: "section", main: "section",
        article: "section", aside: "section", nav: "container",
        div: "container", form: "form", video: "video", iframe: "embed",
        textarea: "textarea", label: "container", button: "submit"
    };

    var CONTAINER_TYPES = { container: 1, section: 1, form: 1, columns: 1, column: 1 };

    function elementToNode(el) {
        if (el.nodeType !== 1) { return null; }
        var tag = el.tagName.toLowerCase();
        if (tag === "script" || tag === "style" || tag === "link" || tag === "meta") { return null; }

        var type = TAG_MAP[tag];
        if (type === null) { return null; }
        if (type === undefined) {
            /* no first-class element - keep the markup verbatim */
            return WBModel.createNode("html", { props: { code: el.outerHTML } });
        }

        var node = WBModel.createNode(type);
        node.tag = (type === "heading" || type === "text" || type === "section") ? tag : node.tag;

        /* attributes */
        if (el.id) { node.domId = el.id; }
        if (el.className && typeof el.className === "string") { node.classes = el.className; }
        var inline = el.getAttribute("style");
        if (inline) {
            var parsed = parseInlineStyle(inline);
            for (var k in parsed) { node.styles.base[k] = parsed[k]; }
        }

        switch (type) {
        case "heading":
        case "text":
            node.props.html = el.innerHTML;
            return node;
        case "image":
            node.props.src = el.getAttribute("src") || "";
            node.props.alt = el.getAttribute("alt") || "";
            return node;
        case "button":
            node.props.html = el.innerHTML;
            node.props.href = el.getAttribute("href") || "#";
            node.props.target = el.getAttribute("target") || "_self";
            if (!inline) { node.styles.base = { display: "inline-block", color: "#f97316", textDecoration: "none" }; }
            return node;
        case "video":
            node.props.src = el.getAttribute("src") ||
                (el.querySelector("source") ? el.querySelector("source").getAttribute("src") : "");
            node.props.controls = el.hasAttribute("controls");
            return node;
        case "embed":
            node.props.url = el.getAttribute("src") || "";
            return node;
        case "submit":
            node.props.html = el.innerHTML;
            return node;
        case "textarea":
            node.props.label = "";
            node.props.placeholder = el.getAttribute("placeholder") || "";
            return node;
        case "divider":
            return node;
        default:
            break;
        }

        if (CONTAINER_TYPES[type]) {
            if (type === "form") {
                node.props.action = el.getAttribute("action") || "";
                node.props.method = (el.getAttribute("method") || "post").toLowerCase();
            }
            var kids = el.children;
            if (!kids.length && el.textContent.trim()) {
                /* leaf-ish container with text - keep the text */
                var t = WBModel.createNode("text", { props: { html: el.innerHTML } });
                node.children.push(t);
                return node;
            }
            for (var i = 0; i < kids.length; i++) {
                var child = elementToNode(kids[i]);
                if (child) { node.children.push(child); }
            }
            return node;
        }
        return node;
    }

    function parseInlineStyle(text) {
        var out = {};
        String(text).split(";").forEach(function (decl) {
            var idx = decl.indexOf(":");
            if (idx < 0) { return; }
            var prop = decl.slice(0, idx).trim();
            var val = decl.slice(idx + 1).trim();
            if (!prop || !val) { return; }
            var camel = prop.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
            out[camel] = val;
        });
        return out;
    }

    /* Import an HTML file into the current project as a new page. */
    function importHtmlAsPage() {
        ao_module_openFileSelector(function (files) {
            if (!files || !files.length) { return; }
            var vpath = files[0].filepath;
            ao_module_agirun("Web Builder/backend/load.agi", { filepath: vpath }, function (resp) {
                if (resp && resp.error !== undefined) { WBUI.toast(resp.error, "err"); return; }
                var content = typeof resp === "string" ? resp : (resp.content || "");
                var docu = new DOMParser().parseFromString(content, "text/html");
                var name = (docu.title || WBRender.baseName(vpath)).replace(/\.html?$/i, "");
                var page = WBModel.addPage(name, { blank: true });
                page.title = docu.title || name;
                page.root.children = [];
                var kids = docu.body.children;
                for (var c = 0; c < kids.length; c++) {
                    var node = elementToNode(kids[c]);
                    if (node) { page.root.children.push(node); }
                }
                WBModel.commit("Import page");
                WBApp.switchPage(page.id);
                WBUI.toast("Imported as “" + name + "”", "ok");
            });
        }, "user:/", "file", false, { filter: [".html", ".htm"], path_memory_key: "project" });
    }

    return {
        currentPath: currentPath,
        setPath: setPath,
        fileName: fileName,
        pickMedia: pickMedia,
        pickFolder: pickFolder,
        pickNewFile: pickNewFile,
        openDialog: openDialog,
        openPath: openPath,
        save: save,
        saveAs: saveAs,
        importHtmlString: importHtmlString,
        importHtmlAsPage: importHtmlAsPage
    };
})();
