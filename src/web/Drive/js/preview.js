/*
    preview.js

    A full window previewer for the files a browser can show by itself:
    images (zoom, rotate), video, audio, PDF and text / code. Arrow keys and
    swipes step through the other previewable files of the current list.
    Anything else gets "open with" and download buttons.
*/

(function (global) {
    "use strict";

    var I = DriveUI.I;
    var esc = DriveUI.esc;
    var API = DriveAPI;

    var TEXT_LIMIT = 2 * 1024 * 1024;
    var IMAGE = "jpg jpeg png gif bmp webp svg ico avif jfif cr2 nef arw dng raw".split(" ");
    var VIDEO = "mp4 webm ogv mov m4v mkv".split(" ");
    var AUDIO = "mp3 wav ogg oga m4a aac flac opus".split(" ");
    var TEXT_EXTRA = "csv tsv srt vtt ass".split(" ");

    var node = null;
    var current = null;
    var list = [];
    var zoom = 1;
    var rotation = 0;

    function kind(item) {
        if (!item || item.isDir) {
            return null;
        }
        var ext = DriveIcons.getExt(item.name);
        if (IMAGE.indexOf(ext) >= 0) {
            return "image";
        }
        if (VIDEO.indexOf(ext) >= 0) {
            return "video";
        }
        if (AUDIO.indexOf(ext) >= 0) {
            return "audio";
        }
        if (ext == "pdf") {
            return "pdf";
        }
        var cat = DriveIcons.category(item.name, false);
        if ((cat == "text" || cat == "code" || TEXT_EXTRA.indexOf(ext) >= 0) && (item.size == undefined || item.size <= TEXT_LIMIT)) {
            return "text";
        }
        return null;
    }

    function canPreview(item) {
        return kind(item) != null && !item.shareOnly;
    }

    function isOpen() {
        return node != null;
    }

    function close() {
        if (!node) {
            return;
        }
        node.querySelectorAll("video, audio").forEach(function (m) {
            try { m.pause(); } catch (e) { }
        });
        node.remove();
        node = null;
        current = null;
    }

    function siblings(item) {
        var src = Drive.state.sorted || [];
        var found = src.some(function (i) { return i.path == item.path; });
        if (!found) {
            return [item];
        }
        return src.filter(function (i) { return !i.isDir && !i.shareOnly; });
    }

    function open(item) {
        if (!item || item.isDir) {
            return;
        }
        list = siblings(item);
        if (!node) {
            node = DriveUI.el('<div class="preview" role="dialog" aria-modal="true"></div>');
            document.body.appendChild(node);
            bindSwipe(node);
        }
        show(item);
    }

    function step(delta) {
        if (!current || list.length < 2) {
            return;
        }
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
            if (list[i].path == current.path) {
                idx = i;
                break;
            }
        }
        var next = list[(idx + delta + list.length) % list.length];
        if (next) {
            show(next);
        }
    }

    function applyTransform() {
        var img = node && node.querySelector(".preview-stage img");
        if (img) {
            img.style.transform = "scale(" + zoom + ") rotate(" + rotation + "deg)";
        }
    }

    function show(item) {
        current = item;
        zoom = 1;
        rotation = 0;
        var k = kind(item);
        var url = API.mediaURL(item.path);
        var hasNav = list.length > 1;
        var canOpenWith = !item.trashed && DriveActions.compatibleModules(item).length > 0;
        node.innerHTML = '<div class="preview-bar"><span class="ft-box">' + DriveIcons.file(item.name, false) + '</span>' +
            '<div class="title"><b title="' + esc(item.name) + '">' + esc(item.name) + '</b><small>' + esc(DriveUI.fmtSize(item.size) + " · " + DriveList.typeLabel(item)) + '</small></div>' +
            (k == "image" ? '<button class="icon-btn hide-xs" data-act="zoomOut" title="' + esc(T("pv/zoomOut", "Zoom out")) + '">' + I("zoomOut") + '</button>' +
                '<button class="icon-btn hide-xs" data-act="zoomIn" title="' + esc(T("pv/zoomIn", "Zoom in")) + '">' + I("zoomIn") + '</button>' +
                '<button class="icon-btn" data-act="rotate" title="' + esc(T("pv/rotate", "Rotate")) + '">' + I("rotate") + '</button>' : "") +
            (canOpenWith ? '<button class="btn small hide-xs" data-act="openWith">' + I("apps") + '<span>' + esc(T("menu/openWith", "Open with")) + '</span>' + I("chevronDown", { cls: "caret" }) + '</button>' : "") +
            '<button class="icon-btn" data-act="download" title="' + esc(T("toolbar/download", "Download")) + '">' + I("download") + '</button>' +
            (!item.trashed ? '<button class="icon-btn hide-xs" data-act="share" title="' + esc(T("toolbar/share", "Share")) + '">' + I("link") + '</button>' : "") +
            '<button class="icon-btn" data-act="close" title="' + esc(T("common/close", "Close")) + '">' + I("x") + '</button></div>' +
            '<div class="preview-stage" data-stage></div>';
        var stage = node.querySelector("[data-stage]");

        if (k == "image") {
            stage.innerHTML = '<div class="spinner"></div>';
            var img = new Image();
            img.alt = item.name;
            img.onload = function () {
                if (current !== item) {
                    return;
                }
                stage.innerHTML = "";
                stage.appendChild(img);
                addNav(stage, hasNav);
            };
            img.onerror = function () {
                if (current === item) {
                    noPreview(stage, item, T("pv/cannotShow", "This image cannot be shown in the browser."));
                    addNav(stage, hasNav);
                }
            };
            img.src = url;
        } else if (k == "video") {
            stage.innerHTML = '<video src="' + esc(url) + '" controls autoplay playsinline></video>';
            stage.querySelector("video").addEventListener("error", function () {
                noPreview(stage, item, T("pv/cannotPlay", "This video format cannot be played in the browser."));
                addNav(stage, hasNav);
            });
            addNav(stage, hasNav);
        } else if (k == "audio") {
            stage.innerHTML = '<div class="preview-none"><div class="big">' + DriveIcons.file(item.name, false) + '</div><audio src="' + esc(url) + '" controls autoplay></audio></div>';
            addNav(stage, hasNav);
        } else if (k == "pdf") {
            stage.innerHTML = '<iframe src="' + esc(url) + '" title="' + esc(item.name) + '"></iframe>';
            addNav(stage, hasNav);
        } else if (k == "text") {
            stage.innerHTML = '<div class="spinner"></div>';
            API.readText(item.path).then(function (text) {
                if (current !== item) {
                    return;
                }
                var pre = document.createElement("pre");
                pre.textContent = text;
                stage.innerHTML = "";
                stage.appendChild(pre);
                addNav(stage, hasNav);
            }).catch(function (err) {
                if (current === item) {
                    noPreview(stage, item, err.message);
                }
            });
        } else {
            noPreview(stage, item, T("pv/none", "No preview available for this file type."));
            addNav(stage, hasNav);
        }

        node.querySelectorAll("[data-act]").forEach(function (b) {
            b.addEventListener("click", function () {
                var act = b.getAttribute("data-act");
                if (act == "close") {
                    close();
                } else if (act == "download") {
                    DriveActions.download([item]);
                } else if (act == "share") {
                    DriveShare.open(item);
                } else if (act == "openWith") {
                    DriveUI.menu({ anchor: b, align: "end" }, DriveActions.openWithItems(item).filter(function (x) {
                        return !(x && x.icon == "eye");
                    }).map(function (x) {
                        if (x && x.action) {
                            var fn = x.action;
                            x.action = function () { close(); fn(); };
                        }
                        return x;
                    }));
                } else if (act == "zoomIn") {
                    zoom = Math.min(6, zoom * 1.25);
                    applyTransform();
                } else if (act == "zoomOut") {
                    zoom = Math.max(0.2, zoom / 1.25);
                    applyTransform();
                } else if (act == "rotate") {
                    rotation = (rotation + 90) % 360;
                    applyTransform();
                }
            });
        });
    }

    function noPreview(stage, item, message) {
        stage.innerHTML = '<div class="preview-none"><div class="big">' + DriveIcons.file(item.name, false) + '</div><div>' + esc(message) + '</div>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">' +
            (!item.trashed ? '<button class="btn" data-np="open">' + I("apps") + esc(T("open/choose", "Choose another app...")) + '</button>' : "") +
            '<button class="btn" data-np="download">' + I("download") + esc(T("toolbar/download", "Download")) + '</button></div></div>';
        var o = stage.querySelector('[data-np="open"]');
        if (o) {
            o.addEventListener("click", function () {
                close();
                DriveActions.openWithChooser(item);
            });
        }
        stage.querySelector('[data-np="download"]').addEventListener("click", function () {
            DriveActions.download([item]);
        });
    }

    function addNav(stage, hasNav) {
        if (!hasNav || stage.querySelector(".preview-nav")) {
            return;
        }
        var prev = DriveUI.el('<button class="preview-nav prev" aria-label="' + esc(T("pv/prev", "Previous")) + '">' + I("chevronLeft") + '</button>');
        var next = DriveUI.el('<button class="preview-nav next" aria-label="' + esc(T("pv/next", "Next")) + '">' + I("chevronRight") + '</button>');
        prev.addEventListener("click", function () { step(-1); });
        next.addEventListener("click", function () { step(1); });
        stage.appendChild(prev);
        stage.appendChild(next);
    }

    function bindSwipe(el) {
        var sx = 0, sy = 0, tracking = false;
        el.addEventListener("touchstart", function (e) {
            if (e.touches.length != 1 || zoom != 1) {
                tracking = false;
                return;
            }
            tracking = true;
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
        }, { passive: true });
        el.addEventListener("touchend", function (e) {
            if (!tracking) {
                return;
            }
            tracking = false;
            var dx = e.changedTouches[0].clientX - sx;
            var dy = e.changedTouches[0].clientY - sy;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                step(dx < 0 ? 1 : -1);
            }
        });
    }

    function onKey(e) {
        if (DriveUI.topModal()) {
            if (e.key == "Escape") {
                DriveUI.topModal().close();
            }
            return;
        }
        var typing = e.target && (e.target.tagName == "INPUT" || e.target.tagName == "TEXTAREA");
        if (typing) {
            return;
        }
        if (e.key == "Escape") {
            close();
        } else if (e.key == "ArrowRight") {
            step(1);
        } else if (e.key == "ArrowLeft") {
            step(-1);
        } else if ((e.key == "+" || e.key == "=") && kind(current) == "image") {
            zoom = Math.min(6, zoom * 1.25);
            applyTransform();
        } else if (e.key == "-" && kind(current) == "image") {
            zoom = Math.max(0.2, zoom / 1.25);
            applyTransform();
        } else if (e.key == " " && kind(current) != "video" && kind(current) != "audio") {
            e.preventDefault();
            close();
        }
    }

    global.DrivePreview = {
        open: open,
        close: close,
        isOpen: isOpen,
        onKey: onKey,
        canPreview: canPreview,
        kind: kind
    };
})(window);
