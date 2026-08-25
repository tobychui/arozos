/*
    render.js

    Turns the project model into HTML and CSS.

    One renderer serves both consumers so that what you see on the canvas is
    what gets published:

      editor mode  - adds data-wb-id hooks, neutralises scripts/links,
                     resolves media through the ArozOS media server
      export mode  - clean markup, media rewritten to relative asset paths

    Style rules are emitted per node as ".wb-<id>", with tablet/mobile layers
    wrapped in max-width media queries.
*/

var WBRender = (function () {

    var MEDIA_PREFIX = "../media?file=";

    /* ---------------------------------------------------------- utils -- */

    function esc(s) {
        return String(s === undefined || s === null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function kebab(prop) {
        return prop.replace(/[A-Z]/g, function (m) { return "-" + m.toLowerCase(); });
    }

    function isVirtualPath(p) {
        return typeof p === "string" && /^[a-zA-Z0-9_-]+:\//.test(p);
    }

    function baseName(p) {
        var s = String(p || "").split("?")[0];
        s = s.substring(s.lastIndexOf("/") + 1);
        return s || "file";
    }

    /* Resolve a media reference for the current output mode. */
    function mediaUrl(src, opts) {
        if (!src) { return ""; }
        if (!isVirtualPath(src)) { return src; }              // already a URL
        if (opts && opts.assetMap && opts.assetMap[src]) { return opts.assetMap[src]; }
        if (opts && opts.mode === "export") { return "assets/" + safeAssetName(src); }
        return MEDIA_PREFIX + encodeURIComponent(src);
    }

    function stripScripts(html) {
        return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/ on[a-z]+\s*=\s*"[^"]*"/gi, "")
            .replace(/ on[a-z]+\s*=\s*'[^']*'/gi, "");
    }

    /* --------------------------------------------------------- styles -- */

    /*
        Style values can embed a media reference - background-image is the
        common one. On export those have to become relative asset paths, or the
        published page would ask a visitor's browser for the owner's private
        ArozOS media endpoint.
    */
    function rewriteMediaInValue(value, opts) {
        if (!opts || !opts.assetMap) { return value; }
        var s = String(value);
        if (s.indexOf("media?file=") < 0) { return s; }
        return s.replace(/(?:\.\.\/)*media\?file=([^"')\s]+)/g, function (whole, enc) {
            var vpath;
            try { vpath = decodeURIComponent(enc); } catch (e) { return whole; }
            return opts.assetMap[vpath] || whole;
        });
    }

    function declBlock(styleObj, opts) {
        var out = [];
        for (var k in styleObj) {
            if (styleObj[k] === "" || styleObj[k] === null || styleObj[k] === undefined) { continue; }
            out.push(kebab(k) + ":" + rewriteMediaInValue(styleObj[k], opts));
        }
        return out.join(";");
    }

    function customCssFor(node, sel) {
        if (!node.customCss) { return ""; }
        var css = node.customCss.trim();
        if (!css) { return ""; }
        if (css.indexOf("&") >= 0) { return css.split("&").join(sel) + "\n"; }
        if (css.indexOf("{") >= 0) { return css + "\n"; }
        return sel + "{" + css + "}\n";
    }

    /*
        Collect the CSS for one node tree into the three breakpoint buckets.
    */
    function collectCss(node, buckets, opts) {
        var sel = ".wb-" + node.id;

        var base = declBlock(node.styles.base, opts);
        if (node.visible && node.visible.base === false) {
            base = base ? base + ";display:none" : "display:none";
        }
        if (base) { buckets.base.push(sel + "{" + base + "}"); }

        var tablet = declBlock(node.styles.tablet, opts);
        if (node.visible && node.visible.tablet === false) {
            tablet = tablet ? tablet + ";display:none" : "display:none";
        }
        if (tablet) { buckets.tablet.push(sel + "{" + tablet + "}"); }

        var mobile = declBlock(node.styles.mobile, opts);
        if (node.visible && node.visible.mobile === false) {
            mobile = mobile ? mobile + ";display:none" : "display:none";
        }
        if (mobile) { buckets.mobile.push(sel + "{" + mobile + "}"); }

        var custom = customCssFor(node, sel);
        if (custom) { buckets.base.push(rewriteMediaInValue(custom, opts)); }

        for (var i = 0; i < node.children.length; i++) {
            collectCss(node.children[i], buckets, opts);
        }
    }

    function pageCss(page, opts) {
        var buckets = { base: [], tablet: [], mobile: [] };
        collectCss(page.root, buckets, opts);
        var out = buckets.base.join("\n");
        if (buckets.tablet.length) {
            out += "\n@media (max-width: 1024px){\n" + buckets.tablet.join("\n") + "\n}";
        }
        if (buckets.mobile.length) {
            out += "\n@media (max-width: 640px){\n" + buckets.mobile.join("\n") + "\n}";
        }
        return out;
    }

    /* Which web fonts are actually referenced anywhere in the project. */
    function usedWebFonts(project) {
        var wanted = {};
        function scanStyles(obj) {
            var f = obj.fontFamily;
            if (!f) { return; }
            for (var i = 0; i < WBFonts.length; i++) {
                if (WBFonts[i].web && f.indexOf(WBFonts[i].name) >= 0) {
                    wanted[WBFonts[i].web] = true;
                }
            }
        }
        function walk(n) {
            scanStyles(n.styles.base); scanStyles(n.styles.tablet); scanStyles(n.styles.mobile);
            for (var i = 0; i < n.children.length; i++) { walk(n.children[i]); }
        }
        for (var p = 0; p < project.pages.length; p++) { walk(project.pages[p].root); }
        var theme = project.settings.theme || {};
        scanStyles({ fontFamily: theme.headingFont });
        scanStyles({ fontFamily: theme.bodyFont });
        return Object.keys(wanted);
    }

    function webFontLink(project) {
        if (!project.settings.webFonts) { return ""; }
        var fams = usedWebFonts(project);
        if (!fams.length) { return ""; }
        var href = "https://fonts.googleapis.com/css2?family=" + fams.join("&family=") + "&display=swap";
        return '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
               '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
               '<link rel="stylesheet" href="' + esc(href) + '">';
    }

    /* Baseline reset shared by the canvas and every published page. */
    function resetCss() {
        return [
            "*,*::before,*::after{box-sizing:border-box}",
            "html{-webkit-text-size-adjust:100%}",
            "body{margin:0;padding:0;min-height:100%;-webkit-font-smoothing:antialiased}",
            "h1,h2,h3,h4,h5,h6,p,figure,blockquote{margin:0}",
            "img,video{max-width:100%}",
            "a{color:inherit}",
            "button,input,textarea,select{font:inherit;color:inherit}",
            "hr{border:0;margin:0}",
            "[hidden]{display:none!important}"
        ].join("\n");
    }

    /* ----------------------------------------------------------- html -- */

    function attrString(node, opts, extra) {
        var cls = ["wb-" + node.id];
        if (node.classes) { cls.push(node.classes.trim()); }
        if (extra && extra.className) { cls.push(extra.className); }

        var out = ' class="' + esc(cls.join(" ")) + '"';
        if (node.domId) { out += ' id="' + esc(node.domId) + '"'; }
        for (var a in node.attrs) {
            if (!a || a === "class" || a === "id" || a === "style") { continue; }
            out += " " + esc(a) + '="' + esc(node.attrs[a]) + '"';
        }
        if (opts.mode === "editor") {
            out += ' data-wb-id="' + esc(node.id) + '"';
            out += ' data-wb-type="' + esc(node.type) + '"';
            if (node.locked) { out += ' data-wb-locked="1"'; }
        }
        if (extra && extra.attrs) { out += extra.attrs; }
        return out;
    }

    function childrenHtml(node, opts) {
        var out = "";
        for (var i = 0; i < node.children.length; i++) {
            out += nodeHtml(node.children[i], opts);
        }
        return out;
    }

    /* Placeholder shown inside an empty container while editing. */
    function emptyHint(node, opts) {
        if (opts.mode !== "editor") { return ""; }
        if (node.children.length) { return ""; }
        return '<div class="wb-empty-slot" data-wb-slot="' + esc(node.id) + '">' +
               '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
               'stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>' +
               '<span>Drag element here</span></div>';
    }

    function iconSvg(name, size) {
        var body = WBIconPaths[name] || WBIconPaths["box"];
        return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            body + '</svg>';
    }

    function nodeHtml(node, opts) {
        opts = opts || { mode: "export" };
        var def = wbDef(node.type);
        var tag = node.tag || def.tag || "div";
        var editor = (opts.mode === "editor");

        switch (node.type) {

        case "body":
            return "<body" + attrString(node, opts) + ">" + childrenHtml(node, opts) + emptyHint(node, opts) + "</body>";

        case "heading":
        case "text":
            return "<" + tag + attrString(node, opts) + ">" +
                   (editor ? stripScripts(node.props.html) : (node.props.html || "")) +
                   "</" + tag + ">";

        case "button": {
            var href = node.props.href || "#";
            var extra = ' href="' + esc(editor ? "javascript:void(0)" : href) + '"';
            if (node.props.target && node.props.target !== "_self") {
                extra += ' target="' + esc(node.props.target) + '"';
                extra += ' rel="noopener"';
            }
            if (editor && node.props.href) { extra += ' data-wb-href="' + esc(node.props.href) + '"'; }
            return "<a" + attrString(node, opts, { attrs: extra }) + ">" +
                   (node.props.html || "") + "</a>";
        }

        case "image": {
            var src = mediaUrl(node.props.src, opts);
            var imgExtra = ' src="' + esc(src) + '" alt="' + esc(node.props.alt || "") + '"';
            if (!src) { imgExtra = ' alt="' + esc(node.props.alt || "") + '"'; }
            if (editor) { imgExtra += ' draggable="false"'; }
            var img = "<img" + attrString(node, opts, {
                attrs: imgExtra,
                className: src ? "" : "wb-img-placeholder"
            }) + ">";
            if (node.props.href && !editor) {
                var t = node.props.target && node.props.target !== "_self"
                    ? ' target="' + esc(node.props.target) + '" rel="noopener"' : "";
                return '<a href="' + esc(node.props.href) + '"' + t + ">" + img + "</a>";
            }
            return img;
        }

        case "divider":
            return "<hr" + attrString(node, opts) + ">";

        case "spacer":
            return "<div" + attrString(node, opts) + "></div>";

        case "columns":
        case "column":
        case "container":
        case "section":
            return "<" + tag + attrString(node, opts) + ">" +
                   childrenHtml(node, opts) + emptyHint(node, opts) + "</" + tag + ">";

        case "form": {
            var fExtra = "";
            var honeypot = "";
            if (editor) {
                fExtra = ' onsubmit="return false"';
            } else if (formUsesFile(node)) {
                /* posts to the collector script generated at publish time */
                fExtra = ' action="' + esc(formEndpoint(node)) + '" method="post"';
                /* a bait field real people never see or fill in */
                honeypot = '<input type="text" name="_hp" tabindex="-1" autocomplete="off"' +
                           ' aria-hidden="true" style="position:absolute;left:-9999px;' +
                           'width:1px;height:1px;opacity:0">';
            } else {
                fExtra = ' action="' + esc(node.props.action || "") + '" method="' +
                         esc(node.props.method || "post") + '"';
            }
            return "<form" + attrString(node, opts, { attrs: fExtra }) + ">" +
                   honeypot + childrenHtml(node, opts) + emptyHint(node, opts) + "</form>";
        }

        case "gallery": {
            var imgs = node.props.images || [];
            var inner = "";
            for (var g = 0; g < imgs.length; g++) {
                var gs = mediaUrl(imgs[g].src || imgs[g], opts);
                inner += '<img src="' + esc(gs) + '" alt="' + esc(imgs[g].alt || "") +
                         '" style="width:100%;aspect-ratio:' + esc(node.props.ratio || "4 / 3") +
                         ';object-fit:cover;border-radius:inherit;display:block"' +
                         (editor ? ' draggable="false"' : "") + ">";
            }
            if (!imgs.length && editor) {
                inner = '<div class="wb-empty-slot" style="grid-column:1/-1">' +
                        "<span>No images yet - add some in the inspector</span></div>";
            }
            return "<div" + attrString(node, opts) + ">" + inner + "</div>";
        }

        case "video": {
            var vExtra = "";
            var vsrc = mediaUrl(node.props.src, opts);
            if (vsrc) { vExtra += ' src="' + esc(vsrc) + '"'; }
            if (node.props.poster) { vExtra += ' poster="' + esc(mediaUrl(node.props.poster, opts)) + '"'; }
            if (node.props.controls) { vExtra += " controls"; }
            if (node.props.loop) { vExtra += " loop"; }
            if (node.props.muted || (editor && node.props.autoplay)) { vExtra += " muted"; }
            if (node.props.autoplay && !editor) { vExtra += " autoplay playsinline"; }
            return "<video" + attrString(node, opts, { attrs: vExtra }) + "></video>";
        }

        case "icon":
            return "<span" + attrString(node, opts) + ">" +
                   iconSvg(node.props.icon || "sparkle", node.props.size || 24) + "</span>";

        case "input": {
            var iAttr = ' type="' + esc(node.props.inputType || "text") + '"' +
                        ' name="' + esc(formFieldName(node)) + '"' +
                        ' placeholder="' + esc(node.props.placeholder || "") + '"' +
                        (node.props.required ? " required" : "");
            return "<label" + attrString(node, opts) + ">" +
                   (node.props.label ? "<span>" + esc(node.props.label) + "</span>" : "") +
                   "<input" + iAttr + ' style="' + esc(WBRender.controlStyle) + '">' +
                   "</label>";
        }

        case "textarea":
            return "<label" + attrString(node, opts) + ">" +
                   (node.props.label ? "<span>" + esc(node.props.label) + "</span>" : "") +
                   '<textarea name="' + esc(formFieldName(node)) + '" rows="' +
                   esc(node.props.rows || 4) + '" placeholder="' + esc(node.props.placeholder || "") + '"' +
                   (node.props.required ? " required" : "") +
                   ' style="' + esc(WBRender.controlStyle) + 'resize:vertical"></textarea>' +
                   "</label>";

        case "checkbox":
            return "<label" + attrString(node, opts) + ">" +
                   '<input type="checkbox" name="' + esc(formFieldName(node)) + '"' +
                   (node.props.checked ? " checked" : "") + ' style="width:16px;height:16px;accent-color:#f97316">' +
                   "<span>" + esc(node.props.label || "") + "</span></label>";

        case "radio": {
            var opts2 = node.props.options || [];
            var rHtml = node.props.label ? "<span>" + esc(node.props.label) + "</span>" : "";
            for (var r = 0; r < opts2.length; r++) {
                rHtml += '<label style="display:flex;align-items:center;gap:8px">' +
                         '<input type="radio" name="' + esc(formFieldName(node)) + '" value="' +
                         esc(opts2[r]) + '" style="width:16px;height:16px;accent-color:#f97316">' +
                         "<span>" + esc(opts2[r]) + "</span></label>";
            }
            return "<div" + attrString(node, opts) + ">" + rHtml + "</div>";
        }

        case "submit":
            return "<button" + attrString(node, opts, {
                attrs: ' type="' + (editor ? "button" : "submit") + '"'
            }) + ">" + (node.props.html || "Send") + "</button>";

        case "map": {
            var lat = parseFloat(node.props.lat) || 0;
            var lng = parseFloat(node.props.lng) || 0;
            var z = parseInt(node.props.zoom, 10) || 13;
            var d = 0.36 / Math.pow(1.6, z - 10);
            var bbox = [lng - d, lat - d * 0.6, lng + d, lat + d * 0.6].join("%2C");
            var mapSrc = "https://www.openstreetmap.org/export/embed.html?bbox=" + bbox +
                         "&layer=mapnik&marker=" + lat + "%2C" + lng;
            return "<div" + attrString(node, opts) + '><iframe src="' + esc(mapSrc) +
                   '" style="width:100%;height:100%;border:0;border-radius:inherit"' +
                   ' loading="lazy" title="' + esc(node.props.label || "Map") + '"></iframe></div>';
        }

        case "embed": {
            var eu = node.props.url || "";
            var eInner = eu
                ? '<iframe src="' + esc(eu) + '" style="width:100%;height:100%;border:0;border-radius:inherit"' +
                  (node.props.allowFullscreen ? " allowfullscreen" : "") + ' loading="lazy"></iframe>'
                : (editor ? '<div class="wb-empty-slot"><span>Set an embed URL in the inspector</span></div>' : "");
            return "<div" + attrString(node, opts) + ">" + eInner + "</div>";
        }

        case "html": {
            var code = node.props.code || "";
            return "<div" + attrString(node, opts) + ">" +
                   (editor ? stripScripts(code) : code) + "</div>";
        }

        default:
            return "<" + tag + attrString(node, opts) + ">" + childrenHtml(node, opts) +
                   emptyHint(node, opts) + "</" + tag + ">";
        }
    }

    /* Inline style applied to generated form controls. */
    var controlStyle = "width:100%;padding:11px 13px;border:1px solid #d1d5db;border-radius:8px;" +
                       "background:#fff;font-size:14px;outline-color:#f97316;";

    /* ------------------------------------------------------------ forms -- */

    /*
        The submitted name of a field.

        Both the exported markup and the generated collector script read the
        name from here, so an unnamed field can never end up with one name in
        the HTML and a different one in the script.
    */
    function formFieldName(node) {
        var explicit = String(node.props.name || "").trim();
        if (explicit) { return explicit; }
        return "field_" + String(node.id).replace(/[^a-z0-9]/gi, "");
    }

    function formFieldLabel(node) {
        return String(node.props.label || "").trim() || formFieldName(node);
    }

    /* Slug identifying one form, used for its script and its default file. */
    function formSlug(node) {
        var base = String(node.props.formName || "form").toLowerCase()
            .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
        if (!base) { base = "form"; }
        return base + "-" + String(node.id).replace(/[^a-z0-9]/gi, "").slice(-5);
    }

    /* Where the published form posts to, relative to the page. */
    function formEndpoint(node) {
        return "forms/" + formSlug(node) + ".agi";
    }

    /* Every input-like descendant of a form, in document order. */
    function collectFormFields(node, acc) {
        acc = acc || [];
        var t = node.type;
        if (t === "input" || t === "textarea" || t === "checkbox" || t === "radio") {
            acc.push(node);
        }
        for (var i = 0; i < node.children.length; i++) {
            collectFormFields(node.children[i], acc);
        }
        return acc;
    }

    function formUsesFile(node) {
        return node.type === "form" && (node.props.mode || "csv") === "csv";
    }

    /* ------------------------------------------------- editor helpers -- */

    function editorCss() {
        return [
            ".wb-empty-slot{display:flex;align-items:center;justify-content:center;gap:7px;",
            "min-height:78px;width:100%;border:1.5px dashed #d4d7de;border-radius:8px;color:#9aa1ad;",
            "font:500 12.5px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fbfbfc;}",
            ".wb-img-placeholder{display:block;width:100%;min-height:150px;background:",
            "repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#e9ebef 10px,#e9ebef 20px);}",
            "[data-wb-locked='1']{cursor:not-allowed}",
            "video,iframe{pointer-events:none}",
            "body{cursor:default}",
            "[data-wb-editing='1']{outline:none;cursor:text}",
            "::selection{background:rgba(249,115,22,0.24)}"
        ].join("");
    }

    /* Full document string for the editing iframe. */
    function canvasDocument(project, page) {
        var opts = { mode: "editor" };
        return "<!DOCTYPE html><html lang=\"" + esc(project.settings.lang || "en") + "\"><head>" +
            '<meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">' +
            "<title>" + esc(page.title || page.name) + "</title>" +
            webFontLink(project) +
            "<style>" + resetCss() + "</style>" +
            '<style id="wb-page-style">' + pageCss(page) + "</style>" +
            '<style id="wb-editor-style">' + editorCss() + "</style>" +
            "</head>" + nodeHtml(page.root, opts) + "</html>";
    }

    /* ------------------------------------------------------- exporting -- */

    /* The site-wide stylesheet: reset plus every page's rules. */
    function siteCss(project, assetMap) {
        var opts = { assetMap: assetMap || {} };
        var out = resetCss() + "\n\n";
        for (var i = 0; i < project.pages.length; i++) {
            out += "/* " + project.pages[i].name.replace(/\*\//g, "") + " */\n";
            out += pageCss(project.pages[i], opts) + "\n\n";
        }
        return out;
    }

    /* One published page. assetMap maps virtual paths to relative asset urls. */
    function pageHtml(project, page, assetMap) {
        var opts = { mode: "export", assetMap: assetMap || {} };
        var s = project.settings || {};
        var head = "";
        head += '<meta charset="utf-8">\n';
        head += '<meta name="viewport" content="width=device-width, initial-scale=1">\n';
        head += "<title>" + esc(page.title || page.name || project.name) + "</title>\n";
        if (page.description || s.description) {
            head += '<meta name="description" content="' + esc(page.description || s.description) + '">\n';
        }
        if (s.author) { head += '<meta name="author" content="' + esc(s.author) + '">\n'; }
        head += '<meta name="generator" content="ArozOS Site Builder">\n';
        if (s.favicon) {
            head += '<link rel="icon" href="' + esc(mediaUrl(s.favicon, opts)) + '">\n';
        }
        var fonts = webFontLink(project);
        if (fonts) { head += fonts + "\n"; }
        head += '<link rel="stylesheet" href="assets/site.css">\n';

        return "<!DOCTYPE html>\n<html lang=\"" + esc(s.lang || "en") + "\">\n<head>\n" + head +
            "</head>\n" + nodeHtml(page.root, opts) + "\n</html>\n";
    }

    /*
        Every virtual path the project references, for asset copying.
        Scans element props *and* style values, so a background image set on a
        section is published just like an Image element.
    */
    function collectAssets(project) {
        var found = {};
        function add(p) { if (isVirtualPath(p)) { found[p] = true; } }

        /* pull "user:/..." back out of a "../media?file=..." style value */
        function scanStyleValues(styleObj) {
            for (var k in styleObj) {
                var v = String(styleObj[k] || "");
                if (v.indexOf("media?file=") < 0) { continue; }
                var re = /(?:\.\.\/)*media\?file=([^"')\s]+)/g;
                var m;
                while ((m = re.exec(v)) !== null) {
                    try { add(decodeURIComponent(m[1])); } catch (e) { /* skip */ }
                }
            }
        }

        function walk(n) {
            add(n.props.src);
            add(n.props.poster);
            var imgs = n.props.images || [];
            for (var i = 0; i < imgs.length; i++) { add(imgs[i].src || imgs[i]); }
            scanStyleValues(n.styles.base);
            scanStyleValues(n.styles.tablet);
            scanStyleValues(n.styles.mobile);
            for (var c = 0; c < n.children.length; c++) { walk(n.children[c]); }
        }
        for (var p = 0; p < project.pages.length; p++) { walk(project.pages[p].root); }
        add(project.settings.favicon);
        return Object.keys(found);
    }

    /* A file name that is safe in a URL and on every target file system. */
    function safeAssetName(vpath) {
        var name = baseName(vpath);
        var ext = "";
        var dot = name.lastIndexOf(".");
        if (dot > 0) {
            ext = name.substring(dot).replace(/[^A-Za-z0-9.]/g, "");
            name = name.substring(0, dot);
        }
        name = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
        if (name.length > 60) { name = name.substring(0, 60); }
        if (!name) { name = "asset"; }
        return name + ext;
    }

    /*
        Decide, once, what every referenced file will be called inside the
        published assets folder. Both the markup rewriting and the actual file
        copy read from this plan, so the two can never disagree - which is what
        makes the difference between a working image and a broken one.

        Returns { plan: [{ vpath, name }], map: { vpath: "assets/name" } }
    */
    function buildAssetPlan(project) {
        var assets = collectAssets(project);
        var used = {};
        var plan = [];
        var map = {};

        for (var i = 0; i < assets.length; i++) {
            var vpath = assets[i];
            var name = safeAssetName(vpath);
            if (used[name.toLowerCase()]) {
                var dot = name.lastIndexOf(".");
                var stem = dot > 0 ? name.substring(0, dot) : name;
                var ext = dot > 0 ? name.substring(dot) : "";
                var n = 2;
                while (used[(stem + "-" + n + ext).toLowerCase()]) { n++; }
                name = stem + "-" + n + ext;
            }
            used[name.toLowerCase()] = true;
            plan.push({ vpath: vpath, name: name });
            map[vpath] = "assets/" + name;
        }
        return { plan: plan, map: map };
    }

    return {
        esc: esc,
        kebab: kebab,
        mediaUrl: mediaUrl,
        isVirtualPath: isVirtualPath,
        baseName: baseName,
        iconSvg: iconSvg,
        controlStyle: controlStyle,
        pageCss: pageCss,
        siteCss: siteCss,
        resetCss: resetCss,
        nodeHtml: nodeHtml,
        canvasDocument: canvasDocument,
        pageHtml: pageHtml,
        collectAssets: collectAssets,
        formFieldName: formFieldName,
        formFieldLabel: formFieldLabel,
        formSlug: formSlug,
        formEndpoint: formEndpoint,
        collectFormFields: collectFormFields,
        formUsesFile: formUsesFile,
        safeAssetName: safeAssetName,
        buildAssetPlan: buildAssetPlan
    };
})();
