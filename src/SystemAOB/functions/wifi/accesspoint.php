<?php
include '../../../auth.php';
?>

<!DOCTYPE html>
<html>
   <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="../../../script/tocas/tocas.css">
      <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
      <script src="../../../script/jquery.min.js"></script>
      <title>WIFI</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">

   </head>


<body>
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			AP Settings
			<div class="sub header">AP SSID and Password can be modified here.</div>
		</div>
	</div>
	<div class="ts container">


	</div>
</div>
<br>
<div class="ts container">
<table>
   <tr>
      <td>AP SSID</td>
      <td>
         <div class="ts mini fluid input"><input name="apssid" id="apssid" type="text" placeholder="SSID"></div>
      </td>
   </tr>
   <tr>
      <td>AP Password</td>
      <td>
         <div class="ts mini fluid input"><input type="text" placeholder="Password" id="appwd" name="appwd" pattern="[a-zA-Z0-9]{8,}"></div>
      </td>
   </tr>
   <tr>
      <td colspan="2"><button onclick="update()" class="ts basic button">Update</button></td>
   </tr>
</table>
	</div>
		

      <div class="ts snackbar">
         <div class="content"></div>
         <a class="action"></a>
      </div>
<script>
startup();

function startup(){
//Please ADD ALL LOAD ON STARTUP SCRIPT HERE
loadstatus();
}

var haswifi = false;
$.get("ifconfig.php", function (data) {
	data.forEach(function(element) {
         if(element["InterfaceIcon"] == "WiFi"){
			haswifi= true;
        }
    });
	if(!haswifi){
		window.location = "nowifi.html"
    }
});

function loadstatus(){
$.getJSON("ap.php", function (data) {
	$("#apssid").val(data[1]);
	$("#appwd").val(data[9]);
});
}

function msg(content) {
		ts('.snackbar').snackbar({
			content: content,
			actionEmphasis: 'negative',
		});
}

function update(){
$.ajax({url:"ap_write.php?ssid=" + $("#apssid").val() + "&pw=" + $("#appwd").val(),async:false});
msg("AP Settings Updated. Changes will be made after reboot.");
}


</script>
</body>
</html>