/*
    WebApp wave 4: utilities / developer / network apps.

    Smoke coverage for the remaining WebApps served by the real ArozOS
    server with an authenticated session:

        Calculator, Clock, Browser, Speedtest, Web Downloader,
        Web Builder, SQLite Admin, Terminal, AGIForge, AIChat, OTPAuth,
        Productivity, OnScreenKeyboard, Arozcast, Management Gateway,
        UnitTest, CronDemo, Serverless

    Each app must load its entry page and render its key UI element.
    Calculator additionally does a real end-to-end calculation through
    its own UI to prove interactivity, not just rendering.
*/
"use strict";

const h = require("../lib/system-harness");

const APPS = [
    { name: "Calculator", path: "/Calculator/index.html", selector: "#expression" },
    { name: "Clock", path: "/Clock/index.html", selector: "#panel-clock" },
    { name: "Browser", path: "/Browser/index.html", selector: "#urlbar" },
    { name: "Speedtest", path: "/Speedtest/index.html", selector: "#progressTrack" },
    { name: "Web Downloader", path: "/Web%20Downloader/index.html", selector: "#downloadbtn" },
    { name: "Web Builder", path: "/Web%20Builder/index.html", selector: "#editorFrame" },
    { name: "SQLite Admin", path: "/SQLite%20Admin/index.html", selector: "#btn-open-db" },
    { name: "Terminal", path: "/Terminal/index.html", selector: "#termOutput" },
    { name: "AGIForge", path: "/AGIForge/index.html", selector: "#convo" },
    { name: "AIChat", path: "/AIChat/index.html", selector: ".composer" },
    { name: "OTPAuth", path: "/OTPAuth/index.html", selector: "#sidebar" },
    { name: "Productivity", path: "/Productivity/index.html", selector: "#toolGrid" },
    { name: "OnScreenKeyboard", path: "/OnScreenKeyboard/index.html", selector: ".keyboard" },
    { name: "Arozcast", path: "/Arozcast/index.html", selector: "#app" },
    { name: "Management Gateway", path: "/Management%20Gateway/index.html", selector: "#mainframe" },
    { name: "UnitTest", path: "/UnitTest/index.html", selector: "#btnRunAll" },
    { name: "CronDemo", path: "/CronDemo/index.html", selector: "#status-card" },
    { name: "Serverless", path: "/Serverless/index.html", selector: "#global-stats" }
];

h.run("WEBAPPS-UTILITIES", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);
    page.on("dialog", function (d) { d.dismiss().catch(function () {}); });

    // ── 1. Every utility app boots and renders its main UI ──
    for (const app of APPS) {
        await page.goto(base + app.path, { waitUntil: "domcontentloaded" });
        try {
            await page.waitForSelector(app.selector, { state: "attached", timeout: 20000 });
        } catch (e) {
            h.fail(app.name + " did not render " + app.selector + " at " + app.path);
        }
        h.ok(app.name + " boots and renders its main UI");
    }

    // ── 2. Calculator performs a real calculation through its UI ──
    await page.goto(base + "/Calculator/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#result", { state: "attached", timeout: 20000 });
    // Buttons carry their glyph as text; click 7 + 8 = and read the result.
    async function clickKey(label) {
        await page.click("xpath=(//button[normalize-space(.)='" + label + "'])[1]");
    }
    await clickKey("7");
    await clickKey("+");
    await clickKey("8");
    await clickKey("=");
    await page.waitForFunction(function () {
        var r = document.getElementById("result");
        return r && r.textContent.replace(/[^0-9]/g, "").indexOf("15") !== -1;
    }, { timeout: 10000 }).catch(function () {
        h.fail("Calculator did not compute 7 + 8 = 15");
    });
    h.ok("Calculator computes 7 + 8 = 15 through its UI");

    await page.close();
});
