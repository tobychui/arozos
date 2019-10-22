<?php
if (isset($_GET['status'])){
	$content = file_get_contents("http://" . $_GET['status'] . "/ay");
	header('Content-Type: application/json');
	echo json_encode(str_replace("{t}","",strip_tags($content)));
	exit(0);
}else if (isset($_GET['toggle']) && $_GET['toggle'] !=""){
	$content = file_get_contents("http://" . $_GET['toggle'] . "/ay?o=1");
	header('Content-Type: application/json');
	echo json_encode(str_replace("{t}","",strip_tags($content)));
	exit(0);
}
?>
<html>
<head>
<title>s26_sonoff_driver</title>
<link rel="stylesheet" href="tocas.css">
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
<div id="infoPage" style="position:fixed;left:0px;top:0px;color:white;z-index:999;display:none;"><?php
$content = strip_tags(file_get_contents("http://" . $_GET['ip'] . "/in"));
if (strpos($content,"Sonoff-Tasmota") !== 0){
	//This is a correctly loaded driver
	echo $content;
}else{
	die("ERROR. This is not a Sonoff-Tasmota driven device or your driver is outdated.");
}

?></div>
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;color:white;"><?php echo $_GET['ip'];?></div>
<div id="button" style="width:100%;height:100%;position:fixed;left:0px;top:0px;" onClick="toggleSwitch();">
<img id="icon" class="center" src="img/default_transparent.png"></img>
</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;color:white;"></div>
<script>
uuid();
status();
moveIcon();
function status(){
$.ajax({url: "s26.sonoff.ext.com.imuslab.php?status=" + $("#ipv4").text().trim(), 
	success: function(result){
		console.log(result);
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

function toggleSwitch(){
	$.ajax({url: "s26.sonoff.ext.com.imuslab.php?toggle=" +  $("#ipv4").text().trim(), 
	success: function(result){
		console.log(result);
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

function uuid(){
	var deviceInfo = $("#infoPage").text();
	var starting = deviceInfo.indexOf("MAC");
	var MACADDR = deviceInfo.substring(starting);
	var ending = MACADDR.indexOf("MQTT");
	//Just a bunch of scripts to filter out the MAC address
	MACADDR = MACADDR.substring(0,ending - 7);
	starting = MACADDR.indexOf("}");
	MACADDR = MACADDR.substring(starting + 2);
	MACADDR = MACADDR.split(":").join("-");
	$("#uuid").text(MACADDR);
}

function moveIcon(){
	$("#icon").css("top",(window.innerHeight /2 - $("#icon").height() / 2) + "px");
	$("#icon").css("left",(window.innerWidth /2 - $("#icon").width() / 2) + "px");
}


</script>
</body>
</html>