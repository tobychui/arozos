if (!requirelib("filelib")){
    console.log("Filelib import failed");
}

resp = filelib.readdir(dir)
sendJSONResp(resp)