//Require paramter: memoid
deleteDBItem("Memo", USERNAME + "/" + memoid);
sendJSONResp(JSON.stringify("OK"));