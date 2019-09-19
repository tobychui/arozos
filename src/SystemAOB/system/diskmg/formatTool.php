<?php
include_once("../auth.php");
include_once("definition.php");

if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    die("ERROR. Window is currently not supported.");
}else{
    //Linux environment
    if (isset($_GET['dev']) && isset($_GET['format'])){
        $dev = $_GET['dev'];
        $format = $_GET['format'];
        //Check if dev id correct
        preg_match('/sd[a-z][1-9]/', $dev, $result);
        if (count($result) == 0){
            die("ERROR. Invalid device ID. " . $dev . " given.");
        }
        
        //Check if dev exists
        if (!file_exists("/dev/" . $dev)){
            die("ERROR. Device not exists.");
        }
        
        //Check if format is supported
        if (!in_array($format,$supportedFormats)){
            die("ERROR. Not supported format.");
        }
        
        //Check if the dev is mounted. Unmount it if nessary.
        $out = shell_exec("lsblk -f -b --json | grep " . $dev);
        if (strlen(trim($out)) == 0){
            //Something strange happended
            die("ERROR. Unknown error has occured. lsblk return no result.");
        }
        $out = json_decode(trim($out),true);
        if ($out["mountpoint"] !== null){
            //Unmount the dev if it is mounted
            shell_exec("sudo umount " . $out["mountpoint"]);
        }
        
        //Unmount once more on dev ID just for safty
        shell_exec("sudo umount /dev/" . $dev);
        
        //Drive ready to be formatted.
        if ($format == "ntfs"){
            shell_exec("sudo mkfs.ntfs -f /dev/" . $dev);
        }else if ($format == "vfat"){
            shell_exec("sudo mkfs.vfat /dev/" . $dev);
        }
        echo "DONE";
    }else{
        die("ERROR. Called with invalid paramters.");
    }
}
?>