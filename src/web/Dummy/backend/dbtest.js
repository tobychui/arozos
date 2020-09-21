console.log("Testing Database API");
if (newDBTableIfNotExists("testdb")){
	if (writeDBItem("testdb","message","Hello World")){
		//Test suceed. Set Response message to the message
		sendResp("Database access return value: " + readDBItem("testdb","message"));
		//Drop the table after testing
		dropDBTable("testdb");
		console.log("Testdb table dropped");
	}else{
		sendResp("Failed to write to db");
	}
	
}else{
	sendResp("Failed creating new db");
}
