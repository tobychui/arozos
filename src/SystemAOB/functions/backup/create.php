<?php
include_once("../../../auth.php");
if (!file_exists($sysConfigDir . "system/backup/")){
    //backup directory within ArOZ Online Configuration folder not found. Create one
    mkdir($sysConfigDir . "system/backup/",0777,true);
}

if (isset($_GET['create']) && $_GET['create'] != ""){
	$backupMode = $_GET['create'];
	$backupConfig = json_decode(file_get_contents("config/Backup.config"),true);
	$packConfig = json_decode(file_get_contents("config/Archive Format.config"),true);
	//var_dump($backupConfig);
	//var_dump($packConfig);
	//Backup or packing related settings
	$useExtStorage = $backupConfig["useExternalStorage"][3]; //This value is string as this is directly passed to the CLI 
	$generateReport = ($packConfig["generatePackingReport"][3] == "true");
	$useUUID = $packConfig["useUUIDfname"][3];
	$includeReadme = ($packConfig["includeReadme"][3] == "true");
	$readmeContent = $packConfig["readmetxt"][3];
	$allowSnapshot = ($packConfig["snapshot"][3] == "true");
	if ($backupMode == "snap"){
		//Snapshot mode.
		//Check if snapshot mode is enabled
		if (!$allowSnapshot){
			die("ERROR. Snapshot mode is not enabled. Please change the setting of 'Allow Snapshot Packing' before using Snapshot packing.");
		}
		//Check if there is already a full backup. If no, terminate the backup process.
		$backupPath = "backups/";
		if ($useExtStorage == "true" && file_exists("/media/storage1/")){
			$backupPath = "/media/storage1/system/backups/";
		}
		$backups = glob($backupPath  . "*");
		$snapBaseExists = false;
		foreach ($backups as $backup){
			if (is_dir($backup)){
				if (file_exists($backup . "/packinfo.inf")){
					$content = file_get_contents($backup . "/packinfo.inf");
					$content = explode(",",trim($content));
					if ($content[0] == "full"){
						//This is a full backup. That means there exists at least one full backup for snapping to base on.
						$snapBaseExists = true;
					}
				}
			}
		}
		if (!$snapBaseExists){
			die("ERROR. Snapshot base do not exists. Use full backup once first.");
		}
	}else{
		//Anything else. Perform full backup
		$backupMode = "full";
	}
	
	
	//See if README is needed or not.
	if ($includeReadme){
		file_put_contents($rootPath . "README.md",$readmeContent);
	}
	//Run the command via kernal
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		//Running this on windows
		 $exePath = "aos-backupman\\aos-backupman.exe";
		 
		 $commandString = "start " . $exePath; 
		 $commandString .= " " . $rootPath . " " . $useExtStorage . " " . $useUUID . " default default " . $backupMode;
		 pclose(popen($commandString, 'r'));
		 echo "DONE";
	}else{
		//Running on linux
		$cpuMode = exec("uname -m 2>&1",$output, $return_var);
		switch(trim($cpuMode)){
			case "armv7l": //raspberry pi 3B+
			case "armv6l": //Raspberry pi zero w
					$commandString = "sudo ./aos-backupman/aos-backupman_armv6.elf"; 
				break;
		   case "aarch64": //Armbian with ARMv8 / arm64
					//This will be slow, but it will works
					$commandString = "sudo ./aos-backupman/aos-backupman_arm64.elf"; 
			   break;
		   case "i686": //x86 32bit CPU
		   case "i386": //x86 32bit CPU
				$commandString = "sudo ./aos-backupman/aos-backupman_i386.elf"; 
		   case "x86_64": //x86-64 64bit CPU
					$commandString = "sudo ./aos-backupman/aos-backupman_amd64.elf"; 
			   break;
		   default:
			   //No idea why uname -m not working. In that case, x86 64bit binary is used.
					$commandString = "sudo ./aos-backupman/aos-backupman_amd64.elf"; 
			   break;
		}
		$commandString .= " " . $rootPath . " " . $useExtStorage . " " . $useUUID . " default default " . $backupMode;
		pclose(popen($commandString . " > build_log.txt 2>&1 &", 'r'));
		echo "DONE";
	}
	exit(0);
}


?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<link rel="manifest" href="manifest.json">
<html style="min-height:300px;">
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
    	<script src="../../../script/ao_module.js"></script>
        <title>ArOZ Backup and Restore</title>
    </head>
    <body>
        <br><br>
        <div class="ts container">
			<div class="ts segment">
				<h4 class="ts header">
					<i class="copy icon"></i>
					<div class="content">
						Create Backup
						<div class="sub header">Create a restore point for current system.</div>
					</div>
				</h4>
			</div>
			<div class="ts segment">
			    <div class="ts card">
                    <div class="content">
                        <div class="header"><i class="copy icon"></i>Full Backup</div>
                        <div class="description">
                            <p>Create a full backup for the current system. Every files will be copied to the backup directiry and will take up more space.</p>
                        </div>
                    </div>
                    <div class="ts fluid bottom attached buttons">
                        <button class="ts primary button" onClick="performFullBackup();">Start</button>
                    </div>
                </div>
                <div class="ts card">
                    <div class="content">
                        <div class="header"><i class="photo icon"></i>Snapshop Backup</div>
                        <div class="description">
                            <p>Create a snapshot backup for the file that changed since the last full backup. Require at least one full backup to start. Take up less space than full backup but take longer time to restore.</p>
                        </div>
                    </div>
                    <div class="ts fluid bottom attached buttons">
                        <button class="ts button" onClick="performSnapshot();">Start</button>
                    </div>
                </div>
                <details class="ts accordion">
                    <summary>
                        <i class="dropdown icon"></i> Know More
                    </summary>
                    <div class="content">
                        <p>Full Backup is a method that in simple words, copy all file from current ArOZ Online System to a backup directory. This method will use more spaces but if there are critical system failure, the system can be restored with ease. <br><br>
                        With Snapshot backup, each file in the current ArOZ Online System will be compared to the file inside the last Full Backup. If there are filesize difference, the file will be copied to the backup directory. This method will create a smaller backup folder compare to Full Backup but the system will take much longer time to restore as the system have to merge the original full backup with the latest snapshot backup.
                        <br><br>If you got the space to do backups, it is recommended to do Full Backup isntead of Snapshot, but most of the time it is up to your personal preference. </p>
                    </div>
                </details>
			</div>
			<div class="ts active bottom right snackbar" style="display:none;">
				<div id="msgbox" class="content">
						<i class="checkmark icon"></i> Backup started.
				</div>
			</div>
		</div>
		<script>
			function performFullBackup(){
				$.get("create.php?create=full",function(data){
					if (data.includes("DONE") == false){
						console.log("[Backup] System backup failed. " + data);
						msgbox('<i class="remove icon"></i> ' + data);
					}else{
						msgbox('<i class="checkmark icon"></i> Backup started.');
					}
				});
			}
			
			function performSnapshot(){
				$.get("create.php?create=snap",function(data){
					if (data.includes("DONE") == false){
						console.log("[Backup] System backup failed. " + data);
						msgbox('<i class="remove icon"></i> ' + data);
					}else{
						msgbox('<i class="checkmark icon"></i> Backup started.');
					}
				});
			}
			
			function msgbox(text){
				$("#msgbox").html(text);
				$("#msgbox").parent().stop().finish().fadeIn().delay(3000).fadeOut();
			}
		</script>
    </body>
</html>