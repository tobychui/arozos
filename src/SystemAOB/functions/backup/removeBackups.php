<?php
include_once("../../../auth.php");
if (isset($_GET['uuid']) && $_GET['uuid'] != ""){
    $backupUUID = $_GET['uuid'];
    $backupUUID = str_replace("../","",$backupUUID);
    $backupDir = "backups/";
    //Check if the current backup location is in external directory. If yes, scan ext directory instead.
    $backupConfig = json_decode(file_get_contents("config/Backup.config"),true);
    if ($backupConfig["useExternalStorage"][3] == "true" && file_exists("/media/storage1/system/backups/")){
        //Use external storage if it exists
        $backupDir = "/media/storage1/system/backups/";
    }
    if (file_exists($backupDir . $backupUUID)){
        //Check if the packinfo exists. If not, this is a building image and should not be removed.
        if (file_exists($backupDir . $backupUUID . "/packinfo.inf")){
            //This is a built update and try to remove it
            if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                //Windows. somehow it might fail to remove due to filename too long issue. Use cmd to remove instead.
                //Remove anything possible with PHP first
                //rrmdir($backupDir . $backupUUID);
                //Remove with window cmd for the remaining parts
                shell_exec("RMDIR /Q/S " . realpath($backupDir . $backupUUID . "/"));
            }else{
                //Linux based os.
                shell_exec("sudo chmod 777 -R " . $backupDir . $backupUUID);
                rrmdir($backupDir . $backupUUID);
            }
            echo "DONE";
        }else{
            die("ERROR. Backup is building in progress. This cannot be removed until the building process finished.");
        }
    }
}else{
    die("ERROR. Undefined backup uuid.");
}

function rrmdir($dir) { 
   if (is_dir($dir)) { 
     $objects = scandir($dir); 
     foreach ($objects as $object) { 
       if ($object != "." && $object != "..") { 
         if (is_dir($dir."/".$object))
           rrmdir($dir."/".$object);
         else
           unlink($dir."/".$object); 
       } 
     }
     rmdir($dir); 
   } 
 }
?>