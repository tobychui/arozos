<html>
<head>
<title>relay_std_driver</title>
<link rel="stylesheet" href="basic/tocas.css">
<script src="basic/jquery.min.js"></script>
<style>
#button{
	background-color:#262626;
}
.center{
  display: block;
  margin-left: auto;
  margin-right: auto;
  width: 40%;
  top:30%;
}
</style>
</head>
<body style="background-color:#00cccc;">
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;color:white;"><?php echo $_GET['ip'];?></div>
<div style="width:100%;height:100%;position:fixed;left:20px;top:20px;padding-left:10px;">
<br>
<div class="ts horizontal statistics">
    <div class="statistic">
        <div id="temp" class="value" style="color:white;">init</div>
        <div class="label"  style="color:white;">°C</div>
    </div>
    <div class="statistic">
        <div id="hum" class="value"  style="color:white;">init</div>
        <div class="label" style="color:white;">%</div>
    </div>
</div>
<img id="icon" class="center" src="" style="display:none;"></img>
</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;color:white;"></div>
<script>
status();
setInterval(status,5000);
uuid();
function status(){
$.ajax({url: "http://<?php echo $_GET['ip'];?>/status", 
	success: function(result){
        $("#temp").text(result.temp);
		$("#hum").text(result.humi);
    }});
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
		getNickName();
    }});
}

function getNickName(){
	$.ajax({url: "../nicknameman.php?uuid=" + $("#uuid").text().trim(), success: function(result){
        if (result.includes("ERROR") == false){
			$("#uuid").text(result);
			getIcon();
		}else{
			
		}
    }});
}

function getIcon(){
	$.ajax({url: "../nicknameman.php?nickname=" + $("#uuid").text().trim(), success: function(result){
        if (result.includes("true") == true){
			$("#icon").attr('src','../img/icons/'+ $("#uuid").text().trim() +'.png');
			$("#icon").show();
		}
    }});
}
</script>
</body>
</html>