<?php
include_once("../../../auth.php");
include_once("hideApps.php");
$hideModules = getHideAppList(); //See hideApp.config for more hidden apps config

if(isset($_GET['search']) && $_GET['search'] != ""){
    $keyword = strtolower($_GET['search']);
    $webapps = glob("../../../*");
    $result = [];
    foreach ($webapps as $app){
        if (is_dir($app)){
            $appName = basename($app);
            $matchName = strtolower($appName);
            if (in_array($appName,$hideModules) == false && strpos($matchName,$keyword) !== false && count(glob($app . "/index.*")) > 0){
                //This module is not a module that is supposed to be hidden
                
                if (file_exists($rootPath . "/" . $appName . "/img/small_icon.png")){
                    $icon = $rootPath . "/" . $appName . "/img/small_icon.png";
                }else if (file_exists($rootPath . "/" . $appName . "/img/function_icon.png")){
                    $icon = $rootPath . "/" . $appName . "/img/function_icon.png";
                }else{
                    $icon = $rootPath . "img/no_icon.png";
                }
                array_push($result,[$appName,$icon]);
            }
        }
        
    }
    
    $utilResults = [];
    $utils = glob($rootPath . "SystemAOB/utilities/*.php");
    foreach ($utils as $util){
        $utilName = basename($util,".php");
        $matchName = strtolower($utilName);
        if (strpos($matchName,$keyword) !== false){
                //This module is not a module that is supposed to be hidden
                if (file_exists(dirname($util) . "/sysicon/" . $utilName . ".png")){
                    $icon = dirname($util) . "/sysicon/" . $utilName . ".png";
                }else{
                    $icon = dirname($util) . "/sysicon/noname.png";
                }
                array_push($utilResults,[$utilName,$icon]);
        }
    }
    header('Content-Type: application/json');
    echo json_encode([$result,$utilResults]);
}

?>