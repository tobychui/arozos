<?php
include '../auth.php';
/**
Trash bin handling PHP
Example commands
trashBin.php?username=TC&act=undo&uuid=9e470dc1-0758-f90a-2aea-6e71aa062330 --> Undo the file with give UUID
trashBin.php?username=TC&act=load --> Get a list of files in trash bin, return as JSON
trashBin.php?username=TC&act=clearTrashBinConfirm --> Clear everything in trash bin, if you are developing a module using this function, remember to ask for confirmation before doing so.
**/

function deleteDir($dirPath) {
    if (! is_dir($dirPath)) {
        throw new InvalidArgumentException("$dirPath must be a directory");
    }
    if (substr($dirPath, strlen($dirPath) - 1, 1) != '/') {
        $dirPath .= '/';
    }
    $files = glob($dirPath . '*', GLOB_MARK);
    foreach ($files as $file) {
        if (is_dir($file)) {
            deleteDir($file);
        } else {
            unlink($file);
        }
    }
    rmdir($dirPath);
}


if (isset($_GET['username']) && $_GET['username'] != ""){
	$username = $_GET['username'];
	$baseDir = "files/" . $username;
	$trashBinDir = "files/" . $username . "/" . ".TrashBin";
	if (file_exists($trashBinDir) == false){
		mkdir($trashBinDir,0777);
	}
	
	if (isset($_POST['filelist']) && $_POST['filelist'] != ""){
		//Append the filelist into the mapping inf file
		$fileList = json_decode($_POST['filelist']);
		$trashMapper = $trashBinDir . "/tbfmap.inf";
		foreach ($fileList as $fileInfo){
			//Moving stuffs to the trash bin2hex
			$data = $fileInfo;
			$uuid = $data[0];
			$rawname = $data[1];
			$displayName = $data[2];
			rename($baseDir . "/" . $rawname,$trashBinDir . "/" . $uuid);
			//Recording the movement
			file_put_contents($trashBinDir . "/tbfmap.inf", implode(",",$fileInfo) . PHP_EOL,LOCK_EX | FILE_APPEND);
		}
		echo "DONE";
	}else if (isset($_GET['act']) && $_GET['act'] == "load"){
		$records = [];
		if (file_exists($trashBinDir . "/tbfmap.inf") == false){
			//There is nothing in the trashBin yet. Even the mapping inf file is not here
			header('Content-Type: application/json');
			echo json_encode($records);
			exit(0);
		}
		$file = fopen($trashBinDir . "/tbfmap.inf","r");
		
		while(!feof($file)){
				$thisLine = fgetcsv($file);
				if ($thisLine != ""){
					array_push($records,$thisLine);
				}
		}
		fclose($file);
		header('Content-Type: application/json');
		echo json_encode($records);
	}else if (isset($_GET['act']) && $_GET['act'] == "undo"){
		if (isset($_GET['uuid']) && $_GET['uuid'] != ""){
			if (file_exists($trashBinDir . "/" . $_GET['uuid'])){
				$uuid = $_GET['uuid'];
				$map = file_get_contents($trashBinDir . "/tbfmap.inf");
				$datachunk = explode(PHP_EOL,$map);
				$newMapper = "";
				foreach ($datachunk as $line){
					if (strpos(strtolower($line),strtolower($_GET['uuid']))!== false){
						$undoInfo = explode(",",$line);
						$rawname = $undoInfo[1];
						$displayName = $undoInfo[2];
						rename($trashBinDir . "/" . $uuid,$baseDir . "/" . $rawname);
					}else{
						$newMapper = $newMapper . $line . PHP_EOL;
					}
				}
				$newMapper = trim($newMapper);
				file_put_contents($trashBinDir . "/tbfmap.inf",$newMapper,LOCK_EX);
				echo "DONE";
				exit(0);
			}else{
				die("ERROR. Target file with uuid not eixsts.");
			}
		}else{
			die("ERROR. Undefined uuid for undo");
		}
	}else if (isset($_GET['act']) && $_GET['act'] == "undoAllContent"){
		$files = glob($trashBinDir . "/*");
		foreach ($files as $file){
			if ($file != $trashBinDir . "/tbfmap.inf"){
				$uuid = basename($file);
				$map = file_get_contents($trashBinDir . "/tbfmap.inf");
				$datachunk = explode(PHP_EOL,$map);
				$newMapper = "";
				foreach ($datachunk as $line){
					if (strpos(strtolower($line),strtolower($uuid))!== false){
						$undoInfo = explode(",",$line);
						$rawname = $undoInfo[1];
						$displayName = $undoInfo[2];
						rename($trashBinDir . "/" . $uuid,$baseDir . "/" . $rawname);
					}else{
						$newMapper = $newMapper . $line . PHP_EOL;
					}
				}
				$newMapper = trim($newMapper);
				file_put_contents($trashBinDir . "/tbfmap.inf",$newMapper,LOCK_EX);
			}
		}
		//As there is nothing left in the trashBin, unlink the index file.
		unlink($trashBinDir . "/tbfmap.inf");
		
	}else if (isset($_GET['act']) && $_GET['act'] == "clearTrashBinConfirm"){
		$files = glob($trashBinDir . "/*");
		foreach ($files as $file){
			//As the inf file is used to store the file list in trash bin, once it is cleared, this file is no longer necessary and will be created if there are new file sent into here.
			if (is_file($file)){
				unlink($file);
			}else if (is_dir($file)){
				deleteDir($file);
			}
		}
		echo 'DONE';
		
	}else if (isset($_GET['act']) && $_GET['act'] == "debug"){
		if (file_exists($trashBinDir . "/tbfmap.inf")){
			$map = file_get_contents($trashBinDir . "/tbfmap.inf");
		}else{
			$map = "There is no trash in the Trash Bin.";
		}
		$map = str_replace(PHP_EOL,"<br>",$map);
		print_r($map);
		
	}else{
		die("ERROR. Empty filelist or undefined act (load / undo).");
		
	}
}else{
	die("ERROR. Undefined username");
}




?>