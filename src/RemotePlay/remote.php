<?php
include_once '../auth.php';
if(!file_exists("data")){
	mkdir("data",0777,true);
}
if (isset($_GET['comm']) && isset($_GET['rid'])){
	$rid = $_GET['rid'];
	$rid = explode(",",$rid)[0];
	file_put_contents("data/" . $rid . ".inf",$_GET['comm']);
	echo "DONE";
	exit(0);
}
?>
<html>
<head>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	<script src="../script/jquery.min.js"></script>
	<script src="../script/ao_module.js"></script>
	<link rel="manifest" href="manifest.json">
	<style>
	body{
		background-color:#0c0c0c;
		color:white;
	}
	.white{
		color:white !important;
	}
	::placeholder{
		color: white !important;
	}
	</style>
</head>
<body>
<br>
<div class="ts container">
<div class="ts white header">
    <i class="options icon"></i>RemotePlay Remote
    <div class="sub white header">Control your remote player here!</div>
</div>
	<p class="white">Target RemotePlay ID</p>
	<div class="ts floating dropdown labeled icon button" style="padding: 0px;padding-right: calc(0.22em + 1em + .78571em * 2) !important;padding-left: 0em !important;background-color: black;color:white;height: 39.97px;width:100%">
		<div class="text" style="width:100%">
			<div class="ts fluid input" style="right 1px;bottom:1px">
				<input type="text" style="border-top-right-radius: 0px;border-bottom-right-radius: 0px;background-color: black;color: white!important;border-color: white!important;border-right:0px" placeholder="RemotePlay ID" id="remoteID_tb">
			</div>
		</div>
		<i class="caret down icon" style="left: auto !important;right: 0em !important;background-color: black;"></i>
		<div class="menu" style="background-color: black !important;"  id="n_remoteID">
		</div>
	</div>
	<!--
	<div class="ts basic mini fluid input">
		<select class="ts basic dropdown" id="remoteID" style="background: black;color: white;width: 100%">
			<option>Scanning...</option>
		</select>
	</div>
	-->
	<p class="white">Volume Control (Min <--> Max)</p>
	<div class="ts slider">
		<input id="vol" type="range" min="0" max="1" step="0.05" value="0">
	</div>
	<br>
	<div class="ts separated mini buttons">
		<button class="ts basic white button" onClick="play();"><i class="play icon"></i>Play</button>
		<button class="ts basic white button" onClick="pause();"><i class="pause icon"></i>Pause</button>
		<button class="ts basic white button" onClick="bwd();"><i class="backward icon"></i>Backward</button>
		<button class="ts basic white button" onClick="fwd();"><i class="forward icon"></i>Forward</button>
		<button class="ts basic white button" onClick="fbwd();"><i class="fast backward icon"></i>Fast backward</button>
		<button class="ts basic white button" onClick="ffwd();"><i class="fast forward icon"></i>Fast forward</button>
		<button class="ts basic white button" onClick="stop();"><i class="stop icon"></i>Stop</button>
		<button class="ts basic white button" onClick="mute();"><i class="volume off icon"></i>Mute</button>
		<button class="ts basic white button" onClick="reset();"><i class="stop icon"></i>Reset</button>
	</div>
</div>
<script>
var rid = "";
$(document).ready(function(){
	ao_module_setWindowSize(1000,340);
	ts('.ts.dropdown:not(.basic)').dropdown();
	$(".ts.fluid.input").click(function(e) {
		e.stopPropagation();
	});
	var h = $(".ts.fluid.input").height();
	$(".ts.floating.dropdown.labeled.icon.button").attr("style",$(".ts.floating.dropdown.labeled.icon.button").attr("style").replace("39.97",h));
	//$(".caret.down.icon").attr("style",$(".caret.down.icon").attr("style").replace("39.97",h));
	update();
});

setInterval(update, 10000);
function update(){
		var previousRemoteID = ao_module_getStorage("remoteplay","remoteID");
	$.get("opr.php?opr=scanalive",function(data){
		var obj = JSON.parse(data);
		$("#n_remoteID").html("");
		$("#n_remoteID").append($('<div class="item" style="color: white!important;"></div>').attr("value", "").text("Not selected"));
		$.each( obj, function( key, value ) {
			$("#n_remoteID").append($('<div class="item" style="color: white!important;"></div>').attr("value", value).text(value));
		});
		$("#n_remoteID").val("");
		/*
		if (previousRemoteID !== undefined && $(".item[value='" + previousRemoteID + "']").length > 0){
			$("#remoteID_tb").val(previousRemoteID);
			rid = previousRemoteID;
		}
		*/
		$("#remoteID_tb").val(previousRemoteID);
		$("#n_remoteID .item").on("click",function(){
			//console.log($(this).attr("value"));
			$("#remoteID_tb").val($(this).attr("value"));
			ao_module_saveStorage("remoteplay","remoteID",$(this).attr("value"));
			rid = $(this).attr("value");
		});
		$("#remoteID_tb").on("change",function(){
			ao_module_saveStorage("remoteplay","remoteID",$(this).val());
			rid = $(this).val();
		});
	});
}

$("#vol").on("change",function(){
	sendCommand("setVol",$(this).val());
});
	
function play(){
	sendCommand("play","");
}

function pause(){
	sendCommand("pause","");
}

function fwd(){
	sendCommand("fwd","");
}

var ffwding = false;
function ffwd(){
	if(ffwding){
		clearInterval(timer_1);
		ffwding = false;
		$("button").removeAttr("disabled");
		$("#vol").removeAttr("disabled");
	}else{
	  timer_1 = setInterval(fwd, 1000);
	  ffwding = true;
	  $("#vol").attr("disabled","disabled");
	  $("button").attr("disabled","disabled");
	  $(".fast.forward.icon").parent().removeAttr("disabled");
	}
}

function bwd(){
	sendCommand("bwd","");
}

var fbwding = false;
function fbwd(){
	if(fbwding){
		clearInterval(timer_1);
		fbwding = false;
		$("button").removeAttr("disabled");
		$("#vol").removeAttr("disabled");
	}else{
	  timer_1 = setInterval(bwd, 1000);
	  fbwding = true;
	  $("#vol").attr("disabled","disabled");
	  $("button").attr("disabled","disabled");
	  $(".fast.backward.icon").parent().removeAttr("disabled");
	}
}

function stop(){
	sendCommand("stop","");
}

function mute(){
	sendCommand("setVol","0");
	$("#vol").val(0);
}

function reset(){
	sendCommand("reset","");
}

function sendCommand(comm,value){
	var fullcomm = comm + "," + value;
	$.get("remote.php?comm=" + fullcomm + "&rid=" + rid,function(data){
		if (data.includes("ERROR")){
			
		}
	});
}



/*
$(document).ready(function(){
	var previousRemoteID = ao_module_getStorage("remoteplay","remoteID");
	$.get("opr.php?opr=scanalive",function(data){
		var obj = JSON.parse(data);
		$("#remoteID").html("");
		$("#remoteID").append($("<option></option>").attr("value", "").text("Not selected"));
		$.each( obj, function( key, value ) {
			$("#remoteID").append($("<option></option>").attr("value", value).text(value));
		});
		$("#remoteID").val("");
		if (previousRemoteID !== undefined && $("#remoteID option[value='" + previousRemoteID + "']").length > 0){
			$("#remoteID").val(previousRemoteID);
			rid = previousRemoteID;
		}
	});
});
*/
</script>
</body>
</html>