/*
    notification.js

    Pure, DOM-free helper logic shared by the ArozOS notification settings page
    (SystemAO/notification/index.html) and the web desktop (desktop.html).

    Everything here is deterministic and side-effect free.
*/
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.NotificationUI = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var PRIORITIES = ["low", "medium", "high"];

    // priorityToInt maps a textual priority to the backend integer scale
    // (low=1, medium=2, high=3). Unknown values fall back to medium (2).
    function priorityToInt(priority) {
        switch (String(priority || "").trim().toLowerCase()) {
            case "low": return 1;
            case "high": return 3;
            case "medium":
            case "normal":
            case "med": return 2;
            default: return 2;
        }
    }

    // priorityToLabel converts an integer priority to its textual form.
    function priorityToLabel(priority) {
        switch (Number(priority)) {
            case 1: return "low";
            case 3: return "high";
            default: return "medium";
        }
    }

    // iconForPriority returns a Semantic UI icon class for a given priority so
    // the desktop and settings UI stay consistent (no emoji per project rules).
    function iconForPriority(priority) {
        var label = typeof priority === "number" ? priorityToLabel(priority) : String(priority || "").toLowerCase();
        switch (label) {
            case "high": return "exclamation circle";
            case "low": return "info circle";
            default: return "bell";
        }
    }

    // escapeHtml escapes a string for safe insertion into HTML.
    function escapeHtml(text) {
        return String(text == null ? "" : text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    // isValidWebhookURL returns true only for http/https URLs with a host.
    function isValidWebhookURL(url) {
        if (typeof url !== "string") return false;
        var trimmed = url.trim();
        if (trimmed === "") return false;
        var m = /^(https?):\/\/([^\/\s]+)(\/[^\s]*)?$/i.exec(trimmed);
        return !!m;
    }

    // buildPreferencePayload converts the settings UI state into the flat
    // parameter object expected by POST /system/notification/preference. The
    // delivery matrix (channels) is serialised to JSON.
    function buildPreferencePayload(state) {
        state = state || {};
        var payload = {
            channels: JSON.stringify(state.channels || {})
        };
        if (state.telegramChatID !== undefined) payload.telegramChatID = String(state.telegramChatID);
        if (state.webhookURL !== undefined) payload.webhookURL = String(state.webhookURL);
        if (state.webhookMethod !== undefined) payload.webhookMethod = String(state.webhookMethod);
        if (state.webhookContentType !== undefined) payload.webhookContentType = String(state.webhookContentType);
        if (state.webhookBody !== undefined) payload.webhookBody = String(state.webhookBody);
        return payload;
    }

    // normalizeMatrix returns a clean channel->priority->bool matrix that only
    // contains the valid priority labels and true entries.
    function normalizeMatrix(channels) {
        var out = {};
        channels = channels || {};
        Object.keys(channels).forEach(function (agent) {
            var row = channels[agent] || {};
            var cleaned = {};
            PRIORITIES.forEach(function (label) {
                if (row[label]) cleaned[label] = true;
            });
            if (Object.keys(cleaned).length > 0) out[agent] = cleaned;
        });
        return out;
    }

    // browserPermissionState reports the current browser notification
    // permission ("granted" / "denied" / "default" / "unsupported").
    function browserPermissionState(notificationCtor) {
        if (typeof notificationCtor === "undefined" || !notificationCtor) return "unsupported";
        return notificationCtor.permission || "default";
    }

    // dedupeNotifications filters out notifications whose id is already present
    // in seenIds. It returns the fresh items and mutates seenIds to include the
    // newly seen ids. Items without an id are always considered fresh.
    function dedupeNotifications(seenIds, incoming) {
        seenIds = seenIds || {};
        var fresh = [];
        (incoming || []).forEach(function (item) {
            if (!item) return;
            var id = item.id;
            if (id !== undefined && id !== null && id !== "") {
                if (seenIds[id]) return;
                seenIds[id] = true;
            }
            fresh.push(item);
        });
        return fresh;
    }

    // shouldShowBrowserPush decides whether an OS-level (Chrome) push should be
    // raised for a notification given the user's minimum priority preference.
    function shouldShowBrowserPush(notificationPriority, minPriority) {
        return priorityToInt(notificationPriority) >= priorityToInt(minPriority);
    }

    // deliveryChannelForFocus picks how an incoming desktop notification is
    // surfaced: an in-page "toast" when the desktop tab is focused, or a
    // browser (Chrome) "push" when it is not (hidden tab / unfocused window).
    function deliveryChannelForFocus(isFocused) {
        return isFocused ? "toast" : "push";
    }

    // toastPriorityClass returns the CSS modifier class for a toast of the
    // given priority (accepts a textual or numeric priority).
    function toastPriorityClass(priority) {
        var label = typeof priority === "number" ? priorityToLabel(priority) : String(priority || "medium").toLowerCase();
        if (label !== "high" && label !== "low") label = "medium";
        return "priority-" + label;
    }

    // toastDurationMs returns how long a toast of the given priority should stay
    // on screen before auto-dismissing (high priority lingers longer).
    function toastDurationMs(priority) {
        var label = typeof priority === "number" ? priorityToLabel(priority) : String(priority || "medium").toLowerCase();
        return label === "high" ? 9000 : 5000;
    }

    return {
        PRIORITIES: PRIORITIES,
        priorityToInt: priorityToInt,
        priorityToLabel: priorityToLabel,
        iconForPriority: iconForPriority,
        escapeHtml: escapeHtml,
        isValidWebhookURL: isValidWebhookURL,
        buildPreferencePayload: buildPreferencePayload,
        normalizeMatrix: normalizeMatrix,
        browserPermissionState: browserPermissionState,
        dedupeNotifications: dedupeNotifications,
        shouldShowBrowserPush: shouldShowBrowserPush,
        deliveryChannelForFocus: deliveryChannelForFocus,
        toastPriorityClass: toastPriorityClass,
        toastDurationMs: toastDurationMs
    };
});
