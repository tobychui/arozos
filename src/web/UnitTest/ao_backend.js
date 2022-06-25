/*
    ao_backend.js
    Author: tobychui

    JavaScript wrapper for AGI Gateway script
    Designed for front-end WebApps 

    Usage: 
    1. Copy and paste this file into your module's root
    2. In your html, include this script in <script> element
    3. Start the script using aoBackend.start("MyWebApp/ao_backend.js", "../");
*/

if (typeof(BUILD_VERSION) != "undefined"){
    //Executing in backend VM
    if (typeof(opr) != "undefined"){
        /*
            Appdata Library
        */
        if (opr == "appdata.readFile"){
            requirelib("appdata");
            var content = appdata.readFile(filepath);
            if (content == false){
                sendJSONResp(JSON.stringify({
                    error: "Unable to get appdata from app folder"
                }));
            }else{
                sendResp(content)
            }
        }else if (opr == "appdata.listDir"){
            requirelib("appdata");
            var content = appdata.listDir(filepath);
            if (content == false){
                sendJSONResp(JSON.stringify({
                    error: "Unable to list backend appdata"
                }));
            }else{
                sendJSONResp(content);
            }
        
        /*
            File library
        */
        }else if (opr == "file.writeFile"){
            requirelib("filelib");
            filelib.writeFile(filepath,content);
            sendOK();
        }else if (opr == "file.readFile"){
            requirelib("filelib");
            sendResp(filelib.readFile(filepath));
        }else if (opr == "file.deleteFile"){
            requirelib("filelib");
            filelib.deleteFile(filepath);
            sendOK();
        }else if (opr == "file.readdir"){
            requirelib("filelib");
            var dirlist = filelib.readdir(filepath);
            sendJSONResp(JSON.stringify(dirlist));
        }else if (opr == "file.walk"){
            requirelib("filelib");
            var filelist = filelib.walk(filepath, mode);
            sendJSONResp(JSON.stringify(filelist));
        }else if (opr == "file.glob"){
            requirelib("filelib");
            var filelist = filelib.glob(wildcard, sort);
            sendJSONResp(JSON.stringify(filelist));
        }else if (opr == "file.aglob"){
            requirelib("filelib");
            var filelist = filelib.aglob(wildcard, sort);
            sendJSONResp(JSON.stringify(filelist));
        }else if (opr == "file.filesize"){
            requirelib("filelib");
            var fileSize = filelib.filesize(filepath);
            sendJSONResp(JSON.stringify(fileSize));
        }else if (opr == "file.fileExists"){
            requirelib("filelib");
            var exists = filelib.fileExists(filepath);
            sendJSONResp(JSON.stringify(exists));
        }else if (opr == "file.isDir"){
            requirelib("filelib");
            sendJSONResp(JSON.stringify(filelib.isDir(filepath)));
        }else if (opr == "file.mkdir"){
            requirelib("filelib");
            filelib.mkdir(filepath);
            sendOK();
        }else if (opr == "file.mtime"){
            requirelib("filelib");
            var unixmtime = filelib.mtime(filepath, true);
            sendJSONResp(JSON.stringify(unixmtime));
        }else if (opr == "file.rootName"){
            requirelib("filelib");
            var rootname = filelib.rootName(filepath);
            sendJSONResp(JSON.stringify(rootname));
        
        /*
            HTTP library
        */
        }else if (opr == "http.get"){
            requirelib("http");
            var respbody = http.get(targetURL);
            sendResp(respbody);
        }else if (opr == "http.post"){
            requirelib("http");
            if (postdata == ""){
                postdata = {};
            }
            var respbody = http.post(targetURL,postdata);
            sendResp(respbody);
        }else if (opr == "http.head"){
            requirelib("http");
            var respHeader = JSON.parse(http.head(targetURL, header));
            sendJSONResp(JSON.stringify(respHeader));
        }else if (opr == "http.download"){
            requirelib("http");
            var success = http.download(targetURL,saveDir,saveFilename);
            if (success){
                sendOk();
            }else{
                sendJSONResp(JSON.stringify({
                    error: "Download failed"
                }));
            }
        }else{
            sendJSONResp(JSON.stringify({
                error: "Unknown operator: " + opr
            }));
        }
    }else{
        //Invalid request operation
        sendJSONResp(JSON.stringify({
            "error":"invalid or not supported operation given"
        }));
    }
}else{
    console.log("INVALID USAGE")
}


