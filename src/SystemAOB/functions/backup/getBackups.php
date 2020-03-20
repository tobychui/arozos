<?php
include_once("../../../auth.php");
//This php script return the current backup folder status.

$backupDir = "backups/";
//Check if the current backup location is in external directory. If yes, scan ext directory instead.
$backupConfig = json_decode(file_get_contents("config/Backup.config"),true);
if ($backupConfig["useExternalStorage"][3] == "true" && file_exists("/media/storage1/system/backups/")){
    //Use external storage if it exists
    $backupDir = "/media/storage1/system/backups/";
}

$data = [];

$backups = glob($backupDir . "*");
foreach ($backups as $backup){
    if (is_dir($backup)){
        //Check if build information exists or not. If not, this might be still building in progress.
        $finishedBackup = file_exists($backup . "/packinfo.inf");
        $buildInfo = "building";
        $buildDate = "Just now";
        if ($finishedBackup){
            $tmp = file_get_contents($backup . "/packinfo.inf");
            $tmp = explode(",",$tmp);
            $buildInfo = [];
            foreach ($tmp as $t){
                array_push($buildInfo,str_replace("\\","/",$t));
            }
            $buildDate = date('d/m/Y H:i:s', $tmp[1]);
        }
        array_push($data,[basename($backup),$backup . "/",$finishedBackup,$buildDate,$buildInfo]);
    }
}

header('Content-Type: application/json');
echo json_encode($data);

?>