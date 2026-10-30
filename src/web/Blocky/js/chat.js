/*
    Blocky - chat.js

    The chat line: T opens it, / opens it with a slash already typed. Enter
    runs the line (commands.js), Esc closes it, Up / Down walk through
    earlier lines and Tab completes command and item names. Recent output
    stays on screen for a few seconds after the line closes.
*/

import { runCommand, complete } from "./commands.js";
import { escapeHtml } from "./util.js";

const SHOW_SECONDS = 10;

export class Chat {
    constructor(app) {
        this.app = app;
        this.open = false;
        this.lines = [];
        this.history = [];
        this.histPos = -1;
        this.logEl = document.getElementById("chatLog");
        this.inputEl = document.getElementById("chatInput");
        this.inputEl.addEventListener("keydown", (e) => this.onKey(e));
        setInterval(() => this.render(), 1000);
    }

    show(prefix) {
        if (this.open) {
            return;
        }
        this.open = true;
        this.histPos = -1;
        this.inputEl.value = prefix;
        this.inputEl.classList.remove("hidden");
        document.getElementById("chat").classList.add("open");
        this.app.input.unlock();
        this.inputEl.focus();
        this.render();
    }

    close(resume) {
        if (!this.open) {
            return;
        }
        this.open = false;
        this.inputEl.blur();
        this.inputEl.classList.add("hidden");
        document.getElementById("chat").classList.remove("open");
        this.render();
        if (resume) {
            this.app.resumePlay();
        }
    }

    add(text, kind = "ok") {
        this.lines.push({ text, kind, t: performance.now() });
        if (this.lines.length > 100) {
            this.lines.shift();
        }
        this.render();
    }

    clear() {
        this.lines = [];
        this.close(false);
        this.render();
    }

    onKey(e) {
        e.stopPropagation();
        if (e.key === "Enter") {
            e.preventDefault();
            const line = this.inputEl.value;
            if (line.trim()) {
                this.history.push(line);
                if (this.history.length > 50) {
                    this.history.shift();
                }
                const game = this.app.game;
                if (game) {
                    for (const m of runCommand(game, line)) {
                        this.add(m.text, m.kind);
                    }
                }
            }
            this.close(true);
        } else if (e.key === "Escape") {
            e.preventDefault();
            this.close(true);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            if (!this.history.length) {
                return;
            }
            if (e.key === "ArrowUp") {
                this.histPos = this.histPos < 0 ? this.history.length - 1 : Math.max(0, this.histPos - 1);
            } else if (this.histPos >= 0) {
                this.histPos++;
                if (this.histPos >= this.history.length) {
                    this.histPos = -1;
                    this.inputEl.value = "";
                    return;
                }
            }
            if (this.histPos >= 0) {
                this.inputEl.value = this.history[this.histPos];
            }
        } else if (e.key === "Tab") {
            e.preventDefault();
            const r = complete(this.inputEl.value);
            this.inputEl.value = r.line;
            if (r.options.length > 1) {
                this.add(r.options.slice(0, 24).join("  ") + (r.options.length > 24 ? "  ..." : ""), "hint");
            }
        }
    }

    render() {
        const now = performance.now();
        const visible = this.open ? this.lines.slice(-14) : this.lines.filter((l) => now - l.t < SHOW_SECONDS * 1000).slice(-8);
        this.logEl.innerHTML = visible.map((l) => {
            const fading = !this.open && now - l.t > (SHOW_SECONDS - 2) * 1000;
            return `<div class="line ${l.kind}${fading ? " fading" : ""}">${escapeHtml(l.text)}</div>`;
        }).join("");
    }
}
