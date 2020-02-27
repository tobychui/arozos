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
	<p>Soil Moisture</p>
    <div class="ts horizontal huge fluid center statistics" align="center">
        <div class="statistic">
            <div id="hum" class="value" >0</div>
            <div class="label" style="font-size:4em">%</div>
        </div>
    </div>
	<br><br>
	<p>Plant Type</p>
	<select id="plantType" class="ts basic fluid dropdown">
		<option plant="plant1">Snake Plant</option>
		<option plant="plant2">Tequila</option>
		<option plant="plant3">Saivia</option>
		<option plant="plant4">Parsley</option>
	</select>
	<br><br>
	<small>The setting will be updated immediately after the selection change.</small>
	
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


$('#plantType').on('change', function() {
  //On plant type change, request the module to set plantType
  var url = $('option:selected', this).attr("plant");
  url = "http://" + ipaddr + "/" + url;
  console.log(url);
  $.get(url,function(data){
	  console.log(data);
  });
});

function status(){
    var targetUrl = "http://" + ipaddr + "/status";
    if (mode == "remote"){
        targetUrl = scriptName + "?getStatus=" + ipaddr;
    }
    $.ajax({url: targetUrl, 
    	success: function(result){
    		$("#hum").text(result.soilHumi);
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