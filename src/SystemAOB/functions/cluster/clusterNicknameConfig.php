<?php
include_once("../../../auth.php");
if (!file_exists("nickname")){
    mkdir("nickname",0777,true);
}
if(isset($_POST['uuid']) && $_POST['uuid'] != ""){
    //Set nickname mode.
    if(isset($_POST['newNickname']) && $_POST['newNickname'] != ""){
        $newNickName = trim(strip_tags($_POST['newNickname']));
        $uuid = trim(strip_tags($_POST['uuid']));
        file_put_contents("nickname/" . $uuid . ".inf",$newNickName);
        echo "DONE";
        exit(0);
    }else{
        //No newnickname provided
        die("ERROR. No newNickname provided.");
    }
    
    
}else{
    //List all nickname as JSON.
    $data = [];
    $nickNames = glob("nickname/*.inf");
    foreach ($nickNames as $nickNameRecord){
        array_push($data,[basename($nickNameRecord,".inf"),file_get_contents($nickNameRecord)]);
    }
    header('Content-Type: application/json');
    echo json_encode($data);
    exit(0);
}

?>