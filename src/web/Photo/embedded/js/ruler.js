/*
    Dial ruler: a strip of tick marks that slides under a fixed centre line.
    Drag it, scroll it, or use the arrow keys. Double click / double tap
    returns it to its default. Works across (row) or upright (column), the
    upright one grows upwards.

    var r = new PhotoRuler(el, {min, max, value, def, step, pxPerUnit,
                                tickEvery, majorEvery, onInput, onCommit});
    r.setRange({...}); r.setValue(v); r.setVertical(bool);
*/
(function (root) {
    "use strict";

    function PhotoRuler(el, opts) {
        this.el = el;
        this.el.classList.add("pr-ruler");
        this.el.tabIndex = 0;
        this.track = document.createElement("div");
        this.track.className = "pr-track";
        this.marker = document.createElement("div");
        this.marker.className = "pr-marker";
        this.el.appendChild(this.track);
        this.el.appendChild(this.marker);
        this.vertical = false;
        this.dragging = null;
        this.setRange(opts);
        this._bind();
    }

    PhotoRuler.prototype.setRange = function (o) {
        this.min = o.min;
        this.max = o.max;
        this.def = o.def === undefined ? 0 : o.def;
        this.step = o.step || 1;
        this.pxPerUnit = o.pxPerUnit || 1.6;
        this.tickEvery = o.tickEvery || 5;
        this.majorEvery = o.majorEvery || 25;
        if (o.onInput) { this.onInput = o.onInput; }
        if (o.onCommit) { this.onCommit = o.onCommit; }
        this._buildTicks();
        this.setValue(o.value === undefined ? this.def : o.value);
    };

    PhotoRuler.prototype.setVertical = function (v) {
        if (this.vertical === v) {
            return;
        }
        this.vertical = v;
        this.el.classList.toggle("vertical", v);
        this._buildTicks();
        this.setValue(this.value);
    };

    PhotoRuler.prototype._buildTicks = function () {
        var html = [];
        var span = (this.max - this.min) * this.pxPerUnit;
        for (var v = this.min; v <= this.max + 1e-9; v += this.tickEvery) {
            var pos = (v - this.min) * this.pxPerUnit;
            var cls = "pr-tick";
            if (Math.abs(v - this.def) < 1e-9) {
                cls += " zero";
            } else if (Math.abs(Math.round(v / this.majorEvery) * this.majorEvery - v) < 1e-9) {
                cls += " major";
            }
            var at = this.vertical ? "bottom:" : "left:";
            html.push('<i class="' + cls + '" style="' + at + pos + 'px"></i>');
        }
        this.track.innerHTML = html.join("");
        if (this.vertical) {
            this.track.style.height = span + "px";
            this.track.style.width = "";
        } else {
            this.track.style.width = span + "px";
            this.track.style.height = "";
        }
    };

    PhotoRuler.prototype.setValue = function (v) {
        v = Math.max(this.min, Math.min(this.max, v));
        this.value = v;
        var off = (v - this.min) * this.pxPerUnit;
        if (this.vertical) {
            this.track.style.transform = "translateY(" + off + "px)";
        } else {
            this.track.style.transform = "translateX(" + (-off) + "px)";
        }
        //ticks the value has passed light up
        var ticks = this.track.children;
        var lo = Math.min(v, this.def), hi = Math.max(v, this.def);
        for (var i = 0; i < ticks.length; i++) {
            var tv = this.min + i * this.tickEvery;
            ticks[i].classList.toggle("lit", v !== this.def && tv >= lo - 1e-9 && tv <= hi + 1e-9);
        }
    };

    PhotoRuler.prototype._emit = function (v, commit) {
        v = Math.round(v / this.step) * this.step;
        //a soft stop at the default, as a detent
        if (Math.abs(v - this.def) < this.step * 1.5 && !commit && this.dragging && this.dragging.moved) {
            v = this.def;
        }
        v = Math.max(this.min, Math.min(this.max, v));
        var changed = v !== this.value;
        this.setValue(v);
        if (changed && this.onInput) {
            this.onInput(v);
        }
        if (commit && this.onCommit) {
            this.onCommit(v);
        }
    };

    PhotoRuler.prototype._bind = function () {
        var self = this;
        this.el.addEventListener("pointerdown", function (e) {
            if (e.button !== undefined && e.button !== 0) {
                return;
            }
            self.el.setPointerCapture(e.pointerId);
            self.dragging = { x: e.clientX, y: e.clientY, v: self.value, moved: false, raw: self.value };
            self.el.classList.add("active");
        });
        this.el.addEventListener("pointermove", function (e) {
            var d = self.dragging;
            if (!d) {
                return;
            }
            //the strip follows the finger: dragging right / down shows
            //the ticks of lower / higher values under the centre line
            var delta = self.vertical ? (e.clientY - d.y) : -(e.clientX - d.x);
            if (Math.abs(delta) > 2) {
                d.moved = true;
            }
            self._emit(d.v + delta / self.pxPerUnit, false);
        });
        function end(e) {
            if (!self.dragging) {
                return;
            }
            var moved = self.dragging.moved;
            self.dragging = null;
            self.el.classList.remove("active");
            if (moved && self.onCommit) {
                self.onCommit(self.value);
            }
        }
        this.el.addEventListener("pointerup", end);
        this.el.addEventListener("pointercancel", end);
        this.el.addEventListener("dblclick", function () {
            self._emit(self.def, true);
        });
        var wheelTimer = null;
        this.el.addEventListener("wheel", function (e) {
            e.preventDefault();
            var delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
            if (e.deltaMode === 1) {
                delta *= 16;
            }
            if (self.vertical) {
                delta = -delta;
            }
            self._emit(self.value + delta / self.pxPerUnit * 0.5, false);
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(function () {
                if (self.onCommit) {
                    self.onCommit(self.value);
                }
            }, 300);
        }, { passive: false });
        this.el.addEventListener("keydown", function (e) {
            var k = e.key;
            var dir = 0;
            if (k === "ArrowRight" || k === "ArrowUp") { dir = 1; }
            if (k === "ArrowLeft" || k === "ArrowDown") { dir = -1; }
            if (dir !== 0) {
                e.preventDefault();
                e.stopPropagation();
                self._emit(self.value + dir * self.step * (e.shiftKey ? 10 : 1), true);
            }
        });
    };

    root.PhotoRuler = PhotoRuler;
})(this);
