/*
    Blocky - input.js

    Keyboard and mouse state. Mouse look and buttons only count while the
    pointer is locked to the game canvas; key presses are collected as
    edges (pressed this frame) plus held state, with double tap detection
    for flying and sprinting.
*/

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F1", "F3", "Tab", "KeyQ", "KeyE", "Slash", "KeyT"]);

export class Input {
    constructor(canvas) {
        this.canvas = canvas;
        this.keys = new Set();
        this.pressed = new Set();
        this.doubleTaps = new Set();
        this.buttons = new Set();
        this.clicked = new Set();
        this.lastTap = {};
        this.dx = 0;
        this.dy = 0;
        this.wheel = 0;
        this.active = false;
        this.onLockChange = null;
        //Touch controls write into these
        this.touchMove = { forward: 0, strafe: 0 };
        this.touchJump = false;
        this.touchSneak = false;

        window.addEventListener("keydown", (e) => {
            if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) {
                return;
            }
            if (!this.active) {
                return;
            }
            if (GAME_KEYS.has(e.code) || (e.code.startsWith("Digit") && this.locked)) {
                e.preventDefault();
            }
            if (!e.repeat) {
                this.pressed.add(e.code);
                const now = performance.now();
                if (now - (this.lastTap[e.code] || 0) < 300) {
                    this.doubleTaps.add(e.code);
                    this.lastTap[e.code] = 0;
                } else {
                    this.lastTap[e.code] = now;
                }
            }
            this.keys.add(e.code);
        });
        window.addEventListener("keyup", (e) => {
            this.keys.delete(e.code);
        });
        window.addEventListener("blur", () => {
            this.keys.clear();
            this.buttons.clear();
        });
        document.addEventListener("mousedown", (e) => {
            if (!this.locked) {
                return;
            }
            this.buttons.add(e.button);
            this.clicked.add(e.button);
            e.preventDefault();
        });
        document.addEventListener("mouseup", (e) => {
            this.buttons.delete(e.button);
        });
        document.addEventListener("contextmenu", (e) => {
            if (this.locked || this.active) {
                e.preventDefault();
            }
        });
        document.addEventListener("mousemove", (e) => {
            if (!this.locked) {
                return;
            }
            //Ignore the occasional huge jump some browsers report on lock
            if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) {
                return;
            }
            this.dx += e.movementX;
            this.dy += e.movementY;
        });
        document.addEventListener("wheel", (e) => {
            if (this.locked) {
                this.wheel += Math.sign(e.deltaY);
            }
        }, { passive: true });
        document.addEventListener("pointerlockchange", () => {
            if (!this.locked) {
                this.buttons.clear();
            }
            if (this.onLockChange) {
                this.onLockChange(this.locked);
            }
        });
    }

    get locked() {
        return document.pointerLockElement === this.canvas;
    }

    //Returns a promise that settles once the lock was granted or refused
    lock() {
        return new Promise((resolve) => {
            if (this.locked) {
                resolve(true);
                return;
            }
            try {
                const r = this.canvas.requestPointerLock();
                if (r && typeof r.then === "function") {
                    r.then(() => resolve(true), () => resolve(false));
                } else {
                    setTimeout(() => resolve(this.locked), 150);
                }
            } catch (e) {
                resolve(false);
            }
        });
    }

    unlock() {
        if (this.locked) {
            document.exitPointerLock();
        }
    }

    down(code) {
        return this.keys.has(code);
    }

    consumeLook() {
        const r = [this.dx, this.dy];
        this.dx = 0;
        this.dy = 0;
        return r;
    }

    consumeWheel() {
        const w = this.wheel;
        this.wheel = 0;
        return w;
    }

    endFrame() {
        this.pressed.clear();
        this.doubleTaps.clear();
        this.clicked.clear();
    }

    reset() {
        this.keys.clear();
        this.buttons.clear();
        this.endFrame();
        this.dx = this.dy = this.wheel = 0;
    }
}
