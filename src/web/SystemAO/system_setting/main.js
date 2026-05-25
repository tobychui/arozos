/* system_setting/main.js */

/* ── Flags read by loaded sub-modules ── */
var loadViaSystemSetting  = true;
var loadToPage            = undefined;
var currentSettingModuleList = [];
var preferredTheme = 'auto';

/* ── Navigation state ── */
var allGroups        = [];
var currentGroupId   = null;
var currentGroupName = '';
var currentSubcats   = [];
var infoBannerLoaded = false;

/* ── AppLocale instance ── */
var localeCache      = null;

/* ── Theme ── */
ao_module_getSystemThemeColor(function (color) {
    // Darktheme wip, force light theme for now
    document.body.classList.toggle('dark', color !== 'whiteTheme');
    preferredTheme = color === 'whiteTheme' ? 'light' : 'dark';
});

/* ── Bootstrap ── */
applocale.init('../locale/system_settings.json', function (cache) {
    localeCache = cache;
    applocale.translate();
    $.get('../../system/setting/list', function (data) {
        allGroups = data;
        renderGroupNav();
        restoreFromHash();
    });
});

function isInfoGroup(groupId) {
    return String(groupId || '').toLowerCase() === 'info';
}

function updateInfoBanner(groupId) {
    var $banner = $('#info-banner');
    if (!isInfoGroup(groupId)) {
        $banner.removeClass('active');
        return;
    }

    if (!infoBannerLoaded) {
        $banner.load('../info/overview.html', function () {
            infoBannerLoaded = true;
            $banner.addClass('active');
        });
    } else {
        $banner.addClass('active');
    }
}

/* ── Render sidebar: main group list ── */
function renderGroupNav() {
    var $nav = $('#sidebar-nav');
    $nav.empty();
    allGroups.forEach(function (g) {
        var name  = applocale.getString('menu/group/' + g.Name, g.Name);
        var $item = $('<div class="nav-item"></div>')
            .attr('data-group', g.Group)
            .append('<img src="../../' + g.IconPath + '" onerror="this.src=\'img/unknown.png\'">')
            .append('<span>' + name + '</span>');
        (function (grp) { $item.on('click', function () { selectGroup(grp); }); }(g));
        $nav.append($item);
    });
}

/* ── Render sidebar: sub-category list (detail view) ── */
function renderSubcatNav() {
    var $nav = $('#sidebar-nav');
    $nav.empty();
    currentSubcats.forEach(function (s) {
        var name  = getSubcatName(s);
        var $item = $('<div class="nav-item"></div>')
            .attr('data-subname', s.Name)
            .append('<img src="../../' + s.IconPath + '" onerror="this.src=\'img/unknown.png\'">')
            .append('<span>' + name + '</span>');
        (function (sub) {
            $item.on('click', function () {
                $('.nav-item').removeClass('active');
                $item.addClass('active');
                loadContent(sub);
                updateHash(sub.Group, sub.Name);
            });
        }(s));
        $nav.append($item);
    });
}

/* ── Select a main category → show sub-category card grid ── */
function selectGroup(g) {
    currentGroupId   = g.Group;
    currentGroupName = applocale.getString('menu/group/' + g.Name, g.Name);
    updateInfoBanner(currentGroupId);

    $('#back-row').hide();
    $('#group-label').hide();
    renderGroupNav();
    $('.nav-item[data-group="' + g.Group + '"]').addClass('active');

    $.get('../../system/setting/list?listGroup=' + g.Group, function (data) {
        currentSubcats           = data;
        currentSettingModuleList = data;
        renderCards(currentSubcats);
        showOverview();
        updateHash(g.Group, '');
        closeSidebar();  // close on mobile after group selection
    });
}

/* ── Render card grid for the selected group ── */
function renderCards(subcats) {
    $('#overview-title').text(currentGroupName);
    var $grid = $('#card-grid');
    $grid.empty();
    subcats.forEach(function (s) {
        var name = getSubcatName(s);
        var desc = s.Desc ? '<div class="card-desc">' + s.Desc + '</div>' : '';
        var $card = $('<div class="setting-card"></div>')
            .append('<img src="../../' + s.IconPath + '" onerror="this.src=\'img/unknown.png\'">')
            .append('<div class="card-text"><div class="card-title">' + name + '</div>' + desc + '</div>');
        (function (sub) { $card.on('click', function () { openSubcat(sub); }); }(s));
        $grid.append($card);
    });
}

/* ── Click a sub-category card → detail view ── */
function openSubcat(s) {
    renderSubcatNav();
    $('#back-row').css('display', 'flex');
    $('#group-label').text(currentGroupName).show();
    $('.nav-item[data-subname="' + s.Name + '"]').addClass('active');
    loadContent(s);
    updateHash(s.Group, s.Name);
    closeSidebar();  // close on mobile after selection
}

/* ── Load a setting module into the detail panel ── */
function loadContent(moduleInfo) {
    showDetail();
    $('#detail-inner').html('<div style="color:#999;font-size:13px;">Loading\u2026</div>');
    $('#detail-inner').load('../../' + moduleInfo.StartDir, function () { injectIME(); });

    // For performance tab, set detail-inner padding to 0 to avoid unnecessary reflow when rendering charts
    if (moduleInfo.Name === 'Performance') {
        $('#detail-inner').css('padding', '0');
    } else {
        $('#detail-inner').css('padding', '');
    }
}

/* ── Back button: return to card grid ── */
function goBack() {
    $('#back-row').hide();
    $('#group-label').hide();
    renderGroupNav();
    $('.nav-item[data-group="' + currentGroupId + '"]').addClass('active');
    renderCards(currentSubcats);
    showOverview();
    window.location.hash = "";
}

function showOverview() { $('#overview').show(); $('#detail').hide(); }
function showDetail()   { $('#overview').hide(); $('#detail').show(); }

/* ── URL hash: persist & restore navigation state ── */
function updateHash(group, name) {
    if (ao_module_windowID !== false) return;
    window.location.hash = encodeURIComponent(JSON.stringify({ group: group, name: name }));
}

/* Alias kept for sub-modules that call the old function name */
function updateWindowHash(group, name) { updateHash(group, name); }

function restoreFromHash() {
    if (window.location.hash.length > 0) {
        try {
            var h = JSON.parse(decodeURIComponent(window.location.hash.substr(1)));
            if (h && h.group) {
                var g = null;
                for (var i = 0; i < allGroups.length; i++) {
                    if (allGroups[i].Group === h.group) { g = allGroups[i]; break; }
                }
                if (g) {
                    currentGroupId   = g.Group;
                    currentGroupName = applocale.getString('menu/group/' + g.Name, g.Name);
                    renderGroupNav();
                    $('.nav-item[data-group="' + g.Group + '"]').addClass('active');
                    $.get('../../system/setting/list?listGroup=' + g.Group, function (data) {
                        updateInfoBanner(g.Group);
                        currentSubcats           = data;
                        currentSettingModuleList = data;
                        if (h.name && h.name !== '') {
                            var s = null;
                            for (var j = 0; j < currentSubcats.length; j++) {
                                if (currentSubcats[j].Name === h.name) { s = currentSubcats[j]; break; }
                            }
                            if (s) { openSubcat(s); return; }
                        }
                        renderCards(currentSubcats);
                        showOverview();
                    });
                    return;
                }
            }
        } catch (e) {}
    }
    if (allGroups.length > 0) selectGroup(allGroups[0]);
}

/* ── Helpers ── */
function getSubcatName(s) {
    return applocale.getString(
        'tab/' + (currentGroupId || '').toLowerCase() + '/' + s.Name,
        s.Name
    );
}

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

/* ── Toast notification (called by sub-modules) ── */
function msgbox(message, succ, delay) {
    if (succ  === undefined) succ  = true;
    if (delay === undefined) delay = 3000;
    var color = succ ? '#107c10' : '#c42b1c';
    var icon  = succ
        ? '<svg style="width:14px;height:14px;flex-shrink:0;color:' + color + '" viewBox="0 0 16 16" fill="none"><path d="M2 8.5L6 12.5L14 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg style="width:14px;height:14px;flex-shrink:0;color:' + color + '" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    $('#msgbox')
        .html(icon + '<span style="color:' + color + '">' + message + '</span>')
        .css('display', 'flex').hide().fadeIn('fast').delay(delay).fadeOut('fast');
}

/* ── Legacy stubs (kept for sub-modules that reference the old toolbar API) ── */
function hideToolBar()      {}
function showToolBar()      {}
var pageStateRestored = false;
function restorePageFromHash() {}

/* ── Mobile sidebar toggle ── */
function toggleSidebar() {
    if ($('#sidebar').hasClass('open')) {
        closeSidebar();
    } else {
        $('#sidebar').addClass('open');
        $('body').addClass('sidebar-open');
    }
}

function closeSidebar() {
    $('#sidebar').removeClass('open');
    $('body').removeClass('sidebar-open');
}

// Auto-close sidebar and hide overlay when resizing back to wide layout
$(window).on('resize.sidebarRWD', function () {
    if (window.innerWidth > 768) {
        closeSidebar();
    }

    if ($("#managerFrame").length > 0) {
        $("#managerFrame").attr("width", "100%");
    }
});
