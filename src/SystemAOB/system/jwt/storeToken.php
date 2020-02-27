<?php
include_once("../../../auth.php");

if (isset($_POST['token']) && !empty($_POST['token']) && isset($_POST['module']) && !empty($_POST['module'])){
    $module = $_POST['module'];
    $token = $_POST['token'];
    if (!file_exists("../../../" . $module)){
        //Module not exists
        die("ERROR. Module not exists");
    }else{
        $tokenStorage = $sysConfigDir . "users/" . $_SESSION['login'] . "/" . $module . "/token/";
        if (!file_exists($tokenStorage)){
            mkdir($tokenStorage,0777,true);
        }
        $filename = hash("sha512",$token);
        file_put_contents($tokenStorage . $filename . ".aptok",$token);
        echo "DONE";
    }
}


?>