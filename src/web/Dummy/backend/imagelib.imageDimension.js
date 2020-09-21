console.log("Image Properties Access Test");
//To test this, put a test.jpg on your desktop
var imagePath = "user:/Desktop/test.jpeg";

//Require the image library
var loaded = requirelib("imagelib");
if (loaded) {
    //Library loaded. Call to the functions
    var dimension = imagelib.getImageDimension(imagePath);
    sendJSONResp(JSON.stringify(dimension));
} else {
    console.log("Failed to load lib: imagelib");
}