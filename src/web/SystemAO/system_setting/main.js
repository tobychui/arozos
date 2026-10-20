/* system_setting/main.js */

/* Fonts come from tokens.css; applocale must not write them inline (see applyLocaleFont) */
window.applocaleSkipFontFamily = true;

/* ── Flags and state read by the loaded setting pages (keep these names) ── */
var loadViaSystemSetting     = true;
var loadToPage               = undefined;
var currentSettingModuleList = [];
var preferredTheme           = 'auto';

var allGroups        = [];   // groups with their visible pages: [{Name, Group, IconPath, Desc, Modules}]
var currentGroupId   = null;
var currentGroupName = '';
var currentSubcats   = [];   // pages of the current group
var currentPage      = null;
var localeCache      = null;

/* ── Sidebar geometry ── */
var SB_RAIL     = 56;    // icon rail width
var SB_MIN      = 184;   // narrowest expanded sidebar
var SB_MAX      = 420;
var SB_DEFAULT  = 232;
var SB_SNAP     = 140;   // dragging narrower than this snaps to the rail
var SB_NARROW   = 640;   // windows narrower than this always use the rail
var SB_STORE    = 'ao_systemsetting_sidebar';

/* Pages that draw edge to edge (own two-panel layouts) */
var FLUSH_PAGES = ['System Log', 'Disk Manager'];

/*
    Group tiles: a tone (see tokens.css) and a 24 px stroke glyph per group.
    Groups added later fall back to the gray tone and the generic glyph.
*/
var GROUP_STYLE = {
    Info:      { tone: 'blue',   icon: '<rect x="3" y="4" width="18" height="8" rx="2.5"/><rect x="3" y="12" width="18" height="8" rx="2.5"/><path d="M7 8h.01M7 16h.01M11 8h6M11 16h6"/>' },
    Device:    { tone: 'teal',   icon: '<path d="M13 14H4.5A1.5 1.5 0 0 1 3 12.5v-7A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5V8"/><path d="M7 18h6M10 14v4"/><rect x="15" y="10" width="6" height="10" rx="1.5"/>' },
    Module:    { tone: 'indigo', icon: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M17 14v6M14 17h6"/>' },
    Desktop:   { tone: 'pink',   icon: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M7 20h10M9 16v4M15 16v4M7 12.5l3-3 2 2 4-4"/>' },
    Disk:      { tone: 'orange', icon: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>' },
    Network:   { tone: 'sky',    icon: '<circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18"/>' },
    Users:     { tone: 'green',  icon: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"/>' },
    Cluster:   { tone: 'purple', icon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>' },
    Security:  { tone: 'red',    icon: '<path d="M12 3a12 12 0 0 0 8.5 3A12 12 0 0 1 12 21 12 12 0 0 1 3.5 6 12 12 0 0 0 12 3"/><path d="M9 12l2 2 4-4"/>' },
    Advance:   { tone: 'olive',  icon: '<path d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16"/>' },
    AInteg:    { tone: 'peri',   icon: '<rect x="5" y="5" width="14" height="14" rx="1.5"/><path d="M9 9h6v6H9z"/><path d="M3 10h2M3 14h2M10 3v2M14 3v2M21 10h-2M21 14h-2M14 21v-2M10 21v-2"/>' },
    Container: { tone: 'steel',  icon: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M7.5 9.5v5M12 9.5v5M16.5 9.5v5"/>' },
    About:     { tone: 'gray',   icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>' }
};
var GROUP_FALLBACK = { tone: 'gray', icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6M12 9v6"/>' };

var CHEVRON_SVG = '<svg class="sb-chevron" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>';

var sbState    = readSidebarState();
var loadToken  = 0;
var bootStarted = false;

/* ══════════════════════════════════════════════
   Theme
   ══════════════════════════════════════════════ */

var themeReady = $.Deferred();

function setTheme(isDark) {
    var changed = document.body.classList.contains('dark') !== isDark || preferredTheme === 'auto';
    document.body.classList.toggle('dark', isDark);
    preferredTheme = isDark ? 'dark' : 'light';
    if (changed && typeof window.detailPageThemeCallback === 'function') {
        try { window.detailPageThemeCallback(isDark); } catch (e) {}
    }
}

ao_module_getSystemThemeColor(function (color) {
    setTheme(color !== 'whiteTheme');
    themeReady.resolve();
});
setTimeout(function () { themeReady.resolve(); }, 1500);

/*
    Called by the desktop broadcastDesktopThemeChange() when the user toggles
    dark/light mode. Some pages assign their own window.desktopThemeChanged:
    the setter keeps the shell's handler and runs the page's after it, until
    the page is left (runPageCleanup).
*/
var pageThemeHandler = null;
function shellThemeChanged(theme) {
    setTheme(theme === 'dark');
    if (typeof pageThemeHandler === 'function') {
        try { pageThemeHandler(theme); } catch (e) {}
    }
}
Object.defineProperty(window, 'desktopThemeChanged', {
    configurable: true,
    get: function () { return shellThemeChanged; },
    set: function (fn) { pageThemeHandler = (fn === shellThemeChanged) ? null : fn; }
});

/* ══════════════════════════════════════════════
   Bootstrap
   ══════════════════════════════════════════════ */

var localeReady = $.Deferred();
applocale.init('../locale/system_settings.json', function (cache) {
    localeCache = cache;
    applyLocaleFont(cache);
    applocale.translate();
    //applocale names the window after this callback; later page locales must not rename it
    setTimeout(function () { window.applocaleKeepWindowTitle = true; }, 0);
    localeReady.resolve();
}, function () {
    window.applocaleKeepWindowTitle = true;
    localeReady.resolve();
});

$.when(localeReady, themeReady).always(boot);

function boot() {
    if (bootStarted) return;
    bootStarted = true;

    $('#sb-search-input').attr('placeholder', str('shell/search', 'Search settings'));
    $('#sb-search-btn').attr('title', str('shell/search', 'Search settings'));
    $('#sb-myaccount').text(str('shell/my_account', 'My Account'));
    $('#sb-empty').text(str('shell/no_match', 'No settings match your search'));
    $('#sb-resizer').attr('title', str('shell/resize_hint', 'Drag to resize, double click to collapse'));

    applySidebarLayout();
    bindSidebar();
    loadAccount();

    $.get('../../system/setting/list?tree=true', function (data) {
        allGroups = $.isArray(data) ? data : [];
        renderTree();
        restoreFromHash();
    }).fail(function () {
        $('#detail-inner').html(errorState(str('shell/load_failed', 'Could not load the settings list.')));
    });
}

/* ══════════════════════════════════════════════
   Locale helpers
   ══════════════════════════════════════════════ */

/*
    CJK languages name a preferred font in their locale. Keep the UI font for
    Latin text and let the browser fall through to that font for the CJK
    glyphs, instead of applocale's inline font on every element.
*/
function applyLocaleFont(cache) {
    try {
        var lang = applocale.lang;
        var pref = cache && cache.keys && cache.keys[lang] && cache.keys[lang].fontFamily;
        if (pref && /^(zh|ja|ko)/.test(lang)) {
            document.documentElement.style.setProperty('--ss-font',
                "'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, " + pref + ", sans-serif");
        }
    } catch (e) {}
}

function str(key, fallback) {
    try { return applocale.getString(key, fallback) || fallback; } catch (e) { return fallback; }
}

function groupName(g) {
    return str('menu/group/' + g.Name, g.Name);
}

function getSubcatName(s) {
    return str('tab/' + String(s.Group || currentGroupId || '').toLowerCase() + '/' + s.Name, s.Name);
}

function getSubcatDesc(s) {
    if (!s.Desc) return '';
    return str('desc/' + String(s.Group || currentGroupId || '').toLowerCase() + '/' + s.Name, s.Desc);
}

function esc(text) {
    return $('<div>').text(text == null ? '' : String(text)).html();
}

/* ══════════════════════════════════════════════
   Account card
   ══════════════════════════════════════════════ */

function loadAccount() {
    $.ajax({
        url: '../../system/desktop/user',
        method: 'GET',
        dataType: 'json',
        success: function (d) {
            if (!d || d.error !== undefined) return;
            var name = d.Username || '';
            $('#sb-username').text(name);
            $('#sb-initials').text(initials(name));
            var role = d.IsAdmin ? str('shell/administrator', 'Administrator')
                     : (d.UserGroups && d.UserGroups.length ? d.UserGroups[0] : str('shell/user', 'User'));
            $('#sb-role').text(role);
            $('#sb-account').attr('title', name);
            if (d.UserIcon) {
                var img = new Image();
                img.alt = '';
                img.onload = function () { $('#sb-account .sb-avatar').append(img); };
                img.src = d.UserIcon;
            }
        }
    });
}

function initials(name) {
    var parts = String(name).trim().split(/[\s._-]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    return String(name).substr(0, 2).toUpperCase();
}

function openMyAccount() {
    for (var i = 0; i < allGroups.length; i++) {
        var mods = allGroups[i].Modules || [];
        for (var j = 0; j < mods.length; j++) {
            if (mods[j].StartDir === 'SystemAO/users/account.html') {
                openPage(allGroups[i], mods[j]);
                return;
            }
        }
    }
}

/* ══════════════════════════════════════════════
   Sidebar tree
   ══════════════════════════════════════════════ */

function tileHtml(groupId) {
    var st = GROUP_STYLE[groupId] || GROUP_FALLBACK;
    return '<span class="sb-tile" style="--tile-bg:var(--tone-' + st.tone + '-bg);--tile-fg:var(--tone-' + st.tone + '-fg)">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        st.icon + '</svg></span>';
}

function renderTree() {
    var $tree = $('#sb-tree').empty();
    allGroups.forEach(function (g) {
        var name = groupName(g);
        var $group = $('<div class="sb-group"></div>').attr('data-group', g.Group);
        if (sbState.collapsed[g.Group]) $group.addClass('collapsed');

        var $head = $('<div class="sb-group-head" role="button" tabindex="0"></div>')
            .attr('title', name)
            .html(tileHtml(g.Group) + '<span class="sb-group-name">' + esc(name) + '</span>' + CHEVRON_SVG);
        $head.on('click', function () { onGroupHead(g, $group); });
        $head.on('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGroupHead(g, $group); }
        });

        var $items = $('<div class="sb-items"></div>');
        (g.Modules || []).forEach(function (s) {
            $items.append(itemElement(g, s));
        });

        $group.append($head, $items);
        $tree.append($group);
    });
}

function itemElement(g, s) {
    var name = getSubcatName(s);
    var $item = $('<div class="sb-item" role="link" tabindex="0"></div>')
        .attr('data-group', g.Group)
        .attr('data-name', s.Name)
        .attr('title', getSubcatDesc(s) || name)
        .text(name);
    $item.data('label', name);
    $item.on('click', function () { openPage(g, s); });
    $item.on('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); openPage(g, s); }
    });
    if (currentPage && currentPage.Name === s.Name && currentGroupId === g.Group) $item.addClass('active');
    return $item;
}

function onGroupHead(g, $group) {
    if (isRail() && !$('#app').hasClass('sb-peek')) {
        toggleFlyout(g, $group);
        return;
    }
    if ($('#app').hasClass('sb-searching')) return;
    var collapsed = !$group.hasClass('collapsed');
    $group.toggleClass('collapsed', collapsed);
    if (collapsed) sbState.collapsed[g.Group] = true; else delete sbState.collapsed[g.Group];
    saveSidebarState();
}

function markActive() {
    $('.sb-item').removeClass('active');
    $('.sb-group').removeClass('current');
    if (!currentPage) return;
    $('.sb-item').filter(function () {
        return $(this).attr('data-group') === currentGroupId && $(this).attr('data-name') === currentPage.Name;
    }).addClass('active');
    $('.sb-group').filter(function () { return $(this).attr('data-group') === currentGroupId; }).addClass('current');
}

function revealActive() {
    var el = $('#sb-tree .sb-item.active')[0];
    if (el && !isRail() && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest' });
    }
}

/* ══════════════════════════════════════════════
   Navigation
   ══════════════════════════════════════════════ */

function findGroup(groupId) {
    for (var i = 0; i < allGroups.length; i++) {
        if (allGroups[i].Group === groupId) return allGroups[i];
    }
    return null;
}

function openPage(g, s) {
    currentGroupId           = g.Group;
    currentGroupName         = groupName(g);
    currentSubcats           = g.Modules || [];
    currentSettingModuleList = currentSubcats;
    currentPage              = s;

    //An opened page always shows inside an expanded group
    if (sbState.collapsed[g.Group]) {
        delete sbState.collapsed[g.Group];
        saveSidebarState();
        $('.sb-group').filter(function () { return $(this).attr('data-group') === g.Group; }).removeClass('collapsed');
    }

    markActive();
    closeFlyout();
    closePeek();
    $('#page-crumb').text(currentGroupName);
    $('#page-title').text(getSubcatName(s));
    loadContent(s);
    updateHash(g.Group, s.Name);
    revealActive();
}

/* Kept for pages that switch tabs themselves (e.g. the cluster pages) */
function openSubcat(s) {
    var g = findGroup(s.Group || currentGroupId);
    if (g) {
        for (var i = 0; i < (g.Modules || []).length; i++) {
            if (g.Modules[i].Name === s.Name) { openPage(g, g.Modules[i]); return; }
        }
    }
    loadContent(s);
}

function selectGroup(g) {
    var full = findGroup(g.Group) || g;
    if (full.Modules && full.Modules.length) openPage(full, full.Modules[0]);
}

function runPageCleanup() {
    if (typeof window.ssOnPageLeave === 'function') {
        try { window.ssOnPageLeave(); } catch (e) {}
    }
    window.ssOnPageLeave = null;
    window.detailPageThemeCallback = null;
    pageThemeHandler = null;
}

/* Load a setting page into the detail panel */
function loadContent(moduleInfo) {
    runPageCleanup();
    var token = ++loadToken;
    var $inner = $('#detail-inner');
    $('#page-actions').empty();
    $inner.toggleClass('ss-flush', FLUSH_PAGES.indexOf(moduleInfo.Name) >= 0);
    $inner.html('<div class="ss-loading"><div class="ss-spinner"></div><span>' + esc(str('shell/loading', 'Loading')) + '</span></div>');
    $('#detail').scrollTop(0);

    $.ajax({ url: '../../' + moduleInfo.StartDir, dataType: 'html', cache: false })
        .done(function (html) {
            if (token !== loadToken) return;
            $inner.html(stripSharedAssets(html));
            adoptPageActions();
            injectIME();
        })
        .fail(function () {
            if (token !== loadToken) return;
            $inner.html(errorState(str('shell/page_failed', 'This page could not be loaded.'), true));
            $inner.find('.ss-retry').on('click', function () { loadContent(moduleInfo); });
        });
}

/*
    Many pages still include jQuery, Semantic UI, ao_module and applocale for
    when they are opened on their own. Inside the shell those are already
    loaded; running jquery.min.js again would replace the shell's jQuery with
    one that has no Semantic UI plugins and break every page opened after it.
*/
var SHARED_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*\/(jquery(\.min)?|semantic(\.min)?|ao_module|applocale)\.js["'][^>]*>\s*<\/script>/gi;
var SHARED_STYLE = /<link\b[^>]*\bhref\s*=\s*["'][^"']*\/semantic(\.min)?\.css["'][^>]*>/gi;

function stripSharedAssets(html) {
    return String(html).replace(SHARED_SCRIPT, '').replace(SHARED_STYLE, '');
}

/* A page may hand controls to the header with an element marked data-ss-page-actions */
function adoptPageActions() {
    var $actions = $('#detail-inner [data-ss-page-actions]').first();
    if ($actions.length) $('#page-actions').append($actions);
}

function errorState(message, retry) {
    return '<div class="ss-card"><div class="ss-empty">' + esc(message) +
        (retry ? '<div style="margin-top:10px"><button type="button" class="ss-btn ss-retry">' + esc(str('shell/retry', 'Try again')) + '</button></div>' : '') +
        '</div></div>';
}

/* ── URL hash: persist & restore navigation state (full page mode only) ── */
function updateHash(group, name) {
    if (ao_module_windowID !== false) return;
    var hash = encodeURIComponent(JSON.stringify({ group: group, name: name }));
    if (window.history && history.replaceState) {
        history.replaceState(null, '', '#' + hash);
    } else {
        window.location.hash = hash;
    }
}

/* Alias kept for sub-modules that call the old function name */
function updateWindowHash(group, name) { updateHash(group, name); }

function restoreFromHash() {
    if (window.location.hash.length > 1) {
        try {
            var h = JSON.parse(decodeURIComponent(window.location.hash.substr(1)));
            var g = h && h.group ? findGroup(h.group) : null;
            if (g) {
                var mods = g.Modules || [];
                for (var i = 0; i < mods.length; i++) {
                    if (mods[i].Name === h.name) { openPage(g, mods[i]); return; }
                }
                if (mods.length) { openPage(g, mods[0]); return; }
            }
        } catch (e) {}
    }
    if (allGroups.length > 0 && allGroups[0].Modules && allGroups[0].Modules.length) {
        openPage(allGroups[0], allGroups[0].Modules[0]);
    }
}

/* ══════════════════════════════════════════════
   Search
   ══════════════════════════════════════════════ */

function applySearch(raw) {
    var q = String(raw || '').trim().toLowerCase();
    var searching = q !== '';
    $('#app').toggleClass('sb-searching', searching);
    var anyVisible = false;

    $('#sb-tree .sb-group').each(function () {
        var $group = $(this);
        var g = findGroup($group.attr('data-group'));
        if (!g) return;
        var groupText = (groupName(g) + ' ' + g.Name + ' ' + (g.Desc || '')).toLowerCase();
        var groupHit = searching && groupText.indexOf(q) >= 0;
        var shown = 0;

        $group.find('.sb-item').each(function () {
            var $item = $(this);
            var label = $item.data('label') || $item.text();
            var s = null;
            for (var i = 0; i < (g.Modules || []).length; i++) {
                if (g.Modules[i].Name === $item.attr('data-name')) { s = g.Modules[i]; break; }
            }
            var itemText = (label + ' ' + (s ? s.Name + ' ' + (s.Desc || '') + ' ' + getSubcatDesc(s) : '')).toLowerCase();
            var hit = !searching || groupHit || itemText.indexOf(q) >= 0;
            $item.toggle(hit);
            $item.html(searching ? highlight(label, q) : esc(label));
            if (hit) shown++;
        });

        $group.toggle(shown > 0);
        //While searching every matching group is open, whatever its saved state
        $group.toggleClass('collapsed', !searching && !!sbState.collapsed[g.Group]);
        if (shown > 0) anyVisible = true;
    });

    $('#sb-empty').toggle(searching && !anyVisible);
    $('#sb-account').toggle(!searching);
}

function highlight(label, q) {
    var i = label.toLowerCase().indexOf(q);
    if (i < 0) return esc(label);
    return esc(label.substr(0, i)) + '<mark>' + esc(label.substr(i, q.length)) + '</mark>' + esc(label.substr(i + q.length));
}

function focusSearch() {
    if (isRail()) openPeek();
    var input = document.getElementById('sb-search-input');
    input.focus();
    input.select();
}

/* ══════════════════════════════════════════════
   Resizing and the icon rail
   ══════════════════════════════════════════════ */

function readSidebarState() {
    var state = { width: SB_DEFAULT, rail: false, collapsed: {} };
    try {
        var saved = JSON.parse(localStorage.getItem(SB_STORE) || 'null');
        if (saved) {
            if (typeof saved.width === 'number') state.width = Math.max(SB_MIN, Math.min(SB_MAX, saved.width));
            state.rail = !!saved.rail;
            if (saved.collapsed && typeof saved.collapsed === 'object') state.collapsed = saved.collapsed;
        }
    } catch (e) {}
    return state;
}

function saveSidebarState() {
    try { localStorage.setItem(SB_STORE, JSON.stringify(sbState)); } catch (e) {}
}

function isRail() {
    return $('#app').hasClass('sb-rail');
}

function applySidebarLayout() {
    var rail = sbState.rail || window.innerWidth < SB_NARROW;
    document.documentElement.style.setProperty('--ss-sidebar-width', sbState.width + 'px');
    $('#app').toggleClass('sb-rail', rail);
    $('#sb-resizer').toggle(window.innerWidth >= SB_NARROW);
    if (!rail) {
        closePeek();
        closeFlyout();
    }
}

function bindSidebar() {
    var $resizer = $('#sb-resizer');
    var dragging = false;

    $resizer.on('pointerdown', function (e) {
        if (e.button !== 0 || window.innerWidth < SB_NARROW) return;
        e.preventDefault();
        dragging = true;
        closeFlyout();
        closePeek();
        try { this.setPointerCapture(e.originalEvent.pointerId); } catch (err) {}
        $('body').addClass('ss-resizing');
    });

    $resizer.on('pointermove', function (e) {
        if (!dragging) return;
        var left = document.getElementById('app').getBoundingClientRect().left;
        var w = e.originalEvent.clientX - left;
        if (w < SB_SNAP) {
            sbState.rail = true;
        } else {
            sbState.rail = false;
            sbState.width = Math.round(Math.max(SB_MIN, Math.min(SB_MAX, w)));
        }
        applySidebarLayout();
    });

    $resizer.on('pointerup pointercancel', function (e) {
        if (!dragging) return;
        dragging = false;
        try { this.releasePointerCapture(e.originalEvent.pointerId); } catch (err) {}
        $('body').removeClass('ss-resizing');
        saveSidebarState();
        revealActive();
    });

    $resizer.on('dblclick', function () {
        sbState.rail = !sbState.rail;
        applySidebarLayout();
        saveSidebarState();
    });

    $(window).on('resize', function () {
        applySidebarLayout();
    });

    //Search
    var $input = $('#sb-search-input');
    $input.on('input', function () { applySearch(this.value); });
    $input.on('keydown', function (e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.value) {
                this.value = '';
                applySearch('');
            } else {
                this.blur();
                closePeek();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            var $first = $('#sb-tree .sb-item:visible').first();
            if ($first.length) {
                $first.trigger('click');
                this.value = '';
                applySearch('');
                this.blur();
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            $('#sb-tree .sb-item:visible').first().focus();
        }
    });
    $('#sb-search-btn').on('click', focusSearch);

    //Arrow keys move between visible pages
    $('#sb-tree').on('keydown', '.sb-item', function (e) {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        var $items = $('#sb-tree .sb-item:visible');
        var i = $items.index(this) + (e.key === 'ArrowDown' ? 1 : -1);
        if (i < 0) { $('#sb-search-input').focus(); return; }
        $items.eq(Math.min(i, $items.length - 1)).focus();
    });

    //"/" focuses the search box unless the user is typing somewhere
    $(document).on('keydown', function (e) {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target;
        var tag = (t && t.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        e.preventDefault();
        focusSearch();
    });

    //Account card
    $('#sb-account').on('click', openMyAccount).on('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMyAccount(); }
    });

    //Clicks outside close the flyout and the peeking sidebar
    $(document).on('mousedown touchstart', function (e) {
        var $t = $(e.target);
        if ($('#sb-flyout').hasClass('open') && !$t.closest('#sb-flyout, .sb-group-head').length) closeFlyout();
        if ($('#app').hasClass('sb-peek') && !$t.closest('#sidebar').length) closePeek();
    });
    $(document).on('keydown', function (e) {
        if (e.key === 'Escape') closeFlyout();
    });
    $('#sb-scroll').on('scroll', closeFlyout);
}

function openPeek() {
    closeFlyout();
    $('#app').addClass('sb-peek');
}

function closePeek() {
    if (!$('#app').hasClass('sb-peek')) return;
    $('#app').removeClass('sb-peek');
    var input = document.getElementById('sb-search-input');
    if (input && input.value) {
        input.value = '';
        applySearch('');
    }
}

function toggleFlyout(g, $group) {
    if ($group.hasClass('flyout-open')) {
        closeFlyout();
        return;
    }
    closeFlyout();
    var $fly = $('#sb-flyout').empty();
    $fly.append($('<div class="sb-flyout-title"></div>').html(tileHtml(g.Group) + '<span>' + esc(groupName(g)) + '</span>'));
    (g.Modules || []).forEach(function (s) {
        $fly.append(itemElement(g, s));
    });

    var head = $group.find('.sb-group-head')[0].getBoundingClientRect();
    $fly.addClass('open').css({ left: head.right + 10, top: 0 });
    var h = $fly.outerHeight();
    var top = Math.max(8, Math.min(head.top - 6, window.innerHeight - h - 8));
    $fly.css({ top: top });
    $group.addClass('flyout-open');
}

function closeFlyout() {
    $('#sb-flyout').removeClass('open').empty();
    $('.sb-group.flyout-open').removeClass('flyout-open');
}

/* ══════════════════════════════════════════════
   Helpers used by the loaded pages
   ══════════════════════════════════════════════ */

function injectIME() {
    var container = document.getElementById('detail-inner');
    if (!container) return;
    var inputs = container.querySelectorAll('input, textarea');
    for (var i = 0; i < inputs.length; i++) {
        var t = inputs[i].getAttribute('type');
        if (!t || t === 'text' || t === 'search' || t === 'url') {
            if (ao_module_virtualDesktop) ao_module_bindCustomIMEEvents(inputs[i]);
        }
    }
}

/* Toast notification (called by sub-modules) */
var msgboxTimer = null;
function msgbox(message, succ, delay) {
    if (succ  === undefined) succ  = true;
    if (delay === undefined) delay = 3000;
    var icon = succ
        ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5L6 12l7.5-8"/></svg>'
        : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    var $box = $('#msgbox');
    clearTimeout(msgboxTimer);
    $box.stop(true, true)
        .attr('class', succ ? 'ok' : 'err')
        .html(icon + '<span>' + message + '</span>')
        .css('display', 'flex').hide().fadeIn('fast');
    msgboxTimer = setTimeout(function () { $box.fadeOut('fast'); }, delay);
}

/* Legacy stubs (kept for sub-modules that reference the old shell API) */
function hideToolBar()      {}
function showToolBar()      {}
var pageStateRestored = false;
function restorePageFromHash() {}
function toggleSidebar()    { if (isRail()) openPeek(); }
function closeSidebar()     { closePeek(); }
function showDetail()       {}
function showOverview()     {}
function goBack()           {}
