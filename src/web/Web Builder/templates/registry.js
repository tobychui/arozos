/*
    templates/registry.js

    Registry for the starter templates offered by New Site.

    Each templates/t-*.js file calls WBTemplates.register() with:

    {
        id, name, category, tagline,
        theme:  a WBTemplateKit.theme() object,
        pages:  [ { name, slug, title, description, build(ctx) -> [seeds] } ]
    }

    `build` receives a context with the site name, the theme and - importantly -
    link(pageName), which resolves to the published file name of another page in
    the same template. That is what makes every template arrive with its
    navigation already wired up instead of a page full of "#" links.
*/

var WBTemplates = (function () {

    var list = [];

    function register(tpl) {
        if (!tpl || !tpl.id) { return; }
        list.push(tpl);
    }

    function all() { return list.slice(); }

    function get(id) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) { return list[i]; }
        }
        return null;
    }

    function categories() {
        var seen = {};
        var out = [];
        list.forEach(function (t) {
            var c = t.category || "Other";
            if (!seen[c]) { seen[c] = true; out.push(c); }
        });
        return out.sort();
    }

    /* File name a template page will publish to. */
    function fileNameOf(page) {
        if (!page.slug || page.slug === "/" || page.slug === "index") { return "index.html"; }
        return WBModel.slugify(page.slug) + ".html";
    }

    /*
        Build a complete project object from a template WITHOUT installing it.
        Used both by New Site and by the gallery, which renders a live
        miniature of the home page as each card's thumbnail.
    */
    function buildProject(tpl, siteName) {
        siteName = siteName || tpl.name;
        var t = tpl.theme;

        /* resolve page-name -> published file name up front */
        var links = {};
        tpl.pages.forEach(function (p) { links[p.name] = fileNameOf(p); });

        var project = {
            version: 1,
            name: siteName,
            slug: WBModel.slugify(siteName),
            settings: {
                lang: "en",
                description: tpl.tagline || "",
                author: "",
                favicon: "",
                webFonts: true,
                theme: {
                    accent: t.accent,
                    text: t.text,
                    background: t.bg,
                    headingFont: t.headingFont,
                    bodyFont: t.bodyFont
                }
            },
            pages: [],
            activePageId: null
        };

        tpl.pages.forEach(function (pageDef) {
            var ctx = {
                site: siteName,
                theme: t,
                page: pageDef.name,
                link: function (name) { return links[name] || "#"; },
                links: links
            };

            var root = WBModel.createNode("body");
            root.name = "Body";
            root.styles.base = {
                fontFamily: t.bodyFont,
                color: t.text,
                backgroundColor: t.bg
            };

            var seeds = pageDef.build(ctx) || [];
            seeds.forEach(function (seed) {
                root.children.push(WBModel.nodeFromSeed(seed));
            });

            project.pages.push({
                id: WBModel.uid("pg"),
                name: pageDef.name,
                slug: pageDef.slug === undefined ? WBModel.slugify(pageDef.name) : pageDef.slug,
                parentId: null,
                visibility: "public",
                title: pageDef.title || (pageDef.name + " - " + siteName),
                description: pageDef.description || "",
                root: root
            });
        });

        project.activePageId = project.pages[0].id;
        return project;
    }

    /* Standalone HTML for one template's home page, for the gallery preview. */
    function previewDocument(tpl) {
        var project = buildProject(tpl, tpl.name);
        var page = project.pages[0];
        return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
            "<style>" + WBRender.resetCss() + "\n" + WBRender.pageCss(page) + "</style>" +
            "</head>" + WBRender.nodeHtml(page.root, { mode: "preview" }) + "</html>";
    }

    return {
        register: register,
        all: all,
        get: get,
        categories: categories,
        buildProject: buildProject,
        previewDocument: previewDocument,
        fileNameOf: fileNameOf
    };
})();
