/**
 * Keyboard, gamepad, mouse and touch, folded into named actions.
 *
 * `update()` runs once per simulation step: `held(a)` is the current state,
 * `pressed(a)` is true on the first step an action goes down and
 * `repeat(a)` adds menu-style auto repeat. Two keyboard layouts work at the
 * same time (arrows + Z/X/Shift, and WASD + J/K/L).
 *
 * Touch: dragging anywhere on the playfield moves the heroine by the finger's
 * motion (relative, so the finger never hides her) and fires; the on-screen
 * buttons the HUD draws are hit tested through `touchButtons`.
 */
const KEYMAP = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  shoot: ['KeyZ', 'KeyJ', 'Space'],
  bomb: ['KeyX', 'KeyK'],
  focus: ['ShiftLeft', 'ShiftRight', 'KeyL'],
  pause: ['Escape', 'KeyP'],
  skip: ['ControlLeft', 'ControlRight'],
  confirm: ['KeyZ', 'Enter', 'NumpadEnter', 'Space', 'KeyJ'],
  cancel: ['KeyX', 'Escape', 'Backspace', 'KeyK'],
  debug: ['F3'],
};
const ACTIONS = Object.keys(KEYMAP);
const BLOCK = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'Backspace', 'F3']);

export class Input {
  constructor(view) {
    this.view = view;
    this.keys = new Set();
    this.state = {};
    this.prev = {};
    this.hold = {};
    for (const a of ACTIONS) {
      this.state[a] = false;
      this.prev[a] = false;
      this.hold[a] = 0;
    }
    this.typed = []; // printable keys for name entry
    this.textMode = false;
    this.mouse = { x: -1, y: -1, moved: false, clicked: false, down: false, wheel: 0 };
    this.touch = { active: false, id: null, lx: 0, ly: 0, dx: 0, dy: 0, used: false };
    this.touchButtons = []; // {x,y,w,h,action} in logical coords, set by the HUD
    this._touchActs = new Set();
    this.usedTouch = false;
    this.lastDevice = 'keyboard';
    this._pad = {};
    this.onFirstGesture = null;

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    const c = view.canvas;
    c.addEventListener('pointerdown', (e) => this._pointer(e, 'down'));
    window.addEventListener('pointermove', (e) => this._pointer(e, 'move'));
    window.addEventListener('pointerup', (e) => this._pointer(e, 'up'));
    window.addEventListener('pointercancel', (e) => this._pointer(e, 'up'));
    c.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _gesture() {
    if (this.onFirstGesture) this.onFirstGesture();
  }

  _key(e, down) {
    if (down) {
      this._gesture();
      this.lastDevice = 'keyboard';
      if (this.textMode && e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.typed.push(e.key);
      if (this.textMode && e.code === 'Backspace') this.typed.push('\b');
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
    if (BLOCK.has(e.code) || (e.code === 'KeyF' && e.ctrlKey)) e.preventDefault();
  }

  _pointer(e, kind) {
    const p = this.view.toLogical(e.clientX, e.clientY);
    if (e.pointerType === 'touch') {
      this.usedTouch = true;
      if (kind === 'down') {
        this._gesture();
        this.lastDevice = 'touch';
        const b = this._hitButton(p.x, p.y);
        if (b) {
          this._touchActs.add(b.action);
          b._pointer = e.pointerId;
          if (b.tap) this.mouse.clicked = true;
          this.mouse.x = p.x;
          this.mouse.y = p.y;
          return;
        }
        if (!this.touch.active) {
          this.touch.active = true;
          this.touch.id = e.pointerId;
          this.touch.lx = p.x;
          this.touch.ly = p.y;
          this.touch.used = true;
        }
        this.mouse.x = p.x;
        this.mouse.y = p.y;
        this.mouse.clicked = true;
      } else if (kind === 'move') {
        if (this.touch.active && e.pointerId === this.touch.id) {
          this.touch.dx += p.x - this.touch.lx;
          this.touch.dy += p.y - this.touch.ly;
          this.touch.lx = p.x;
          this.touch.ly = p.y;
        }
      } else {
        for (const b of this.touchButtons) {
          if (b._pointer === e.pointerId) {
            this._touchActs.delete(b.action);
            b._pointer = null;
          }
        }
        if (e.pointerId === this.touch.id) {
          this.touch.active = false;
          this.touch.id = null;
        }
      }
      return;
    }
    if (kind === 'down') {
      this._gesture();
      this.lastDevice = 'mouse';
      this.view.canvas.focus();
      this.mouse.down = true;
      if (e.button === 0) this.mouse.clicked = true;
      if (e.button === 2) this.mouse.rightClicked = true;
    } else if (kind === 'up') {
      this.mouse.down = false;
    }
    if (Math.abs(p.x - this.mouse.x) > 0.5 || Math.abs(p.y - this.mouse.y) > 0.5) this.mouse.moved = true;
    this.mouse.x = p.x;
    this.mouse.y = p.y;
  }

  _hitButton(x, y) {
    for (const b of this.touchButtons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  _pollPad() {
    const out = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const any = (k, v) => {
        if (v) {
          out[k] = true;
          this.lastDevice = 'gamepad';
        }
      };
      any('up', b(12) || ay < -0.45);
      any('down', b(13) || ay > 0.45);
      any('left', b(14) || ax < -0.45);
      any('right', b(15) || ax > 0.45);
      any('shoot', b(0));
      any('bomb', b(1));
      any('focus', b(2) || b(5) || b(7));
      any('pause', b(9));
      any('skip', b(3) || b(4));
      any('confirm', b(0));
      any('cancel', b(1));
      if (Object.keys(out).length) this._gesture();
    }
    return out;
  }

  update() {
    const pad = this._pollPad();
    for (const a of ACTIONS) {
      this.prev[a] = this.state[a];
      let v = !!pad[a] || this._touchActs.has(a);
      if (!v) for (const k of KEYMAP[a]) if (this.keys.has(k)) { v = true; break; }
      this.state[a] = v;
      this.hold[a] = v ? this.hold[a] + 1 : 0;
    }
  }

  /** Called by the app after every step so one-shot pointer flags clear. */
  endStep() {
    this.mouse.clicked = false;
    this.mouse.rightClicked = false;
    this.mouse.moved = false;
    this.mouse.wheel = 0;
    this.typed.length = 0;
  }

  held(a) {
    return this.state[a];
  }

  pressed(a) {
    return this.state[a] && !this.prev[a];
  }

  /** Pressed, then auto repeat after 18 steps every 5. */
  repeat(a) {
    const h = this.hold[a];
    return h === 1 || (h > 18 && (h - 18) % 5 === 0);
  }

  /** Take the accumulated touch drag (logical px). */
  takeTouchDelta() {
    const d = { x: this.touch.dx, y: this.touch.dy };
    this.touch.dx = 0;
    this.touch.dy = 0;
    return d;
  }

  /** Swallow the current presses so a held key does not leak into the next screen. */
  consume() {
    for (const a of ACTIONS) this.prev[a] = this.state[a];
    this.mouse.clicked = false;
  }
}
