// OTPAuth - Delete Entry
// Required parameter: id

if (typeof id == "undefined" || id.trim() == "") {
    sendJSONResp(JSON.stringify({ "error": "Missing id parameter" }));
    exit();
}

newDBTableIfNotExists("OTPAuth");
var key = USERNAME + "/" + id;

// Verify ownership before deletion
var existing = readDBItem("OTPAuth", key);
if (existing == "" || existing == null) {
    sendJSONResp(JSON.stringify({ "error": "Entry not found" }));
    exit();
}

deleteDBItem("OTPAuth", key);
sendJSONResp(JSON.stringify({ "ok": true }));
