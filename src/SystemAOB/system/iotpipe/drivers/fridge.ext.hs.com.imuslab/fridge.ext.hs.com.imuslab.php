<?php
include_once("../../../../../auth.php");
$mode = "local";
if (isset($_GET['location']) && $_GET['location'] == 'remote'){
    $mode = "remote";
}

if (isset($_GET['getStatus'])){
    header('Content-Type: application/json');
    echo file_get_contents("http://" . $_GET['getStatus'] . "/status");
    die();
}else if (isset($_GET['getUUID'])){
    header('Content-Type: application/json');
    echo file_get_contents("http://" . $_GET['getStatus'] . "/uuid");
    die();
}

?>
<html>
<head>
<title>relay_std_driver</title>
<link rel="stylesheet" href="../basic/tocas.css">
<script src="../basic/jquery.min.js"></script>
<style>
#button{
	background-color: #fcfcfc;
}
body{
	height:100% !important;
}
.center{
  display: block;
  margin-left: auto;
  margin-right: auto;
  width: 50%;
  top:30%;
}
small{
	font-size:90%;
	
}
.bottom{
	position:absolute;
	bottom:0px;
	font-size:120%;
	font-family: "Courier New";
}
</style>
</head>
<body style="background-color:#fcfcfc;">
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;"><?php echo $_GET['ip'];?></div>
<div style="width:100%;padding-top:15%;" align="center">
    <br>
	<p>Fridge Temperature</p>
    <div class="ts horizontal huge fluid center statistics" align="center">
        <div class="statistic">
            <div id="temp" class="value" >0</div>
            <div class="label" style="font-size:4em">°C</div>
        </div>
    </div>
	<br><br>
	<p>Target Temperature (°C)</p>
	<div class="ts basic input">
		<input id="targetTemp" type="number" placeholder="10" readonly=true>
	</div>
	<button class="ts button" onClick="updateTemp(1);">↑</button>
	<button class="ts button" onClick="updateTemp(-1);">↓</button>
	<br><br>
	<div id="updateComplete" class="ts raised segment" style="display:none;">
		<div style="color:#2dbd75;">	✓ Setting updated.</div>
	</div>
    <img id="icon" class="center" src="" style="display:none;"></img>
</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;color:white;"></div>
<div id="mode" mode="<?php echo $mode; ?>" style="position:fixed;bottom:18px;left:3px; display:none;"><?php echo "Control Mode: " . $mode; ?></div>
<div class="bottom">Project HomeStack</div>
<script>
var mode = $("#mode").attr("mode").trim();
var scriptName = "XD-28.std.hd.com.imuslab.php";
var ipaddr = "<?php echo $_GET['ip']; ?>";

uuid();
status();
if (mode == "remote"){
    setInterval(status,10000);
}else{
    setInterval(status,5000);
}

function updateTemp(addValue){
	if (addValue > 0){
		//Up
		$.get("http://" + ipaddr + "/up",function(data){
			//$("#targetTemp").val(data["desire temperature"]);
			status();
		});
	}else if (addValue < 0){
		//Down
		$.get("http://" + ipaddr + "/down",function(data){
			//$("#targetTemp").val(data["desire temperature"]);
			status();
		});
	}
	$("#updateComplete").stop().finish().fadeIn('fast').delay(3000).fadeOut('fast');
}

function status(){
    var targetUrl = "http://" + ipaddr + "/status";
    if (mode == "remote"){
        targetUrl = scriptName + "?getStatus=" + ipaddr;
    }
    $.ajax({url: targetUrl, 
    	success: function(result){
    		$("#temp").text(result.temp);
			$("#targetTemp").val(result["desire temerature"]);
        }});
}


function uuid(){
    var targetURL = "http://" + ipaddr + "/uuid"
    if (mode == "remote"){
        targetURL = scriptName + "?getUUID=" + ipaddr;
    }
	$.ajax({url: targetURL, success: function(result){
        $("#uuid").text(result);
    }});
}

</script>
</body>
</html>