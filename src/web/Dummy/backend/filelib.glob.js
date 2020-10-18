console.log("Testing File Glob");
requirelib("filelib");
var fileList = filelib.glob("user:/Desktop/*.mp3");
sendJSONResp(JSON.stringify(fileList));