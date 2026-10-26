// OTPAuth - List Entries for current user

function main() {
    newDBTableIfNotExists("OTPAuth");
    var entries = listDBTable("OTPAuth");
    var userEntries = {};

    for (var key in entries) {
        if (key.indexOf(USERNAME + "/") === 0) {
            var id = key.replace(USERNAME + "/", "");
            try {
                userEntries[id] = JSON.parse(entries[key]);
            } catch (e) {
                // Skip malformed entries
            }
        }
    }

    sendJSONResp(JSON.stringify(userEntries));
}

main();
