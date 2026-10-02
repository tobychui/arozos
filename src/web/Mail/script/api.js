/*
    Mail — backend client

    Wraps ao_module_agirun in promises. Every backend script answers with the
    email library envelope {success, data} or {success: false, error, …}; a
    failure rejects with an Error that keeps authFailed / hint / code so the
    UI can react (open the sign-in dialog, explain a blocked server, …).
*/

var Mail = window.Mail || {};
window.Mail = Mail;

Mail.api = (function () {
    "use strict";

    var available = typeof ao_module_agirun === "function";

    function MailError(message, details) {
        var error = new Error(message || "Something went wrong");
        details = details || {};
        error.authFailed = details.authFailed === true;
        error.hint = details.hint || "";
        error.code = details.code || "";
        error.details = details;
        return error;
    }

    //call runs Mail/backend/<script>.agi with an operation and JSON arguments
    function call(script, operation, data, timeout) {
        return new Promise(function (resolve, reject) {
            if (!available) {
                reject(MailError("Mail needs to run inside ArozOS"));
                return;
            }
            ao_module_agirun("Mail/backend/" + script + ".agi", {
                opr: operation,
                data: JSON.stringify(data || {})
            }, function (response) {
                if (typeof response === "string") {
                    try {
                        response = JSON.parse(response);
                    } catch (e) {
                        reject(MailError("Unexpected response from the server"));
                        return;
                    }
                }
                if (!response || typeof response !== "object") {
                    reject(MailError("Empty response from the server"));
                    return;
                }
                if (response.success) {
                    resolve(response.data);
                } else {
                    reject(MailError(response.error, response));
                }
            }, function (xhr) {
                if (xhr && (xhr.status === 401 || xhr.status === 403)) {
                    reject(MailError("Your ArozOS session has expired or you have no access to Mail. Please sign in again.", { code: "session" }));
                } else if (xhr && xhr.status === 0) {
                    reject(MailError("Cannot reach the ArozOS server", { code: "offline" }));
                } else {
                    reject(MailError("Server error" + (xhr && xhr.status ? " (" + xhr.status + ")" : "")));
                }
            }, timeout || 0);
        });
    }

    return {
        call: call,
        available: available,
        accounts: function (operation, data) { return call("accounts", operation, data); },
        mailbox: function (operation, data) { return call("mailbox", operation, data); },
        message: function (operation, data) { return call("message", operation, data); },
        files: function (operation, data) { return call("files", operation, data); },
        compose: function (operation, data) { return call("compose", operation, data); },
        settings: function (operation, data) { return call("settings", operation, data); }
    };
})();
