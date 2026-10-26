// OTPAuth - Update Entry Label
// Required parameter: id
// Optional: issuer, account

if (typeof id == "undefined" || id.trim() == "") {
    sendJSONResp(JSON.stringify({ "error": "Missing id parameter" }));
    exit();
}

newDBTableIfNotExists("OTPAuth");
var key = USERNAME + "/" + id;
var existing = readDBItem("OTPAuth", key);

if (existing == "" || existing == null) {
    sendJSONResp(JSON.stringify({ "error": "Entry not found" }));
    exit();
}

var entryObj;
try {
    entryObj = JSON.parse(existing);
} catch (e) {
    sendJSONResp(JSON.stringify({ "error": "Invalid entry data in database" }));
    exit();
}

if (typeof issuer != "undefined") entryObj.issuer = issuer;
if (typeof account != "undefined") entryObj.account = account;

var succ = writeDBItem("OTPAuth", key, JSON.stringify(entryObj));
if (succ == false) {
    sendJSONResp(JSON.stringify({ "error": "Write to database failed" }));
} else {
    sendJSONResp(JSON.stringify({ "ok": true }));
}
