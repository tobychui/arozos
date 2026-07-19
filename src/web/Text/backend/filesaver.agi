/*
    Text - FileSaver backend
    Writes the editor content to a file on the server.

    Required POST parameters:
        filepath  - virtual path to the target file
        content   - text content to write
*/

function main(){
    if (!requirelib("filelib")){
        sendJSONResp(JSON.stringify({ error: "filelib unavailable" }));
        return;
    }

    if (!filepath || filepath.trim() === ""){
        sendJSONResp(JSON.stringify({ error: "filepath is required" }));
        return;
    }

    var ok = filelib.writeFile(filepath, content);
    if (!ok){
        sendJSONResp(JSON.stringify({ error: "unable to write file" }));
        return;
    }

    sendResp("OK");
}

main();
