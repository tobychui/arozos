/*
    Chatspace - save a shared-space attachment into ArozOS storage (AGI)

    Copies a conversation's file/image item out of the shared space and
    into the calling user's own ArozOS file system, so members can keep a
    shared attachment in their personal storage instead of (or as well as)
    downloading it to their local computer.

    POST parameters (injected as VM globals by the AGI gateway):
      spaceid - the conversation's shared space ID
      itemid  - the attachment item ID
      dest    - optional destination folder vpath (default user:/Desktop)

    Response: {"ok": true, "path": "user:/Desktop/name.ext"} or
              {"error": "..."}.
*/

requirelib("sharedspace");
requirelib("filelib");

function fail(message) {
    sendJSONResp(JSON.stringify({ error: message }));
}

//Ensure the destination folder exists, creating it when needed. Falls
//back to the user root (which always exists) if creation fails.
function ensureFolder(folder) {
    if (filelib.fileExists(folder) && filelib.isDir(folder)) {
        return folder;
    }
    try {
        if (filelib.mkdir(folder) && filelib.isDir(folder)) {
            return folder;
        }
    } catch (e) { }
    return "user:/";
}

function main() {
    if (typeof spaceid == "undefined" || String(spaceid) == "") {
        fail("Missing space ID");
        return;
    }
    if (typeof itemid == "undefined" || String(itemid) == "") {
        fail("Missing item ID");
        return;
    }

    var folder = (typeof dest == "undefined" || String(dest) == "") ? "user:/Desktop" : String(dest);
    folder = folder.replace(/\/+$/, ""); //drop any trailing slash
    folder = ensureFolder(folder);

    //Resolve the item's stored name (never trust a client-supplied name)
    var items = sharedspace.listItems(String(spaceid));
    if (items == null) {
        fail("Conversation not found");
        return;
    }
    var found = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].itemid == String(itemid)) {
            found = items[i];
            break;
        }
    }
    if (found == null || found.type == "text" || found.name == "") {
        fail("This message has no downloadable file");
        return;
    }
    var name = found.name;

    var destVpath = folder + "/" + name;
    var ok = sharedspace.saveFileTo(String(spaceid), String(itemid), destVpath);
    if (!ok) {
        fail("Could not save the file. Check that the folder exists and you can write to it.");
        return;
    }
    sendJSONResp(JSON.stringify({ ok: true, path: destVpath }));
}

main();
