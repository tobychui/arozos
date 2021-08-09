/*
    FileSaver.js
    Author: tobychui

    This file save the notebook files to server side
    Required POST paramters:

    filepath
    content
*/


function error(message){
    sendJSONResp(JSON.stringify({
        "error": message
    }));
}




function main(){
    //Require libraries
    if (!requirelib("filelib")){
        error("Unable to request filelib");
        return
    }

    //Write to the file
    var succ = filelib.writeFile(filepath, content);
    if (!succ){
        error("Unable to save file");
        return
    }else{
        sendResp("OK");
        return
    }
}

main();