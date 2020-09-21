console.log("Testing File Glob");
requirelib("filelib");
var fileList = filelib.aglob("user:/Desktop/*.mp4");
sendJSONResp(JSON.stringify(fileList));