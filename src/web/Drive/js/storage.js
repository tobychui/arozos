/*
    storage.js

    The Storage page (#/storage): how much of the pool the user has used and
    by what kind of file, ways to free space (empty the trash, drop old
    version history, review duplicate photos), the largest files, and the
    storage pool the drive lives on.

    The numbers come from backend/storage.agi, which reads only the user's
    own files. Disk health uses the SMART endpoint when the server exposes it
    to signed-in users; otherwise the volumes from the AGI sysinfo library
    are shown.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var TYPES = [
        ["videos", "cat/videos", "Videos", "#6d28d9"],
        ["photos", "cat/photos", "Photos", "#0891b2"],
        ["documents", "cat/documents", "Documents", "#1d4ed8"],
        ["music", "cat/music", "Music", "#db2777"],
        ["others", "cat/others", "Others", "var(--stg-others)"],
        ["trash", "nav/trash", "Trash", "#94a3b8"]
    ];

    var token = 0;
    var dupCache = null;

    function size(n) {
        return DriveUI.fmtSize(n || 0);
    }

    function card(cls, inner) {
        return '<section class="stg-card ' + cls + '">' + inner + '</section>';
    }

    function render(container) {
        var my = ++token;
        container.innerHTML = '<div class="stg">' +
            card("stg-usage", '<div class="stg-skel" style="height:40px;width:40%"></div><div class="stg-skel" style="height:12px;margin-top:20px"></div><div class="stg-skel" style="height:14px;width:70%;margin-top:16px"></div>') +
            '<div class="stg-grid">' + card("", '<div class="stg-skel" style="height:150px"></div>') + card("", '<div class="stg-skel" style="height:150px"></div>') + '</div></div>';
        API.agi("storage.agi", { opr: "analyze" }).then(function (data) {
            if (my != token) {
                return;
            }
            paint(container, data, my);
        }).catch(function (err) {
            if (my != token) {
                return;
            }
            container.innerHTML = '<div class="state">' + I("alert", { size: 40 }) + '<h3>' + esc(T("stg/failed", "Storage details are not available")) + '</h3><p>' + esc(err.message) + '</p></div>';
        });
    }

    function paint(container, d, my) {
        var trashSize = d.trash.size;
        var used = 0;
        TYPES.forEach(function (t) {
            used += t[0] == "trash" ? trashSize : (d.types[t[0]] ? d.types[t[0]].size : 0);
        });
        //Version history and thumbnail caches count as "Others"
        var others = (d.types.others ? d.types.others.size : 0) + d.versions.size + d.cache.size;
        used += d.versions.size + d.cache.size;
        var quota = d.quota && d.quota.total > 0 ? d.quota.total : 0;
        var reported = Math.max(used, d.quota ? d.quota.used : 0);

        var value = function (key) {
            if (key == "trash") {
                return trashSize;
            }
            if (key == "others") {
                return others;
            }
            return d.types[key] ? d.types[key].size : 0;
        };

        var scale = quota || used || 1;
        var bar = TYPES.map(function (t) {
            var v = value(t[0]);
            if (v <= 0) {
                return "";
            }
            return '<i style="width:' + Math.max(0.4, v / scale * 100) + '%;background:' + t[3] + '" title="' + esc(T(t[1], t[2]) + ": " + size(v)) + '"></i>';
        }).join("");
        var legend = TYPES.map(function (t) {
            return '<span class="stg-leg"><i style="background:' + t[3] + '"></i>' + esc(T(t[1], t[2])) + '<b>' + esc(size(value(t[0]))) + '</b></span>';
        }).join("");

        var head = '<div class="stg-head"><div><span class="stg-big">' + esc(size(reported)) + '</span>' +
            '<span class="stg-of">' + esc(quota ? T("stg/usedOf", "used of {total}", { total: size(quota) }) : T("stg/usedNoQuota", "used · no quota limit")) + '</span></div>' +
            (quota ? '<span class="stg-free">' + esc(T("stg/free", "{size} free", { size: size(Math.max(0, quota - reported)) })) + '</span>' : "") + '</div>' +
            '<div class="stg-bar">' + bar + '</div><div class="stg-caption">' + esc(T("stg/caption", "Bar shows how your used space splits by type.")) + '</div>' +
            '<div class="stg-legend">' + legend + '</div>' +
            (d.truncated ? '<div class="banner info" style="margin:14px 0 0">' + I("info") + '<span>' + esc(T("stg/truncated", "Your drive is large: these figures cover the part scanned so far.")) + '</span></div>' : "");

        var free = '<h3>' + esc(T("stg/freeUp", "Free up space")) + '</h3>' +
            row("trash", T("trash/empty", "Empty trash"), T("stg/trashSub", "{n} items · {size}", { n: d.trash.count, size: size(trashSize) }),
                '<button class="btn small" data-act="trash"' + (d.trash.count && API.caps.fm ? "" : " disabled") + '>' + esc(T("stg/empty", "Empty")) + '</button>') +
            row("history", T("stg/oldVersions", "Old file versions"), T("stg/versionsSub", "Versions older than 30 days · {size}", { size: size(d.versions.oldSize) }),
                '<button class="btn small" data-act="versions"' + (d.versions.oldCount ? "" : " disabled") + '>' + esc(T("stg/remove", "Remove")) + '</button>') +
            row("copy", T("stg/duplicates", "Duplicate photos"), '<span data-dup-sub>' + esc(T("stg/scanning", "Looking for duplicates...")) + '</span>',
                '<button class="btn small" data-act="dups" disabled>' + esc(T("stg/review", "Review")) + '</button>');

        var largest = '<h3>' + esc(T("stg/largest", "Largest files")) + '</h3>' + (d.largest.length ? d.largest.slice(0, 6).map(function (f, n) {
            var where = f.where == "trash" ? T("nav/trash", "Trash") : Drive.locationLabel(f.path);
            return '<button class="stg-row stg-file" data-n="' + n + '"><span class="stg-ft">' + DriveIcons.file(f.name, false) + '</span>' +
                '<span class="stg-txt"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><small>' + esc(where) + '</small></span><span class="stg-size">' + esc(size(f.size)) + '</span></button>';
        }).join("") : '<p class="muted">' + esc(T("stg/noFiles", "No files yet.")) + '</p>');

        container.innerHTML = '<div class="stg">' + card("stg-usage", head) +
            '<div class="stg-grid">' + card("stg-free-card", free) + card("", largest) + '</div>' +
            card("stg-pool", '<h3>' + esc(T("stg/pool", "Storage pool")) + '</h3><div class="stg-pool-sub">' + esc(poolText(d.pool)) + '</div><div data-disks>' + disksHTML(d.disks, null) + '</div>') +
            '</div>';

        container.querySelectorAll(".stg-file").forEach(function (b) {
            b.addEventListener("click", function () {
                var f = d.largest[parseInt(b.getAttribute("data-n"), 10)];
                if (f.where == "trash") {
                    location.hash = "#/trash";
                } else {
                    location.hash = Drive.folderRoute(API.parentOf(f.path));
                    setTimeout(function () {
                        Drive.setSelection([f.path], { anchor: f.path, focus: f.path });
                        var n = DriveList.nodeFor(f.path);
                        if (n) {
                            n.scrollIntoView({ block: "center" });
                        }
                    }, 700);
                }
            });
        });
        container.querySelector('[data-act="trash"]').addEventListener("click", function () {
            DriveActions.emptyTrash();
            setTimeout(function () {
                if (location.hash == "#/storage") {
                    render(container);
                }
            }, 2500);
        });
        container.querySelector('[data-act="versions"]').addEventListener("click", function () {
            DriveUI.confirm({
                title: T("stg/removeVersionsTitle", "Remove old versions?"),
                message: T("stg/removeVersionsText", "{n} saved versions older than 30 days ({size}) will be deleted. Current files stay as they are.", { n: d.versions.oldCount, size: size(d.versions.oldSize) }),
                ok: T("stg/remove", "Remove"), danger: true
            }).then(function (ok) {
                if (!ok) {
                    return;
                }
                API.agi("storage.agi", { opr: "purgeVersions", days: 30 }).then(function (r) {
                    DriveUI.toast(T("stg/freed", "Freed {size}", { size: size(r.freed) }), { type: "success" });
                    Drive.refreshQuota();
                    render(container);
                }).catch(DriveUI.error);
            });
        });

        loadDuplicates(container, my);
        loadSmart(container, d, my);
    }

    function row(icon, title, sub, action) {
        return '<div class="stg-row"><span class="stg-ic">' + I(icon) + '</span><span class="stg-txt"><b>' + esc(title) + '</b><small>' + sub + '</small></span>' + action + '</div>';
    }

    function poolText(pool) {
        if (!pool) {
            return "";
        }
        var bits = [pool.name];
        if (pool.path) {
            bits.push(pool.path);
        }
        if (pool.fs) {
            bits.push(pool.fs);
        }
        return bits.join(" · ");
    }

    function disksHTML(volumes, smart) {
        if (smart && smart.length) {
            return smart.map(function (dev, n) {
                var s = dev.smart || {};
                var ok = !s.smart_status || s.smart_status.passed !== false;
                var meta = [dev.name];
                if (s.temperature && s.temperature.current) {
                    meta.push(s.temperature.current + " °C");
                }
                if (s.power_on_time && s.power_on_time.hours) {
                    meta.push(T("stg/hours", "{n} hours", { n: Number(s.power_on_time.hours).toLocaleString() }));
                }
                return '<div class="stg-row"><span class="stg-ic">' + I("drive") + '</span><span class="stg-txt"><b>' +
                    esc(T("stg/disk", "Disk {n}", { n: n + 1 }) + (s.model_name ? " · " + s.model_name : "")) + '</b><small>' + esc(meta.join(" · ")) + '</small></span>' +
                    '<span class="chip ' + (ok ? "success" : "danger") + '">' + esc(ok ? T("stg/healthy", "Healthy") : T("stg/checkDisk", "Check disk")) + '</span></div>';
            }).join("");
        }
        volumes = (volumes || []).filter(function (v) { return v.Volume > 0; });
        if (!volumes.length) {
            return '<p class="muted" style="margin:6px 0 0">' + esc(T("stg/noPool", "Disk details are not available on this server.")) + '</p>';
        }
        return volumes.map(function (v) {
            var pct = v.Volume ? v.Used / v.Volume * 100 : 0;
            var label = v.MountPoint && v.MountPoint != v.Device ? v.Device + " (" + v.MountPoint + ")" : v.Device;
            return '<div class="stg-row"><span class="stg-ic">' + I("drive") + '</span><span class="stg-txt"><b>' + esc(label) + '</b>' +
                '<small>' + esc(T("stg/volUsed", "{used} of {total} used", { used: size(v.Used), total: size(v.Volume) })) + '</small>' +
                '<span class="stg-mini"><i style="width:' + Math.min(100, pct).toFixed(1) + '%" class="' + (pct > 90 ? "full" : pct > 75 ? "warn" : "") + '"></i></span></span>' +
                '<span class="chip ' + (pct > 90 ? "danger" : pct > 75 ? "warning" : "success") + '">' + esc(pct > 90 ? T("stg/almostFull", "Almost full") : Math.round(pct) + "%") + '</span></div>';
        }).join("");
    }

    function loadSmart(container, d, my) {
        API.request({ url: "system/disk/smart/getSMART" }).then(function (r) {
            if (my != token || !r || !Array.isArray(r.devices) || !r.devices.length) {
                return;
            }
            var box = container.querySelector("[data-disks]");
            if (box) {
                box.innerHTML = disksHTML(d.disks, r.devices);
            }
        }).catch(function () { });
    }

    function loadDuplicates(container, my) {
        var p = dupCache && Date.now() - dupCache.at < 120000 ? Promise.resolve(dupCache.data) : API.agi("storage.agi", { opr: "duplicates" }).then(function (r) {
            dupCache = { at: Date.now(), data: r };
            return r;
        });
        p.then(function (r) {
            if (my != token) {
                return;
            }
            var sub = container.querySelector("[data-dup-sub]");
            var btn = container.querySelector('[data-act="dups"]');
            if (!sub) {
                return;
            }
            sub.textContent = r.copies ? T("stg/dupSub", "{n} exact copies · {size}", { n: r.copies, size: size(r.wasted) }) : T("stg/noDup", "No duplicate photos found");
            btn.disabled = !r.copies;
            btn.onclick = function () { review(r, container); };
        }).catch(function () {
            var sub = container.querySelector("[data-dup-sub]");
            if (sub) {
                sub.textContent = T("stg/dupFailed", "Could not check for duplicates");
            }
        });
    }

    function review(r, container) {
        var body = DriveUI.el('<div class="stg-dups"></div>');
        r.groups.slice(0, 200).forEach(function (g, gi) {
            var html = '<div class="stg-dup"><div class="stg-dup-head">' + esc(T("stg/copiesOf", "{n} copies · {size} each", { n: g.files.length, size: size(g.size) })) + '</div>';
            g.files.forEach(function (f, fi) {
                html += '<label class="stg-dup-file"><input type="checkbox" class="check" data-g="' + gi + '" data-f="' + fi + '"' + (fi > 0 ? " checked" : "") + '>' +
                    '<span class="stg-dup-thumb" data-thumb="' + esc(f.path) + '">' + DriveIcons.file(f.name, false) + '</span>' +
                    '<span class="stg-txt"><b title="' + esc(f.name) + '">' + esc(f.name) + '</b><small>' + esc(Drive.locationLabel(f.path) + " · " + DriveUI.fmtDate(f.mtime)) + '</small></span>' +
                    (fi == 0 ? '<span class="chip accent">' + esc(T("stg/oldest", "Oldest")) + '</span>' : "") + '</label>';
            });
            body.insertAdjacentHTML("beforeend", html + '</div>');
        });
        var ctx = DriveUI.modal({
            title: T("stg/dupTitle", "Duplicate photos"),
            icon: "copy",
            size: "wide",
            body: '<p>' + esc(T("stg/dupHelp", "Checked copies move to the trash. Each group keeps at least one copy.")) + '</p>',
            buttons: [
                { label: T("common/cancel", "Cancel") },
                {
                    label: T("stg/trashCopies", "Move checked copies to trash"), cls: "danger", action: function (c) {
                        var paths = [];
                        var blocked = false;
                        r.groups.forEach(function (g, gi) {
                            var picks = c.body.querySelectorAll('input[data-g="' + gi + '"]');
                            var checked = Array.prototype.filter.call(picks, function (i) { return i.checked; });
                            if (picks.length && checked.length == picks.length) {
                                blocked = true;
                            }
                            checked.forEach(function (i) { paths.push(g.files[parseInt(i.getAttribute("data-f"), 10)]); });
                        });
                        if (blocked) {
                            DriveUI.toast(T("stg/keepOne", "Keep at least one copy in every group"), { type: "error" });
                            return false;
                        }
                        if (!paths.length) {
                            return false;
                        }
                        DriveActions.trash(paths.map(function (f) { return { name: f.name, path: f.path, isDir: false, size: f.size }; }));
                        dupCache = null;
                        setTimeout(function () {
                            if (location.hash == "#/storage") {
                                render(container);
                            }
                        }, 2000);
                    }
                }
            ]
        });
        ctx.body.appendChild(body);
        //Thumbnails for the copies that are on screen
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (!en.isIntersecting) {
                    return;
                }
                io.unobserve(en.target);
                var path = en.target.getAttribute("data-thumb");
                var load = API.caps.fm ? Promise.resolve(API.thumbURL(path)) : API.thumbFallback(path);
                load.then(function (src) {
                    if (!src) {
                        return;
                    }
                    var img = new Image();
                    img.onload = function () {
                        en.target.innerHTML = "";
                        en.target.appendChild(img);
                    };
                    img.src = src;
                });
            });
        }, { root: ctx.body });
        ctx.body.querySelectorAll("[data-thumb]").forEach(function (t) { io.observe(t); });
    }

    global.DriveStorage = {
        render: render
    };
})(window);
