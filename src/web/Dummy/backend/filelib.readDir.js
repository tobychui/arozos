console.log("ListDir Testing");
requirelib("filelib");
//This function only shows all directory within this dir
sendJSONResp(JSON.stringify(filelib.readdir("user:/Desktop/*")))