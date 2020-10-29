console.log("File Read Write Test");
requirelib("filelib");
if (filelib.writeFile("user:/Desktop/test.txt","Hello World! This is a testing message to write")){
	//Write file succeed.
	var fileContent = filelib.readFile("user:/Desktop/test.txt");
	sendResp("File content: " + fileContent);
}else{
	SendResp("Failed to write file");
}