/*
    FFmpeg Factory ArOZ JavaScript Gateway Interface Converter

    This script will launch ffmpeg and convert a given file into the desired format
*/
//Require library
requirelib("filelib");

//Globaal variables
var targetFilepath = filepath;
var conversionCommand = command;

//Helper function to get the filepath.Dir of the realpath
function dir(filepath){
	filepath = filepath.split("/");
	filepath.pop();
	return filepath.join("/");
}

//Return the filename of the path without extension
function base(filepath){
    filepath = filepath.split("\\").join("/");
    filepath = filepath.split("/");
    filename = filepath.pop();
    filename = filename.split(".")
    filename.pop();
    return filename.join(".");
}

//Package required. Get the real path of the file
if (filelib.fileExists(targetFilepath)){
    var srcReal = decodeVirtualPath(targetFilepath);
    srcReal = srcReal.split("\\").join("/");

    //Parse the command for the conversion
    var actualCommand = decodeURIComponent(command);
    actualCommand = actualCommand.replace('{filepath}',srcReal);
    actualCommand = actualCommand.replace('{filename}',dir(srcReal) + "/" + base(srcReal))

    //Register this task in on-going task list
    newDBTableIfNotExists("FFmpeg Factory")
    var ts = Math.round((new Date()).getTime() / 1000);
    var taskKey = USERNAME + "/" + ts;
    writeDBItem("FFmpeg Factory",taskKey,targetFilepath)

    //Pass the command into ffmpeg pkg
    var results = execpkg("ffmpeg",actualCommand);

    //Deregister this task from on-going task list
    deleteDBItem("FFmpeg Factory",taskKey,targetFilepath);

    sendJSONResp(JSON.stringify({
        status: "ok",
        execresults: results
    }));

   

}else{
    //File not exists. Return an error json
    sendJSONResp(JSON.stringify({
        error: "File not exists: " + targetFilepath
    }));
}
