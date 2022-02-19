//Require paramter: memo (JSON string)

newDBTableIfNotExists("Memo");
var succ = writeDBItem("Memo",USERNAME + "/" + Date.now(),memo);
if (succ == false){
    sendJSONResp(JSON.stringify({"error":"Write to database failed"}));
}else{
    sendJSONResp(JSON.stringify("OK"));
}
