<?php
include_once '../auth.php';
if (isset($_GET['directory']) && strpos($_GET['directory'],"../") === false){
    //If the given directory is within the ArOZ Online root and do not contain ../ (back outside the aor) then allow list dir
    $targetDir = "../" . $_GET['directory'];
    if (file_exists($targetDir)){
        $folders = glob($targetDir . "*");
        $result = [];
        foreach ($folders as $folder){
            if (is_dir($folder)){
                array_push($result,[$folder,basename($folder)]);
            }
        }
        header('Content-type: application/json');
        echo json_encode($result);
    }else{
        die("ERROR. Undefined directory");
    }
}else{
    die("ERROR. Undefined directory path.");
}

?>