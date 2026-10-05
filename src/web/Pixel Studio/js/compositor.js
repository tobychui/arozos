/*
    Pixel Studio - GPU compositor (WebGL2)

    Renders the layer tree the way the PSD format defines it: every blend mode,
    pass-through and isolated groups, clipping groups, layer and vector masks,
    fill opacity, Blend If ranges, adjustment layers (adjust.js) and layer
    styles (effects.js). Layers keep their pixels in 2D canvases (the tools
    paint there); a layer is uploaded to a texture only when its revision
    changes.

    Conventions:
      * every render target is document sized; passes address texels with
        texelFetch(ivec2(gl_FragCoord.xy)), so texel row 0 is the top image
        row in uploads, render targets and readPixels alike - only the final
        present to the screen flips
      * colours are straight (not premultiplied) alpha everywhere
      * render targets are RGBA16F when the GPU can render to half floats,
        RGBA8 otherwise

    When WebGL2 is unavailable PS.renderer falls back to a Canvas 2D
    renderer with groups, masks and the canvas blend modes only.
*/
"use strict";

PS.gpu = (function () {
    var gl = null;
    var canvas = null;
    var halfFloat = false;
    var programs = {};
    var texCache = new Map();      // source object -> {tex, rev, w, h, used}
    var pool = [];                 // free render targets
    var live = [];                 // render targets handed out (leak check)
    var frame = 0;
    var vao = null;
    var lost = false;

    /* ---------- shader sources ---------- */

    var VS = [
        "#version 300 es",
        "void main() {",
        "    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);",
        "    gl_Position = vec4(p, 0.0, 1.0);",
        "}"
    ].join("\n");

    var HEADER = [
        "#version 300 es",
        "precision highp float;",
        "precision highp int;",
        "out vec4 outColor;",
        "ivec2 px() { return ivec2(gl_FragCoord.xy); }",
        "float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }",
        "float hash12(vec2 p) {",
        "    vec3 p3 = fract(vec3(p.xyx) * 0.1031);",
        "    p3 += dot(p3, p3.yzx + 33.33);",
        "    return fract((p3.x + p3.y) * p3.z);",
        "}",
        ""
    ].join("\n");

    // blend functions on straight colours (b = backdrop, s = source)
    var BLEND_FUNCS = [
        "vec3 clipColor(vec3 c) {",
        "    float l = lum(c); float n = min(min(c.r, c.g), c.b); float x = max(max(c.r, c.g), c.b);",
        "    if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);",
        "    if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);",
        "    return c;",
        "}",
        "vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }",
        "float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }",
        "vec3 setSat(vec3 c, float s) {",
        "    float mx = max(max(c.r, c.g), c.b); float mn = min(min(c.r, c.g), c.b);",
        "    if (mx - mn < 1e-6) return vec3(0.0);",
        "    return (c - mn) * s / (mx - mn);",
        "}",
        "float burn(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }",
        "float dodge(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }",
        "float softL(float b, float s) {",
        "    return s <= 0.5 ? 2.0 * b * s + b * b * (1.0 - 2.0 * s) : 2.0 * b * (1.0 - s) + sqrt(b) * (2.0 * s - 1.0);",
        "}",
        "float hardL(float b, float s) { return s <= 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); }",
        "float vivid(float b, float s) { return s <= 0.5 ? burn(b, 2.0 * s) : dodge(b, 2.0 * (s - 0.5)); }",
        "float pinL(float b, float s) { return s <= 0.5 ? min(b, 2.0 * s) : max(b, 2.0 * s - 1.0); }",
        "float divideF(float b, float s) { if (s <= 0.0) return b <= 0.0 ? 0.0 : 1.0; return min(1.0, b / s); }",
        // mode indices follow PS.blendModeIndex (0 pass through = normal)
        "vec3 blendRGB(int m, vec3 b, vec3 s) {",
        "    if (m <= 2) return s;",
        "    if (m == 3) return min(b, s);",
        "    if (m == 4) return b * s;",
        "    if (m == 5) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));",
        "    if (m == 6) return max(b + s - 1.0, 0.0);",
        "    if (m == 7) return (s.r + s.g + s.b < b.r + b.g + b.b) ? s : b;",
        "    if (m == 8) return max(b, s);",
        "    if (m == 9) return b + s - b * s;",
        "    if (m == 10) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));",
        "    if (m == 11) return min(b + s, 1.0);",
        "    if (m == 12) return (s.r + s.g + s.b > b.r + b.g + b.b) ? s : b;",
        "    if (m == 13) return vec3(hardL(s.r, b.r), hardL(s.g, b.g), hardL(s.b, b.b));",
        "    if (m == 14) return vec3(softL(b.r, s.r), softL(b.g, s.g), softL(b.b, s.b));",
        "    if (m == 15) return vec3(hardL(b.r, s.r), hardL(b.g, s.g), hardL(b.b, s.b));",
        "    if (m == 16) return vec3(vivid(b.r, s.r), vivid(b.g, s.g), vivid(b.b, s.b));",
        "    if (m == 17) return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);",
        "    if (m == 18) return vec3(pinL(b.r, s.r), pinL(b.g, s.g), pinL(b.b, s.b));",
        "    if (m == 19) return step(1.0, b + s);",
        "    if (m == 20) return abs(b - s);",
        "    if (m == 21) return b + s - 2.0 * b * s;",
        "    if (m == 22) return max(b - s, 0.0);",
        "    if (m == 23) return vec3(divideF(b.r, s.r), divideF(b.g, s.g), divideF(b.b, s.b));",
        "    if (m == 24) return setLum(setSat(s, sat(b)), lum(b));",
        "    if (m == 25) return setLum(setSat(b, sat(s)), lum(b));",
        "    if (m == 26) return setLum(s, lum(b));",
        "    if (m == 27) return setLum(b, lum(s));",
        "    return s;",
        "}",
        // W3C source-over with blending, straight alpha in and out
        "vec4 compose(int m, vec4 dst, vec3 src, float sa) {",
        "    float da = dst.a;",
        "    float oa = sa + da * (1.0 - sa);",
        "    if (oa <= 0.0) return vec4(0.0);",
        "    vec3 bl = clamp(blendRGB(m, dst.rgb, src), 0.0, 1.0);",
        "    vec3 c = (1.0 - da) * sa * src + sa * da * bl + (1.0 - sa) * da * dst.rgb;",
        "    return vec4(c / oa, oa);",
        "}",
        ""
    ].join("\n");

    // mask helpers: user masks are grayscale canvases (luminance = value,
    // erased = revealing), vector masks are rasterised with coverage in alpha
    // uMaskOff shifts the masks during a move preview (texels uncovered by
    // the shift take the mask's default value)
    var MASK_FUNCS = [
        "uniform sampler2D uMask; uniform int uHasMask; uniform float uMaskDensity; uniform float uMaskDefault;",
        "uniform sampler2D uVMask; uniform int uHasVMask; uniform float uVMaskDensity;",
        "uniform ivec2 uMaskOff;",
        "bool inside(sampler2D t, ivec2 q) { ivec2 s = textureSize(t, 0); return q.x >= 0 && q.y >= 0 && q.x < s.x && q.y < s.y; }",
        "float maskAt(ivec2 p) {",
        "    float m = 1.0;",
        "    ivec2 q = p - uMaskOff;",
        "    if (uHasMask == 1) {",
        "        float v = uMaskDefault;",
        "        if (inside(uMask, q)) { vec4 t = texelFetch(uMask, q, 0); v = mix(1.0, t.r, t.a); }",
        "        m *= 1.0 - uMaskDensity * (1.0 - v);",
        "    }",
        "    if (uHasVMask == 1) {",
        "        float v = inside(uVMask, q) ? texelFetch(uVMask, q, 0).a : 0.0;",
        "        m *= 1.0 - uVMaskDensity * (1.0 - v);",
        "    }",
        "    return m;",
        "}",
        ""
    ].join("\n");

    var FS_BLEND = HEADER + BLEND_FUNCS + MASK_FUNCS + [
        "uniform sampler2D uDst;",
        "uniform sampler2D uSrc;",
        "uniform ivec2 uSrcOff;",
        "uniform int uMode;",
        "uniform float uOpacity;",
        "uniform int uDissolve;",
        // fill opacity of the eight special modes (1.0 for all others):
        // it fades the layer's colour towards the mode's neutral colour
        // instead of its coverage (Hard Mix softens its threshold)
        "uniform float uFill;",
        "vec3 fillBlend(int m, vec3 b, vec3 s, float f) {",
        "    if (m == 19) {",
        "        float k = max(1.0 - f, 1e-4);",
        "        return clamp((b - (1.0 - s) * f) / k, 0.0, 1.0);",
        "    }",
        "    vec3 sf = s;",
        "    if (m == 5 || m == 6) sf = 1.0 - (1.0 - s) * f;",
        "    else if (m == 16 || m == 17) sf = 0.5 + (s - 0.5) * f;",
        "    else sf = s * f;",
        "    return clamp(blendRGB(m, b, sf), 0.0, 1.0);",
        "}",
        // optional clip alpha (clipping groups whose base carries effects)
        "uniform sampler2D uClip; uniform int uHasClip;",
        // Blend If: [gray, r, g, b] ranges, each (blackLo, blackHi, whiteLo, whiteHi) in 0..1
        "uniform int uBlendIf;",
        "uniform vec4 uBifSrc[4]; uniform vec4 uBifDst[4];",
        "float bifWeight(float v, vec4 r) {",
        "    float w = 1.0;",
        "    if (v < r.x) w = 0.0; else if (v < r.y) w = (v - r.x) / max(r.y - r.x, 1e-6);",
        "    if (v > r.w) w = 0.0; else if (v > r.z) w = min(w, 1.0 - (v - r.z) / max(r.w - r.z, 1e-6));",
        "    return w;",
        "}",
        "void main() {",
        "    ivec2 p = px();",
        "    vec4 dst = texelFetch(uDst, p, 0);",
        "    ivec2 sq = p - uSrcOff;",
        "    vec4 src = inside(uSrc, sq) ? texelFetch(uSrc, sq, 0) : vec4(0.0);",
        "    float sa = src.a * uOpacity * maskAt(p);",
        "    if (uHasClip == 1) sa *= texelFetch(uClip, p, 0).a;",
        "    if (uBlendIf == 1) {",
        "        vec4 sv = vec4(lum(src.rgb), src.rgb); vec4 dv = vec4(lum(dst.rgb), dst.rgb);",
        "        for (int i = 0; i < 4; i++) {",
        "            sa *= bifWeight(sv[i], uBifSrc[i]);",
        "            if (dst.a > 0.0) sa *= bifWeight(dv[i], uBifDst[i]);",
        "        }",
        "    }",
        "    if (uDissolve == 1) sa = (hash12(vec2(p)) < sa) ? 1.0 : 0.0;",
        "    sa = clamp(sa, 0.0, 1.0);",
        "    if (uFill < 1.0) {",
        "        // over empty pixels the fill acts as opacity; over pixels the blend fades",
        "        float da = dst.a;",
        "        float se = sa * uFill;",
        "        float oa = da + (1.0 - da) * se;",
        "        if (oa <= 0.0) { outColor = vec4(0.0); return; }",
        "        vec3 bl = fillBlend(uMode, dst.rgb, src.rgb, uFill);",
        "        vec3 c = (1.0 - da) * se * src.rgb + da * (sa * bl + (1.0 - sa) * dst.rgb);",
        "        outColor = vec4(c / oa, oa);",
        "        return;",
        "    }",
        "    outColor = compose(uMode, dst, src.rgb, sa);",
        "}"
    ].join("\n");

    // out = mix(a, b, t * mask): opacity / mask of pass-through groups and of
    // layers rendered with styles
    var FS_MIX = HEADER + MASK_FUNCS + [
        "uniform sampler2D uA; uniform sampler2D uB; uniform float uT;",
        "void main() {",
        "    ivec2 p = px();",
        "    vec4 a = texelFetch(uA, p, 0); vec4 b = texelFetch(uB, p, 0);",
        "    float t = clamp(uT * maskAt(p), 0.0, 1.0);",
        // interpolate premultiplied so transparent pixels carry no colour
        "    vec4 pa = vec4(a.rgb * a.a, a.a); vec4 pb = vec4(b.rgb * b.a, b.a);",
        "    vec4 r = mix(pa, pb, t);",
        "    outColor = r.a > 0.0 ? vec4(r.rgb / r.a, r.a) : vec4(0.0);",
        "}"
    ].join("\n");

    // texture copy; uFlip mirrors rows for the on-screen present
    // uChannel (1..3) shows one colour channel as gray (Channels panel)
    var FS_COPY = HEADER + [
        "uniform sampler2D uSrc; uniform int uFlip; uniform int uHeight; uniform int uChannel;",
        "void main() {",
        "    ivec2 p = px();",
        "    if (uFlip == 1) p.y = uHeight - 1 - p.y;",
        "    vec4 c = texelFetch(uSrc, p, 0);",
        "    if (uChannel > 0) { float v = c[uChannel - 1]; c = vec4(v, v, v, c.a); }",
        "    outColor = c;",
        "}"
    ].join("\n");

    // source pixels clipped by a clip-base alpha (clipping group isolation)
    var FS_CLEAR = HEADER + [
        "uniform vec4 uColor;",
        "void main() { outColor = uColor; }"
    ].join("\n");

    /* ---------- program management ---------- */

    function compile(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            var log = gl.getShaderInfoLog(sh);
            var lines = src.split("\n").map(function (l, i) { return (i + 1) + ": " + l; }).join("\n");
            throw new Error("Shader compile failed: " + log + "\n" + lines);
        }
        return sh;
    }

    // Program with reflected uniforms: {prog, uniforms: name -> {loc, type, size}}
    function makeProgram(name, fsSource) {
        var prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            throw new Error("Program link failed (" + name + "): " + gl.getProgramInfoLog(prog));
        }
        var uniforms = {};
        var n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) {
            var info = gl.getActiveUniform(prog, i);
            var uname = info.name.replace(/\[0\]$/, "");
            uniforms[uname] = { loc: gl.getUniformLocation(prog, info.name), type: info.type, size: info.size };
        }
        programs[name] = { prog: prog, uniforms: uniforms };
        return programs[name];
    }

    function program(name) {
        if (!programs[name]) { throw new Error("Unknown GPU program: " + name); }
        return programs[name];
    }

    // Register an extra fragment program (used by adjust.js / effects.js).
    // fsBody is appended to the shared header (+ blend / mask helpers on request).
    function defineProgram(name, fsBody, opts) {
        opts = opts || {};
        var src = HEADER + (opts.blend ? BLEND_FUNCS : "") + (opts.mask ? MASK_FUNCS : "") + fsBody;
        if (gl) { makeProgram(name, src); }
        defineProgram.pending[name] = src;
    }
    defineProgram.pending = {};

    function setUniform(u, value) {
        var t = u.type;
        if (t === gl.FLOAT) {
            if (u.size > 1) { gl.uniform1fv(u.loc, value); } else { gl.uniform1f(u.loc, value); }
        } else if (t === gl.INT || t === gl.BOOL) {
            gl.uniform1i(u.loc, value === true ? 1 : (value === false ? 0 : value));
        } else if (t === gl.FLOAT_VEC2) {
            gl.uniform2fv(u.loc, value);
        } else if (t === gl.FLOAT_VEC3) {
            gl.uniform3fv(u.loc, value);
        } else if (t === gl.FLOAT_VEC4) {
            gl.uniform4fv(u.loc, value);
        } else if (t === gl.FLOAT_MAT3) {
            gl.uniformMatrix3fv(u.loc, false, value);
        } else if (t === gl.FLOAT_MAT4) {
            gl.uniformMatrix4fv(u.loc, false, value);
        } else if (t === gl.INT_VEC2) {
            gl.uniform2iv(u.loc, value);
        }
    }

    function isSampler(t) {
        return t === gl.SAMPLER_2D || t === gl.SAMPLER_3D;
    }

    // Run one full-target pass. uniforms: name -> value; samplers take a
    // texture (or a render target object with .tex). target null = screen.
    function pass(name, target, uniforms) {
        var p = program(name);
        gl.useProgram(p.prog);
        if (target) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
            gl.viewport(0, 0, target.w, target.h);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, canvas.width, canvas.height);
        }
        var unit = 0;
        var names = Object.keys(p.uniforms);
        for (var i = 0; i < names.length; i++) {
            var n = names[i];
            var u = p.uniforms[n];
            if (isSampler(u.type)) {
                var v = uniforms[n];
                var tex = v ? (v.tex || v) : dummyTex(u.type);
                gl.activeTexture(gl.TEXTURE0 + unit);
                if (u.type === gl.SAMPLER_3D) {
                    gl.bindTexture(gl.TEXTURE_2D, null);
                    gl.bindTexture(gl.TEXTURE_3D, tex);
                } else {
                    gl.bindTexture(gl.TEXTURE_3D, null);
                    gl.bindTexture(gl.TEXTURE_2D, tex);
                }
                gl.uniform1i(u.loc, unit);
                unit++;
            } else if (uniforms[n] !== undefined) {
                setUniform(u, uniforms[n]);
            } else if (u.type === gl.INT || u.type === gl.BOOL) {
                gl.uniform1i(u.loc, 0);     // flags default off
            } else if (u.type === gl.INT_VEC2) {
                gl.uniform2i(u.loc, 0, 0);  // offsets default to none
            }
        }
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var dummy2D = null, dummy3D = null;
    function dummyTex(type) {
        if (type === gl.SAMPLER_3D) {
            if (!dummy3D) {
                dummy3D = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_3D, dummy3D);
                gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                    new Uint8Array([0, 0, 0, 0]));
            }
            return dummy3D;
        }
        if (!dummy2D) {
            dummy2D = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, dummy2D);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 0]));
        }
        return dummy2D;
    }

    /* ---------- textures ---------- */

    function newTexture(filter) {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        var f = filter || gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    }

    // Texture holding an image source (canvas / ImageBitmap), re-uploaded
    // only when rev changes. key identifies the cache slot.
    // opts.filtered: bilinear filtering on premultiplied texels (resampling
    // passes such as perspective transforms); default is exact texel fetches
    // of straight colour
    function sourceTexture(key, source, rev, opts) {
        var filtered = !!(opts && opts.filtered);
        var e = texCache.get(key);
        if (!e) {
            // opts.nearest: premultiplied like a filtered texture but sampled
            // without interpolation (nearest-neighbour resampling)
            e = { tex: newTexture(filtered && !(opts && opts.nearest) ? gl.LINEAR : gl.NEAREST), rev: null, w: 0, h: 0, used: 0 };
            texCache.set(key, e);
        }
        if (e.rev !== rev || e.w !== source.width || e.h !== source.height) {
            gl.bindTexture(gl.TEXTURE_2D, e.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, filtered);
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
            e.rev = rev;
            e.w = source.width;
            e.h = source.height;
        }
        e.used = frame;
        return e.tex;
    }

    // Small data textures (LUTs, gradients): Uint8Array RGBA, w x h
    function dataTexture(key, w, h, data, rev, linear) {
        var e = texCache.get(key);
        if (!e) {
            e = { tex: newTexture(linear ? gl.LINEAR : gl.NEAREST), rev: null, w: 0, h: 0, used: 0 };
            texCache.set(key, e);
        }
        if (e.rev !== rev) {
            gl.bindTexture(gl.TEXTURE_2D, e.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
            e.rev = rev;
            e.w = w;
            e.h = h;
        }
        e.used = frame;
        return e.tex;
    }

    // 3D lookup texture (colour lookup adjustments), size^3 RGBA8
    function texture3D(key, size, data, rev) {
        var e = texCache.get(key);
        if (!e) {
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_3D, tex);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            e = { tex: tex, rev: null, is3D: true, used: 0 };
            texCache.set(key, e);
        }
        if (e.rev !== rev) {
            gl.bindTexture(gl.TEXTURE_3D, e.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
            e.rev = rev;
        }
        e.used = frame;
        return e.tex;
    }

    // Free textures nothing used in the last few renders (deleted / hidden
    // layers, finished previews)
    function evictTextures() {
        texCache.forEach(function (e, key) {
            if (e.used < frame - 2) {
                gl.deleteTexture(e.tex);
                texCache.delete(key);
            }
        });
    }

    /* ---------- render targets ---------- */

    function acquire(w, h, opts) {
        opts = opts || {};
        var fmt = opts.format || (halfFloat ? "rgba16f" : "rgba8");
        for (var i = 0; i < pool.length; i++) {
            var t = pool[i];
            if (t.w === w && t.h === h && t.fmt === fmt) {
                pool.splice(i, 1);
                live.push(t);
                return t;
            }
        }
        var tex = newTexture(opts.linear ? gl.LINEAR : gl.NEAREST);
        if (fmt === "rgba16f") {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        } else if (fmt === "r8") {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, null);
        } else if (fmt === "rg16f") {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.HALF_FLOAT, null);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        }
        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        var t2 = { tex: tex, fbo: fbo, w: w, h: h, fmt: fmt, linear: !!opts.linear };
        live.push(t2);
        return t2;
    }

    function release(t) {
        if (!t) { return; }
        var i = live.indexOf(t);
        if (i >= 0) { live.splice(i, 1); }
        if (pool.indexOf(t) < 0) { pool.push(t); }
    }

    // Keep the pool from growing without bound after a big document closes
    function trimPool(keepW, keepH) {
        for (var i = pool.length - 1; i >= 0; i--) {
            var t = pool[i];
            if (t.w !== keepW || t.h !== keepH || pool.length > 12) {
                gl.deleteTexture(t.tex);
                gl.deleteFramebuffer(t.fbo);
                pool.splice(i, 1);
            }
        }
    }

    function clear(target, rgba) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.viewport(0, 0, target.w, target.h);
        var c = rgba || [0, 0, 0, 0];
        gl.clearColor(c[0], c[1], c[2], c[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    function copy(src, dst) {
        pass("copy", dst, { uSrc: src, uFlip: 0, uHeight: dst.h });
    }

    /* ---------- init ---------- */

    function init(canvasEl) {
        canvas = canvasEl;
        try {
            gl = canvas.getContext("webgl2", {
                alpha: true,
                premultipliedAlpha: false,
                preserveDrawingBuffer: true,
                antialias: false,
                depth: false,
                stencil: false
            });
        } catch (e) { gl = null; }
        if (!gl) { return false; }
        try {
            halfFloat = !!gl.getExtension("EXT_color_buffer_float") ||
                !!gl.getExtension("EXT_color_buffer_half_float");
            vao = gl.createVertexArray();
            makeProgram("blend", FS_BLEND);
            makeProgram("mix", FS_MIX);
            makeProgram("copy", FS_COPY);
            makeProgram("clear", FS_CLEAR);
            Object.keys(defineProgram.pending).forEach(function (n) {
                makeProgram(n, defineProgram.pending[n]);
            });
        } catch (e) {
            console.error(e);
            gl = null;
            return false;
        }
        canvas.addEventListener("webglcontextlost", function (e) {
            e.preventDefault();
            lost = true;
        });
        canvas.addEventListener("webglcontextrestored", function () {
            lost = false;
            texCache.clear();
            pool = [];
            live = [];
            programs = {};
            dummy2D = dummy3D = null;
            init(canvas);
            PS.requestRender();
        });
        return true;
    }

    function maxSize() {
        return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 8192;
    }

    function readTarget(target, x, y, w, h) {
        x = x || 0; y = y || 0;
        w = w || target.w; h = h || target.h;
        // half float targets are converted to bytes through an RGBA8 copy
        var src = target;
        var tmp = null;
        if (target.fmt !== "rgba8") {
            tmp = acquire(target.w, target.h, { format: "rgba8" });
            copy(target, tmp);
            src = tmp;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
        var buf = new Uint8ClampedArray(w * h * 4);
        gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        if (tmp) { release(tmp); }
        return new ImageData(buf, w, h);
    }

    return {
        init: init,
        get gl() { return gl; },
        get halfFloat() { return halfFloat; },
        get lost() { return lost; },
        get canvas() { return canvas; },
        frame: function () { return frame; },
        nextFrame: function () { frame++; },
        defineProgram: defineProgram,
        pass: pass,
        acquire: acquire,
        release: release,
        trimPool: trimPool,
        clear: clear,
        copy: copy,
        sourceTexture: sourceTexture,
        dataTexture: dataTexture,
        texture3D: texture3D,
        evictTextures: evictTextures,
        readTarget: readTarget,
        maxSize: maxSize,
        liveCount: function () { return live.length; }
    };
})();

/* ============================================================
   LAYER TREE RENDERER
   ============================================================ */

PS.renderer = (function () {
    var G = PS.gpu;
    var useGL = false;
    var displayCanvas = null;
    var previewSerial = 0;

    function init(canvasEl) {
        displayCanvas = canvasEl;
        useGL = G.init(canvasEl);
        if (!useGL) {
            PS.toast("WebGL2 is not available - layer styles and adjustment layers will not render", true);
        }
        return useGL;
    }

    /* ---- per-layer sources (committed pixels or live previews) ---- */

    function layerSource(layer, opts) {
        if (!opts.skipPreviews) {
            var tp = PS.layerPreviews && PS.layerPreviews.get(layer);
            if (tp) { return { canvas: tp.canvas, rev: "tp" + tp.rev }; }
            if (PS.layerOverride && PS.layerOverride.layer === layer) {
                return { canvas: PS.layerOverride.canvas, rev: "ov" + (++previewSerial) };
            }
            if (PS.strokePreview && PS.strokePreview.layer === layer) {
                return { canvas: PS._bakeStrokePreview(layer), rev: "sp" + (++previewSerial) };
            }
        }
        return { canvas: layer.canvas, rev: layer.rev };
    }

    function maskSource(layer, opts) {
        var mt = layer._maskTarget;
        if (!opts.skipPreviews) {
            var mp = PS.maskPreviews && PS.maskPreviews.get(layer);
            if (mp) { return { canvas: mp.canvas, rev: "mp" + mp.rev }; }
        }
        if (!opts.skipPreviews && mt) {
            if (PS.layerOverride && PS.layerOverride.layer === mt) {
                return { canvas: PS.layerOverride.canvas, rev: "mov" + (++previewSerial) };
            }
            if (PS.strokePreview && PS.strokePreview.layer === mt) {
                return { canvas: PS._bakeStrokePreview(mt), rev: "msp" + (++previewSerial) };
            }
        }
        return { canvas: layer.mask.canvas, rev: layer.mask.rev };
    }

    // Uniforms describing a layer's masks for the blend / mix programs
    function maskUniforms(layer, opts) {
        var u = { uHasMask: 0, uHasVMask: 0, uMaskDensity: 1, uVMaskDensity: 1, uMaskDefault: 1 };
        var off = opts.skipPreviews ? null : PS.moveOffsetOf(layer);
        if (off && off.maskToo) { u.uMaskOff = [off.dx, off.dy]; }
        if (layer.mask && layer.mask.enabled !== false) {
            var ms = maskSource(layer, opts);
            var mtex = (PS.gpuMaskTexture && layer.mask.feather > 0)
                ? PS.gpuMaskTexture(layer, ms)
                : G.sourceTexture(ms.canvas, ms.canvas, ms.rev);
            u.uMask = mtex;
            u.uHasMask = 1;
            u.uMaskDefault = (layer.mask.defaultColor === undefined ? 255 : layer.mask.defaultColor) / 255;
            u.uMaskDensity = layer.mask.density === undefined ? 1 : layer.mask.density;
        }
        if (layer.vmask && layer.vmask.enabled !== false && layer.kind !== "shape" && PS.vectorMaskCanvas) {
            var vp = !opts.skipPreviews && PS.vmaskPreviews && PS.vmaskPreviews.get(layer);
            var vc = vp ? vp.canvas : PS.vectorMaskCanvas(layer);
            if (vc) {
                u.uVMask = G.sourceTexture(vc, vc, vp ? "vp" + vp.rev : layer.vmask._rasterKey);
                u.uHasVMask = 1;
                u.uVMaskDensity = layer.vmask.density === undefined ? 1 : layer.vmask.density;
            }
        }
        return u;
    }

    function blendIfUniforms(layer) {
        var bi = layer.blendIf;
        if (!bi || !bi.compositeGrayBlendSource) { return { uBlendIf: 0 }; }
        var src = [], dst = [];
        var isDefault = true;
        function push(arr, r) {
            var v = (r && r.length === 4) ? r : [0, 0, 255, 255];
            if (v[0] !== 0 || v[1] !== 0 || v[2] !== 255 || v[3] !== 255) { isDefault = false; }
            arr.push(v[0] / 255, v[1] / 255, v[2] / 255, v[3] / 255);
        }
        push(src, bi.compositeGrayBlendSource);
        push(dst, bi.compositeGraphBlendDestinationRange);
        for (var i = 1; i <= 3; i++) {
            var r = bi.ranges && bi.ranges[i];
            push(src, r && r.sourceRange);
            push(dst, r && r.destRange);
        }
        if (isDefault) { return { uBlendIf: 0 }; }
        return { uBlendIf: 1, uBifSrc: src, uBifDst: dst };
    }

    function modeIndex(blend) {
        var m = PS.blendModeIndex[blend];
        return m === undefined ? 1 : m;
    }

    /* ---- compositing ---- */

    // the "special eight": fill opacity changes the blend itself
    var SPECIAL_FILL = {
        "color burn": 1, "linear burn": 1, "color dodge": 1, "linear dodge": 1,
        "vivid light": 1, "linear light": 1, "hard mix": 1, "difference": 1
    };

    // Blend a source texture onto cur. Returns the new current target (the
    // old one is released). extra: additional blend uniforms. fill: the
    // layer's fill opacity (applied as part of the opacity unless the mode
    // is one of the special eight)
    function blendOnto(cur, srcTex, layer, opacity, opts, extra, fill) {
        var d = PS.doc;
        var out = G.acquire(d.width, d.height);
        var u = maskUniforms(layer, opts);
        var bif = blendIfUniforms(layer);
        Object.keys(bif).forEach(function (k) { u[k] = bif[k]; });
        u.uDst = cur;
        u.uSrc = srcTex;
        var off = (opts.skipPreviews || !layer.id) ? null : PS.moveOffsetOf(layer);
        if (off && layer.kind !== "group" && layer.kind !== "fill") { u.uSrcOff = [off.dx, off.dy]; }
        u.uMode = modeIndex(layer.blend);
        var f = typeof fill === "number" ? PS.clamp(fill, 0, 1) : 1;
        var special = f < 1 && SPECIAL_FILL[layer.blend];
        u.uOpacity = special ? opacity : opacity * f;
        u.uFill = special ? f : 1;
        u.uDissolve = layer.blend === "dissolve" ? 1 : 0;
        if (extra) { Object.keys(extra).forEach(function (k) { u[k] = extra[k]; }); }
        G.pass("blend", out, u);
        G.release(cur);
        return out;
    }

    function hasLiveEffects(layer) {
        return !!(PS.gpuEffects && layer.effects && !layer.effects.disabled &&
            PS.gpuEffects.anyEnabled(layer.effects));
    }

    // Composite one layer (any kind) onto cur, returning the new target
    function applyLayer(layer, cur, opts, clipInfo) {
        var d = PS.doc;
        if (layer.kind === "adjustment") {
            if (PS.gpuAdjust) { return PS.gpuAdjust.apply(layer, cur, opts, clipInfo); }
            return cur;
        }

        if (layer.kind === "group") {
            var isolated = layer.blend !== "pass through" || hasLiveEffects(layer);
            if (!isolated) {
                var inner = compositeList(layer.children, cur, opts);
                var mu = maskUniforms(layer, opts);
                var needsMix = layer.opacity < 1 || mu.uHasMask || mu.uHasVMask;
                if (!needsMix) { G.release(cur); return inner; }
                var mixed = G.acquire(d.width, d.height);
                mu.uA = cur; mu.uB = inner; mu.uT = layer.opacity;
                G.pass("mix", mixed, mu);
                G.release(cur);
                G.release(inner);
                return mixed;
            }
            var content = compositeList(layer.children, null, opts);
            var res = applyContent(layer, content, cur, opts, clipInfo);
            G.release(content);
            return res;
        }

        // pixel layers
        if (!layer.canvas) { return cur; }
        var src = layerSource(layer, opts);
        var tex = G.sourceTexture(layer.canvas, src.canvas, src.rev);
        return applyContent(layer, tex, cur, opts, clipInfo);
    }

    // Blend a layer's content texture onto cur with styles, masks and opacity
    function applyContent(layer, tex, cur, opts, clipInfo) {
        var extra = clipInfo ? { uClip: clipInfo.tex, uHasClip: 1 } : null;
        if (hasLiveEffects(layer)) {
            return PS.gpuEffects.apply(layer, tex, cur, opts, {
                maskUniforms: maskUniforms(layer, opts),
                blendIf: blendIfUniforms(layer),
                modeIndex: modeIndex,
                blendOnto: blendOnto,
                clip: extra
            });
        }
        return blendOnto(cur, tex, layer, layer.opacity, opts, extra, layer.fillOpacity);
    }

    function visibleForRender(layer, opts) {
        if (opts.only && opts.only.indexOf(layer) < 0 && !opts.onlyAncestorOk) { return false; }
        return layer.visible;
    }

    // Composite a list of sibling layers (bottom first) over base (a target,
    // or null for transparent). Returns a new target the caller releases.
    function compositeList(list, base, opts) {
        var d = PS.doc;
        var cur = G.acquire(d.width, d.height);
        if (base) { G.copy(base, cur); } else { G.clear(cur); }

        var i = 0;
        while (i < list.length) {
            var layer = list[i];
            // gather the clipping group above this base
            var j = i + 1;
            while (j < list.length && list[j].clipping) { j++; }
            var clipped = list.slice(i + 1, j);

            if (layer.clipping) {
                // a clipped layer with no base below it renders as a normal layer
                if (layer.visible) { cur = applyLayer(layer, cur, opts, null); }
                i++;
                continue;
            }

            if (!layer.visible) { i = j; continue; }   // hidden base hides its clipped layers

            var visClipped = clipped.filter(function (l) { return l.visible; });
            if (!visClipped.length || layer.kind === "group" || layer.kind === "adjustment") {
                cur = applyLayer(layer, cur, opts, null);
                // clipped layers over a group / adjustment base: clip to the
                // base's own coverage (the whole canvas for adjustments)
                if (visClipped.length) {
                    for (var k = 0; k < visClipped.length; k++) {
                        cur = applyLayer(visClipped[k], cur, opts, null);
                    }
                }
                i = j;
                continue;
            }

            cur = applyClipGroup(layer, visClipped, cur, opts);
            i = j;
        }
        return cur;
    }

    // Base layer + layers clipped to it. Without layer styles on the base the
    // group is isolated ("Blend Clipped Layers as Group", the
    // default): base and clipped layers are composited on transparency, the
    // clipped layers limited to the base's alpha, and the result is blended
    // onto the backdrop with the base's mode and opacity. A styled base is
    // drawn normally and the clipped layers are blended onto the result,
    // limited to the base's coverage.
    function applyClipGroup(base, clipped, cur, opts) {
        var d = PS.doc;
        var baseSrc = layerSource(base, opts);
        var baseTex = G.sourceTexture(base.canvas, baseSrc.canvas, baseSrc.rev);

        // the base's coverage after its masks: its alpha, as a texture
        var cover = G.acquire(d.width, d.height);
        G.clear(cover);
        var mu = maskUniforms(base, opts);
        mu.uDst = cover; mu.uSrc = baseTex; mu.uMode = 1; mu.uOpacity = 1; mu.uDissolve = 0; mu.uFill = 1;
        var boff = opts.skipPreviews ? null : PS.moveOffsetOf(base);
        if (boff) { mu.uSrcOff = [boff.dx, boff.dy]; }
        var tmp = G.acquire(d.width, d.height);
        G.pass("blend", tmp, mu);
        G.release(cover);
        cover = tmp;

        if (hasLiveEffects(base)) {
            cur = applyLayer(base, cur, opts, null);
            for (var k = 0; k < clipped.length; k++) {
                cur = applyLayer(clipped[k], cur, opts, { tex: cover });
            }
            G.release(cover);
            return cur;
        }

        // isolated clipping group: base (fill opacity only) then clipped layers
        var grp = G.acquire(d.width, d.height);
        G.clear(grp);
        var fakeBase = { blend: "normal", mask: null, vmask: null, blendIf: null };
        grp = blendOnto(grp, cover, fakeBase, 1, opts, null, base.fillOpacity);
        for (var c = 0; c < clipped.length; c++) {
            grp = applyLayer(clipped[c], grp, opts, { tex: cover });
        }
        // clipped content never extends past the base
        var bounded = G.acquire(d.width, d.height);
        G.pass("clipAlpha", bounded, { uSrc: grp, uClip: cover });
        G.release(grp);
        G.release(cover);
        var out = blendOnto(cur, bounded,
            { blend: base.blend, mask: null, vmask: null, blendIf: base.blendIf },
            base.opacity, opts, null);
        G.release(bounded);
        return out;
    }

    /* ---- public entry points ---- */

    // Render the document into a render target (caller releases)
    function renderTarget(opts) {
        opts = opts || {};
        var d = PS.doc;
        var result = compositeList(opts.nodes || d.root.children, null, opts);
        return result;
    }

    function renderDoc() {
        if (!PS.doc) { return; }
        var d = PS.doc;
        if (!useGL) { render2D(displayCanvas, false); return; }
        if (G.lost) { return; }
        G.nextFrame();
        if (displayCanvas.width !== d.width || displayCanvas.height !== d.height) {
            displayCanvas.width = d.width;
            displayCanvas.height = d.height;
        }
        if (PS.viewMaskOf && PS.viewMaskOf.mask && PS.locateLayer(PS.viewMaskOf)) {
            // Alt+click on a mask thumbnail: show the mask itself
            var ms = maskSource(PS.viewMaskOf, {});
            G.pass("copy", null, { uSrc: G.sourceTexture(ms.canvas, ms.canvas, ms.rev), uFlip: 1, uHeight: d.height });
        } else {
            var t = renderTarget({ skipPreviews: false });
            G.pass("copy", null, { uSrc: t, uFlip: 1, uHeight: d.height, uChannel: { r: 1, g: 2, b: 3 }[PS.viewChannel] || 0 });
            G.release(t);
        }
        G.evictTextures();
        if (PS.gpuEffects) { PS.gpuEffects.evict(); }
        G.trimPool(d.width, d.height);
    }

    // Committed composite (no previews) as a 2D canvas
    function compositeCanvas(nodes) {
        var d = PS.doc;
        var c = PS.createCanvas(d.width, d.height);
        if (!useGL || G.lost) {
            render2D(c, true, nodes);
            return c;
        }
        G.nextFrame();
        var t = renderTarget({ skipPreviews: true, nodes: nodes });
        var img = G.readTarget(t);
        G.release(t);
        c.getContext("2d").putImageData(img, 0, 0);
        return c;
    }

    // ImageBitmap of the committed composite for the save worker. The
    // committed frame is drawn into the display canvas, captured (a GPU copy)
    // and the live frame redrawn in the same task, so nothing flickers and
    // no pixels are read back on the main thread.
    function snapshotComposite() {
        var d = PS.doc;
        if (!useGL || G.lost) { return createImageBitmap(compositeCanvas()); }
        G.nextFrame();
        if (displayCanvas.width !== d.width || displayCanvas.height !== d.height) {
            displayCanvas.width = d.width;
            displayCanvas.height = d.height;
        }
        var t = renderTarget({ skipPreviews: true });
        G.pass("copy", null, { uSrc: t, uFlip: 1, uHeight: d.height });
        G.release(t);
        var p = createImageBitmap(displayCanvas);
        renderDoc();
        return p;
    }

    /* ---- Canvas 2D fallback (no WebGL2) ---- */

    var maskAlphaCache = new WeakMap();

    function maskAlphaCanvas(layer) {
        var m = layer.mask;
        var e = maskAlphaCache.get(m);
        if (e && e.rev === m.rev) { return e.canvas; }
        var w = m.canvas.width, h = m.canvas.height;
        var src = m.canvas.getContext("2d").getImageData(0, 0, w, h);
        var out = new ImageData(w, h);
        for (var i = 0; i < src.data.length; i += 4) {
            var v = src.data[i] * src.data[i + 3] / 255 + (255 - src.data[i + 3]);
            out.data[i + 3] = v;
        }
        var c = PS.createCanvas(w, h);
        c.getContext("2d").putImageData(out, 0, 0);
        maskAlphaCache.set(m, { rev: m.rev, canvas: c });
        return c;
    }

    function draw2DList(ctx, list, opts) {
        var d = PS.doc;
        list.forEach(function (layer) {
            if (!layer.visible || layer.kind === "adjustment") { return; }
            var src;
            if (layer.kind === "group") {
                src = PS.createCanvas(d.width, d.height);
                draw2DList(src.getContext("2d"), layer.children, opts);
            } else {
                src = layerSource(layer, opts).canvas;
            }
            if (layer.mask && layer.mask.enabled !== false) {
                var masked = PS.cloneCanvas(src);
                var mctx = masked.getContext("2d");
                mctx.globalCompositeOperation = "destination-in";
                mctx.drawImage(maskAlphaCanvas(layer), 0, 0);
                src = masked;
            }
            ctx.globalAlpha = layer.opacity * (layer.kind === "group" ? 1 : layer.fillOpacity);
            ctx.globalCompositeOperation = PS.canvasBlendOp(layer.blend);
            ctx.drawImage(src, 0, 0);
        });
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
    }

    function render2D(target, skipPreviews, nodes) {
        var d = PS.doc;
        if (target.width !== d.width || target.height !== d.height) {
            target.width = d.width;
            target.height = d.height;
        }
        var ctx = target.getContext("2d");
        ctx.clearRect(0, 0, d.width, d.height);
        draw2DList(ctx, nodes || d.root.children, { skipPreviews: skipPreviews });
    }

    return {
        init: init,
        renderDoc: renderDoc,
        compositeCanvas: compositeCanvas,
        snapshotComposite: snapshotComposite,
        renderTarget: renderTarget,
        compositeList: compositeList,
        layerSource: layerSource,
        maskUniforms: maskUniforms,
        blendOnto: blendOnto,
        get usesGL() { return useGL; }
    };
})();

// alpha of uSrc limited by uClip's alpha (clipping groups)
PS.gpu.defineProgram("clipAlpha", [
    "uniform sampler2D uSrc; uniform sampler2D uClip;",
    "void main() {",
    "    ivec2 p = px();",
    "    vec4 s = texelFetch(uSrc, p, 0);",
    "    float c = texelFetch(uClip, p, 0).a;",
    "    outColor = vec4(s.rgb, min(s.a, c));",
    "}"
].join("\n"));
