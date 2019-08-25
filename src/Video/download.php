<?php
include '../auth.php';
?>
<?php
//Download Handler for Auto Renaming System
if (isset($_GET['download']) && $_GET['download'] != ""){
    if (file_exists( $_GET['download']) == false){
        die("ERROR. File doesn't exists.");
    }
    $target = $_GET['download'];
    $ext = pathinfo($target, PATHINFO_EXTENSION);
    $filedata = explode('/',$target);
    $fullFileName = array_pop($filedata);
    $filename = str_replace(".mp4","",$fullFileName);
    if (strpos($filename,"inith")!== false){
        $decodedName = hex2bin(str_replace("inith",'',$filename));
    }else{
        $decodedName = $filename;
    }
header("Content-Type: video/mp4");
header("Content-Length: " . filesize($target));
header('Content-Disposition: attachment; filename="'.$decodedName . "." . $ext.'"');
//readfile($target);
$handle = fopen($target, 'rb'); 
$buffer = ''; 
while (!feof($handle)) { 
    $buffer = fread($handle, 4096); 
    echo $buffer; 
    ob_flush(); 
    flush(); 
} 
fclose($handle); 
exit;
}
?>