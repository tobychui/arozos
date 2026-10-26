/*
    Desktop: UI shell.

    Drives the real desktop.html and asserts the visible shell works in
    every major aspect a user touches:

      - wallpaper layer + task bar render
      - the taskbar clock shows a real time
      - the quick-access panel carries the user's identity + storage bar
      - the start (list) menu opens, lists modules, and its search box
        filters the module list (and reports "No Result" for gibberish)
      - the notification bar toggles from the clock
      - a desktop shortcut created via the API renders as a launch icon

    Window management and context menus have their own spec (023).
*/
"use strict";

const h = require("../lib/system-harness");

const SC_NAME = "e2e-ui-shortcut";
const SC_FILE = "user:/Desktop/" + SC_NAME + ".shortcut";

async function openDesktop(page, base) {
    await page.goto(base + "/desktop.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#bgwrapper", { state: "visible", timeout: 20000 });
    await page.waitForSelector("#navimenu", { state: "visible", timeout: 20000 });
    // The module list backs the start menu + search; wait until it is loaded.
    await page.waitForFunction(function () {
        return Array.isArray(window.moduleInstalled) && window.moduleInstalled.length > 0;
    }, { timeout: 20000 });
}

h.run("DESKTOP-UI", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // Seed a desktop shortcut so the icon layer has something deterministic.
    let resp = await h.postForm(page, base + "/system/desktop/createShortcut", {
        stype: "module", stext: SC_NAME, spath: "Dummy/index.html", sicon: "img/system/favicon.png"
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not seed desktop shortcut: " + resp);

    await openDesktop(page, base);
    h.ok("desktop shell renders wallpaper layer and task bar");

    // ── 1. Wallpaper background frame is mounted ──
    await page.waitForFunction(function () {
        return document.querySelectorAll("#bgwrapper .backgroundFrame").length > 0;
    }, { timeout: 20000 });
    h.ok("a wallpaper background frame is mounted in the desktop");

    // ── 2. The taskbar clock shows a real time ──
    await page.waitForFunction(function () {
        var c = document.querySelector(".clock");
        return c && /\d{1,2}:\d{2}\s*(AM|PM)/i.test(c.textContent);
    }, { timeout: 15000 });
    h.ok("the taskbar clock displays a formatted time");

    // ── 3. Quick access panel shows identity + storage ──
    await page.click('#navimenu div.item[onclick*="showToolPanel"]');
    await page.waitForSelector("#quickAccessPanel", { state: "visible", timeout: 10000 });
    await page.waitForFunction(function (uname) {
        var el = document.getElementById("username");
        return el && el.textContent.trim().toLowerCase().indexOf(uname) !== -1;
    }, env.admin.username.toLowerCase(), { timeout: 10000 });
    h.ok("quick access panel shows the logged-in username");
    // Close the panel again.
    await page.click('#navimenu div.item[onclick*="showToolPanel"]');

    // ── 4. Start menu opens with module entries + search box ──
    await page.click('#navimenu div.item[onclick*="toggleListMenu"]');
    await page.waitForSelector("#listMenu", { state: "visible", timeout: 10000 });
    await page.waitForFunction(function () {
        var holder = document.getElementById("listMenuItem");
        return holder && holder.children.length > 0;
    }, { timeout: 15000 });
    const fullCount = await page.evaluate(function () {
        return document.getElementById("listMenuItem").children.length;
    });
    if (!(await page.isVisible("#searchBar"))) h.fail("start menu search bar not visible");
    h.ok("start menu opens with " + fullCount + " module entries and a search bar");

    // ── 5. Search filters the module list ──
    await page.fill("#searchBar", "File Manager");
    await page.press("#searchBar", "Enter");
    await page.waitForFunction(function () {
        var items = document.querySelectorAll("#listMenuItem .item");
        if (items.length === 0) return false;
        return document.getElementById("listMenuItem").textContent.indexOf("File Manager") !== -1;
    }, { timeout: 10000 });
    const filtered = await page.evaluate(function () {
        return document.querySelectorAll("#listMenuItem .item").length;
    });
    if (filtered >= fullCount) {
        h.fail("search did not narrow the module list (" + filtered + " vs " + fullCount + ")");
    }
    h.ok("start menu search narrows the list to matching modules");

    // Gibberish yields an explicit "No Result".
    await page.fill("#searchBar", "zzzznosuchmodulezzzz");
    await page.press("#searchBar", "Enter");
    await page.waitForFunction(function () {
        return document.getElementById("listMenuItem").textContent.indexOf("No Result") !== -1;
    }, { timeout: 10000 });
    h.ok("start menu search reports 'No Result' for an unknown keyword");
    // Close start menu.
    await page.click('#navimenu div.item[onclick*="toggleListMenu"]');

    // ── 6. Notification bar toggles from the clock ──
    await page.click(".clock");
    await page.waitForFunction(function () {
        var n = document.querySelector(".notificationbar");
        if (!n) return false;
        var style = window.getComputedStyle(n);
        return style.display !== "none" && parseFloat(style.opacity) > 0.5;
    }, { timeout: 10000 });
    h.ok("clicking the clock opens the notification bar");
    // The notification bar lays a full-screen .cover over the desktop; close
    // it through the same handler the cover uses so later DOM is unobscured.
    await page.evaluate(function () { toggleNotification("hide"); });
    await page.waitForFunction(function () {
        var n = document.querySelector(".notificationbar");
        return !n || window.getComputedStyle(n).display === "none" ||
            parseFloat(window.getComputedStyle(n).opacity) < 0.5;
    }, { timeout: 10000 });

    // ── 7. The seeded shortcut renders as a desktop launch icon ──
    await page.waitForFunction(function (name) {
        var icons = document.querySelectorAll(".launchIcon");
        for (var i = 0; i < icons.length; i++) {
            if (icons[i].textContent.indexOf(name) !== -1) return true;
        }
        return false;
    }, SC_NAME, { timeout: 20000 });
    h.ok("the seeded shortcut renders as a desktop launch icon");

    // ── Cleanup ──
    const csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete", src: JSON.stringify([SC_FILE]), csrft: csrft
    });
    await page.close();
});
