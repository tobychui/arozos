<?php
include_once("../auth.php");
if (isset($_GET['from']) && isset($_GET['to'])){
    //Check if the conversion format make sense
    $source = $_GET['from'];
    $target = $_GET['to'];
    
    if (strpos($source,"/media/") === 0){
        //This file is located in the external storage
    }else{
        //This file is based on Desktop environment
        $source = "../" . $source;
    }
}

?>