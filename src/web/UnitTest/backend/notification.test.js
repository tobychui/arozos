/*
    notification.test.js
    Unit test for the AGI notification library (requirelib("notification")).

    Exercises the notification object exposed to AGI scripts: the priority
    constants, notification.send() to the current user at each priority, input
    validation, and the admin-gated notification.sendToUser().

    A failed assertion throws an Error -> AGI returns HTTP 500 -> test runner
    marks FAIL. On success the script sends a summary -> HTTP 200 -> PASS.

    Note: successful send() calls deliver real notifications to the running
    user (they will appear on the desktop notification list / as a toast).
*/

if (!requirelib("notification")) {
    throw new Error("requirelib('notification') returned false - notification library not available on this server");
}

var passed = [];

// assert() throws with a descriptive message so the test runner shows FAIL
function assert(label, condition) {
    if (!condition) {
        throw new Error("ASSERTION FAILED: " + label);
    }
    passed.push(label);
}

function assertEq(label, actual, expected) {
    if (actual !== expected) {
        throw new Error("ASSERTION FAILED: " + label +
            " - expected " + JSON.stringify(expected) +
            " but got " + JSON.stringify(actual));
    }
    passed.push(label);
}

// -- Object shape --------------------------------------------------------------
assert("notification is an object", typeof notification === "object" && notification !== null);
assert("notification.send is a function", typeof notification.send === "function");
assert("notification.sendToUser is a function", typeof notification.sendToUser === "function");

// -- Priority constants --------------------------------------------------------
assertEq("PRIORITY_LOW constant", notification.PRIORITY_LOW, "low");
assertEq("PRIORITY_MEDIUM constant", notification.PRIORITY_MEDIUM, "medium");
assertEq("PRIORITY_HIGH constant", notification.PRIORITY_HIGH, "high");

// -- send() to the current user at each priority -------------------------------
assertEq("send() with default priority returns true",
    notification.send("Unit Test", "Default priority notification from the AGI unit tester"), true);

assertEq("send() with low priority returns true",
    notification.send("Unit Test (low)", "Low priority message", notification.PRIORITY_LOW), true);

assertEq("send() with medium priority returns true",
    notification.send("Unit Test (medium)", "Medium priority message", "medium"), true);

assertEq("send() with high priority returns true",
    notification.send("Unit Test (high)", "High priority message", notification.PRIORITY_HIGH), true);

// An unknown priority string is accepted and treated as medium by the backend.
assertEq("send() with unknown priority still succeeds",
    notification.send("Unit Test (fallback)", "Unknown priority falls back to medium", "bogus"), true);

// -- Input validation ----------------------------------------------------------
// An empty title is rejected by the backend and send() returns false.
assertEq("send() with empty title returns false",
    notification.send("", "This should be rejected"), false);

// -- sendToUser() --------------------------------------------------------------
// Sending to a user that does not exist must fail. This holds regardless of
// whether the caller is an admin (non-existent user) or a normal user
// (permission denied) - either way the call returns false rather than throwing.
assertEq("sendToUser() to a non-existent user returns false",
    notification.sendToUser("__no_such_user_for_unit_test__", "Title", "Message", "low"), false);

// -- Summary -------------------------------------------------------------------
sendResp(
    "Notification library test PASSED (" + passed.length + " assertions)\n\n" +
    passed.map(function (s, i) { return (i + 1) + ". " + s; }).join("\n")
);
