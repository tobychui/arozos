console.log("Check if file exists");
requirelib("filelib");
if (filelib.fileExists("user:/Desktop/test.txt")){
	sendResp("File Exists");
}else{
	sendResp("File Not Exists");
}