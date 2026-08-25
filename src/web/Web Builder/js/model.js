/*
    model.js

    The project document and every mutation performed on it.

    A project is one JSON object (the .wbsite file):

    {
        version: 1,
        name: "My Website",
        slug: "my-website",              // publish folder under the web root
        settings: { lang, description, author, favicon, webFonts, theme{} },
        pages: [ Page, ... ],
        activePageId: "pg-xxxx"
    }

    Page   = { id, name, slug, parentId, visibility, title, description, root: Node }
    Node   = { id, type, name, tag, props{}, styles{base,tablet,mobile},
               attrs{}, classes, domId, visible{base,tablet,mobile}, locked,
               customCss, children[] }

    Every mutation goes through this module so that undo/redo and the dirty
    flag stay honest. Snapshot-based history is used deliberately: projects are
    small (tens of KB) and a full snapshot can never desync from the tree.
*/

var WBModel = (function () {

    var project = null;
    var history = [];
    var historyIndex = -1;
    var HISTORY_LIMIT = 80;
    var dirty = false;
    var listeners = {};
    var coalesceKey = null;
    var coalesceTimer = null;

    /* ---------------------------------------------------------- utils -- */

    var uidCounter = 0;
    function uid(prefix) {
        uidCounter++;
        return (prefix || "el") + "-" +
            Date.now().toString(36).slice(-4) +
            uidCounter.toString(36) +
            Math.floor(Math.random() * 1296).toString(36);
    }

    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function slugify(s) {
        return String(s || "").toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "page";
    }

    function on(evt, cb) {
        (listeners[evt] = listeners[evt] || []).push(cb);
    }

    function emit(evt, payload) {
        var l = listeners[evt] || [];
        for (var i = 0; i < l.length; i++) {
            try { l[i](payload); } catch (e) { console.error("[wb] listener error", e); }
        }
    }

    /* ------------------------------------------------------- node ctor -- */

    function createNode(type, overrides) {
        var def = wbDef(type);
        var node = {
            id: uid("el"),
            type: type,
            name: "",
            tag: def.tag || "div",
            props: clone(def.props || {}),
            styles: { base: clone(def.styles || {}), tablet: {}, mobile: {} },
            attrs: {},
            classes: "",
            domId: "",
            visible: { base: true, tablet: true, mobile: true },
            locked: false,
            customCss: "",
            children: []
        };

        if (type === "columns") {
            var count = node.props.count || 3;
            for (var i = 0; i < count; i++) {
                node.children.push(createNode("column"));
            }
        }

        if (overrides) {
            for (var k in overrides) {
                if (k === "props" || k === "styles") { continue; }
                node[k] = overrides[k];
            }
            if (overrides.props) {
                for (var p in overrides.props) { node.props[p] = overrides.props[p]; }
            }
            if (overrides.styles) {
                for (var s in overrides.styles) { node.styles.base[s] = overrides.styles[s]; }
            }
        }
        return node;
    }

    /* Build a node tree from the plain seed objects used by WBStarterPage(). */
    function nodeFromSeed(seed) {
        var node = createNode(seed.type, {
            name: seed.name || "",
            props: seed.props,
            styles: seed.styles
        });
        if (seed.props && seed.props.tag) { node.tag = seed.props.tag; }
        /* seeds may carry breakpoint overrides so starter content is responsive */
        if (seed.tablet) { node.styles.tablet = clone(seed.tablet); }
        if (seed.mobile) { node.styles.mobile = clone(seed.mobile); }
        node.children = [];
        var kids = seed.children || [];
        for (var i = 0; i < kids.length; i++) {
            node.children.push(nodeFromSeed(kids[i]));
        }
        return node;
    }

    /* ------------------------------------------------------ page ctor -- */

    function createPage(name, slug, seedChildren) {
        var root = createNode("body");
        root.name = "Body";
        if (seedChildren) {
            for (var i = 0; i < seedChildren.length; i++) {
                root.children.push(nodeFromSeed(seedChildren[i]));
            }
        }
        return {
            id: uid("pg"),
            name: name || "Untitled",
            slug: slug !== undefined ? slug : slugify(name),
            parentId: null,
            visibility: "public",
            title: name || "Untitled",
            description: "",
            root: root
        };
    }

    function newProject(name, opts) {
        name = name || "My Website";
        opts = opts || {};
        var home = createPage("Home", "", opts.blank ? null : WBStarterPage(name));
        home.title = name;
        project = {
            version: 1,
            name: name,
            slug: slugify(name),
            settings: {
                lang: "en",
                description: "",
                author: "",
                favicon: "",
                webFonts: true,
                theme: {
                    accent: "#f97316",
                    text: "#16181d",
                    background: "#ffffff",
                    headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                    bodyFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
                }
            },
            pages: [home],
            activePageId: home.id
        };
        resetHistory();
        dirty = false;
        emit("load", project);
        return project;
    }

    /*
        Accept a project object that came from disk. Older/partial files are
        repaired rather than rejected so a hand-edited .wbsite still opens.
    */
    function loadProject(obj) {
        if (!obj || !obj.pages || !obj.pages.length) {
            throw new Error("Not a valid site project file");
        }
        obj.version = obj.version || 1;
        obj.name = obj.name || "Untitled Site";
        obj.slug = obj.slug || slugify(obj.name);
        obj.settings = obj.settings || {};
        obj.settings.theme = obj.settings.theme || {};
        if (obj.settings.webFonts === undefined) { obj.settings.webFonts = true; }

        for (var i = 0; i < obj.pages.length; i++) {
            var pg = obj.pages[i];
            pg.id = pg.id || uid("pg");
            pg.parentId = pg.parentId || null;
            pg.visibility = pg.visibility || "public";
            pg.root = repairNode(pg.root || createNode("body"));
        }
        if (!obj.activePageId || !pageById(obj.activePageId, obj)) {
            obj.activePageId = obj.pages[0].id;
        }
        project = obj;
        resetHistory();
        dirty = false;
        emit("load", project);
        return project;
    }

    function repairNode(node) {
        if (!node || typeof node !== "object") { return createNode("container"); }
        node.id = node.id || uid("el");
        node.type = node.type || "container";
        node.tag = node.tag || wbDef(node.type).tag || "div";
        node.props = node.props || {};
        node.attrs = node.attrs || {};
        node.classes = node.classes || "";
        node.domId = node.domId || "";
        node.customCss = node.customCss || "";
        node.locked = !!node.locked;
        node.visible = node.visible || { base: true, tablet: true, mobile: true };
        var st = node.styles || {};
        node.styles = { base: st.base || {}, tablet: st.tablet || {}, mobile: st.mobile || {} };
        node.children = node.children || [];
        for (var i = 0; i < node.children.length; i++) {
            node.children[i] = repairNode(node.children[i]);
        }
        return node;
    }

    /* --------------------------------------------------------- lookup -- */

    function get() { return project; }

    function pageById(id, proj) {
        var p = proj || project;
        for (var i = 0; i < p.pages.length; i++) {
            if (p.pages[i].id === id) { return p.pages[i]; }
        }
        return null;
    }

    function activePage() {
        return pageById(project.activePageId) || project.pages[0];
    }

    function childPages(parentId) {
        var out = [];
        for (var i = 0; i < project.pages.length; i++) {
            if ((project.pages[i].parentId || null) === (parentId || null)) {
                out.push(project.pages[i]);
            }
        }
        return out;
    }

    /* Depth-first search inside the active page (or a given root). */
    function findNode(id, root) {
        root = root || activePage().root;
        if (root.id === id) { return root; }
        for (var i = 0; i < root.children.length; i++) {
            var hit = findNode(id, root.children[i]);
            if (hit) { return hit; }
        }
        return null;
    }

    function findParent(id, root) {
        root = root || activePage().root;
        for (var i = 0; i < root.children.length; i++) {
            if (root.children[i].id === id) { return root; }
            var hit = findParent(id, root.children[i]);
            if (hit) { return hit; }
        }
        return null;
    }

    /* Ancestor chain from body down to (and including) the node. */
    function pathTo(id, root, acc) {
        root = root || activePage().root;
        acc = acc || [];
        acc.push(root);
        if (root.id === id) { return acc; }
        for (var i = 0; i < root.children.length; i++) {
            var hit = pathTo(id, root.children[i], acc.slice());
            if (hit) { return hit; }
        }
        return null;
    }

    function isDescendant(ancestorId, nodeId) {
        var a = findNode(ancestorId);
        if (!a) { return false; }
        return !!findNode(nodeId, a) && ancestorId !== nodeId;
    }

    function displayName(node) {
        if (!node) { return ""; }
        if (node.name) { return node.name; }
        return wbDef(node.type).name;
    }

    /* -------------------------------------------------------- history -- */

    function resetHistory() {
        history = [snapshot()];
        historyIndex = 0;
    }

    function snapshot() {
        return JSON.stringify(project);
    }

    /*
        Commit the current state to the undo stack.
        key - when two consecutive commits share a key inside the coalesce
              window they collapse into one entry (used for typing / dragging
              a slider so undo does not step one character at a time).
    */
    function commit(label, key) {
        dirty = true;
        if (key && key === coalesceKey) {
            history[historyIndex] = snapshot();
            restartCoalesce(key);
            emit("change", { label: label, coalesced: true });
            return;
        }
        history = history.slice(0, historyIndex + 1);
        history.push(snapshot());
        if (history.length > HISTORY_LIMIT) { history.shift(); }
        historyIndex = history.length - 1;
        restartCoalesce(key || null);
        emit("change", { label: label });
    }

    function restartCoalesce(key) {
        coalesceKey = key;
        if (coalesceTimer) { clearTimeout(coalesceTimer); }
        if (key) {
            coalesceTimer = setTimeout(function () { coalesceKey = null; }, 700);
        }
    }

    function canUndo() { return historyIndex > 0; }
    function canRedo() { return historyIndex < history.length - 1; }

    function undo() {
        if (!canUndo()) { return false; }
        historyIndex--;
        project = JSON.parse(history[historyIndex]);
        coalesceKey = null;
        dirty = true;
        emit("restore", project);
        return true;
    }

    function redo() {
        if (!canRedo()) { return false; }
        historyIndex++;
        project = JSON.parse(history[historyIndex]);
        coalesceKey = null;
        dirty = true;
        emit("restore", project);
        return true;
    }

    function isDirty() { return dirty; }
    function markClean() { dirty = false; emit("clean"); }

    /* ------------------------------------------------ node mutations -- */

    function insertNode(parentId, node, index) {
        var parent = parentId ? findNode(parentId) : activePage().root;
        if (!parent) { return null; }
        if (!wbIsContainer(parent.type) && parent.type !== "body") { return null; }
        if (index === undefined || index === null || index > parent.children.length) {
            index = parent.children.length;
        }
        parent.children.splice(Math.max(0, index), 0, node);
        return node;
    }

    function removeNode(id) {
        var parent = findParent(id);
        if (!parent) { return false; }
        for (var i = 0; i < parent.children.length; i++) {
            if (parent.children[i].id === id) {
                parent.children.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    function indexOfNode(id) {
        var parent = findParent(id);
        if (!parent) { return -1; }
        for (var i = 0; i < parent.children.length; i++) {
            if (parent.children[i].id === id) { return i; }
        }
        return -1;
    }

    /* Move node into newParentId at index. Refuses to drop a node into itself. */
    function moveNode(id, newParentId, index) {
        if (id === newParentId || isDescendant(id, newParentId)) { return false; }
        var node = findNode(id);
        if (!node) { return false; }
        var oldParent = findParent(id);
        var oldIndex = indexOfNode(id);
        if (!oldParent) { return false; }

        var target = newParentId ? findNode(newParentId) : activePage().root;
        if (!target || (!wbIsContainer(target.type) && target.type !== "body")) { return false; }

        oldParent.children.splice(oldIndex, 1);
        if (oldParent === target && index > oldIndex) { index--; }
        if (index === undefined || index === null || index > target.children.length) {
            index = target.children.length;
        }
        target.children.splice(Math.max(0, index), 0, node);
        return true;
    }

    /* Deep copy with fresh ids so the clone is a genuinely separate subtree. */
    function cloneNode(node) {
        var copy = clone(node);
        (function reid(n) {
            n.id = uid("el");
            if (n.domId) { n.domId = ""; }
            for (var i = 0; i < n.children.length; i++) { reid(n.children[i]); }
        })(copy);
        return copy;
    }

    function duplicateNode(id) {
        var node = findNode(id);
        var parent = findParent(id);
        if (!node || !parent) { return null; }
        var copy = cloneNode(node);
        parent.children.splice(indexOfNode(id) + 1, 0, copy);
        return copy;
    }

    function setProp(id, key, value) {
        var node = findNode(id);
        if (!node) { return; }
        node.props[key] = value;
        if (key === "count" && node.type === "columns") { syncColumns(node); }
    }

    /* Keep a Columns element's child columns in step with its count. */
    function syncColumns(node) {
        var want = Math.max(1, Math.min(6, parseInt(node.props.count, 10) || 1));
        while (node.children.length < want) { node.children.push(createNode("column")); }
        while (node.children.length > want) { node.children.pop(); }
        node.styles.base.gridTemplateColumns = "repeat(" + want + ", 1fr)";
    }

    /*
        Change a node's HTML tag.

        For headings this also re-sizes the element to the default size of the
        new level, because a heading that keeps its old size after being demoted
        is never the intent. Any tablet/mobile font-size overrides are scaled by
        the same ratio so hand-tuned responsive sizes keep their proportions
        instead of being silently thrown away.
    */
    function setTag(id, tag) {
        var node = findNode(id);
        if (!node || !tag) { return; }
        var oldTag = node.tag;
        node.tag = tag;
        if (node.type !== "heading" || oldTag === tag) { return; }
        if (!/^h[1-6]$/.test(tag)) { return; }

        var target = WBHeadingSizes[tag];
        if (!target) { return; }
        var oldBase = parseFloat(node.styles.base.fontSize);
        node.styles.base.fontSize = target + "px";

        if (!(oldBase > 0)) { return; }
        var ratio = target / oldBase;
        ["tablet", "mobile"].forEach(function (bp) {
            var v = node.styles[bp].fontSize;
            if (!v) { return; }
            var num = parseFloat(v);
            if (!(num > 0)) { return; }
            var unit = String(v).replace(/^-?[\d.]+/, "") || "px";
            node.styles[bp].fontSize = (Math.round(num * ratio * 10) / 10) + unit;
        });
    }

    function setStyle(id, key, value, bp) {
        var node = findNode(id);
        if (!node) { return; }
        bp = bp || "base";
        if (value === "" || value === null || value === undefined) {
            delete node.styles[bp][key];
        } else {
            node.styles[bp][key] = value;
        }
    }

    function setStyles(id, obj, bp) {
        for (var k in obj) { setStyle(id, k, obj[k], bp); }
    }

    /* Resolved value for a style at a breakpoint, falling back down the chain. */
    function effectiveStyle(node, key, bp) {
        if (!node) { return undefined; }
        if (bp === "mobile") {
            if (node.styles.mobile[key] !== undefined) { return node.styles.mobile[key]; }
            if (node.styles.tablet[key] !== undefined) { return node.styles.tablet[key]; }
        } else if (bp === "tablet") {
            if (node.styles.tablet[key] !== undefined) { return node.styles.tablet[key]; }
        }
        return node.styles.base[key];
    }

    function hasOwnStyle(node, key, bp) {
        return node && node.styles[bp || "base"][key] !== undefined;
    }

    /* -------------------------------------------------- page mutations -- */

    function addPage(name, opts) {
        opts = opts || {};
        var slug = opts.slug !== undefined ? opts.slug : slugify(name);
        var seed = opts.blank ? null : WBStarterPage(project.name);
        var pg = createPage(name, slug, seed);
        pg.parentId = opts.parentId || null;
        project.pages.push(pg);
        return pg;
    }

    function removePage(id) {
        if (project.pages.length <= 1) { return false; }
        var kids = childPages(id);
        for (var k = 0; k < kids.length; k++) { kids[k].parentId = null; }
        for (var i = 0; i < project.pages.length; i++) {
            if (project.pages[i].id === id) {
                project.pages.splice(i, 1);
                if (project.activePageId === id) { project.activePageId = project.pages[0].id; }
                return true;
            }
        }
        return false;
    }

    function duplicatePage(id) {
        var src = pageById(id);
        if (!src) { return null; }
        var copy = clone(src);
        copy.id = uid("pg");
        copy.name = src.name + " Copy";
        copy.slug = slugify(copy.name);
        copy.root = cloneNode(copy.root);
        project.pages.push(copy);
        return copy;
    }

    function movePage(id, beforeId) {
        var from = -1, to = -1, i;
        for (i = 0; i < project.pages.length; i++) {
            if (project.pages[i].id === id) { from = i; }
            if (project.pages[i].id === beforeId) { to = i; }
        }
        if (from < 0) { return false; }
        var pg = project.pages.splice(from, 1)[0];
        if (to < 0) { project.pages.push(pg); }
        else { project.pages.splice(to > from ? to - 1 : to, 0, pg); }
        return true;
    }

    function setActivePage(id) {
        if (!pageById(id)) { return false; }
        project.activePageId = id;
        emit("pagechange", id);
        return true;
    }

    /*
        File name a page publishes to. The home page (empty slug) becomes
        index.html; everything else becomes <slug>.html.
    */
    function pageFileName(pg) {
        if (!pg.slug || pg.slug === "/" || pg.slug === "index") { return "index.html"; }
        return slugify(pg.slug) + ".html";
    }

    function homePage() {
        for (var i = 0; i < project.pages.length; i++) {
            if (pageFileName(project.pages[i]) === "index.html") { return project.pages[i]; }
        }
        return project.pages[0];
    }

    return {
        uid: uid,
        clone: clone,
        slugify: slugify,
        on: on,
        emit: emit,

        newProject: newProject,
        loadProject: loadProject,
        get: get,

        createNode: createNode,
        nodeFromSeed: nodeFromSeed,
        cloneNode: cloneNode,

        pageById: pageById,
        activePage: activePage,
        childPages: childPages,
        setActivePage: setActivePage,
        addPage: addPage,
        removePage: removePage,
        duplicatePage: duplicatePage,
        movePage: movePage,
        pageFileName: pageFileName,
        homePage: homePage,

        findNode: findNode,
        findParent: findParent,
        pathTo: pathTo,
        indexOfNode: indexOfNode,
        isDescendant: isDescendant,
        displayName: displayName,

        insertNode: insertNode,
        removeNode: removeNode,
        moveNode: moveNode,
        duplicateNode: duplicateNode,
        setProp: setProp,
        setTag: setTag,
        syncColumns: syncColumns,
        setStyle: setStyle,
        setStyles: setStyles,
        effectiveStyle: effectiveStyle,
        hasOwnStyle: hasOwnStyle,

        commit: commit,
        undo: undo,
        redo: redo,
        canUndo: canUndo,
        canRedo: canRedo,
        isDirty: isDirty,
        markClean: markClean
    };
})();
