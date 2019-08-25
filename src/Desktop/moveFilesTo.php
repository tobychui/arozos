<?php
include '../auth.php';
//This php handles the move to and folder creation process.

function recurse_copy($src,$dst) { 
    $dir = opendir($src); 
    @mkdir($dst); 
    while(false !== ( $file = readdir($dir)) ) { 
        if (( $file != '.' ) && ( $file != '..' )) { 
            if ( is_dir($src . '/' . $file) ) { 
                recurse_copy($src . '/' . $file,$dst . '/' . $file); 
            } 
            else { 
                copy($src . '/' . $file,$dst . '/' . $file); 
            } 
        } 
    } 
    closedir($dir); 
} 

function delete_files($target) {
    if(is_dir($target)){
        $files = glob( $target . '*', GLOB_MARK ); //GLOB_MARK adds a slash to directories returned

        foreach( $files as $file ){
            delete_files( $file );      
        }

        rmdir( $target );
    } elseif(is_file($target)) {
        unlink( $target );  
    }
}

if (isset($_GET['act']) && $_GET['act'] != ""){
	$action = $_GET['act'];
	if ($action == "newFolder"){
		//NOTICE THE PATH IS WITH GET VARIABLE WHILE FOLDERNAME IS IN POST VARIABLE TO HANDLE NON ENGLISH FOLDERNAMES
		if (isset($_GET['path']) && $_GET['path'] != "" && isset($_POST['foldername']) && $_POST['foldername'] != ""){
			//path are starting from the root of AOB
			$foldername = json_decode($_POST['foldername']);
			if (!preg_match('/[^A-Za-z0-9 ]/', $foldername)){
				
			}else{
				//Some wierd character in the folder name. Encoding it in UMF Format
				$foldername = bin2hex($foldername);
			}
			if (file_exists($_GET['path'])){
				$realPath = $_GET['path'] . "/" . $foldername;
			}else{
				$realPath = "../" . $_GET['path'] . "/" . $foldername;
			}
			$realPath = str_replace("//","/",$realPath);
			if (file_exists(dirname($realPath))){
				if (file_exists($realPath)){
					echo 'ERROR. Folder already exists.';
				}else{
					mkdir($realPath, 0777);
					echo 'DONE';
				}
			}else{
				die("ERROR. Path not exists." . $realPath . " given.");
			}
		}else{
			die("ERROR. Undefined path or foldername");
		}
	}else if ($action == "moveFiles"){
		if (isset($_GET['path']) && $_GET['path'] != "" && isset($_POST['filelist']) && $_POST['filelist'] != ""){
			if (file_exists("../".$_GET['path']) == false && file_exists($_GET['path']) == false){
				die("ERROR. Targeted path does not exists." . $_GET['path'] . " is given.");
			}
			if (isset($_GET['username']) && $_GET['username'] != ""){
				$username = $_GET['username'];
				if (file_exists($_GET['path'])){
					$targetPath = $_GET['path'];
					$realPath = trim($targetPath);
				}else{
					$targetPath = "../" . $_GET['path'];
					$realPath = realpath($targetPath);
				}
				$fileList = json_decode($_POST['filelist']);
				$dir = "files/" . $_GET['username'] . "/";
				$dir = realpath($dir);
				$movedCount = 0;
				$skippedCount = 0;
				$movedFiles = [];
				foreach ($fileList as $file){
					if (file_exists($realPath . "/" . $file) == false){
						//rename have bugs over linux system so instead of rename, copy -> unlink is used
						//rename($dir . "/" . $file, $realPath . "/" . $file);
						if (is_dir($dir . "/" . $file)){
							recurse_copy($dir . "/" . $file,$realPath . "/" . $file);
							delete_files($dir . "/" . $file);
						}else{
							//As file do not have the problem, keep this part
							rename($dir . "/" . $file, $realPath . "/" . $file);
						}
						array_push($movedFiles,$file);
						$movedCount++;
					}else{
						$skippedCount++;
					}
					
				}
				header('Content-Type: application/json');
				echo json_encode([$movedCount,$skippedCount,$movedFiles]);
			}else{
				die("ERROR. Undefined username");
			}
			
			
		}else{
			die("ERROR. path or filelist is not defined.");
		}
	}else if ($action == "moveFilesOverwrite"){
		//Move file with overwrite
		if (isset($_GET['path']) && $_GET['path'] != "" && isset($_POST['filelist']) && $_POST['filelist'] != ""){
			if (file_exists("../".$_GET['path']) == false && file_exists($_GET['path']) == false){
				die("ERROR. Targeted path does not exists." . $_GET['path'] . " is given.");
			}
			if (isset($_GET['username']) && $_GET['username'] != ""){
				$username = $_GET['username'];
				if (file_exists($_GET['path'])){
					$targetPath = $_GET['path'];
					$realPath = trim($targetPath);
				}else{
					$targetPath = "../" . $_GET['path'];
					$realPath = realpath($targetPath);
				}
				$fileList = json_decode($_POST['filelist']);
				$dir = "files/" . $_GET['username'] . "/";
				$dir = realpath($dir);
				$movedCount = 0;
				$overWriteCount = 0;
				$movedFiles = [];
				foreach ($fileList as $file){
					if (file_exists($realPath . "/" . $file) == false){
						//move file if it does not exists
						if (is_dir($dir . "/" . $file)){
							recurse_copy($dir . "/" . $file,$realPath . "/" . $file);
							delete_files($dir . "/" . $file);
						}else{
							//As file do not have the problem, keep this part
							rename($dir . "/" . $file, $realPath . "/" . $file);
						}
						array_push($movedFiles,$file);
						$movedCount++;
					}else{
						//remove the old file if it exists
						delete_files($realPath . "/" . $file);
						if (file_exists($realPath . "/" . $file)){
							unlink($realPath . "/" . $file);
						}
						if (is_dir($dir . "/" . $file)){
							recurse_copy($dir . "/" . $file,$realPath . "/" . $file);
							delete_files($dir . "/" . $file);
						}else{
							//As file do not have the problem, keep this part
							rename($dir . "/" . $file, $realPath . "/" . $file);
						}
						array_push($movedFiles,$file);
						$overWriteCount++;
					}
					
				}
				header('Content-Type: application/json');
				echo json_encode([$movedCount,$overWriteCount,$movedFiles]);
			}else{
				die("ERROR. Undefined username");
			}
			
			
		}else{
			die("ERROR. path or filelist is not defined.");
		}
	}
}else{
	die("ERROR. Undefined act variable.");
}

?>