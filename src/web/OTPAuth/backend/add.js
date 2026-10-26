// OTPAuth - Add Entry
// Required parameter: entry (JSON string)
// {account, issuer, secret, algorithm, digits, period}

if (typeof entry == "undefined" || entry.trim() == "") {
    sendJSONResp(JSON.stringify({ "error": "Missing entry parameter" }));
    exit();
}

var entryObj;
try {
    entryObj = JSON.parse(entry);
} catch (e) {
    sendJSONResp(JSON.stringify({ "error": "Invalid JSON" }));
    exit();
}

if (!entryObj.secret || entryObj.secret.trim() == "") {
    sendJSONResp(JSON.stringify({ "error": "Secret key is required" }));
    exit();
}

if (!entryObj.account || entryObj.account.trim() == "") {
    sendJSONResp(JSON.stringify({ "error": "Account name is required" }));
    exit();
}

// Normalize and set defaults
entryObj.id = entryObj.id || ("otp_" + Date.now());
entryObj.algorithm = (entryObj.algorithm || "SHA1").toUpperCase();
entryObj.digits = parseInt(entryObj.digits) || 6;
entryObj.period = parseInt(entryObj.period) || 30;
entryObj.issuer = entryObj.issuer || "";
entryObj.secret = entryObj.secret.toUpperCase().replace(/\s/g, "");
entryObj.added = Date.now();

newDBTableIfNotExists("OTPAuth");
var key = USERNAME + "/" + entryObj.id;
var succ = writeDBItem("OTPAuth", key, JSON.stringify(entryObj));

if (succ == false) {
    sendJSONResp(JSON.stringify({ "error": "Write to database failed" }));
} else {
    sendJSONResp(JSON.stringify({ "ok": true, "id": entryObj.id }));
}
