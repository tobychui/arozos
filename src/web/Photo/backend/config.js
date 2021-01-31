var results = {};
results["username"] = USERNAME;
results["usericon"] = USERICON;
results["unlimited"] = false;

if (USERQUOTA_TOTAL == -1) {
    results["unlimited"] = true;
    results["quota"] = 0;
    results["quota_human"] = bytesToSize(USERQUOTA_USED);
} else {
    results["quota"] = USERQUOTA_USED / USERQUOTA_TOTAL * 100;
}
sendJSONResp(JSON.stringify(results));

//From stackoverflow.com
//https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}