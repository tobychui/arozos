/*
    Step: Name

    The first step: the name of the server, with the other Runtime settings
    (System Settings > Runtime) folded away under Advanced settings for
    whoever wants to tune them. The values come with system/setup/state
    (runtime) and are saved through system/bootflags on Continue, so they
    apply at once and are restored on the next start. A setting given as a
    start parameter is set by that parameter again on the next start; the
    step marks it with the parameter's name.
*/

(function () {
    "use strict";
    var W = window.Wizard, T = W.T, esc = W.esc;

    //Setting -> start parameter, as bootFlagNames in startup.flags.go
    var FLAGS = {
        Hostname: "hostname",
        MaxUploadSize: "max_upload_size",
        MaxFileUploadBuff: "upload_buf",
        FileIOBuffer: "iobuf",
        EnableGzip: "gzip",
        DisableIPResolver: "disable_ip_resolver",
        EnableHomePage: "homepage",
        EnableDirListing: "dir_list"
    };
    var FIELDS = Object.keys(FLAGS);
    var NUMBERS = ["MaxUploadSize", "MaxFileUploadBuff", "FileIOBuffer"];
    var SWITCHES = ["EnableGzip", "DisableIPResolver", "EnableHomePage", "EnableDirListing"];

    var draft = null;          //what the form shows, kept when the step redraws
    var advancedOpen = false;

    function saved() {
        return W.state.runtime || {};
    }

    function fromFlag(field) {
        return (saved().FromStartFlag || []).indexOf(field) >= 0;
    }

    function current() {
        if (!draft) {
            draft = {};
            FIELDS.forEach(function (field) {
                draft[field] = saved()[field];
            });
        }
        return draft;
    }

    function flagChip(field) {
        if (!fromFlag(field)) {
            return "";
        }
        var tip = T("name/flag/tip", "Set by a start parameter. It replaces the saved value again on the next start unless the parameter is removed.");
        return ' <span class="wz-chip warn wz-mono" title="' + esc(tip) + '">-' + esc(FLAGS[field]) + "</span>";
    }

    function flagNote(fields) {
        var flagged = fields.filter(fromFlag);
        if (!flagged.length) {
            return "";
        }
        return '<div class="wz-note warn">' + W.icon("info") + "<div>" +
            esc(T("name/flag/note", "A setting marked with its start parameter, such as {flag}, comes from the command that starts ArozOS. What you save here applies now, but that parameter sets the value again on the next start.", { flag: "-" + FLAGS[flagged[0]] })) +
            "</div></div>";
    }

    function settingText(field, label, desc) {
        return '<div class="wz-setting-text"><div class="wz-setting-title">' + esc(label) + flagChip(field) + "</div>" +
            '<div class="wz-setting-desc">' + esc(desc) + "</div></div>";
    }

    function numberRow(field, label, desc, unit) {
        return '<div class="wz-setting">' + settingText(field, label, desc) +
            '<label class="wz-unit-input"><input type="number" min="1" step="1" inputmode="numeric" data-rt="' + field + '"' +
            ' value="' + esc(current()[field]) + '" aria-label="' + esc(label) + '"><span>' + esc(unit) + "</span></label></div>";
    }

    function switchRow(field, label, desc) {
        return '<div class="wz-setting">' + settingText(field, label, desc) +
            '<label class="wz-switch"><input type="checkbox" data-rt="' + field + '"' + (current()[field] ? " checked" : "") +
            ' aria-label="' + esc(label) + '"><span></span></label></div>';
    }

    function advancedHTML() {
        var mb = T("rt/unit/mb", "MB");
        return '<details class="wz-accordion"' + (advancedOpen ? " open" : "") + ">" +
            '<summary><span class="wz-accordion-text">' +
            '<span class="wz-accordion-title">' + esc(T("name/advanced", "Advanced settings")) + "</span>" +
            '<span class="wz-accordion-sub">' + esc(T("name/advanced/desc", "Upload limits, memory buffers and web services. The defaults suit most servers.")) + "</span>" +
            "</span>" + W.icon("chevron", "wz-accordion-chevron") + "</summary>" +
            '<div class="wz-accordion-body">' +
            '<div class="wz-setting-group">' + esc(T("rt/group/upload", "Uploads & files")) + "</div>" +
            '<div class="wz-settings">' +
            numberRow("MaxUploadSize", T("rt/maxUpload", "Max upload size"), T("rt/maxUpload/desc", "Largest single file the web uploader accepts. Must not exceed the memory available on this host."), mb) +
            numberRow("MaxFileUploadBuff", T("rt/uploadBuf", "Upload buffer"), T("rt/uploadBuf/desc", "Uploads larger than this are buffered to disk instead of memory (slower)."), mb) +
            numberRow("FileIOBuffer", T("rt/iobuf", "File I/O buffer"), T("rt/iobuf/desc", "Memory used for each file operation. Default is 1024."), T("rt/unit/bytes", "bytes")) +
            switchRow("EnableGzip", T("rt/gzip", "Compress transfers"), T("rt/gzip/desc", "Gzip text-based files on download. Uses more CPU on small boards.")) +
            "</div>" +
            '<div class="wz-setting-group">' + esc(T("rt/group/web", "Web services")) + "</div>" +
            '<div class="wz-settings">' +
            switchRow("DisableIPResolver", T("rt/ipResolver", "Disable IP resolver"), T("rt/ipResolver/desc", "Do not try to analyze the client IP address. Useful when the server is hosted behind NAT or a reverse proxy.")) +
            switchRow("EnableHomePage", T("rt/homepage", "Personal home pages"), T("rt/homepage/desc", "Allow users to host their own static web pages.")) +
            switchRow("EnableDirListing", T("rt/dirList", "Directory listing"), T("rt/dirList/desc", "List the contents of a folder when the requested URL is a directory.")) +
            "</div>" +
            flagNote(NUMBERS.concat(SWITCHES)) +
            '<div class="wz-hint">' + esc(T("name/advanced/later", "You can change all of these later in System Settings > Runtime.")) + "</div>" +
            "</div></details>";
    }

    //Reads the form into the values to save, marking what cannot be saved
    function collect(el) {
        var value = {};
        var bad = [];
        var v = current();
        value.Hostname = String(v.Hostname == undefined ? "" : v.Hostname).trim();
        if (value.Hostname === "") {
            bad.push("Hostname");
        }
        NUMBERS.forEach(function (field) {
            var n = Number(v[field]);
            if (String(v[field]).trim() === "" || !(n >= 1) || Math.floor(n) !== n) {
                bad.push(field);
            }
            value[field] = n;
        });
        SWITCHES.forEach(function (field) {
            value[field] = !!v[field];
        });
        $(el).find("[data-rt]").each(function () {
            var field = this.getAttribute("data-rt");
            $(this).closest(".wz-unit-input").addBack().toggleClass("invalid", bad.indexOf(field) >= 0);
        });
        return { value: value, bad: bad };
    }

    W.register({
        id: "name",
        title: function () {
            return T("step/name", "Name");
        },
        render: function (el) {
            var v = current();
            el.innerHTML = '<div class="wz-eyebrow">' + esc(T("name/eyebrow", "Server name")) + "</div>" +
                '<h1 class="wz-title">' + esc(T("name/title", "Give your server a name")) + "</h1>" +
                '<p class="wz-lead">' + esc(T("name/lead", "People see this name when they sign in and in the browser tab, and other devices on your network find the server by it.")) + "</p>" +
                '<div class="wz-card"><div class="wz-field">' +
                "<label>" + esc(T("name/field", "Server name")) + flagChip("Hostname") + "</label>" +
                '<input class="wz-input wz-name-input" data-rt="Hostname" maxlength="64" autocomplete="off" spellcheck="false" placeholder="My ArOZ" value="' + esc(v.Hostname) + '">' +
                '<div class="wz-hint">' + esc(T("name/hint", "Network discovery picks up a new name after ArozOS restarts.")) + "</div>" +
                "</div></div>" +
                flagNote(["Hostname"]) +
                advancedHTML();

            $(el).find("[data-rt]").on("input change", function () {
                var field = this.getAttribute("data-rt");
                current()[field] = this.type === "checkbox" ? this.checked : this.value;
                $(this).closest(".wz-unit-input").addBack().removeClass("invalid");
            });
            $(el).find(".wz-accordion").on("toggle", function () {
                advancedOpen = this.open;
            });
            $(el).find(".wz-name-input").on("keydown", function (e) {
                if (e.key === "Enter") {
                    e.preventDefault();
                    W.next();
                }
            });
        },
        leave: function () {
            var el = document.getElementById("wzContent");
            var form = collect(el);
            if (form.bad.length) {
                var advanced = form.bad.some(function (field) { return field !== "Hostname"; });
                if (advanced) {
                    advancedOpen = true;
                    $(el).find(".wz-accordion").prop("open", true);
                }
                $(el).find('[data-rt="' + form.bad[0] + '"]').trigger("focus");
                return Promise.reject(new Error(form.bad[0] === "Hostname"
                    ? T("name/empty", "Enter a name for your server")
                    : T("name/badNumber", "Sizes must be whole numbers larger than zero")));
            }
            var changed = FIELDS.some(function (field) {
                return form.value[field] !== saved()[field];
            });
            if (!changed) {
                return;
            }
            return W.api("POST", "system/bootflags", { opr: "set", value: JSON.stringify(form.value) }).then(function () {
                W.state.runtime = $.extend({}, saved(), form.value);
                W.state.hostname = form.value.Hostname;
                draft = null;
            });
        }
    });
})();
