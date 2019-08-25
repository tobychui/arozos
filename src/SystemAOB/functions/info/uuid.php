<?php
include_once '../../../auth.php';
?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>ArOZ Online - System Information</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body style="background-color:#f9f9f9;">
<br><br><br>
<div class="ts container">
	<div class="ts big header">
		Device UUID
		<div class="sub header">Device UUID is the identification pointer for cross ArOZ Online System file posting and downloading services.</div>
	</div>
	<div id="uuid" class="ts inverted primary segment">
		<h3 style="color:white;">Loading...</h3>
	</div>
	<div class="ts divider"></div>
	Scanner Return Inforamtion
	<div id="scannerreturn" class="ts segment">
		<?php include_once("../../../hb.php");?>
	</div>
	<div class="ts divider"></div>
	Detail Information on UUID and Request Response Message
    <div id="details" class="ts segment">
	
	</div>
	<div class="ts segment">
		<code>You can modify the UUID with /nano /etc/AOB/device_identity.config if you are on Linux or Notepad++ C:/AOB/device_identity.config.<br>
		However, we strongly not recommend users modifying their uuid as this might lead to many problems in data synchronization and system services.</code> 
	</div>
</div>
</div>
<script>
$(document).ready(function(){
	var scannervalue = $("#scannerreturn").text();
	var data = scannervalue.split(",");
	$("#details").append("System Type: " + data[0] + '<br>');
	$("#details").append("System Status: " + data[1] + '<br>');
	$("#details").append("Identification UUID: " + data[2] + '<br>');
	$("#details").append("Assigned IP Address: " + data[3] + '<br>');
	$("#uuid h3").text(data[2]);
});
</script>
</body>
</html>