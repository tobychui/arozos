/*
    Cluster pages - shared helpers

    Used by Cluster Settings (cluster.html), Cluster Info (clusterinfo.html)
    and Cluster Jobs (jobs.html). Everything lives on the CL object:

        CL.init(callback)        load ../locale/cluster.json, translate the
                                 static page, then call callback (also called
                                 when the locale cannot be loaded)
        CL.t(key, fallback)      a UI string in the viewer's language
        CL.tr(message)           a message that came back from the server,
                                 translated when the locale knows it
        CL.state(name)           a node / job / copy state label

    Server messages are matched two ways. "msg/<text>" entries translate a
    fixed message. "msgp/<template>" entries translate a message with
    variable parts: the template marks each part {0}, {1}, ... and the
    translation puts them back where that language wants them. Each part is
    translated again, so "node X could not take the job: <reason>" also
    translates the reason.
*/

var CL = (function () {
    var loc = null;
    var patterns = null;

    function strings() {
        if (!loc || !loc.localData || !loc.localData.keys) return null;
        var set = loc.localData.keys[loc.lang];
        return (set && set.strings) ? set.strings : null;
    }

    function t(key, fallback) {
        var s = strings();
        if (s && s[key] !== undefined && s[key] !== '') return s[key];
        return fallback;
    }

    function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    //Compile every "msgp/" template once into a regular expression
    function compilePatterns() {
        patterns = [];
        var s = strings();
        if (!s) return;
        Object.keys(s).forEach(function (key) {
            if (key.indexOf('msgp/') !== 0) return;
            var template = key.substring(5);
            var order = [];
            var parts = template.split(/(\{\d\})/);
            var re = '^';
            parts.forEach(function (p, i) {
                var m = p.match(/^\{(\d)\}$/);
                if (m) {
                    order.push(parseInt(m[1], 10));
                    //The last placeholder takes the rest of the message
                    re += (i === parts.length - 2 && parts[parts.length - 1] === '') ? '([\\s\\S]*)' : '([\\s\\S]*?)';
                } else {
                    re += escapeRegex(p);
                }
            });
            patterns.push({ re: new RegExp(re + '$'), order: order, out: s[key], literal: template.replace(/\{\d\}/g, '').length });
        });
        //Try the most specific templates first
        patterns.sort(function (a, b) { return b.literal - a.literal; });
    }

    function tr(message, depth) {
        if (message === null || message === undefined) return message;
        var text = String(message).trim();
        if (text === '') return text;
        depth = depth || 0;
        var s = strings();
        if (!s) return text;
        if (s['msg/' + text] !== undefined && s['msg/' + text] !== '') return s['msg/' + text];
        if (depth > 3) return text;
        if (patterns === null) compilePatterns();
        for (var i = 0; i < patterns.length; i++) {
            var m = text.match(patterns[i].re);
            if (!m) continue;
            var out = patterns[i].out;
            if (!out) return text;
            patterns[i].order.forEach(function (slot, idx) {
                out = out.split('{' + slot + '}').join(tr(m[idx + 1], depth + 1));
            });
            return out;
        }
        return text;
    }

    function state(name) {
        if (!name) return '';
        return t('cluster/state/' + String(name).toLowerCase(), String(name).toUpperCase());
    }

    function init(callback) {
        var done = false;
        function finish() {
            if (done) return;
            done = true;
            if (callback) callback();
        }
        if (typeof NewAppLocale !== 'function' || typeof $ === 'undefined') { finish(); return; }
        loc = NewAppLocale();
        loc.init('../locale/cluster.json', function () {
            patterns = null;
            try { loc.translate(); } catch (e) {}
            finish();
        });
        //Never hold the page back if the locale file is missing
        setTimeout(finish, 1500);
    }

    /* Theme */
    function applyTheme(rootId) {
        var root = document.getElementById(rootId);
        var set = function (isDark) { if (root) root.classList.toggle('dark', isDark); };
        try {
            if (typeof ao_module_getSystemThemeColor === 'function') {
                ao_module_getSystemThemeColor(function (c) { set(c !== 'whiteTheme'); });
            } else {
                var theme = null;
                if (typeof preferredTheme !== 'undefined') theme = preferredTheme;
                else if (parent && typeof parent.preferredTheme !== 'undefined') theme = parent.preferredTheme;
                if (theme) set(theme === 'dark' || theme === 'darkTheme');
            }
        } catch (e) {}
        window.detailPageThemeCallback = function (isDark) { set(isDark); };
    }

    /* Formatting */
    function esc(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtBytes(b) {
        if (!b || b <= 0) return '-';
        var u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'], i = 0;
        while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
        return (i === 0 ? b : b.toFixed(1)) + ' ' + u[i];
    }
    function fmtAgo(unix) {
        if (!unix) return t('cluster/never', 'never');
        var d = Math.max(0, Math.floor(Date.now() / 1000 - unix));
        if (d < 5) return t('cluster/justnow', 'just now');
        var n, unit;
        if (d < 60) { n = d; unit = 's'; }
        else if (d < 3600) { n = Math.floor(d / 60); unit = 'm'; }
        else if (d < 86400) { n = Math.floor(d / 3600); unit = 'h'; }
        else { n = Math.floor(d / 86400); unit = 'd'; }
        return t('cluster/ago/' + unit, '{0}' + unit + ' ago').replace('{0}', n);
    }
    function fmtDate(unix) { return unix ? new Date(unix * 1000).toLocaleString() : '-'; }
    function bar(pct) {
        var cls = pct >= 95 ? 'bad' : (pct >= 80 ? 'warn' : '');
        return '<div class="cl-bar ' + cls + '"><div style="width:' + Math.min(100, Math.max(0, pct)).toFixed(0) + '%"></div></div>';
    }
    //Fill {0}, {1}, ... in a translated string
    function fmt(template) {
        var args = Array.prototype.slice.call(arguments, 1);
        return String(template).replace(/\{(\d)\}/g, function (m, i) { return args[i] !== undefined ? args[i] : m; });
    }

    /* Requests */
    function apiPost(url, data, cb) {
        $.ajax({ url: url, method: 'POST', data: data, dataType: 'json' })
            .done(function (r) { cb(null, r); })
            .fail(function (xhr) {
                var msg = xhr.responseText || t('cluster/requestfailed', 'Request failed');
                try { var j = JSON.parse(xhr.responseText); if (j.error) msg = j.error; } catch (e) {}
                cb(msg, null);
            });
    }
    function apiResult(r) { return (r && typeof r === 'object' && r.error) ? r.error : null; }

    //Show a message in a .cl-msg / .cj-msg box. Errors from the server are
    //translated here, so every caller gets it for free.
    function showMsg(id, text, ok, cls) {
        var el = document.getElementById(id);
        if (!el) return;
        cls = cls || 'cl-msg';
        el.textContent = ok ? text : tr(text);
        el.className = cls + ' ' + (ok ? 'ok' : 'err');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.className = cls; }, ok ? 4000 : 8000);
    }

    /*
        System Settings loads each tab into its own page with jQuery .load,
        so relative links would resolve against /SystemAO/system_setting/
        and timers would outlive the tab. These two helpers handle both.
    */

    //Open another cluster page: switch tabs inside System Settings, or
    //follow the link when the page was opened on its own.
    function openPage(settingName, href) {
        try {
            if (typeof loadViaSystemSetting !== 'undefined' && loadViaSystemSetting && typeof openSubcat === 'function' && typeof currentSubcats !== 'undefined' && currentSubcats) {
                for (var i = 0; i < currentSubcats.length; i++) {
                    if (currentSubcats[i].Name === settingName) { openSubcat(currentSubcats[i]); return false; }
                }
            }
        } catch (e) {}
        window.location.href = href;
        return false;
    }

    //Run fn every ms while the page root is on screen. Once the tab is
    //replaced (another settings tab, or this one reopened) the timer stops
    //itself instead of piling up.
    function every(fn, ms, rootId) {
        var root = document.getElementById(rootId);
        var handle = setInterval(function () {
            if (!root || !document.body.contains(root)) { clearInterval(handle); return; }
            fn();
        }, ms);
        return handle;
    }

    return {
        openPage: openPage, every: every,
        init: init, t: t, tr: tr, state: state, fmt: fmt,
        applyTheme: applyTheme, esc: esc, fmtBytes: fmtBytes, fmtAgo: fmtAgo, fmtDate: fmtDate, bar: bar,
        apiPost: apiPost, apiResult: apiResult, showMsg: showMsg
    };
})();
