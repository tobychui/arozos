<?php
//This php is designed for handling all configuration IO for personalization settings.

if (session_status() == PHP_SESSION_NONE) {
    //Calling Config.IO with Javascript
    include_once("../../../auth.php");
    include_once("../user/userIsolation.php");
}else{
    //Calling with PHP include
    include_once($rootPath . "SystemAOB/functions/user/userIsolation.php");
}
//define the config storage path. In normal case, it should be at /etc/AOB/users/{username}/SystemAOB/functions/personalization/
$configPath =  $userConfigDirectory . "SystemAOB/functions/personalization/";
if (!file_exists($configPath)){
    mkdir($configPath,0777,true);
}

//Match if all configs are in places. If not, copy it from the default settings template.
$defaultConfigs = glob($rootPath . "SystemAOB/functions/personalization/defaults/*.config");
$permissionError = false;
foreach ($defaultConfigs as $config){
    //For each default config files, if it doesn't exists in the user's config directory, copy one to that location
    $configName = basename($config);
    if (!file_exists($configPath . $configName)){
        if (!copy($config,$configPath . $configName)){
           //Unable to copy the configuration files to user's directory. Use the default file instead.
           $permissionError = true;
        }
    }
}
if($permissionError){
    //Seems there are permission error during the process of copying. Use default instead.
    $configPath = $rootPath . "SystemAOB/functions/personalization/defaults/";
}


//functions for PHP include scripts
function getConfig($configName, $global = false){
    //if global is true, search for config inside sysconf instead of the user's private path.
    global $configPath;
    global $rootPath;
    if ($global == true){
        //Global config. serach under sysconf folder
         if (file_exists($rootPath . "SystemAOB/functions/personalization/sysconf/" . $configName . ".config")){
             return json_decode(file_get_contents($rootPath . "SystemAOB/functions/personalization/sysconf/" . $configName . ".config"), true);
         }else{
             return false;
         }
    }else{
        //Private config, search under user's directory
        if (file_exists($configPath . $configName . ".config")){
            return json_decode(file_get_contents($configPath . $configName . ".config"), true);
        }else{
            return false;
        }
    }
    
}


//functions for Javascript access through GET request
if (isset($_GET['list']) && $_GET['list'] != ""){
    //List all the configuration given by the list name of the query
    if (file_exists($configPath . $_GET['list'] . ".config")){
        header('Content-Type: application/json');
        echo file_get_contents($configPath . $_GET['list'] . ".config");
        exit(0);
    }
}

if (isset($_GET['global']) && $_GET['global'] != ""){
    //List all the configuration given by the list name of the query
    if (file_exists("sysconf/"  . $_GET['global'] . ".config")){
        header('Content-Type: application/json');
        echo file_get_contents("sysconf/"  . $_GET['global'] . ".config");
        exit(0);
    }
}


?>