/*
    rpc.js

    This script do the following stuffs
    - set a user online status 
    - get the latest message id (if channel id is given)
    - set a user state (if channel id is given)

    Required paramters:
    channel (optional): Channel ID
    userstate (optional): {typing / standby / uploading}
*/

var username = USERNAME;
newDBTableIfNotExists("message")

//Set this user last online time
writeDBItem("message", "online_status/" + username, Math.floor(Date.now() / 1000));

//Check if channel id is defined
if (typeof(channel) != "undefined" && channel != ""){
    //In channel. Get the ID out of this user pair
    var channelID = channel + "_" + username;
    if (username < channel){
        channelID = username + "_" + channel
    }

    //Get opposite online time if exists
    var oppositeOnlineTime = readDBItem("message", "online_status/" + channel)
    if (oppositeOnlineTime != ""){
        oppositeOnlineTime = parseInt(oppositeOnlineTime);
    }else{
        oppositeOnlineTime = -1;
    }

    //Prepare the data structure to be returned
    var resultingStruct = {
        latestMessageId: "",
        oppositeLastOnlineTime: oppositeOnlineTime,
        oppositeStatus: ""
    };

    
    //Check the latest message id
    var latestMessage = readDBItem("message", "latest_id/" + channelID);
    var message = [];
    if (latestMessage == ""){
        //No message 

    }else{
        resultingStruct.latestMessageId = latestMessage;
    }

    sendJSONResp(resultingStruct);

}else if (typeof(group) != "undefined" && group != ""){
    //Group function, to be developed

}else{
    //Homepage. Show all chat updates

}