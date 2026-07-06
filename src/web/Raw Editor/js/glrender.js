/*
    glrender.js — WebGL2 develop pipeline for the Raw Editor.

    Uploads the decoded linear-light image into a half-float texture and renders
    it through a fragment shader that implements the Camera-Raw style controls
    (white balance, exposure, contrast, highlights/shadows/whites/blacks,
    clarity, dehaze, vibrance, saturation) followed by an optional 3D LUT grade.

    A separable Gaussian blur of the base image is pre-computed into a texture so
    "clarity" and "dehaze" have a low-pass reference for local contrast — all in
    a single real-time pass while a slider is dragged.

    The image is edited in an approximate sRGB display space: after WB + exposure
    the linear values are gamma encoded, every tonal / colour op runs on those
    display values, and the canvas (sRGB) shows the result directly.
*/

const GLRender = (function () {

    const VERT = `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main(){
        vUv = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
        gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

    // Simple separable Gaussian blur (5-tap), reused for H and V passes.
    const BLUR_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 frag;
    uniform sampler2D uTex;
    uniform vec2 uDir;      // texel step in one axis
    void main(){
        vec4 c = texture(uTex, vUv) * 0.227027;
        c += texture(uTex, vUv + uDir * 1.0) * 0.194595;
        c += texture(uTex, vUv - uDir * 1.0) * 0.194595;
        c += texture(uTex, vUv + uDir * 2.0) * 0.121622;
        c += texture(uTex, vUv - uDir * 2.0) * 0.121622;
        c += texture(uTex, vUv + uDir * 3.0) * 0.070270;
        c += texture(uTex, vUv - uDir * 3.0) * 0.070270;
        frag = c;
    }`;

    const MAIN_FRAG = `#version 300 es
    precision highp float;
    precision highp sampler3D;
    in vec2 vUv;
    out vec4 frag;

    uniform sampler2D uImage;
    uniform sampler2D uBlur;
    uniform sampler3D uLUT;

    uniform vec3  uWB;
    uniform float uExposure;
    uniform float uContrast;
    uniform float uHighlights;
    uniform float uShadows;
    uniform float uWhites;
    uniform float uBlacks;
    uniform float uTexture;
    uniform float uClarity;
    uniform float uDehaze;
    uniform float uVibrance;
    uniform float uSaturation;
    uniform float uVignette;
    uniform float uGrain;
    uniform int   uLutEnabled;
    uniform float uLutAmount;
    uniform float uLutSize;
    uniform vec3  uLutDomainMin;
    uniform vec3  uLutDomainMax;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    // True sRGB OETF — matches how LUTs (and Photoshop) expect their input, and
    // exactly inverts the sRGB decode applied to 8-bit source images on load.
    vec3 toDisplay(vec3 c){
        c = max(c, vec3(0.0));
        vec3 lo = c * 12.92;
        vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
        return mix(lo, hi, step(vec3(0.0031308), c));
    }

    // Fetch an exact LUT lattice point (requires NEAREST filtering on uLUT).
    vec3 lutFetch(vec3 idx){
        return texture(uLUT, (idx + 0.5) / uLutSize).rgb;
    }

    // Tetrahedral interpolation of the 3D LUT — the same method Photoshop /
    // Resolve use. Avoids the cyan/green cast that GPU trilinear introduces on
    // film-style LUTs.
    vec3 lutTetra(vec3 rgb){
        vec3 pos = clamp(rgb, 0.0, 1.0) * (uLutSize - 1.0);
        vec3 b = floor(pos);
        vec3 f = pos - b;
        vec3 V000 = lutFetch(b);
        vec3 V111 = lutFetch(b + vec3(1.0));
        vec3 r;
        if (f.r > f.g) {
            if (f.g > f.b) {                 // R > G > B
                r = (1.0 - f.r) * V000 + (f.r - f.g) * lutFetch(b + vec3(1.0, 0.0, 0.0)) + (f.g - f.b) * lutFetch(b + vec3(1.0, 1.0, 0.0)) + f.b * V111;
            } else if (f.r > f.b) {          // R > B > G
                r = (1.0 - f.r) * V000 + (f.r - f.b) * lutFetch(b + vec3(1.0, 0.0, 0.0)) + (f.b - f.g) * lutFetch(b + vec3(1.0, 0.0, 1.0)) + f.g * V111;
            } else {                         // B > R > G
                r = (1.0 - f.b) * V000 + (f.b - f.r) * lutFetch(b + vec3(0.0, 0.0, 1.0)) + (f.r - f.g) * lutFetch(b + vec3(1.0, 0.0, 1.0)) + f.g * V111;
            }
        } else {
            if (f.b > f.g) {                 // B > G > R
                r = (1.0 - f.b) * V000 + (f.b - f.g) * lutFetch(b + vec3(0.0, 0.0, 1.0)) + (f.g - f.r) * lutFetch(b + vec3(0.0, 1.0, 1.0)) + f.r * V111;
            } else if (f.b > f.r) {          // G > B > R
                r = (1.0 - f.g) * V000 + (f.g - f.b) * lutFetch(b + vec3(0.0, 1.0, 0.0)) + (f.b - f.r) * lutFetch(b + vec3(0.0, 1.0, 1.0)) + f.r * V111;
            } else {                         // G > R > B
                r = (1.0 - f.g) * V000 + (f.g - f.r) * lutFetch(b + vec3(0.0, 1.0, 0.0)) + (f.r - f.b) * lutFetch(b + vec3(1.0, 1.0, 0.0)) + f.b * V111;
            }
        }
        return r;
    }

    vec3 develop(vec3 lin, vec3 blurLin, vec2 uv){
        // 1. White balance + exposure in linear light.
        lin *= uWB;
        lin *= exp2(uExposure);
        blurLin *= uWB;
        blurLin *= exp2(uExposure);

        // 2. Encode to display space for tonal work.
        vec3 v = toDisplay(lin);
        float bl = dot(toDisplay(blurLin), LUMA);

        // 3. Contrast (S pivot around mid grey).
        v = (v - 0.5) * (1.0 + uContrast) + 0.5;

        // 4. Region tone: highlights / shadows / whites / blacks.
        float L = dot(clamp(v, 0.0, 1.0), LUMA);
        float hiMask = smoothstep(0.5, 1.0, L);
        float shMask = smoothstep(0.5, 0.0, L);
        float whMask = smoothstep(0.7, 1.0, L);
        float bkMask = smoothstep(0.3, 0.0, L);
        v += uHighlights * 0.5 * hiMask;
        v += uShadows    * 0.5 * shMask;
        v += uWhites     * 0.4 * whMask;
        v += uBlacks     * 0.4 * bkMask;

        // 5. Texture (fine local contrast) + Clarity (midtone local contrast).
        float detail = L - bl;
        float midMask = 1.0 - clamp(abs(L - 0.5) * 2.0, 0.0, 1.0);
        v += uTexture * detail * 1.4;
        v += uClarity * detail * midMask * 2.0;

        // 6. Dehaze — pull local contrast harder and lift low areas.
        if (abs(uDehaze) > 0.001){
            float d = uDehaze;
            v += d * detail * 1.5;
            v -= d * 0.08 * (1.0 - L);
        }

        v = clamp(v, 0.0, 1.0);

        // 7. Vibrance (weighted) then Saturation (uniform).
        float lum = dot(v, LUMA);
        float mx = max(max(v.r, v.g), v.b);
        float mn = min(min(v.r, v.g), v.b);
        float curSat = mx - mn;
        float vibF = 1.0 + uVibrance * (1.0 - curSat);
        v = clamp(mix(vec3(lum), v, vibF), 0.0, 1.0);
        lum = dot(v, LUMA);
        v = clamp(mix(vec3(lum), v, 1.0 + uSaturation), 0.0, 1.0);

        // 8. Vignette (radial) and grain (post effects).
        if (abs(uVignette) > 0.001){
            float dd = distance(uv, vec2(0.5)) * 1.41421;
            v *= clamp(1.0 + uVignette * 0.9 * (dd * dd - 0.25), 0.0, 4.0);
        }
        if (uGrain > 0.001){
            float n = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
            v += (n - 0.5) * uGrain * 0.18;
        }
        v = clamp(v, 0.0, 1.0);

        // 9. 3D LUT colour grade (tetrahedral, domain-mapped).
        if (uLutEnabled == 1){
            vec3 dom = (clamp(v, 0.0, 1.0) - uLutDomainMin) / max(uLutDomainMax - uLutDomainMin, vec3(1e-5));
            vec3 graded = lutTetra(clamp(dom, 0.0, 1.0));
            v = mix(v, graded, uLutAmount);
        }
        return clamp(v, 0.0, 1.0);
    }

    void main(){
        vec3 lin = texture(uImage, vUv).rgb;
        vec3 blurLin = texture(uBlur, vUv).rgb;
        frag = vec4(develop(lin, blurLin, vUv), 1.0);
    }`;

    function compile(gl, type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(sh);
            gl.deleteShader(sh);
            throw new Error("Shader compile error: " + log);
        }
        return sh;
    }

    function program(gl, vsrc, fsrc) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsrc));
        gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc));
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error("Program link error: " + gl.getProgramInfoLog(p));
        }
        return p;
    }

    function Renderer(canvas) {
        const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
        if (!gl) throw new Error("WebGL2 is not available in this browser.");
        if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) {
            // Float render targets are needed for the blur pass; continue and
            // hope UNSIGNED_BYTE fallback works, but most modern browsers pass.
        }

        this.gl = gl;
        this.canvas = canvas;
        this.mainProg = program(gl, VERT, MAIN_FRAG);
        this.blurProg = program(gl, VERT, BLUR_FRAG);

        // Fullscreen triangle.
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.vao = vao;

        this.imageTex = null;
        this.blurTex = null;
        this.lutTex = null;
        this.lutSize = 2;
        this.width = 0;
        this.height = 0;

        // A 2x2x2 identity 3D LUT kept permanently bound to the uLUT sampler.
        // Some drivers (ANGLE/SwiftShader) render a draw as black when a used
        // sampler3D has no complete texture bound — even inside a disabled
        // branch — so we always keep a valid 3D texture available.
        this.dummyLut = this._makeIdentityLut3D();
    }

    Renderer.prototype._makeIdentityLut3D = function () {
        const gl = this.gl;
        const n = 2;
        const d = new Float32Array(n * n * n * 4);
        let p = 0;
        for (let b = 0; b < n; b++)
            for (let g = 0; g < n; g++)
                for (let r = 0; r < n; r++) {
                    d[p++] = r; d[p++] = g; d[p++] = b; d[p++] = 1;
                }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, d);
        // NEAREST: tetrahedral interpolation fetches exact lattice points itself.
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return tex;
    };

    Renderer.prototype._makeFloatTex = function (w, h) {
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
    };

    // Upload a decoded image ({data:Float32 RGBA linear, width, height}).
    Renderer.prototype.setImage = function (img) {
        const gl = this.gl;
        this.width = img.width;
        this.height = img.height;
        this.canvas.width = img.width;
        this.canvas.height = img.height;

        if (this.imageTex) gl.deleteTexture(this.imageTex);
        this.imageTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
        // HALF_FLOAT texImage from Float32 source is accepted by WebGL2.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.FLOAT, img.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this._buildBlur(img);
    };

    // Two-pass separable blur of the base linear image into this.blurTex.
    Renderer.prototype._buildBlur = function (img) {
        const gl = this.gl;
        const w = img.width, h = img.height;
        const texA = this._makeFloatTex(w, h);
        const texB = this._makeFloatTex(w, h);
        // Load base into texA.
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.FLOAT, img.data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const fbo = gl.createFramebuffer();
        gl.useProgram(this.blurProg);
        gl.bindVertexArray(this.vao);
        gl.viewport(0, 0, w, h);
        const uTex = gl.getUniformLocation(this.blurProg, "uTex");
        const uDir = gl.getUniformLocation(this.blurProg, "uDir");

        // Horizontal: texA -> texB
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texB, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.uniform1i(uTex, 0);
        gl.uniform2f(uDir, 1.5 / w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Vertical: texB -> texA (final blurred result stored in texA)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texA, 0);
        gl.bindTexture(gl.TEXTURE_2D, texB);
        gl.uniform1i(uTex, 0);
        gl.uniform2f(uDir, 0, 1.5 / h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(texB);
        if (this.blurTex) gl.deleteTexture(this.blurTex);
        this.blurTex = texA;
    };

    // Upload a parsed LUT ({size, data:Float32 RGB}) or clear it (null).
    Renderer.prototype.setLUT = function (lut) {
        const gl = this.gl;
        if (this.lutTex) { gl.deleteTexture(this.lutTex); this.lutTex = null; }
        if (!lut) return;
        const n = lut.size;
        // Expand RGB -> RGBA for texImage3D.
        const rgba = new Float32Array(n * n * n * 4);
        for (let i = 0, j = 0; i < lut.data.length; i += 3, j += 4) {
            rgba[j] = lut.data[i];
            rgba[j + 1] = lut.data[i + 1];
            rgba[j + 2] = lut.data[i + 2];
            rgba[j + 3] = 1.0;
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, n, n, n, 0, gl.RGBA, gl.FLOAT, rgba);
        // NEAREST: tetrahedral interpolation is done in the shader, so we must
        // read exact lattice values rather than GPU trilinear samples.
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        this.lutTex = tex;
        this.lutSize = n;
        this.lutDomainMin = (lut.domainMin && lut.domainMin.length === 3) ? lut.domainMin : [0, 0, 0];
        this.lutDomainMax = (lut.domainMax && lut.domainMax.length === 3) ? lut.domainMax : [1, 1, 1];
    };

    // Compute relative white-balance gains from temperature/tint sliders.
    // baseTemp is the "As Shot" reference already baked into the pixels.
    function GLRender_kelvinGain(temp, tint, baseTemp) {
        function warmth(t) {
            // Map Kelvin to a warm/cool balance on a log scale (neutral at base).
            return (Math.log(t) - Math.log(baseTemp)) / (Math.log(50000) - Math.log(2000));
        }
        const wr = warmth(temp);
        // Warmer (higher K in ACR) -> boost red, cut blue.
        let r = 1.0 + wr * 0.9;
        let b = 1.0 - wr * 0.9;
        // Tint: positive -> magenta (reduce green), negative -> green.
        const tn = tint / 150.0;
        let g = 1.0 - tn * 0.4;
        r += tn * 0.05; b += tn * 0.05;
        return [
            Math.max(0.2, Math.min(4.0, r)),
            Math.max(0.2, Math.min(4.0, g)),
            Math.max(0.2, Math.min(4.0, b))
        ];
    }

    // Render the image with the given develop parameters.
    Renderer.prototype.render = function (p) {
        const gl = this.gl;
        if (!this.imageTex) return;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.mainProg);
        gl.bindVertexArray(this.vao);

        const u = (n) => gl.getUniformLocation(this.mainProg, n);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
        gl.uniform1i(u("uImage"), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.blurTex);
        gl.uniform1i(u("uBlur"), 1);

        const wb = GLRender_kelvinGain(p.temperature, p.tint, p.baseTemp || 5500);
        gl.uniform3f(u("uWB"), wb[0], wb[1], wb[2]);
        gl.uniform1f(u("uExposure"), p.exposure);
        gl.uniform1f(u("uContrast"), p.contrast / 100);
        gl.uniform1f(u("uHighlights"), p.highlights / 100);
        gl.uniform1f(u("uShadows"), p.shadows / 100);
        gl.uniform1f(u("uWhites"), p.whites / 100);
        gl.uniform1f(u("uBlacks"), p.blacks / 100);
        gl.uniform1f(u("uTexture"), p.texture / 100);
        gl.uniform1f(u("uClarity"), p.clarity / 100);
        gl.uniform1f(u("uDehaze"), p.dehaze / 100);
        gl.uniform1f(u("uVibrance"), p.vibrance / 100);
        gl.uniform1f(u("uSaturation"), p.saturation / 100);
        gl.uniform1f(u("uVignette"), p.vignette / 100);
        gl.uniform1f(u("uGrain"), p.grain / 100);

        // Always keep a complete 3D texture on the uLUT sampler (see dummyLut).
        gl.activeTexture(gl.TEXTURE2);
        gl.uniform1i(u("uLUT"), 2);
        if (this.lutTex && p.lutEnabled) {
            gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
            gl.uniform1i(u("uLutEnabled"), 1);
            gl.uniform1f(u("uLutAmount"), p.lutAmount != null ? p.lutAmount : 1.0);
            gl.uniform1f(u("uLutSize"), this.lutSize);
            var dmin = this.lutDomainMin || [0, 0, 0], dmax = this.lutDomainMax || [1, 1, 1];
            gl.uniform3f(u("uLutDomainMin"), dmin[0], dmin[1], dmin[2]);
            gl.uniform3f(u("uLutDomainMax"), dmax[0], dmax[1], dmax[2]);
        } else {
            gl.bindTexture(gl.TEXTURE_3D, this.dummyLut);
            gl.uniform1i(u("uLutEnabled"), 0);
            gl.uniform1f(u("uLutSize"), 2.0);
            gl.uniform3f(u("uLutDomainMin"), 0, 0, 0);
            gl.uniform3f(u("uLutDomainMax"), 1, 1, 1);
        }

        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // Ensure the draw is complete so an immediate drawImage()/toBlob() of the
        // canvas (histogram, export) reads back the freshly rendered frame.
        gl.finish();
    };

    return {
        create: function (canvas) { return new Renderer(canvas); }
    };
})();
