/*
    Blocky - render.js

    Everything that draws: the three.js renderer and scene, the terrain
    shader (one texture array holds every tile so mipmaps never bleed
    between tiles), chunk section meshes, the sky (gradient dome, sun, moon,
    stars, clouds), rain and lightning, the block selection outline and
    crack overlay, block particles and the first person held item.
*/

import * as THREE from "three";
import { meshSection, itemGeometry, cardGeometry } from "./mesher.js";
import { layerOfTile, ITEMS, BLOCKS } from "./blocks.js";
import { SECTIONS, WORLD_H } from "./world.js";
import { BIOME } from "./worldgen.js";
import { clamp, lerp, mulberry32 } from "./util.js";
import { Realistic, WAVE_GLSL, SHADE_GLSL, SUN_TILT, SEA_Y } from "./realistic.js";
import { DynLight, DYN_SIZE } from "./dynlight.js";

THREE.ColorManagement.enabled = false;

const TERRAIN_VERT = `
in float aLayer;
in vec2 aLight;
in vec3 aColor;
out vec2 vUv;
flat out float vLayer;
out vec2 vLight;
out vec3 vColor;
out float vDist;
out vec3 vWorld;
#ifdef REALISTIC
${WAVE_GLSL}
#endif
void main() {
    vUv = uv;
    vLayer = aLayer;
    vLight = aLight;
    vColor = aColor;
#ifdef REALISTIC
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.xyz = waveOffset(wp.xyz, aLayer, step(0.5, uv.y));
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
#else
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
#endif
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
}`;

const TERRAIN_FRAG = `
precision highp sampler2DArray;
precision highp sampler3D;
uniform sampler2DArray uTex;
uniform sampler3D uDynTex;
uniform vec4 uDyn;
uniform float uDaylight;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uWaterLayer;
uniform float uLavaLayer;
uniform float uFireLayer;
uniform float uAlphaTest;
uniform float uOpacity;
uniform float uGammaK;
uniform vec3 uLightOverride;
in vec2 vUv;
flat in float vLayer;
in vec2 vLight;
in vec3 vColor;
in float vDist;
in vec3 vWorld;
layout(location = 0) out highp vec4 outColor;
float curve(float l) {
    return l / (1.0 + uGammaK * (1.0 - l));
}
//Held light (dynlight.js): the grid cell this face looks into
float heldLight() {
    vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(n, cameraPosition - vWorld) < 0.0) {
        n = -n;
    }
    return texture(uDynTex, (vWorld + n * 0.5 - uDyn.xyz) / ${DYN_SIZE}.0).r;
}
#ifdef REALISTIC
${SHADE_GLSL}
#endif
void main() {
#ifdef REALISTIC
    if (vWorld.y < uClipY) {
        discard;
    }
#endif
    vec2 uv = vUv;
    if (abs(vLayer - uWaterLayer) < 0.5) {
        uv += vec2(sin(uTime * 0.7 + vUv.y * 3.0) * 0.03, uTime * 0.05);
    } else if (abs(vLayer - uLavaLayer) < 0.5) {
        uv += vec2(sin(uTime * 0.35 + vUv.y * 4.0) * 0.06, uTime * 0.025);
    } else if (abs(vLayer - uFireLayer) < 0.5) {
        uv.x += sin(uTime * 9.0 + vUv.y * 6.0) * 0.04 * vUv.y;
    }
    vec4 tex = texture(uTex, vec3(uv.x, 1.0 - uv.y, vLayer));
    if (tex.a < uAlphaTest) {
        discard;
    }
    vec2 L = uLightOverride.x > 0.5 ? uLightOverride.yz : vLight;
    if (uDyn.w > 0.5 && uLightOverride.x < 0.5) {
        L.y = max(L.y, heldLight());
    }
#ifdef REALISTIC
    outColor = shadeRealistic(tex, L, abs(vLayer - uWaterLayer) < 0.5);
#else
    float sky = curve(L.x * uDaylight);
    float blk = curve(L.y);
    vec3 light = max(vec3(sky), vec3(blk) * vec3(1.0, 0.86, 0.68));
    light = max(light, vec3(0.03));
    if (uLightOverride.x > 1.5) {
        //A brightness worked out by Renderer.objectLight
        light = vec3(uLightOverride.y);
    }
    vec3 col = tex.rgb * vColor * light;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    col = mix(col, uFogColor, fog);
    outColor = vec4(col, tex.a * uOpacity);
#endif
}`;

const SKY_VERT = `
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
}`;

const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uGlowColor;
uniform float uGlow;
varying vec3 vDir;
void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.45, h)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.2, h));
    float g = max(dot(d, uSunDir), 0.0);
    col += uGlowColor * pow(g, 5.0) * uGlow * (1.0 - smoothstep(0.0, 0.55, abs(h)));
    gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VERT = `
varying vec3 vWorld;
void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
}`;

const CLOUD_FRAG = `
uniform sampler2D uMap;
uniform vec2 uOffset;
uniform vec3 uColor;
uniform vec3 uCam;
uniform float uFade;
uniform float uSoft;
varying vec3 vWorld;
void main() {
    vec2 uv = (vWorld.xz + uOffset) / 1024.0;
    float cov;
    if (uSoft > 0.5) {
        //Realistic mode: blend the cloud cells into soft rounded puffs
        vec2 p = uv * 64.0 - 0.5;
        vec2 f = smoothstep(0.0, 1.0, fract(p));
        vec2 b = (floor(p) + 0.5) / 64.0;
        float o = 1.0 / 64.0;
        float c00 = texture2D(uMap, b).a, c10 = texture2D(uMap, b + vec2(o, 0.0)).a;
        float c01 = texture2D(uMap, b + vec2(0.0, o)).a, c11 = texture2D(uMap, b + vec2(o, o)).a;
        cov = smoothstep(0.3, 0.75, mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y));
        if (cov < 0.04) discard;
    } else {
        if (texture2D(uMap, uv).a < 0.5) discard;
        cov = 1.0;
    }
    float d = length(vWorld.xz - uCam.xz);
    float a = 0.82 * cov * (1.0 - smoothstep(uFade * 0.55, uFade, d));
    gl_FragColor = vec4(uColor * mix(1.0, 0.9 + 0.1 * cov, uSoft), a);
}`;

const CRACK_FRAG = `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform float uLayer;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
void main() {
    vec4 t = texture(uTex, vec3(vUv.x, 1.0 - vUv.y, uLayer));
    if (t.a < 0.3) discard;
    outColor = vec4(0.0, 0.0, 0.0, 0.62);
}`;

const CRACK_VERT = `
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function makeCanvas(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    return c;
}

function sunTexture() {
    return makeCanvas(64, 64, (ctx) => {
        const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
        g.addColorStop(0, "rgba(255,250,220,1)");
        g.addColorStop(0.32, "rgba(255,236,150,1)");
        g.addColorStop(0.42, "rgba(255,210,110,0.55)");
        g.addColorStop(1, "rgba(255,180,80,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
    });
}

function moonTexture(phase) {
    return makeCanvas(64, 64, (ctx) => {
        ctx.fillStyle = "rgba(235,238,250,1)";
        ctx.beginPath();
        ctx.arc(32, 32, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(190,196,214,1)";
        for (const [x, y, r] of [[26, 27, 4], [37, 35, 3], [30, 40, 2.5], [39, 25, 2]]) {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        //Phase shadow
        if (phase !== 0) {
            ctx.globalCompositeOperation = "destination-out";
            ctx.beginPath();
            ctx.arc(32 + phase * 30, 32, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalCompositeOperation = "source-over";
        }
    });
}

function cloudTexture(seed) {
    const rng = mulberry32(seed);
    const N = 64;
    const grid = (g) => {
        const a = new Float32Array(g * g);
        for (let i = 0; i < a.length; i++) {
            a[i] = rng();
        }
        return (x, y) => {
            const fx = x * g / N, fy = y * g / N;
            const ix = Math.floor(fx), iy = Math.floor(fy);
            const tx = fx - ix, ty = fy - iy;
            const v = (i, j) => a[((iy + j) % g) * g + ((ix + i) % g)];
            return lerp(lerp(v(0, 0), v(1, 0), tx), lerp(v(0, 1), v(1, 1), tx), ty);
        };
    };
    const g1 = grid(8), g2 = grid(16);
    return makeCanvas(N, N, (ctx) => {
        const img = ctx.createImageData(N, N);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const v = g1(x, y) * 0.7 + g2(x, y) * 0.3;
                const i = (y * N + x) * 4;
                img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
                img.data[i + 3] = v > 0.56 ? 255 : 0;
            }
        }
        ctx.putImageData(img, 0, 0);
    });
}

export class Renderer {
    constructor(canvas, tex) {
        this.canvas = canvas;
        this.tex = tex;
        this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
        this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
        this.gl.setClearColor(0x7fa9ff);
        this.gl.autoClear = false;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
        this.camera.rotation.order = "YXZ";
        this.handScene = new THREE.Scene();
        this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
        this.settings = { fancyLeaves: true, clouds: true, renderDistance: 6, brightness: 0.5, pixelRatio: 1 };
        this.time = 0;

        //Texture array with every tile
        const at = new THREE.DataArrayTexture(tex.layers, 16, 16, tex.count);
        at.format = THREE.RGBAFormat;
        at.type = THREE.UnsignedByteType;
        at.magFilter = THREE.NearestFilter;
        at.minFilter = THREE.NearestMipmapLinearFilter;
        at.wrapS = THREE.RepeatWrapping;
        at.wrapT = THREE.RepeatWrapping;
        at.generateMipmaps = true;
        at.needsUpdate = true;
        this.arrayTex = at;

        this.dyn = new DynLight();
        this.shared = {
            uTex: { value: at },
            uDynTex: { value: this.dyn.tex },
            uDyn: { value: this.dyn.uniform },
            uDaylight: { value: 1 },
            uFogColor: { value: new THREE.Color(0.75, 0.85, 1) },
            uFogNear: { value: 60 },
            uFogFar: { value: 100 },
            uTime: { value: 0 },
            uWaterLayer: { value: tex.layerOf.get("water") },
            uLavaLayer: { value: tex.layerOf.get("lava") },
            uFireLayer: { value: tex.layerOf.get("fire") },
            uGammaK: { value: 1.2 },
            //Realistic mode (see realistic.js)
            uWind: { value: 0.3 },
            uWaveLeaf: { value: [-10, -10] },
            uWavePlant: { value: new Array(16).fill(-10) },
            uShadowMap: { value: null },
            uShadowMatrix: { value: new THREE.Matrix4() },
            uShadowTexel: { value: 1 / 2048 },
            uShadowOn: { value: 0 },
            uLightDir: { value: new THREE.Vector3(0, 1, 0) },
            uSunColor: { value: new THREE.Vector3(1, 1, 1) },
            uAmbient: { value: new THREE.Vector3(0.3, 0.35, 0.45) },
            uCamPos: { value: new THREE.Vector3() },
            uClipY: { value: -1e9 },
            uReflectMap: { value: null },
            uReflectMatrix: { value: new THREE.Matrix4() },
            uReflectOn: { value: 0 },
            uSeaY: { value: SEA_Y },
            uSkyTop: { value: new THREE.Color() },
            uSkyHorizon: { value: new THREE.Color() },
            uWetness: { value: 0 },
            uLeafLayer: { value: -10 }
        };
        const layerOf = (n) => (tex.layerOf.has(n) ? tex.layerOf.get(n) : -10);
        this.shared.uWaveLeaf.value[0] = layerOf("leaves");
        this.shared.uLeafLayer.value = layerOf("leaves");
        ["tall_grass", "flower_yellow", "flower_red", "blue_flower", "sapling", "dead_bush",
            ...Array.from({ length: 8 }, (_, i) => "wheat_" + i)].forEach((n, i) => {
            this.shared.uWavePlant.value[i] = layerOf(n);
        });
        this.real = null;
        this.env = {};
        this.solidMat = this.terrainMaterial({ alphaTest: 0.5 });
        this.waterMat = this.terrainMaterial({ alphaTest: 0.0, transparent: true });
        this.solidMat.side = THREE.FrontSide;

        this.buildSky();
        this.buildClouds();
        this.buildRain();
        this.buildSelection();
        this.buildParticles();
        this.buildHand();
        this.lightning = [];
        this.itemGeoCache = new Map();
        this.world = null;
        this.resize();
    }

    terrainMaterial(opts = {}) {
        const m = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: TERRAIN_VERT,
            fragmentShader: TERRAIN_FRAG,
            uniforms: Object.assign({}, this.shared, {
                uAlphaTest: { value: opts.alphaTest !== undefined ? opts.alphaTest : 0.5 },
                uOpacity: { value: opts.opacity !== undefined ? opts.opacity : 1 },
                uLightOverride: { value: new THREE.Vector3(opts.override ? 1 : 0, 1, 0) }
            }),
            transparent: !!opts.transparent,
            depthWrite: !opts.transparent
        });
        return m;
    }

    resize() {
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        const pr = Math.min(window.devicePixelRatio || 1, 2) * (this.settings.pixelRatio || 1);
        this.gl.setPixelRatio(pr);
        this.gl.setSize(w, h, false);
        this.camera.aspect = w / Math.max(1, h);
        this.camera.updateProjectionMatrix();
        this.handCamera.aspect = this.camera.aspect;
        this.handCamera.updateProjectionMatrix();
    }

    applySettings(s) {
        Object.assign(this.settings, s);
        if (!!this.settings.realistic !== !!this.real) {
            this.setRealistic(!!this.settings.realistic);
        }
        this.shared.uGammaK.value = lerp(2.0, 0.25, clamp(this.settings.brightness, 0, 1));
        this.clouds.visible = this.settings.clouds !== false;
        this.resize();
    }

    //Turn the realistic pipeline on or off; false when the
    //browser cannot run it
    setRealistic(on) {
        if (on && !this.real) {
            try {
                this.real = new Realistic(this);
            } catch (e) {
                this.real = null;
            }
        } else if (!on && this.real) {
            this.real.dispose();
            this.real = null;
        }
        for (const m of [this.solidMat, this.waterMat]) {
            m.defines = this.real ? { REALISTIC: 1 } : {};
            m.needsUpdate = true;
        }
        //Clouds hide the sun from the light shafts; the sun feeds the bloom
        this.clouds.material.depthWrite = !!this.real;
        this.cloudUniforms.uSoft.value = this.real ? 1 : 0;
        this.sun.material.color.setScalar(this.real ? 1.6 : 1);
        if (!this.real) {
            this.celestial.rotation.x = 0;
        }
        return !!this.real;
    }

    //Animals, carts and items show up in the shadow map
    castShadows(obj) {
        obj.traverse((o) => o.layers.enable(1));
    }

    /* ---------------- sky ---------------- */

    buildSky() {
        this.skyUniforms = {
            uTop: this.shared.uSkyTop,
            uHorizon: this.shared.uSkyHorizon,
            uBottom: { value: new THREE.Color() },
            uSunDir: { value: new THREE.Vector3(1, 0, 0) },
            uGlowColor: { value: new THREE.Color(1.0, 0.5, 0.25) },
            uGlow: { value: 0 }
        };
        const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16), new THREE.ShaderMaterial({
            vertexShader: SKY_VERT,
            fragmentShader: SKY_FRAG,
            uniforms: this.skyUniforms,
            side: THREE.BackSide,
            depthWrite: false
        }));
        sky.renderOrder = -100;
        sky.frustumCulled = false;
        this.sky = sky;
        this.scene.add(sky);

        this.celestial = new THREE.Group();
        this.scene.add(this.celestial);
        //Stars
        const rng = mulberry32(99);
        const sp = new Float32Array(1500 * 3);
        for (let i = 0; i < 1500; i++) {
            const u = rng() * 2 - 1, a = rng() * Math.PI * 2;
            const r = Math.sqrt(1 - u * u);
            sp[i * 3] = Math.cos(a) * r * 350;
            sp[i * 3 + 1] = u * 350;
            sp[i * 3 + 2] = Math.sin(a) * r * 350;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
        this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false });
        this.stars = new THREE.Points(sg, this.starMat);
        this.stars.renderOrder = -99;
        this.stars.frustumCulled = false;
        this.celestial.add(this.stars);

        const sunMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sunTexture()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
        this.sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), sunMat);
        this.sun.position.set(330, 0, 0);
        this.sun.rotation.y = -Math.PI / 2;
        this.sun.renderOrder = -98;
        this.celestial.add(this.sun);
        this.moonPhase = -1;
        this.moonMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(moonTexture(0)), transparent: true, depthWrite: false, fog: false });
        this.moon = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), this.moonMat);
        this.moon.position.set(-330, 0, 0);
        this.moon.rotation.y = Math.PI / 2;
        this.moon.renderOrder = -98;
        this.celestial.add(this.moon);
        for (const o of [this.sun, this.moon]) {
            o.frustumCulled = false;
        }
    }

    buildClouds() {
        const t = new THREE.CanvasTexture(cloudTexture(1234));
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.generateMipmaps = false;
        this.cloudUniforms = {
            uMap: { value: t },
            uOffset: { value: new THREE.Vector2() },
            uColor: { value: new THREE.Color(1, 1, 1) },
            uCam: { value: new THREE.Vector3() },
            uFade: { value: 300 },
            uSoft: { value: 0 }
        };
        const m = new THREE.ShaderMaterial({
            vertexShader: CLOUD_VERT,
            fragmentShader: CLOUD_FRAG,
            uniforms: this.cloudUniforms,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const g = new THREE.PlaneGeometry(1200, 1200);
        g.rotateX(-Math.PI / 2);
        this.clouds = new THREE.Mesh(g, m);
        this.clouds.renderOrder = 10;
        this.clouds.frustumCulled = false;
        this.scene.add(this.clouds);
    }

    /* ---------------- rain & lightning ---------------- */

    buildRain() {
        this.rainCount = 1600;
        this.rainPos = new Float32Array(this.rainCount * 6);
        this.rainDrops = new Float32Array(this.rainCount * 4); //x, y, z, speed
        this.rainDrops.fill(-9999);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
        this.rainMat = new THREE.LineBasicMaterial({ color: 0xa8b8d8, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
        this.rain = new THREE.LineSegments(g, this.rainMat);
        this.rain.frustumCulled = false;
        this.rain.renderOrder = 20;
        this.rain.visible = false;
        this.scene.add(this.rain);
        this.rainExposure = 0;
    }

    //Moves rain streaks; returns how exposed the camera is (0-1) for audio
    updateRain(dt, strength, cam, world) {
        if (strength <= 0.01 || !world) {
            this.rain.visible = false;
            this.rainExposure = 0;
            return 0;
        }
        this.rain.visible = true;
        this.rainMat.opacity = 0.5 * strength;
        const R = 14;
        const active = Math.floor(this.rainCount * strength);
        let exposed = 0, sampled = 0;
        const d = this.rainDrops, p = this.rainPos;
        const rng = Math.random;
        for (let i = 0; i < this.rainCount; i++) {
            const k = i * 4;
            if (i >= active) {
                p.fill(0, i * 6, i * 6 + 6);
                p[i * 6 + 1] = p[i * 6 + 4] = -9999;
                continue;
            }
            d[k + 1] -= d[k + 3] * dt;
            const x = d[k], z = d[k + 2];
            const dx = x - cam.x, dz = z - cam.z;
            let respawn = d[k + 1] < -100 || dx * dx + dz * dz > R * R * 1.3;
            if (!respawn) {
                const top = world.rainTop(Math.floor(x), Math.floor(z));
                if (d[k + 1] < top || d[k + 1] < cam.y - 12) {
                    respawn = true;
                }
            }
            if (respawn) {
                const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * R;
                const nx = cam.x + Math.cos(a) * r, nz = cam.z + Math.sin(a) * r;
                const fx = Math.floor(nx), fz = Math.floor(nz);
                const top = world.rainTop(fx, fz);
                const biome = world.biomeAt(fx, fz);
                sampled++;
                if (top < 0 || biome === BIOME.DESERT || top > cam.y + 14) {
                    d[k] = nx; d[k + 1] = -9999; d[k + 2] = nz; d[k + 3] = 0;
                } else {
                    if (r < 5 && top <= cam.y + 2) {
                        exposed++;
                    }
                    d[k] = nx; d[k + 2] = nz;
                    d[k + 1] = Math.max(top, cam.y) + 4 + rng() * 14;
                    d[k + 3] = 14 + rng() * 6;
                }
            }
            const y = d[k + 1];
            p[i * 6] = d[k]; p[i * 6 + 1] = y; p[i * 6 + 2] = d[k + 2];
            p[i * 6 + 3] = d[k] + 0.04; p[i * 6 + 4] = y + 0.7; p[i * 6 + 5] = d[k + 2];
        }
        this.rain.geometry.attributes.position.needsUpdate = true;
        if (sampled > 0) {
            this.rainExposure = lerp(this.rainExposure, Math.min(1, exposed / Math.max(1, sampled * 0.12)), 0.1);
        }
        return this.rainExposure;
    }

    strikeLightning(x, y, z) {
        const g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({ color: 0xe6ecff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
        const rng = Math.random;
        let px = x, pz = z;
        const top = y + 120;
        let py = top;
        const segs = [];
        while (py > y) {
            const ny = Math.max(y, py - (4 + rng() * 6));
            const nx = px + (rng() - 0.5) * 4, nz = pz + (rng() - 0.5) * 4;
            segs.push([px, py, pz, ny < y + 1 ? x : nx, ny, ny < y + 1 ? z : nz]);
            px = ny < y + 1 ? x : nx;
            pz = ny < y + 1 ? z : nz;
            py = ny;
        }
        const w = 0.32;
        for (const [ax, ay, az, bx, by, bz] of segs) {
            for (const rot of [0, Math.PI / 2]) {
                const geo = new THREE.BufferGeometry();
                const ox = Math.cos(rot) * w, oz = Math.sin(rot) * w;
                geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
                    ax - ox, ay, az - oz, ax + ox, ay, az + oz, bx + ox, by, bz + oz,
                    ax - ox, ay, az - oz, bx + ox, by, bz + oz, bx - ox, by, bz - oz
                ]), 3));
                g.add(new THREE.Mesh(geo, mat));
            }
        }
        g.renderOrder = 30;
        this.scene.add(g);
        this.lightning.push({ group: g, mat, life: 0.45 });
    }

    updateLightning(dt) {
        for (let i = this.lightning.length - 1; i >= 0; i--) {
            const l = this.lightning[i];
            l.life -= dt;
            l.mat.opacity = l.life > 0 ? (Math.random() < 0.3 ? 0.3 : 0.95) : 0;
            if (l.life <= 0) {
                this.scene.remove(l.group);
                l.group.traverse((o) => o.geometry && o.geometry.dispose());
                l.mat.dispose();
                this.lightning.splice(i, 1);
            }
        }
    }

    /* ---------------- selection & cracks ---------------- */

    buildSelection() {
        const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
        this.selection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
        this.selection.visible = false;
        this.selection.renderOrder = 15;
        this.scene.add(this.selection);
        this.crackUniforms = { uTex: { value: this.arrayTex }, uLayer: { value: 0 } };
        this.crack = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: CRACK_VERT,
            fragmentShader: CRACK_FRAG,
            uniforms: this.crackUniforms,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4
        }));
        this.crack.visible = false;
        this.crack.renderOrder = 14;
        this.scene.add(this.crack);
    }

    setSelection(hit) {
        if (!hit) {
            this.selection.visible = false;
            this.crack.visible = false;
            return;
        }
        const b = hit.box;
        const e = 0.003;
        this.selection.visible = true;
        this.selection.position.set(hit.x + (b[0] + b[3]) / 2, hit.y + (b[1] + b[4]) / 2, hit.z + (b[2] + b[5]) / 2);
        this.selection.scale.set(b[3] - b[0] + e * 2, b[4] - b[1] + e * 2, b[5] - b[2] + e * 2);
    }

    setCrack(hit, progress) {
        if (!hit || progress <= 0) {
            this.crack.visible = false;
            return;
        }
        const b = hit.box;
        const stage = Math.min(9, Math.floor(progress * 10));
        this.crackUniforms.uLayer.value = this.tex.layerOf.get("destroy_" + stage);
        this.crack.visible = true;
        this.crack.position.copy(this.selection.position);
        this.crack.scale.set(b[3] - b[0] + 0.004, b[4] - b[1] + 0.004, b[5] - b[2] + 0.004);
    }

    /* ---------------- particles ---------------- */

    buildParticles() {
        this.pMax = 800;
        this.pPos = new Float32Array(this.pMax * 3);
        this.pCol = new Float32Array(this.pMax * 3);
        this.pVel = new Float32Array(this.pMax * 3);
        this.pLife = new Float32Array(this.pMax);
        this.pCount = 0;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
        g.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3));
        this.particles = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.1, vertexColors: true, sizeAttenuation: true }));
        this.particles.frustumCulled = false;
        this.scene.add(this.particles);
    }

    spawnParticles(x, y, z, color, count, spread = 0.45, speed = 3, brightness = 1) {
        for (let i = 0; i < count; i++) {
            if (this.pCount >= this.pMax) {
                return;
            }
            const k = this.pCount++;
            this.pPos[k * 3] = x + (Math.random() - 0.5) * spread * 2;
            this.pPos[k * 3 + 1] = y + (Math.random() - 0.5) * spread * 2;
            this.pPos[k * 3 + 2] = z + (Math.random() - 0.5) * spread * 2;
            this.pVel[k * 3] = (Math.random() - 0.5) * speed;
            this.pVel[k * 3 + 1] = Math.random() * speed;
            this.pVel[k * 3 + 2] = (Math.random() - 0.5) * speed;
            const v = (0.75 + Math.random() * 0.35) * brightness / 255;
            this.pCol[k * 3] = color[0] * v;
            this.pCol[k * 3 + 1] = color[1] * v;
            this.pCol[k * 3 + 2] = color[2] * v;
            this.pLife[k] = 0.5 + Math.random() * 0.6;
        }
    }

    updateParticles(dt, world) {
        let n = this.pCount;
        for (let i = 0; i < n; i++) {
            this.pLife[i] -= dt;
            if (this.pLife[i] <= 0) {
                n--;
                this.pLife[i] = this.pLife[n];
                for (let a = 0; a < 3; a++) {
                    this.pPos[i * 3 + a] = this.pPos[n * 3 + a];
                    this.pVel[i * 3 + a] = this.pVel[n * 3 + a];
                    this.pCol[i * 3 + a] = this.pCol[n * 3 + a];
                }
                i--;
                continue;
            }
            this.pVel[i * 3 + 1] -= 16 * dt;
            const nx = this.pPos[i * 3] + this.pVel[i * 3] * dt;
            const ny = this.pPos[i * 3 + 1] + this.pVel[i * 3 + 1] * dt;
            const nz = this.pPos[i * 3 + 2] + this.pVel[i * 3 + 2] * dt;
            if (world && BLOCKS[world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz))].solid) {
                this.pVel[i * 3] *= 0.3;
                this.pVel[i * 3 + 1] = 0;
                this.pVel[i * 3 + 2] *= 0.3;
            } else {
                this.pPos[i * 3] = nx;
                this.pPos[i * 3 + 1] = ny;
                this.pPos[i * 3 + 2] = nz;
            }
        }
        this.pCount = n;
        const g = this.particles.geometry;
        g.setDrawRange(0, n);
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate = true;
    }

    /* ---------------- item meshes ---------------- */

    itemGeometry(id) {
        let entry = this.itemGeoCache.get(id);
        if (!entry) {
            const { geo, cube } = itemGeometry(id);
            entry = { geometry: this.toGeometry(geo), cube };
            entry.geometry.computeBoundingSphere();
            this.itemGeoCache.set(id, entry);
        }
        return entry;
    }

    //A flat card showing one tile (held item variants)
    cardGeometry(tile) {
        const key = "tile:" + tile;
        let entry = this.itemGeoCache.get(key);
        if (!entry) {
            entry = { geometry: this.toGeometry(cardGeometry(tile)), cube: false };
            entry.geometry.computeBoundingSphere();
            this.itemGeoCache.set(key, entry);
        }
        return entry;
    }

    //A mesh for a dropped item / falling block with its own light uniform
    makeItemMesh(id) {
        const entry = this.itemGeometry(id);
        const mat = this.terrainMaterial({ alphaTest: 0.3, override: true });
        const mesh = new THREE.Mesh(entry.geometry, mat);
        mesh.userData.cube = entry.cube;
        mesh.layers.enable(1);
        return mesh;
    }

    setMeshLight(mesh, sky, blk) {
        const v = mesh.material.uniforms.uLightOverride.value;
        if (this.real) {
            v.set(2, this.objectLight(sky, blk), 0);
        } else {
            v.set(1, sky, blk);
        }
    }

    //Brightness (display space) of things lit by one light level: animals,
    //carts, dropped items and the held item. The realistic mode lights the
    //terrain differently, so they follow its sun, sky and torch light.
    objectLight(sky, blk) {
        const sh = this.shared, k = sh.uGammaK.value;
        const curve = (l) => l / (1 + k * (1 - l));
        if (!this.real) {
            return Math.max(0.06, curve(sky * sh.uDaylight.value), curve(blk));
        }
        const luma = (v) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
        const lin = luma(sh.uSunColor.value) * 0.55 * THREE.MathUtils.smoothstep(sky, 0.4, 0.93) +
            luma(sh.uAmbient.value) * Math.pow(curve(sky), 1.3) + 0.012 + Math.pow(curve(blk), 2.2) * 1.4;
        return Math.min(1.6, Math.pow(lin, 1 / 2.2));
    }

    disposeItemMesh(mesh) {
        mesh.material.dispose();
        if (mesh.parent) {
            mesh.parent.remove(mesh);
        }
    }

    /* ---------------- held item ---------------- */

    buildHand() {
        this.handGroup = new THREE.Group();
        this.handScene.add(this.handGroup);
        this.handMat = this.terrainMaterial({ alphaTest: 0.3, override: true });
        this.handMat.depthTest = true;
        this.handMesh = null;
        this.handId = -1;
        //Bare arm: a skin coloured box with baked face shading and a sleeve
        const armGeo = new THREE.BoxGeometry(0.17, 0.17, 0.66);
        const normals = armGeo.attributes.normal, positions = armGeo.attributes.position;
        const colors = new Float32Array(normals.count * 3);
        for (let i = 0; i < normals.count; i++) {
            const ny = normals.getY(i), nx = normals.getX(i);
            const shade = ny > 0.5 ? 1 : ny < -0.5 ? 0.55 : nx !== 0 ? 0.72 : 0.86;
            const sleeve = positions.getZ(i) > 0.12;
            const base = sleeve ? [0.27, 0.42, 0.62] : [0.86, 0.64, 0.49];
            colors[i * 3] = base[0] * shade;
            colors[i * 3 + 1] = base[1] * shade;
            colors[i * 3 + 2] = base[2] * shade;
        }
        armGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        this.armMat = new THREE.MeshBasicMaterial({ vertexColors: true });
        this.arm = new THREE.Mesh(armGeo, this.armMat);
        this.handGroup.add(this.arm);
        //Held card orientations: at rest, and a drawn bow (the arrow on the
        //tile runs from the top left to the bottom right corner)
        this.handIdleQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.75, 0.12));
        const aL = new THREE.Vector3(1, -1, 0).normalize(), nL = new THREE.Vector3(0, 0, 1);
        const bL = new THREE.Vector3().crossVectors(nL, aL);
        const aW = new THREE.Vector3(-0.72, 0.16, -0.68).normalize();
        const nW = new THREE.Vector3(-0.6, 0.12, 0.8);
        nW.addScaledVector(aW, -nW.dot(aW)).normalize();
        const bW = new THREE.Vector3().crossVectors(nW, aW);
        const local = new THREE.Matrix4().makeBasis(aL, bL, nL);
        const world = new THREE.Matrix4().makeBasis(aW, bW, nW);
        this.bowAimQ = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.transpose()));
    }

    //tile: draw the held item as this flat tile instead (a pulled bow)
    setHeldItem(id, tile = null) {
        const key = id + ":" + (tile || "");
        if (key === this.handKey) {
            return;
        }
        this.handKey = key;
        this.handId = id;
        this.handTile = tile;
        if (this.handMesh) {
            this.handGroup.remove(this.handMesh);
            this.handMesh = null;
        }
        this.arm.visible = !id;
        if (!id) {
            return;
        }
        const entry = tile ? this.cardGeometry(tile) : this.itemGeometry(id);
        this.handMesh = new THREE.Mesh(entry.geometry, this.handMat);
        this.handMesh.userData.cube = entry.cube;
        this.handGroup.add(this.handMesh);
    }

    //pose: { swing 0-1, equip 0-1, bobX, bobY, eat 0-1, sky, blk }
    updateHand(pose) {
        this.setMeshLight({ material: this.handMat }, pose.sky, pose.blk);
        const c = this.real ? Math.max(0.2, this.objectLight(pose.sky, pose.blk)) : Math.max(0.2, Math.max(pose.sky * this.shared.uDaylight.value, pose.blk));
        this.armMat.color.setRGB(c, c, c);
        const s = Math.sin(pose.swing * Math.PI);
        const s2 = Math.sin(Math.sqrt(pose.swing) * Math.PI);
        const g = this.handGroup;
        g.position.set(0.52 + pose.bobX - s2 * 0.2, -0.5 + pose.bobY - pose.equip * 0.6 + s * 0.12 - pose.eat * 0.05 * Math.abs(Math.sin(pose.eatT * 18)), -0.9 - s * 0.15);
        g.rotation.set(-s * 0.9 + pose.eat * 0.5, -s2 * 0.4 + pose.eat * 0.6, s * 0.2);
        if (pose.draw) {
            //Pulling a bow: the bow comes in toward the middle of the view
            //and back toward the face, shaking a little at full draw
            const d = Math.min(1, pose.draw * 3);
            const shake = pose.draw >= 1 ? Math.sin(performance.now() * 0.06) * 0.004 : 0;
            g.position.x -= d * 0.24;
            g.position.y += d * 0.1 + shake;
            g.position.z += d * 0.12 + pose.draw * 0.08;
        }
        if (this.handMesh && pose.draw && this.handTile) {
            //Turn the card so the arrow points at the crosshair and its face
            //looks back toward the player
            const d = Math.min(1, pose.draw * 3);
            this.handMesh.scale.setScalar(0.5);
            this.handMesh.position.set(0.02, 0.1, -0.05);
            this.handMesh.quaternion.copy(this.handIdleQ).slerp(this.bowAimQ, d);
        } else if (this.handMesh) {
            if (this.handMesh.userData.cube) {
                this.handMesh.scale.setScalar(0.24);
                this.handMesh.position.set(0.1, -0.02, -0.04);
                this.handMesh.rotation.set(0.1, Math.PI / 4, 0);
            } else {
                //A flat item held upright, turned a little toward the view
                this.handMesh.scale.setScalar(0.42);
                this.handMesh.position.set(0.02, 0.1, -0.05);
                this.handMesh.rotation.set(0.1, -0.75, 0.12);
            }
        }
        this.arm.position.set(0.12, -0.14, 0.24);
        this.arm.rotation.set(0.55, 0.18, 0.1);
    }

    /* ---------------- chunk meshes ---------------- */

    toGeometry(d) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
        g.setAttribute("uv", new THREE.BufferAttribute(d.uv, 2));
        g.setAttribute("aLayer", new THREE.BufferAttribute(d.layer, 1));
        g.setAttribute("aLight", new THREE.BufferAttribute(d.light, 2));
        g.setAttribute("aColor", new THREE.BufferAttribute(d.color, 3));
        g.setIndex(new THREE.BufferAttribute(d.index, 1));
        return g;
    }

    attachWorld(world) {
        this.detachWorld();
        this.world = world;
    }

    detachWorld() {
        if (!this.world) {
            return;
        }
        for (const c of this.world.chunks.values()) {
            this.disposeChunk(c);
        }
        this.world = null;
        this.pCount = 0;
        this.setSelection(null);
        for (const l of this.lightning) {
            this.scene.remove(l.group);
        }
        this.lightning = [];
    }

    disposeChunk(c) {
        if (!c.meshes) {
            return;
        }
        for (const s of c.meshes) {
            if (!s) {
                continue;
            }
            for (const m of [s.solid, s.water]) {
                if (m) {
                    this.scene.remove(m);
                    m.geometry.dispose();
                }
            }
        }
        c.meshes = null;
    }

    setSectionMesh(c, sy, data) {
        if (!c.meshes) {
            c.meshes = new Array(SECTIONS).fill(null);
        }
        const old = c.meshes[sy];
        if (old) {
            for (const m of [old.solid, old.water]) {
                if (m) {
                    this.scene.remove(m);
                    m.geometry.dispose();
                }
            }
        }
        const entry = { solid: null, water: null };
        const sphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14);
        if (data && data.solid) {
            const g = this.toGeometry(data.solid);
            g.boundingSphere = sphere;
            const m = new THREE.Mesh(g, this.solidMat);
            m.layers.enable(1);
            m.position.set(c.cx * 16, sy * 16, c.cz * 16);
            m.matrixAutoUpdate = false;
            m.updateMatrix();
            this.scene.add(m);
            entry.solid = m;
        }
        if (data && data.water) {
            const g = this.toGeometry(data.water);
            g.boundingSphere = sphere.clone();
            const m = new THREE.Mesh(g, this.waterMat);
            m.position.set(c.cx * 16, sy * 16, c.cz * 16);
            m.matrixAutoUpdate = false;
            m.updateMatrix();
            m.renderOrder = 1;
            this.scene.add(m);
            entry.water = m;
        }
        c.meshes[sy] = entry;
    }

    //Rebuild dirty sections near the camera; returns sections still waiting
    updateMeshes(world, camX, camZ, radius, deadline) {
        const pcx = Math.floor(camX / 16), pcz = Math.floor(camZ / 16);
        const list = [];
        for (const c of world.chunks.values()) {
            const dx = c.cx - pcx, dz = c.cz - pcz;
            if (Math.abs(dx) > radius || Math.abs(dz) > radius) {
                if (c.meshes && (Math.abs(dx) > radius + 1 || Math.abs(dz) > radius + 1)) {
                    this.disposeChunk(c);
                    c.dirty.fill(1);
                }
                continue;
            }
            let dirty = false;
            for (let s = 0; s < SECTIONS; s++) {
                if (c.dirty[s]) {
                    dirty = true;
                    break;
                }
            }
            if (dirty && world.isMeshable(c)) {
                list.push([dx * dx + dz * dz, c]);
            }
        }
        list.sort((a, b) => a[0] - b[0]);
        const opts = { fancyLeaves: this.settings.fancyLeaves };
        let pending = 0;
        for (const [, c] of list) {
            for (let s = 0; s < SECTIONS; s++) {
                if (!c.dirty[s]) {
                    continue;
                }
                if (performance.now() > deadline) {
                    pending++;
                    continue;
                }
                c.dirty[s] = 0;
                const data = meshSection(world, c, s, opts);
                this.setSectionMesh(c, s, data.empty ? null : data);
            }
        }
        return pending;
    }

    remeshAll(world) {
        for (const c of world.chunks.values()) {
            c.dirty.fill(1);
        }
    }

    /* ---------------- environment & frame ---------------- */

    //env: time (0-24000, 0 = sunrise), rain, thunder, flash, underwater,
    //renderDistance, day (number of days for the moon phase)
    applyEnvironment(env) {
        const ang = (env.time / 24000) * Math.PI * 2;
        const sunH = Math.sin(ang);
        const day = clamp(0.5 + sunH * 2.2, 0, 1);
        const rain = env.rain, thunder = env.thunder;
        const daylightBase = lerp(0.16, 1.0, day) * (1 - rain * 0.22) * (1 - thunder * 0.3);
        const daylight = Math.min(1.2, daylightBase + env.flash * 0.9);
        this.shared.uDaylight.value = daylight;

        //The realistic mode's tone mapping lightens the sky; start it deeper
        const dayTop = this.real ? [0.24, 0.48, 0.98] : [0.42, 0.62, 1.0];
        const dayHor = this.real ? [0.58, 0.74, 0.97] : [0.74, 0.85, 1.0];
        const nightTop = [0.008, 0.01, 0.035], nightHor = [0.03, 0.04, 0.09];
        const top = [0, 1, 2].map((i) => lerp(nightTop[i], dayTop[i], day));
        const hor = [0, 1, 2].map((i) => lerp(nightHor[i], dayHor[i], day));
        const grey = (c, amt, dark) => {
            const g = (c[0] + c[1] + c[2]) / 3;
            return c.map((v) => lerp(v, g * dark, amt));
        };
        let t = grey(top, rain * 0.8, 0.75), h = grey(hor, rain * 0.8, 0.8);
        if (thunder > 0) {
            t = t.map((v) => v * (1 - thunder * 0.4));
            h = h.map((v) => v * (1 - thunder * 0.4));
        }
        if (env.flash > 0) {
            t = t.map((v) => Math.min(1, v + env.flash * 0.5));
            h = h.map((v) => Math.min(1, v + env.flash * 0.5));
        }
        this.skyUniforms.uTop.value.setRGB(t[0], t[1], t[2]);
        this.skyUniforms.uHorizon.value.setRGB(h[0], h[1], h[2]);
        this.skyUniforms.uBottom.value.setRGB(h[0] * 0.92, h[1] * 0.92, h[2] * 0.95);
        const sunset = clamp(1 - Math.abs(sunH) * 3.2, 0, 1) * (1 - rain);
        this.skyUniforms.uGlow.value = sunset * 0.9;
        //The realistic mode tilts the sun's path so shadows are not all square
        const tilt = this.real ? SUN_TILT : 0;
        const sd = this.skyUniforms.uSunDir.value.set(Math.cos(ang), Math.sin(ang) * Math.cos(tilt), Math.sin(ang) * Math.sin(tilt));
        this.celestial.rotation.x = tilt;
        this.celestial.rotation.z = ang;
        this.realLight(sd, t, h, env);
        this.sun.material.opacity = 1 - rain;
        this.moonMat.opacity = 1 - rain * 0.9;
        this.starMat.opacity = clamp(1 - day * 1.6, 0, 1) * (1 - rain);
        const phase = ((env.day || 0) % 8);
        if (phase !== this.moonPhase) {
            this.moonPhase = phase;
            //0 full, 4 new; the shadow disc slides across the moon
            const shift = [0, -1.05, -0.7, -0.35, 0.001, 0.35, 0.7, 1.05][phase];
            this.moonMat.map.dispose();
            this.moonMat.map = new THREE.CanvasTexture(moonTexture(shift));
            this.moonMat.needsUpdate = true;
        }

        //Fog matches the horizon (with a touch of sunset)
        let fog = h.slice();
        const look = new THREE.Vector3();
        this.camera.getWorldDirection(look);
        const towardSun = Math.max(0, look.x * Math.cos(ang)) * sunset;
        fog = [lerp(fog[0], 1.0, towardSun * 0.45), lerp(fog[1], 0.55, towardSun * 0.3), lerp(fog[2], 0.3, towardSun * 0.3)];
        const far = Math.max(24, env.renderDistance * 16 - 6);
        if (env.underlava) {
            this.shared.uFogColor.value.setRGB(0.75, 0.2, 0.02);
            this.shared.uFogNear.value = 0.1;
            this.shared.uFogFar.value = 2.5;
        } else if (env.underwater) {
            const k = Math.max(0.15, daylight);
            this.shared.uFogColor.value.setRGB(0.06 * k, 0.17 * k, 0.4 * k);
            this.shared.uFogNear.value = 1;
            this.shared.uFogFar.value = 24;
        } else {
            this.shared.uFogColor.value.setRGB(fog[0], fog[1], fog[2]);
            this.shared.uFogFar.value = far * (1 - rain * 0.25);
            this.shared.uFogNear.value = this.shared.uFogFar.value * (0.55 - rain * 0.25);
        }
        this.gl.setClearColor(new THREE.Color(h[0], h[1], h[2]));

        //Clouds
        const cc = lerp(0.12, 1.0, day) * (1 - rain * 0.35);
        this.cloudUniforms.uColor.value.setRGB(cc, cc, cc * (1.02 + (1 - day) * 0.1));
        this.cloudUniforms.uFade.value = Math.max(160, far * 2.2);
        return { daylight, day };
    }

    //Direct light (sun by day, moon by night) and sky ambient, in linear light
    realLight(sd, top, hor, env) {
        const sh = this.shared, sm = THREE.MathUtils.smoothstep;
        const dim = (1 - env.rain * 0.8) * (1 - env.thunder * 0.5);
        const col = sh.uSunColor.value, dir = sh.uLightDir.value;
        if (sd.y > -0.02) {
            const k = sm(sd.y, 0.02, 0.5);
            dir.copy(sd);
            col.set(1.0, lerp(0.42, 0.92, k), lerp(0.16, 0.8, k)).multiplyScalar(2.3 * sm(sd.y, -0.02, 0.15) * dim);
        } else {
            dir.copy(sd).negate();
            col.set(0.55, 0.65, 1.0).multiplyScalar(0.3 * sm(-sd.y, -0.02, 0.15) * dim);
        }
        const amb = [0, 1, 2].map((i) => Math.pow(lerp(hor[i], top[i], 0.6), 2.2) * 0.45);
        //A third grey, so shade is cool but not blue
        const grey = (amb[0] + amb[1] + amb[2]) / 3;
        sh.uAmbient.value.set(...amb.map((v) => lerp(v, grey, 0.35) + env.flash * 0.8));
        sh.uWetness.value = env.rain;
        sh.uWind.value = 0.3 + env.rain * 0.5 + env.thunder * 0.5;
        this.env = env;
    }

    render(dt, showHand) {
        this.time += dt;
        this.shared.uTime.value = this.time;
        const cam = this.camera;
        this.sky.position.copy(cam.position);
        this.celestial.position.copy(cam.position);
        this.clouds.position.set(cam.position.x, 112, cam.position.z);
        this.cloudUniforms.uOffset.value.set(this.time * 1.2, 0);
        this.cloudUniforms.uCam.value.copy(cam.position);
        if (this.real) {
            this.real.render(showHand, this.env);
            return;
        }
        this.gl.clear();
        this.gl.render(this.scene, cam);
        if (showHand) {
            this.gl.clearDepth();
            this.gl.render(this.handScene, this.handCamera);
        }
    }
}
