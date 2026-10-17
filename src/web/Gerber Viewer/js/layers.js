/*
    Gerber Viewer - layer identification

    Decides what a file is (copper, mask, silkscreen, ...), which side it is
    on, and its default colour and stacking position. X2 FileFunction
    attributes win over file names; file names cover EasyEDA, KiCad, Altium /
    Protel, Eagle / Fusion, DipTrace, Proteus and generic naming.
*/
(function (GV) {
    'use strict';

    //type -> label, stack order (higher draws on top in the top view), default colour
    var TYPES = {
        'top-copper': { label: 'Top Copper', order: 60, color: '#e5484d', side: 'top', fn: 'copper' },
        'inner-copper': { label: 'Inner Copper', order: 40, color: '#d4a72c', side: 'inner', fn: 'copper' },
        'bottom-copper': { label: 'Bottom Copper', order: 30, color: '#3b74e8', side: 'bottom', fn: 'copper' },
        'top-mask': { label: 'Top Solder Mask', order: 70, color: '#3fae6a', side: 'top', fn: 'mask' },
        'bottom-mask': { label: 'Bottom Solder Mask', order: 20, color: '#9b5de5', side: 'bottom', fn: 'mask' },
        'top-paste': { label: 'Top Paste', order: 65, color: '#94a3b8', side: 'top', fn: 'paste' },
        'bottom-paste': { label: 'Bottom Paste', order: 25, color: '#64748b', side: 'bottom', fn: 'paste' },
        'top-silk': { label: 'Top Silkscreen', order: 80, color: '#f4f4f5', side: 'top', fn: 'silk' },
        'bottom-silk': { label: 'Bottom Silkscreen', order: 10, color: '#a1a1aa', side: 'bottom', fn: 'silk' },
        'top-assembly': { label: 'Top Assembly', order: 85, color: '#22d3ee', side: 'top', fn: 'document' },
        'bottom-assembly': { label: 'Bottom Assembly', order: 5, color: '#0ea5e9', side: 'bottom', fn: 'document' },
        'outline': { label: 'Board Outline', order: 100, color: '#e8e8ea', side: 'all', fn: 'outline' },
        'drill': { label: 'Drill', order: 95, color: '#f2b84b', side: 'all', fn: 'drill' },
        'keepout': { label: 'Keep-out', order: 90, color: '#f97316', side: 'all', fn: 'document' },
        'document': { label: 'Document', order: 2, color: '#c084fc', side: 'all', fn: 'document' },
        'other': { label: 'Unknown Layer', order: 1, color: '#9ca3af', side: 'all', fn: 'other' }
    };

    var TYPE_LIST = ['top-copper', 'inner-copper', 'bottom-copper', 'top-mask', 'bottom-mask', 'top-paste', 'bottom-paste',
        'top-silk', 'bottom-silk', 'top-assembly', 'bottom-assembly', 'outline', 'drill', 'keepout', 'document', 'other'];

    //Extensions that are never CAM data
    var NOT_CAM = /\.(pdf|png|jpe?g|gif|bmp|svg|webp|zip|7z|rar|gz|tgz|tar|step|stp|wrl|iges?|stl|xlsx?|csv|docx?|html?|json|xml|kicad_\w+|sch|brd|pcbdoc|schdoc|prjpcb|lib|ipc|ipc356|rep|apr|apt|drr|extrep|log|ini|md)$/i;

    function base(name) {
        return String(name).split(/[\\/]/).pop();
    }

    function ext(name) {
        var b = base(name);
        var i = b.lastIndexOf('.');
        return i < 0 ? '' : b.slice(i + 1).toLowerCase();
    }

    //Map an X2 FileFunction to a type
    function fromFileFunction(ff) {
        if (!ff) {
            return null;
        }
        var p = ff.split(',').map(function (s) { return s.trim(); });
        var f = p[0].toLowerCase();
        var side = (p[2] || p[1] || '').toLowerCase();
        var top = /top/.test(side), bot = /bot/.test(side);
        switch (f) {
            case 'copper':
                if (/inr/.test(side)) {
                    var n = parseInt((p[1] || '').replace(/\D/g, ''), 10);
                    return { type: 'inner-copper', index: isFinite(n) ? n : null };
                }
                return { type: top ? 'top-copper' : (bot ? 'bottom-copper' : 'inner-copper') };
            case 'soldermask':
                return { type: bot ? 'bottom-mask' : 'top-mask' };
            case 'paste':
                return { type: bot ? 'bottom-paste' : 'top-paste' };
            case 'legend':
                return { type: bot ? 'bottom-silk' : 'top-silk' };
            case 'profile':
                return { type: 'outline' };
            case 'plated':
            case 'nonplated':
                return { type: 'drill', plated: f === 'plated', via: /via/i.test(ff) };
            case 'assemblydrawing':
            case 'component':
                return { type: bot ? 'bottom-assembly' : 'top-assembly' };
            case 'keepout':
                return { type: 'keepout' };
            case 'otherdrawing':
            case 'drillmap':
            case 'fabricationdrawing':
            case 'other':
            case 'pads':
                return { type: 'document' };
        }
        return null;
    }

    //Patterns tested against the lower-case file name, first match wins
    var NAME_RULES = [
        //Outline / profile
        [/edge[._-]?cuts|board[_ -]?outline|outline|profile|\.gko$|\.gm1$|\.gml$|\.gm$|\.dim$|\.oln$|\.bor$|\.mill$|\.gbr\.?ol/, 'outline'],
        [/keep[_ -]?out|\.gkl$/, 'keepout'],
        //KiCad
        [/f[._]cu\b|f[._]cu\.|-f_cu|_f_cu/, 'top-copper'],
        [/b[._]cu\b|b[._]cu\.|-b_cu|_b_cu/, 'bottom-copper'],
        [/in(\d+)[._]cu/, 'inner-copper'],
        [/f[._]mask/, 'top-mask'],
        [/b[._]mask/, 'bottom-mask'],
        [/f[._]paste/, 'top-paste'],
        [/b[._]paste/, 'bottom-paste'],
        [/f[._]silk/, 'top-silk'],
        [/b[._]silk/, 'bottom-silk'],
        [/f[._]fab|f[._]courtyard|f[._]crtyd/, 'top-assembly'],
        [/b[._]fab|b[._]courtyard|b[._]crtyd/, 'bottom-assembly'],
        [/dwgs[._]user|cmts[._]user|user[._]drawings|user[._]comments|eco\d[._]user|margin/, 'document'],
        //Words (EasyEDA, generic)
        [/top[_ -]?silk|silk[_ -]?top|top[_ -]?overlay|overlay[_ -]?top|topsilkscreen|top[_ -]?legend|silkscreen[_ -]?top|\bsst\b|\.sst$/, 'top-silk'],
        [/bottom[_ -]?silk|silk[_ -]?bot|bot[_ -]?silk|bottom[_ -]?overlay|bottomsilkscreen|bottom[_ -]?legend|silkscreen[_ -]?bot|\.ssb$/, 'bottom-silk'],
        [/top[_ -]?(solder)?[_ -]?mask|solder[_ -]?mask[_ -]?top|topsoldermask|\.smt$|soldermask_top/, 'top-mask'],
        [/bottom[_ -]?(solder)?[_ -]?mask|bot[_ -]?mask|solder[_ -]?mask[_ -]?bot|bottomsoldermask|\.smb$|soldermask_bottom/, 'bottom-mask'],
        [/top[_ -]?paste|paste[_ -]?top|toppastemask|\.spt$|solderpaste_top/, 'top-paste'],
        [/bottom[_ -]?paste|bot[_ -]?paste|paste[_ -]?bot|bottompastemask|\.spb$|solderpaste_bottom/, 'bottom-paste'],
        [/inner[_ -]?(layer)?[_ -]?(\d+)|inner(\d+)|mid[_ -]?layer[_ -]?(\d+)|internal[_ -]?plane|\.g(\d+)$|\.gp(\d+)$|\.in(\d+)$|\.ly(\d+)$|\.l(\d+)$/, 'inner-copper'],
        [/top[_ -]?layer|top[_ -]?copper|copper[_ -]?top|\bcomponent\b|\bcomp\b|\.top$|\.cmp$|toplayer/, 'top-copper'],
        [/bottom[_ -]?layer|bot[_ -]?layer|bottom[_ -]?copper|copper[_ -]?bot|\bsolder\b|\.bot$|\.sol$|bottomlayer/, 'bottom-copper'],
        [/assembly[_ -]?top|top[_ -]?assembly|\.ast$/, 'top-assembly'],
        [/assembly[_ -]?bot|bottom[_ -]?assembly|\.asb$/, 'bottom-assembly'],
        [/document|drawing|mechanical|\.gdl$|\.gd\d*$|\.gg\d*$|\.gm\d+$|fab|comment/, 'document']
    ];

    var EXT_RULES = {
        gtl: 'top-copper', gbl: 'bottom-copper', gto: 'top-silk', gbo: 'bottom-silk',
        gts: 'top-mask', gbs: 'bottom-mask', gtp: 'top-paste', gbp: 'bottom-paste',
        gko: 'outline', gm1: 'outline', gml: 'outline', gdl: 'document', gtd: 'document', gbd: 'document',
        cmp: 'top-copper', sol: 'bottom-copper', plc: 'top-silk', pls: 'bottom-silk',
        stc: 'top-mask', sts: 'bottom-mask', crc: 'top-paste', crs: 'bottom-paste', dim: 'outline',
        gta: 'top-assembly', gba: 'bottom-assembly', gpt: 'top-copper', gpb: 'bottom-copper'
    };

    var DRILL_EXT = /^(drl|drd|xln|exc|ncd|nc|tap|txt|cnc|dri|tx\d|drill)$/;

    function identify(name, text, parsed) {
        var lower = base(name).toLowerCase();
        var e = ext(name);
        var info = null;

        if (parsed && parsed.attrs && parsed.attrs.FileFunction) {
            info = fromFileFunction(parsed.attrs.FileFunction);
        }
        if (!info && parsed && parsed.kind === 'drill') {
            info = { type: 'drill' };
        }
        if (!info && EXT_RULES[e]) {
            info = { type: EXT_RULES[e] };
        }
        if (!info) {
            for (var i = 0; i < NAME_RULES.length; i++) {
                var m = NAME_RULES[i][0].exec(lower);
                if (m) {
                    info = { type: NAME_RULES[i][1] };
                    if (info.type === 'inner-copper') {
                        for (var k = 1; k < m.length; k++) {
                            if (m[k] && /^\d+$/.test(m[k])) {
                                info.index = parseInt(m[k], 10);
                                break;
                            }
                        }
                    }
                    break;
                }
            }
        }
        if (!info && parsed && parsed.layerName) {
            info = identify(parsed.layerName + '.gbr', '', null);
            if (info.type === 'other') {
                info = null;
            }
        }
        if (!info) {
            info = { type: 'other' };
        }
        //Altium .G1 .. .G30 inner layers and GP planes
        if (info.type === 'inner-copper' && info.index === undefined) {
            var mm = /\.g(?:p)?(\d+)$/.exec(lower) || /in(\d+)/.exec(lower);
            if (mm) {
                info.index = parseInt(mm[1], 10);
            }
        }
        if (info.type === 'drill') {
            if (info.plated === undefined) {
                if (/npth|non[_ -]?plated|unplated|-np\b|_np\b/.test(lower)) {
                    info.plated = false;
                } else if (/pth|plated|via/.test(lower)) {
                    info.plated = true;
                } else if (parsed && parsed.plated !== undefined && parsed.plated !== null) {
                    info.plated = parsed.plated;
                }
            }
            if (info.via === undefined) {
                info.via = /via/.test(lower);
            }
        }
        return info;
    }

    function label(info) {
        var t = TYPES[info.type] || TYPES.other;
        if (info.type === 'inner-copper' && info.index) {
            return 'Inner Copper ' + info.index;
        }
        if (info.type === 'drill') {
            if (info.via) {
                return 'Drill (Vias)';
            }
            if (info.plated === true) {
                return 'Drill (PTH)';
            }
            if (info.plated === false) {
                return 'Drill (NPTH)';
            }
        }
        return t.label;
    }

    //Is this file name worth reading at all?
    function isCandidate(name) {
        var b = base(name);
        if (b.charAt(0) === '.' || /^__macosx/i.test(name) || /(^|\/)__MACOSX\//.test(name)) {
            return false;
        }
        return !NOT_CAM.test(b);
    }

    function sniff(text) {
        if (GV.excellon.looksLikeExcellon(text)) {
            return 'drill';
        }
        if (GV.gerber.looksLikeGerber(text)) {
            return 'gerber';
        }
        return null;
    }

    function info(type) {
        return TYPES[type] || TYPES.other;
    }

    GV.layers = {
        TYPES: TYPES,
        TYPE_LIST: TYPE_LIST,
        identify: identify,
        label: label,
        info: info,
        isCandidate: isCandidate,
        sniff: sniff,
        base: base,
        ext: ext,
        DRILL_EXT: DRILL_EXT
    };
})(typeof window !== 'undefined' ? (window.GV = window.GV || {}) : (global.GV = global.GV || {}));
