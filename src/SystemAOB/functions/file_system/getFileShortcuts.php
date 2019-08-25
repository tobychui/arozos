<?php
include_once("../../../auth.php");
include_once("../user/userIsolation.php");
$shortcutDir = getUserDirectory() . "SystemAOB/functions/file_system/fshortcut/"; //shortcut storage directory under user isolation directory
if (!file_exists($shortcutDir)){
    //This user has no shortcut before. Generate the default set of shortcut for him
    mkdir($shortcutDir,0777,true);
    $defaultShortcuts = glob("fshortcut/*.shortcut");
    foreach ($defaultShortcuts as $shortcut){
        copy(realpath($shortcut),$shortcutDir . basename($shortcut));
    }
}
$shortcuts = glob($shortcutDir . "/*.shortcut");
$includeFilename = isset($_GET['includeFilename']);
if (isset($_GET['remove']) && $_GET['remove'] != ""){
    //Remove a shortcut with the given filename
    if (file_exists($shortcutDir . $_GET['remove'] . ".shortcut") && checkPathInUserDirectory(realpath($shortcutDir . $_GET['remove'] . ".shortcut"))){
        unlink($shortcutDir . $_GET['remove'] . ".shortcut");
        echo "DONE";
        exit(0);
    }else{
        die("ERROR. Shorcut not exists.");
    }
}else if (isset($_POST['create']) && $_POST['create'] != ""){
    //Create a new shortcut base on the given array
    $shortcutContent = json_decode($_POST['create']);
    $shortcutContent = implode(PHP_EOL,$shortcutContent);
    if(isset($_POST['filename']) && $_POST['filename'] != ""){
        $filename = $_POST['filename'] . ".shortcut";
    }else{
        $filename = time() . ".shortcut";
    }
    file_put_contents($shortcutDir. $filename,$shortcutContent);
    echo ($filename);
    exit(0);
}
$result = [];
foreach ($shortcuts as $shortcut){
    //Create a list of directory that allows other modules to use as shortcuts
	$content = file_get_contents($shortcut);
	$data = explode("\n",str_replace("\r","",trim($content))); //Prevent linux and windows EOL different error
	if (count($data) > 0 && trim($data[0]) == "foldershrct"){
	    if (!$includeFilename){
	        array_push($result,$data);
	    }else{
	        array_unshift($data,basename($shortcut,".shortcut"));
	        array_push($result,$data);
	    }
		
	}
}

header('Content-Type: application/json');
echo json_encode($result);
?>