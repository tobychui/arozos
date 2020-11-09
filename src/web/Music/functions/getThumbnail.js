/*

    Music Module Thumbnail Getter
    author: tobychui

    This script handle thumbnail loading from the local filesystem

    Require paramter: file
    Return: base64 of the image content
*/

function main(){
    if (!requirelib("filelib")){
        return;
    }
    if (!requirelib("imagelib")){
        return;
    }

    //Check for source file exists
    if (filelib.fileExists(file)){
        //File exists. Load thumb
        var thumbImageBase64 = imagelib.loadThumbString(file);
        if (thumbImageBase64 != false){
            //Set the respond header to image
            sendResp(thumbImageBase64)
        }else{
            sendJSONResp(JSON.stringify({
                error: "Thumb load failed",
            }))
        }
    }else{
        sendJSONResp(JSON.stringify({
            error: "File not exists, given: " + file,
        }))
    }

}

main();



