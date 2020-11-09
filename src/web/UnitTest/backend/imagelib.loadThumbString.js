/*
    Image Thumbnail Loading

    This script demonstrate the methods to load a thumbnail as base64 string given
    its virtual filepath
*/

if (requirelib("imagelib")){
    var thumbImageBase64 = imagelib.loadThumbString("user:/Desktop/test.jpg");
    if (thumbImageBase64 != false){
        //Set the respond header to image
        HTTP_HEADER = "text/html"
        sendResp('<img src="data:image/jpg;base64,' + thumbImageBase64 + '"></img>');
    }else{
        sendResp('Failed to load thumbnail for this resource (You sure the format is supported?)')
    }
}else{
    console.log("Image lib not found");
}