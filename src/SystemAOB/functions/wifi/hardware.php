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
	<style>
	.ts.items>.item>.image:not(.ts):not(.flexible) {
		 width: 60px; !important 
	}
	</style>
   </head>


<body>
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Hardware
			<div class="sub header">Network Interface Card Hardware List</div>
		</div>
	</div>
	<div class="ts container">


	</div>
</div>
<br>
<div class="ts container">
	<div class="ts divided items" id="wifi">
	</div>	
</div>

<script>
var template = '<div class="item"><div class="image"><img style="height:64px;width:auto" src="./fonts/%image%.png"></div><div class="content"><p class="header">%interfacename%</p><div class="description">%data%</div></div></div>';
var inWindows = <?php if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') { echo "true";}else{echo "false";}?>;
wifi();

function wifi(){
	if (inWindows){
		$.getJSON("ifconfig.php", function(result){
            if (result != []){
				for (var i =0; i < result.length; i++){
					$("#wifi").append( result[i] + '<div class="ts section divider"></div>');
				}

			}
			$("#wifi").css("padding","20px");
		});
	}else{
		$.getJSON("ifconfig.php", function(result){
            $.each(result, function(i, field){
				if(field[3] !== "lo:"){
					$("#wifi").append(template.replace("%image%",field["InterfaceIcon"]).replace("%interfacename%",field["InterfaceIcon"] + " " + field["InterfaceID"]).replace("%data%","MAC Address : " + field["HardwareAddress"] + "<br>IPv4 Address : " + field["IPv4Address"] + "<br>Subnet Mask : " + field["IPv4SubNetMask"] + "<br>IPv6 Address : " + field["IPv6Address"]));
					
				}
            });
		});
	}
	
}

</script>
</body>
</html>