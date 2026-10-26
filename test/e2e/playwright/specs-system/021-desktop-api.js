/*
    Desktop: backend API surface.

    Exercises every endpoint registered by DesktopInit in src/desktop.go,
    driving the exact request shapes the desktop.html front end uses:

      /system/desktop/host            host / device details
      /system/desktop/user            self info (quota, groups, admin),
                                       another user's public info, noicon
      /system/desktop/theme           list wallpapers, set + read back
      /system/desktop/preference      set / get / remove a preference key
      /system/desktop/files           icon location set / get / delete
      /system/desktop/createShortcut  create a .shortcut on the desktop
      /system/desktop/listDesktop     list desktop objects + shortcut meta
      /system/desktop/opr/renameShortcut  rename it, and reject off-desktop

    All backend, so this is the deterministic backbone of the desktop
    coverage; the UI specs (022, 023) drive the same features visually.
*/
"use strict";

const h = require("../lib/system-harness");

const OTHER_USER = "e2edeskother";
const OTHER_PASS = "e2e-Other-Pass1";
const SC_NAME = "e2e-shortcut";
const SC_FILE = "user:/Desktop/" + SC_NAME + ".shortcut";

h.run("DESKTOP-API", async function (env) {
    const base = env.baseURL;
    const page = await h.newPage(env.browser);
    await h.loginViaAPI(page, base, env.admin.username, env.admin.password);

    // ── 1. /host reports device details ──
    const host = await h.getJSON(page, base + "/system/desktop/host");
    ["Hostname", "DeviceUUID", "BuildVersion", "InternalVersion"].forEach(function (k) {
        if (!(k in host)) h.fail("/system/desktop/host missing field " + k);
    });
    if (host.Hostname.indexOf("E2E ArozOS") === -1) {
        h.fail("/system/desktop/host wrong hostname: " + host.Hostname);
    }
    h.ok("/host returns hostname, device UUID and version fields");

    // ── 2. /user reports the signed-in user's profile ──
    const me = await h.getJSON(page, base + "/system/desktop/user");
    if (me.Username !== env.admin.username) h.fail("/user wrong username: " + me.Username);
    if (me.IsAdmin !== true) h.fail("/user should mark the admin account as admin");
    if (!Array.isArray(me.UserGroups) || me.UserGroups.indexOf("administrator") === -1) {
        h.fail("/user should list the administrator group: " + JSON.stringify(me.UserGroups));
    }
    if (typeof me.StorageQuotaTotal !== "number") h.fail("/user missing StorageQuotaTotal");
    h.ok("/user reports username, admin flag, groups and storage quota");

    // noicon=true (POST param) strips the (potentially large) icon payload.
    const meNoIcon = JSON.parse(await h.postForm(page, base + "/system/desktop/user", { noicon: "true" }));
    if (meNoIcon.UserIcon !== "") h.fail("/user noicon=true should return an empty UserIcon");
    h.ok("/user with noicon=true omits the icon payload");

    // Another user's *public* info via ?target= (create one, query, remove).
    let resp = await h.postForm(page, base + "/system/auth/register", {
        username: OTHER_USER, password: OTHER_PASS, group: "user"
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not create second user: " + resp);
    const other = await h.getJSON(page, base + "/system/desktop/user?target=" + encodeURIComponent(OTHER_USER));
    if (other.Username !== OTHER_USER) h.fail("/user?target did not return the target user");
    if (other.IsAdmin !== false) h.fail("/user?target should not mark a plain user as admin");
    h.ok("/user?target returns another user's public info");
    const missing = await page.request.get(base + "/system/desktop/user?target=nosuchuser____");
    if ((await missing.text()).toLowerCase().indexOf("error") === -1) {
        h.fail("/user?target for a missing user should error");
    }
    h.ok("/user?target for a non-existent user returns an error");

    // ── 3. /theme lists wallpapers and round-trips the user's choice ──
    const themes = await h.getJSON(page, base + "/system/desktop/theme");
    if (!Array.isArray(themes) || themes.length === 0) h.fail("/theme returned no wallpaper themes");
    if (!("Theme" in themes[0]) || !("Bglist" in themes[0])) {
        h.fail("/theme entries missing Theme/Bglist fields: " + JSON.stringify(themes[0]));
    }
    h.ok("/theme lists wallpaper themes with their backgrounds");

    const chosen = themes[0].Theme;
    const setThemeResp = (await (await page.request.get(base + "/system/desktop/theme?set=" +
        encodeURIComponent(chosen))).text()).trim();
    if (setThemeResp.replace(/"/g, "").toLowerCase() !== "ok") h.fail("/theme?set failed: " + setThemeResp);
    const gotTheme = (await (await page.request.get(base + "/system/desktop/theme?get=true")).text()).trim();
    if (gotTheme.replace(/"/g, "") !== chosen) {
        h.fail("/theme?get did not return the theme just set (" + gotTheme + " != " + chosen + ")");
    }
    h.ok("/theme?set then ?get round-trips the selected wallpaper theme");

    // ── 4. /preference set / get / remove ──
    const prefKey = "e2e_pref";
    const prefVal = "value-" + Date.now();
    resp = await h.postForm(page, base + "/system/desktop/preference", { preference: prefKey, value: prefVal });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("preference set failed: " + resp);
    let gotPref = JSON.parse(await h.postForm(page, base + "/system/desktop/preference", { preference: prefKey }));
    if (gotPref !== prefVal) h.fail("preference get did not return the stored value: " + gotPref);
    h.ok("/preference stores and returns a preference value");
    resp = await h.postForm(page, base + "/system/desktop/preference", { preference: prefKey, remove: "true" });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("preference remove failed: " + resp);
    gotPref = JSON.parse(await h.postForm(page, base + "/system/desktop/preference", { preference: prefKey }));
    if (gotPref !== "") h.fail("preference should be empty after removal, got: " + gotPref);
    h.ok("/preference removes a preference key");

    // ── 5. createShortcut puts a .shortcut on the desktop ──
    resp = await h.postForm(page, base + "/system/desktop/createShortcut", {
        stype: "module", stext: SC_NAME, spath: "Dummy/index.html", sicon: "img/system/favicon.png"
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("createShortcut failed: " + resp);
    h.ok("/createShortcut writes a shortcut file to the desktop");

    // ── 6. listDesktop reports the shortcut with parsed metadata ──
    let desktop = await h.getJSON(page, base + "/system/desktop/listDesktop");
    let sc = desktop.filter(function (o) { return o.Filename === SC_NAME + ".shortcut"; })[0];
    if (!sc) h.fail("listDesktop did not include the created shortcut");
    if (!sc.IsShortcut || sc.ShortcutType !== "module" || sc.ShortcutName !== SC_NAME) {
        h.fail("listDesktop shortcut metadata wrong: " + JSON.stringify(sc));
    }
    h.ok("/listDesktop returns the shortcut with IsShortcut + parsed name/type");

    // ── 7. icon location set / get / delete via /files ──
    resp = await h.postForm(page, base + "/system/desktop/files", {
        set: SC_NAME + ".shortcut", x: "123", y: "456"
    });
    if (resp.replace(/"/g, "").toLowerCase() !== "ok") h.fail("/files set location failed: " + resp);
    const loc = JSON.parse(await h.postForm(page, base + "/system/desktop/files", { get: SC_NAME + ".shortcut" }));
    if (loc[0] !== 123 || loc[1] !== 456) h.fail("/files get returned wrong location: " + JSON.stringify(loc));
    h.ok("/files stores and returns a desktop icon coordinate");
    await h.postForm(page, base + "/system/desktop/files", { del: SC_NAME + ".shortcut" });
    const locGone = JSON.parse(await h.postForm(page, base + "/system/desktop/files", { get: SC_NAME + ".shortcut" }));
    if (locGone[0] !== -1 || locGone[1] !== -1) h.fail("/files del did not clear the location: " + JSON.stringify(locGone));
    h.ok("/files deletes a desktop icon coordinate");

    // ── 8. renameShortcut updates the shortcut's display name ──
    const newName = "e2e-renamed";
    resp = (await (await page.request.get(base + "/system/desktop/opr/renameShortcut?src=" +
        encodeURIComponent(SC_FILE) + "&new=" + encodeURIComponent(newName))).text()).trim();
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("renameShortcut failed: " + resp);
    desktop = await h.getJSON(page, base + "/system/desktop/listDesktop");
    sc = desktop.filter(function (o) { return o.Filename === SC_NAME + ".shortcut"; })[0];
    if (!sc || sc.ShortcutName !== newName) {
        h.fail("renameShortcut did not update the display name: " + JSON.stringify(sc));
    }
    h.ok("/opr/renameShortcut updates the shortcut display name");

    // Off-desktop rename must be refused.
    const badRename = (await (await page.request.get(base + "/system/desktop/opr/renameShortcut?src=" +
        encodeURIComponent("user:/Documents/whatever.shortcut") + "&new=x")).text()).trim();
    if (badRename.toLowerCase().indexOf("error") === -1) {
        h.fail("renameShortcut on a non-desktop path should be refused: " + badRename);
    }
    h.ok("/opr/renameShortcut refuses a path outside the desktop");

    // ── Cleanup ──
    const csrft = await h.csrfToken(page, base);
    await h.postForm(page, base + "/system/file_system/fileOpr", {
        opr: "delete", src: JSON.stringify([SC_FILE]), csrft: csrft
    });
    await h.postForm(page, base + "/system/users/removeUser", { username: OTHER_USER });

    await page.close();
});
