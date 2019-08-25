<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
	<meta charset="UTF-8">
	<script type='text/javascript' charset='utf-8'>
		// Hides mobile browser's address bar when page is done loading.
		  window.addEventListener('load', function(e) {
			setTimeout(function() { window.scrollTo(0, 1); }, 1);
		  }, false);
	</script>
    <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
	<script src="../../../script/jquery.min.js"></script>
    <title>My Host</title>
    <style type="text/css">
        body {
            background-color: rgba(250, 250, 250,0.9);
            overflow: scroll;
        }
    </style>
</head>
<body>
<?php

$isWindows = 0;
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    $isWindows = 1;
} else {
    $isWindows = 0;
}

?>
    <br>
    <br>

    <div class="ts narrow container grid">

        <div class="sixteen wide column">
            <h3 class="ts dividing header">
                <i class="desktop icon"></i>ArOZ Online System
            </h3>
        </div>



        <div class="two column row">

            <div class="column" id="hardwareInfo">
				<?php if ($isWindows){
					echo '<strong>Hardware Information</strong><table class="ts table"><thead>
                    <tr>
                        <th>Server Description</th>
                    </tr>
					</thead><tbody id="winCPUdescrption"><tr><td>' . php_uname() . '</td></tr></tbody></table>';
				}else{
					echo 'Loading...';
				}
                ?>
            </div>
			
            <div class="column" id="driveInfo">
                Loading...
			</div>

        </div>

		
        <div class="sixteen wide column">
            <br>
            <table class="ts table">
                <thead>
                    <tr>
                        <th>Network Adaptor</th>
                    </tr>
                </thead>
                <tbody id="networkAdaptor">
					<?php if ($isWindows){
						//Now Network Adaptor scan support Windows machine
						//echo '<tr><td>IP Address: '.$_SERVER['SERVER_ADDR'].'</td></tr>';
						//echo '<tr><td>Port: '.$_SERVER['SERVER_PORT'].'</td></tr>';
						//echo '<tr><td>Host Name: '. gethostname() .'</td></tr>';
					}
					?>
                </tbody>
            </table>
        </div>

		
        <div class="six wide column">
            <br>
            <h4 class="ts header">Operating System</h4>
			<div class="ts segment"><?php echo PHP_OS;?></div>
            <h4 class="ts header">Powering Condition</h4>
			<div id="throttleDetect" class="ts segment"></div>
        </div>


        <div class="ten wide column">
            <br>
            <h4 class="ts header">USB Adaptors</h4>
            <table class="ts table">
                <tbody id="usbAdaptor">
                    <?php if ($isWindows){
						//echo '<tr><td>NOT SUPPORTED ON WINDOWS SYSTEM</td></tr>';
					}
					?>
                </tbody>
            </table>
        </div>
    </div>
	<div class="ts container">
		<div class="ts section divider"></div>
		<a href="">Refresh Information</a><br>
		System written by Toby Chui @ IMUS Laboratory<br>
		Please refer to individual modules license information.<br><br>
	</div>
	<div style="position:fixed;top:2%;right:2%;height:20px;width:20px;" onClick="window.location.reload();">
		<a style="font-size:200%;color:#222;"><i class="refresh icon"></i></a>
	</div>
<script>
var isWindows = <?php echo $isWindows;?>;
$(document).ready(function(){
	if (isWindows == false){
		Request("getCPUinfo.php",UpdateHardwareInfo);
	}else{
		Request("getCPUinfo.php",UpdateServerInfo);
	}
	Request("ifconfig.php",GetNetworkAdaptor);
	Request("getDriveStat.php",UpdateDriveInfo);
	Request("usbPorts.php",GetUSBAdaptors);
	Request("getThrottled.php",GetThrottledMode);
});

function GetThrottledMode(result){
    $("#throttleDetect").html(result);
}

function UpdateServerInfo(result){
	var CPUname = result[0];
	var Clockspeed = result[1];
	$("#winCPUdescrption").append('<tr><td>Processor: ' + CPUname + '</td></tr>');
	$("#winCPUdescrption").append('<tr><td>ClockSpeed: ' + Clockspeed + '</td></tr>');
}

function UpdateHardwareInfo(result){
    
	if (result.includes("ERROR") == false){
		var displayInfo = "<strong>Hardware Information</strong><br>";
		displayInfo += '<table class="ts table"><thead><tr><th>Info</th><th>value</th></tr></thead><tbody>';
		displayInfo += "<tr><td>Processor</td><td>" + searchForKeyInArray("model name",result) + '</td></tr>';
		displayInfo += "<tr><td>Speed</td><td>" + searchForKeyInArray("cpu MHz",result) + ' Mhz </td></tr>';
		displayInfo += "<tr><td>Instruction Set</td><td>" + searchForKeyInArray("BogoMIPS",result) + '</td></tr>';
		displayInfo += "<tr><td>Hardware</td><td>" + searchForKeyInArray("Hardware",result) + '</td></tr>';
		displayInfo += "<tr><td>Revision</td><td>" + searchForKeyInArray("Revision",result) + '</td></tr>';
		
		displayInfo += "</tbody></table>";
		$('#hardwareInfo').html(displayInfo);
	}else{
		$('#hardwareInfo').html("Loading failed.");
	}
}

function searchForKeyInArray(key, arr){
    for (var i =0; i < arr.length; i++){
        if (arr[i][0].toLowerCase() == key.toLowerCase()){
            return arr[i][1]
        }
    }
    return "unknown";
}

function UpdateDriveInfo(result){
	if (result.includes("ERROR") == false){
		var displayInfo = "<strong>Storage Information</strong><br>";
		displayInfo += '<table class="ts table"><thead><tr><th>Label</th><th>Name</th><th>Free Space</th></tr></thead><tbody>';
		for (var i =0; i < result.length;i++){
			displayInfo += "<tr><td>" + result[i][0] + "</td><td>" + result[i][1] + "</td><td>" + result[i][2].replace("/"," / ") + "</td></tr>";
		}
		displayInfo += "</tbody></table>";
		$('#driveInfo').html(displayInfo);
	}else{
		$('#driveInfo').html("Loading failed.");
	}
}

function GetNetworkAdaptor(result){
	if (result.includes("ERROR") == false){
		if (isWindows == false){
			var displayInfo = "";
			for (var i =0; i < result.length;i++){
				displayInfo += "<tr><td>" + result[i] + "</td></tr>";
			}
			$('#networkAdaptor').html(displayInfo);
		}else{
			var displayInfo = "";
			for (var i =0; i < result.length;i++){
				if (result[i] != ""){
					var data = result[i].split(",");
					displayInfo += "<tr><td>" + data[0] + " connected=" + data[3] + "</td></tr>";
					}
			}
			$('#networkAdaptor').html(displayInfo);
		}
		
	}else{
		$('#networkAdaptor').html("Loading failed.");
	}
}

function GetUSBAdaptors(result){
	if (result.includes("ERROR") == false){
		var displayInfo = "";
		for (var i = 0; i < result.length; i++){
			displayInfo += "<tr><td>" + result[i] + "</td></tr>"
		}
		$('#usbAdaptor').html(displayInfo);
	}else{
		$('#usbAdaptor').html("Loading failed. Are you sure this system is running on a raspberry pi?");
	}
}
function Request(targetPhp, callback){
	$.ajax({url: targetPhp, success: function(result){
        callback(result);
    }});
}



</script>
</body>
</head>