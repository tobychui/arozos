<?php
include_once("../../../auth.php");
include_once("../user/userIsolation.php");

$keydir = getSystemDirectory() . "keypairs/";
$publicKeys = glob($keydir . "*.pub");

if (isset($_GET['getkey']) && $_GET['getkey'] != ""){
    //Get the content of a local generated key
    $targetKey = $keydir . $_GET['getkey'] . ".pub";
    if (in_array($targetKey,$publicKeys)){
        $data =  file_get_contents($targetKey);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit(0);
    }else{
        echo "ERROR. Required public key not exists.";
        exit(0);
    }
}else if (isset($_GET['remoteKey'])){
    //Get a list of remote key stored on system
    $result = [];
    $remoteKeysDir = $keydir . "remote/";
    $remoteKeys = glob($remoteKeysDir . "*.pub");
    foreach ($remoteKeys as $key){
        array_push($result,[filectime($key),basename($key,".pub"),false,date("F d Y H:i:s",filectime($key))]);
    }
    header('Content-Type: application/json');
    echo json_encode($result);
}else if (isset($_GET['getrkey']) && $_GET['getrkey'] != ""){
    //Getting remote key contents
    $targetKey = $keydir . "remote/" . $_GET['getrkey'] . ".pub";
    if (file_exists($targetKey)){
        $data =  file_get_contents($targetKey);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit(0);
    }else{
        echo "ERROR. Required remote public key not exists.";
        exit(0);
    }
}else{
    //List all local generated keys
    $result = [];
    foreach ($publicKeys as $key){
        $localKey = false;
        if (file_exists($keydir . basename($key,".pub"))){
            //Private key also exists. This is a locally generated key
            $localKey = true;
        }else{
            //Private key not exists. This is a key downloaded from other clusters
            
        }
        array_push($result,[filectime($key),basename($key,".pub"),$localKey,date("F d Y H:i:s",filectime($key))]);
    }
    header('Content-Type: application/json');
    echo json_encode($result);
}

?>