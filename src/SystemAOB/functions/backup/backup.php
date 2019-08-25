<?php
include_once("../../../auth.php");
$aor = $rootPath;
$aoc = $sysConfigDir;
if (isset($_GET['mode']) && $_GET['mode'] != ""){
	$mode = $_GET['mode'];
	//Config related variables
	$config = json_decode(file_get_contents("config/Archive Format.config"),true);
	$backupConfig = json_decode(file_get_contents("config/Backup.config"),true);
	$generatePackingReport = ($config["generatePackingReport"][3] == "true");
	$useUUID = ($config["useUUIDfname"][3] == "true");
	$includeReadme = ($config["includeReadme"][3] == "true");
	$readmeContent = $config["readmetxt"][3];
	$snapshot = ($config["snapshot"][3] == "true");
	//Configs related to backup method and structures
	$backupUserAccount = ($backupConfig["backupUserAccount"][3] == "true");
	$useExtStrorage = ($backupConfig["useExternalStorage"][3] == "true");
	//Start processing the content
	if ($mode == "backup"){
		//Backup the system by copying to the on disk directory
		//Generate filename using inique string.
		$foldername = time();
		if ($useUUID){
			$foldername = gen_uuid();
		}
		//Select storage directory
		$storageDir = $aoc . "backup/" . $foldername;
		if ($useExtStrorage && file_exists("/media/storage1/")){
			//Use External Storage exists and storage1 Exists
			$storageDir = "/media/storage1/backup/" . $foldername;
		}
		if (!file_exists($storageDir)){
			mkdir($storageDir,0777,true);
		}
		
		if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
			//Window Host
			//Copy the win bat to current execution directory
			$batContent = file_get_contents("backup_script/backup_win.bat");
			$batContent = str_replace("{AOR}",realpath($aor),$batContent);
			$batContent = str_replace("{AOC}",str_replace("/","\\",$aoc),$batContent);
			$batContent = str_replace("{UUID}",$foldername,$batContent);
			var_dump($batContent);
			exit(0);
			$command = "Path_to_your_bat_file";
			pclose(popen("start /B ". $command, "r"));
		} else {
			//Linux Host
			
		}
	}else if ($mode == "snapshot"){
		
	}else{
		die("ERROR. Only support mode: backup, snapshot");
	}
}else{
	die("ERROR. Undefined backup mode.");
}

function gen_uuid() {
    return sprintf( '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        // 32 bits for "time_low"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ),

        // 16 bits for "time_mid"
        mt_rand( 0, 0xffff ),

        // 16 bits for "time_hi_and_version",
        // four most significant bits holds version number 4
        mt_rand( 0, 0x0fff ) | 0x4000,

        // 16 bits, 8 bits for "clk_seq_hi_res",
        // 8 bits for "clk_seq_low",
        // two most significant bits holds zero and one for variant DCE1.1
        mt_rand( 0, 0x3fff ) | 0x8000,

        // 48 bits for "node"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff )
    );
}
?>
