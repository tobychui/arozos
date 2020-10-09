//Use ffmpeg to convert a file named test.mp4 on desktop
console.log("Demo for converting a test.mp4 on Desktop to test.mp3");
var srcVirtual = "user:/Desktop/test.mp4";

//Helper function to get the filepath.Dir of the realpath
function dir(filepath){
	filepath = filepath.split("/");
	filepath.pop();
	return filepath.join("/");
}

//Require ffmpeg package
if (requirepkg("ffmpeg",true)){
	//Package required. Get the real path of the file
	var srcReal = decodeVirtualPath(srcVirtual);
	srcReal = srcReal.split("\\").join("/");
	console.log("File real path: " + srcReal);
	
	//Generate the destination filepath (real)
	var destReal = dir(srcReal) + "/test.mp3";
	console.log("Output file path: " + destReal);
	
	//Convert the real path to the designed path
	//If you want to include filepath with space, you must use " instead of '
	var results = execpkg("ffmpeg",'-i "' + srcReal + '" "' + destReal + '"');
	
	//Send the CMD output as text to response
	sendResp(results);
}else{
	sendResp("Failed to require package ffmpeg");
}

