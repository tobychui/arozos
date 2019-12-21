<?php
include_once("../../../auth.php");
if (isset($_GET['clearDev'])){
	$devices = glob("devices/auto/*.inf");
	foreach ($devices as $dev){
		unlink($dev);
	}
}
?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
        <title>List IoT Devices</title>
	</head>
	<body>
	<br><br>
		<div class="ts container">
			<div class="ts segment">
				<div class="ts header">
					<i class="settings icon"></i>
					<div class="content">
						Discover Internet of Things Devices
						<div class="sub header">Scan and log the IoT devices inside your local area network</div>
					</div>
				</div>
			</div>
			<div class="ts segment">
				<div class="ts header">
					Home Network Dynamic Devices
					<div class="sub header">This list below show the last scan results from the HDS scanner.</div>
				</div>
				<table class="ts table">
					<thead>
						<tr>
							<th>#</th>
							<th>Device Name</th>
							<th>Class Name</th>
							<th>Device UUID</th>
							<th>Last Seen IP</th>
						</tr>
					</thead>
					<tbody>
						<?php
							$devices = glob("devices/auto/*.inf");
							$counter = 1;
							foreach ($devices as $device){
								$deviceInfo = explode(",",file_get_contents($device));
								$deviceClassInfo = explode("_",$deviceInfo[1]);
								$deviceUUID = basename($device,".inf");
								echo '<tr>
										<td>' . $counter . ' </td>
										<td>' . $deviceClassInfo[0] . ' </td>
										<td>' .  $deviceClassInfo[1] . ' </td>
										<td>' .  $deviceUUID.' </td>
										<td>' . $deviceInfo[0] . ' </td>
									</tr>';
								$counter++;
							}
						?>
						
	
					</tbody>
					<tfoot>
						<tr>
							<th colspan="5">
								<button class="ts primary mini button" onClick="rescan();">Rescan</button>
								<button class="ts negative mini button" onClick="clearAllDev();">Clear Device List</button>
							</th>
						</tr>
					</tfoot>
				</table>
				<div class="ts header">
					Remote Location Fixed Devices
					<div class="sub header">This is a list of fixed remote location IoT devices that might not be in local area network or require custom protocol.</div>
				</div>
				<table class="ts table">
					<thead>
						<tr>
							<th>#</th>
							<th>Generic Driver Type</th>
							<th>Record UUID</th>
							<th>Mapped IP</th>
						</tr>
					</thead>
					<tbody>
						<?php
							$devices = glob("devices/fixed/*.inf");
							$counter = 1;
							foreach ($devices as $device){
								$deviceInfo = explode(",",file_get_contents($device));
								$deviceUUID = basename($device,".inf");
								echo '<tr>
										<td>' . $counter . ' </td>
										<td>' .  $deviceInfo[1].' </td>
										<td>' .  $deviceUUID.' </td>
										<td>' . $deviceInfo[0] . ' </td>
									</tr>';
								$counter++;
							}
						?>
						
	
					</tbody>
					<tfoot>
						<tr>
							<th colspan="4">
								<button class="ts primary mini button" onClick="showAddDevMenu();">Add Device</button>
								<button class="ts mini button" onClick="showRemoteLocationDevicesInFolder();">Open Device Folder</button>
								<br>
							</th>
						</tr>
					</tfoot>
				</table>
				<div id="addDevMenu" class="ts message"  style="display:none;">
                    <div class="header"><i class="add icon"></i>Add Device</div>
                    <p>Device IP / Network Location</p>
                    <div class="ts mini fluid icon input">
                        <input id="devipinput" type="text" placeholder="Device IP">
                        <i class="world icon"></i>
                    </div>
                    <p>Generic Driver</p>
                    <select id="driverselect" class="ts basic mini dropdown">
                       <?php
                            $drivers = glob("drivers/*");
                            foreach ($drivers as $driver){
                                if (is_dir($driver) && strpos(basename($driver),".") !== false)
                                echo '<option>' . basename($driver) . '</option>';
                            }
                       ?>
                    </select>
                    <div style="margin-top:12px;">
                        <button class="ts primary mini button" onClick="addDevToList(); ">Add to List</button>
                        <button class="ts negative mini button" onClick="hideAddDevMenu();">Cancel</button>
                    </div>
                    
                </div>
			</div>
		</div>
		
		<div id="scanner" class="ts active dimmer" style="display:none;">
			<div class="ts text loader">Waiting for scanner response...</div>
		</div>
		<br><br><br><br>
		<script>
		
		function showRemoteLocationDevicesInFolder(){
		    if (ao_module_virtualDesktop && parent.underNaviEnv == true){
		        parent.parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&subdir=SystemAOB/system/iotpipe/devices/fixed", "Loading", "folder open outline",new Date().getTime(),1080,580,undefined,undefined,true,true);
		    }else{
		        window.open("../../../SystemAOB/functions/file_system/index.php?controlLv=2&subdir=SystemAOB/system/iotpipe/devices/fixed");
		    }
		    
		}
		
		function addDevToList(){
		    var devIP = $("#devipinput").val();
		    var devdrv = $( "#driverselect option:selected" ).text();
		    $.post("newdev.php",{"devIP":devIP,"driver":devdrv}).done(function(data){
		       if (data.includes("ERROR") == false){
		           window.location.reload();
		       } 
		    });
		}
		
		function showAddDevMenu(){
		    $("#addDevMenu").slideDown();
		    $('html,body').animate({
                scrollTop: $("#addDevMenu").offset().top
            }, 'slow');
		}
		
		function hideAddDevMenu(){
		    $("#addDevMenu").slideUp();
		}
		
		function rescan(){
			$("#scanner").show();
			$.get("scandev.php",function(data){
				if (data.includes("ERROR") == false){
					window.location.reload();
				}
				$("#scanner").hide();
			});
		}
		
		function clearAllDev(){
			if (confirm("Are you sure you want to remove all device records?")){
				$.get("listdev.php?clearDev",function(){
					window.location.reload();
				});
			}
		}
		</script>
	</body>
</html>