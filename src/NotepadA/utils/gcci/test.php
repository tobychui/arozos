<?php
include_once("../../../auth.php");
if (isset($_GET['testpara']) & isset($_GET['source'])){
    $testPara = json_decode($_GET['testpara'],true);
    $filepath = '../' . $_GET['source'];
    if (!file_exists($filepath)){
        die("ERROR. source file not found.");
    }
    $binaryPath = dirname($filepath) . "/" . basename($filepath,pathinfo($filepath, PATHINFO_EXTENSION)) . "out";
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        $binaryPath = dirname($filepath) . "\\" . basename($filepath,pathinfo($filepath, PATHINFO_EXTENSION)) . "exe";
    }
    $results = [];
    foreach ($testPara as $para){
        array_push($results, nl2br(shell_exec($binaryPath . " " . $para)));
    }
    
    header('Content-Type: application/json');
    echo json_encode($results);
}else{
    die("ERROR. Missing parameter.");
}
?>