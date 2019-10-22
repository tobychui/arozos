<html>
<head>
<title>esp32cam_driver</title>
<link rel="stylesheet" href="basic/tocas.css">
<script src="basic/jquery.min.js"></script>
<style>
#button{
	background-color:#262626;
}
.center{
  display:fixed;
  left:0px;
  top:0px;
  width:100%;
  height:100%;
}
</style>
</head>
<body>
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;color:white;"><?php echo $_GET['ip'];?></div>
<div id="button" style="width:100%;height:100%;position:fixed;left:0px;top:0px;">
<img id="capture" class="center" src="" onClick="openNewWindow();"></img>
</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;color:white;"></div>
<script>
startConnection();
uuid();

function startConnection(){
	$("#capture").attr("src","http://<?php echo $_GET['ip'];?>/capture?_cb=" + (new Date().getTime())); 
	setTimeout(startConnection,1000);
}

function openNewWindow(){
	window.open(window.location);
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
		}
    }});
}
</script>
</body>
</html>