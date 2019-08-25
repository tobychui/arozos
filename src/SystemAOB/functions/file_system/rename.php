<?php
include '../../../auth.php';
?>
<?php
//File / Folder Rename PHP
function isJson($string) {
 json_decode($string);
 return (json_last_error() == JSON_ERROR_NONE);
}

if (isset($_GET['file']) && $_GET['file'] != "" && isset($_GET['newFileName']) && $_GET['newFileName'] != "" && isset($_GET['hex']) && $_GET['hex'] != ""){
	$orgFile = $_GET['file'];
	$newFile = $_GET['newFileName'];
	$hex = $_GET['hex'];
	if (isJson($newFile)){
	    //This is a json encoded string. Decode it first
	    $newFile = json_decode($newFile);
	}
	if (isJson($orgFile)){
	    //This is a json encoded string. Decode it first
	    $orgFile = json_decode($orgFile);
	}
	if (file_exists($orgFile)){
		if (file_exists($newFile) == false){
			//Ready to rename
			if (is_dir($orgFile)){
				//The renaming target is a folder
				if ($hex == "false"){
					rename(realPath($orgFile),$newFile);
					echo "DONE";
				}else{
					//Default hex = true
					$pathInfo = explode("/",$newFile);
					$fName = array_pop($pathInfo);
					$parentpath = dirname($newFile);
					rename(realPath($orgFile),$parentpath . "/" . bin2hex($fName));
					echo 'DONE';
				}
			}else if (is_file($orgFile)){
				//The renaming target is a file
				if ($hex == "false"){
					rename($orgFile,$newFile);
					echo "DONE";
				}else{
					//Default hex = true
					$ext = pathinfo($orgFile, PATHINFO_EXTENSION);
					$fName = basename($newFile, "." .$ext);
					$parentpath = dirname($newFile);
					$fName = "inith" . bin2hex($fName) . "." . $ext;
					rename($orgFile,$parentpath . "/" . $fName);
					echo 'DONE';
				}
			}
			
		}else{
			die("ERROR. File with new name already exists.");	
		}
		
	}else{
		//Origianl File not exists
		die("ERROR. File not exists. Given: " . $orgFile);
		
	}
}

?>