<?php
include_once("../../../auth.php");

if (!file_exists("hideApp.config")){
    file_put_contents("hideApp.config",json_encode(["Desktop","File Explorer","Power"])); //Default apps to be hidden
}

function getHideAppList(){
    return json_decode(file_get_contents("hideApp.config"));
}

?>