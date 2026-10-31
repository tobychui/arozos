import { formatTime } from '../systems/modes/Mode.js';

/**
 * End-of-run report: small-multiple line charts over the run, plus a per-wave
 * breakdown table.
 *
 * One measure family per chart, never two y-scales. Each chart pairs at most two
 * series that share a unit, so a gap between the lines means something: unspent
 * vs total mined is what you spent, generated vs demand is a brownout.
 *
 * Hovering any chart moves a shared crosshair across all four, and the legends
 * become the readout, so one moment in the run can be read in every dimension.
 */

// Validated for the dark surface (#0b131e): lightness band, CVD separation and
// contrast all pass. Slot order is fixed — series 1 is always cyan.
const C1 = '#22a3b6';
const C2 = '#c98428';
const INK = '#c2d2e6';
const MUTED = '#6d8098';
const GRID = '#17293d';
const SURFACE = '#0b131e';

const int = (n) => Math.round(n).toLocaleString();

const CHARTS = [
  {
    title: 'Minerals',
    series: [
      { key: 'mined', label: 'Total mined', color: C1 },
      { key: 'banked', label: 'Unspent', color: C2 },
    ],
    fmt: int,
    integer: true,
    insight: (r) => {
      const peak = Math.max(...r.samples.map((s) => s.banked));
      return `${(r.last.mined / Math.max(1, r.duration)).toFixed(1)}/s average income · `
        + `peak unspent ${int(peak)}`;
    },
  },
  {
    title: 'Enemies killed',
    series: [{ key: 'kills', label: 'Kills', color: C1 }],
    fmt: int,
    integer: true,
    insight: (r) => {
      const best = r.waveRows.reduce((a, w) => (w.kills > (a?.kills ?? 0) ? w : a), null);
      return `${int(r.last.kills)} total · ${(r.last.kills / Math.max(1, r.duration / 60)).toFixed(1)}/min`
        + (best ? ` · most in ${best.label.toLowerCase()} (${best.kills})` : '');
    },
  },
  {
    title: 'Structures',
    series: [
      { key: 'standing', label: 'Standing', color: C1 },
      { key: 'lost', label: 'Destroyed', color: C2 },
    ],
    fmt: int,
    integer: true,
    insight: (r) => {
      const worst = r.waveRows.reduce((a, w) => (w.lost > (a?.lost ?? 0) ? w : a), null);
      return `${int(r.built)} built · ${int(r.last.lost)} destroyed`
        + (worst ? ` · worst: ${worst.label.toLowerCase()} (${worst.lost})` : '');
    },
  },
  {
    title: 'Power',
    series: [
      { key: 'supply', label: 'Generated', color: C1 },
      { key: 'demand', label: 'Demand', color: C2 },
    ],
    fmt: (n) => n.toFixed(0),
    insight: (r) => {
      const pct = Math.round((r.overdrawnTime / Math.max(1, r.duration)) * 100);
      if (pct >= 10) return `Demand outran supply for ${pct}% of the run — add solar or batteries`;
      return pct > 0 ? `Only briefly overdrawn (${pct}% of the run)` : 'Never overdrawn';
    },
  },
];

export class RunCharts {
  /**
   * @param {HTMLElement} root container to fill
   * @param {import('../systems/StatsRecorder.js').StatsRecorder} rec
   * @param {object} world for totals not sampled over time
   */
  constructor(root, rec, world) {
    this.root = root;
    const samples = rec.samples;
    this.r = {
      samples,
      waves: rec.waves,
      duration: rec.duration,
      overdrawnTime: rec.overdrawnTime,
      built: world.structuresBuilt,
      last: samples[samples.length - 1],
    };
    this.r.waveRows = this._waveRows();
    this.hover = -1;
    this._build();
  }

  // ------------------------------------------------------------------ data

  /** Last sample at or before t: counters are step functions between samples. */
  _at(t) {
    const s = this.r.samples;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  _waveAt(t) {
    let n = 0;
    for (const w of this.r.waves) if (w.t <= t) n = w.n;
    return n;
  }

  /** One row per stretch of the run: the opening build-up, then each wave. */
  _waveRows() {
    const { samples, waves } = this.r;
    const end = this.r.last.t;
    const edges = [{ t: samples[0].t, label: 'Setup' },
      ...waves.map((w) => ({ t: w.t, label: `Wave ${w.n}` }))];
    return edges.map((e, i) => {
      const t1 = edges[i + 1]?.t ?? end;
      const a = this._at(e.t);
      const b = this._at(t1);
      const inside = samples.filter((s) => s.t > e.t && s.t <= t1);
      const avg = (k) => inside.length ? inside.reduce((x, s) => x + s[k], 0) / inside.length : b[k];
      return {
        label: e.label,
        start: e.t,
        span: t1 - e.t,
        mined: b.mined - a.mined,
        kills: b.kills - a.kills,
        lost: b.lost - a.lost,
        supply: avg('supply'),
        demand: avg('demand'),
      };
    }).filter((row) => row.span > 0.5);
  }

  // ------------------------------------------------------------------- DOM

  _build() {
    if (this.r.samples.length < 3) {
      this.root.innerHTML = '<p class="rc-empty">The run was too short to chart.</p>';
      return;
    }
    this.root.innerHTML = `
      <div class="rc-grid">
        ${CHARTS.map((c, i) => `
          <figure class="rc-card" data-i="${i}">
            <figcaption>
              <div class="rc-h"><b>${c.title}</b><span class="rc-at"></span></div>
              <div class="rc-ins">${c.insight(this.r)}</div>
              ${c.series.length > 1 ? `<div class="rc-leg">${c.series.map((s) => `
                <span><i style="background:${s.color}"></i>${s.label} <b data-k="${s.key}"></b></span>`).join('')}
              </div>` : `<div class="rc-leg"><span>${c.series[0].label} <b data-k="${c.series[0].key}"></b></span></div>`}
            </figcaption>
            <canvas aria-label="${c.title} over time"></canvas>
          </figure>`).join('')}
      </div>
      <details class="rc-table">
        <summary>Per-wave breakdown</summary>
        <div class="rc-scroll">
          <table>
            <thead><tr><th></th><th>Start</th><th>Length</th><th>Mined</th><th>Kills</th>
              <th>Lost</th><th>Avg generated</th><th>Avg demand</th></tr></thead>
            <tbody>${this.r.waveRows.map((w) => `
              <tr${w.demand > w.supply + 0.5 ? ' class="short"' : ''}>
                <th>${w.label}</th><td>${formatTime(w.start)}</td><td>${formatTime(w.span)}</td>
                <td>${int(w.mined)}</td><td>${w.kills}</td><td>${w.lost}</td>
                <td>${w.supply.toFixed(0)}</td><td>${w.demand.toFixed(0)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </details>`;

    this.cards = [...this.root.querySelectorAll('.rc-card')].map((el, i) => ({
      el,
      def: CHARTS[i],
      canvas: el.querySelector('canvas'),
      at: el.querySelector('.rc-at'),
      vals: [...el.querySelectorAll('[data-k]')],
    }));

    for (const c of this.cards) {
      c.canvas.addEventListener('mousemove', (e) => this._onMove(c, e));
      c.canvas.addEventListener('mouseleave', () => this._setHover(-1));
    }
    // Drawn after layout so each canvas knows its real width.
    requestAnimationFrame(() => this.draw());
    this._onResize = () => this.draw();
    window.addEventListener('resize', this._onResize);
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.root.innerHTML = '';
  }

  _onMove(card, e) {
    const rect = card.canvas.getBoundingClientRect();
    const g = card.geom;
    if (!g) return;
    const t = g.t0 + ((e.clientX - rect.left - g.l) / g.w) * (g.t1 - g.t0);
    // Nearest sample by time.
    const s = this.r.samples;
    let best = 0;
    for (let i = 1; i < s.length; i++) {
      if (Math.abs(s[i].t - t) < Math.abs(s[best].t - t)) best = i;
    }
    this._setHover(best);
  }

  _setHover(i) {
    if (i === this.hover) return;
    this.hover = i;
    this.draw();
  }

  // ------------------------------------------------------------------ draw

  draw() {
    if (!this.cards) return;
    const sample = this.hover >= 0 ? this.r.samples[this.hover] : this.r.last;
    const wave = this._waveAt(sample.t);
    for (const c of this.cards) {
      this._drawChart(c);
      c.at.textContent = this.hover >= 0
        ? `at ${formatTime(sample.t)}${wave ? ` · wave ${wave}` : ''}`
        : 'end of run';
      for (const v of c.vals) v.textContent = c.def.fmt(sample[v.dataset.k]);
    }
  }

  _drawChart(card) {
    const { canvas, def } = card;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const s = this.r.samples;
    const pad = { l: 38, r: 70, t: 14, b: 20 };
    const w = W - pad.l - pad.r;
    const h = H - pad.t - pad.b;
    const t0 = s[0].t;
    const t1 = Math.max(t0 + 1, s[s.length - 1].t);
    const { max: vmax, n: ticks } = niceScale(
      Math.max(1, ...def.series.flatMap((ser) => s.map((p) => p[ser.key]))), def.integer);
    const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * w;
    const Y = (v) => pad.t + h - (v / vmax) * h;
    card.geom = { l: pad.l, w, t0, t1 };

    ctx.font = '10px system-ui, sans-serif';
    ctx.lineWidth = 1;

    // Recessive grid and y labels.
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= ticks; i++) {
      const v = (vmax / ticks) * i;
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = GRID;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(compact(v), pad.l - 6, y);
    }

    // Time axis.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= 4; i++) {
      const t = t0 + ((t1 - t0) / 4) * i;
      // End ticks align inward so they stay clear of the y labels and the
      // direct labels.
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillStyle = MUTED;
      ctx.fillText(formatTime(t), X(t), pad.t + h + 6);
    }

    // Wave starts. Labels thin out when there are many, but every wave keeps
    // its line.
    const every = Math.max(1, Math.ceil(this.r.waves.length / Math.max(1, Math.floor(w / 34))));
    ctx.setLineDash([2, 4]);
    this.r.waves.forEach((wv, i) => {
      const x = Math.round(X(wv.t)) + 0.5;
      ctx.strokeStyle = '#2a3d55';
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
      ctx.stroke();
      if (i % every === 0) {
        ctx.fillStyle = MUTED;
        ctx.textBaseline = 'bottom';
        ctx.fillText(`W${wv.n}`, x, pad.t - 2);
      }
    });
    ctx.setLineDash([]);

    // Series: 2px lines, round joins.
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const ser of def.series) {
      ctx.strokeStyle = ser.color;
      ctx.beginPath();
      s.forEach((p, i) => {
        const x = X(p.t);
        const y = Y(p[ser.key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Direct labels at the line ends, kept inside the plot and nudged apart
    // if they would collide.
    const top = pad.t + 5;
    const bottom = pad.t + h - 5;
    const ends = def.series
      .map((ser) => ({ ser, y: Math.min(bottom, Math.max(top, Y(s[s.length - 1][ser.key]))) }))
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    }
    for (let i = ends.length - 1; i >= 0; i--) {
      const limit = i === ends.length - 1 ? bottom : ends[i + 1].y - 12;
      if (ends[i].y > limit) ends[i].y = limit;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const e of ends) {
      ctx.fillStyle = e.ser.color;
      ctx.fillRect(pad.l + w + 6, e.y - 1, 6, 2);
      ctx.fillStyle = INK;
      ctx.fillText(e.ser.label, pad.l + w + 15, e.y);
    }

    // Crosshair and markers, ringed in the surface colour so they lift off
    // the lines beneath.
    if (this.hover >= 0) {
      const p = s[this.hover];
      const x = Math.round(X(p.t)) + 0.5;
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + h);
      ctx.stroke();
      for (const ser of def.series) {
        ctx.beginPath();
        ctx.arc(X(p.t), Y(p[ser.key]), 4, 0, Math.PI * 2);
        ctx.fillStyle = ser.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = SURFACE;
        ctx.stroke();
      }
    }
  }
}

/**
 * Axis scale with round tick values: a step of 1, 2, 2.5 or 5 times a power of
 * ten, and at most four steps up to the maximum.
 */
function niceScale(v, integer = false) {
  const raw = v / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= raw);
  // Counts tick in whole numbers: no "2.5 kills".
  if (integer) step = step < 1 ? 1 : step === 2.5 ? 2 : step;
  const n = Math.ceil(v / step - 1e-9);
  return { max: step * n, n };
}

function compact(v) {
  if (Number.isInteger(v) && v < 1000) return String(v);
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return v >= 10 || v === 0 ? `${Math.round(v)}` : v.toFixed(1);
}
