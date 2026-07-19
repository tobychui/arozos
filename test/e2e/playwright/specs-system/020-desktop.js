/*
    Critical path: desktop shell.

    Loads the real desktop.html as an authenticated user and checks the
    shell furniture (wallpaper layer, task bar), the start/list menu with
    its module launcher entries, the quick-access panel user identity,
    the desktop APIs and the sign-out button.
*/
"use strict";

const h = require("../lib/system-harness");

h.run("DESKTOP", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // ── 1. Desktop shell loads ──
    await page.goto(base + "/desktop.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#bgwrapper", { state: "visible", timeout: 20000 });
    await page.waitForSelector("#navimenu", { state: "visible", timeout: 20000 });
    h.ok("desktop shell renders wallpaper layer and task bar");

    // ── 2. Desktop APIs answer for the logged-in user ──
    const userInfo = await h.getJSON(page, base + "/system/desktop/user");
    const userInfoStr = JSON.stringify(userInfo);
    if (userInfoStr.indexOf(env.admin.username) === -1) {
        h.fail("/system/desktop/user does not mention the logged-in user: " + userInfoStr);
    }
    h.ok("/system/desktop/user identifies the logged-in user");

    const hostInfo = await h.getJSON(page, base + "/system/desktop/host");
    if (JSON.stringify(hostInfo).indexOf("E2E ArozOS") === -1) {
        h.fail("/system/desktop/host does not carry the configured hostname: " + JSON.stringify(hostInfo));
    }
    h.ok("/system/desktop/host reports the configured hostname");

    // ── 3. Module list includes the critical built-ins ──
    const modules = await h.getJSON(page, base + "/system/modules/list");
    const moduleNames = modules.map(function (m) { return m.Name; });
    ["System Setting", "File Manager", "Desktop"].forEach(function (name) {
        if (moduleNames.indexOf(name) === -1) {
            h.fail("module list missing '" + name + "'. Got: " + moduleNames.join(", "));
        }
    });
    h.ok("module list includes Desktop, File Manager and System Setting");

    // ── 4. Start (list) menu opens and offers module entries ──
    await page.click('#navimenu div.item[onclick*="toggleListMenu"]');
    await page.waitForSelector("#listMenu", { state: "visible", timeout: 10000 });
    await page.waitForFunction(function () {
        var holder = document.getElementById("listMenuItem");
        return holder && holder.children.length > 0;
    }, { timeout: 15000 });
    if (!(await page.isVisible("#searchBar"))) h.fail("start menu search bar not visible");
    h.ok("start menu opens with module entries and a search bar");
    // Close it again so it does not overlap the quick access panel.
    await page.click('#navimenu div.item[onclick*="toggleListMenu"]');

    // ── 5. Quick access panel shows the user identity ──
    await page.click('#navimenu div.item[onclick*="showToolPanel"]');
    await page.waitForSelector("#quickAccessPanel", { state: "visible", timeout: 10000 });
    await page.waitForFunction(function (uname) {
        var el = document.getElementById("username");
        return el && el.textContent.trim().toLowerCase().indexOf(uname) !== -1;
    }, env.admin.username.toLowerCase(), { timeout: 10000 });
    h.ok("quick access panel shows the logged-in username");

    // ── 6. Sign out from the desktop UI ──
    // The desktop logout() asks with a native confirm() dialog first.
    page.on("dialog", function (dialog) { dialog.accept(); });
    await page.click("#logoutBtn");
    await page.waitForURL(function (url) { return url.pathname.indexOf("desktop.html") === -1; }, { timeout: 20000 });
    if (await h.isLoggedIn(page, base)) h.fail("desktop logout button left the session alive");
    h.ok("desktop sign-out button ends the session and leaves the desktop");

    await page.close();
});
