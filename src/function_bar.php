<?php
include_once 'auth.php';
?>
<html>
<!DOCTYPE HTML>
<head>
<meta name="viewport" content="width=device-width, initial-scale=0.7, shrink-to-fit=no">
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="script/tocas/tocas.css">
<script src="script/tocas/tocas.js"></script>
<script src="script/jquery.min.js"></script>
</head>
<?php
include_once("SystemAOB/functions/personalization/configIO.php");
$theme = (getConfig("function_bar",false));
?>
<link rel="stylesheet" type="text/css" href="script/jsCalendar/jsCalendar.css">
<link rel="stylesheet" type="text/css" href="script/jsCalendar/jsCalendar.clean.min.css">
<script type="text/javascript" src="script/jsCalendar/jsCalendar.js"></script>
<body>
<style>
.hover_cc div:hover {
    background: #444;
}
body{
	overflow-y:hidden;
}
#menuBar{
	overflow: hidden;
	position: fixed;
	bottom: 0;
	width: 100%;
	z-index:110;
	color: #333;
	background:<?php echo $theme["fbcolor"][3];?>;
	
}
.fwPanelColor{
	background:<?php echo $theme["fbcolor"][3];?>;
}


.notificationbar{
	position:fixed;
	top:0px;
	z-index:119;
	height: auto;
	width:350px;
	bottom: 34px;
	background:<?php echo $theme["nbcolor"][3];?>;
	right:0px;
	padding: 20px;
	padding-left: 25px;
	color: <?php echo $theme["nbfontcolor"][3];?>;
}

.messagebox{
	border-bottom: 1px solid #727272;
	padding-top:5px;
	padding-bottom:5px;
}

.pressable{
	cursor: pointer;
	margin: 5px;
}

.pressable:hover{
	background-color:#494949;
}

.hidden{
	
}

#stickingIndictor{
	position: fixed;
	top:4px;
	bottom:4px;
	background:rgba(255,255,255,0.1);
	width: 50%;
	box-shadow: 1px 1px rgba(45,45,45,0.2);
}

.resizeWindow{
	position:absolute;
	right:0;
	bottom:0;
	width:20px;
	height:15px;
	cursor: nw-resize;
	background-image:url(<?php echo $theme["resizeInd"][3];?>);
}

.selectable{
	cursor:pointer;
}

.selectable:hover{
	background-color:<?php echo $theme["actBtnColor"][3];?>;
}

.menuButton.active{
	background-color:<?php echo $theme["actBtnColor"][3];?>;
}

.menuButton{
	background-color:<?php echo $theme["defBtnColor"][3];?>;
	width:60px;
	height60px:
	border: 1px solid red;
	padding: .4em;
}
.toggleBtn{
	width:59px;
	height:49px;
	padding-top:5px;
}
</style>
<?php
//Simple script for searching all usable FloatWindow modules with "embedded.php" in module directory
$folders = glob("*");
$supportedModules = [];
foreach ($folders as $module){
	if (is_dir($module)){
		if (file_exists($module . "/FloatWindow.php")){
			array_push($supportedModules,$module);
		}
	}
}
?>
<!-- Main Interface for normal module access-->
<iframe id="interface" src="index.php" style="width:100%;height:100%;top:0;bottom:0;" onLoad="updateURL();" allowfullscreen></iframe>
<!-- Transparent iframe covering layer-->
<div id="backdrop" style="position:fixed;width:100%; height:100%; top:0;bottom:0;z-index:99;background-color:rgba(255,255,255,0);display:none;"></div>
<!-- Menu Bar, Desktop Only -->
	<div id="menuBar">
		<div class="ts fluid container" style="color:white;height:40px;">
			<div class="ts grid" style="line-height: 35px;" align="center">
				<!-- First Left hand side system icons-->
				<div class="eight wide column" style="left:2%;">
					<div id="activatedModuleIcons" class="ts grid" style="line-height: 35px;" align="center">
						<div class="toggleBtn" style="cursor: pointer;" onClick="ToogleMenuBar();"><i class="dropdown large icon" style="line-height: 35px;"></i></div>
						<div class="menuButton active" style="cursor: pointer;height:60px;" onClick="TooglePowerManuel(this);"><i class="cloud large icon" style="line-height: 35px;padding-top:3px;"></i></div>
						<div id="folderBtn" class="menuButton" style="cursor: pointer;height:60px;" onClick="ToogleFileExplorer();">
							<i class="folder outline icon" style="line-height: 35px;"></i>
						</div>
						<!-- New windows will be added here-->
						<div id="moreBtn" class="menuButton" style="cursor: pointer;height:60px;" onClick="AddWindows();" ><i class="plus icon" style="line-height: 35px;"></i></div>
					</div>
				</div>
				<!-- Second Right hand side tray icons -->
				<div class="eight wide column" align="right" style="right:2%;">
					<div class="ts grid" style="line-height: 35px;" align="center">
						<div class="nine wide column"></div>
						<div class="two wide column" id="USBopr" onclick="CheckUSBNoDifferent();" style="cursor: pointer;">Detecting</div>
						<div class="two wide column" id="gVol" onClick="ToggleGlobalVol();" style="cursor: pointer;"><i class="volume down icon"></i>N/A</div>
						<div class="two wide column" id="clock" onmouseover="ShowCalender();" onmouseleave="HideCalender();">Loading</div>
						<div class="one wide column" style="padding-top:18px;" onClick="toggleNoticeBoard();"><i class="mail icon"></i></div>
					</div>
				</div>
			</div>
			
		</div>
	</div>
	<div id="showMenuButton" style="overflow: hidden;position: fixed;left: 0;width: 50px;bottom:0px;height:35px;display:none;background-color:rgba(0,3,51,0.4);color:white;cursor: pointer;z-index:999;" align="center" onClick="ToogleMenuBar();">
		<i class="triangle up large icon" style="line-height: 35px;"></i>
	</div>
	<!-- Power menu bar-->
	<div id="powerMenu" style="overflow: hidden;position: fixed;left: 0;width: 400px;bottom:34px;height:550px;display:;z-index:150;">
	<iframe style="height:550px; width: 100%; z-index:152;" src="SystemAOB/functions/list_menu/index.php" frameborder="0"></iframe>
	</div>
	
	<!-- floatWindow List Window -->
	<div id="fwListWindow" class="fwPanelColor" style="overflow: hidden;position: fixed;left: 100;min-width: 250px;bottom:34px;min-height:40px;display:none;z-index:150;">
	<div class="selectable" style="border:1px solid transparent;padding:10px;"><p class="ts inverted header" style="font-size:0.9em;">
		<i class="spinner loading icon"></i>Loading...
	</p></div>
	</div>
	
	<!-- File menu bar-->
	<!-- 
	<div id="fileMenu" style="border: 2px #333 transparent;box-shadow:1px 1px 4px #3d3d3d;overflow: hidden;position: fixed;left: 0;width: 1080px;bottom:33px;height:580px;display:none;z-index:1;">
		<div id="topbar" class="floatWindow" style="width:100%; position: relative; background-color:rgba(33, 33, 33, 0.8);color:white;left:0;top:0;height:20px;z-index:8;cursor: context-menu;">  <i class="folder icon"></i>File Explorer 
		<div style="top:2px;right:3px;cursor: pointer;position:absolute;" onmousedown="closeAndReloadIframe();" ontouchstart="closeAndReloadIframe();"><i class="remove icon"></i></div>
		<div style="top:5px;right:25px;cursor: pointer;position:absolute;" class="maximizeWindow"><i class="small window maximize icon"></i></div>
		<div style="top:5px;right:47px;cursor: pointer;position:absolute;" onmousedown="ToogleFileExplorer();" ontouchstart="ToogleFileExplorer();"><i class="minus icon"></i></div></div>
		<iframe id="filebrowser" style="width:100%;height:97%; bottom:0;position:absolute;top:20px;background-color:white;" src="SystemAOB/functions/file_system/embedded.php?controlLv=2" frameborder="1"></iframe>
		<div class="resizeWindow" style="position:absolute;right:0;bottom:0;background-color:#333;width:20px;height:15px;color:white;cursor: nw-resize;" align="center"></div>
	</div>
	-->
	
	<!-- My Host Window-->
	<!-- 
	<div id="HostServer" style="border: 2px #333 solid;overflow: hidden;position: fixed;left: 0;width: 720px;bottom:44px;height:522px;display:none;z-index:1;">
		<div class="floatWindow" style="width:100%; position: relative; background-color:#333;color:white;left:0;top:0;height:20px;z-index:8;cursor: context-menu;">  <i class="disk outline icon"></i>Host Server <div style="float:right;right:5px;cursor: pointer;" onmousedown="CloseHS();" ontouchstart="CloseHS();"><i class="remove icon"></i></div><div style="float:right;right:10px;cursor: pointer;" onmousedown="ToogleHS();" ontouchstart="ToogleHS();"><i class="minus icon"></i></div></div>
		<iframe id="hostView" style="width:100%;height:97%; bottom:0;position:absolute;top:20px;background-color:white;" src="SystemAOB/functions/system_statistic/index.php" frameborder="1"></iframe>
		<div class="resizeWindow" style="position:absolute;right:0;bottom:0;background-color:#333;width:20px;height:15px;color:white;cursor: nw-resize;" align="center"></div>
	</div>
	-->
	
	<!-- Add Window Button-->
	<div id="addWindow" style="border: 0px #222 solid;overflow: hidden;position: fixed;background-color:#222;background:rgba(0,0,0,1);height:240px;width:180px;left:0px;bottom:33px;display:none;z-index:118;">
				<div class="item" style="width:180px;left:0;position:relative;background-color:#333;">
					<div class="content">
						<div class="header" style="color:white;"><i class="window maximize icon"></i>New Float Window</div>
					</div>
				</div>
				<?php
				$template = '<div class="item hover_cc" style="width:180px;left:0;position:relative;" onClick="LaunchFloatWindowFromModule(%MODULENAME%);">
					<div class="content" style="cursor: pointer;">
						<div class="header" style="color:white;"><i class="plus icon"></i>%MODULEPATH%</div>
					</div>
				</div>';

				//newEmbededWindow('SystemAOB/functions/file_system/embedded.php?moduleName=../../../../media&dir=../../../../media&controlLv=2','USB Drives','usb','usbDriveDisplay');
				//Append USB Driver windows to the menu
				if (strtoupper(substr(PHP_OS, 0, 3)) !== 'WIN') {
					$box = str_replace("LaunchFloatWindowFromModule(%MODULENAME%);","newEmbededWindow('SystemAOB/functions/file_system/embedded.php?moduleName=../../../../media&dir=../../../../media&controlLv=2','USB Drives','usb','usbDriveDisplay');AddWindows();",$template);
					$box = str_replace("%MODULEPATH%","USB Drives",$box);
					$box = str_replace('<i class="plus icon">','<i class="usb icon">',$box);
					echo $box;
				}
				foreach ($supportedModules as $module){
						$box = str_replace("%MODULEPATH%",$module,$template);
						$box = str_replace("%MODULENAME%","'" . $module . "'",$box);
						echo $box;
				}
				
				?>
	</div>
	
	<!-- Global Vol Adjusting window-->
	<div id="globVolInterface" style="border: 0px #222 solid;overflow: hidden;position: fixed;background-color:#222;background:rgba(48,48,48,0.7);height:30px;width:240px;right:0px;bottom:34px;display:none;z-index:118;">
		<div class="ts narrow container" style="color:white;position:aboslute;top:10px;">
			<i class="volume down icon" style="float: left;" onClick="mutevol();"></i><i class="volume up icon" style="float: right;"></i>
			<div id="globVolBar" class="ts small progress" style="background:rgba(255,255,255,0.2);">
				<div id="volDisplay" class="bar" style="width:50%;background:white;"></div>
			</div>
		</div>
	</div>
	
	<!-- Movement Cover for iframe drag drop-->
	<div id="iframeCover" style="position:absolute;background-color:rgba(255,255,255,0.1);z-index:115;display:none;top:20px;">
	
	</div>
	<!-- USB Reminder Interface -->
	<div id="USBList" style="border: 2px #333 solid;overflow: hidden;position: fixed;right: 0;width: 450px;bottom:32px;height:500px;display:none;z-index:118;background-color:white;">
		<div style="width:100%; position: relative; background-color:#333;color:white;left:0;top:0;height:20px;z-index:8;overflow:hidden;text-overflow: ellipsis;white-space: nowrap;cursor: context-menu;"><i class="usb icon"></i>USB Device List</div>
		<iframe id="USBListDisplay" style="width:100%;height:100%;position:absolute;top:20px;" src="SystemAOB/functions/usbMount.php"></iframe>
		</div>
	</div>
	<!-- USB Monitoring Warning -->
	<div id="umw" class="ts active bottom right snackbar" style="bottom:28px;display:none;" >
		<div class="content">
			<i class="usb icon"></i>fstab listener
			<div id="umw_head" style="font-size: 1em;">USB Device Monitoring Service</div>
			<div id="umw_text" style="font-size: 0.8em;">USB Storage Device Detected</div>
			<div id="umw_list" style="font-size: 0.8em;">Auto-mounting in progress...</div>
		</div>
	</div>
	<!-- Display the calender grid -->
	<div id="calGrid" style="display:none;position:fixed;right:0;bottom:28px;height:330px;width:300px;z-index:115;">
		<div class="auto-jsCalendar white-theme" data-navigator="false"></div>
	</div>
	
	<!-- New Window Cloning Code -->
	<div id="newWindow" style="border: 0px;overflow: hidden;position: fixed;left: 0;width: 720px;bottom:45px;height:480px;display:none;z-index:1;background-color:white;">
		<div class="floatWindow fwPanelColor" style="width:100%; position: relative; color:white;left:0;top:0;height:20px;z-index:8;overflow:hidden;text-overflow: ellipsis;white-space: nowrap;cursor: context-menu;">
		  <i class="folder icon"></i>%WINDOW_TITLE%
		<div style="top:2px;right:3px;cursor: pointer;position:absolute;" class="closeWindow"><i class="remove icon"></i></div>
		<div style="top:5px;right:25px;cursor: pointer;position:absolute;" class="maximizeWindow"><i class="small window maximize icon"></i></div>
		<div style="top:5px;right:47px;cursor: pointer;position:absolute;" class="minimizeWindow"><i class="minus icon"></i></div>
		</div>
		<iframe style="width:100%;height: -webkit-calc(100% - 20px);height: -moz-calc(100% - 20px);height:calc(100% - 20px); bottom:0;position:absolute;top:20px;" src="about:blank" frameborder="1"></iframe>
		<div class="resizeWindow" align="center"></div>
	</div>
	
	<!-- Side bar / Notification bar-->
	<div id="notificationbar" class="notificationbar hidden">
	<div>
		<div class="ts header" style="color:white;font-size:160%;">
			Notification Board
		</div>
		<a style="float: right;cursor: pointer;display:inline;position:absolute;top:0;right:0;" onClick="clearAllNotification();">
			Clear All
		</a>
	</div>
	<div class="ts divider"></div>
		<div id="messageBoard">
		
		</div>
	</div>
	
	<!-- Screen Sticking Indicator-->
	<div id="stickingIndictor" attach="" style="display:none;"></div>
	
	<input id="hiddenInput" style="display:none;"></input>
	
	<!-- PHP -> JS Passthrough -->
	<div style="display:none;">
		<div id="DATA_PIPELINE_supportedModules"><?php echo json_encode($supportedModules); ?></div>
		<div id="DATA_PIPELINE_windowID"><?php $date = date_create(); echo date_timestamp_get($date);?></div>
		<div id="DATA_PIPELINE_themeColor"><?php echo $theme["fbcolor"][3];?></div>
		<div id="DATA_PIPELINE_activeColor"><?php echo $theme["actBtnColor"][3];?></div>
	</div>
	<script src="function_bar.js"></script>
</body>
</html>