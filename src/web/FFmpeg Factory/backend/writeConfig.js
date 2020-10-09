if (newDBTableIfNotExists("FFmpeg Factory")){
	if (writeDBItem("FFmpeg Factory",USERNAME + "_" + key,value)){
		sendJSONResp(JSON.stringify("OK"));
	}else{
		sendJSONResp(JSON.stringify({
			error: "Database write failed"
		}));
	}
	
}else{
	sendJSONResp(JSON.stringify({
		error: "Database Creation Failed"
	}));
}
