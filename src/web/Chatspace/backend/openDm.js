/*
    Chatspace - open (find or create) a direct message space (AGI)

    POST parameters (injected as VM globals by the AGI gateway):
      targets - comma separated usernames to chat with (1..8, excluding
                the caller; more than one target makes a group DM)

    A DM is a private shared space whose cs-members metadata holds the
    sorted participant list; that key makes the conversation findable by
    every participant, so both sides converge on the same space instead
    of creating one each.

    Response: the DM space descriptor, or {"error": "..."}.
*/

requirelib("sharedspace");

var APP_TAG = "chatspace";
var MAX_TARGETS = 8;

function fail(message) {
    sendJSONResp(JSON.stringify({ error: message }));
}

function isDm(space) {
    return space.metadata &&
        space.metadata["cs-app"] == APP_TAG &&
        space.metadata["cs-kind"] == "dm";
}

function main() {
    if (typeof targets == "undefined" || String(targets) == "") {
        fail("Missing DM targets");
        return;
    }

    //Normalize: split, trim, drop empties / self, dedupe
    var raw = String(targets).split(",");
    var seen = {};
    var others = [];
    for (var i = 0; i < raw.length; i++) {
        var username = raw[i].replace(/^\s+|\s+$/g, "");
        if (username == "" || username == USERNAME || seen[username]) {
            continue;
        }
        seen[username] = true;
        others.push(username);
    }
    if (others.length == 0) {
        fail("Pick at least one other person");
        return;
    }
    if (others.length > MAX_TARGETS) {
        fail("Direct messages support up to " + MAX_TARGETS + " other people");
        return;
    }

    var participants = others.concat([USERNAME]).sort();
    var memberKey = participants.join(",");

    //Reuse the existing conversation when there is one
    var joined = sharedspace.listJoinedSpaces();
    for (var j = 0; j < joined.length; j++) {
        if (isDm(joined[j]) && joined[j].metadata["cs-members"] == memberKey) {
            var existing = sharedspace.getSpaceInfo(joined[j].spaceid);
            existing.memberlist = sharedspace.listMembers(joined[j].spaceid);
            sendJSONResp(JSON.stringify(existing));
            return;
        }
    }

    var options = {
        access: "private",
        persistent: true,
        metadata: {
            "cs-app": APP_TAG,
            "cs-kind": "dm",
            "cs-members": memberKey
        }
    };
    var space = sharedspace.createSpaceAdvanced("dm", options);
    if (space == null) {
        //Most likely persistence is disabled by the administrator
        options.persistent = false;
        space = sharedspace.createSpaceAdvanced("dm", options);
    }
    if (space == null) {
        fail("Could not open the conversation");
        return;
    }

    //Every participant is a space admin, so anyone in the DM can manage it
    for (var k = 0; k < others.length; k++) {
        sharedspace.addMember(space.spaceid, others[k], "admin");
    }

    var descriptor = sharedspace.getSpaceInfo(space.spaceid);
    descriptor.memberlist = sharedspace.listMembers(space.spaceid);
    sendJSONResp(JSON.stringify(descriptor));
}

main();
