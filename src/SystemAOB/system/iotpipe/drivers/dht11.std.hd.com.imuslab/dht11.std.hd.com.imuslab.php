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
	background-color: #f7f7f7;
}
.center{
  display: block;
  margin-left: auto;
  margin-right: auto;
  width: 50%;
  top:30%;
}

</style>
</head>
<body style="background-color:#00cccc;">
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;color:white;"><?php echo $_GET['ip'];?></div>
<div style="width:100%;padding-top:15%;" align="center">
    <br>
    <div class="ts horizontal huge fluid center statistics" align="center">
        <div class="statistic">
            <div id="temp" class="value" style="color:white;">init</div>
            <div class="label"  style="color:white;font-size:4em">°C</div>
        </div>
        <div class="statistic">
            <div id="hum" class="value"  style="color:white;">init</div>
            <div class="label" style="color:white;font-size:4em">%</div>
        </div>
    </div>
    <img id="icon" class="center" src="" style="display:none;"></img>
</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;color:white;"></div>
<div id="mode" mode="<?php echo $mode; ?>" style="position:fixed;bottom:18px;left:3px;color:white;"><?php echo "Control Mode: " . $mode; ?></div>
<script>
var mode = $("#mode").attr("mode").trim();
var scriptName = "dht11.std.hd.com.imuslab.php";
var ipaddr = "<?php echo $_GET['ip']; ?>";

uuid();
status();
if (mode == "remote"){
    setInterval(status,10000);
}else{
    setInterval(status,5000);
}

function status(){
    var targetUrl = "http://" + ipaddr + "/status";
    if (mode == "remote"){
        targetUrl = scriptName + "?getStatus=" + ipaddr;
    }
    $.ajax({url: targetUrl, 
    	success: function(result){
            $("#temp").text(result.temp);
    		$("#hum").text(result.humi);
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