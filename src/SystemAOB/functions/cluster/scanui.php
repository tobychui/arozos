<?php
include_once("../../../auth.php");
?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>ArOZ Cluster Scanner (Host Side)</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body>
	<?php
	function remove_utf8_bom($text)
	{
		$bom = pack('H*','EFBBBF');
		$text = preg_replace("/^$bom/", '', $text);
		return $text;
	}
	?>
	<br><br>
	<div class="ts container">
		<div class="ts segment">
			<div class="ts header">
				<i class="server icon"></i>ArOZ Clusters Discovery
				<div class="sub header">Discover Nearby Cluster on the Host Side</div>
			</div>
		</div>
		<div class="ts segment">
			<button class="ts primary button" onClick="startScanner();">Start Scanner</button><br>
			<p>Please make sure there is no another heavy task running in the background at the same time.</p>
			<div class="ts fluid input" style="min-height:300px;">
				<textarea id="logarea" placeholder="Empty Scanner Log" readonly></textarea>
			</div>
		</div>
	</div>
	<div style="display:none;">
		<?php
		if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN'){
			$server="WINDOWS";
		}else{
			$server="LINUX";
		}
		?>
		<div id="DATA_serverType"><?php echo $server;?></div>
	</div>
	<script>
		var dottingCounter; 
		var serverType = $("#DATA_serverType").text().trim();
		function startScanner(){
			$("#logarea").val("");
			if (serverType == "WINDOWS"){
			    log("[INFO] Started asynchronous tasks on scanning nearby ArOZ Online Hosts (Windows Mode)");
				$.get("scan.php",function(data){
				    if (data.includes("DONE")){
				        log("[INFO] Waiting scanner for returning scanned list...");
				        setTimeout(startMonitoring,1000);
				    }else{
				        log("[ERROR] Something went wrong when trying to start clusterdiscovery services.");
				    }
				});
			}else if (serverType == "LINUX"){
				log("[INFO] Started asynchronous tasks on scanning nearby ArOZ Online Hosts....");
				log(">> This will take a while. Do not close this page before the process finished.")
				startDoting();
				$.get("scanix.php",function(data){
					stopDoting();
					if (data.includes("ERRPR") == false){
						//All things are going correctly. 
						log("[INFO] Scanning log generated. Processing generated data...");
						$.get("viewPingnixResult.php",function(data){
							log("[DONE] These IPs response to ping. Asking if they are ArOZ Online System or not.");
							log(data.split("<br>").join("\n"));
							startDoting();
							//Continue with finding AOs
							$.get("clusterdiscoverynix.php",function(data){
								stopDoting();
								if (data.includes("DONE")){
									//OK
									log("[DONE] All hosts should be discovered and listed in Clister List. Please wait a few minutes and refresh the list for detail cluster information.");
								}else{
									log("[ERROR] Something went wrong during ping Hosts. Are you sure you have correct permission settings?");
								}
							});
						});
						
					}else{
						log("[ERROR] Something went wrong when starting the asynchronous scanning process.")
					}
				});
			}
		}
		
		function startMonitoring(){
		    $.get("viewClusterDiscoverWin.php",function(data){
		        if (data.includes("DONE") == false){
		            log(data);
		            setTimeout(startMonitoring,1000);
		        }else{
		            //Done!
		            log("[DONE] Scanning finished.");
		        }
		    });
		}
		
		function startDoting(){
			dottingCounter = setInterval(doting,1000);
		}
		function stopDoting(){
			if (dottingCounter != undefined){
				clearInterval(dottingCounter);
			}
			log("");
		}
		function doting(){
			$("#logarea").val($("#logarea").val() + ".");
		}
		function log(text){
			$("#logarea").val($("#logarea").val() + text + "\n");
			var psconsole = $('#logarea');
			if(psconsole.length)
			   psconsole.scrollTop(psconsole[0].scrollHeight - psconsole.height());
		}
	</script>
</body>
</html>
