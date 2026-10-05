/*
    ArozOS Office - the ribbon (common/ribbon.js)
    =============================================
    OfficeRibbon turns the app's #toolbar into an Office-style ribbon: tabs
    in the title bar (built by office.js), and under them one panel per tab
    made of groups of controls - two rows of small buttons, a big button
    with its label underneath, a stack of labelled buttons, or a gallery.

        var R = OfficeRibbon;
        var home = R.tab("home", "Home");
        var g = home.group({ id: "font", label: "Font", icon: "font" });
        g.row([$fontSelect, R.button({ icon: "bold", title: "Bold", key: "Ctrl+B",
                                      cmd: "bold", onClick: fn })]);
        g.row([...]);
        home.group({ id: "clip", label: "Clipboard", icon: "paste" })
            .add(R.big({ icon: "paste", label: "Paste", onClick: fn, menu: fn }))
            .stack([R.button({ icon: "cut", label: "Cut", showLabel: true, onClick: fn }), ...]);

    Three widths, one DOM:

    - wide: every group shows its controls.
    - narrower than the panel: galleries give up tiles first, then whole
      groups fold into a button of their own (lowest priority first, then
      from the right) that opens the group's controls in a popup below it -
      the controls are moved there, not copied, so ids and handlers stay.
    - phone (body.of-narrow): the panel is one row that scrolls sideways,
      big buttons shrink to icons, galleries and anything marked
      mobile:false are left out, and the tab strip becomes one picker.

    State: a control may carry active(), enabled() and visible() functions
    and a tab may carry when(); refresh() re-reads them all (office.js calls
    it from OfficeApp.updateMenus(), and apps call it on selection change).
    Apps can still toggle .active on their own ids as before.

    Menus opened from the ribbon are ordinary OfficeApp.showContextMenu
    item lists (see CONTRACT.md for the item shape).
*/
var OfficeRibbon = (function () {
    "use strict";

    var tabs = [];              // [{id,title,when,contextual,$btn,$panel,groups}]
    var activeId = null;
    var $host = null;           // #toolbar
    var $strip = null;          // tab buttons, in the title bar
    var $picker = null;         // the phone-width tab picker button
    var tracked = [];           // controls with active/enabled/visible fns
    var galleries = [];
    var popup = null;           // { group, $pop } while a folded group is open
    var narrow = false;
    var NARROW_PX = 600;
    var fitTimer = null;

    function esc(t) {
        if (t === undefined || t === null) return "";
        return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function call(fn, dflt) {
        if (typeof fn !== "function") return dflt;
        try { return fn(); } catch (e) { return dflt; }
    }
    function evalItems(m) { return (typeof m === "function") ? m() : (m || []); }
    function keepFocus(e) { e.preventDefault(); }
    function rectOf(el) { return el.getBoundingClientRect(); }

    /* ================= host ================= */
    function host() {
        if (!$host) {
            $host = $("#toolbar");
            if (!$host.length) $host = $('<div class="of-toolbar of-noprint" id="toolbar"></div>').prependTo("body");
            $host.addClass("of-ribbon").empty();
            watchWidth();
        }
        return $host;
    }
    function hasTabs() { return tabs.length > 0; }

    /* ================= tabs ================= */
    function findTab(id) {
        for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
        return null;
    }
    function tab(id, title, opts) {
        var t = findTab(id);
        if (t) return t.api;
        opts = opts || {};
        t = {
            id: id, title: title, when: opts.when || null,
            contextual: !!opts.contextual, groups: [], $btn: null,
            $panel: $('<div class="of-rb-panel"></div>').attr("data-tab", id)
        };
        host().append(t.$panel);
        t.api = {
            id: id,
            group: function (gopts) { return group(t, gopts || {}); },
            select: function () { select(id); }
        };
        tabs.push(t);
        if ($strip) addTabButton(t);
        if (!activeId && !t.when) select(id);
        else t.$panel.hide();
        return t.api;
    }
    function tabVisible(t) { return !t.when || !!call(t.when, false); }
    function addTabButton(t) {
        var $b = $('<button type="button" class="of-rb-tab"></button>').text(t.title)
            .attr("data-tab", t.id);
        if (t.contextual) $b.addClass("of-rb-ctx");
        $b.on("mousedown", keepFocus);
        $b.on("click", function () {
            if (window.OfficeApp) OfficeApp.closeAllMenus();
            if ($("body").hasClass("of-rb-min")) {
                // a minimized ribbon shows the tab over the document until
                // the next click elsewhere
                select(t.id);
                peek(true);
                return;
            }
            select(t.id);
        });
        $b.on("dblclick", function () { setMinimized(!$("body").hasClass("of-rb-min")); });
        if (t.when && !tabVisible(t)) $b.hide();
        if (t.id === activeId) $b.addClass("active");
        t.$btn = $b;
        if ($picker) $b.insertBefore($picker); else $strip.append($b);
        // one more tab: the title bar may have to close up
        scheduleFit();
    }
    /* office.js hands over the title bar's tab container once it exists */
    function attachStrip($el) {
        $strip = $el;
        $picker = $('<button type="button" class="of-rb-tabpick" title="Ribbon tab"></button>');
        $picker.on("mousedown", keepFocus);
        $picker.on("click", function () {
            if (window.OfficeApp) OfficeApp.closeAllMenus();
            var r = rectOf($picker[0]);
            OfficeApp.showContextMenu(r.left, r.bottom + 2, tabs.filter(tabVisible).map(function (t) {
                return {
                    label: t.title,
                    checked: t.id === activeId,
                    action: function () { select(t.id); }
                };
            }));
        });
        $strip.append($picker);
        tabs.forEach(addTabButton);
        updatePicker();
    }
    function updatePicker() {
        var t = findTab(activeId);
        if ($picker) $picker.html(esc(t ? t.title : "Menu") + ' <i class="caret down icon"></i>');
    }
    function select(id) {
        var t = findTab(id);
        if (!t) return;
        closePopup();
        activeId = id;
        tabs.forEach(function (x) {
            x.$panel.toggle(x.id === id);
            if (x.$btn) x.$btn.toggleClass("active", x.id === id);
        });
        updatePicker();
        refresh();
        fit();
    }
    function activeTab() { return activeId; }

    /* ================= minimized ribbon ================= */
    function setMinimized(on) {
        peek(false);
        $("body").toggleClass("of-rb-min", !!on);
        try { OfficeApp.setSetting("ribbonMin", !!on); } catch (e) { }
        $(".of-rb-mintoggle i.icon").attr("class", (on ? "chevron down" : "chevron up") + " icon");
        $(".of-rb-mintoggle").attr("title", on ? "Show the ribbon" : "Collapse the ribbon");
        // the editing area just changed height: let the app lay out again
        try { window.dispatchEvent(new Event("resize")); } catch (e) { }
        if (!on) fit();
    }
    function isMinimized() { return $("body").hasClass("of-rb-min"); }
    function peek(on) {
        $("body").toggleClass("of-rb-peek", !!on);
        $(document).off("mousedown.ofrbpeek");
        if (!on) return;
        fit();
        setTimeout(function () {
            $(document).on("mousedown.ofrbpeek", function (e) {
                var t = e.target;
                if ($(t).closest(".of-ribbon, .of-rb-tab, .of-context-menu, .of-cp-panel, .of-rb-popup, .of-dialog-overlay").length) return;
                peek(false);
            });
        }, 0);
    }

    /* ================= groups ================= */
    function group(t, o) {
        var g = {
            id: o.id || ("g" + t.groups.length), label: o.label || "", icon: o.icon || "",
            priority: o.priority || 0, order: t.groups.length,
            collapsible: o.collapse !== false, $col: null
        };
        g.$el = $('<div class="of-rb-group"></div>').attr("data-group", g.id);
        if (o.mobile === false) g.$el.attr("data-mobile", "hide");
        g.$body = $('<div class="of-rb-gbody"></div>');
        var gicon = (o.svg && window.OfficeIcons && OfficeIcons.has(o.svg)) ? OfficeIcons.get(o.svg) :
            (g.icon ? '<i class="' + esc(g.icon) + ' icon"></i>' : "");
        g.$gbtn = $('<button type="button" class="of-rb-gbtn"></button>')
            .attr("title", g.label)
            .append(gicon)
            .append('<span class="of-rb-gbtnlbl">' + esc(g.label) + ' <i class="caret down icon"></i></span>');
        g.$gbtn.on("mousedown", keepFocus);
        g.$gbtn.on("click", function () {
            if (popup && popup.group === g) closePopup(); else openPopup(g);
        });
        g.$el.append(g.$body).append(g.$gbtn);
        t.$panel.append(g.$el);
        t.groups.push(g);

        var api = {
            $el: g.$el,
            // one line of small controls; consecutive rows stack in a column
            row: function (items) {
                if (!g.$col) {
                    g.$col = $('<div class="of-rb-rows"></div>');
                    g.$body.append(g.$col);
                }
                var $r = $('<div class="of-rb-row"></div>');
                appendItems($r, items);
                g.$col.append($r);
                return api;
            },
            // up to three labelled small buttons, one under the other
            stack: function (items) {
                g.$col = null;
                var $s = $('<div class="of-rb-stack"></div>');
                appendItems($s, items);
                g.$body.append($s);
                return api;
            },
            // anything else, as a column of its own (a big button, a gallery)
            add: function (el) {
                g.$col = null;
                appendItems(g.$body, [el]);
                return api;
            }
        };
        return api;
    }
    function appendItems($to, items) {
        (items || []).forEach(function (it) {
            if (!it) return;
            if (it === "|") { $to.append('<span class="of-rb-vsep"></span>'); return; }
            $to.append(it);
        });
    }

    /* ---------- folded groups ---------- */
    function openPopup(g) {
        closePopup();
        var $pop = $('<div class="of-rb-popup of-noprint"></div>');
        $pop.append(g.$body);
        $("body").append($pop);
        var r = rectOf(g.$gbtn[0]);
        var w = $pop.outerWidth(), h = $pop.outerHeight();
        var x = Math.max(4, Math.min(r.left, window.innerWidth - w - 4));
        var y = r.bottom + 2;
        if (y + h > window.innerHeight - 4) y = Math.max(4, window.innerHeight - h - 4);
        $pop.css({ left: x + "px", top: y + "px" });
        g.$gbtn.addClass("open");
        popup = { group: g, $pop: $pop };
        refresh();
        setTimeout(function () {
            $(document).on("mousedown.ofrbpop", function (e) {
                if (!popup) return;
                if (popup.$pop[0].contains(e.target) || popup.group.$gbtn[0].contains(e.target)) return;
                // a menu, colour picker or dialog opened from inside the popup
                // belongs to it
                if ($(e.target).closest(".of-context-menu, .of-cp-panel, .of-dialog-overlay").length) return;
                closePopup();
            });
        }, 0);
    }
    function closePopup() {
        $(document).off("mousedown.ofrbpop");
        if (!popup) return;
        var g = popup.group;
        g.$el.prepend(g.$body);
        g.$gbtn.removeClass("open");
        popup.$pop.remove();
        popup = null;
    }
    // a command inside a folded group's popup closes it, as in Office
    function afterCommand(el, keep) {
        if (keep || !popup) return;
        if (popup.$pop[0].contains(el)) closePopup();
    }

    /* ================= fitting ================= */
    function watchWidth() {
        var apply = function () {
            var n = window.innerWidth <= NARROW_PX;
            if (n !== narrow) {
                narrow = n;
                $("body").toggleClass("of-narrow", narrow);
                closePopup();
            }
            scheduleFit();
        };
        $(window).on("resize.ofribbon", apply);
        narrow = window.innerWidth <= NARROW_PX;
        $("body").toggleClass("of-narrow", narrow);
    }
    function isNarrow() { return narrow; }
    function scheduleFit() {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(fit, 30);
    }
    /* The title bar must show every tab: when they do not fit beside the
       quick access buttons, the tabs first close up and the AutoSave label
       goes, then the strip turns into the one-button tab picker a phone
       uses. Overflow is measured on the last item of the bar, which is
       pushed past its right edge (the bar cannot clip: the File menu drops
       out of it). */
    function fitStrip() {
        if (!$strip) return;
        var $body = $("body");
        $body.removeClass("of-tb-tight of-tb-pick");
        if (narrow) return;
        var bar = $strip.closest(".of-titlebar")[0];
        if (!bar || !bar.offsetParent) return;
        var over = function () {
            var kids = $(bar).children().filter(function () { return this.offsetWidth > 0; });
            if (!kids.length) return false;
            var right = bar.getBoundingClientRect().right - 2;
            return kids[kids.length - 1].getBoundingClientRect().right > right;
        };
        if (!over()) return;
        $body.addClass("of-tb-tight");
        if (!over()) return;
        $body.addClass("of-tb-pick");
    }
    /* Make the active panel fit: galleries first give up tiles, then whole
       groups fold into buttons - lowest priority first, the rightmost of
       equals first. A phone-width panel scrolls instead. */
    function fit() {
        fitStrip();
        var t = findTab(activeId);
        if (!t || !$host) return;
        closePopup();
        var panel = t.$panel[0];
        t.groups.forEach(function (g) { g.$el.removeClass("of-rb-collapsed"); });
        galleries.forEach(function (gl) {
            if (t.$panel[0].contains(gl.$el[0])) setGalleryCount(gl, gl.max);
        });
        if (narrow || !panel.offsetParent) return;
        var avail = function () { return $host[0].clientWidth - 2; };
        var over = function () { return panel.scrollWidth > avail(); };
        if (!over()) return;
        var gls = galleries.filter(function (gl) { return panel.contains(gl.$el[0]); });
        var shrunk = true;
        while (over() && shrunk) {
            shrunk = false;
            for (var i = 0; i < gls.length && over(); i++) {
                if (gls[i].count > gls[i].min) {
                    setGalleryCount(gls[i], gls[i].count - 1);
                    shrunk = true;
                }
            }
        }
        if (!over()) return;
        var order = t.groups.filter(function (g) {
            return g.collapsible && g.$el.is(":visible");
        }).sort(function (a, b) {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.order - a.order;
        });
        for (var k = 0; k < order.length && over(); k++) {
            order[k].$el.addClass("of-rb-collapsed");
        }
    }

    /* ================= state ================= */
    function track($el, o) {
        if (o.active || o.enabled || o.visible) tracked.push({ $el: $el, o: o });
    }
    function refresh() {
        var relayout = false;
        tabs.forEach(function (t) {
            if (!t.when || !t.$btn) return;
            var on = tabVisible(t);
            if (on !== (t.$btn.css("display") !== "none")) {
                t.$btn.toggle(on);
                relayout = true;
            }
            if (!on && t.id === activeId) {
                var first = null;
                tabs.forEach(function (x) { if (!first && tabVisible(x)) first = x; });
                if (first) select(first.id);
            }
        });
        tracked.forEach(function (c) {
            var o = c.o;
            if (o.visible) {
                var v = !!call(o.visible, true);
                if (v !== (c.$el.css("display") !== "none")) { c.$el.toggle(v); relayout = true; }
            }
            if (o.active) c.$el.toggleClass("active", !!call(o.active, false));
            if (o.enabled) {
                var en = !!call(o.enabled, true);
                var $btns = c.$el.is("button") ? c.$el : c.$el.find("button");
                $btns.prop("disabled", !en);
                c.$el.toggleClass("of-rb-disabled", !en);
            }
        });
        galleries.forEach(function (gl) {
            gl.tiles.forEach(function (tile) {
                if (tile.it.active) tile.$el.toggleClass("active", !!call(tile.it.active, false));
            });
        });
        if (relayout) scheduleFit();
    }

    /* ================= controls ================= */
    function iconHtml(o) {
        if (o.iconHtml) return o.iconHtml;
        // o.svg: one of the drawn icons in common/icons.js
        if (o.svg && window.OfficeIcons && OfficeIcons.has(o.svg)) return OfficeIcons.get(o.svg);
        if (o.icon) return '<i class="' + esc(o.icon) + ' icon"></i>';
        if (o.text) return '<span class="of-rb-txt">' + esc(o.text) + "</span>";
        return "";
    }
    function tip(o) {
        var t = o.title || o.label || "";
        if (o.key) t += " (" + o.key + ")";
        return t;
    }
    function common($b, o) {
        if (o.id) $b.attr("id", o.id);
        if (o.cmd) $b.attr("data-cmd", o.cmd);
        if (o.cls) $b.addClass(o.cls);
        if (o.mobile === false) $b.attr("data-mobile", "hide");
        if (o.desktop === false) $b.attr("data-desktop", "hide");
        $b.attr("title", tip(o));
        track($b, o);
    }
    /* A small button: an icon, or an icon and its label (showLabel). */
    function button(o) {
        var $b = $('<button type="button" class="of-tbtn of-rb-btn"></button>');
        $b.append(iconHtml(o));
        if (o.label && o.showLabel) {
            $b.addClass("of-rb-withlabel").append('<span class="of-rb-lbl">' + esc(o.label) + "</span>");
        }
        common($b, o);
        if (o.keepFocus !== false) $b.on("mousedown", keepFocus);
        $b.on("click", function (e) {
            if (o.onClick) o.onClick.call(this, e);
            afterCommand(this, o.keepOpen);
        });
        return $b;
    }
    function openMenuAt(el, o) {
        var r = rectOf(el);
        if (o.onOpen) { o.onOpen(el, r); return; }
        OfficeApp.showContextMenu(r.left, r.bottom + 2, evalItems(o.menu));
    }
    /* A small button that opens a menu (or o.onOpen(anchor, rect)). */
    function dropdown(o) {
        var $b = $('<button type="button" class="of-tbtn of-rb-btn of-rb-dd"></button>');
        $b.append(iconHtml(o));
        if (o.label && o.showLabel) {
            $b.addClass("of-rb-withlabel").append('<span class="of-rb-lbl">' + esc(o.label) + "</span>");
        }
        $b.append('<i class="caret down icon of-rb-caret"></i>');
        common($b, o);
        if (o.keepFocus !== false) $b.on("mousedown", keepFocus);
        $b.on("click", function () { openMenuAt(this, o); });
        return $b;
    }
    /* A small split button: the face runs onClick, the caret opens a menu. */
    function split(o) {
        var $w = $('<span class="of-rb-split"></span>');
        var face = {};
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) face[k] = o[k];
        delete face.menu;
        var $main = button(face);
        var $car = $('<button type="button" class="of-tbtn of-rb-btn of-rb-caretbtn"><i class="caret down icon"></i></button>')
            .attr("title", o.menuTitle || tip(o));
        $car.on("mousedown", keepFocus);
        $car.on("click", function () { openMenuAt($w[0], o); });
        if (o.mobile === false) $w.attr("data-mobile", "hide");
        $w.append($main).append($car);
        return $w;
    }
    /* A big button: icon over label. With a menu (or onOpen) and no
       onClick the whole button opens the menu. With both it is two
       buttons, as in Office: the icon runs the command, the label under it
       (with the caret) opens the menu - two targets, never one button
       whose halves behave differently. */
    function big(o) {
        if (o.onClick && (o.menu || o.onOpen)) return bigSplit(o);
        var $b = $('<button type="button" class="of-rb-big"></button>');
        $b.append('<span class="of-rb-bigicon">' + iconHtml(o) + "</span>");
        var $lbl = $('<span class="of-rb-biglbl"></span>').text(o.label || "");
        if (o.menu || o.onOpen) $lbl.append(' <i class="caret down icon"></i>');
        $b.append($lbl);
        common($b, o);
        if (o.keepFocus !== false) $b.on("mousedown", keepFocus);
        $b.on("click", function (e) {
            var hasMenu = !!(o.menu || o.onOpen);
            if (hasMenu && (!o.onClick || $(e.target).closest(".of-rb-biglbl").length)) {
                openMenuAt(this, o);
                return;
            }
            if (o.onClick) o.onClick.call(this, e);
            afterCommand(this, o.keepOpen);
        });
        return $b;
    }
    function bigSplit(o) {
        var $w = $('<span class="of-rb-bigsplit"></span>');
        var $top = $('<button type="button" class="of-rb-bigtop"></button>')
            .attr("title", tip(o))
            .append('<span class="of-rb-bigicon">' + iconHtml(o) + "</span>");
        var $bot = $('<button type="button" class="of-rb-bigbot"></button>')
            .attr("title", o.menuTitle || ((o.label || "") + " - more options"))
            .append($('<span class="of-rb-biglbl"></span>').text(o.label || ""))
            .append('<i class="caret down icon"></i>');
        if (o.id) $top.attr("id", o.id);
        if (o.cmd) $top.attr("data-cmd", o.cmd);
        if (o.cls) $w.addClass(o.cls);
        if (o.mobile === false) $w.attr("data-mobile", "hide");
        if (o.desktop === false) $w.attr("data-desktop", "hide");
        track($w, o);
        if (o.keepFocus !== false) {
            $top.on("mousedown", keepFocus);
            $bot.on("mousedown", keepFocus);
        }
        $top.on("click", function (e) {
            o.onClick.call(this, e);
            afterCommand(this, o.keepOpen);
        });
        $bot.on("click", function () { openMenuAt($w[0], o); });
        $w.append($top).append($bot);
        return $w;
    }
    /* An on/off switch with its label (AutoSave). */
    function toggle(o) {
        var $b = $('<button type="button" class="of-rb-switch" role="switch"></button>');
        $b.append('<span class="of-rb-sw"><span class="of-rb-knob"></span></span>');
        if (o.label) $b.append('<span class="of-rb-swlbl">' + esc(o.label) + "</span>");
        var sync = function () {
            var on = !!call(o.get, false);
            $b.toggleClass("on", on).attr("aria-checked", on ? "true" : "false");
        };
        common($b, { id: o.id, title: o.title || o.label, cls: o.cls, mobile: o.mobile });
        $b.on("mousedown", keepFocus);
        $b.on("click", function () { o.set(!call(o.get, false)); sync(); });
        sync();
        $b.data("sync", sync);
        tracked.push({ $el: $b, o: { active: o.get } });
        return $b;
    }
    /* A colour control as Office has it: the face applies the current
       colour (the bar under the icon), the caret picks another one. */
    function colorButton(o) {
        var $w = $('<span class="of-rb-split of-rb-color"></span>');
        if (o.id) $w.attr("id", o.id);
        var cur = o.value || "";
        var $main = $('<button type="button" class="of-tbtn of-rb-btn of-rb-cface"></button>')
            .attr("title", tip(o))
            .append(iconHtml(o))
            .append('<span class="of-rb-cbar"></span>');
        var $car = $('<button type="button" class="of-tbtn of-rb-btn of-rb-caretbtn"><i class="caret down icon"></i></button>')
            .attr("title", (o.title || "Colour") + " - more colours");
        var paint = function () {
            $main.find(".of-rb-cbar").css("background", cur || "transparent")
                .toggleClass("none", !cur);
        };
        var pick = function () {
            OfficeColorPicker.open({
                anchor: $w[0], value: cur || o.value || "#000000",
                allowNone: !!o.allowNone, noneLabel: o.noneLabel,
                onPick: function (hex) {
                    cur = hex || "";
                    paint();
                    if (o.onPick) o.onPick(cur);
                }
            });
        };
        $main.on("mousedown", keepFocus);
        $car.on("mousedown", keepFocus);
        $main.on("click", function () {
            // nothing chosen yet (or "none" for a colour that must be one):
            // the first press picks
            if (!cur && !o.allowNone) { pick(); return; }
            if (o.onPick) o.onPick(cur);
            afterCommand(this, false);
        });
        $car.on("click", pick);
        if (o.mobile === false) $w.attr("data-mobile", "hide");
        $w.append($main).append($car);
        $w.data("ofColor", {
            get: function () { return cur; },
            set: function (hex) { cur = hex || ""; paint(); }
        });
        paint();
        return $w;
    }
    function colorOf(sel) { var c = $(sel).data("ofColor"); return c ? c.get() : ""; }
    function setColor(sel, hex) { var c = $(sel).data("ofColor"); if (c) c.set(hex); }

    /* A gallery: a row of preview tiles (styles, themes, transitions) that
       gives up tiles when room is short, plus a button listing them all.
       items: [{ key, label, html | build($tile), active(), onClick() }] */
    function gallery(o) {
        var gl = {
            $el: $('<div class="of-rb-gallery"></div>'), tiles: [],
            max: 0, min: o.minVisible || 2, count: 0, tileW: o.tileW || 76
        };
        if (o.id) gl.$el.attr("id", o.id);
        if (o.cls) gl.$el.addClass(o.cls);
        gl.$el.attr("data-mobile", o.mobile === true ? "show" : "hide");
        var $items = $('<div class="of-rb-gitems"></div>');
        var makeTile = function (it) {
            var $t = $('<button type="button" class="of-rb-gtile"></button>').attr("title", it.title || it.label || "");
            if (it.build) it.build($t); else $t.html(it.html || esc(it.label));
            $t.on("mousedown", keepFocus);
            $t.on("click", function () {
                if (it.onClick) it.onClick();
                closeGalleryPop();
                afterCommand(this, false);
                refresh();
            });
            return $t;
        };
        var items = evalItems(o.items);
        items.forEach(function (it) {
            var $t = makeTile(it).css("width", gl.tileW + "px");
            gl.tiles.push({ it: it, $el: $t });
            $items.append($t);
        });
        gl.max = Math.min(items.length, o.visible || items.length);
        var $more = $('<button type="button" class="of-rb-gmore" title="' + esc(o.moreTitle || "More") + '"><i class="caret down icon"></i></button>');
        $more.on("mousedown", keepFocus);
        $more.on("click", function () {
            if ($galleryPop) { closeGalleryPop(); return; }
            var $pop = $('<div class="of-rb-gpop of-noprint"></div>');
            if (o.cls) $pop.addClass(o.cls);
            items.forEach(function (it) {
                var $t = makeTile(it).css("width", gl.tileW + "px");
                if (it.active && call(it.active, false)) $t.addClass("active");
                $pop.append($t);
            });
            if (o.extra) {
                evalItems(o.extra).forEach(function (x) {
                    var $x = $('<button type="button" class="of-rb-gextra"></button>')
                        .html((x.icon ? '<i class="' + esc(x.icon) + ' icon"></i>' : "") + esc(x.label));
                    $x.on("click", function () { closeGalleryPop(); x.action(); });
                    $pop.append($x);
                });
            }
            $("body").append($pop);
            var r = rectOf(gl.$el[0]);
            var w = $pop.outerWidth(), h = $pop.outerHeight();
            $pop.css({
                left: Math.max(4, Math.min(r.left, window.innerWidth - w - 4)) + "px",
                top: Math.max(4, Math.min(r.top, window.innerHeight - h - 4)) + "px"
            });
            $galleryPop = $pop;
            setTimeout(function () {
                $(document).on("mousedown.ofrbgal", function (e) {
                    if ($galleryPop && !$galleryPop[0].contains(e.target)) closeGalleryPop();
                });
            }, 0);
        });
        gl.$el.append($items).append($more);
        galleries.push(gl);
        setGalleryCount(gl, gl.max);
        return gl.$el;
    }
    var $galleryPop = null;
    function closeGalleryPop() {
        $(document).off("mousedown.ofrbgal");
        if ($galleryPop) { $galleryPop.remove(); $galleryPop = null; }
    }
    function setGalleryCount(gl, n) {
        gl.count = Math.max(gl.min, Math.min(gl.max, n));
        gl.tiles.forEach(function (t, i) { t.$el.toggle(i < gl.count); });
    }

    /* ---------- closing everything (Escape, a menu opening) ---------- */
    function closePopups() {
        closePopup();
        closeGalleryPop();
    }

    return {
        tab: tab,
        hasTabs: hasTabs,
        select: select,
        activeTab: activeTab,
        attachStrip: attachStrip,
        refresh: refresh,
        fit: fit,
        scheduleFit: scheduleFit,
        isNarrow: isNarrow,
        setMinimized: setMinimized,
        isMinimized: isMinimized,
        closePopups: closePopups,
        // controls
        button: button,
        dropdown: dropdown,
        split: split,
        big: big,
        toggle: toggle,
        colorButton: colorButton,
        colorOf: colorOf,
        setColor: setColor,
        gallery: gallery,
        host: host
    };
})();
