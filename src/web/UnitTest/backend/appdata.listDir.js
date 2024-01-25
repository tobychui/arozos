/*
    appdata.listDir.js

    This script test the appdata list dir function.
*/

//Require the appdata library
var succ = requirelib("appdata");

function main(){
    //List all files within the UnitTest backend example library
    var backendExamples = appdata.listDir("UnitTest/backend/");

    //Check if there are any error for reading the file
    if (backendExamples == false){
        sendJSONResp(JSON.stringify({
            error: "Unable to list backend example library"
        }));
    }else{
        //Success. Return the file list of the folder
        sendJSONResp(backendExamples);
    }
}

if (!succ){
    //Library include failed.
    sendResp("Include Appdata lib failed. Is your ArozOS version too old?")
}else{
    //Library include succeed. Start reading from webroot
    main();
}
