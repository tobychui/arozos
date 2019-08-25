<?php
include '../../auth.php';
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
<script src="../../script/ao_module.js"></script>
<style>
body{
	background:rgba(255,255,255,0.8);
}
</style>
</head>
<body>
    <div class="ts bottom attached tabbed menu" style="z-index:1000;">
        <div id="m1" class="active item" onClick="setCurrentPage(1);" style="cursor:pointer;"><i class="desktop icon" ></i>Performance</div>
        <div id="m2" class="item" onClick="setCurrentPage(2);" style="cursor:pointer;"><i class="server icon" ></i>Process</div>
    </div>
	
<div id="dataGraph" class="ts narrow container" >
	<iframe src="../functions/system_statistic/loadGraph.php" width="100%;" style="height:150px;" scrolling="no"></iframe>
	<iframe src="../functions/system_statistic/ramGraph.php" width="100%;" style="height:150px;" scrolling="no"></iframe>
</div>

<div id="processList" style="position:fixed;top:50px;left:0px;z-index:999;background-color:white;right:0px;display:none;bottom:20px;overflow-y:scroll;padding-left:5px;padding-right:5px;">
	<table class="ts table">
		 <thead>
			<tr>
				<th>PID</th>
				<th>USER</th>
				<th>PR</th>
				<th>NI</th>
				<th>VIRT</th>
				<th>RES</th>
				<th>SHR</th>
				<th>S</th>
				<th>%CPU</th>
				<th>%MEM</th>
				<th>TIME+</th>
				<th>COMMAND</th>
			</tr>
		</thead>
		<tbody id="plistcontent">
			<tr>
				<td class="collapsing">
					<i class="hashtag icon"></i> N/A
				</td>
				<td>Not supported OS</td>
				<td>Windows Host is currently not supported.</td>
			</tr>
		</tbody>
	</table>
</div>
<script>
ao_module_setGlassEffectMode();
ao_module_setWindowSize(590,430);
ao_module_setWindowIcon("tasks");
ao_module_setWindowTitle("Task Manager");
			
var enableProcess = true;
function updateProcessList(){
	if (enableProcess){
	$.ajax({
	  url: "../functions/system_statistic/listProcess.php?mode=json",
	}).done(function(data) {
	  if (data.includes("ERROR") == false){
		  $("#plistcontent").html("");
		  for (var i =7; i < data.length; i++){
			  if (data[i] != ""){
				var fixeddata = data[i].replace(/\s\s+/g, ' ');
				fixeddata = fixeddata.trim();
				datachunk = fixeddata.split(" ");
				$("#plistcontent").append('<tr>');
				$("#plistcontent").append('<td class="collapsing"><i class="hashtag icon"></i> ' + datachunk[0] + '</td>');
				for(var k=1;k < datachunk.length;k++){
					$("#plistcontent").append('<td>' + datachunk[k] + '</td>');
				}
				$("#plistcontent").append('</tr>');
				//$("#plistcontent").append('<div class="item">' + fixeddata + '</div>');
			  }
		  }
	  }else{
		  enableProcess = false;
	  }
	});
	/*
	$.get( "system_statistic/listProcess.php?mode=json", function( data ) {
	  
	});
	*/
	}
}
updateProcessList();
setInterval(function(){ updateProcessList(); }, 3000);


function setCurrentPage(val){
	if (val == 2){
		$("#processList").show();
		$("#m1").removeClass("active");
		$("#m2").addClass("active");
	}else if (val == 1){
		$("#processList").hide();
		$("#m2").removeClass("active");
		$("#m1").addClass("active");
	}
}

</script>
</body>
</html>