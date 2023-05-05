/*
    appdata.readFile.js

    This script test the appdata read file function.
    This should be able to read file 
*/

//Require the appdata library
var succ = requirelib("appdata");

function main(){
    //Get a file from the UnitTest WebApp. This path is relative from the web root
    var webAppDataFileContent = appdata.readFile("UnitTest/appdata.txt");

    //Check if there are any error for reading the file
    if (webAppDataFileContent == false){
        sendJSONResp(JSON.stringify({
            error: "Unable to get appdata from app folder"
        }));
    }else{
        //Success. Return the content of the file
        sendResp(webAppDataFileContent)
    }
}

if (!succ){
    //Library include failed.
    sendResp("Include Appdata lib failed. Is your ArozOS version too old?")
}else{
    //Library include succeed. Start reading from webroot
    main();
}
