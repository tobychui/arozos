/*
    Critical path: sign in / sign out.

    Drives the real login.html form and the auth API against a live
    ArozOS server: page render, credential rejection, successful login,
    session persistence, auth-gated redirects and logout.
*/
"use strict";

const h = require("../lib/system-harness");

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

h.run("AUTH", async function (env) {
    const base = env.baseURL;
    const admin = env.admin;

    // ── 1. Login page renders with the expected form controls ──
    let page = await h.newPage(env.browser);
    await page.goto(base + "/login.html", { waitUntil: "domcontentloaded" });
    if (!(await page.isVisible("#username"))) h.fail("login page: username field not visible");
    if (!(await page.isVisible("#magic"))) h.fail("login page: password field not visible");
    if (!(await page.isVisible("#loginbtn"))) h.fail("login page: sign-in button not visible");
    h.ok("login page renders username/password fields and sign-in button");

    // ── 2. Auth-gated pages redirect anonymous visitors to login ──
    await page.goto(base + "/desktop.html", { waitUntil: "domcontentloaded" });
    if (page.url().indexOf("login.html") === -1) {
        h.fail("anonymous visit to desktop.html was not redirected to login.html (got " + page.url() + ")");
    }
    h.ok("anonymous visit to desktop.html redirects to the login page");

    // ── 3. Bogus credentials are rejected ──
    await page.goto(base + "/login.html", { waitUntil: "domcontentloaded" });
    await page.fill("#username", "no-such-user");
    await page.fill("#magic", "definitely-wrong");
    await page.click("#loginbtn");
    await sleep(1500); // give the form's ajax round-trip time to finish
    if (page.url().indexOf("login.html") === -1) h.fail("bogus credentials left the login page");
    if (await h.isLoggedIn(page, base)) h.fail("bogus credentials produced a session");
    h.ok("bogus credentials are rejected and no session is created");

    // ── 4. Real login through the form lands on the desktop ──
    await h.loginViaForm(page, base, admin.username, admin.password);
    if (!(await h.isLoggedIn(page, base))) h.fail("form login did not create a session");
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    if (page.url().indexOf("desktop.html") === -1) {
        h.fail("logged-in visit to / did not land on desktop.html (got " + page.url() + ")");
    }
    h.ok("form login succeeds and / lands on desktop.html");

    // ── 5. Session persists across pages in the same browser context ──
    const page2 = await page.context().newPage();
    await page2.goto(base + "/", { waitUntil: "domcontentloaded" });
    if (page2.url().indexOf("desktop.html") === -1) h.fail("session did not persist to a second page");
    await page2.close();
    h.ok("session persists across pages in the same context");

    // ── 6. Logout kills the session; auth-gated pages redirect again ──
    // Leave the desktop first so its background pollers cannot race the
    // logout and re-write the session cookie in the browser's jar.
    await page.goto("about:blank");
    await h.logout(page, base);
    if (await h.isLoggedIn(page, base)) h.fail("logout left the session alive");
    // Query param busts the browser HTTP cache - desktop.html was cached
    // during the logged-in visit and would otherwise never hit the server.
    await page.goto(base + "/desktop.html?after_logout=1", { waitUntil: "domcontentloaded" });
    if (page.url().indexOf("login.html") === -1) h.fail("post-logout visit to desktop.html did not land on login.html");
    h.ok("logout destroys the session and the desktop redirects to login again");
    await page.close();

    // ── 7. Wrong password for a real account (fresh context) ──
    page = await h.newPage(env.browser);
    const res = await page.request.post(base + "/system/auth/login", {
        form: { username: admin.username, password: "wrong-password", rmbme: "false" }
    });
    const body = (await res.text()).trim();
    if (await h.isLoggedIn(page, base)) h.fail("wrong password for real account produced a session");
    if (body.indexOf("error") === -1) h.fail("wrong-password login did not return an error: " + body);
    h.ok("wrong password for a real account is rejected");

    // The exponential login-delay counter now blocks this user/IP pair for
    // ~2s; wait it out, then confirm the correct password works again.
    await sleep(3000);
    await h.loginViaAPI(page, base, admin.username, admin.password);
    h.ok("correct password logs in again after the failed-attempt delay");

    // ── 8. checkLogin reflects the API session state ──
    if (!(await h.isLoggedIn(page, base))) h.fail("checkLogin false after API login");
    await h.logout(page, base);
    if (await h.isLoggedIn(page, base)) h.fail("checkLogin true after logout");
    h.ok("checkLogin correctly tracks login and logout");
    await page.close();
});
