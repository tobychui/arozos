/*
    Blocky - touch.js

    On-screen controls for phones and tablets: a movement stick on the
    left, drag anywhere on the right to look, tap to place / use, press and
    hold to mine, plus jump, sneak, inventory and pause buttons. The hotbar
    can be tapped directly.
*/

export function setupTouch(app) {
    const input = app.input;
    const stick = document.getElementById("stick");
    const knob = document.getElementById("stickKnob");
    const pad = document.getElementById("lookpad");
    let stickId = null, sx = 0, sy = 0;

    stick.addEventListener("touchstart", (e) => {
        const t = e.changedTouches[0];
        stickId = t.identifier;
        const r = stick.getBoundingClientRect();
        sx = r.left + r.width / 2;
        sy = r.top + r.height / 2;
        e.preventDefault();
    }, { passive: false });
    stick.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== stickId) {
                continue;
            }
            let dx = t.clientX - sx, dy = t.clientY - sy;
            const len = Math.hypot(dx, dy), max = 50;
            if (len > max) {
                dx = dx / len * max;
                dy = dy / len * max;
            }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            input.touchMove.forward = -dy / max;
            input.touchMove.strafe = dx / max;
        }
        e.preventDefault();
    }, { passive: false });
    const endStick = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === stickId) {
                stickId = null;
                knob.style.transform = "";
                input.touchMove.forward = 0;
                input.touchMove.strafe = 0;
            }
        }
    };
    stick.addEventListener("touchend", endStick);
    stick.addEventListener("touchcancel", endStick);

    let lookId = null, lx = 0, ly = 0, moved = 0, holdTimer = null, startT = 0;
    pad.addEventListener("touchstart", (e) => {
        const t = e.changedTouches[0];
        lookId = t.identifier;
        lx = t.clientX;
        ly = t.clientY;
        moved = 0;
        startT = performance.now();
        holdTimer = setTimeout(() => {
            if (app.game && moved < 12) {
                app.game.touchBreak = true;
            }
        }, 280);
        e.preventDefault();
    }, { passive: false });
    pad.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== lookId) {
                continue;
            }
            const dx = t.clientX - lx, dy = t.clientY - ly;
            lx = t.clientX;
            ly = t.clientY;
            moved += Math.abs(dx) + Math.abs(dy);
            if (app.game) {
                const s = 0.006 * app.settings.sensitivity;
                const cur = app.game.touchLook || [0, 0];
                app.game.touchLook = [cur[0] + dx * s, cur[1] + dy * s];
            }
        }
        e.preventDefault();
    }, { passive: false });
    const endLook = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== lookId) {
                continue;
            }
            clearTimeout(holdTimer);
            lookId = null;
            if (app.game) {
                if (!app.game.touchBreak && moved < 12 && performance.now() - startT < 280) {
                    app.game.touchUse = true;
                }
                app.game.touchBreak = false;
            }
        }
    };
    pad.addEventListener("touchend", endLook);
    pad.addEventListener("touchcancel", endLook);

    const hold = (id, on, off) => {
        const el = document.getElementById(id);
        el.addEventListener("touchstart", (e) => {
            on();
            e.preventDefault();
        }, { passive: false });
        el.addEventListener("touchend", (e) => {
            off();
            e.preventDefault();
        }, { passive: false });
    };
    let lastJump = 0;
    hold("tJump", () => {
        input.touchJump = true;
        const now = performance.now();
        if (now - lastJump < 300 && app.game && app.game.creative) {
            app.game.player.flying = !app.game.player.flying;
        }
        lastJump = now;
    }, () => {
        input.touchJump = false;
    });
    hold("tSneak", () => {
        input.touchSneak = !input.touchSneak;
        document.getElementById("tSneak").classList.toggle("on", input.touchSneak);
    }, () => {});
    hold("tInv", () => {
        if (!app.game) {
            return;
        }
        if (app.ui.isOpen()) {
            app.game.closeScreen();
        } else {
            app.game.openScreen("inventory");
        }
    }, () => {});
    hold("tPause", () => {
        if (app.game && !app.game.paused) {
            app.pause();
        }
    }, () => {});

    //Hotbar taps
    document.getElementById("hotbar").addEventListener("touchstart", (e) => {
        const slot = e.target.closest(".slot");
        if (slot && app.game) {
            app.game.inventory.selected = Number(slot.dataset.ref.split(":")[1]);
            e.preventDefault();
        }
    }, { passive: false });
}
