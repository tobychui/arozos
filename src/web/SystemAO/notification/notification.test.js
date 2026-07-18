/*
    notification.test.js

    Unit tests for the pure helper logic in notification.js. Runs in two ways:
      - In the browser via tests.html (results rendered on the page).
      - Under Node.js:  node notification.test.js   (exit code 1 on failure).

    A tiny zero-dependency assertion harness is used so the tests can run in the
    sandboxed ArozOS webapp environment without any test framework.
*/
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory(require("./notification.js"));
    } else {
        root.NotificationTests = factory(root.NotificationUI);
    }
})(typeof self !== "undefined" ? self : this, function (NotificationUI) {
    "use strict";

    var results = [];

    function assert(condition, message) {
        results.push({ pass: !!condition, message: message });
    }
    function eq(actual, expected, message) {
        assert(actual === expected, message + " (got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected) + ")");
    }
    function deepEq(actual, expected, message) {
        assert(JSON.stringify(actual) === JSON.stringify(expected),
            message + " (got " + JSON.stringify(actual) + ", want " + JSON.stringify(expected) + ")");
    }

    function run() {
        results = [];
        var N = NotificationUI;

        // priorityToInt
        eq(N.priorityToInt("low"), 1, "priorityToInt low");
        eq(N.priorityToInt("MEDIUM"), 2, "priorityToInt medium case-insensitive");
        eq(N.priorityToInt("high"), 3, "priorityToInt high");
        eq(N.priorityToInt("bogus"), 2, "priorityToInt unknown falls back to medium");
        eq(N.priorityToInt(""), 2, "priorityToInt empty falls back to medium");

        // priorityToLabel
        eq(N.priorityToLabel(1), "low", "priorityToLabel 1");
        eq(N.priorityToLabel(2), "medium", "priorityToLabel 2");
        eq(N.priorityToLabel(3), "high", "priorityToLabel 3");
        eq(N.priorityToLabel(99), "medium", "priorityToLabel unknown -> medium");

        // iconForPriority (no emoji, semantic icon names)
        eq(N.iconForPriority("high"), "exclamation circle", "iconForPriority high");
        eq(N.iconForPriority("low"), "info circle", "iconForPriority low");
        eq(N.iconForPriority(2), "bell", "iconForPriority numeric medium");

        // escapeHtml
        eq(N.escapeHtml("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;", "escapeHtml escapes special chars");
        eq(N.escapeHtml(null), "", "escapeHtml null -> empty");

        // isValidWebhookURL
        assert(N.isValidWebhookURL("https://example.com/hook"), "isValidWebhookURL https");
        assert(N.isValidWebhookURL("http://localhost:9000/x"), "isValidWebhookURL http with port");
        assert(!N.isValidWebhookURL("ftp://example.com"), "isValidWebhookURL rejects ftp");
        assert(!N.isValidWebhookURL("not a url"), "isValidWebhookURL rejects garbage");
        assert(!N.isValidWebhookURL(""), "isValidWebhookURL rejects empty");
        assert(!N.isValidWebhookURL("https://"), "isValidWebhookURL rejects missing host");

        // buildPreferencePayload
        var payload = N.buildPreferencePayload({
            enabledAgents: { desktop: true, telegram: false },
            minPriority: 3,
            telegramChatID: 123,
            webhookURL: "https://x.io/h"
        });
        eq(payload.enabledAgents, '{"desktop":true,"telegram":false}', "buildPreferencePayload serialises agents");
        eq(payload.minPriority, "high", "buildPreferencePayload numeric priority -> label");
        eq(payload.telegramChatID, "123", "buildPreferencePayload stringifies chat id");
        eq(payload.webhookURL, "https://x.io/h", "buildPreferencePayload carries webhook url");

        var payload2 = N.buildPreferencePayload({ enabledAgents: {}, minPriority: "medium" });
        eq(payload2.minPriority, "medium", "buildPreferencePayload textual priority preserved");
        assert(payload2.telegramChatID === undefined, "buildPreferencePayload omits unset optional fields");

        // dedupeNotifications
        var seen = {};
        var first = N.dedupeNotifications(seen, [{ id: "a" }, { id: "b" }]);
        eq(first.length, 2, "dedupeNotifications returns all fresh items first time");
        var second = N.dedupeNotifications(seen, [{ id: "a" }, { id: "c" }]);
        deepEq(second.map(function (x) { return x.id; }), ["c"], "dedupeNotifications filters already-seen ids");
        var noId = N.dedupeNotifications(seen, [{ title: "x" }, { title: "y" }]);
        eq(noId.length, 2, "dedupeNotifications treats id-less items as fresh");

        // shouldShowBrowserPush
        assert(N.shouldShowBrowserPush("high", "low"), "push shown when priority above threshold");
        assert(N.shouldShowBrowserPush("medium", "medium"), "push shown when priority equals threshold");
        assert(!N.shouldShowBrowserPush("low", "high"), "push hidden when priority below threshold");

        // deliveryChannelForFocus: toast when focused, browser push when not
        eq(N.deliveryChannelForFocus(true), "toast", "focused desktop -> toast");
        eq(N.deliveryChannelForFocus(false), "push", "unfocused desktop -> browser push");

        // toastPriorityClass
        eq(N.toastPriorityClass("high"), "priority-high", "toastPriorityClass high");
        eq(N.toastPriorityClass("low"), "priority-low", "toastPriorityClass low");
        eq(N.toastPriorityClass("medium"), "priority-medium", "toastPriorityClass medium");
        eq(N.toastPriorityClass("bogus"), "priority-medium", "toastPriorityClass unknown -> medium");
        eq(N.toastPriorityClass(3), "priority-high", "toastPriorityClass numeric high");

        // toastDurationMs: high priority lingers longer
        eq(N.toastDurationMs("high"), 9000, "toastDurationMs high = 9000ms");
        eq(N.toastDurationMs("medium"), 5000, "toastDurationMs medium = 5000ms");
        eq(N.toastDurationMs("low"), 5000, "toastDurationMs low = 5000ms");
        eq(N.toastDurationMs(3), 9000, "toastDurationMs numeric high = 9000ms");

        return results;
    }

    return { run: run };
});

// When executed directly under Node, run the tests and set the exit code.
if (typeof module === "object" && module.exports && require.main === module) {
    var tests = module.exports.run();
    var failed = tests.filter(function (r) { return !r.pass; });
    tests.forEach(function (r) {
        console.log((r.pass ? "PASS" : "FAIL") + " - " + r.message);
    });
    console.log("\n" + (tests.length - failed.length) + "/" + tests.length + " passed");
    if (failed.length > 0) { process.exit(1); }
}
