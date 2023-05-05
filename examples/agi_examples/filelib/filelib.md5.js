var loaded = requirelib("filelib");
if (!loaded) {
    console.log("Failed to load lib imagelib, terminated.");
}

sendJSONResp(JSON.stringify(filelib.md5("user:/Desktop/test.jpeg")))
    //will return md5 hash or false