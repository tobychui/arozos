/*
    Blocky - signs.js

    The writing on signs. A sign block (mesher.js draws its board and post)
    keeps four lines of text in a tile entity { type: "sign", lines, ver };
    each sign near the player gets a small plane in front of its board
    showing the text, drawn on a canvas. `ver` goes up whenever the text is
    edited so the canvas is drawn again.
*/
import * as THREE from "three";
import { B } from "./blocks.js";
import { signAngle, SIGN_BOARD, SIGN_WALL_BOARD } from "./shapes.js";

export const SIGN_LINES = 4;
export const SIGN_LINE_MAX = 15;
const RANGE = 40;
const CW = 256, CH = 128;

export class Signs {
    constructor(game) {
        this.game = game;
        this.renderer = game.renderer;
        this.meshes = new Map();
    }

    //A new sign's tile entity
    static create(world, x, y, z) {
        const te = { type: "sign", lines: new Array(SIGN_LINES).fill(""), ver: 0 };
        world.tileEntities.set(world.teKey(x, y, z), te);
        return te;
    }

    //Called every frame: add, redraw, light and drop the text planes
    update() {
        const w = this.game.world, p = this.game.player;
        const seen = new Set();
        for (const [key, te] of w.tileEntities) {
            if (te.type !== "sign") {
                continue;
            }
            const [x, y, z] = key.split(",").map(Number);
            if (Math.abs(x - p.x) > RANGE || Math.abs(z - p.z) > RANGE || Math.abs(y - p.y) > RANGE) {
                continue;
            }
            const id = w.getBlock(x, y, z);
            if (id !== B.SIGN && id !== B.WALL_SIGN) {
                continue;
            }
            seen.add(key);
            let m = this.meshes.get(key);
            if (!m) {
                m = this.makeMesh();
                this.meshes.set(key, m);
            }
            const meta = w.getMeta(x, y, z);
            if (m.userData.ver !== te.ver || m.userData.place !== id + ":" + meta) {
                m.userData.ver = te.ver;
                m.userData.place = id + ":" + meta;
                this.draw(m, te.lines);
                this.place(m, x, y, z, id, meta);
            }
            const sky = w.getSky(x, y, z) / 15;
            const blk = Math.max(w.getBlockLight(x, y, z), this.renderer.dyn.at(x, y, z)) / 15;
            m.material.color.setScalar(this.renderer.objectLight(sky, blk));
        }
        for (const [key, m] of this.meshes) {
            if (!seen.has(key)) {
                this.dispose(m);
                this.meshes.delete(key);
            }
        }
    }

    clear() {
        for (const m of this.meshes.values()) {
            this.dispose(m);
        }
        this.meshes.clear();
    }

    makeMesh() {
        const canvas = document.createElement("canvas");
        canvas.width = CW;
        canvas.height = CH;
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: false });
        const b = SIGN_BOARD;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry((b[3] - b[0]) * 0.94, (b[4] - b[1]) * 0.9), mat);
        mesh.userData.canvas = canvas;
        mesh.userData.ver = -1;
        this.renderer.scene.add(mesh);
        return mesh;
    }

    draw(mesh, lines) {
        const canvas = mesh.userData.canvas;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, CW, CH);
        ctx.fillStyle = "#24170a";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 25px Arial, Helvetica, sans-serif";
        for (let i = 0; i < SIGN_LINES; i++) {
            const text = (lines[i] || "").slice(0, SIGN_LINE_MAX);
            if (text) {
                ctx.fillText(text, CW / 2, CH * (i + 0.5) / SIGN_LINES, CW - 8);
            }
        }
        mesh.material.map.needsUpdate = true;
    }

    //In front of the board, turned the way the sign faces
    place(mesh, x, y, z, id, meta) {
        const a = signAngle(id, meta);
        const wall = id === B.WALL_SIGN;
        const b = wall ? SIGN_WALL_BOARD : SIGN_BOARD;
        const front = b[5] + 0.004 - 0.5;
        const v = (b[1] + b[4]) / 2;
        mesh.position.set(x + 0.5 + Math.sin(a) * front, y + v, z + 0.5 + Math.cos(a) * front);
        mesh.rotation.set(0, a, 0);
    }

    dispose(m) {
        this.renderer.scene.remove(m);
        m.geometry.dispose();
        m.material.map.dispose();
        m.material.dispose();
    }
}
