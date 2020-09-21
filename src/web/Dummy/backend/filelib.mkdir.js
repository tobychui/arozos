//This script will create a folder on your desktop named "Hello World"
console.log("Create Folder Test");
var srcPath = "user:/Desktop/Hello World";

//Require the image library
var loaded = requirelib("filelib");
if (loaded) {
    //Library loaded. Call to the functions
    var success = filelib.mkdir(srcPath);
	if (success){
		sendResp("OK")
	}else{
		sendResp("Failed to resize image");
	}
} else {
    console.log("Failed to load lib: filelib");
}