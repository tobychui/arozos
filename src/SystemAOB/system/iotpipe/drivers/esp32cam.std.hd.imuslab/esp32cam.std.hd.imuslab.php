<html>
<head>
<title>esp32cam_driver</title>
<link rel="stylesheet" href="../basic/tocas.css">
<script src="../basic/jquery.min.js"></script>
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
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;color:white;">
    <?php echo $_GET['ip'];
    if (isset($_GET['location']) && $_GET['location'] == "remote"){
        echo '<br> Invalid setting: location_remote.';
    }
?>
    </div>
<div id="button" style="width:100%;height:100%;position:fixed;left:0px;top:0px;">
<img id="capture" class="center" src=""></img>
</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;color:white;"></div>
<script>
uuid();

function startConnection(){
	$("#capture").attr("src","http://<?php echo $_GET['ip']; ?>");
}

function openNewWindow(){
	window.open(window.location);
}

function uuid(){
	$.ajax({url: "http://<?php echo $_GET['ip'];?>/uuid", success: function(result){
        $("#uuid").text(result);
        startConnection();
    }});
}

</script>
</body>
</html>