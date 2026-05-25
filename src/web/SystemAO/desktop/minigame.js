/*
    ArozOS Web Desktop Offline Minigame
    A simple runner game - click to focus, ↑ to jump, ↓ to duck.
*/

document.addEventListener("DOMContentLoaded", function () {
    const container = document.getElementById("offline_minigame");
    if (!container) return;

    /* ── Canvas ── */
    const W = 300, H = 112;
    const canvas = document.createElement("canvas");
    canvas.width  = W;
    canvas.height = H;
    canvas.style.cssText = "display:block;cursor:pointer;border-radius:.28571429rem;" +
                           "margin-top:8px;background:rgba(0,0,0,0.45);"; 
                           //border-radius matching semantic-ui cards
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");

    /* ── Constants ── */
    const GY       = 84;    // ground y — foot level
    const BASE_SPD = 3.5;
    const MAX_SPD  = 14;
    const GRAV     = 0.65;
    const JUMP_V   = -9;

    /* ── State ── */
    let state   = "idle";   // idle | playing | dead
    let score   = 0;
    let hiScore = 0;
    let spd     = BASE_SPD;
    let tick    = 0;
    let focused = false;
    let gScroll = 0;

    /* ── Obstacles ── */
    let obstacles = [];
    let obsDue  = 110;   // ticks until next spawn
    let obsTick = 0;

    /* ── Runner (dino) ── */
    const R = {
        x: 40, y: GY, vy: 0,
        jumping: false, ducking: false,
        get h()    { return this.ducking ? 13 : 26; },
        get top()  { return this.ducking ? this.y - 13 : this.y - 26; },
        get left() { return this.x; },
        get right(){ return this.x + (this.ducking ? 30 : 20); },

        jump() {
            if (!this.jumping && !this.ducking) { this.vy = JUMP_V; this.jumping = true; }
        },
        duck(v) {
            if (!this.jumping) this.ducking = v;
        },
        update() {
            if (this.jumping || this.y < GY) {
                this.vy += GRAV;
                this.y = Math.min(GY, this.y + this.vy);
                if (this.y === GY) { this.vy = 0; this.jumping = false; }
            }
        },
        draw() {
            const x = this.x, y = this.y;
            const lp = Math.floor(tick / 6) % 2;

            if (this.ducking) {
                // wide flat cube
                ctx.fillStyle = "#c8c8c8";
                ctx.fillRect(x, y - 13, 30, 13);
                // eye
                ctx.fillStyle = "#fff";
                ctx.beginPath(); ctx.arc(x + 25, y - 7, 3.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#222";
                ctx.beginPath(); ctx.arc(x + 26, y - 7, 1.8, 0, Math.PI * 2); ctx.fill();
            } else {
                // two stubby legs
                ctx.fillStyle = "#a8a8a8";
                ctx.fillRect(x + 3,  y - 8 + (lp ? 4 : 0), 6, lp ? 4 : 8);
                ctx.fillRect(x + 11, y - 8 + (lp ? 0 : 4), 6, lp ? 8 : 4);
                // main body cube
                ctx.fillStyle = "#c8c8c8";
                ctx.fillRect(x, y - 26, 20, 18);
                // eye
                ctx.fillStyle = "#fff";
                ctx.beginPath(); ctx.arc(x + 15, y - 19, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = "#222";
                ctx.beginPath(); ctx.arc(x + 16, y - 19, 2, 0, Math.PI * 2); ctx.fill();
            }
        }
    };

    /* ── Obstacle factories ── */
    function mkCactus() {
        const h = 28 + Math.floor(Math.random() * 22);
        return { type: "c", x: W + 8, y: GY - h, w: 15, h };
    }
    function mkBird() {
        const ys = [GY - 54, GY - 36, GY - 20];
        return { type: "b", x: W + 8, y: ys[Math.floor(Math.random() * ys.length)], w: 26, h: 12 };
    }
    function spawnObs() {
        obstacles.push(score < 15 || Math.random() < 0.62 ? mkCactus() : mkBird());
        obsDue  = 58 + Math.floor(Math.random() * 72);
        obsTick = 0;
    }

    /* ── Obstacle drawing ── */
    function drawObs(o) {
        if (o.type === "c") {
            ctx.fillStyle = "#77bb77";
            const cx = o.x + o.w / 2 - 4;
            ctx.fillRect(cx,          o.y,                     8, o.h);          // trunk
            const ay = o.y + o.h * 0.35;
            ctx.fillRect(o.x,         ay,                   o.w,    5);          // arm bar
            ctx.fillRect(o.x,         ay - 15,                 6,   18);         // left arm
            ctx.fillRect(o.x + o.w-6, ay - 10,                 6,   13);         // right arm
        } else {
            ctx.fillStyle = "#ddcc77";
            const fu = Math.floor(tick / 7) % 2;
            ctx.fillRect(o.x,         o.y + 3,  o.w,  6);                       // body
            ctx.fillRect(o.x + o.w,   o.y + 4,    6,  3);                       // beak
            ctx.fillRect(o.x + 3, fu ? o.y-7 : o.y+9, o.w-6, fu ? 10 : 8);    // wings
            ctx.fillStyle = "#333";
            ctx.fillRect(o.x + 3,     o.y + 4,    2,  2);                       // eye
        }
    }

    /* ── Collision ── */
    function hits(o) {
        const rl = R.left, rr = R.right, rt = R.top + 4, rb = R.y;
        let ol, or_, ot, ob;
        if (o.type === "c") { ol = o.x+2;  or_ = o.x+o.w-2; ot = o.y+3;  ob = o.y+o.h; }
        else                 { ol = o.x+1;  or_ = o.x+o.w+4; ot = o.y+3;  ob = o.y+9;   }
        return rl < or_ && rr > ol && rt < ob && rb > ot;
    }

    /* ── Scene helpers ── */
    function drawGround() {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, GY+1); ctx.lineTo(W, GY+1); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        if (state === "playing") gScroll = (gScroll + spd) % 48;
        for (let x = -gScroll; x < W; x += 48) {
            ctx.fillRect(x,      GY+3, 14, 2);
            ctx.fillRect(x + 26, GY+5,  7, 1);
        }
    }

    function drawHUD() {
        ctx.fillStyle = "rgba(255,255,255,0.72)";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "right";
        ctx.fillText("HI " + pad5(hiScore) + "  " + pad5(score), W - 5, 13);
    }

    function pad5(n) { return String(n).padStart(5, "0"); }

    /* ── Main loop ── */
    function loop() {
        ctx.clearRect(0, 0, W, H);
        drawGround();

        if (state === "playing") {
            tick++;
            if (tick % 6 === 0) { score++; if (score > hiScore) hiScore = score; }
            spd = Math.min(MAX_SPD, BASE_SPD + score * 0.018);

            obsTick++;
            if (obsTick >= obsDue) spawnObs();

            for (let i = obstacles.length - 1; i >= 0; i--) {
                obstacles[i].x -= spd;
                if (obstacles[i].x + obstacles[i].w < -10) { obstacles.splice(i, 1); continue; }
                drawObs(obstacles[i]);
                if (hits(obstacles[i])) state = "dead";
            }
            R.update();
            R.draw();

        } else if (state === "idle") {
            R.draw();
            ctx.fillStyle = "rgba(255,255,255,0.55)";
            ctx.font = "11px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("Click or press \u2191 to play", W / 2, H / 2 + 6);

        } else if (state === "dead") {
            obstacles.forEach(drawObs);
            R.draw();
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
            ctx.fillText("GAME OVER", W / 2, H / 2 - 2);
            ctx.font = "10px sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.fillText("Click or \u2191 to restart", W / 2, H / 2 + 14);
        }

        drawHUD();
        requestAnimationFrame(loop);
    }

    /* ── Reset ── */
    function reset() {
        score = 0; spd = BASE_SPD; tick = 0;
        obstacles = []; obsDue = 110; obsTick = 0; gScroll = 0;
        R.y = GY; R.vy = 0; R.jumping = false; R.ducking = false;
        state = "idle";
    }

    /* ── Input ── */
    canvas.addEventListener("click", function () {
        if (!focused) { focused = true; canvas.style.outline = "1px solid rgba(255,255,255,0.25)"; }
        if (state === "idle" || state === "dead") { reset(); state = "playing"; }
        else R.jump();
    });

    document.addEventListener("click", function (e) {
        if (e.target !== canvas && focused) { focused = false; canvas.style.outline = ""; }
    });

    document.addEventListener("keydown", function (e) {
        if (!focused) return;
        if (e.key === "ArrowUp" || e.key === " ") {
            e.preventDefault();
            if (state === "idle" || state === "dead") { reset(); state = "playing"; }
            else R.jump();
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (state === "playing") R.duck(true);
        }
    });

    document.addEventListener("keyup", function (e) {
        if (e.key === "ArrowDown") R.duck(false);
    });

    /* ── Watch for connection restore ── */
    const connLost = document.getElementById("connectionLost");
    if (connLost) {
        new MutationObserver(function (muts) {
            for (const m of muts) {
                if (m.attributeName === "style" &&
                    window.getComputedStyle(connLost).display === "none") {
                    focused = false;
                    canvas.style.outline = "";
                    reset();
                }
            }
        }).observe(connLost, { attributes: true, attributeFilter: ["style"] });
    }

    loop();
});