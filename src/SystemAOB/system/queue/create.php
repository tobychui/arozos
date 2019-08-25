<?php
//This php script is designed to create a new system queue in the ArOZ Online Background Queue Process System.
//DO NOT CHANGE ANYTHING IN THIS SCRIPT UNLESS YOU KNOW WHAT YOU ARE DOING
/*
Input: JSON String of an array with index of 2

Content:
A[0] is the module that starts the request
A[1] is the command or scripts that you want to call. 
A[2] (Optional) is the mode that this process should be done. Mode: asap / idle (default) / sched (Require extra parameters)
In most case, module can only call scripts in either SystemAOB/functions/* or within the module root directory.

Example:
A[0] = "Audio"
A[1] = "SystemAOB/functions/file_system/move.php?from=somewhere&to=somewhereelse
A[2] = "asap"

JSON string: ["Audio","SystemAOB/functions/file_system/move.php?from=somewhere&to=somewhereelse"]
Post the string above into create.php as parameter: taskInfo
*/
//Check if the background queue directory structure exsits. If not, create it.

include_once("../../../auth.php");
$queues = ["asap","idle","sched","scanner","preproc","process","postproc"];
foreach ($queues as $folder){
    if (!file_exists($folder)){
        mkdir($folder,0777,true);
    }
}

//Helper functions
function isJSON($string){
    return is_string($string) && is_array(json_decode($string, true)) ? true : false;
}
function gen_uuid() {
    return sprintf( '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        // 32 bits for "time_low"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ),

        // 16 bits for "time_mid"
        mt_rand( 0, 0xffff ),

        // 16 bits for "time_hi_and_version",
        // four most significant bits holds version number 4
        mt_rand( 0, 0x0fff ) | 0x4000,

        // 16 bits, 8 bits for "clk_seq_hi_res",
        // 8 bits for "clk_seq_low",
        // two most significant bits holds zero and one for variant DCE1.1
        mt_rand( 0, 0x3fff ) | 0x8000,

        // 48 bits for "node"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff )
    );
}

//Check the required parameters are fully satisfied.
if (isset($_POST['taskInfo']) && $_POST['taskInfo'] != ""){
    $taskInfo = $_POST['taskInfo'];
    if (isJSON($taskInfo) == false){
        die("ERROR. TaskInfo is not a valid JSON string.");
    }
    $taskInfo = json_decode($taskInfo);
    if (count($taskInfo) < 2){
        die("ERROR. Invalid task Info given. TaskInfo should be with a length at least 2.");
    }
    $uuid = gen_uuid();
    $timestamp = time();
    $priority = "idle";
    $allowedTypes = ["asap","idle","sched"];
    if (count($taskInfo) > 2 && $taskInfo[2] != ""){
        //The user have define the default priority of the task.
        $priority = $taskInfo[2];
        if (!in_array($priority,$allowedTypes)){
            die("ERROR. The given priority type is not supported.");
        }
        
    }
    //Create a task request in the preproc folder
    file_put_contents("preproc/" . $uuid . ".inf",$uuid . "@" . $_SESSION['login'] . PHP_EOL . $timestamp . PHP_EOL . $priority . PHP_EOL . $taskInfo[0] . PHP_EOL . $taskInfo[1]);
    echo $uuid;
}else{
    die("ERROR. Undefined taskInfo. Unable to create background system task.");
}

?>