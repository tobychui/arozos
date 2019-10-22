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
<div id="ipv4" style="position:fixed;top:10px;left:10px;z-index:10;color:white;"><?php echo $_GET['ip'];?></div>
<div id="button" style="width:100%;height:100%;position:fixed;left:0px;top:0px;" onClick="toggleSwitch();">
<img id="icon" class="center" src="img/default_transparent.png"></img>
</div>
<div id="uuid" style="position:fixed;bottom:10px;left:10px;color:white;"></div>
<script>
status();
uuid();
var uuid = "";
var currentStatus = "OFF";
moveIcon();
function status(){
$.ajax({url: "http://<?php echo $_GET['ip'];?>/status", 
	success: function(result){
        $("#status").html(result);
		if (result == "ON"){
			$("#button").css("background-color","#00cccc");
			currentStatus = "ON";
		}else{
			$("#button").css("background-color","#262626");
			currentStatus = "OFF";
		}
    }});
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

function off(){
	$.ajax({url: "http://<?php echo $_GET['ip'];?>/off", success: function(result){
        status();
    }});
}

function on(){
	$.ajax({url: "http://<?php echo $_GET['ip'];?>/on", success: function(result){
        status();
    }});
}

function uuid(){
	$.ajax({url: "http://<?php echo $_GET['ip'];?>/uuid", success: function(result){
        $("#uuid").text(result);
		uuid = result;
    }});
}


</script>
</body>
</html>