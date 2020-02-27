<?php
include '../../../auth.php';
include_once("../personalization/configIO.php");
$fsconf = getConfig("fsaccess",true);

//Require variable: filename (Full path)
//Allowed Deleting Path
$allowedPath = [str_replace("\\","/",$_SERVER['DOCUMENT_ROOT'])];
$extstorage = glob("/media/storage*");
foreach ($extstorage as $storage){
	array_push($allowedPath,$storage);
}
function mv($var){
	if (isset($_GET[$var]) !== false && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return null;
	}
}

function insideSystemAOB($filepath){
	if ($fsconf["enablesysscriptCheckBeforeDelete"][3] == false){
		//Bypass checking
		return false;
	}
	$systemAOBRealPath = realpath("../../");
	$filepathRealPath = realpath($filepath);
	if (strpos($filepathRealPath,$systemAOBRealPath) === 0){
		return true;
	}else{
		return false;
	}
	
}

function listFiles($dir){
	$files = [];
    $ffs = scandir($dir);
    unset($ffs[array_search('.', $ffs, true)]);
    unset($ffs[array_search('..', $ffs, true)]);

    // prevent empty ordered elements
    if (count($ffs) < 1)
        return;
	
    foreach($ffs as $ff){
		if (is_dir($dir . '/' . $ff)){
			$subfiles = listFiles($dir.'/'.$ff);
			$files = array_merge($files,$subfiles);
		}else{
			array_push($files,$ff);
		}
    }
	
	return $files;
}

function delete_directory($dirname) {
	 if (is_dir($dirname))
	   $dir_handle = opendir($dirname);
	 if (!$dir_handle)
	      return false;
	 while($file = readdir($dir_handle)) {
	       if ($file != "." && $file != "..") {
	            if (!is_dir($dirname."/".$file))
	                 unlink($dirname."/".$file);
	            else
	                 delete_directory($dirname.'/'.$file);
	       }
	 }
	 closedir($dir_handle);
	 rmdir($dirname);
	 return true;
}

function strpos_arr($haystack, $needle) {
    foreach ($needle as $keyword){
		if (strpos($haystack,$keyword) !== false){
			return true;
		}
	}
	return false;
}


$filename = mv("filename");
if ($filename != null && strpos_arr(str_replace("\\","/",realpath($filename)),$allowedPath) == false){
	die("ERROR. You do not have permission to remove this file / directory: " . $filename);
}
if ($filename != null && file_Exists($filename) && is_file($filename)){
	//This is a file, remove the file as suggested
	/*
	$ext = pathinfo($filename, PATHINFO_EXTENSION);
	if ($ext == "php" || $ext == "js"){
		echo 'ERROR. System script cannot be deleted.';
	}else{
		if (!is_writable($filename) || !unlink($filename)){
			die('ERROR. Unable to delete file.');
		}else{
			echo "DONE";
			die();
		}
		
	}
	*/
	//Allow php to be removed with this script but only outside of SystemAOB.
	$ext = pathinfo($filename, PATHINFO_EXTENSION);
	if (insideSystemAOB($filename) && $ext == "php"){
		die("ERROR. Unable to remove protected system script in SystemAOB.");
	}
	if ($fsconf["enableTrashbin"][3] == true){
		//Move the file into trash bin
		header("Location: trashHandle.php?opr=mv&filepath=" . str_replace("../../../","",$filename));
	}else{
		//Remove without putting it into trash bin
		if (!is_writable($filename) || !unlink($filename)){
			die('ERROR. Unable to delete file.');
		}else{
			echo "DONE";
			die();
		}
	}
	
		
}else if ($filename != null && file_Exists($filename) && is_dir($filename)){
	//This is a directory. Check if there exists any php scrip.
	$files = listFiles($filename);
	$containPHP = false;
	$containJS = false;
	if (count($files) > 0){
	    foreach ($files as $file){
    		if (is_file($file)){
    			$ext = pathinfo($file, PATHINFO_EXTENSION);
    			if ($ext == "php"){
    				$containPHP = true;
    			}else if ($ext == "js"){
    				$containJS = true;
    			}
    		}
    	}
	}
	if (insideSystemAOB($filename) && count($files) > 0){
		//This is a Module folder and it contains something. Not allow delete
		echo 'ERROR. This folder contains System files. Delete request is rejected.';
	}else{
		//This folder do not contain any js or php file. User can delete this folder.
		if ($fsconf["enableTrashbin"][3] == true){
		//Move the file into trash bin
			header("Location: trashHandle.php?opr=mv&filepath=" . str_replace("../../../","",$filename));
		}else{
			delete_directory($filename);
		}
		echo 'DONE';
	}
	
	
}else{
	echo 'ERROR. File or Folder not exists.';
	return true;
	exit();
}

?>