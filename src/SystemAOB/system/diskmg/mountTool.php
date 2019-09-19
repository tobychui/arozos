<?php
include_once("../../../auth.php");
include_once("definition.php");
if (isset($_GET['dev']) && isset($_GET['format']) && isset($_GET['mnt'])){
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        die("ERROR. Call to system function not supported by your operating system.");
    } else {
        $targetDev = $_GET['dev'];
        $format = $_GET['format'];
        $mountPt = $_GET['mnt'];
        //check id device id follows the sd* naming format
        preg_match('/sd[a-z][1-9]/', $targetDev, $result);
        if (count($result) > 0){
            //Check if the device exists.
            if (!file_exists("/dev/" . $targetDev)){
                die("ERROR. Target device ID not found.");
            }
        }else{
            die("ERROR. Invalid device ID");
        }
        
        //Check if the given format is supported by this tool
        if (!in_array($format,$supportedFormats)){
            die("ERROR. Format not supported.");
        }
        
        //Check if the mount point exists.
        if (file_exists($mountPt) && checkWithinAllowedDirectories($mountPt)){
            
        }else{
            die("ERROR. Invalid Mounting Point location or mount point not exists.");
        }
        
       
       if (isset($_GET['unmount'])){
            //Start mounting
            $ouput = shell_exec("sudo umount " . $mountPt);
            echo $output;
            exit(0);
       }else{
            //Start mounting
        if ($format == "ntfs"){
             $ouput = shell_exec("sudo mount -t ntfs-3g /dev/" . $targetDev . " " . $mountPt);
        }else if ($format == "vfat"){
             $ouput = shell_exec("sudo mount -t vfat /dev/" . $targetDev . " " . $mountPt);
        }else{
            die("ERROR. Unknown error occured.");
        }
        echo $output;
        exit(0);
       }
       
    }
    
}else{
    die("ERROR. Call with invalid paramters.");
}

function checkWithinAllowedDirectories($dir){
    global $allowedDirectories;
    $dir = realpath($dir);
    foreach ($allowedDirectories as $validDir){
        $validDir = realpath($validDir);
        if (strpos($dir,$validDir) === 0){
            //matched at least one valid dir
            return true;
        }
    }
    return false;
    
}
?>