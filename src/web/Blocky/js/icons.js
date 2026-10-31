/*
    Blocky - icons.js

    Renders every item into one sprite sheet: blocks as small isometric
    cubes, everything else as its flat tile. The UI shows icons as CSS
    backgrounds cut from this sheet.
*/

import { ITEMS, BLOCKS, SHAPE, blockFaceLayer } from "./blocks.js";
import { drawIsoIcon, drawIsoBoxes, drawFlatIcon, ICON, GRASS_TINT, FOLIAGE_TINT } from "./textures.js";
import { STAIR_ITEM_BOXES } from "./mesher.js";

export function buildIcons(tex) {
    const ids = [];
    for (let i = 0; i < ITEMS.length; i++) {
        if (ITEMS[i]) {
            ids.push(i);
        }
    }
    const cols = 16;
    const rows = Math.ceil(ids.length / cols);
    const canvas = document.createElement("canvas");
    canvas.width = cols * ICON;
    canvas.height = rows * ICON;
    const ctx = canvas.getContext("2d");
    const pos = new Map();
    const tileCanvas = (layer) => tex.canvases.get(tex.names[layer]);
    ids.forEach((id, n) => {
        const x = (n % cols) * ICON, y = Math.floor(n / cols) * ICON;
        pos.set(id, [n % cols, Math.floor(n / cols)]);
        const it = ITEMS[id];
        if (it.icon && it.icon.flat) {
            drawFlatIcon(ctx, x, y, tex.canvases.get(it.icon.flat), it.icon.tint === "grass" ? GRASS_TINT : null);
            return;
        }
        const bid = it.block;
        const def = BLOCKS[bid];
        const meta = def.orient ? 4 : 0;
        const tiles = {
            top: tileCanvas(blockFaceLayer(bid, 2, meta)),
            left: tileCanvas(blockFaceLayer(bid, 4, meta)),
            right: tileCanvas(blockFaceLayer(bid, 0, meta))
        };
        const shape = SHAPE[bid];
        const opts = { height: shape === "slab" ? 8 : shape === "plate" ? 2 : shape === "retimer" ? 3 : 16 };
        if (def.tint === "grass") {
            opts.topTint = GRASS_TINT;
        } else if (def.tint === "foliage") {
            opts.topTint = FOLIAGE_TINT;
            opts.sideTint = FOLIAGE_TINT;
        }
        if (shape === "stairs") {
            drawIsoBoxes(ctx, x, y, tiles, STAIR_ITEM_BOXES, opts);
        } else {
            drawIsoIcon(ctx, x, y, tiles, opts);
        }
    });
    const icons = { pos, cols, rows };
    //One style rule carries the sheet; elements only set size and offset
    canvas.toBlob((blob) => {
        const style = document.createElement("style");
        style.textContent = `.ic{background-image:url(${URL.createObjectURL(blob)});}`;
        document.head.appendChild(style);
    });
    return icons;
}

//Inline style for an .ic element of `size` pixels
export function iconCss(icons, id, size) {
    const p = icons.pos.get(id);
    if (!p) {
        return "background:none;";
    }
    return `background-size:${icons.cols * size}px ${icons.rows * size}px;` +
        `background-position:${-p[0] * size}px ${-p[1] * size}px;`;
}
