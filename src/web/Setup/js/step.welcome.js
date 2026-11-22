/*
    Step: Welcome

    Says what the guide covers and that every choice can be changed later.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    W.register({
        id: "welcome",
        title: function () {
            return T("step/welcome", "Welcome");
        },
        nextLabel: function () {
            return T("welcome/start", "Get started");
        },
        render: function (el) {
            var items = [
                ["desktop", T("welcome/item/interface", "Pick your workspace"), T("welcome/item/interface/desc", "A full web desktop, or a simple file drive.")],
                ["disk", T("welcome/item/storage", "Add storage"), T("welcome/item/storage/desc", "Use the disks of this server and your other storage.")],
                ["users", T("welcome/item/people", "Invite people"), T("welcome/item/people/desc", "Accounts for family or colleagues, with the right access.")],
                ["share", T("welcome/item/sharing", "Share on your network"), T("welcome/item/sharing/desc", "Open your files from Windows, macOS and phones.")]
            ];
            var html = '<div class="wz-eyebrow">' + esc(T("welcome/eyebrow", "Welcome to ArozOS")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("welcome/title", "Let's get {host} ready", { host: W.state.hostname || "ArozOS" })) + "</h1>" +
                '<p class="wz-lead">' + esc(T("welcome/lead", "Hi {user}, this short guide helps you set up your server. It takes about five minutes, and every step can be skipped.", { user: W.state.username })) + "</p>" +
                '<div class="wz-welcome-list">';
            items.forEach(function (item) {
                html += '<div class="wz-welcome-item"><div class="wz-card-icon">' + W.icon(item[0]) + "</div>" +
                    "<div><b>" + esc(item[1]) + "</b><span>" + esc(item[2]) + "</span></div></div>";
            });
            html += "</div>" +
                '<div class="wz-note">' + W.icon("info") + "<div>" +
                esc(T("welcome/note", "Nothing here is final. You can change all of it later in System Settings, or skip the guide and go straight to the desktop.")) +
                "</div></div>";
            el.innerHTML = html;
        }
    });
})();
