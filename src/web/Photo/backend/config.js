var results = {};
results["username"] = USERNAME;
results["usericon"] = USERICON;

if(USERQUOTA_TOTAL == -1){
    results["quota"] = 0;
}else{
    results["quota"] = USERQUOTA_USED / USERQUOTA_TOTAL * 100;
}
sendJSONResp(JSON.stringify(results));
