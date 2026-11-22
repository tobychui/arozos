/*
    Step: Interface

    The workspace the administrators open after signing in. Saved when the
    guide finishes; the people step offers it as the default for others too.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    //Interfaces the wizard has a picture and a pitch for
    function known(name) {
        if (name === "Desktop") {
            return {
                image: "img/desktop.svg",
                title: T("iface/desktop", "Web Desktop"),
                desc: T("iface/desktop/desc", "A complete desktop in your browser, with windows, a start menu and all the apps."),
                points: [
                    T("iface/desktop/p1", "Run many apps side by side"),
                    T("iface/desktop/p2", "Best on a computer or tablet"),
                    T("iface/desktop/p3", "Full access to every feature")
                ]
            };
        }
        if (name === "Drive") {
            return {
                image: "img/drive.svg",
                title: T("iface/drive", "Drive"),
                desc: T("iface/drive/desc", "A clean cloud drive for your files: browse, upload, share and preview."),
                points: [
                    T("iface/drive/p1", "Simple and focused on files"),
                    T("iface/drive/p2", "Works great on phones"),
                    T("iface/drive/p3", "Apps still open from your files")
                ]
            };
        }
        return null;
    }

    W.interfaceTitle = function (name) {
        var info = known(name);
        return info ? info.title : name;
    };

    W.register({
        id: "interface",
        title: function () {
            return T("step/interface", "Workspace");
        },
        render: function (el) {
            var html = '<div class="wz-eyebrow">' + esc(T("iface/eyebrow", "Your workspace")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("iface/title", "How do you want to use ArozOS?")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("iface/lead", "This is what opens after you sign in. You can switch at any time, and give other people a different one.")) + "</p>";

            //Desktop and Drive side by side, other interface modules below
            var featured = W.state.interfaces.filter(function (i) { return known(i.name); });
            var others = W.state.interfaces.filter(function (i) { return !known(i.name); });
            html += '<div class="wz-choices" role="radiogroup">';
            featured.forEach(function (iface) {
                var info = known(iface.name);
                var selected = W.progress.interface === iface.name;
                html += '<button type="button" class="wz-choice' + (selected ? " selected" : "") + '" role="radio" aria-checked="' + selected + '" data-name="' + esc(iface.name) + '">' +
                    '<span class="wz-choice-check">' + W.icon("check") + "</span>" +
                    '<div class="wz-choice-preview"><img src="' + esc(info.image) + '" alt=""></div>' +
                    '<div class="wz-choice-title">' + esc(info.title) +
                    (iface.name === "Desktop" ? '<span class="wz-badge">' + esc(T("iface/recommended", "Recommended")) + "</span>" : "") + "</div>" +
                    '<div class="wz-choice-desc">' + esc(info.desc) + "</div>" +
                    '<ul class="wz-choice-points">' + info.points.map(function (p) {
                        return "<li>" + W.icon("check") + "<span>" + esc(p) + "</span></li>";
                    }).join("") + "</ul></button>";
            });
            html += "</div>";

            if (others.length) {
                html += '<div class="wz-section-title">' + esc(T("iface/others", "Other workspaces")) + "</div>" +
                    '<div class="wz-choices stack compact" role="radiogroup">';
                others.forEach(function (iface) {
                    var selected = W.progress.interface === iface.name;
                    html += '<button type="button" class="wz-choice' + (selected ? " selected" : "") + '" role="radio" aria-checked="' + selected + '" data-name="' + esc(iface.name) + '">' +
                        '<span class="wz-choice-check">' + W.icon("check") + "</span>" +
                        '<div class="wz-choice-icon"><img src="../' + esc(iface.icon) + '" alt=""></div>' +
                        '<div class="wz-choice-body"><div class="wz-choice-title">' + esc(iface.name) + "</div>" +
                        '<div class="wz-choice-desc">' + esc(iface.desc) + "</div></div></button>";
                });
                html += "</div>";
            }
            el.innerHTML = html;

            $(el).find(".wz-choice").on("click", function () {
                W.progress.interface = $(this).attr("data-name");
                $(el).find(".wz-choice").removeClass("selected").attr("aria-checked", "false");
                $(this).addClass("selected").attr("aria-checked", "true");
            });
        }
    });
})();
