/*
    Critical path: system settings.

    Opens the real System Setting web UI as the administrator, verifies
    the settings catalogue API (including admin-only module filtering)
    and the host information endpoint that the settings pages rely on.
*/
"use strict";

const h = require("../lib/system-harness");

h.run("SYSTEM-SETTINGS", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // ── 1. Settings UI renders its shell and populates the card grid ──
    await page.goto(base + "/SystemAO/system_setting/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#app", { state: "visible", timeout: 20000 });
    await page.waitForSelector("#sidebar", { state: "attached", timeout: 20000 });
    await page.waitForFunction(function () {
        var grid = document.getElementById("card-grid");
        return grid && grid.children.length > 0;
    }, { timeout: 20000 });
    h.ok("System Setting UI renders and loads setting groups");

    // ── 2. Setting group catalogue contains the critical groups ──
    const groups = await h.getJSON(page, base + "/system/setting/list");
    const groupStr = JSON.stringify(groups);
    ["Users", "Security", "Info"].forEach(function (g) {
        if (groupStr.indexOf('"' + g + '"') === -1) {
            h.fail("setting group '" + g + "' missing from /system/setting/list: " + groupStr.slice(0, 400));
        }
    });
    h.ok("setting catalogue includes the Users, Security and Info groups");

    // ── 3. Admin sees the admin-only user management modules ──
    const userGroupModules = await h.getJSON(page, base + "/system/setting/list?listGroup=Users");
    const moduleNames = userGroupModules.map(function (m) { return m.Name; });
    ["User List", "Permission Groups"].forEach(function (name) {
        if (moduleNames.indexOf(name) === -1) {
            h.fail("admin should see '" + name + "' in the Users group. Got: " + moduleNames.join(", "));
        }
    });
    h.ok("admin sees User List and Permission Groups setting modules");

    // ── 4. Host information endpoint feeds the settings pages ──
    const arozInfo = await h.getJSON(page, base + "/system/info/getArOZInfo");
    if (!arozInfo.HostName || arozInfo.HostName.indexOf("E2E ArozOS") === -1) {
        h.fail("getArOZInfo HostName unexpected: " + JSON.stringify(arozInfo));
    }
    h.ok("getArOZInfo reports the configured host name");

    // ── 5. Permission group listing works for the administrator ──
    const permGroups = await h.getJSON(page, base + "/system/permission/listgroup");
    if (JSON.stringify(permGroups).indexOf("administrator") === -1) {
        h.fail("listgroup does not include the administrator group: " + JSON.stringify(permGroups));
    }
    h.ok("permission group listing includes the administrator group");

    await page.close();
});
