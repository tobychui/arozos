/*
    Photo editor renderer

    One WebGL fragment shader draws the edited picture: every canvas pixel is
    mapped back through crop, straighten, keystone and orientation to the
    source texture (geometry.js gives the matrices), then the light / colour
    adjustments, the filter and the vignette are applied.

    new PhotoRenderer(canvas, {preserve: bool})
      .setSource(canvasOrImage)   upload the picture
      .render(state, view, opts)  draw; opts.clip limits drawing to the crop,
                                  opts.original skips every adjustment
*/
(function (root) {
    "use strict";

    var VERT = [
        "attribute vec2 aPos;",
        "void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }"
    ].join("\n");

    var FRAG = [
        "precision highp float;",
        "uniform sampler2D uTex;",
        "uniform vec2 uTexel;",          //1 / texture size
        "uniform vec2 uCanvas;",         //canvas size, pixels
        "uniform mat3 uNFromCanvas;",
        "uniform mat3 uUvFromN;",
        "uniform vec2 uKey;",            //keystone a (vertical), b (horizontal)
        "uniform vec4 uClip;",           //x0, y0, x1, y1 in canvas pixels
        "uniform float uUseClip;",
        "uniform float uOriginal;",
        //light and colour, -1..1 unless noted
        "uniform float uExposure, uBrilliance, uHighlights, uShadows, uContrast, uBrightness, uBlack;",
        "uniform float uSaturation, uVibrance, uWarmth, uTint;",
        "uniform float uSharpness, uDefinition, uNoise, uVignette;",
        "uniform float uDefRadius;",     //definition radius in UV units of the short side
        //filter
        "uniform float uFIntensity, uFSat, uFContrast, uFExposure, uFWarm, uFMono, uFFade;",
        "uniform vec3 uFTone;",
        "",
        "float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }",
        "vec3 tex(vec2 uv){ return texture2D(uTex, uv).rgb; }",
        "",
        "vec3 adjust(vec3 c){",
        "  vec3 lin = pow(max(c, 0.0), vec3(2.2));",
        "  lin *= exp2(uExposure * 1.6);",
        "  c = pow(lin, vec3(1.0 / 2.2));",
        "  float L = luma(c);",
        "  float shW = 1.0 - smoothstep(0.0, 0.55, L);",
        "  float hiW = smoothstep(0.45, 1.0, L);",
        "  c += uBrilliance * (0.22 * shW - 0.16 * hiW);",
        "  c = mix(c, (c - 0.5) * 1.08 + 0.5, max(uBrilliance, 0.0) * 0.5);",
        "  c += uHighlights * 0.28 * hiW;",
        "  c += uShadows * 0.30 * shW;",
        "  c = (c - 0.5) * (1.0 + uContrast * 0.75) + 0.5;",
        "  c = pow(clamp(c, 0.0, 1.0), vec3(exp2(-uBrightness * 0.85)));",
        "  float t = uBlack * 0.18;",
        "  c = (c - t) / (1.0 - t);",
        "  L = luma(c);",
        "  c = mix(vec3(L), c, 1.0 + uSaturation);",
        "  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));",
        "  c = mix(vec3(L), c, 1.0 + uVibrance * (1.0 - clamp(sat, 0.0, 1.0)) * 1.2);",
        "  c *= vec3(1.0 + uWarmth * 0.12, 1.0 + uWarmth * 0.02, 1.0 - uWarmth * 0.14);",
        "  c *= vec3(1.0 + uTint * 0.06, 1.0 - uTint * 0.12, 1.0 + uTint * 0.06);",
        "  return c;",
        "}",
        "",
        "vec3 applyFilter(vec3 c){",
        "  vec3 f = c * exp2(uFExposure);",
        "  f = (f - 0.5) * (1.0 + uFContrast) + 0.5;",
        "  float L = luma(f);",
        "  f = mix(vec3(L), f, 1.0 + uFSat);",
        "  f *= vec3(1.0 + uFWarm * 0.10, 1.0 + uFWarm * 0.01, 1.0 - uFWarm * 0.12);",
        "  if (uFMono > 0.5) { f = vec3(luma(f)) * uFTone; }",
        "  f = uFFade + f * (1.0 - uFFade);",
        "  return mix(c, f, uFIntensity);",
        "}",
        "",
        "void main(){",
        "  vec2 p = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);",
        "  if (uUseClip > 0.5 && (p.x < uClip.x || p.y < uClip.y || p.x > uClip.z || p.y > uClip.w)) { gl_FragColor = vec4(0.0); return; }",
        "  vec3 nk = uNFromCanvas * vec3(p, 1.0);",
        "  float d = 1.0 - uKey.x * nk.y - uKey.y * nk.x;",
        "  if (d <= 0.0) { gl_FragColor = vec4(0.0); return; }",
        "  vec2 n = nk.xy / d;",
        "  vec2 uv = (uUvFromN * vec3(n, 1.0)).xy;",
        "  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0); return; }",
        "  vec3 c = tex(uv);",
        "  if (uOriginal > 0.5) { gl_FragColor = vec4(c, 1.0); return; }",
        "  if (uSharpness > 0.0 || uNoise > 0.0) {",
        "    vec2 e = uTexel;",
        "    vec3 b = (tex(uv + vec2(e.x, 0.0)) + tex(uv - vec2(e.x, 0.0)) + tex(uv + vec2(0.0, e.y)) + tex(uv - vec2(0.0, e.y))) * 0.15",
        "           + (tex(uv + e) + tex(uv - e) + tex(uv + vec2(e.x, -e.y)) + tex(uv + vec2(-e.x, e.y))) * 0.075 + c * 0.1;",
        "    c = mix(c, b, uNoise * 0.85);",
        "    c += (c - b) * uSharpness * 1.8;",
        "  }",
        "  if (uDefinition != 0.0) {",
        "    vec2 r = uTexel * (uDefRadius / max(uTexel.x, uTexel.y));",
        "    float bl = 0.0;",
        "    for (int i = 0; i < 8; i++) {",
        "      float a = float(i) * 0.785398;",
        "      bl += luma(tex(uv + vec2(cos(a), sin(a)) * r));",
        "      bl += luma(tex(uv + vec2(cos(a + 0.39), sin(a + 0.39)) * r * 0.5));",
        "    }",
        "    bl /= 16.0;",
        "    c += (luma(c) - bl) * uDefinition * 0.9;",
        "  }",
        "  c = adjust(c);",
        "  c = applyFilter(c);",
        "  if (uVignette != 0.0) {",
        "    vec2 ctr = (uClip.xy + uClip.zw) * 0.5;",
        "    vec2 hs = max((uClip.zw - uClip.xy) * 0.5, vec2(1.0));",
        "    vec2 q = (p - ctr) / hs;",
        "    float rr = length(q) / 1.41421;",
        "    c *= 1.0 - uVignette * 0.75 * smoothstep(0.25, 1.0, rr);",
        "  }",
        "  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);",
        "}"
    ].join("\n");

    //Filter presets: name -> shader parameters
    var FILTERS = [
        { id: "original", name: "Original" },
        { id: "vivid", name: "Vivid", sat: 0.35, contrast: 0.12 },
        { id: "vividwarm", name: "Vivid Warm", sat: 0.32, contrast: 0.12, warm: 0.55 },
        { id: "vividcool", name: "Vivid Cool", sat: 0.32, contrast: 0.12, warm: -0.55 },
        { id: "dramatic", name: "Dramatic", sat: -0.18, contrast: 0.32, exposure: -0.15 },
        { id: "dramaticwarm", name: "Dramatic Warm", sat: -0.08, contrast: 0.32, exposure: -0.15, warm: 0.55 },
        { id: "dramaticcool", name: "Dramatic Cool", sat: -0.08, contrast: 0.32, exposure: -0.15, warm: -0.55 },
        { id: "mono", name: "Mono", mono: 1 },
        { id: "silvertone", name: "Silvertone", mono: 1, contrast: 0.1, fade: 0.06, tone: [1.03, 1.0, 0.93] },
        { id: "noir", name: "Noir", mono: 1, contrast: 0.55, exposure: -0.12 }
    ];

    function filterById(id) {
        for (var i = 0; i < FILTERS.length; i++) {
            if (FILTERS[i].id === id) {
                return FILTERS[i];
            }
        }
        return FILTERS[0];
    }

    function PhotoRenderer(canvas, opts) {
        opts = opts || {};
        this.canvas = canvas;
        var attrs = { premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserve, antialias: false, alpha: true };
        var gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
        if (!gl) {
            throw new Error("WebGL is not available");
        }
        this.gl = gl;
        this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        this.program = this._program(VERT, FRAG);
        gl.useProgram(this.program);

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(this.program, "aPos");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        this.uniforms = {};
        this.texW = 1;
        this.texH = 1;
    }

    PhotoRenderer.prototype._program = function (vs, fs) {
        var gl = this.gl;
        function compile(type, src) {
            var s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                throw new Error("Shader: " + gl.getShaderInfoLog(s));
            }
            return s;
        }
        var p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error("Program: " + gl.getProgramInfoLog(p));
        }
        return p;
    };

    PhotoRenderer.prototype._u = function (name) {
        if (!(name in this.uniforms)) {
            this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
        }
        return this.uniforms[name];
    };

    PhotoRenderer.prototype.setSource = function (src) {
        var gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        this.texW = src.width;
        this.texH = src.height;
        return this;
    };

    PhotoRenderer.prototype.resize = function (w, h) {
        w = Math.max(1, Math.round(w));
        h = Math.max(1, Math.round(h));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
        }
    };

    function mat3(m) {
        //column major for WebGL from [a, b, c, d, e, f]
        return new Float32Array([m[0], m[3], 0, m[1], m[4], 0, m[2], m[5], 1]);
    }

    /*
        state: {geo, adj: {exposure: -100..100, ...}, filter: id, filterIntensity: 0..100, auto}
        view:  {scale, tx, ty} in canvas pixels
        opts:  {clip: bool, original: bool}
    */
    PhotoRenderer.prototype.render = function (state, view, opts) {
        opts = opts || {};
        var gl = this.gl;
        var cw = this.canvas.width, ch = this.canvas.height;
        gl.viewport(0, 0, cw, ch);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);

        var m = PhotoGeo.shaderMatrices(state.geo, view);
        gl.uniform2f(this._u("uTexel"), 1 / this.texW, 1 / this.texH);
        gl.uniform2f(this._u("uCanvas"), cw, ch);
        gl.uniformMatrix3fv(this._u("uNFromCanvas"), false, mat3(m.nFromCanvas));
        gl.uniformMatrix3fv(this._u("uUvFromN"), false, mat3(m.uvFromN));
        gl.uniform2f(this._u("uKey"), m.a, m.b);

        var c = state.geo.crop;
        var x0 = (c.cx - c.w / 2) * view.scale + view.tx, y0 = (c.cy - c.h / 2) * view.scale + view.ty;
        gl.uniform4f(this._u("uClip"), x0, y0, x0 + c.w * view.scale, y0 + c.h * view.scale);
        gl.uniform1f(this._u("uUseClip"), opts.clip ? 1 : 0);
        gl.uniform1f(this._u("uOriginal"), opts.original ? 1 : 0);

        var a = effectiveAdjustments(state);
        var names = ["Exposure", "Brilliance", "Highlights", "Shadows", "Contrast", "Brightness", "Black",
            "Saturation", "Vibrance", "Warmth", "Tint", "Sharpness", "Definition", "Noise", "Vignette"];
        for (var i = 0; i < names.length; i++) {
            gl.uniform1f(this._u("u" + names[i]), a[names[i].toLowerCase()] || 0);
        }
        gl.uniform1f(this._u("uDefRadius"), 0.012);

        var f = filterById(state.filter);
        var intensity = f.id === "original" ? 0 : (state.filterIntensity === undefined ? 100 : state.filterIntensity) / 100;
        gl.uniform1f(this._u("uFIntensity"), intensity);
        gl.uniform1f(this._u("uFSat"), f.sat || 0);
        gl.uniform1f(this._u("uFContrast"), f.contrast || 0);
        gl.uniform1f(this._u("uFExposure"), f.exposure || 0);
        gl.uniform1f(this._u("uFWarm"), f.warm || 0);
        gl.uniform1f(this._u("uFMono"), f.mono || 0);
        gl.uniform1f(this._u("uFFade"), f.fade || 0);
        var tone = f.tone || [1, 1, 1];
        gl.uniform3f(this._u("uFTone"), tone[0], tone[1], tone[2]);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    PhotoRenderer.prototype.destroy = function () {
        var ext = this.gl.getExtension("WEBGL_lose_context");
        if (ext) {
            ext.loseContext();
        }
    };

    /*
        Adjustment sliders run -100..100 (some 0..100); the shader wants
        -1..1. Auto adds a measured correction scaled by its own slider.
        "black" is the black point slider.
    */
    var ADJUST_KEYS = ["exposure", "brilliance", "highlights", "shadows", "contrast", "brightness", "black",
        "saturation", "vibrance", "warmth", "tint", "sharpness", "definition", "noise", "vignette"];

    function effectiveAdjustments(state) {
        var adj = state.adj || {};
        var out = {};
        var auto = (adj.auto || 0) / 100;
        var ap = state.autoParams || {};
        for (var i = 0; i < ADJUST_KEYS.length; i++) {
            var k = ADJUST_KEYS[i];
            var v = (adj[k] || 0) / 100 + auto * (ap[k] || 0);
            out[k] = Math.max(-1, Math.min(1, v));
        }
        return out;
    }

    /*
        Auto enhance: measure the picture (from a small RGBA buffer) and
        return slider values in -1..1 that bring it to a balanced exposure.
    */
    function measureAuto(pixels) {
        var hist = new Uint32Array(256);
        var n = 0, sum = 0, satSum = 0;
        for (var i = 0; i < pixels.length; i += 16) {
            var r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
            var L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            hist[Math.min(255, Math.round(L * 255))]++;
            sum += L;
            satSum += Math.max(r, g, b) - Math.min(r, g, b);
            n++;
        }
        if (n === 0) {
            return {};
        }
        function pct(p) {
            var target = n * p, acc = 0;
            for (var i = 0; i < 256; i++) {
                acc += hist[i];
                if (acc >= target) {
                    return i / 255;
                }
            }
            return 1;
        }
        var mean = sum / n, p01 = pct(0.01), p05 = pct(0.05), p99 = pct(0.99), p995 = pct(0.995);
        var sat = satSum / n;
        function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
        return {
            exposure: clamp((0.46 - mean) * 1.1, -0.45, 0.45),
            brilliance: clamp((0.45 - mean) * 0.6 + 0.1, -0.2, 0.35),
            highlights: p995 > 0.96 ? -0.25 : 0,
            shadows: p05 < 0.08 ? 0.2 : 0,
            contrast: clamp((0.75 - (p99 - p01)) * 0.4, -0.15, 0.25),
            black: clamp(p01 * 1.5, 0, 0.25),
            vibrance: clamp((0.25 - sat) * 0.8, 0, 0.25)
        };
    }

    root.PhotoRenderer = PhotoRenderer;
    root.PhotoFilters = FILTERS;
    root.PhotoRendererUtil = {
        measureAuto: measureAuto,
        effectiveAdjustments: effectiveAdjustments,
        ADJUST_KEYS: ADJUST_KEYS
    };
})(this);
