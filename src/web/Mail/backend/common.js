/*
	Mail — shared helpers for the backend scripts

	Every backend script is called with two POST fields:
	  opr  = the operation name
	  data = JSON encoded arguments
	and answers with the {success, data | error} envelope of the email library.
*/

HTTP_HEADER = "application/json; charset=utf-8";

var MAIL_READY = requirelib("email");

//mailInput decodes the JSON arguments sent by the front-end
function mailInput() {
    if (typeof data == "undefined" || data === null || data === "") {
        return {};
    }
    try {
        var parsed = JSON.parse(data);
        return (parsed && typeof parsed == "object") ? parsed : {};
    } catch (e) {
        return {};
    }
}

//mailOperation returns the requested operation name
function mailOperation() {
    return (typeof opr == "undefined" || opr === null) ? "" : String(opr);
}

function mailFail(message) {
    sendJSONResp({ success: false, error: message });
}

//mailRun dispatches to a handler table, guarding a disabled backend and
//unknown operations in one place
function mailRun(handlers) {
    if (!MAIL_READY) {
        mailFail("Mail support is not enabled on this server");
        return;
    }
    var operation = mailOperation();
    if (!handlers.hasOwnProperty(operation)) {
        mailFail("unknown operation: " + operation);
        return;
    }
    sendJSONResp(handlers[operation](mailInput()));
}
