//File Share API
//This script demonstrate how to share a file on ArozOS using AGI script

//Require the share lib
requirelib("share");

function main(){
    //Share the file for 10 seconds
    var shareUUID = share.shareFile("user:/Desktop/test.pptx", 10);
    console.log(shareUUID);
    if (shareUUID == null){
        //Share error
        sendResp("Share failed");
    }else{
        //Share success.
        //Check if share UUID exists
        console.log("Share UUID is valid: " + share.checkShareExists(shareUUID));

        //Check if the source file is shared
        console.log("Source file is shared: " + share.fileIsShared("user:/Desktop/test.pptx"));

        console.log("Source file share permission: " + share.checkSharePermission(shareUUID));
        //Remove the share using UUID
        //share.removeShare(shareUUID);

        //Delay 11 seconds
        delay(11000)

        //Check is the share is still valid
        console.log("Share UUID valid after share expired: " + share.checkShareExists(shareUUID));

        //Return the share UUID
        sendResp("OK");
    }
}

main();