/*
    Image Cropping Function

    This script demonstrate how to crop an image using imagelib
    Try to resize an image on desktop test.jpg to crop.jpg
*/

if (requirelib("imagelib")){
    //if (imagelib.cropImage("ccns:/test.jpg", "user:/Desktop/ccns.jpg",100,100,200,200)){
    if (imagelib.cropImage("user:/Desktop/test.jpg", "user:/Desktop/out.jpg",100,100,200,200)){
        //Cropping suceed
        sendJSONResp(JSON.stringify("ok"))
    }else{
        sendJSONResp(JSON.stringify({
            error: "Unable to crop image"
        }))
    }
}else{
    console.log("Image lib not found");
}