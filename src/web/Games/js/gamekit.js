/*
    gamekit.js

    Shared runtime for the canvas games in the Games module.

    Every game keeps its own fixed internal resolution (so the physics and
    collision code stay in whole pixels) and this file takes care of the parts
    they all need:

      GameKit.load()      preload the cropped sprite PNGs from img/sprites/
      GameKit.autoFit()   scale the canvas to whatever room the window has
      GameKit.pointer()   map a mouse/touch event back into game coordinates
      GameKit.pixelate()  turn off smoothing so upscaled sprites stay crisp
      GameKit.gate()      the "start game" screen, so nothing runs until the
                          player is actually ready

    Sprites are pre-cropped files, not slices taken at draw time -- the cutting
    happens once, offline, so nothing here has to know sheet coordinates.
*/

var GameKit = (function () {
    'use strict';

    var SPRITE_ROOT = 'img/sprites/';

    /*
        load takes { name: 'dino/run_a.png', ... } and calls back with
        { name: <HTMLImageElement> } once every file has settled. A sprite that
        fails to load still resolves -- a missing PNG should not freeze a game,
        the draw helper simply skips it.
    */
    function load(map, onReady) {
        var names = Object.keys(map);
        var out = {};
        var pending = names.length;

        if (pending === 0) {
            onReady(out);
            return out;
        }

        names.forEach(function (name) {
            var img = new Image();
            img.onload = img.onerror = function () {
                pending--;
                if (pending === 0) {
                    onReady(out);
                }
            };
            img.src = SPRITE_ROOT + map[name];
            out[name] = img;
        });

        return out;
    }

    /* pixelate keeps sprite upscaling hard-edged instead of blurry. */
    function pixelate(ctx) {
        ctx.imageSmoothingEnabled = false;
        ctx.mozImageSmoothingEnabled = false;
        ctx.webkitImageSmoothingEnabled = false;
        ctx.msImageSmoothingEnabled = false;
    }

    /*
        draw blits a sprite into a box, letterboxed to the sprite's own aspect
        ratio so nothing ends up stretched. Silently does nothing when the
        image has not decoded yet.
    */
    function draw(ctx, img, x, y, w, h) {
        if (!img || !img.complete || !img.naturalWidth) {
            return false;
        }
        var scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        var dw = Math.max(1, Math.round(img.naturalWidth * scale));
        var dh = Math.max(1, Math.round(img.naturalHeight * scale));
        ctx.drawImage(img, Math.round(x + (w - dw) / 2), Math.round(y + (h - dh) / 2), dw, dh);
        return true;
    }

    /*
        stretch fills the whole box, ignoring the sprite's aspect ratio. Use it
        for tiles and pipe caps that are meant to span a fixed width.
    */
    function stretch(ctx, img, x, y, w, h) {
        if (!img || !img.complete || !img.naturalWidth || w <= 0 || h <= 0) {
            return false;
        }
        ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        return true;
    }

    /* drawFlipped is draw() mirrored horizontally, for sprites that face one way. */
    function drawFlipped(ctx, img, x, y, w, h) {
        if (!img || !img.complete || !img.naturalWidth) {
            return false;
        }
        ctx.save();
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        draw(ctx, img, 0, 0, w, h);
        ctx.restore();
        return true;
    }

    /* docTop is the element's distance from the top of the document. */
    function docTop(el) {
        var y = 0;
        while (el) {
            y += el.offsetTop;
            el = el.offsetParent;
        }
        return y;
    }

    /*
        autoFit scales the canvas with CSS while leaving its backing resolution
        alone, so the game keeps drawing at its native size and the browser does
        the stretching. Re-runs on resize and orientation change.

        opts.maxScale   never blow the art up past this (default 3)
        opts.reserveH   pixels to leave below the canvas for on-screen controls
    */
    function autoFit(canvas, opts) {
        opts = opts || {};
        var baseW = canvas.width;
        var baseH = canvas.height;
        var maxScale = opts.maxScale || 3;
        var minScale = opts.minScale || 0.35;
        var reserveH = opts.reserveH === undefined ? 28 : opts.reserveH;

        var lastScale = 0;

        function apply() {
            var screen = canvas.closest('.px-screen') || document.body;
            var availW = Math.min(screen.clientWidth, document.documentElement.clientWidth) - 16;

            /* A side panel sits beside the canvas until the layout wraps. */
            var layout = canvas.closest('.game-layout');
            if (layout) {
                var panel = layout.querySelector('.side-panel');
                if (panel && layout.clientWidth > 720) {
                    availW -= panel.offsetWidth + 32;
                }
            }

            var availH = window.innerHeight - docTop(canvas) - reserveH;
            var scale = Math.min(availW / baseW, availH / baseH, maxScale);
            if (!isFinite(scale) || scale <= 0) {
                scale = 1;
            }
            scale = Math.max(scale, minScale);

            /*
                Ignore hair-thin changes. Resizing the canvas can add or remove
                the page scrollbar, which fires another resize -- without this
                guard the two sizes flip-flop forever and peg the renderer.
            */
            if (Math.abs(scale - lastScale) < 0.02) {
                return;
            }
            lastScale = scale;

            canvas.style.width = Math.round(baseW * scale) + 'px';
            canvas.style.height = Math.round(baseH * scale) + 'px';
        }

        apply();

        var timer = null;
        function schedule() {
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(apply, 80);
        }

        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);
        return apply;
    }

    /*
        pointer converts a mouse or touch event into the canvas's own
        coordinate space, which no longer matches CSS pixels once autoFit has
        scaled it.
    */
    function pointer(canvas, ev) {
        var rect = canvas.getBoundingClientRect();
        var src = ev;
        if (ev.touches && ev.touches.length) {
            src = ev.touches[0];
        }
        return {
            x: (src.clientX - rect.left) * (canvas.width / rect.width),
            y: (src.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    /*
        gate builds the pre-game screen. Games call GameKit.gate({...}) instead
        of starting themselves on load, so the player presses Start before the
        clock, the falling blocks or the aliens begin to move.

        opts.title / opts.hint   text for the panel
        opts.onStart             run when the player commits
    */
    function gate(opts) {
        var overlay = document.getElementById('startOverlay');
        if (!overlay) {
            return { show: function () {}, hide: function () {} };
        }

        var titleEl = overlay.querySelector('[data-gate-title]');
        var hintEl = overlay.querySelector('[data-gate-hint]');
        var startEl = overlay.querySelector('[data-gate-start]');

        if (titleEl && opts.title) {
            titleEl.textContent = opts.title;
        }
        if (hintEl && opts.hint) {
            hintEl.textContent = opts.hint;
        }

        function hide() {
            overlay.classList.add('hidden');
        }

        function show() {
            overlay.classList.remove('hidden');
        }

        if (startEl) {
            startEl.addEventListener('click', function () {
                hide();
                opts.onStart();
            });
        }

        return { show: show, hide: hide };
    }

    return {
        load: load,
        pixelate: pixelate,
        draw: draw,
        stretch: stretch,
        drawFlipped: drawFlipped,
        autoFit: autoFit,
        pointer: pointer,
        gate: gate
    };
}());
