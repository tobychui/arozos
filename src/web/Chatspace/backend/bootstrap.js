/*
    Chatspace - workspace bootstrap (AGI)

    Runs in the invoking user's scope. Builds the caller's workspace view
    on top of the shared space collaboration backbone:

      - Ensures the default #general channel exists (a public, persistent
        shared space tagged with cs-app / cs-kind metadata) and that the
        caller has joined it.
      - Returns the caller's joined channels + DM spaces and the public
        channel directory (for the channel browser).

    Response:
      {
        "username": "...",
        "channels":  [spaceDesc...],   // joined chatspace channels
        "directory": [spaceDesc...],   // public chatspace channels not joined
        "dms":       [spaceDesc...]    // joined chatspace DM spaces
      }
*/

requirelib("sharedspace");

var APP_TAG = "chatspace";

function isChannel(space) {
    return space.metadata &&
        space.metadata["cs-app"] == APP_TAG &&
        space.metadata["cs-kind"] == "channel";
}

function isDm(space) {
    return space.metadata &&
        space.metadata["cs-app"] == APP_TAG &&
        space.metadata["cs-kind"] == "dm";
}

//The display name of a channel: the (manager renameable) cs-name metadata
//wins over the immutable space name.
function channelName(space) {
    if (space.metadata && space.metadata["cs-name"]) {
        return space.metadata["cs-name"];
    }
    return space.name;
}

//Find the oldest visible chatspace channel called "general"; when two get
//created by a bootstrap race, everybody converges on the older one.
function findGeneral(spaces) {
    var found = null;
    for (var i = 0; i < spaces.length; i++) {
        if (isChannel(spaces[i]) && channelName(spaces[i]) == "general") {
            if (found == null || spaces[i].createdat < found.createdat) {
                found = spaces[i];
            }
        }
    }
    return found;
}

function main() {
    var joined = sharedspace.listJoinedSpaces();
    var publicSpaces = sharedspace.listPublicSpaces();

    //Provision #general on first use. Persistent spaces need the admin to
    //allow persistence; fall back to an ephemeral space when they do not.
    var general = findGeneral(publicSpaces.concat(joined));
    if (general == null) {
        var options = {
            access: "public",
            persistent: true,
            metadata: {
                "cs-app": APP_TAG,
                "cs-kind": "channel",
                "cs-desc": "This channel is for workspace-wide communication and announcements."
            }
        };
        general = sharedspace.createSpaceAdvanced("general", options);
        if (general == null) {
            options.persistent = false;
            general = sharedspace.createSpaceAdvanced("general", options);
        }
        publicSpaces = sharedspace.listPublicSpaces();
    }

    //Everyone is a member of #general, like the Slack default channel
    if (general != null) {
        var info = sharedspace.getSpaceInfo(general.spaceid);
        if (info.exists && !info.ismember) {
            sharedspace.joinSpace(general.spaceid);
        }
        joined = sharedspace.listJoinedSpaces();
    }

    var channels = [];
    var dms = [];
    var joinedIds = {};
    for (var i = 0; i < joined.length; i++) {
        var space = joined[i];
        joinedIds[space.spaceid] = true;
        //getSpaceInfo carries the caller's role/membership on top of the
        //base descriptor
        var desc = sharedspace.getSpaceInfo(space.spaceid);
        if (!desc.exists) {
            continue;
        }
        if (isChannel(space)) {
            desc.memberlist = sharedspace.listMembers(space.spaceid);
            channels.push(desc);
        } else if (isDm(space)) {
            desc.memberlist = sharedspace.listMembers(space.spaceid);
            dms.push(desc);
        }
    }

    var directory = [];
    for (var j = 0; j < publicSpaces.length; j++) {
        if (isChannel(publicSpaces[j]) && !joinedIds[publicSpaces[j].spaceid]) {
            directory.push(publicSpaces[j]);
        }
    }

    sendJSONResp(JSON.stringify({
        username: USERNAME,
        channels: channels,
        directory: directory,
        dms: dms
    }));
}

main();
