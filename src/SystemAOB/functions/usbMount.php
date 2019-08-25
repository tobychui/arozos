<?php
include '../../auth.php';
?>
<!DOCTYPE html>
<!-- USB Mounting Script on Linux System. DO NOT USE THIS ON WINDOW MACHINES-->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../../script/tocas/tocas.css">
	<script type='text/javascript' src="../../script/tocas/tocas.js"></script>
	<title>ArOZ Onlineβ</title>
</head>
<body>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    $isWindows = true;
} else {
    $isWindows = false;
}
?>
<div class="ts container">
	<div class="ts horizontal divider">Mounted USB Devices</div>
	<div id="deviceList" class="ts list" >

	</div>
	
	<?php 
	if (!$isWindows){
		//Linux, print out the detected USB drive list
		echo '<div class="ts horizontal divider">Storage Device List</div>';
		echo '<div id="mountList" class="ts list" ></div>';
	}else{
		echo '<details id="linuxOnlyFunctions" class="ts accordion"><summary>
				<i class="dropdown icon"></i> Hidden Functions (for Linux Environment)
			</summary><div class="content">';
	}
	
	?>
	<!-- External Storage Mounting options-->
	<div class="ts horizontal divider">External Storage Device Mount Options</div>
	This mounting options is for the external USB storage device.
	<div class="ts fluid small buttons">
	<button class="ts fluid positive button" onClick="MountExtUSB();">Mount sdc1 to /dev/pi</button>
	<button class="ts fluid negative button" onClick="UmountExtUSB();">Umount /dev/pi</button>
	</div>
	<!-- Internal Storage Mounting options-->
	<div class="ts horizontal divider">Internal Device Mounting Options (Developer only)</div>
	<div class="ts inverted vertically fitted segment">
	<details class="ts inverted accordion">
		<summary>
			<i class="dropdown icon"></i> Internal Storage Options
		</summary>
		<div class="content">
			<mark><i class="caution sign icon"></i>Warning! Internal Storage are auto-mounted and not suppose to unmount</mark> in the design of AOB System.<br>
			Please use these functions only for debugging and use with your own risk.
			<div class="ts fluid small buttons">
				<button class="ts primary button" onClick="debug_moso();">Mount /dev/Storage1</button>
				<button class="ts primary button" onClick="debug_most();">Mount /dev/Storage2</button>
			</div>
			<div class="ts fluid small buttons">
				<button class="ts negative button" onClick="debug_umso();">Umount /dev/Storage1</button>
				<button class="ts negative button" onClick="debug_umst();">Umount /dev/Storage2</button>
			</div>
		</div>
	</details>
	</div>
	
	<?php
		if ($isWindows) {echo '</div></details>';}
	?>
	
	
	
<br>
ArOZ Online BETA SystemAOB Storage Devices Mounting Tool
<br>
</div>


<script>
var isWindows = <?php echo $isWindows ? "true" : "false";?>;
$(document).ready(function(){
	UpdateUSBList();
	if (!isWindows){
		//Only linux has mounting problems, list storage list
		UpdateStorageDeviceList();
		setInterval(function(){ 
			//The usb list will be updated every 30 sec
			UpdateUSBList();
			UpdateStorageDeviceList();
		}, 30000);
	}else{
		//Windows system, then only update USB list.
		//As most Windows devices has higher processing power, update interval has been lowered
		$("#linuxOnlyFunctions").hide();
		setInterval(function(){ 
			//The usb list will be updated every 30 sec
			UpdateUSBList();
		}, 15000);
		
	}
});

function UpdateUSBList(){
	$.get("system_statistic/usbPorts.php", function(data) {
		var devices = data;
		$('#deviceList').html("");
		for (var i = 0; i < devices.length; i++){
			if (devices[i] != ""){
				if (devices[i].length > 50){
					var etc = "...";
				}else{
					var etc = "";
				}
				$('#deviceList').append('<div class="item"><i class="usb icon"></i>&nbsp'+ devices[i].substring(0, 50) + etc + '</div>');
			}
		}
	});
}

function UpdateStorageDeviceList(){
	$.get("ntfs-3g.php?listUSB", function(data) {
		$('#mountList').html("");
		if (data == ""){
			$('#mountList').append('<div class="item"><i class="remove icon"></i>No External Storage Device Found.</div>');
		}else{
			for (var i =0; i < data.length; i++){
				if (data[i] != ""){
					if (data[i].length > 50){
						var etc = "...";
					}else{
						var etc = "";
					}
					$('#mountList').append('<div class="item"><i class="disk outline icon"></i>&nbsp'+ data[i].substring(0, 50) + etc + '</div>');
				}
			}
		}
	});
}

function MountExtUSB(){
	//Mount sdc1 to /media/pi 
	$.get("ntfs-3g.php?md=/dev/sdc1&mpn=/media/pi", function(data) {
		window.location.reload();
	});
}

function UmountExtUSB(){
	//Umount sdc1 from /media/pi
	$.get("ntfs-3g.php?mpo=/media/pi", function(data) {
		alert("External USB Unmounted. You can now remove the external storage from the system.");
		window.location.reload();
	});
}

function debug_umso(){
	$.get("ntfs-3g.php?mpo=/media/storage1", function(data) {
		window.location.reload();
	});
}

function debug_umst(){
	$.get("ntfs-3g.php?mpo=/media/storage2", function(data) {
		window.location.reload();
	});
}

function debug_moso(){
	$.get("ntfs-3g.php?md=/dev/sda1&mpn=/media/storage1", function(data) {
		window.location.reload();
	});
}

function debug_most(){
	$.get("ntfs-3g.php?md=/dev/sdb1&mpn=/media/storage2", function(data) {
		window.location.reload();
	});
}
</script>
</body>
<html>