/*
    Setup Wizard core

    Holds the state, the step list and the navigation. Each step lives in its
    own js/step.*.js file and registers itself with Wizard.register({...}):

        id        unique id, also saved as the current step
        title()   name in the step list
        visible() optional, false to leave the step out (e.g. no accounts
                  step when nobody else uses the server)
        render(el) fills the content area
        leave()   optional, runs on Continue; return a Promise to wait for
                  the server, reject it to stay on the step
        nextLabel() optional label of the Continue button

    What the user chose is kept in Wizard.progress and saved on the server
    after every step (never with a password), so a closed tab resumes where
    it was. Finishing or skipping calls system/setup/finish, which boots the
    admins into the chosen interface and disables this module.
*/

(function () {
    "use strict";

    var LANGUAGE_CODES = ["en-us", "zh-tw", "zh-hk", "zh-cn", "ja-jp", "ko-kr"];

    var W = window.Wizard = {
        state: null,     //system/setup/state
        progress: null,  //what the user chose so far
        steps: [],
        index: 0,
        locale: null,
        busy: false
    };

    /* Text */

    W.T = function (key, fallback, vars) {
        var text = W.locale ? W.locale.getString(key, fallback) : fallback;
        if (vars) {
            Object.keys(vars).forEach(function (name) {
                text = text.split("{" + name + "}").join(vars[name]);
            });
        }
        return text;
    };

    W.esc = function (value) {
        return String(value == undefined ? "" : value)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    };

    W.icon = function (name, extraClass) {
        return window.WizardIcon(name, extraClass);
    };

    W.sizeText = function (bytes) {
        bytes = Number(bytes) || 0;
        if (bytes <= 0) {
            return "0 B";
        }
        var units = ["B", "KB", "MB", "GB", "TB", "PB"];
        var i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)));
        var value = bytes / Math.pow(1000, i);
        return (value >= 100 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10) + " " + units[i];
    };

    //A drive id from a name: "My Photos" -> "my-photos"
    W.suggestId = function (name) {
        return String(name || "").trim().toLowerCase()
            .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 32);
    };

    W.validId = function (id) {
        return /^[A-Za-z0-9_-]{1,64}$/.test(id);
    };

    /* Server */

    function replyError(reply) {
        if (reply && typeof reply === "object" && reply.error !== undefined) {
            return String(reply.error);
        }
        if (typeof reply === "string" && /^Error/i.test(reply)) {
            return reply.replace(/^Error\.?\s*/i, "");
        }
        return "";
    }

    //Calls an endpoint below the web root, resolving with its reply
    W.api = function (method, url, data) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: "../" + url,
                method: method,
                data: data,
                cache: false
            }).done(function (reply) {
                var error = replyError(reply);
                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(reply);
                }
            }).fail(function (xhr) {
                var text = (xhr.responseText || "").trim();
                if (text.charAt(0) === "{") {
                    try {
                        text = replyError(JSON.parse(text)) || text;
                    } catch (e) { }
                }
                if (text.length > 300 || /</.test(text)) {
                    text = "";
                }
                reject(new Error(text || W.T("err/server", "The server did not answer. Check the connection and try again.")));
            });
        });
    };

    W.save = function () {
        return W.api("POST", "system/setup/progress", { progress: JSON.stringify(W.progress) }).catch(function () {
            //Resuming is a convenience: the wizard keeps working without it
        });
    };

    /* Feedback */

    var toastTimer = null;
    W.toast = function (message, bad) {
        var el = document.getElementById("wzToast");
        el.textContent = message;
        el.className = "wz-toast show" + (bad ? " bad" : "");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.className = "wz-toast" + (bad ? " bad" : "");
        }, bad ? 6000 : 3200);
    };

    //Disables a button while a request runs and shows a spinner in it
    W.working = function (button, on) {
        var $b = $(button);
        if (on) {
            $b.prop("disabled", true).data("wz-label", $b.html());
            $b.html('<span class="wz-spinner small"></span> ' + $b.text());
        } else {
            $b.prop("disabled", false);
            if ($b.data("wz-label") !== undefined) {
                $b.html($b.data("wz-label"));
            }
        }
    };

    /*
        A dialog. options: title, icon, body (HTML), actions: [{label, kind
        (primary or danger), onClick(dialog)}]. Escape and the backdrop close
        it. Returns {el, close}.
    */
    W.modal = function (options) {
        var $backdrop = $('<div class="wz-modal-backdrop"></div>');
        var $box = $('<div class="wz-modal" role="dialog" aria-modal="true"></div>');
        $box.append("<h2>" + (options.icon ? W.icon(options.icon) : "") + "<span>" + W.esc(options.title) + "</span></h2>");
        $box.append($("<div></div>").html(options.body || ""));
        var $actions = $('<div class="wz-modal-actions"></div>');
        var dialog = {
            el: $box[0],
            close: function () {
                $backdrop.remove();
                $(document).off("keydown.wzmodal");
            }
        };
        (options.actions || []).forEach(function (action) {
            var $btn = $('<button type="button" class="wz-btn"></button>').addClass(action.kind || "").text(action.label);
            $btn.on("click", function () {
                action.onClick ? action.onClick(dialog, this) : dialog.close();
            });
            $actions.append($btn);
        });
        $box.append($actions);
        $backdrop.append($box).appendTo(document.body);
        W.linkLabels($box[0]);
        $backdrop.on("mousedown", function (e) {
            if (e.target === $backdrop[0]) {
                dialog.close();
            }
        });
        $(document).on("keydown.wzmodal", function (e) {
            if (e.key === "Escape") {
                dialog.close();
            }
        });
        setTimeout(function () {
            var first = $box.find("input, select").first();
            (first.length ? first : $box.find(".wz-btn").last()).trigger("focus");
        }, 30);
        return dialog;
    };

    //Ties each field label to its input, so screen readers name the input
    var labelSeq = 0;
    W.linkLabels = function (root) {
        $(root).find(".wz-field").each(function () {
            var $label = $(this).children("label").first();
            var $input = $(this).children("input, select").first();
            if (!$label.length || !$input.length || $label.attr("for")) {
                return;
            }
            var id = $input.attr("id") || ("wzField" + (++labelSeq));
            $input.attr("id", id);
            $label.attr("for", id);
        });
    };

    /* Steps */

    W.register = function (step) {
        W.steps.push(step);
    };

    function visibleSteps() {
        return W.steps.filter(function (step) {
            return !step.visible || step.visible();
        });
    }

    W.currentStep = function () {
        return visibleSteps()[W.index];
    };

    function isDone(id) {
        return W.progress.done.indexOf(id) >= 0;
    }

    function markDone(id) {
        if (!isDone(id)) {
            W.progress.done.push(id);
        }
    }

    //Runs the current step's leave(), then calls onLeft unless it refused
    function leaveCurrent(onLeft) {
        if (W.busy) {
            return;
        }
        var step = W.currentStep();
        var result = step.leave ? step.leave() : null;
        var left = function () {
            markDone(step.id);
            onLeft(step);
        };
        if (result && typeof result.then === "function") {
            setBusy(true);
            result.then(function () {
                setBusy(false);
                left();
            }, function (err) {
                setBusy(false);
                if (err && err.message) {
                    W.toast(err.message, true);
                }
            });
        } else if (result !== false) {
            left();
        }
    }

    function showStep(index) {
        var steps = visibleSteps();
        W.index = Math.max(0, Math.min(index, steps.length - 1));
        W.progress.step = steps[W.index].id;
        W.save();
        W.render();
    }

    //Moves to a step from the step list. Going forward saves the current
    //step first, like Continue does.
    W.go = function (id) {
        var target = visibleSteps().map(function (s) { return s.id; }).indexOf(id);
        if (target < 0 || target === W.index || W.busy) {
            return;
        }
        if (target < W.index) {
            showStep(target);
            return;
        }
        leaveCurrent(function () {
            //The step may have changed which steps follow
            var now = visibleSteps().map(function (s) { return s.id; }).indexOf(id);
            showStep(now >= 0 ? now : W.index + 1);
        });
    };

    W.next = function () {
        leaveCurrent(function (step) {
            var steps = visibleSteps();
            var at = steps.indexOf(step);
            if (at >= 0 && at < steps.length - 1) {
                showStep(at + 1);
            }
        });
    };

    W.back = function () {
        if (W.busy || W.index === 0) {
            return;
        }
        showStep(W.index - 1);
    };

    function setBusy(on) {
        W.busy = on;
        W.working(document.getElementById("wzNext"), on);
        $("#wzBack").prop("disabled", on);
    }

    /* Rendering */

    //Two digit step numbers, as the step list and the eyebrows show them
    function stepNumber(index) {
        return (index < 9 ? "0" : "") + (index + 1);
    }

    //The step list on the side, and the step count on narrow screens
    W.renderStepList = function () {
        var steps = visibleSteps();
        var $list = $("#wzSteps").empty();
        steps.forEach(function (s, i) {
            var done = isDone(s.id) && i !== W.index;
            //Back to any step, forward to a step already done or the next one
            var reachable = i !== W.index && (i < W.index || isDone(s.id) || i === W.index + 1);
            var $li = $("<li></li>")
                .toggleClass("done", done)
                .toggleClass("current", i === W.index)
                .toggleClass("reachable", reachable)
                .attr("aria-current", i === W.index ? "step" : null)
                .html('<span class="wz-step-dot">' + (done ? W.icon("check") : stepNumber(i)) + '</span><span class="wz-step-name">' + W.esc(s.title()) + "</span>");
            if (reachable) {
                $li.on("click", function () {
                    if (!W.busy) {
                        W.go(s.id);
                    }
                });
            }
            $list.append($li);
        });
        $("#wzSideTitle").text(W.T("side/title", "Set up your server"));
        $("#wzSideHost").text(W.state.hostname || "");
        $("#wzMobileCount").text(W.T("nav/count", "Step {n} of {total}", { n: W.index + 1, total: steps.length }));
        $("#wzProgressBar").css("width", Math.round((W.index + 1) / steps.length * 100) + "%");
        window.WizardFillIcons($list[0]);
    };

    W.render = function () {
        var steps = visibleSteps();
        if (W.index >= steps.length) {
            W.index = steps.length - 1;
        }
        var step = steps[W.index];
        var last = W.index === steps.length - 1;

        W.renderStepList();
        document.title = W.T("app/title", "Setup Wizard") + " - " + step.title();

        //Navigation
        $("#wzBack").html(W.icon("arrowLeft") + "<span>" + W.esc(W.T("nav/back", "Back")) + "</span>").toggleClass("wz-hidden", W.index === 0);
        $("#wzSkip").text(W.T("nav/skip", "Skip setup")).toggleClass("wz-hidden", last);
        var label = step.nextLabel ? step.nextLabel() : (last ? W.T("nav/finish", "Finish") : W.T("nav/continue", "Continue"));
        $("#wzNext").html("<span>" + W.esc(label) + "</span>" + (last ? W.icon("check") : W.icon("arrowRight"))).prop("disabled", false);

        //Content
        var content = document.getElementById("wzContent");
        $(content).empty().css("animation", "none");
        content.offsetHeight; //restart the entrance animation
        $(content).css("animation", "");
        step.render(content);
        $(content).find(".wz-eyebrow").first().prepend('<span class="wz-eyebrow-num">' + stepNumber(W.index) + "</span>");
        document.getElementById("wzScroll").scrollTop = 0;
        window.WizardFillIcons(document);
    };

    //Lets a step change the Continue label after it rendered
    W.setNextLabel = function (label) {
        $("#wzNext span").first().text(label);
    };

    /* Skipping */

    W.skip = function () {
        if (W.busy) {
            return;
        }
        //A first run goes to the desktop. An admin who opened the wizard again
        //keeps the workspace they already have.
        var target = (!W.state.active && W.state.adminInterface) ? W.state.adminInterface : "Desktop";
        ssConfirm({
            title: W.T("skip/title", "Skip the setup?"),
            text: W.state.active
                ? W.T("skip/text", "You will go straight to the web desktop. Everything the wizard covers can be set up later in System Settings.")
                : W.T("skip/text/rerun", "You will go back to your workspace. What you already set up stays as it is."),
            confirmLabel: W.T("skip/confirm", "Skip setup"),
            cancelLabel: W.T("skip/cancel", "Keep going")
        }, function () {
            W.api("POST", "system/setup/finish", { interface: target }).then(function () {
                window.location.href = "../";
            }, function (err) {
                W.toast(err.message, true);
            });
        });
    };

    /* Language */

    function buildLanguageSelect() {
        var $select = $(".wz-lang-select").empty();
        var keys = (W.locale && W.locale.localData && W.locale.localData.keys) || {};
        var stored = "default";
        try {
            stored = localStorage.getItem("global_language") || "default";
        } catch (e) { }
        $select.append($("<option></option>").val("default").text(W.T("lang/default", "Browser language")));
        LANGUAGE_CODES.forEach(function (code) {
            var name = keys[code] && keys[code].name ? keys[code].name : code;
            $select.append($("<option></option>").val(code).text(name));
        });
        $select.val($select.first().find('option[value="' + stored + '"]').length ? stored : "default");
        $select.attr("aria-label", W.T("lang/label", "Language"));
    }

    function changeLanguage(code) {
        try {
            localStorage.setItem("global_language", code);
        } catch (e) { }
        W.locale.lang = (code === "default" ? navigator.language : code).toLowerCase();
        document.documentElement.lang = W.locale.lang;
        try {
            if (typeof applocaleLinkFonts === "function" && W.locale.localData.keys) {
                applocaleLinkFonts(W.locale.localeFile, W.locale.localData.keys[W.locale.lang]);
            }
        } catch (e) { }
        buildLanguageSelect();
        renderThemeButton();
        W.render();
    }

    /* Light / dark */

    var THEME_KEY = "aroz_setup_theme"; //shared with the first-user page (user.html)

    function isDark() {
        var picked = document.documentElement.getAttribute("data-theme");
        if (picked) {
            return picked === "dark";
        }
        return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    }

    //The button shows the theme it switches to
    function renderThemeButton() {
        var dark = isDark();
        var label = dark ? W.T("theme/light", "Switch to light theme") : W.T("theme/dark", "Switch to dark theme");
        $(".wz-theme-btn").html(W.icon(dark ? "sun" : "moon")).attr({ "aria-label": label, title: label });
    }

    function toggleTheme() {
        var next = isDark() ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
            localStorage.setItem(THEME_KEY, next);
        } catch (e) { }
        renderThemeButton();
    }

    /* Start */

    function defaultProgress() {
        return {
            step: "welcome",
            done: [],
            interface: "",
            drives: [],      //drives the wizard added: {uuid, name, kind, path}
            network: "",     //"no" or "yes"
            people: "",      //"me", "admins" or "group"
            group: null,     //{name, quota, modules, interface, saved}
            accounts: [],    //usernames the wizard created
            access: {},      //drive uuid -> readwrite, readonly or admins
            sharing: {}      //file server id -> true when the wizard turned it on
        };
    }

    function showFatal(message) {
        $("#wzContent").html(
            '<div class="wz-hero">' + W.icon("warning") + "</div>" +
            '<h1 class="wz-title">' + W.esc(W.T("err/title", "The setup could not start")) + "</h1>" +
            '<p class="wz-lead">' + W.esc(message) + "</p>" +
            '<button type="button" class="wz-btn primary" id="wzRetry">' + W.icon("refresh") + "<span>" + W.esc(W.T("err/retry", "Try again")) + "</span></button>");
        $("#wzRetry").on("click", loadState);
        $("#wzNav").addClass("wz-hidden");
        buildLanguageSelect();
    }

    function loadState() {
        $("#wzNav").removeClass("wz-hidden");
        W.api("GET", "system/setup/state").then(function (state) {
            W.state = state;
            W.progress = $.extend(defaultProgress(), state.progress && typeof state.progress === "object" ? state.progress : {});
            var names = state.interfaces.map(function (i) { return i.name; });
            if (names.indexOf(W.progress.interface) < 0) {
                W.progress.interface = names.indexOf(state.adminInterface) >= 0 ? state.adminInterface : (names[0] || "Desktop");
            }
            buildLanguageSelect();
            W.index = 0;
            var steps = visibleSteps();
            for (var i = 0; i < steps.length; i++) {
                if (steps[i].id === W.progress.step) {
                    W.index = i;
                }
            }
            W.render();
        }, function (err) {
            showFatal(err.message);
        });
    }

    W.start = function () {
        window.WizardFillIcons(document);
        //Steps redraw their forms after each change: label them as they appear
        var content = document.getElementById("wzContent");
        new MutationObserver(function () {
            W.linkLabels(content);
        }).observe(content, { childList: true, subtree: true });
        $("#wzNext").on("click", W.next);
        $("#wzBack").on("click", W.back);
        $("#wzSkip").on("click", W.skip);
        $(".wz-theme-btn").on("click", function (e) {
            e.preventDefault();
            toggleTheme();
        });
        renderThemeButton();
        if (window.matchMedia) {
            //Until the toggle is used, the page follows the browser
            var scheme = window.matchMedia("(prefers-color-scheme: dark)");
            (scheme.addEventListener ? scheme.addEventListener.bind(scheme, "change") : scheme.addListener.bind(scheme))(renderThemeButton);
        }
        $(".wz-lang-select").on("change", function () {
            changeLanguage($(this).val());
        });

        W.locale = NewAppLocale();
        document.documentElement.lang = W.locale.lang;
        W.locale.init("locale/setup_wizard.json", loadState, loadState);
    };
})();
