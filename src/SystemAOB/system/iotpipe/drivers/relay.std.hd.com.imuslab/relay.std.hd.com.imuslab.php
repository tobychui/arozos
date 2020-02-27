<?php
include_once("../../../../../auth.php");
?>
<html>
<head>
<title>relay_std_driver</title>
<script src="jquery.min.js"></script>
<style>
#button{
	background-color:#262626;
}
.center{
  position: fixed;
  width: 40%;
  top:50%;
}
</style>
</head>
<body>
    <?php
    $location = "";
        if (isset($_GET['location']) && $_GET['location'] == "remote"){
            $location = "remote";
        }else{
            $location = "local";
        }
    ?>
<div id="ipv4" style="position:fixed;top:10px;left:10px;z-index:10;color:white;"><?php echo $_GET['ip'];?></div>
<div id="button" style="width:100%;height:100%;position:fixed;left:0px;top:0px;" onClick="toggleSwitch();">
<img id="icon" class="center" src="img/default_transparent.png"></img>
</div>
<div id="uuid" style="position:fixed;bottom:10px;left:10px;color:white;"></div>
<script>
var uuid = "";
var currentStatus = "OFF";
var clientLocation = "<?php echo $location; ?>";
var ip = "<?php echo $_GET['ip'];?>";
getUUID();
status();
$(document).ready(function(){
    moveIcon();
});


function status(results){
    requestTargetURL("/status",updateStatus);
}

function updateStatus(result){
    $("#status").html(result);
	if (result == "ON"){
		$("#button").css("background-color","#00cccc");
		currentStatus = "ON";
	}else{
		$("#button").css("background-color","#262626");
		currentStatus = "OFF";
	}
}

function moveIcon(){
	$("#icon").css("top",(window.innerHeight /2 - $("#icon").height() / 2) + "px");
	$("#icon").css("left",(window.innerWidth /2 - $("#icon").width() / 2) + "px");
}

function toggleSwitch(){
	if (currentStatus == "OFF"){
		on();
	}else{
		off();
	}
}

function requestTargetURL(subpath,callback){
    //Define the basic request URL
    var requrl = ip + subpath;
    //Check if the request is coming from external or internal (LAN)
    if (clientLocation == "remote"){
        //This request is from external network. Use the request repeater to repeat the HTTP request
        requrl = "../../extreq.php?reqestRepeat=" + requrl;
        $.ajax({url: requrl, success: function(result){
            //Perform the callback function
            callback(result);
        }});
        
    }else if (clientLocation == "local"){
        //This request is from LAN. Directly ask the client to request the device.
        $.ajax({url: "http://" + requrl, success: function(result){
            //Perform the callback function
            callback(result);
        }});
    }
}

function off(){
    requestTargetURL("/off",status);
}

function on(){
     requestTargetURL("/on",status);
}

function showUUID(result){
     $("#uuid").text(result);
	 uuid = result;
}

function getUUID(){
    requestTargetURL("/uuid",showUUID);
}


</script>
</body>
</html>