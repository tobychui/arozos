/*
    Tests of the editor geometry. Run with: node "web/Photo/embedded/tests/geometry.test.js"
*/
"use strict";
const assert = require("assert");
const G = require("../js/geometry.js");

let failed = 0;
function test(name, fn) {
    try { fn(); console.log("ok   " + name); }
    catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
}
function near(a, b, eps, msg) {
    assert.ok(Math.abs(a - b) <= (eps || 1e-6), (msg || "") + " " + a + " != " + b);
}

//Where a point of S lands in the source, through the shader chain
function sToSource(g, x, y) {
    const k = G.sToK(g, x, y);
    const o = G.kToO(g, k.x, k.y);
    return G.oToSource(g, o.x, o.y);
}

test("identity maps every point to itself", () => {
    const g = G.newGeometry(400, 300);
    const p = sToSource(g, 123, 45);
    near(p.x, 123); near(p.y, 45);
    assert.ok(G.isIdentity(g));
    assert.ok(G.feasible(g, g.crop));
});

test("keystone and straighten round trip", () => {
    const g = G.newGeometry(400, 300);
    g.vertical = 20; g.horizontal = -12; g.angle = 7;
    const k = G.oToK(g, 50, 260);
    const o = G.kToO(g, k.x, k.y);
    near(o.x, 50, 1e-6); near(o.y, 260, 1e-6);
    const s = G.kToS(g, 10, 20), back = G.sToK(g, s.x, s.y);
    near(back.x, 10); near(back.y, 20);
});

test("rotate left four times is the identity", () => {
    const g = G.newGeometry(400, 300);
    g.crop = { cx: 150, cy: 120, w: 100, h: 60 };
    g.angle = 5; g.vertical = 10;
    const before = G.clone(g);
    for (let i = 0; i < 4; i++) G.rotateLeft(g);
    assert.deepStrictEqual(JSON.stringify(g), JSON.stringify(before));
});

test("rotate left keeps the cropped content", () => {
    const g = G.newGeometry(400, 300);
    g.crop = { cx: 150, cy: 120, w: 100, h: 60 };
    g.angle = 5; g.vertical = 10; g.horizontal = -6;
    const a = sToSource(g, g.crop.cx - 50, g.crop.cy - 30);   //top left of the crop
    G.rotateLeft(g);
    near(g.crop.w, 60); near(g.crop.h, 100);
    //after a left turn the old top left corner is the bottom left one
    const b = sToSource(g, g.crop.cx - 30, g.crop.cy + 50);
    near(a.x, b.x, 1e-6, "x"); near(a.y, b.y, 1e-6, "y");
});

test("flip keeps the cropped content mirrored", () => {
    const g = G.newGeometry(400, 300);
    G.rotateLeft(g);
    g.crop = { cx: 140, cy: 220, w: 80, h: 50 };
    g.angle = -8; g.horizontal = 9; g.vertical = 4;
    const a = sToSource(g, g.crop.cx - 40, g.crop.cy - 25);  //top left
    G.flipHorizontal(g);
    const b = sToSource(g, g.crop.cx + 40, g.crop.cy - 25);  //is now top right
    near(a.x, b.x, 1e-6, "x"); near(a.y, b.y, 1e-6, "y");
    G.flipHorizontal(g);
    const c = sToSource(g, g.crop.cx - 40, g.crop.cy - 25);
    near(a.x, c.x, 1e-6); near(a.y, c.y, 1e-6);
});

test("straightening shrinks the crop to stay on the picture", () => {
    const g = G.newGeometry(400, 300);
    g.angle = 10;
    assert.ok(!G.feasible(g, g.crop));
    const c = G.shrinkToFit(g, g.crop);
    assert.ok(G.feasible(g, c));
    near(c.w / c.h, 400 / 300, 1e-6, "keeps ratio");
    assert.ok(c.w > 250 && c.w < 400, "width " + c.w);
});

test("keystone crops stay inside the warped picture", () => {
    for (const v of [-45, -20, 20, 45]) {
        const g = G.newGeometry(300, 400);
        g.vertical = v; g.horizontal = v / 2; g.angle = v / 5;
        const c = G.shrinkToFit(g, g.crop);
        assert.ok(G.feasible(g, c), "v=" + v);
    }
});

test("pan stops at the edge and slides along it", () => {
    const g = G.newGeometry(400, 300);
    const start = { cx: 200, cy: 150, w: 100, h: 100 };
    const c = G.pan(g, start, 1000, 30);
    near(c.cx, 350, 0.1, "x stops at the edge");
    near(c.cy, 180, 0.1, "y still moves");
});

test("ratio crops have the asked ratio", () => {
    const g = G.newGeometry(400, 300);
    for (const r of [1, 16 / 9, 9 / 16, 4 / 5]) {
        const c = G.cropForRatio(g, g.crop, r);
        near(c.w / c.h, r, 1e-6);
        assert.ok(G.feasible(g, c));
    }
});

test("shader matrices place the crop on the canvas", () => {
    const g = G.newGeometry(400, 300);
    g.crop = { cx: 100, cy: 100, w: 100, h: 100 };
    const view = G.fitView(g.crop, 200, 200, 0);
    const m = G.shaderMatrices(g, view);
    //canvas centre is the crop centre: normalised (100-200)/200 = -0.5
    const n = { x: m.nFromCanvas[0] * 100 + m.nFromCanvas[1] * 100 + m.nFromCanvas[2],
                y: m.nFromCanvas[3] * 100 + m.nFromCanvas[4] * 100 + m.nFromCanvas[5] };
    near(n.x, -0.5); near(n.y, -50 / 150);
    const uv = { x: m.uvFromN[0] * n.x + m.uvFromN[1] * n.y + m.uvFromN[2],
                 y: m.uvFromN[3] * n.x + m.uvFromN[4] * n.y + m.uvFromN[5] };
    near(uv.x, 0.25); near(uv.y, 1 / 3);
});

if (failed) { console.log(failed + " failed"); process.exit(1); }
console.log("all passed");
