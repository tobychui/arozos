/*
    Gerber Viewer - 3D board view

    Loaded on demand (dynamic import) the first time the 3D view is opened.
    The board is the outline extruded to the configured thickness with every
    cut-out, hole and slot removed. The top and bottom faces are textured with
    the realistic 2D render, plated holes get copper barrels, and the edge
    shows the layer stack-up.

    With the manufacturing preview the board can also be laid out as the
    manufacturer's panel: copies in rows and columns, V-cut grooves or
    stamp-hole tabs between them, and edge rails with tooling holes and
    fiducials.

    three.js r185 is vendored in ../lib/three (MIT, see its LICENSE).
*/
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function windingNumber(c, px, py) {
    var wn = 0;
    var n = c.length;
    for (var i = 0; i < n; i += 2) {
        var x1 = c[i], y1 = c[i + 1], x2 = c[(i + 2) % n], y2 = c[(i + 3) % n];
        if (y1 <= py) {
            if (y2 > py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) > 0) {
                wn++;
            }
        } else if (y2 <= py && (x2 - x1) * (py - y1) - (px - x1) * (y2 - y1) < 0) {
            wn--;
        }
    }
    return wn;
}

function toVec(c) {
    var pts = [];
    for (var i = 0; i < c.length; i += 2) {
        pts.push(new THREE.Vector2(c[i], c[i + 1]));
    }
    return pts;
}

function circlePts(x, y, r) {
    var n = Math.max(10, Math.min(36, Math.round(r * 24)));
    var pts = [];
    for (var i = 0; i < n; i++) {
        var a = -Math.PI * 2 * i / n;
        pts.push(new THREE.Vector2(x + r * Math.cos(a), y + r * Math.sin(a)));
    }
    return pts;
}

/*
    Edge texture: a vertical strip, top of the canvas = top of the board.
    stack: {layers, copperOz, core, base, baseRatio, mask, copper}
*/
function stackTexture(stack, t) {
    var H = 512;
    var cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = H;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = stack.core;
    ctx.fillRect(0, 0, 4, H);
    var px = H / t;
    if (stack.base) {
        //Metal core boards: thin dielectric on top of a thick metal base
        var top = Math.round(H * (1 - stack.baseRatio));
        ctx.fillStyle = stack.base;
        ctx.fillRect(0, top, 4, H - top);
    }
    //Copper is 35 um per oz; drawn at least 1.5 % of the stack so it reads
    var cu = Math.max(Math.round(H * 0.015), Math.round(stack.copperOz * 0.035 * px));
    var n = Math.max(1, stack.layers);
    ctx.fillStyle = stack.copper;
    for (var i = 0; i < n; i++) {
        var f = n === 1 ? 0 : i / (n - 1);
        //Inner copper is thinner (0.5 oz) than the outer layers
        var h = i === 0 || i === n - 1 ? cu : Math.max(1, Math.round(cu * 0.5));
        var y = Math.round(f * (H - h));
        ctx.fillRect(0, y, 4, h);
    }
    if (stack.mask) {
        ctx.fillStyle = stack.mask;
        ctx.fillRect(0, 0, 4, 2);
        if (n > 1 || !stack.base) {
            ctx.fillRect(0, H - 2, 4, 2);
        }
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    //Side wall UVs are (along the edge, 1 - z); map z = 0..t onto the strip
    tex.repeat.set(1, -1 / t);
    tex.offset.set(0, 1 / t);
    tex.magFilter = THREE.LinearFilter;
    return tex;
}

export function createView(container) {
    var renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444450, 1.6));
    var key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-80, -120, 200);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(120, 80, -150);
    scene.add(fill);

    var controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;

    var group = new THREE.Group();
    scene.add(group);
    var size = 100;
    var running = false;
    var disposables = [];

    function keep(x) {
        disposables.push(x);
        return x;
    }

    function resize() {
        var r = container.getBoundingClientRect();
        var w = Math.max(1, r.width), h = Math.max(1, r.height);
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = w + 'px';
        renderer.domElement.style.height = h + 'px';
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    }

    function loop() {
        controls.update();
        renderer.render(scene, camera);
    }

    function start() {
        if (!running) {
            running = true;
            resize();
            renderer.setAnimationLoop(loop);
        }
    }

    function stop() {
        running = false;
        renderer.setAnimationLoop(null);
    }

    function clear() {
        while (group.children.length) {
            group.remove(group.children[0]);
        }
        disposables.forEach(function (d) { d.dispose(); });
        disposables = [];
    }

    function setView(dir) {
        //Distance at which the long side fills about 85 % of the view
        var aspect = Math.max(0.3, camera.aspect || 1);
        var d = size / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.min(1, aspect)) / 0.85;
        controls.target.set(0, 0, 0);
        if (dir === 'top') {
            camera.position.set(0, -0.001, d);
        } else if (dir === 'bottom') {
            camera.position.set(0, 0.001, -d);
        } else if (dir === 'front') {
            camera.position.set(0, -d * 1.05, d * 0.15);
        } else {
            //Seen at an angle the board spans more of the view: back off a little
            camera.position.set(-d * 0.38, -d * 0.8, d * 0.8);
        }
        camera.near = size / 100;
        camera.far = size * 50;
        camera.updateProjectionMatrix();
        controls.update();
    }

    function faceTexture(canvas) {
        var tex = keep(new THREE.CanvasTexture(canvas));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        return tex;
    }

    function flatFace(shapeList, b, tex, z, back) {
        var w = b[2] - b[0], h = b[3] - b[1];
        var geo = keep(new THREE.ShapeGeometry(shapeList, 8));
        var pos = geo.attributes.position, uv = geo.attributes.uv;
        for (var i = 0; i < pos.count; i++) {
            uv.setXY(i, (pos.getX(i) - b[0]) / w, (pos.getY(i) - b[1]) / h);
            pos.setZ(i, z);
        }
        uv.needsUpdate = true;
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        var mat = keep(new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.55,
            metalness: 0,
            side: back ? THREE.BackSide : THREE.FrontSide
        }));
        return new THREE.Mesh(geo, mat);
    }

    //One board: laminate body, textured faces and plated barrels
    function buildBoard(data, edgeMat) {
        var board = data.board;
        var b = board.bounds;
        var t = data.thickness;
        var fillVias = !!data.fillVias;
        var g = new THREE.Group();

        //Holes and cut-outs belong to the outer loop that contains them
        var shapes = board.outer.map(function (c) {
            return { contour: c, shape: new THREE.Shape(toVec(c)) };
        });
        function owner(x, y) {
            for (var i = 0; i < shapes.length; i++) {
                if (windingNumber(shapes[i].contour, x, y) !== 0) {
                    return shapes[i].shape;
                }
            }
            return null;
        }
        board.cutouts.forEach(function (c) {
            var s = owner(c[0], c[1]);
            if (s) {
                s.holes.push(new THREE.Path(toVec(c)));
            }
        });
        var drilled = board.holes.filter(function (hole) {
            return hole.r > 0.01 && !(fillVias && hole.via);
        });
        drilled.forEach(function (hole) {
            var s = owner(hole.x, hole.y);
            if (s) {
                s.holes.push(new THREE.Path(circlePts(hole.x, hole.y, hole.r)));
            }
        });
        board.slots.forEach(function (sl) {
            var c = data.slotContour(sl.item);
            var s = owner(c[0], c[1]);
            if (s) {
                s.holes.push(new THREE.Path(toVec(c)));
            }
        });
        var shapeList = shapes.map(function (s) { return s.shape; });

        //Laminate walls (the extruded caps are hidden, textured faces replace them)
        var body = keep(new THREE.ExtrudeGeometry(shapeList, { depth: t, bevelEnabled: false, curveSegments: 8 }));
        var hiddenCaps = keep(new THREE.MeshBasicMaterial({ visible: false }));
        g.add(new THREE.Mesh(body, [hiddenCaps, edgeMat]));
        g.add(flatFace(shapeList, b, data.topTex, t, false));
        g.add(flatFace(shapeList, b, data.bottomTex, 0, true));

        //Copper barrels in plated holes
        var plated = drilled.filter(function (hl) { return hl.plated; });
        if (plated.length) {
            var cyl = keep(new THREE.CylinderGeometry(1, 1, t, 20, 1, true));
            cyl.rotateX(Math.PI / 2);
            var barrelMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(data.barrel), roughness: 0.35, metalness: 0.55, side: THREE.DoubleSide }));
            var inst = new THREE.InstancedMesh(cyl, barrelMat, plated.length);
            var m = new THREE.Matrix4();
            plated.forEach(function (hl, i) {
                var r = hl.r * 0.985;
                m.makeScale(r, r, 1);
                m.setPosition(hl.x, hl.y, t / 2);
                inst.setMatrixAt(i, m);
            });
            inst.instanceMatrix.needsUpdate = true;
            g.add(inst);
        }
        return g;
    }

    //Plain laminate block (rails, tabs) with mask coloured faces
    function slab(x0, y0, x1, y1, t, faceMat, edgeMat, holes) {
        var s = new THREE.Shape([
            new THREE.Vector2(x0, y0), new THREE.Vector2(x1, y0), new THREE.Vector2(x1, y1), new THREE.Vector2(x0, y1)
        ]);
        (holes || []).forEach(function (h) {
            s.holes.push(new THREE.Path(circlePts(h[0], h[1], h[2])));
        });
        var geo = keep(new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 8 }));
        return new THREE.Mesh(geo, [faceMat, edgeMat]);
    }

    function disc(x, y, z, r, mat) {
        var geo = keep(new THREE.CircleGeometry(r, 24));
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        if (z < 0) {
            mesh.rotation.x = Math.PI;
        }
        return mesh;
    }

    /*
        data: {
            board        GV.board.build() result
            thickness    mm
            top, bottom  canvases covering board.bounds (realistic renders)
            edge         css colour of the laminate edge
            barrel       css colour of plated barrels
            background   css colour
            slotContour  GV.board.slotContour
            fillVias     true when vias are plugged or capped (no hole)
            stack        edge stack-up {layers, copperOz, core, base, baseRatio, mask, copper, metal}
            panel        {cols, rows, separation: 'vcut'|'tab', gap, rails: 'none'|'tb'|'lr'|'all',
                          railWidth, faceColor, finish} or null for a single board
            keepView     true to leave the camera where the user put it
        }
    */
    var hasBoard = false;
    function setBoard(data) {
        var keepCam = data.keepView && hasBoard;
        var camPos = camera.position.clone(), camTarget = controls.target.clone();
        clear();
        var b = data.board.bounds;
        var t = data.thickness;
        scene.background = new THREE.Color(data.background);

        data.topTex = faceTexture(data.top);
        data.bottomTex = faceTexture(data.bottom);
        var edgeMat;
        if (data.stack) {
            edgeMat = keep(new THREE.MeshStandardMaterial({
                map: keep(stackTexture(data.stack, t)),
                roughness: data.stack.metal ? 0.45 : 0.85,
                metalness: data.stack.metal ? 0.5 : 0
            }));
        } else {
            edgeMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(data.edge), roughness: 0.85, metalness: 0 }));
        }

        var unit = buildBoard(data, edgeMat);
        var p = data.panel;
        var extent;
        if (!p || (p.cols <= 1 && p.rows <= 1 && p.rails === 'none')) {
            group.add(unit);
            extent = [b[0], b[1], b[2], b[3]];
        } else {
            extent = buildPanel(unit, data, edgeMat);
        }
        size = Math.max(extent[2] - extent[0], extent[3] - extent[1], 1);
        group.position.set(-(extent[0] + extent[2]) / 2, -(extent[1] + extent[3]) / 2, -t / 2);
        hasBoard = true;
        if (keepCam) {
            camera.position.copy(camPos);
            controls.target.copy(camTarget);
            camera.near = size / 100;
            camera.far = size * 50;
            camera.updateProjectionMatrix();
            controls.update();
        } else {
            setView('iso');
        }
    }

    //Copies of the board in a grid, V-cut grooves or tabs, edge rails
    function buildPanel(unit, data, edgeMat) {
        var p = data.panel;
        var b = data.board.bounds;
        var t = data.thickness;
        var w = b[2] - b[0], h = b[3] - b[1];
        var vcut = p.separation === 'vcut';
        var gap = vcut ? 0 : p.gap;
        var cols = Math.max(1, p.cols), rows = Math.max(1, p.rows);
        var W = cols * w + (cols - 1) * gap, H = rows * h + (rows - 1) * gap;

        for (var i = 0; i < cols; i++) {
            for (var j = 0; j < rows; j++) {
                var copy = i === 0 && j === 0 ? unit : unit.clone();
                copy.position.set(i * (w + gap) - b[0], j * (h + gap) - b[1], 0);
                group.add(copy);
            }
        }

        var faceMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(p.faceColor), roughness: 0.55 }));
        var finishMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(p.finish), roughness: 0.35, metalness: 0.5 }));
        var holeMat = keep(new THREE.MeshBasicMaterial({ color: 0x111111 }));
        var x0 = 0, y0 = 0, x1 = W, y1 = H;
        var rw = p.railWidth, rg = gap;
        var rails = [];
        if (p.rails === 'tb' || p.rails === 'all') {
            rails.push({ x0: p.rails === 'all' ? -rg - rw : 0, y0: H + rg, x1: p.rails === 'all' ? W + rg + rw : W, y1: H + rg + rw, horiz: true });
            rails.push({ x0: p.rails === 'all' ? -rg - rw : 0, y0: -rg - rw, x1: p.rails === 'all' ? W + rg + rw : W, y1: -rg, horiz: true });
        }
        if (p.rails === 'lr' || p.rails === 'all') {
            rails.push({ x0: -rg - rw, y0: 0, x1: -rg, y1: H, horiz: false });
            rails.push({ x0: W + rg, y0: 0, x1: W + rg + rw, y1: H, horiz: false });
        }
        rails.forEach(function (r, k) {
            //Tooling holes (2 mm NPTH) near the ends, fiducials next to them
            var holes = [], fids = [];
            var len = r.horiz ? r.x1 - r.x0 : r.y1 - r.y0;
            var mid = r.horiz ? (r.y0 + r.y1) / 2 : (r.x0 + r.x1) / 2;
            [5, len - 5].forEach(function (d) {
                if (len > 14) {
                    holes.push(r.horiz ? [r.x0 + d, mid, 1.0] : [mid, r.y0 + d, 1.0]);
                }
            });
            if (len > 30 && k < 2) {
                fids.push(r.horiz ? [r.x0 + 12, mid] : [mid, r.y0 + 12]);
                fids.push(r.horiz ? [r.x1 - 12, mid] : [mid, r.y1 - 12]);
            }
            group.add(slab(r.x0, r.y0, r.x1, r.y1, t, faceMat, edgeMat, holes));
            fids.forEach(function (f) {
                group.add(disc(f[0], f[1], t + 0.004, 0.5, finishMat));
                group.add(disc(f[0], f[1], -0.004, 0.5, finishMat));
            });
            if (r.horiz) {
                x0 = Math.min(x0, r.x0);
                x1 = Math.max(x1, r.x1);
                y0 = Math.min(y0, r.y0);
                y1 = Math.max(y1, r.y1);
            } else {
                x0 = Math.min(x0, r.x0);
                x1 = Math.max(x1, r.x1);
            }
        });

        if (vcut) {
            //V grooves on both faces across the whole panel
            var lineMat = keep(new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.65 }));
            var xs = [], ys = [];
            for (var c = 1; c < cols; c++) {
                xs.push(c * w);
            }
            for (var rr = 1; rr < rows; rr++) {
                ys.push(rr * h);
            }
            if (p.rails === 'tb' || p.rails === 'all') {
                ys.push(0, H);
            }
            if (p.rails === 'lr' || p.rails === 'all') {
                xs.push(0, W);
            }
            var groove = 0.35;
            xs.forEach(function (x) {
                [t + 0.006, -0.006].forEach(function (z) {
                    var m = new THREE.Mesh(keep(new THREE.PlaneGeometry(groove, y1 - y0)), lineMat);
                    m.position.set(x, (y0 + y1) / 2, z);
                    if (z < 0) {
                        m.rotation.x = Math.PI;
                    }
                    group.add(m);
                });
            });
            ys.forEach(function (y) {
                [t + 0.006, -0.006].forEach(function (z) {
                    var m = new THREE.Mesh(keep(new THREE.PlaneGeometry(x1 - x0, groove)), lineMat);
                    m.position.set((x0 + x1) / 2, y, z);
                    if (z < 0) {
                        m.rotation.x = Math.PI;
                    }
                    group.add(m);
                });
            });
        } else {
            //Breakaway tabs with a row of stamp holes on each side
            var tabs = [];
            function edgeTabs(fixed, from, to, vertical) {
                var len = to - from;
                var at = len < 25 ? [0.5] : [0.25, 0.75];
                at.forEach(function (f) {
                    tabs.push({ c: from + f * len, fixed: fixed, vertical: vertical });
                });
            }
            for (var ci = 0; ci < cols; ci++) {
                for (var rj = 0; rj < rows; rj++) {
                    var bx = ci * (w + gap), by = rj * (h + gap);
                    if (ci < cols - 1) {
                        edgeTabs(bx + w + gap / 2, by, by + h, true);
                    }
                    if (rj < rows - 1) {
                        edgeTabs(by + h + gap / 2, bx, bx + w, false);
                    }
                    if (rj === 0 && (p.rails === 'tb' || p.rails === 'all')) {
                        edgeTabs(-gap / 2, bx, bx + w, false);
                    }
                    if (rj === rows - 1 && (p.rails === 'tb' || p.rails === 'all')) {
                        edgeTabs(H + gap / 2, bx, bx + w, false);
                    }
                    if (ci === 0 && (p.rails === 'lr' || p.rails === 'all')) {
                        edgeTabs(-gap / 2, by, by + h, true);
                    }
                    if (ci === cols - 1 && (p.rails === 'lr' || p.rails === 'all')) {
                        edgeTabs(W + gap / 2, by, by + h, true);
                    }
                }
            }
            var tl = 5;
            tabs.forEach(function (tb) {
                var m;
                if (tb.vertical) {
                    m = slab(tb.fixed - gap / 2 - 0.2, tb.c - tl / 2, tb.fixed + gap / 2 + 0.2, tb.c + tl / 2, t, faceMat, edgeMat);
                } else {
                    m = slab(tb.c - tl / 2, tb.fixed - gap / 2 - 0.2, tb.c + tl / 2, tb.fixed + gap / 2 + 0.2, t, faceMat, edgeMat);
                }
                group.add(m);
                //Five 0.5 mm stamp holes along each side of the tab
                [-1, 1].forEach(function (s) {
                    for (var k = 0; k < 5; k++) {
                        var along = tb.c - tl / 2 + 0.5 + k * (tl - 1) / 4;
                        var across = tb.fixed + s * (gap / 2 - 0.1);
                        var x = tb.vertical ? across : along, y = tb.vertical ? along : across;
                        group.add(disc(x, y, t + 0.005, 0.25, holeMat));
                        group.add(disc(x, y, -0.005, 0.25, holeMat));
                    }
                });
            });
        }
        return [x0, y0, x1, y1];
    }

    function setBackground(color) {
        scene.background = new THREE.Color(color);
    }

    function snapshot() {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
    }

    function dispose() {
        stop();
        clear();
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
    }

    return {
        setBoard: setBoard,
        setView: setView,
        setBackground: setBackground,
        resize: resize,
        start: start,
        stop: stop,
        snapshot: snapshot,
        dispose: dispose,
        maxTexture: function () { return renderer.capabilities.maxTextureSize; }
    };
}
