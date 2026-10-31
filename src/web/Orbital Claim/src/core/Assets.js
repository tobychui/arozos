/**
 * Sprite loading.
 *
 * Art is authored once in assets/sprites.svg as <symbol> definitions so it stays
 * editable as vectors. At load we rasterise each symbol into its own offscreen
 * canvas, because blitting a pre-rendered canvas is far cheaper per frame than
 * asking the browser to re-rasterise SVG hundreds of times.
 *
 * Each symbol is extracted into a standalone SVG document carrying a copy of the
 * shared <defs>; gradients referenced by url(#id) do not resolve otherwise.
 */
export class Assets {
  constructor() {
    this.sprites = new Map(); // id -> HTMLCanvasElement
    this.baseSize = 128;      // rasterised at 2x the largest on-screen use
  }

  get(id) {
    return this.sprites.get(id) || null;
  }

  has(id) {
    return this.sprites.has(id);
  }

  /**
   * @param {string} url path to the sprite sheet
   * @param {string[]} [only] restrict to these symbol ids
   */
  async load(url, only) {
    const text = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    });

    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error(`${url} is not valid SVG`);

    const defsEl = doc.querySelector('defs');
    const defs = defsEl ? defsEl.outerHTML : '';
    const symbols = [...doc.querySelectorAll('symbol')];

    await Promise.all(
      symbols.map((sym) => {
        const id = sym.getAttribute('id');
        if (only && !only.includes(id)) return null;
        return this._rasterise(id, sym.getAttribute('viewBox') || '0 0 64 64', defs, sym.innerHTML);
      })
    );

    return this;
  }

  _rasterise(id, viewBox, defs, inner) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" ` +
      `width="${this.baseSize}" height="${this.baseSize}">${defs}${inner}</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = this.baseSize;
        c.getContext('2d').drawImage(img, 0, 0, this.baseSize, this.baseSize);
        this.sprites.set(id, c);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        // A missing sprite should not abort the whole load; the renderer draws
        // a magenta placeholder so it is obvious on screen instead.
        console.warn(`sprite "${id}" failed to rasterise`);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.src = url;
    });
  }
}
