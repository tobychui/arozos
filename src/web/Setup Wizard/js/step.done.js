/*
    Step: Done

    Sums up what the guide set up. Finish saves the workspace of the
    administrators and disables the wizard (system/setup/finish), then opens
    that workspace.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    function item(icon, label, value) {
        return '<div class="wz-summary-item"><div class="wz-card-icon">' + W.icon(icon) + "</div>" +
            '<div class="wz-grow"><div class="wz-summary-label">' + esc(label) + "</div>" +
            '<div class="wz-summary-value">' + esc(value) + "</div></div></div>";
    }

    function names(list) {
        return list.map(function (d) { return d.name + " (" + d.uuid + ":/)"; }).join(", ");
    }

    function peopleText() {
        switch (W.progress.people) {
            case "admins":
                return T("done/people/admins", "You and people you trust, all administrators");
            case "group":
                return T("done/people/group", "You, and others in the {group} group", { group: W.peopleGroup() });
        }
        return T("done/people/me", "Just you");
    }

    function sharingText() {
        var on = W.state.fileServers.filter(function (s) { return s.enabled; }).map(function (s) {
            return s.id === "smb" || s.id === "smbd" ? T("done/sharing/smb", "Windows file sharing") : s.name;
        });
        return on.length ? on.join(", ") : T("done/sharing/none", "Only in the browser");
    }

    W.register({
        id: "done",
        title: function () {
            return T("step/done", "Finish");
        },
        nextLabel: function () {
            return T("done/open", "Open {name}", { name: W.interfaceTitle(W.progress.interface) });
        },
        render: function (el) {
            var local = W.wizardDrives("local");
            var network = W.wizardDrives("network");
            var html = '<div class="wz-eyebrow">' + esc(T("step/done", "Finish")) + "</div>" +
                '<div class="wz-hero ok">' + W.icon("check") + "</div>" +
                '<h1 class="wz-title">' + esc(T("done/title", "You're all set")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("done/lead", "Here is how your server is set up. You can change any of it later in System Settings.")) + "</p>" +
                '<div class="wz-summary">' +
                item("desktop", T("done/interface", "Your workspace"), W.interfaceTitle(W.progress.interface)) +
                item("disk", T("done/storage", "Storage"), local.length ? names(local) : T("done/storage/builtin", "Built-in storage (user:/)")) +
                item("cloud", T("done/network", "Network drives"), network.length ? names(network) : T("done/none", "None")) +
                item("users", T("done/people", "People"), peopleText()) +
                (W.progress.people && W.progress.people !== "me"
                    ? item("user", T("done/accounts", "Accounts added"), W.progress.accounts.length ? W.progress.accounts.join(", ") : T("done/none", "None"))
                    : "") +
                item("share", T("done/sharing", "File sharing"), sharingText()) +
                "</div>" +
                '<div class="wz-note" style="margin-top:22px">' + W.icon("info") + "<div>" +
                esc(T("done/note", "The Setup Wizard turns itself off when you finish. To run it again, switch it on in System Settings > Add & Remove Module and open it from there.")) +
                "</div></div>";
            el.innerHTML = html;
        },
        leave: function () {
            return W.api("POST", "system/setup/finish", { interface: W.progress.interface }).then(function () {
                window.location.href = "../";
                //Keep the button busy while the workspace loads
                return new Promise(function () { });
            });
        }
    });
})();
