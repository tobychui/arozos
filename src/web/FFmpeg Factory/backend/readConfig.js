if (newDBTableIfNotExists("FFmpeg Factory")){
	var value = readDBItem("FFmpeg Factory",USERNAME + "_" + key);
	sendResp(value);
}else{
	sendJSONResp(JSON.stringify({
		error: "Database Creation Failed"
	}));
}
