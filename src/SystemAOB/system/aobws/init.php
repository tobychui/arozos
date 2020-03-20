<?php
include_once("../../../auth.php");
require_once("../../functions/file_system/binarySelector.php");

$port = 8000;

//Parse the launch paramters
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    //Windows. Parse the launching path for validation services from wamp service webroot
    $fullPath = str_replace($_SERVER['DOCUMENT_ROOT'],"",realpath(str_replace("\\","/",__DIR__) . "../../jwt/validate.php"));
    $fullPath = str_replace("\\","/",$fullPath);
    $launchpath = str_replace($_SERVER['DOCUMENT_ROOT'] . "/","",$fullPath);
}else{
    //Life is always simplier on Linux
    $launchpath = str_replace($_SERVER['DOCUMENT_ROOT'] . "/","",realpath("../jwt/validate.php"));
}

//Check if the current access is via http or https
$start = "http://localhost:". $_SERVER['SERVER_PORT'] . "/";
if (!empty($_SERVER['HTTPS'])) {
    $start = "https://localhost:" . $_SERVER['SERVER_PORT'] . "/";
}
$launchpath = $start . $launchpath;

//Parse setting from file
if (file_exists("../../functions/personalization/sysconf/aobws.config")){
    $settings = json_decode(file_get_contents("../../functions/personalization/sysconf/aobws.config"),true);
    $port = $settings["aobwsport"][3];
    $aep = $settings["authendpt"][3];
    if (trim($aep) != ""){
        //Only replace the auth end point if it is set in the config
        $launchpath = $aep;
    }
}

//Try to clear previous terminate file
if (file_exists("terminate.inf")){
    unlink("terminate.inf");
}

//Try to start the aobws
//echo '-port ' . $port . ' -endpt "' . $launchpath . '"';
binarySelectExecution("aobws",'-port ' . $port . ' -endpt "' . $launchpath . '"');
echo "DONE";

?>