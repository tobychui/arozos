<?php
include '../../../auth.php';
?>
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
    <title>System Power</title>
    <style type="text/css">
        body {
            padding-top: 4em;
            background-color: rgb(250, 250, 250);
            overflow: scroll;
        }
    </style>
</head>
<body>
<div class="ts narrow container">
	<div class="ts slate">
		<i class="plug icon"></i>
		<span class="header">System Power</span>
		<?php
		if (isset($_GET['mode']) && $_GET['mode'] == "embedded"){
			echo '<span class="description">The function below can physically shut down the system or reboot the system.<br>All unsaved files / progress will be lost after the shutdown sequence.</span>';
		}else{
			echo '<span class="description">The function below can physically shut down the system or reboot the system.<br>All unsaved files / progress will be lost after the shutdown sequence.<br>If you arrive here by accident, click <a href="../../">here</a> to exit.</span>';
		}
		?>
		<div class="ts horizontal divider">System Power Options</div>
		<div id="controls" class="ts fluid vertical buttons">
		<button class="ts warning button" onClick="RestartApache();"><br><i class="circle notched icon"></i>Restart Apache<br><br></button>
		<button class="ts primary button" onClick="Reboot();"><br><i class="power icon"></i>System Reboot<br><br></button>
		<button class="ts negative button" onClick="Shutdown();"><i class="power icon"></i>System Shutdown<br>(REQUIRE MANUAL RESTART)</button>
		</div>
		
	</div>

	

</div>
<div id="loadingScreen" class="ts active dimmer" style="display:none;">
	<div class="ts text loader">Rebooting...</div>
</div>
<?php
$LinuxSystem = "true";
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
   $LinuxSystem = "false";
} else {
   $LinuxSystem = "true";
}
?>

<script>
var usingLinux = <?php echo $LinuxSystem;?>;
if (usingLinux == false){
	//$('#controls').html("Sorry. This power option is only avalible on Raspberry Pi's or other ARM based Linux operating system.");
}

function RestartApache(){
	
	$.ajax({
    url: "apache_restart.php",
    error: function(){
        // Loading for reboot
		$('#loadingScreen').show();
		setTimeout(Ping, 2000);
    },
    success: function(){
        //not possible
		
    },
    timeout: 3000 // sets timeout to 3 seconds
});
}

function Reboot(){
	$('#loadingScreen').show();
	$.ajax({
    url: "reboot_cb42e419a589258b332488febcd5246591ea4699974d10982255d16bee656fd8.php",
    error: function(){
        // Start a fake progress bar to make people think it is rebooting
		setTimeout(function(){
			location.reload();
		}, 30000);
    },
    success: function(){
        //something crashed when reboot.
		console.log("Something went wrong while rebooting.");
    },
    timeout: 3000 // sets timeout to 3 seconds
});
}

function Ping(){
	$.ajax({
    url: "ping.php",
    error: function(){
        // Start a fake progress bar to make people think it is rebooting
		setTimeout(Ping, 2000);
    },
    success: function(){
        //something crashed when reboot.
		location.reload();
    },
    timeout: 3000 // sets timeout to 3 seconds
});
}

function Shutdown(){
	window.location.href = "shutdown-gui_2053da6fb9aa9b7605555647ee7086b181dc90b23b05c7f044c8a2fcfe933af1.php";
}


</script>
</body>
</html>