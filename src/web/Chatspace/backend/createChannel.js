/*
    Chatspace - create a channel (AGI)

    POST parameters (injected as VM globals by the AGI gateway):
      name   - requested channel name (slugified Slack-style)
      desc   - optional description
      access - "public" (default, discoverable + self-join) or "private"

    Creates a shared space tagged as a chatspace channel. The caller
    becomes the space owner. Persistent when the administrator allows it,
    ephemeral otherwise.

    Response: the new space descriptor, or {"error": "..."}.
*/

requirelib("sharedspace");

var APP_TAG = "chatspace";

function fail(message) {
    sendJSONResp(JSON.stringify({ error: message }));
}

//Slack-style channel names: lowercase, no spaces or punctuation beyond
//dash / underscore, at most 60 characters.
function slugify(raw) {
    var name = String(raw).toLowerCase();
    name = name.replace(/\s+/g, "-");
    name = name.replace(/[^a-z0-9\-_]/g, "");
    name = name.replace(/\-+/g, "-");
    name = name.replace(/^\-+|\-+$/g, "");
    if (name.length > 60) {
        name = name.substring(0, 60);
    }
    return name;
}

function displayName(space) {
    if (space.metadata && space.metadata["cs-name"]) {
        return space.metadata["cs-name"];
    }
    return space.name;
}

function isChannel(space) {
    return space.metadata &&
        space.metadata["cs-app"] == APP_TAG &&
        space.metadata["cs-kind"] == "channel";
}

function main() {
    if (typeof name == "undefined" || slugify(name) == "") {
        fail("Channel names can only contain lowercase letters, numbers, dashes and underscores");
        return;
    }
    var channelName = slugify(name);

    var channelAccess = "public";
    if (typeof access != "undefined" && access == "private") {
        channelAccess = "private";
    }

    var description = "";
    if (typeof desc != "undefined") {
        description = String(desc).substring(0, 500);
    }

    //Refuse duplicates across every channel the caller can see
    var visible = sharedspace.listPublicSpaces().concat(sharedspace.listJoinedSpaces());
    for (var i = 0; i < visible.length; i++) {
        if (isChannel(visible[i]) && displayName(visible[i]) == channelName) {
            fail("A channel named #" + channelName + " already exists");
            return;
        }
    }

    var options = {
        access: channelAccess,
        persistent: true,
        metadata: {
            "cs-app": APP_TAG,
            "cs-kind": "channel",
            "cs-created": USERNAME
        }
    };
    if (description != "") {
        options.metadata["cs-desc"] = description;
    }

    var space = sharedspace.createSpaceAdvanced(channelName, options);
    if (space == null) {
        //Most likely persistence is disabled by the administrator
        options.persistent = false;
        space = sharedspace.createSpaceAdvanced(channelName, options);
    }
    if (space == null) {
        fail("Could not create the channel");
        return;
    }

    var descriptor = sharedspace.getSpaceInfo(space.spaceid);
    descriptor.memberlist = sharedspace.listMembers(space.spaceid);
    sendJSONResp(JSON.stringify(descriptor));
}

main();
