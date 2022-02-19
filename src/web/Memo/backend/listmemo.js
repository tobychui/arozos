
function main(){
    newDBTableIfNotExists("Memo");
    var entries = listDBTable("Memo");
    var thisUserMemo = {};
    for (var key in entries) {
        if (key.indexOf(USERNAME + "/") >= 0){
            thisUserMemo[key.replace(USERNAME+"/", "")] = entries[key];
        }
    }
	sendJSONResp(JSON.stringify(thisUserMemo));
}

main();