/*
    Common Message app Tools
*/

//Current watching channel, leave empty for all
var channelID = "";
var userstate = "standby"; //standby / typing / uploading
//Current status return data from last rpc
var statusData = {};
var rpcCallback = undefined;

//Setup timer to update the above two paramters
setInterval(function(){
    updateStatus();
}, 5000);

//Call this function on start
function updateStatus(){
    var messageInputValue = $("#msgInput").val();
    if (messageInputValue.trim() != ""){
        userstate = "typing";
    }else{
        userstate = "standby";
    }
    ao_module_agirun("Message/backend/rpc.js", {
        channel: channelID,
        userstate: userstate
    }, function(data){
        statusData = data;
        if (rpcCallback != undefined){
            rpcCallback(data);
        }
    });
}
