<?php
include '../../auth.php';
?>
<?php
$hideModules = ["Desktop","File Explorer","Power"]; //Add more for hiding modules that should not be shown
if (isset($_GET["request"]) && $_GET["request"] == "true"){
	//This page is used for data requesting
	if (isset($_GET['contentType']) == false){
		echo 'Request Mode enabled. Page loading disabled by default. <br>
		Please use the following command in this page to optain information regarding the List Menu.<br>
		contentType=webapp/system<br>';
	}else{
		$contentType = $_GET['contentType'];
		if ($contentType == "webapp"){
			$AOBroot = "../../";
			$modules = glob("$AOBroot*");
			$webappList = [];
			foreach ($modules as $webapp){
				if (is_dir($webapp) && in_array(str_replace($AOBroot,"",$webapp),$hideModules) == false){
					if (file_exists($webapp . "/index.php") || file_exists($webapp . "/index.html")){
						$emSupport = false;
						if (file_exists($webapp ."/embedded.php")){
							$emSupport = true;
						}
						$fwSupport = false;
						if (file_exists($webapp . "/FloatWindow.php")){
							$fwSupport = true;
						}
						$displayName = str_replace($AOBroot,"",$webapp);
						array_push($webappList,[$displayName,$webapp . "/",$emSupport,$fwSupport]);
					}
					
				}
				
			}
			header('Content-Type: application/json');
			echo json_encode($webappList);
			
		}else if ($contentType == "system"){
			
		}else{
			echo "Unknown content type value.";
		}
		
	}
	exit();
}
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
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../script/tocas/tocas.css">
<script src="../../script/tocas/tocas.js"></script>
<script src="../../script/jquery.min.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
    <span id="usernameDisplay" class="header">Hello Username</span>
    <div class="ts bottom attached tabbed menu">
        <a id="m1" class="active item" onClick="loadWebApp();">Webapp</a>
        <a id="m2" class="item" onClick="loadSysTool();"><i class="setting icon"></i>System</a>
        <a id="m3" class="item" onClick="showPowerOptions();"><i class="power icon"></i>Power</a>
    </div>
	<div id="theMenu" class="ts bottom attached vertical menu">
	<a class="item">Loading...</a>
	<a class="item">...</a>
	</div>
</div>
<script>
var inVDI = !(!parent.isFunctionBar);
var WebAppList;
var SystemTool = [["Task Manager","SystemAOB/functions/taskManager.php","System Utility"],
["Login Tool","SystemAOB/functions/identifyTool.php","User Management"]]; //Add more paths for system tools
$( document ).ready(function() {
	if (localStorage.getItem("ArOZusername") === null || localStorage.getItem("ArOZusername") == "") {
		$('#usernameDisplay').html("Hajimemasite!");
	}else{
		var arozusername = localStorage.getItem("ArOZusername");
		$('#usernameDisplay').html("Hello " + arozusername);
	}
	//Initilization, load the webapp list.
	loadWebApp();
	setInterval(function(){ UpdateUserName(); }, 15000); //Things that needed to be updating
});

function UpdateUserName(){
	if (localStorage.getItem("ArOZusername") === null || localStorage.getItem("ArOZusername") == "") {
		$('#usernameDisplay').html("Hajimemasite!");
	}else{
		var arozusername = localStorage.getItem("ArOZusername");
		$('#usernameDisplay').html("Hello " + arozusername);
	}
}

function loadWebApp(){
	$("#m2").removeClass("active");
	$("#m3").removeClass("active");
	$("#m1").addClass("active");
	$('#theMenu').html("");
	$.get( window.location.href + "?request=true&contentType=webapp", function( data ) {
		var webapps = data;
		WebAppList = data;
		for (var i=0;i<webapps.length;i++){
			$('#theMenu').append('<a class="item" onClick="LaunchFloatWindow(' + i + ');"><div class="ts grid"><div class="three wide column"><img class="ts mini middle aligned image" style="" src="'+ webapps[i][1]+'img/small_icon.png"></div><div class="thirteen wide column"><h6>' + webapps[i][0] + '</h6></div></div></a>');
		}
		$('#theMenu').append('<div class="item">...</div>');
	});
}

function resetPage(){
	loadWebApp();
	window.scrollTo(0, 0);
}

function loadSysTool(){
	$("#m1").removeClass("active");
	$("#m3").removeClass("active");
	$("#m2").addClass("active");
	$('#theMenu').html("");
	//System Tool. Not loaded from anyway.
	var template = '<a class="item" onClick="LaunchSysFunction(%TOOLID%);">\
	<div class="ts grid">\
	<div class="three wide column">\
	<i class="big tasks icon"></i>\
	</div>\
	<div class="thirteen wide column">\
	<div><div style="font-size:120%;">%TOOLNAME%</div>\
	<div>%TOOLTYPE%</div>\
	</div>\
	</div>\
	</div>\
	</a>';
	
	for (var i =0; i < SystemTool.length; i++){
		$('#theMenu').append(template.replace("%TOOLID%",i).replace("%TOOLNAME%",SystemTool[i][0]).replace("%TOOLTYPE%",SystemTool[i][2]));
	}
	$('#theMenu').append('<div class="item">...</div>');
}

function LaunchSysFunction(id){
	if (inVDI){
		var seconds = new Date().getTime() / 1000;
		var path = SystemTool[id][1];
		var name = SystemTool[id][0];
		seconds = Math.round(seconds);
		parent.newEmbededWindow(path,name,"tasks",name.replace(" ","_"),500,400,0,0);
		parent.$('#powerMenu').fadeOut('fast');
	}
	resetPage();
}

function LaunchFloatWindow(i){
	if (inVDI){
		//Float Window mode is enabled
		if (WebAppList[i][3] == true){
			//This module support FloatWindow
			parent.LaunchFloatWindowFromModule(WebAppList[i][0],true);
		}else{
			//Open this module in a new FloatWindow
			var seconds = new Date().getTime() / 1000;
			seconds = Math.round(seconds);
			parent.newEmbededWindow(WebAppList[i][0] + "/",WebAppList[i][0],"window maximize",seconds);
		}
		parent.$('#powerMenu').fadeOut('fast');
	}else{
		window.location.top = WebAppList[i][1];
	}
	resetPage();
}

function showPowerOptions(){
	$("#m1").removeClass("active");
	$("#m2").removeClass("active");
	$("#m3").addClass("active");
	$('#theMenu').html("");
	$('#theMenu').append('<a class="item" onClick="RestartApache();" style="background-color:#d0e30e;"><i class="refresh icon"></i>Restart Apache</a>');
	$('#theMenu').append('<a class="item" onClick="Reboot();" style="background-color:#00ADEA;color:white;"><i class="power icon"></i>Reboot Server</a>');
	$('#theMenu').append('<a class="item" onClick="Shutdown();" style="background-color:#CE5F58;color:white;"><i class="power icon"></i>Shutdown Server</a>');
	$('#theMenu').append('<div class="item"><i class="caution sign icon"></i>Warning! Shutdown option will require <br>manual hardware restart.</div>');
}

function RestartApache(){
	
	$.ajax({
    url: "power/apache_restart.php",
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
    url: "power/reboot_cb42e419a589258b332488febcd5246591ea4699974d10982255d16bee656fd8.php",
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
    url: "power/ping.php",
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
	window.top.location = "power/shutdown-gui_2053da6fb9aa9b7605555647ee7086b181dc90b23b05c7f044c8a2fcfe933af1.php";
}
</script>
</body>
</html>