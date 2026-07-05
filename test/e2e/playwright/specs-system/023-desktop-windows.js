/*
    Desktop: float windows + context menus.

    Covers the window-manager and right-click surfaces of the desktop:

      - launching a module through openModule spawns a float window
      - newFloatWindow creates windows with a taskbar entry
      - focus brings a window to the front (z-index ordering)
      - maximize / restore toggles the window's max state
      - minimize hides the window; the close button destroys it
      - right-clicking the wallpaper shows the desktop context menu
      - right-clicking a desktop icon shows the icon context menu

    Window internals are driven through the app's own global functions
    and real button clicks, so the actual desktop.html logic runs.
*/
"use strict";

const h = require("../lib/system-harness");

const SC_NAME = "e2e-win-shortcut";
const SC_FILE = "user:/Desktop/" + SC_NAME + ".shortcut";

async function openDesktop(page, base) {
    await page.goto(base + "/desktop.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#bgwrapper", { state: "visible", timeout: 20000 });
    await page.waitForFunction(function () {
        return typeof window.newFloatWindow === "function" &&
            Array.isArray(window.moduleInstalled) && window.moduleInstalled.length > 0;
    }, { timeout: 20000 });
    await page.waitForFunction(function () {
        return document.querySelectorAll("#bgwrapper .backgroundFrame").length > 0;
    }, { timeout: 20000 });
}

h.run("DESKTOP-WINDOWS", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // Seed a desktop shortcut for the icon context-menu test.
    let resp = await h.postForm(page, base + "/system/desktop/createShortcut", {
        stype: "module", stext: SC_NAME, spath: "Dummy/index.html", sicon: "img/system/favicon.png"
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not seed desktop shortcut: " + resp);

    await openDesktop(page, base);

    // ── 1. Launch a real module through the desktop launcher ──
    await page.evaluate(function () { openModule("Calculator"); });
    await page.waitForFunction(function () {
        var titles = document.querySelectorAll(".floatWindow .controls .title");
        for (var i = 0; i < titles.length; i++) {
            if (titles[i].textContent.indexOf("Calculator") !== -1) return true;
        }
        return false;
    }, { timeout: 20000 });
    h.ok("openModule launches a module into a float window");
    // A taskbar button was registered for it.
    const hasTaskbarBtn = await page.evaluate(function () {
        return document.querySelectorAll(".floatWindowButton").length > 0;
    });
    if (!hasTaskbarBtn) h.fail("launching a module did not add a taskbar button");
    h.ok("the launched module gets a taskbar button");

    // ── 2. newFloatWindow creates windows deterministically ──
    await page.evaluate(function () {
        newFloatWindow({ uid: "e2ewinA", url: "about:blank", title: "E2E Window A", left: 120, top: 120 });
        newFloatWindow({ uid: "e2ewinB", url: "about:blank", title: "E2E Window B", left: 260, top: 200 });
    });
    await page.waitForSelector(".floatWindow[windowId='e2ewinA']", { timeout: 10000 });
    await page.waitForSelector(".floatWindow[windowId='e2ewinB']", { timeout: 10000 });
    h.ok("newFloatWindow creates two addressable float windows");

    function zIndexOf(id) {
        return page.evaluate(function (wid) {
            var el = document.querySelector(".floatWindow[windowId='" + wid + "']");
            return parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
        }, id);
    }

    // ── 3. Focus brings a window to the front ──
    // B was created last, so it starts above A.
    if (!((await zIndexOf("e2ewinB")) >= (await zIndexOf("e2ewinA")))) {
        h.fail("the last-created window should start on top");
    }
    // Focus A by mousedown on its drag bar; it must rise above B.
    await page.dispatchEvent(".floatWindow[windowId='e2ewinA'] .fwdragger", "mousedown", { button: 0, which: 1 });
    await page.waitForFunction(function () {
        function z(id) {
            var el = document.querySelector(".floatWindow[windowId='" + id + "']");
            return parseInt(window.getComputedStyle(el).zIndex, 10) || 0;
        }
        return z("e2ewinA") > z("e2ewinB");
    }, { timeout: 10000 });
    h.ok("focusing a window brings it above the others (z-index)");

    // ── 4. Maximize / restore ──
    await page.click(".floatWindow[windowId='e2ewinA'] .maxtoggle");
    await page.waitForFunction(function () {
        var el = document.querySelector(".floatWindow[windowId='e2ewinA']");
        return el && el.getAttribute("max") === "true";
    }, { timeout: 10000 });
    h.ok("maximize sets the window into its maximized state");
    await page.click(".floatWindow[windowId='e2ewinA'] .maxtoggle");
    await page.waitForFunction(function () {
        var el = document.querySelector(".floatWindow[windowId='e2ewinA']");
        return el && el.getAttribute("max") === "false";
    }, { timeout: 10000 });
    h.ok("restore returns the window to its normal state");

    // ── 5. Minimize hides the window ──
    await page.click(".floatWindow[windowId='e2ewinA'] .mintoggle");
    await page.waitForFunction(function () {
        var el = document.querySelector(".floatWindow[windowId='e2ewinA']");
        return el && window.getComputedStyle(el).display === "none";
    }, { timeout: 10000 });
    h.ok("minimize hides the window from the desktop");

    // ── 6. Close destroys the windows ──
    // A is hidden; close it via its own control, then close B.
    await page.evaluate(function () {
        closeFloatWindow($(".floatWindow[windowId='e2ewinA'] .closetoggle")[0], null);
    });
    await page.click(".floatWindow[windowId='e2ewinB'] .closetoggle");
    await page.waitForFunction(function () {
        return document.querySelectorAll(".floatWindow[windowId='e2ewinA'], .floatWindow[windowId='e2ewinB']").length === 0;
    }, { timeout: 10000 });
    h.ok("closing a window removes it from the desktop");

    // ── 7. Wallpaper right-click shows the desktop context menu ──
    await page.evaluate(function () {
        var bf = document.querySelector("#bgwrapper .backgroundFrame");
        bf.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 400, clientY: 320 }));
    });
    await page.waitForFunction(function () {
        var m = document.getElementById("contextmenu");
        return m && window.getComputedStyle(m).display !== "none" &&
            m.textContent.indexOf("Refresh") !== -1 &&
            m.textContent.indexOf("File Manager") !== -1;
    }, { timeout: 10000 });
    h.ok("right-clicking the wallpaper opens the desktop context menu");
    // Dismiss it.
    await page.evaluate(function () { if (typeof hideAllContextMenus === "function") hideAllContextMenus(); });

    // ── 8. Icon right-click shows the icon context menu ──
    await page.waitForFunction(function (name) {
        var icons = document.querySelectorAll(".launchIcon");
        for (var i = 0; i < icons.length; i++) {
            if (icons[i].textContent.indexOf(name) !== -1) return true;
        }
        return false;
    }, SC_NAME, { timeout: 20000 });
    await page.evaluate(function (name) {
        var icons = document.querySelectorAll(".launchIcon");
        for (var i = 0; i < icons.length; i++) {
            if (icons[i].textContent.indexOf(name) !== -1) {
                icons[i].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
                return;
            }
        }
    }, SC_NAME);
    await page.waitForFunction(function () {
        var m = document.getElementById("contextmenu");
        return m && window.getComputedStyle(m).display !== "none" &&
            m.textContent.indexOf("Open") !== -1 && m.textContent.indexOf("Delete") !== -1;
    }, { timeout: 10000 });
    h.ok("right-clicking a desktop icon opens the icon context menu");

    // ── Cleanup ──
    const csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete", src: JSON.stringify([SC_FILE]), csrft: csrft
    });
    await page.close();
});
