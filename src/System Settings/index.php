<?php
include '../auth.php';
?>
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="width=device-width, initial-scale=0.7, shrink-to-fit=no">

    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<title>System Setting</title>
	<style>
	.clickable{
		cursor:pointer;
		border: solid 1px transparent;
		padding-top:30px !important;
		top:0px;
		transition: top ease 0.2s;
	}
	.clickable:hover{
	    position: relative; 
        top: -5px;
	    border: solid 1px #4286f4;
		background-color:#edf5ff;
		border-radius: 3px;
	}
	
	body{
		background-color:white;
	}
	.sub{
	    font-size:60% !important;
	}
	
	</style>
</head>
<body>
<div id="topbar" class="ts pointing secondary menu">
    <a class="item" href="../"><i class="angle left icon"></i></a>
    <a class="active item">System Setting</a>
</div>
<div class="ts container" align="center">
<h3 class="ts center aligned header">
    ArOZ Online System Settings
</h3>
<div class="ts icon tiny input">
		<input type="text" placeholder="Search Settings" style="width:300px;">
		<i class="search icon"></i>
</div>
</div>
<br>
<div style="margin-right: 100px;margin-left: 100px;">
<div class="ts grid">
	<div class="doubling six column row">
        <a class="column clickable" href="navi.php?page=host">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="disk outline icon"></i>Host
			<div class="sub header">Host Info, WebApps, Thermal</div>
		</h4>
		<br>
		</a>
        <a class="column clickable" href="navi.php?page=device">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="laptop icon"></i>Device
			<div class="sub header">Storage, USB Mounting, IO</div>
		</h4>
		<br>
		</a>
		
        <a class="column clickable" href="navi.php?page=network">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="wifi icon"></i>Network
			<div class="sub header">WiFi Adaptor, Access Point, Ethernet</div>
		</h4>
		<br>
		</a>
		
        <a class="column clickable" href="navi.php?page=theme">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="paint brush icon"></i>Personalization
			<div class="sub header">Color Scheme, Desktop Theme, Lock Screen</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=users">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="user outline icon"></i>Users
			<div class="sub header">Your account, device UUID, Identification</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=time">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="clock icon"></i>Time
			<div class="sub header">Clock, Date Settings</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=file">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="file outline icon"></i>File & Storage
			<div class="sub header">File List, Clean, Search</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=sync">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="cloud upload icon"></i>ArOZ Sync
			<div class="sub header">Cluster File Hosting, Disk Recovery</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=cluster">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="server icon"></i>ArOZ Clusters
			<div class="sub header">MapReduce, Cluster Settings</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=backup">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="refresh icon"></i>Backup and Restore
			<div class="sub header">Create backup, restore</div>
		</h4>
		<br>
		</a>
		
		<a class="column clickable" href="navi.php?page=about">
		<h4 class="ts center aligned icon header">
			<i style="color:#4286f4" class="notice icon"></i>About ArOZ
			<div class="sub header">More information, contact developer</div>
		</h4>
		<br>
		</a>
    </div>
</div>
</div>
<script>
var VDI = !(!parent.isFunctionBar);

if (VDI){
	$("#topbar").hide();
	$("body").css("padding-top","20px");
	$("body").css("padding-bottom","50px");
	
	//If it is currently in VDI, force the current window size and resize properties
	var windowID = $(window.frameElement).parent().attr("id");
	//parent.setWindowPreferdSize(windowID + "",1300,650);
	parent.setWindowIcon(windowID + "","setting");
	parent.setGlassEffectMode(windowID + "");
}



</script>
</body>
</html>