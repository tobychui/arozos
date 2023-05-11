console.log("Image Resizing Test");
//To test this, put a test.jpg on your desktop
var srcPath = "user:/Desktop/test.jpg";
var destPath = "user:/Desktop/output.jpg";

//Check if the file exists
requirelib("filelib");
if (!filelib.fileExists(srcPath)){
	sendResp("File not exists!")
}else{
	//Require the image library
	var loaded = requirelib("imagelib");
	if (loaded) {
		//Library loaded. Call to the functions
		var success = imagelib.resizeImage(srcPath, destPath, 200, 0);
		if (success){
			sendResp("OK")
		}else{
			sendResp("Failed to resize image");
		}
	} else {
		console.log("Failed to load lib: imagelib");
	}
}