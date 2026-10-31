/*
    Blocky - experimental realistic renderer

    An optional pipeline on top of the normal renderer, for fast PCs:
    - a shadow map from the sun (or the moon at night) with soft edges
    - the terrain shader's REALISTIC branch: lighting in linear space,
      direct sun light, waving leaves and plants, Fresnel water with a
      planar reflection of the sea and sun glints
    - HDR post processing: bloom, god rays, filmic tone mapping, a little
      grading and a vignette

    Everything is drawn into a half float target in display space; the post
    passes convert to linear light and back, so objects that know nothing
    about this mode (animals, items, the sky) still look right.
*/

import * as THREE from "three";
import { SEA } from "./worldgen.js";

export const SEA_Y = SEA + 0.875;
export const SHADOW_RANGE = 72;
export const SUN_TILT = 0.38;

//Leaves sway as a whole, plants only at the top; offsets depend on the
//world position alone, so neighbouring faces never split apart
export const WAVE_GLSL = `
uniform float uTime;
uniform float uWind;
uniform float uWaveLeaf[2];
uniform float uWavePlant[16];
vec3 waveOffset(vec3 wp, float layer, float top) {
    float kind = 0.0;
    for (int i = 0; i < 2; i++) {
        if (abs(layer - uWaveLeaf[i]) < 0.5) kind = 1.0;
    }
    for (int i = 0; i < 16; i++) {
        if (abs(layer - uWavePlant[i]) < 0.5) kind = 2.0;
    }
    if (kind < 0.5) return wp;
    float amp = (kind > 1.5 ? 0.075 * top : 0.028) * (0.6 + uWind);
    float ph = uTime * 1.6 + wp.x * 0.62 + wp.z * 0.41 + wp.y * 0.27;
    wp.x += sin(ph) * amp + sin(uTime * 2.9 + wp.z * 1.7) * amp * 0.35;
    wp.z += cos(ph * 0.83 + 1.3) * amp * 0.8;
    if (kind < 1.5) wp.y += sin(ph * 1.3) * amp * 0.4;
    return wp;
}`;

//The terrain fragment shader's realistic lighting (inside #ifdef REALISTIC;
//needs curve(), vWorld, vColor, vLight and the shared uniforms)
export const SHADE_GLSL = `
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform float uShadowOn;
uniform vec3 uLightDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uCamPos;
uniform float uClipY;
uniform sampler2D uReflectMap;
uniform mat4 uReflectMatrix;
uniform float uReflectOn;
uniform float uSeaY;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform float uWetness;
uniform float uLeafLayer;

float shadowAt(vec3 N, float skyRaw) {
    float fallback = smoothstep(0.8, 1.0, skyRaw);
    if (uShadowOn < 0.5) return fallback;
    vec4 sc = uShadowMatrix * vec4(vWorld + N * 0.1, 1.0);
    vec3 s = sc.xyz;
    vec2 e = min(s.xy, 1.0 - s.xy);
    float edge = clamp(min(e.x, e.y) * 14.0, 0.0, 1.0);
    if (edge <= 0.0 || s.z >= 1.0) return fallback;
    float z = s.z - 0.00025;
    float sum = 0.0;
    for (int y = 0; y < 4; y++) {
        for (int x = 0; x < 4; x++) {
            vec2 o = (vec2(float(x), float(y)) - 1.5) * uShadowTexel;
            sum += step(z, textureLod(uShadowMap, s.xy + o, 0.0).r);
        }
    }
    return mix(fallback, sum / 16.0, edge);
}

float waveHeight(vec2 p) {
    float t = uTime;
    float h = sin(dot(p, vec2(0.8, 0.6)) * 1.3 + t * 1.1) * 0.05;
    h += sin(dot(p, vec2(-0.5, 0.85)) * 2.1 + t * 1.6) * 0.03;
    h += sin(dot(p, vec2(0.95, -0.3)) * 3.7 + t * 2.3) * 0.016;
    h += sin(dot(p, vec2(-0.2, -0.98)) * 6.1 + t * 3.1) * (0.008 + uWetness * 0.012);
    return h;
}

vec3 waterNormal(vec2 p) {
    float e = 0.08;
    float h0 = waveHeight(p);
    return normalize(vec3(h0 - waveHeight(p + vec2(e, 0.0)), e, h0 - waveHeight(p + vec2(0.0, e))));
}

vec3 skyColor(vec3 d) {
    vec3 c = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, 0.45, max(d.y, 0.0)));
    return pow(c, vec3(2.2)) + uSunColor * pow(max(dot(d, uLightDir), 0.0), 12.0) * 0.15;
}

vec4 shadeRealistic(vec4 tex, vec2 L, bool isWater) {
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    vec3 an = abs(N);
    bool axis = max(an.x, max(an.y, an.z)) > 0.98;
    //The mesher bakes a shade per face direction; the sun does that job here
    float face = 1.0;
    if (axis) {
        face = an.y > 0.5 ? (N.y > 0.0 ? 1.0 : 0.5) : (an.x > 0.5 ? 0.6 : 0.8);
    }
    vec3 albedo = pow(tex.rgb * min(vColor / face, vec3(1.4)), vec3(2.2));
    float skyL = curve(L.x), blkL = curve(L.y);
    float ndl = dot(N, uLightDir);
    //Plants and odd shapes take light from both sides
    float diffuse = axis ? max(ndl, 0.0) : 0.4 + 0.6 * abs(ndl);
    float sh = diffuse > 0.0 ? shadowAt(N, L.x) : 0.0;
    //Sky light fades with depth under water and inside caves; sunlight follows it
    vec3 direct = uSunColor * diffuse * sh * smoothstep(0.4, 0.93, L.x);
    vec3 V = normalize(uCamPos - vWorld);
    //Leaves and plants let some light through: they glow when backlit
    if (!axis || abs(vLayer - uLeafLayer) < 0.5) {
        direct += uSunColor * vec3(1.0, 0.9, 0.6) * pow(max(dot(-V, uLightDir), 0.0), 3.0) * 0.3 * smoothstep(0.3, 0.9, L.x);
    }
    //Sky light, plus sunlight bounced off the ground onto walls and undersides
    vec3 amb = (uAmbient * (0.82 + 0.18 * N.y) + uSunColor * 0.08 * (0.6 - 0.4 * N.y)) * pow(skyL, 1.3) + vec3(0.010, 0.012, 0.020);
    vec3 torch = vec3(1.0, 0.62, 0.32) * pow(blkL, 2.2) * 1.8;
    vec3 col = albedo * (direct + amb + torch);
    float alpha = tex.a * uOpacity;
    if (isWater && N.y > 0.5) {
        vec3 wn = waterNormal(vWorld.xz);
        float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, wn), 0.0), 5.0);
        vec3 R = reflect(-V, wn);
        vec3 refl = skyColor(R) * mix(0.35, 1.0, skyL);
        if (uReflectOn > 0.5 && abs(vWorld.y - uSeaY) < 0.02) {
            vec4 rc = uReflectMatrix * vec4(vWorld, 1.0);
            vec2 ruv = rc.xy / rc.w + wn.xz * 0.06;
            refl = pow(max(textureLod(uReflectMap, clamp(ruv, 0.002, 0.998), 0.0).rgb, 0.0), vec3(2.2));
        }
        float spec = pow(max(dot(R, uLightDir), 0.0), 300.0) * sh;
        //Deep water scatters blue-green light; the texture only adds a little grain
        float grain = 0.75 + 0.5 * dot(tex.rgb, vec3(0.3, 0.4, 0.3));
        vec3 deep = vec3(0.025, 0.09, 0.13) * grain * (amb * 1.3 + direct * 0.3 + torch * 0.5);
        col = mix(deep, refl, F) + uSunColor * spec * 5.0;
        alpha = mix(0.6, 1.0, F);
    }
    //Fog with a little haze, warmer toward the sun
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    fog = max(fog, (1.0 - exp(-vDist * (0.004 + uWetness * 0.006))) * 0.5);
    float sunAmt = pow(max(dot(-V, uLightDir), 0.0), 8.0);
    vec3 fogC = pow(uFogColor, vec3(2.2)) + uSunColor * sunAmt * 0.12;
    col = mix(col, fogC, fog);
    return vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), alpha);
}`;

const SHADOW_VERT = `
in float aLayer;
out vec2 vUv;
flat out float vLayer;
${WAVE_GLSL}
void main() {
    vUv = uv;
    vLayer = aLayer;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    wp.xyz = waveOffset(wp.xyz, aLayer, step(0.5, uv.y));
    gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SHADOW_FRAG = `
precision highp sampler2DArray;
uniform sampler2DArray uTex;
in vec2 vUv;
flat in float vLayer;
layout(location = 0) out highp vec4 outColor;
void main() {
    if (texture(uTex, vec3(vUv.x, 1.0 - vUv.y, vLayer)).a < 0.5) discard;
    outColor = vec4(1.0);
}`;

const QUAD_VERT = `
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT_FRAG = `
uniform sampler2D uSrc;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
void main() {
    vec3 c = pow(max(texture(uSrc, vUv).rgb, 0.0), vec3(2.2));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    outColor = vec4(c * smoothstep(0.9, 2.4, l), 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D uSrc;
uniform vec2 uDir;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
void main() {
    vec3 c = texture(uSrc, vUv).rgb * 0.227027;
    c += texture(uSrc, vUv + uDir * 1.3846154).rgb * 0.3162162;
    c += texture(uSrc, vUv - uDir * 1.3846154).rgb * 0.3162162;
    c += texture(uSrc, vUv + uDir * 3.2307692).rgb * 0.0702703;
    c += texture(uSrc, vUv - uDir * 3.2307692).rgb * 0.0702703;
    outColor = vec4(c, 1.0);
}`;

//Light shafts: march from each pixel toward the sun, collecting open sky
//(the depth buffer is clear there) in a halo around it
const RAYS_FRAG = `
uniform sampler2D uDepth;
uniform vec2 uSun;
uniform float uAspect;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
void main() {
    const int N = 40;
    vec2 d = (vUv - uSun) / float(N) * 0.92;
    vec2 p = vUv;
    float decay = 1.0, sum = 0.0;
    for (int i = 0; i < N; i++) {
        p -= d;
        if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {
            float sky = step(0.99999, textureLod(uDepth, p, 0.0).r);
            vec2 q = (p - uSun) * vec2(uAspect, 1.0);
            sum += sky * exp(-dot(q, q) * 16.0) * decay;
        }
        decay *= 0.955;
    }
    outColor = vec4(vec3(sum / float(N)), 1.0);
}`;

const COMPOSITE_FRAG = `
uniform sampler2D uScene;
uniform sampler2D uBloomA;
uniform sampler2D uBloomB;
uniform sampler2D uRays;
uniform vec3 uRayColor;
uniform float uExposure;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
//Extended Reinhard: no toe, so shade keeps its detail; 3.0 maps to white
vec3 tonemap(vec3 x) {
    return min(x * (1.0 + x / 9.0) / (1.0 + x), vec3(1.0));
}
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
    vec3 c = pow(max(texture(uScene, vUv).rgb, 0.0), vec3(2.2));
    c += texture(uBloomA, vUv).rgb * 0.25 + texture(uBloomB, vUv).rgb * 0.3;
    c += texture(uRays, vUv).r * uRayColor;
    c *= uExposure;
    //Half per channel, half applied to the luminance only, so bright skies
    //keep their colour instead of going white
    float lin = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 keep = min(c * (tonemap(vec3(lin)).x / max(lin, 1e-4)), vec3(1.0));
    c = mix(tonemap(c), keep, 0.5);
    c = pow(c, vec3(1.0 / 2.2));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.18);
    c = (c - 0.5) * 1.05 + 0.5;
    c += vec3(0.02, 0.008, -0.015) * smoothstep(0.4, 1.0, l) + vec3(-0.008, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.4, l));
    vec2 q = vUv - 0.5;
    c *= 1.0 - dot(q, q) * 0.55;
    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function postMaterial(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: QUAD_VERT,
        fragmentShader,
        uniforms,
        depthTest: false,
        depthWrite: false
    });
}

function hdrTarget(opts = {}) {
    return new THREE.WebGLRenderTarget(1, 1, Object.assign({ type: THREE.HalfFloatType, depthBuffer: false }, opts));
}

export class Realistic {
    constructor(r) {
        this.r = r;
        const gl = r.gl, sh = r.shared;
        //Half float targets are what the HDR passes draw into
        if (!gl.extensions.has("EXT_color_buffer_float") && !gl.extensions.has("EXT_color_buffer_half_float")) {
            throw new Error("Float render targets are not supported");
        }
        this.size = gl.capabilities.maxTextureSize >= 16384 ? 4096 : 2048;

        //Shadow map: depth only, seen from the light
        const depth = new THREE.DepthTexture(this.size, this.size);
        depth.type = THREE.FloatType;
        depth.minFilter = depth.magFilter = THREE.NearestFilter;
        this.shadowRT = new THREE.WebGLRenderTarget(this.size, this.size, { depthTexture: depth, depthBuffer: true });
        const R = SHADOW_RANGE;
        this.shadowCam = new THREE.OrthographicCamera(-R, R, R, -R, 1, 420);
        this.shadowCam.layers.set(1);
        this.shadowMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: SHADOW_VERT,
            fragmentShader: SHADOW_FRAG,
            uniforms: { uTex: sh.uTex, uTime: sh.uTime, uWind: sh.uWind, uWaveLeaf: sh.uWaveLeaf, uWavePlant: sh.uWavePlant },
            side: THREE.DoubleSide
        });
        sh.uShadowMap.value = depth;
        sh.uShadowTexel.value = 1 / this.size;

        //Main image, with depth for the light shafts
        this.sceneRT = hdrTarget({ depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1) });
        this.reflectRT = hdrTarget({ depthBuffer: true });
        this.reflectCam = new THREE.PerspectiveCamera();
        this.reflectCam.rotation.order = "YXZ";
        sh.uReflectMap.value = this.reflectRT.texture;
        this.brightRT = hdrTarget();
        this.raysRT = hdrTarget();
        this.blur = [hdrTarget(), hdrTarget(), hdrTarget(), hdrTarget()];

        this.brightMat = postMaterial(BRIGHT_FRAG, { uSrc: { value: this.sceneRT.texture } });
        this.blurMat = postMaterial(BLUR_FRAG, { uSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
        this.raysMat = postMaterial(RAYS_FRAG, {
            uDepth: { value: this.sceneRT.depthTexture },
            uSun: { value: new THREE.Vector2() },
            uAspect: { value: 1 }
        });
        this.compositeMat = postMaterial(COMPOSITE_FRAG, {
            uScene: { value: this.sceneRT.texture },
            uBloomA: { value: this.blur[1].texture },
            uBloomB: { value: this.blur[3].texture },
            uRays: { value: this.raysRT.texture },
            uRayColor: { value: new THREE.Vector3() },
            uExposure: { value: 1.3 }
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMat);
        this.quad.frustumCulled = false;
        this.postScene = new THREE.Scene();
        this.postScene.add(this.quad);
        this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.w = 0;
        this.h = 0;
        this.tmp = new THREE.Vector2();
        this.v = new THREE.Vector3();
    }

    dispose() {
        const sh = this.r.shared;
        sh.uShadowMap.value = null;
        sh.uReflectMap.value = null;
        for (const t of [this.shadowRT, this.sceneRT, this.reflectRT, this.brightRT, this.raysRT, ...this.blur]) {
            if (t.depthTexture) {
                t.depthTexture.dispose();
            }
            t.dispose();
        }
        for (const m of [this.shadowMat, this.brightMat, this.blurMat, this.raysMat, this.compositeMat]) {
            m.dispose();
        }
        this.quad.geometry.dispose();
    }

    resize() {
        const s = this.r.gl.getDrawingBufferSize(this.tmp);
        const w = Math.max(1, s.x), h = Math.max(1, s.y);
        if (w === this.w && h === this.h) {
            return;
        }
        this.w = w;
        this.h = h;
        const half = (k) => [Math.max(1, Math.round(w / k)), Math.max(1, Math.round(h / k))];
        this.sceneRT.setSize(w, h);
        this.reflectRT.setSize(...half(2));
        this.brightRT.setSize(...half(2));
        this.raysRT.setSize(...half(2));
        this.blur[0].setSize(...half(4));
        this.blur[1].setSize(...half(4));
        this.blur[2].setSize(...half(8));
        this.blur[3].setSize(...half(8));
        this.raysMat.uniforms.uAspect.value = w / h;
    }

    pass(mat, target) {
        this.quad.material = mat;
        this.r.gl.setRenderTarget(target);
        this.r.gl.render(this.postScene, this.postCam);
    }

    blurPass(src, dst, dx, dy) {
        const u = this.blurMat.uniforms;
        u.uSrc.value = src.texture;
        u.uDir.value.set(dx / dst.width, dy / dst.height);
        this.pass(this.blurMat, dst);
    }

    //Follow the camera, snapped to whole shadow texels so edges do not crawl
    renderShadows(cam) {
        const r = this.r, sh = r.shared, gl = r.gl;
        const strength = sh.uSunColor.value.lengthSq();
        sh.uShadowOn.value = strength > 1e-5 ? 1 : 0;
        if (!sh.uShadowOn.value) {
            return;
        }
        const sc = this.shadowCam, dir = sh.uLightDir.value;
        const texel = (2 * SHADOW_RANGE) / this.size;
        sc.position.copy(cam.position).addScaledVector(dir, 200);
        sc.up.set(0, 0, 1);
        if (Math.abs(dir.z) > 0.95) {
            sc.up.set(1, 0, 0);
        }
        sc.lookAt(cam.position);
        sc.updateMatrixWorld();
        //Snap: move the camera in its own plane by the sub-texel remainder
        const right = new THREE.Vector3().setFromMatrixColumn(sc.matrixWorld, 0);
        const upv = new THREE.Vector3().setFromMatrixColumn(sc.matrixWorld, 1);
        const px = sc.position.dot(right), py = sc.position.dot(upv);
        sc.position.addScaledVector(right, Math.round(px / texel) * texel - px);
        sc.position.addScaledVector(upv, Math.round(py / texel) * texel - py);
        sc.updateMatrixWorld();
        sc.updateProjectionMatrix();
        sh.uShadowMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
            .multiply(sc.projectionMatrix).multiply(sc.matrixWorldInverse);

        const scene = r.scene;
        scene.overrideMaterial = this.shadowMat;
        gl.setRenderTarget(this.shadowRT);
        gl.clear(true, true, false);
        gl.render(scene, sc);
        scene.overrideMaterial = null;
    }

    //The sea mirrored in a camera below its surface
    renderReflection(cam, underwater) {
        const r = this.r, sh = r.shared, gl = r.gl;
        const fovDown = THREE.MathUtils.degToRad(cam.fov / 2);
        const look = cam.rotation.x;
        //Nothing to mirror under water, or when the sea is out of view
        if (underwater || cam.position.y <= SEA_Y + 0.05 || look - fovDown > 0.05) {
            sh.uReflectOn.value = 0;
            return;
        }
        sh.uReflectOn.value = 1;
        const rc = this.reflectCam;
        rc.fov = cam.fov;
        rc.aspect = cam.aspect;
        rc.near = cam.near;
        rc.far = cam.far;
        rc.updateProjectionMatrix();
        rc.position.set(cam.position.x, 2 * SEA_Y - cam.position.y, cam.position.z);
        rc.rotation.set(-cam.rotation.x, cam.rotation.y, -cam.rotation.z);
        rc.updateMatrixWorld();
        sh.uReflectMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
            .multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);

        //Sky and sun travel with the camera; the water itself is not drawn
        r.sky.position.copy(rc.position);
        r.celestial.position.copy(rc.position);
        const selection = r.selection.visible;
        r.selection.visible = false;
        r.waterMat.visible = false;
        //The terrain program binds the reflection too: never while drawing into it
        sh.uReflectMap.value = null;
        sh.uClipY.value = SEA_Y - 0.05;
        sh.uCamPos.value.copy(rc.position);
        gl.setRenderTarget(this.reflectRT);
        gl.clear(true, true, false);
        gl.render(r.scene, rc);
        sh.uClipY.value = -1e9;
        sh.uReflectMap.value = this.reflectRT.texture;
        sh.uCamPos.value.copy(cam.position);
        r.waterMat.visible = true;
        r.selection.visible = selection;
        r.sky.position.copy(cam.position);
        r.celestial.position.copy(cam.position);
    }

    render(showHand, env) {
        const r = this.r, gl = r.gl, cam = r.camera, sh = r.shared;
        this.resize();
        sh.uCamPos.value.copy(cam.position);
        this.renderShadows(cam);
        this.renderReflection(cam, env.underwater || env.underlava);

        gl.setRenderTarget(this.sceneRT);
        gl.clear(true, true, false);
        gl.render(r.scene, cam);

        //Light shafts read the depth before the hand covers it
        const dir = sh.uLightDir.value;
        const p = this.v.copy(cam.position).addScaledVector(dir, 300).project(cam);
        const look = new THREE.Vector3();
        cam.getWorldDirection(look);
        const facing = THREE.MathUtils.smoothstep(look.dot(dir), 0.05, 0.45);
        const rays = facing * (env.underwater || env.underlava ? 0 : 1);
        this.raysMat.uniforms.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        const sc = sh.uSunColor.value, mx = Math.max(sc.x, sc.y, sc.z, 1e-4);
        const k = rays * Math.min(1, mx) * 1.1;
        this.compositeMat.uniforms.uRayColor.value.set(sc.x / mx * k, sc.y / mx * k, sc.z / mx * k);
        if (rays > 0) {
            this.pass(this.raysMat, this.raysRT);
        }

        if (showHand) {
            gl.setRenderTarget(this.sceneRT);
            gl.clearDepth();
            gl.render(r.handScene, r.handCamera);
        }

        //Bloom: bright parts, blurred at a quarter and an eighth of the size
        this.pass(this.brightMat, this.brightRT);
        this.blurPass(this.brightRT, this.blur[0], 1, 0);
        this.blurPass(this.blur[0], this.blur[1], 0, 1);
        this.blurPass(this.blur[1], this.blur[2], 1.5, 0);
        this.blurPass(this.blur[2], this.blur[3], 0, 1.5);

        this.pass(this.compositeMat, null);
    }
}
