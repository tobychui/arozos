console.log("RAW to JPEG Conversion Test");
//To test this, put a RAW photo (e.g. test.ARW / test.CR2 / test.DNG) on your desktop
var srcPath = "user:/Desktop/test.ARW";
var destPath = "user:/Desktop/test.jpg";

//Check if the file exists
requirelib("filelib");
if (!filelib.fileExists(srcPath)){
	sendResp("File not exists!")
}else{
	//Require the image library
	var loaded = requirelib("imagelib");
	if (loaded) {
		//Library loaded. Call to the functions
		var success = imagelib.rawToJPEG(srcPath, destPath);
		if (success){
			sendResp("OK")
		}else{
			sendResp("Failed to convert RAW to JPEG");
		}
	} else {
		console.log("Failed to load lib: imagelib");
	}
}
