<?php
include '../auth.php';
?>
<?php
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

if (isset($_GET['moduleName']) && $_GET['moduleName'] != ""){
	$updateMode = false;
	if (is_dir("unzip/" .$_GET['moduleName']) == false){
		echo "ERROR. " . $_GET['moduleName'] . " not found.";
		exit(0);
	}
    $dir = "unzip/" . $_GET['moduleName'];//"path/to/targetFiles";
    $dirNew = "../" . $_GET['moduleName'];//path/to/destination/files
	if (file_exists($dirNew)){
		//As the module is already installed, this script will only update the php / js / css script within the module.
		$updateMode = true;
	}else{
		mkdir("$dirNew/", 0777);
	}
	$files = scandir($dir);
	$oldfolder = "$dir/";
	$newfolder = "$dirNew/";
	$notUpdateExt = ["config","log"];
	foreach($files as $fname) {
		if ($updateMode){
			//Updating only the script files
			if($fname != '.' && $fname != '..') {
				if (file_exists($newfolder.$fname) && is_file($newfolder.$fname)){
					//This file already exists.
					$ext = pathinfo($newfolder.$fname, PATHINFO_EXTENSION);
					if (!in_array($ext, $notUpdateExt)){
						unlink($newfolder.$fname);
						rename($oldfolder.$fname, $newfolder.$fname);
					}
				}elseif (file_exists($newfolder.$fname) && is_dir($newfolder.$fname)){
					//This folder already exists.
					//Ignore the folder itself (The file inside is still copied)
				}else{
					//This file / folder only exists in the newer version module, move it to the new module
					rename($oldfolder.$fname, $newfolder.$fname);
				}
			}
		}else{
			//Installing new module
			if($fname != '.' && $fname != '..') {
				rename($oldfolder.$fname, $newfolder.$fname);
			}
		}
		
	}
	deleteDir($dir);
	echo "DONE";

}else{
	echo "ERROR. Module not found.";
	exit(0);
}

?>