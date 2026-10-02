/*
    Mail — account wizard and account settings

    Adding an account: pick a provider, enter the address, then sign in with
    the provider (OAuth, when the administrator configured it) or with an
    app password. The server verifies IMAP and SMTP before anything is
    stored. Server settings are pre-filled from the provider presets or from
    auto-discovery and stay editable under "Advanced".
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.accounts = (function () {
    "use strict";
    var util = Mail.util;
    var ui = Mail.ui;
    var api = Mail.api;
    var el = util.el;
    var icon = util.icon;

    var presets = null;
    var oauthProviders = null;
    var COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#64748b"];
    var TILES = ["gmail", "outlook", "office365", "yahoo", "icloud", "custom"];

    function loadPresets() {
        if (presets && oauthProviders) {
            return Promise.resolve();
        }
        return Promise.all([
            api.accounts("providers", {}),
            api.accounts("oauthProviders", {})
        ]).then(function (results) {
            presets = results[0] || [];
            oauthProviders = {};
            (results[1] || []).forEach(function (provider) { oauthProviders[provider.id] = provider; });
        });
    }

    function presetById(id) {
        return (presets || []).filter(function (preset) { return preset.id === id; })[0] || null;
    }

    function oauthFor(preset) {
        if (!preset || !preset.oauth || !oauthProviders) {
            return null;
        }
        var provider = oauthProviders[preset.oauth];
        return provider && provider.enabled ? provider : null;
    }

    function redirectURI() {
        var root = (typeof ao_root === "string" && ao_root) ? ao_root : "../";
        return new URL(root + "Mail/oauth.html", window.location.href).href.split("#")[0].split("?")[0];
    }

    /* ---------- Server settings form ---------- */

    function serverFields(title, server) {
        var host = el("input", { class: "input", type: "text", value: server.host || "", placeholder: "mail.example.com", spellcheck: "false" });
        var port = el("input", { class: "input", type: "number", value: server.port || "", min: "1", max: "65535" });
        var security = el("select", { class: "select" }, [
            el("option", { value: "ssl", text: "SSL / TLS" }),
            el("option", { value: "starttls", text: "STARTTLS" }),
            el("option", { value: "none", text: "None (unencrypted)" })
        ]);
        security.value = server.security || "ssl";
        var username = el("input", { class: "input", type: "text", value: server.username || "", spellcheck: "false", autocomplete: "off" });
        var box = el("div", { class: "server-box" }, [
            el("div", { class: "box-title", text: title }),
            el("div", { class: "row" }, [
                el("div", { class: "field", style: { flex: "3" } }, [el("label", { text: "Server" }), host]),
                el("div", { class: "field", style: { flex: "1" } }, [el("label", { text: "Port" }), port])
            ]),
            el("div", { class: "row" }, [
                el("div", { class: "field" }, [el("label", { text: "Security" }), security]),
                el("div", { class: "field" }, [el("label", { text: "Username" }), username])
            ])
        ]);
        return {
            el: box,
            value: function () {
                return { host: host.value.trim(), port: parseInt(port.value, 10) || 0, security: security.value, username: username.value.trim() };
            },
            set: function (value) {
                host.value = value.host || "";
                port.value = value.port || "";
                security.value = value.security || "ssl";
                username.value = value.username || "";
            }
        };
    }

    function passwordInput(placeholder) {
        var input = el("input", { class: "input", type: "password", placeholder: placeholder || "", autocomplete: "new-password", spellcheck: "false" });
        var toggle = el("button", { class: "iconbtn small", type: "button", title: "Show password", style: { position: "absolute", right: "5px", top: "5px" } }, icon("eye"));
        toggle.addEventListener("click", function () {
            input.type = input.type === "password" ? "text" : "password";
            toggle.firstChild.className = (input.type === "password" ? "eye" : "eye slash") + " icon";
        });
        return { el: el("div", { style: { position: "relative" } }, [input, toggle]), input: input };
    }

    /* ---------- OAuth ---------- */

    //runOAuth drives a sign-in in the given container and resolves with the
    //pending sign-in state once the provider confirmed it
    function runOAuth(container, providerId, address) {
        return new Promise(function (resolve, reject) {
            var stopped = false;
            var poller = null;
            var channel = null;
            var popup = null;
            var finish = function (error, state, emailAddress) {
                if (stopped) {
                    return;
                }
                stopped = true;
                clearInterval(poller);
                if (channel) {
                    channel.close();
                }
                if (popup && !popup.closed) {
                    try { popup.close(); } catch (e) { /* cross origin */ }
                }
                if (error) {
                    reject(error);
                } else {
                    resolve({ state: state, email: emailAddress });
                }
            };

            util.clear(container);
            container.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), el("div", { text: "Starting sign-in…" })]));

            api.accounts("oauthStart", { provider: providerId, email: address, redirectUri: redirectURI() }).then(function (start) {
                util.clear(container);
                var statusLine = el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), el("div", { text: "Waiting for you to finish signing in…" })]);
                var cancel = el("button", { class: "btn", text: "Cancel" });
                cancel.addEventListener("click", function () {
                    api.accounts("oauthCancel", { state: start.state }).catch(function () { });
                    finish(new Error("Sign-in cancelled"));
                });

                var poll = function () {
                    api.accounts("oauthStatus", { state: start.state }).then(function (status) {
                        if (status.status === "done") {
                            finish(null, start.state, status.email);
                        } else if (status.status === "error") {
                            finish(new Error(status.error || "Sign-in failed"));
                        }
                    }).catch(function (error) {
                        finish(error);
                    });
                };
                poller = setInterval(poll, 2500);

                if (start.flow === "device") {
                    var codeBox = el("div", { class: "device-code", text: start.userCode });
                    var copyButton = el("button", { class: "btn small" }, [icon("copy outline"), "Copy code"]);
                    copyButton.addEventListener("click", function () {
                        if (navigator.clipboard) {
                            navigator.clipboard.writeText(start.userCode).then(function () { ui.toast("Code copied"); });
                        }
                    });
                    var openButton = el("button", { class: "btn primary" }, [icon("external alternate"), "Open sign-in page"]);
                    openButton.addEventListener("click", function () {
                        window.open(start.verificationUri, "_blank", "noopener");
                    });
                    container.appendChild(el("p", { text: "Open the Microsoft sign-in page, enter this code and sign in with " + (address || "your account") + "." }));
                    container.appendChild(codeBox);
                    container.appendChild(el("div", { style: { display: "flex", gap: "8px", justifyContent: "center", marginBottom: "12px" } }, [openButton, copyButton]));
                    container.appendChild(statusLine);
                    container.appendChild(el("div", { style: { textAlign: "right" } }, cancel));
                    return;
                }

                popup = window.open(start.authUrl, "aroz-mail-oauth", "width=520,height=720");
                if (start.flow === "loopback") {
                    var pasted = el("input", { class: "input", type: "text", placeholder: "http://127.0.0.1:53682/?state=…&code=…", spellcheck: "false" });
                    var complete = el("button", { class: "btn primary", text: "Finish sign-in" });
                    complete.addEventListener("click", function () {
                        complete.disabled = true;
                        api.accounts("oauthComplete", { state: start.state, code: pasted.value.trim() }).then(function (status) {
                            finish(null, start.state, status.email);
                        }).catch(function (error) {
                            complete.disabled = false;
                            ui.errorToast(error);
                        });
                    });
                    container.appendChild(el("p", { text: "Sign in in the window that opened. Afterwards your browser shows an error page at 127.0.0.1 — that is expected. Copy the full address of that page and paste it here:" }));
                    container.appendChild(el("div", { class: "field" }, pasted));
                    container.appendChild(el("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } }, [
                        el("button", { class: "btn", text: "Reopen window", on: { click: function () { popup = window.open(start.authUrl, "aroz-mail-oauth", "width=520,height=720"); } } }),
                        cancel, complete
                    ]));
                    return;
                }

                //Redirect flow: oauth.html finishes the exchange and broadcasts
                if (window.BroadcastChannel) {
                    channel = new BroadcastChannel("arozos-mail-oauth");
                    channel.onmessage = function (event) {
                        if (event.data && event.data.state === start.state) {
                            poll();
                        }
                    };
                }
                container.appendChild(el("p", { text: "A sign-in window has opened. Finish signing in there; this dialog continues automatically." }));
                if (!popup) {
                    container.appendChild(el("div", { class: "notice warning" }, [icon("exclamation triangle"), el("div", { text: "Your browser blocked the pop-up window. Use the button below to open it." })]));
                }
                container.appendChild(statusLine);
                container.appendChild(el("div", { style: { display: "flex", gap: "8px", justifyContent: "flex-end" } }, [
                    el("button", { class: "btn", text: "Open sign-in window", on: { click: function () { popup = window.open(start.authUrl, "aroz-mail-oauth", "width=520,height=720"); } } }),
                    cancel
                ]));
            }).catch(function (error) {
                finish(error);
            });
        });
    }

    /* ---------- Wizard ---------- */

    //openWizard adds an account; onDone(account) is called on success
    function openWizard(onDone) {
        var body = el("div");
        var dialog = ui.modal({ title: "Add mail account", subtitle: "Connect Gmail, Outlook, Yahoo, iCloud or any IMAP mailbox", wide: true, body: body, clickOutside: false });
        var wizard = { preset: null, email: "", name: "", discovered: null };

        util.clear(body);
        body.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), "Loading providers…"]));
        loadPresets().then(function () {
            stepProvider();
        }).catch(function (error) {
            util.clear(body);
            body.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: error.message })]));
        });

        function stepProvider() {
            util.clear(body);
            dialog.setTitle("Add mail account");
            var grid = el("div", { class: "provider-grid" });
            TILES.forEach(function (id) {
                var preset = presetById(id);
                if (!preset) {
                    return;
                }
                var tile = el("button", { class: "provider-tile", type: "button" }, [
                    el("i", { class: preset.icon + " icon", style: { color: preset.color } }),
                    el("div", { class: "pname", text: preset.id === "custom" ? "Other (IMAP)" : preset.name })
                ]);
                tile.addEventListener("click", function () { choose(preset); });
                grid.appendChild(tile);
            });
            body.appendChild(grid);

            var others = (presets || []).filter(function (preset) { return TILES.indexOf(preset.id) < 0; });
            if (others.length > 0) {
                var more = el("div", { class: "advanced-toggle", style: { marginTop: "14px" } }, [icon("caret right"), "More providers"]);
                var list = el("div", { class: "hidden", style: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" } });
                others.forEach(function (preset) {
                    list.appendChild(el("button", { class: "btn small", type: "button", text: preset.name, on: { click: function () { choose(preset); } } }));
                });
                more.addEventListener("click", function () {
                    list.classList.toggle("hidden");
                    more.firstChild.className = (list.classList.contains("hidden") ? "caret right" : "caret down") + " icon";
                });
                body.appendChild(more);
                body.appendChild(list);
            }
            body.appendChild(el("p", { class: "muted", style: { marginTop: "18px", fontSize: "12.5px" }, text: "Your password or sign-in is stored encrypted on this ArozOS server and is only used to connect to your mailbox." }));
        }

        function choose(preset) {
            wizard.preset = preset;
            stepAddress();
        }

        function chosenHeader() {
            var preset = wizard.preset;
            return el("div", { class: "provider-chosen" }, [
                el("i", { class: preset.icon + " icon", style: { color: preset.color } }),
                el("div", { class: "grow" }, [
                    el("div", { style: { fontWeight: "600" }, text: preset.id === "custom" ? "Other mail account" : preset.name }),
                    wizard.email ? el("div", { class: "muted", text: wizard.email }) : null
                ]),
                el("button", { class: "btn small ghost", text: "Change", on: { click: stepProvider } })
            ]);
        }

        function stepAddress() {
            util.clear(body);
            body.appendChild(chosenHeader());
            var nameInput = el("input", { class: "input", type: "text", value: wizard.name, placeholder: "Your name as recipients will see it", autocomplete: "name" });
            var emailInput = el("input", { class: "input", type: "email", value: wizard.email, placeholder: wizard.preset.domains && wizard.preset.domains[0] ? "you@" + wizard.preset.domains[0] : "you@example.com", autocomplete: "email", autofocus: true });
            var error = el("div", { class: "help", style: { color: "var(--danger)" } });
            body.appendChild(el("div", { class: "field" }, [el("label", { text: "Email address" }), emailInput, error]));
            body.appendChild(el("div", { class: "field" }, [el("label", { text: "Your name" }), nameInput]));
            var back = el("button", { class: "btn", text: "Back", on: { click: stepProvider } });
            var next = el("button", { class: "btn primary", text: "Continue" });
            body.appendChild(el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" } }, [back, next]));
            setTimeout(function () { emailInput.focus(); }, 30);

            var proceed = function () {
                var address = emailInput.value.trim();
                if (!util.isValidEmail(address)) {
                    error.textContent = "Please enter a valid email address.";
                    emailInput.classList.add("invalid");
                    return;
                }
                wizard.email = address;
                wizard.name = nameInput.value.trim();
                next.disabled = true;
                next.textContent = "Checking…";
                api.accounts("discover", { email: address }).then(function (result) {
                    wizard.discovered = result;
                    //An address hosted by a known provider (by domain or MX)
                    //uses that provider's settings and sign-in
                    if (result.provider && result.provider !== "custom" && result.provider !== wizard.preset.id) {
                        var detected = presetById(result.provider);
                        if (detected) {
                            wizard.preset = detected;
                        }
                    }
                    stepSignIn();
                }).catch(function () {
                    wizard.discovered = null;
                    stepSignIn();
                });
            };
            next.addEventListener("click", proceed);
            emailInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { proceed(); } });
            nameInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { proceed(); } });
        }

        function stepSignIn() {
            util.clear(body);
            var preset = wizard.preset;
            body.appendChild(chosenHeader());

            var imapDefaults = (wizard.discovered && wizard.discovered.imap && wizard.discovered.imap.host) ? wizard.discovered.imap : preset.imap;
            var smtpDefaults = (wizard.discovered && wizard.discovered.smtp && wizard.discovered.smtp.host) ? wizard.discovered.smtp : preset.smtp;
            var username = preset.usernameStyle === "localpart" ? wizard.email.split("@")[0] : wizard.email;
            var imapForm = serverFields("Incoming mail (IMAP)", { host: imapDefaults.host, port: imapDefaults.port, security: imapDefaults.security, username: imapDefaults.username || username });
            var smtpForm = serverFields("Outgoing mail (SMTP)", { host: smtpDefaults.host, port: smtpDefaults.port, security: smtpDefaults.security, username: smtpDefaults.username || username });
            var separateSMTP = el("input", { type: "checkbox" });
            var smtpPassword = passwordInput("SMTP password");
            var smtpPasswordField = el("div", { class: "field hidden" }, [el("label", { text: "SMTP password" }), smtpPassword.el]);
            separateSMTP.addEventListener("change", function () { smtpPasswordField.classList.toggle("hidden", !separateSMTP.checked); });
            var skipSMTP = el("input", { type: "checkbox" });

            var advanced = el("div", { class: "hidden" }, [
                imapForm.el, smtpForm.el,
                el("label", { class: "checkline" }, [separateSMTP, el("span", { text: "Use a different password for sending" })]),
                smtpPasswordField,
                el("label", { class: "checkline" }, [skipSMTP, el("span", {}, ["Skip the outgoing server check", el("span", { class: "desc", text: "For servers that only allow sending from certain networks." })])])
            ]);
            var advancedToggle = el("div", { class: "advanced-toggle" }, [icon("caret right"), "Advanced server settings"]);
            var openAdvanced = function (open) {
                advanced.classList.toggle("hidden", !open);
                advancedToggle.firstChild.className = (open ? "caret down" : "caret right") + " icon";
            };
            advancedToggle.addEventListener("click", function () { openAdvanced(advanced.classList.contains("hidden")); });
            if (preset.id === "custom" && (!wizard.discovered || !wizard.discovered.verified)) {
                openAdvanced(true);
            }

            var oauth = oauthFor(preset);
            var passwordArea = el("div");
            var statusArea = el("div");

            if (oauth) {
                var oauthButton = el("button", { class: "oauth-btn", type: "button" }, [
                    el("i", { class: (preset.oauth === "google" ? "google" : "microsoft") + " icon", style: { color: preset.color } }),
                    "Sign in with " + oauth.name
                ]);
                oauthButton.addEventListener("click", function () { signInWithOAuth(oauth, imapForm, smtpForm, statusArea); });
                body.appendChild(oauthButton);
                body.appendChild(el("div", { class: "or-sep", text: preset.oauth === "microsoft" ? "or, if your account still allows it" : "or use an app password" }));
            } else if (preset.oauth) {
                body.appendChild(el("div", { class: "notice " + (preset.oauth === "microsoft" ? "warning" : ""), style: { marginBottom: "14px" } }, [
                    icon(preset.oauth === "microsoft" ? "exclamation triangle" : "info circle"),
                    el("div", {
                        text: preset.oauth === "microsoft"
                            ? "Microsoft normally requires \"Sign in with Microsoft\", which has not been set up on this server yet. Ask your ArozOS administrator to enable it under Mail settings › Administration. You can still try an app password below."
                            : "\"Sign in with Google\" is not set up on this server, so use an app password below. An administrator can enable Google sign-in under Mail settings › Administration."
                    })
                ]));
            }

            var help = el("div", { class: "notice", style: { marginBottom: "12px" } }, [icon("key"), el("div", { class: "grow" }, [
                el("div", { text: preset.passwordHelp }),
                preset.passwordUrl ? el("div", { class: "actions" }, el("a", { class: "btn small", href: preset.passwordUrl, target: "_blank", rel: "noopener noreferrer" }, [icon("external alternate"), "Open " + (preset.passwordLabel || "password") + " page"])) : null
            ])]);
            var password = passwordInput(preset.passwordLabel || "Password");
            passwordArea.appendChild(help);
            passwordArea.appendChild(el("div", { class: "field" }, [el("label", { text: preset.passwordLabel || "Password" }), password.el]));
            body.appendChild(passwordArea);
            body.appendChild(advancedToggle);
            body.appendChild(advanced);
            body.appendChild(statusArea);

            var back = el("button", { class: "btn", text: "Back", on: { click: stepAddress } });
            var connect = el("button", { class: "btn primary" }, [icon("plug"), "Connect"]);
            body.appendChild(el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" } }, [back, connect]));
            setTimeout(function () { password.input.focus(); }, 40);

            var submit = function () {
                if (password.input.value === "") {
                    password.input.classList.add("invalid");
                    password.input.focus();
                    return;
                }
                var account = {
                    email: wizard.email, displayName: wizard.name, provider: preset.id,
                    imap: imapForm.value(), smtp: smtpForm.value(), auth: "password",
                    password: password.input.value, smtpPassword: separateSMTP.checked ? smtpPassword.input.value : "",
                    saveSent: "auto", skipSmtpCheck: skipSMTP.checked
                };
                connect.disabled = true;
                back.disabled = true;
                addAccount(account, statusArea).then(function (info) {
                    stepDone(info);
                }).catch(function (error) {
                    connect.disabled = false;
                    back.disabled = false;
                    if (!error.authFailed) {
                        openAdvanced(true);
                    }
                });
            };
            connect.addEventListener("click", submit);
            password.input.addEventListener("keydown", function (event) { if (event.key === "Enter") { submit(); } });
        }

        function signInWithOAuth(oauth, imapForm, smtpForm, statusArea) {
            var preset = wizard.preset;
            var area = el("div");
            util.clear(body);
            body.appendChild(chosenHeader());
            body.appendChild(area);
            runOAuth(area, oauth.id, wizard.email).then(function (signedIn) {
                util.clear(area);
                var account = {
                    email: signedIn.email || wizard.email, displayName: wizard.name, provider: preset.id,
                    imap: imapForm.value(), smtp: smtpForm.value(), auth: "oauth2", oauthState: signedIn.state, saveSent: "auto"
                };
                if (signedIn.email && signedIn.email.toLowerCase() !== wizard.email.toLowerCase()) {
                    account.imap.username = signedIn.email;
                    account.smtp.username = signedIn.email;
                }
                addAccount(account, area).then(stepDone).catch(function () {
                    area.appendChild(el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" } }, [
                        el("button", { class: "btn", text: "Back", on: { click: stepSignIn } })
                    ]));
                });
            }).catch(function (error) {
                util.clear(area);
                area.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: error.message })]));
                area.appendChild(el("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" } }, [
                    el("button", { class: "btn", text: "Back", on: { click: stepSignIn } })
                ]));
            });
        }

        function addAccount(account, statusArea) {
            util.clear(statusArea);
            statusArea.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), el("div", { text: "Connecting to " + (account.imap.host || "your mail server") + "…" })]));
            return api.accounts("add", { account: account }).then(function (result) {
                util.clear(statusArea);
                return result.account;
            }).catch(function (error) {
                util.clear(statusArea);
                var details = error.details || {};
                var stage = details.test && details.test.stage === "smtp" ? "Outgoing server (SMTP): " : (details.test && details.test.stage === "imap" ? "Incoming server (IMAP): " : "");
                var content = el("div", { class: "grow" }, [el("div", { text: stage + error.message })]);
                if (error.hint) {
                    content.appendChild(el("div", { style: { marginTop: "6px", fontWeight: "500" }, text: error.hint }));
                }
                if (error.code === "blocked") {
                    content.appendChild(el("div", { style: { marginTop: "6px" }, text: "Your administrator only allows mail servers on the public internet with encrypted connections." }));
                }
                statusArea.appendChild(el("div", { class: "notice danger", style: { margin: "10px 0" } }, [icon("exclamation circle"), content]));
                throw error;
            });
        }

        function stepDone(info) {
            util.clear(body);
            dialog.setTitle("All set");
            body.appendChild(el("div", { style: { textAlign: "center", padding: "20px 10px" } }, [
                el("i", { class: "check circle icon", style: { fontSize: "46px", color: "var(--success)", height: "auto" } }),
                el("h3", { style: { margin: "14px 0 6px", fontWeight: "600" }, text: info.email + " is connected" }),
                el("p", { class: "muted", text: "Your mail will appear in a moment." })
            ]));
            body.appendChild(el("div", { style: { display: "flex", justifyContent: "center", gap: "8px" } }, [
                el("button", { class: "btn", text: "Add another account", on: { click: function () { wizard = { preset: null, email: "", name: "", discovered: null }; stepProvider(); } } }),
                el("button", { class: "btn primary", text: "Done", on: { click: function () { dialog.close(); } } })
            ]));
            if (onDone) {
                onDone(info);
            }
        }
    }

    /* ---------- Account settings ---------- */

    function signatureEditor(html) {
        var editor = el("div", { class: "signature-editor", contenteditable: "true" });
        editor.innerHTML = html || "";
        var bar = el("div", { class: "format-bar", style: { border: "none", padding: "0 0 6px" } });
        var command = function (name, value) {
            editor.focus();
            document.execCommand(name, false, value || null);
        };
        [["bold", "bold"], ["italic", "italic"], ["underline", "underline"]].forEach(function (item) {
            bar.appendChild(el("button", { class: "iconbtn", type: "button", title: item[0], on: { mousedown: function (event) { event.preventDefault(); }, click: function () { command(item[1]); } } }, icon(item[0])));
        });
        bar.appendChild(el("button", {
            class: "iconbtn", type: "button", title: "Link", on: {
                mousedown: function (event) { event.preventDefault(); },
                click: function () {
                    var selection = window.getSelection();
                    var range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
                    ui.prompt("Insert link", "Web address", "https://").then(function (url) {
                        if (url) {
                            editor.focus();
                            if (range) {
                                selection.removeAllRanges();
                                selection.addRange(range);
                            }
                            command("createLink", url);
                        }
                    });
                }
            }
        }, icon("linkify")));
        bar.appendChild(el("button", {
            class: "iconbtn", type: "button", title: "Insert image", on: {
                mousedown: function (event) { event.preventDefault(); },
                click: function () {
                    var input = el("input", { type: "file", accept: "image/*" });
                    input.addEventListener("change", function () {
                        var file = input.files[0];
                        if (!file) {
                            return;
                        }
                        if (file.size > 512 * 1024) {
                            ui.toast("Signature images must be smaller than 512 KB", { error: true });
                            return;
                        }
                        var reader = new FileReader();
                        reader.onload = function () { command("insertImage", reader.result); };
                        reader.readAsDataURL(file);
                    });
                    input.click();
                }
            }
        }, icon("image outline")));
        bar.appendChild(el("button", { class: "iconbtn", type: "button", title: "Clear formatting", on: { mousedown: function (event) { event.preventDefault(); }, click: function () { command("removeFormat"); } } }, icon("eraser")));
        return { el: el("div", {}, [bar, editor]), value: function () { return editor.innerHTML.trim() === "<br>" ? "" : editor.innerHTML.trim(); } };
    }

    //openSettings edits one account. handlers: {onSaved, onRemoved}
    function openSettings(account, handlers) {
        handlers = handlers || {};
        loadPresets().catch(function () { }).then(function () {
            var body = el("div");
            var displayName = el("input", { class: "input", type: "text", value: account.displayName || "" });
            var replyTo = el("input", { class: "input", type: "email", value: account.replyTo || "", placeholder: "Optional" });
            var color = account.color || COLORS[0];
            var swatches = el("div", { class: "color-swatches" });
            COLORS.forEach(function (value) {
                var swatch = el("span", { class: "swatch" + (value === color ? " active" : ""), style: { background: value }, title: value });
                swatch.addEventListener("click", function () {
                    color = value;
                    swatches.querySelectorAll(".swatch").forEach(function (item) { item.classList.remove("active"); });
                    swatch.classList.add("active");
                });
                swatches.appendChild(swatch);
            });
            var saveSent = el("select", { class: "select" }, [
                el("option", { value: "auto", text: "Automatic (recommended)" }),
                el("option", { value: "always", text: "Always save a copy in Sent" }),
                el("option", { value: "never", text: "Never (the server files sent mail itself)" })
            ]);
            saveSent.value = account.saveSent || "auto";
            var signature = signatureEditor(account.signature);

            body.appendChild(el("div", { class: "row" }, [
                el("div", { class: "field" }, [el("label", { text: "Your name" }), displayName]),
                el("div", { class: "field" }, [el("label", { text: "Reply-to address" }), replyTo])
            ]));
            body.appendChild(el("div", { class: "field" }, [el("label", { text: "Colour" }), swatches]));
            body.appendChild(el("div", { class: "field" }, [el("label", { text: "Signature" }), signature.el]));
            body.appendChild(el("div", { class: "field" }, [el("label", { text: "Sent messages" }), saveSent,
                el("div", { class: "help", text: "Gmail and Outlook keep a copy of sent mail automatically; other providers need the app to store one." })]));

            //Connection
            var imapForm = serverFields("Incoming mail (IMAP)", account.imap);
            var smtpForm = serverFields("Outgoing mail (SMTP)", account.smtp);
            var password = passwordInput("Leave empty to keep the current password");
            var connection = el("div", { class: "hidden" });
            if (account.auth === "oauth2") {
                connection.appendChild(el("div", { class: "notice", style: { marginBottom: "12px" } }, [icon("shield alternate"), el("div", { class: "grow" }, [
                    el("div", { text: "Signed in with " + (account.oauthProvider === "google" ? "Google" : "Microsoft") + "." }),
                    el("div", { class: "actions" }, el("button", { class: "btn small", text: "Reconnect", on: { click: function () { dialog.close(); reconnect(account, handlers.onSaved); } } }))
                ])]));
            } else {
                connection.appendChild(el("div", { class: "field" }, [el("label", { text: "Password" }), password.el]));
            }
            connection.appendChild(imapForm.el);
            connection.appendChild(smtpForm.el);
            var connectionToggle = el("div", { class: "advanced-toggle" }, [icon("caret right"), "Connection settings"]);
            connectionToggle.addEventListener("click", function () {
                connection.classList.toggle("hidden");
                connectionToggle.firstChild.className = (connection.classList.contains("hidden") ? "caret right" : "caret down") + " icon";
            });
            body.appendChild(connectionToggle);
            body.appendChild(connection);
            var status = el("div");
            body.appendChild(status);

            var dialog = ui.modal({
                title: account.email,
                subtitle: "Account settings",
                wide: true,
                body: body,
                buttons: [
                    {
                        label: "Remove account", danger: true, left: true, onClick: function () {
                            ui.confirm("Remove " + account.email + "?", "The account is removed from ArozOS Mail. Messages stay on the mail server.", { okLabel: "Remove", danger: true }).then(function (ok) {
                                if (!ok) {
                                    return;
                                }
                                api.accounts("remove", { id: account.id }).then(function () {
                                    dialog.close();
                                    ui.toast(account.email + " removed");
                                    if (handlers.onRemoved) {
                                        handlers.onRemoved(account);
                                    }
                                }).catch(function (error) { ui.errorToast(error); });
                            });
                            return false;
                        }
                    },
                    { label: "Cancel" },
                    {
                        label: "Save", primary: true, onClick: function (modal) {
                            var input = {
                                email: account.email, displayName: displayName.value.trim(), provider: account.provider, color: color,
                                imap: imapForm.value(), smtp: smtpForm.value(), auth: account.auth,
                                password: account.auth === "password" ? password.input.value : "",
                                signature: signature.value(), replyTo: replyTo.value.trim(), saveSent: saveSent.value
                            };
                            modal.setBusy(true);
                            util.clear(status);
                            status.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), "Saving…"]));
                            return api.accounts("update", { id: account.id, account: input }).then(function (result) {
                                modal.close();
                                ui.toast("Account saved");
                                if (handlers.onSaved) {
                                    handlers.onSaved(result.account);
                                }
                            }).catch(function (error) {
                                modal.setBusy(false);
                                util.clear(status);
                                status.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: error.message + (error.hint ? " — " + error.hint : "") })]));
                            });
                        }
                    }
                ]
            });
        });
    }

    //reconnect signs in again after a password change or expired sign-in
    function reconnect(account, onSaved, error) {
        loadPresets().catch(function () { }).then(function () {
            var body = el("div");
            var preset = presetById(account.provider) || presetById("custom");
            if (error) {
                body.appendChild(el("div", { class: "notice danger", style: { marginBottom: "12px" } }, [icon("exclamation circle"), el("div", { class: "grow" }, [
                    el("div", { text: error.message }),
                    error.hint ? el("div", { style: { marginTop: "4px", fontWeight: "500" }, text: error.hint }) : null
                ])]));
            }
            var status = el("div");
            var dialog = null;
            var save = function (extra) {
                var input = {
                    email: account.email, displayName: account.displayName, provider: account.provider, color: account.color,
                    imap: account.imap, smtp: account.smtp, signature: account.signature, replyTo: account.replyTo, saveSent: account.saveSent
                };
                Object.keys(extra).forEach(function (key) { input[key] = extra[key]; });
                util.clear(status);
                status.appendChild(el("div", { class: "progress-line" }, [el("div", { class: "spinner" }), "Checking…"]));
                return api.accounts("update", { id: account.id, account: input }).then(function (result) {
                    dialog.close();
                    ui.toast(account.email + " is connected again");
                    if (onSaved) {
                        onSaved(result.account);
                    }
                }).catch(function (failure) {
                    util.clear(status);
                    status.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: failure.message + (failure.hint ? " — " + failure.hint : "") })]));
                    throw failure;
                });
            };

            var oauth = account.auth === "oauth2" ? (oauthProviders && oauthProviders[account.oauthProvider]) : oauthFor(preset);
            if (account.auth === "oauth2" || oauth) {
                var area = el("div");
                var button = el("button", { class: "oauth-btn", type: "button" }, [
                    el("i", { class: (account.oauthProvider === "google" || preset.oauth === "google" ? "google" : "microsoft") + " icon" }),
                    "Sign in again"
                ]);
                button.addEventListener("click", function () {
                    if (!oauth || !oauth.enabled) {
                        ui.toast("This sign-in method is no longer enabled by the administrator", { error: true });
                        return;
                    }
                    runOAuth(area, oauth.id, account.email).then(function (signedIn) {
                        util.clear(area);
                        save({ auth: "oauth2", oauthState: signedIn.state }).catch(function () { });
                    }).catch(function (failure) {
                        util.clear(area);
                        area.appendChild(el("div", { class: "notice danger" }, [icon("exclamation circle"), el("div", { text: failure.message })]));
                    });
                });
                body.appendChild(button);
                body.appendChild(area);
            }
            if (account.auth !== "oauth2") {
                var password = passwordInput(preset.passwordLabel || "Password");
                body.appendChild(el("div", { class: "notice", style: { margin: "12px 0" } }, [icon("key"), el("div", { class: "grow" }, [
                    el("div", { text: preset.passwordHelp }),
                    preset.passwordUrl ? el("div", { class: "actions" }, el("a", { class: "btn small", href: preset.passwordUrl, target: "_blank", rel: "noopener noreferrer" }, [icon("external alternate"), "Open " + (preset.passwordLabel || "password") + " page"])) : null
                ])]));
                body.appendChild(el("div", { class: "field" }, [el("label", { text: preset.passwordLabel || "Password" }), password.el]));
                var submit = el("button", { class: "btn primary", text: "Save password" });
                submit.addEventListener("click", function () {
                    if (password.input.value === "") {
                        password.input.classList.add("invalid");
                        return;
                    }
                    submit.disabled = true;
                    save({ auth: "password", password: password.input.value }).catch(function () { submit.disabled = false; });
                });
                body.appendChild(el("div", { style: { display: "flex", justifyContent: "flex-end" } }, submit));
            }
            body.appendChild(status);
            dialog = ui.modal({ title: "Sign in to " + account.email, wide: false, body: body });
        });
    }

    return {
        openWizard: openWizard,
        openSettings: openSettings,
        reconnect: reconnect,
        loadPresets: loadPresets,
        presetById: presetById,
        redirectURI: redirectURI,
        COLORS: COLORS
    };
})();
