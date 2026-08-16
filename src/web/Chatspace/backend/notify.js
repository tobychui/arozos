/*
    Chatspace - route a message notification to co-members through the
    ArozOS notification system (AGI).

    POST parameters (injected as VM globals by the AGI gateway):
      spaceid  - the conversation (shared space) the message was posted in
      title    - notification title (e.g. the sender, or "sender in #channel")
      message  - the message preview text (optional)
      targets  - optional JSON array (or comma separated list) of usernames to
                 notify; when omitted every other member is notified
      priority - optional "low" | "medium" | "high" (default "medium")

    Only a member of the space may raise a notification, only fellow members
    can be reached, and members currently connected to the conversation are
    skipped (they already receive the message live). How each recipient is
    reached - desktop, Telegram, email, webhook - follows that user's own
    ArozOS notification preferences.

    Response: {"ok": true, "notified": N} or {"error": "..."}.
*/

requirelib("sharedspace");

function fail(reason) {
    sendJSONResp(JSON.stringify({ error: reason }));
}

function parseTargets(raw) {
    var value = String(raw);
    if (value === "") {
        return undefined;
    }
    //Prefer a JSON array; fall back to a comma separated list for convenience.
    try {
        var parsed = JSON.parse(value);
        if (Object.prototype.toString.call(parsed) === "[object Array]") {
            return parsed;
        }
    } catch (e) {
        //Not JSON - treat as comma separated below.
    }
    var list = [];
    var pieces = value.split(",");
    for (var i = 0; i < pieces.length; i++) {
        var name = pieces[i].replace(/^\s+|\s+$/g, "");
        if (name !== "") {
            list.push(name);
        }
    }
    return list;
}

function main() {
    if (typeof spaceid === "undefined" || String(spaceid) === "") {
        fail("Missing spaceid");
        return;
    }
    if (typeof title === "undefined" || String(title) === "") {
        fail("Missing notification title");
        return;
    }

    var body = (typeof message === "undefined") ? "" : String(message);
    var prio = (typeof priority === "undefined" || String(priority) === "") ? "medium" : String(priority);
    var targetList = (typeof targets === "undefined") ? undefined : parseTargets(targets);

    var notified = sharedspace.notifyMembers(String(spaceid), String(title), body, prio, targetList);
    if (notified < 0) {
        fail("Could not send notification");
        return;
    }
    sendJSONResp(JSON.stringify({ ok: true, notified: notified }));
}

main();
