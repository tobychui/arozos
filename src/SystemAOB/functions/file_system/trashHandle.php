<?php
//Trash bin and related function handler
include_once("../../../auth.php");
include_once("../user/userIsolation.php");
include_once("../user/userFilepathScope.php");
$trashbinPath =  getUserDirectory() . "SystemAOB/functions/file_system/trash/";
if (!file_exists($trashbinPath)){
	mkdir($trashbinPath,0777,true);
	mkdir($trashbinPath . "regi/",0777,true);
	mkdir($trashbinPath . "data/",0777,true);
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

function clearAllContents($filepath){
	$files = glob($filepath . "*");
	foreach($files as $file){
		if (is_file($file)){
			unlink($file);
		}
		
	}
}

//Define operation ID
$oprID = gen_uuid();

//Check if the input file exists
if (isset($_GET['filepath']) && isset($_GET['opr'])){
	if (empty($_GET['filepath'])){
		die("ERROR. Filepath cannot be empty.");
	}
	
	$filepath = $_GET['filepath'];
	$opr = $_GET['opr'];
	if ($opr == "mv"){
		//Move the given file to recycle bin, filepath have to be starting with AOR
		$realFilePath = "../../../" . $filepath;
		if (file_exists("../../../" . $filepath)){
			//Passed in as AOR relative path
			$realFilePath = "../../../" . $filepath;
		}else if (file_exists($filepath)){
			//Passed in as real path
			$realFilePath = $filepath;
		}else{
			//File not found
			die("ERROR. File not found. Given: " . $filepath);
		}
		//File exists, check if the file is in valid paths.
		if (checkFilepathInScope($realFilePath) == false){
			die("Permission Denied");
		}
		file_put_contents($trashbinPath . "regi/" . $oprID . ".inf",realpath($realFilePath) . PHP_EOL . time());
		rename($realFilePath, $trashbinPath . "data/" . $oprID . ".blob");
		echo $oprID;
		exit(0);
		
	}else if ($opr == "delete"){
		//Filepath is ID
		$uuid = $_GET['filepath'];
		if (file_exists($trashbinPath . "regi/" . $uuid . ".inf") && file_exists($trashbinPath . "data/" . $uuid . ".blob")){
			//This file exists. Remove it
			unlink($trashbinPath . "data/" . $uuid . ".blob");
			//Remove the record as well
			unlink($trashbinPath . "regi/" . $uuid . ".inf");
		}else{
			die("ERROR. Given file UUID not found.");
		}
		echo "DONE";
		exit(0);
	}else if ($opr == "recover"){
		//Filepath is ID
		//Check if the given uuid exists
		$uuid = $_GET['filepath'];
		if (file_exists($trashbinPath . "regi/" . $uuid . ".inf") && file_exists($trashbinPath . "data/" . $uuid . ".blob")){
			//File found. Start recovery process
			$infoFile = file_get_contents($trashbinPath . "regi/" . $uuid . ".inf");
			$infoFile = explode(PHP_EOL,$infoFile);
			$originalPath = $infoFile[0];
			$removeTime = $infoFile[1];
			if (file_exists($originalPath)){
				die("ERROR. File already exists.");
			}else{
				//Check if the target folder exists for recovery
				if(!file_exists(dirname($originalPath))){
					mkdir(dirname($originalPath),0777,true);
				}
				//Recover the file using registered file
				rename($trashbinPath . "data/" . $uuid . ".blob",$originalPath);
				//Remove the register file
				unlink($trashbinPath . "regi/" . $uuid . ".inf");
			}
			echo "DONE";
			exit(0);
		}else{
			die("ERROR. File not found.");
		}
	}
}else if (isset($_GET['opr']) && $_GET['opr'] == "list"){
	//Get a list of files inside trash bin
	$trash = glob($trashbinPath . "regi/*.inf");
	$fileList = [];
	foreach ($trash as $file){
		//This is a registry of a trashed file. Get its properties
		$prop = explode(PHP_EOL,file_get_contents($file));
		array_unshift($prop,basename($file,".inf"));
		array_push($fileList,$prop);
	}
	header('Content-Type: application/json');
	echo json_encode($fileList);
}else if (isset($_GET['opr']) && $_GET['opr'] == "clearAll"){
		//Clear all trashbin contents
		clearAllContents($trashbinPath . "regi/");
		clearAllContents($trashbinPath . "data/");
		echo "DONE";
}



?>