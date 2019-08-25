<?php
include_once("../../../auth.php");

if (isset($_GET['webAppName']) && $_GET['webAppName'] != "" && isset($_GET['ext']) && $_GET['ext'] != ""){
    $dwa = $_GET['webAppName'];
    $ext = $_GET['ext'];
    //Check if the module really exists
    $dwapath = "../../../" . $dwa;
    $mode = "floatwindow";
    $icon = "file";
    if (file_exists($dwapath)){
        if (file_exists($dwapath . "/embedded.php")){
            //Use embedded as default opener if exists
            $mode = "embedded";
        }else if (file_exists($dwapath . "/FloatWindow.php")){
            //Use floatwindow as default opener if exists
            $mode = "floatwindow";
        }else{
            //use default as opener
        }
        
        //Check if the default opener setting already exists. If yes, it will be removed.
        if (file_exists("default/" . $ext . ".csv")){
            unlink("default/" . $ext . ".csv");
        }
        
        //Create the new default record from scratch
        file_put_contents("default/" . $ext . ".csv", $dwa . "," . $mode . "," . $icon . ",,,1,0");
        echo "DONE";
        exit(0);
        
    }else{
        die("ERROR. WebApp directory not exists.");
    }
}else{
    echo "ERROR. Missing webAppName or ext variable. Cannot create default record.";
    exit(0);
}

?>