<?php
include_once("../../../auth.php");
$config =  $sysConfigDir . "users/" . $_SESSION['login'] . "/SystemAOB/functions/user/globalConfigs/";
if (!file_exists($config)){
    //If the desired folder do not exists, create it.
    if(!mkdir($config,0777,true)){
        die("ERROR. Unable to create config directory.");
    }
}
if(isset($_POST['module']) && $_POST['module'] != "" && isset($_POST['name']) && $_POST['name'] != ""){
    if (isset($_POST['value']) && $_POST['value'] != ""){
        //Set config operation.
        file_put_contents($config . str_replace(" ","_",$_POST['module']) . '_' . $_POST['name'] . ".config",$_POST['value']);
        echo "DONE";
        exit(0);
    }else{
        //Read config operation.
        if (file_exists($config . str_replace(" ","_",$_POST['module']) . '_' . $_POST['name'] . ".config")){
            echo file_get_contents($config . str_replace(" ","_",$_POST['module']) . '_' . $_POST['name'] . ".config");
            exit(0);
        }else{
            echo "";
            exit(0);
        }
        
    }
}else{
    die("ERROR. Invalid operation.");
}

?>