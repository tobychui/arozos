/*
    Chatspace - AI assistant bot (AGI)

    Invoked by the front end when a member mentions @ai in a conversation.
    Uses the built-in AGI LLM library (requirelib("llm"), configured under
    System Settings > AI Integration) to answer with the recent
    conversation as context, then posts the reply back into the shared
    space as a bot-flagged message envelope so every subscriber sees it
    in realtime.

    POST parameters (injected as VM globals by the AGI gateway):
      spaceid - the conversation's shared space ID
      prompt  - the message text that mentioned @ai
      thread  - optional root item id when asked inside a thread

    Response: {"ok": true, "itemid": "..."} or {"error": "..."}.

    The reply item is uploaded under the *calling user's* name (AGI runs
    in the invoker's scope) but carries "bot": 1 in the envelope; the
    client renders such messages as "Chatspace AI" with an APP tag.
*/

requirelib("sharedspace");

var MAX_CONTEXT_MSGS = 20;   //recent messages fed to the model
var MAX_REPLY_CHARS = 3400;  //stay inside the 4k text item cap

var SYSTEM_PROMPT =
    "You are Chatspace AI, the built-in assistant of the Chatspace team " +
    "chat WebApp on an ArozOS home server. Members summon you by " +
    "mentioning @ai inside a channel, thread or direct message, and your " +
    "answer is posted back into that conversation for everyone there to " +
    "read.\n\n" +
    "Typical routines you handle: answering questions, summarizing the " +
    "recent discussion, extracting action items or decisions, drafting " +
    "replies and announcements, translating messages, brainstorming and " +
    "explaining technical topics.\n\n" +
    "Rules:\n" +
    "- Be concise and chat-friendly; prefer a short paragraph or a tight " +
    "bullet list over long essays.\n" +
    "- Format only with Chatspace markup: *bold*, _italic_, ~strike~, " +
    "`code`, ``` fenced code blocks ```, > quotes, - bullet lists and " +
    "@username mentions. Never use emoji or Markdown headings.\n" +
    "- The conversation transcript is provided for context; the final " +
    "message is the request aimed at you.\n" +
    "- You cannot change server settings, browse the web or open files; " +
    "if asked, say so briefly and point the member in the right " +
    "direction instead.\n" +
    "- Reply in the same language the request was written in.";

function fail(message) {
    sendJSONResp(JSON.stringify({ error: message }));
}

//Parse a Chatspace message envelope out of a raw item text; returns null
//for plain text or non-message envelopes (reactions, edits, pins).
function parseMsgEnvelope(text) {
    if (!text || text.charAt(0) != "{") {
        return null;
    }
    try {
        var obj = JSON.parse(text);
        if (obj && obj.cs === 1) {
            return obj;
        }
    } catch (e) { }
    return null;
}

//Flatten the space's recent chat into a plain transcript the model can
//read. When the request came from a thread, prefer that thread's context.
function buildTranscript(spaceid, threadRoot) {
    var items = sharedspace.listItems(spaceid);
    if (items == null) {
        return "";
    }
    var lines = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.type == "file" || item.type == "image") {
            lines.push({ th: null, text: item.uploader + " shared a file: " + item.name });
            continue;
        }
        var env = parseMsgEnvelope(item.text);
        if (env != null && env.a != "msg") {
            continue; //reactions / edits / pins are not conversation
        }
        var text = env != null ? String(env.t || "") : String(item.text || "");
        if (text == "") {
            continue;
        }
        var speaker = (env != null && env.bot) ? "Chatspace AI" : item.uploader;
        lines.push({
            th: env != null && env.th ? String(env.th) : null,
            id: item.itemid,
            text: speaker + ": " + text
        });
    }

    //Inside a thread: keep the root message plus that thread's replies
    if (threadRoot != "") {
        var scoped = [];
        for (var j = 0; j < lines.length; j++) {
            if (lines[j].id == threadRoot || lines[j].th == threadRoot) {
                scoped.push(lines[j]);
            }
        }
        if (scoped.length > 0) {
            lines = scoped;
        }
    }

    if (lines.length > MAX_CONTEXT_MSGS) {
        lines = lines.slice(lines.length - MAX_CONTEXT_MSGS);
    }
    var out = [];
    for (var k = 0; k < lines.length; k++) {
        out.push(lines[k].text);
    }
    return out.join("\n");
}

function main() {
    if (typeof spaceid == "undefined" || String(spaceid) == "") {
        fail("Missing space ID");
        return;
    }
    if (typeof prompt == "undefined" || String(prompt) == "") {
        fail("Missing prompt");
        return;
    }
    var threadRoot = (typeof thread == "undefined") ? "" : String(thread);

    var info = sharedspace.getSpaceInfo(String(spaceid));
    if (!info.exists) {
        fail("Conversation not found");
        return;
    }

    var transcript = buildTranscript(String(spaceid), threadRoot);
    var request = "Conversation so far:\n" + transcript +
        "\n\nThe latest message above, sent by " + USERNAME +
        ", mentions you (@ai). Respond to it now.";

    var reply;
    try {
        requirelib("llm");
        reply = llm.chat(request, {
            system: SYSTEM_PROMPT,
            temperature: 0.4,
            maxTokens: 800
        });
    } catch (err) {
        //Most common cause: no AI endpoint configured on this host. Post
        //the explanation as the bot so the whole conversation sees it.
        reply = "I could not reach the AI model: " + err.message +
            "\n> An administrator can configure it under System Settings, AI Integration.";
    }

    reply = String(reply || "").replace(/^\s+|\s+$/g, "");
    if (reply == "") {
        reply = "I have nothing to add - could you rephrase the request?";
    }
    if (reply.length > MAX_REPLY_CHARS) {
        reply = reply.substring(0, MAX_REPLY_CHARS) + "\n_(reply truncated)_";
    }

    var envelope = { cs: 1, a: "msg", t: reply, bot: 1 };
    if (threadRoot != "") {
        envelope.th = threadRoot;
    }
    var itemid = sharedspace.addText(String(spaceid), JSON.stringify(envelope));
    if (itemid == null) {
        fail("Could not post the reply into the conversation");
        return;
    }
    sendJSONResp(JSON.stringify({ ok: true, itemid: itemid }));
}

main();
