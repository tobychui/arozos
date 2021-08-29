console.log("Testing Database Listing API");
if (newDBTableIfNotExists("testdb")){
	writeDBItem("testdb","One","Hello World")
	writeDBItem("testdb","Two","This is a text message")
	writeDBItem("testdb","Three","For listing")
	writeDBItem("testdb","Four","123456")
	writeDBItem("testdb","Five","You can also put JSON string here")
	
	//Try to list db table
	var entries = listDBTable("testdb");
	sendJSONResp(JSON.stringify(entries));
	//Drop the table after testing
	dropDBTable("testdb");
	console.log("Testdb table dropped");

	
}else{
	sendResp("Failed creating new db");
}
