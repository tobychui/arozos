<?php
$supportedFormats = ["ntfs","vfat"];
$allowedDirectories = ["/media", "/var/www"];
if (file_exists("../../functions/personalization/sysconf/fsaccess.config")){
    $allowedDirectories = [];
    $settings = json_decode(file_get_contents("../../functions/personalization/sysconf/fsaccess.config"),true);
    $paths = $settings["syspaths"][3];
    $paths = explode(";",$paths);
    foreach ($paths as $path){
        array_push($allowedDirectories,$path);
    }
}
?>