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
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background-color: rgb(247, 247, 247);">
<div class="ts container">
<br>
<div class="ts segment">
	<div class="ts header">
    System Load and RAM Usage
    <div class="sub header">The CPU load and RAM usage is shown below as graph.</div>
	</div>
</div>
<div class="ts divider"></div>
<p  style="display:inline;">CPU Usage Graph >> </p><p id="cpuUsage" style="display:inline;"></p>
<iframe src="../system_statistic/loadGraph.php" width="100%" height="200px"></iframe>
<div class="ts divider"></div>
<p  style="display:inline;">RAM Usage Graph >> </p><p id="ramUsage"  style="display:inline;"></p>
<iframe src="../system_statistic/ramGraph.php" width="100%" height="200px"></iframe>
<br><br><br>
</div>
<script>
getCurrentRamUsage();
getCurrentCPUusage();
setInterval(function(){
	getCurrentRamUsage();
	getCurrentCPUusage();
},5000);
function getCurrentRamUsage(){
	$.ajax({url: "../system_statistic/getMemoryInfo.php"
	}).done(function(result){
		if (result.includes("ERROR") == false){
			var data = result.split(",");
			$("#ramUsage").html("RAM usage: " + data[0] + " / " + data[1]);
		}
	});
}

function getCurrentCPUusage(){
	$.ajax({url: "../system_statistic/getCPUload.php"
	}).done(function(result){
		if (result.includes("ERROR") == false){
			$("#cpuUsage").html("CPU utilization: " + result);
		}
	});
}
</script>
</body>
</html>