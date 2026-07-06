/*
    Critical path: account self-management (password change).

    Exercises the "My Account" flow end to end on a dedicated throwaway
    user (so the shared admin credentials the other specs rely on stay
    intact): the account settings UI renders, userinfo reports identity,
    a wrong old password is refused, a correct change succeeds, and
    afterwards only the new password can sign in.
*/
"use strict";

const h = require("../lib/system-harness");

const USER = "e2eaccount";
const OLD_PASS = "e2e-Old-Passw0rd";
const NEW_PASS = "e2e-New-Passw0rd";

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

h.run("ACCOUNT", async function (env) {
    const base = env.baseURL;

    // Admin creates the throwaway account.
    const adminPage = await h.newPage(env.browser);
    await h.loginViaAPI(adminPage, base, env.admin.username, env.admin.password);
    let resp = await h.postForm(adminPage, base + "/system/auth/register", {
        username: USER, password: OLD_PASS, group: "administrator"
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not create test account: " + resp);
    h.ok("admin creates a throwaway account for the password-change test");

    // The user signs in and opens their account settings page.
    const userPage = await h.newPage(env.browser);
    await h.loginViaAPI(userPage, base, USER, OLD_PASS);
    await userPage.goto(base + "/SystemAO/users/account.html", { waitUntil: "domcontentloaded" });
    await userPage.waitForSelector("#heroAvatar", { state: "attached", timeout: 20000 });
    h.ok("account settings page renders for the signed-in user");

    // userinfo reports this user's identity.
    const info = await h.getJSON(userPage, base + "/system/users/userinfo");
    if (JSON.stringify(info).indexOf(USER) === -1) {
        h.fail("userinfo did not report the signed-in user: " + JSON.stringify(info).slice(0, 200));
    }
    h.ok("userinfo reports the signed-in user's identity");

    // ── Wrong old password is refused ──
    resp = await h.postForm(userPage, base + "/system/users/userinfo", {
        opr: "changepw", oldpw: "not-the-old-password", newpw: NEW_PASS
    });
    if (resp.toLowerCase().indexOf("error") === -1) {
        h.fail("password change with a wrong old password was not refused: " + resp);
    }
    h.ok("password change with a wrong old password is refused");

    // ── Correct old password changes the password ──
    resp = await h.postForm(userPage, base + "/system/users/userinfo", {
        opr: "changepw", oldpw: OLD_PASS, newpw: NEW_PASS
    });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("valid password change failed: " + resp);
    h.ok("password change with the correct old password succeeds");

    // ── The old password no longer signs in ──
    const probe = await h.newPage(env.browser);
    const oldLogin = await probe.request.post(base + "/system/auth/login", {
        form: { username: USER, password: OLD_PASS, rmbme: "false" }
    });
    await oldLogin.text();
    if (await h.isLoggedIn(probe, base)) h.fail("the old password still signs in after the change");
    h.ok("the old password no longer signs in");

    // A failed login throttles this user/IP for ~2s; wait it out, then the
    // new password must work.
    await sleep(3000);
    await h.loginViaAPI(probe, base, USER, NEW_PASS);
    if (!(await h.isLoggedIn(probe, base))) h.fail("the new password does not sign in");
    h.ok("the new password signs in");
    await probe.close();
    await userPage.close();

    // ── Cleanup: admin removes the throwaway account ──
    resp = await h.postForm(adminPage, base + "/system/users/removeUser", { username: USER });
    if (resp.toLowerCase().indexOf("ok") === -1) h.fail("could not remove test account: " + resp);
    h.ok("admin removes the throwaway account");
    await adminPage.close();
});
