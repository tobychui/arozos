<?php
//This php requires DiskmgWin.exe to work.
//The three numbers following the disk info is Available space to current user, Total available space, Disk total space in bytes.
include_once("../../../auth.php");
if (isset($_GET['partition'])){
    $output = shell_exec("DiskmgWin.exe -d");
}else{
   $output = shell_exec("DiskmgWin.exe"); 
}
$tmp = explode(";",trim($output));
$emptyCheck = array_pop($tmp);
if (trim($emptyCheck) !== ""){
    //Check if the last item is empty. If it is not, push it back into the queue.
    array_push($tmp,$emptyCheck);
}
$diskInfo = [];
foreach ($tmp as $disk){
    array_push($diskInfo,explode(",",$disk));
}

header('Content-Type: application/json');
echo json_encode($diskInfo);
?>