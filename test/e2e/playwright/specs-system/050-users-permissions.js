/*
    Critical path: user management and permission control.

    As administrator: create a limited permission group, create a user in
    it, then prove from a second browser context that the restricted user
    can sign in, sees only permitted modules and is refused by admin-only
    endpoints. Finally remove the user and the group and prove both are
    really gone (including that the removed user can no longer sign in).
*/
"use strict";

const h = require("../lib/system-harness");

const GROUP = "e2etesters";
const USER = "e2euser";
const PASS = "e2e-User-Passw0rd";

h.run("USERS-PERMISSIONS", async function (env) {
    const base = env.baseURL;
    const adminPage = await h.newPage(env.browser);
    await h.loginViaAPI(adminPage, base, env.admin.username, env.admin.password);

    // ── 1. Create a limited permission group ──
    let resp = await h.postForm(adminPage, base + "/system/permission/newgroup", {
        groupname: GROUP,
        permission: JSON.stringify(["Desktop", "File Manager"]),
        isAdmin: "false",
        defaultQuota: "1073741824",
        interfaceModule: "Desktop"
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("newgroup failed: " + resp);
    let groups = await h.getJSON(adminPage, base + "/system/permission/listgroup");
    if (JSON.stringify(groups).indexOf(GROUP) === -1) h.fail("new group missing from listgroup");
    h.ok("admin can create a limited permission group");

    // ── 2. Create a user inside that group ──
    resp = await h.postForm(adminPage, base + "/system/auth/register", {
        username: USER, password: PASS, group: GROUP
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("user creation failed: " + resp);
    let users = await h.getJSON(adminPage, base + "/system/users/list?noicon=true");
    const created = users.find(function (u) { return u[0] === USER; });
    if (!created) h.fail("new user missing from users list: " + JSON.stringify(users));
    if (created[1].indexOf(GROUP) === -1) h.fail("new user not in expected group: " + JSON.stringify(created));
    h.ok("admin can create a user in the limited group");

    // ── 3. The restricted user can sign in through the real form ──
    const userPage = await h.newPage(env.browser);
    await h.loginViaForm(userPage, base, USER, PASS);
    if (!(await h.isLoggedIn(userPage, base))) h.fail("restricted user form login failed");
    await userPage.goto(base + "/", { waitUntil: "domcontentloaded" });
    if (userPage.url().indexOf("desktop.html") === -1) {
        h.fail("restricted user did not land on the desktop: " + userPage.url());
    }
    h.ok("restricted user signs in and lands on the desktop");

    // ── 4. Module visibility is filtered by group permission ──
    const userModules = await h.getJSON(userPage, base + "/system/modules/list");
    const userModuleNames = userModules.map(function (m) { return m.Name; });
    if (userModuleNames.indexOf("File Manager") === -1) {
        h.fail("restricted user should see File Manager. Got: " + userModuleNames.join(", "));
    }
    if (userModuleNames.indexOf("System Setting") !== -1) {
        h.fail("restricted user must NOT see System Setting. Got: " + userModuleNames.join(", "));
    }
    h.ok("restricted user sees permitted modules only (no System Setting)");

    // ── 5. Admin-only endpoints refuse the restricted user ──
    resp = await h.postForm(userPage, base + "/system/permission/newgroup", {
        groupname: "should-not-exist",
        permission: JSON.stringify(["Desktop"]),
        isAdmin: "false",
        defaultQuota: "0",
        interfaceModule: "Desktop"
    });
    if (resp.toLowerCase().indexOf("ok") !== -1) h.fail("restricted user was allowed to create a group");
    resp = await h.postForm(userPage, base + "/system/users/removeUser", { username: env.admin.username });
    if (resp.toLowerCase().indexOf("ok") !== -1) h.fail("restricted user was allowed to remove a user");
    groups = await h.getJSON(adminPage, base + "/system/permission/listgroup");
    if (JSON.stringify(groups).indexOf("should-not-exist") !== -1) {
        h.fail("group created despite permission denial");
    }
    h.ok("admin-only endpoints refuse the restricted user");

    // ── 6. The restricted user cannot even list permission groups ──
    const userGroupsResp = await h.postForm(userPage, base + "/system/permission/listgroup", {});
    if (userGroupsResp.indexOf("administrator") !== -1) {
        h.fail("restricted user could read the permission group list");
    }
    h.ok("permission group listing is admin-only");
    await userPage.close();

    // ── 7. Admin removes the user; their login stops working ──
    resp = await h.postForm(adminPage, base + "/system/users/removeUser", { username: USER });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("removeUser failed: " + resp);
    users = await h.getJSON(adminPage, base + "/system/users/list?noicon=true");
    if (users && users.find && users.find(function (u) { return u[0] === USER; })) {
        h.fail("removed user still present in users list");
    }
    const ghostPage = await h.newPage(env.browser);
    const loginResp = await ghostPage.request.post(base + "/system/auth/login", {
        form: { username: USER, password: PASS, rmbme: "false" }
    });
    const loginBody = (await loginResp.text()).trim();
    if (await h.isLoggedIn(ghostPage, base)) h.fail("removed user can still sign in: " + loginBody);
    await ghostPage.close();
    h.ok("removed user disappears from the list and can no longer sign in");

    // ── 8. Admin deletes the permission group ──
    resp = await h.postForm(adminPage, base + "/system/permission/delgroup", { groupname: GROUP });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("delgroup failed: " + resp);
    groups = await h.getJSON(adminPage, base + "/system/permission/listgroup");
    if (JSON.stringify(groups).indexOf(GROUP) !== -1) h.fail("group still present after delgroup");
    h.ok("admin can delete the permission group");

    // ── 9. Administrator group is protected from deletion ──
    resp = await h.postForm(adminPage, base + "/system/permission/delgroup", { groupname: "administrator" });
    if (resp.toLowerCase().indexOf("ok") !== -1) h.fail("administrator group deletion was allowed!");
    h.ok("administrator group cannot be deleted");

    await adminPage.close();
});
