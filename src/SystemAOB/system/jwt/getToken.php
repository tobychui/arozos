<?php
include_once("../../../auth.php");
if (isset($_GET['module'])){
    if (file_exists("../../../" . $_GET['module'])){
        $data = "";
        $module = $_GET['module'];
        $tokenStorage = $sysConfigDir . "users/" . $_SESSION['login'] . "/" . $module . "/token/";
        if (!file_exists($tokenStorage)){
            //No tokens
            header('Content-Type: application/json');
            echo json_encode($data);
        }else{
            $tokens = glob($tokenStorage . "*.aptok");
            if (count($tokens) == 0){
                //No token
                header('Content-Type: application/json');
                echo json_encode($data);
            }else{
                //Have at least one token
                header('Content-Type: application/json');
                echo json_encode(file_get_contents($tokens[0]));
            }
        }
    }else{
        die("ERROR. Module not found. Given " . $_GET['module']);
    }
    
}else if (isset($_GET['clearModule'])){
    if (file_exists("../../../" . $_GET['clearModule'])){
        $module = $_GET['clearModule'];
        $tokenStorage = $sysConfigDir . "users/" . $_SESSION['login'] . "/" . $module . "/token/";
        if (!file_exists($tokenStorage)){
            die("ERROR. No more token to clear.");
        }else{
            $tokens = glob($tokenStorage . "*.aptok");
            foreach ($tokens as $token){
                unlink($token);
            }
        }
    }
}


?>