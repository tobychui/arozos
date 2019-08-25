<?php
include '../auth.php';
if (isset($_POST['filename']) && $_POST['filename'] != ""){
	if (isset($_GET['username']) && $_GET['username'] != ""){
		if (isset($_POST['newfilename']) && $_POST['newfilename'] != ""){
			$filename = "files/" . $_GET['username'] . "/" . json_decode($_POST['filename']);
			$newfilename = "files/" . $_GET['username'] . "/" . json_decode($_POST['newfilename']);
			$resultFilename = "";
			if (file_exists($filename)){
				$newfn = json_decode($_POST['newfilename']);
				$ext = pathinfo($newfn, PATHINFO_EXTENSION);
				if (pathinfo($filename, PATHINFO_EXTENSION) == "shortcut"){
					//This is a shortcut. Edit the 2nd line of the shortcut file for renaming a shortcut
					$shortcutLink = file_get_contents($filename);
					$data = explode(PHP_EOL,$shortcutLink);
					$data[1] = explode(".",$newfn)[0]; //use to remove any "." in the string
					$shortcutLink = implode(PHP_EOL,$data);
					file_put_contents($filename, $shortcutLink,LOCK_EX);
					header('Content-Type: application/json');
					echo json_encode($filename);
					exit(0);
				}
				
				if (preg_match('/[^A-Za-z0-9.]/', json_decode($_POST['newfilename']))){
					if (is_file($filename)){			
						$filenameonly = str_replace("." . $ext,"",$newfn);
						$encodedFilename = "inith" . bin2hex($filenameonly) . "." . $ext;
						$newfilename = "files/" . $_GET['username'] . "/" . $encodedFilename;
						if (file_exists($newfilename)){
							die("ERROR. Rename target already exists.");
						}
					}else if (is_dir($filename)){
						$newfn = json_decode($_POST['newfilename']);
						$encodedFilename =bin2hex($newfn);
						$newfilename = "files/" . $_GET['username'] . "/" . $encodedFilename;
						if (file_exists($newfilename)){
							die("ERROR. Rename target already exists.");
						}
					}
					rename($filename,$newfilename);
					$resultFilename = $encodedFilename;
				}else{
					if (file_exists($newfilename)){
						die("ERROR. Rename target already exists.");
					}
					rename($filename,$newfilename);
					$resultFilename = json_decode($_POST['newfilename']);
				}
				header('Content-Type: application/json');
				echo json_encode($resultFilename);
				
			}else{
				die("ERROR. Rename source not exists. " . $filename . " was given.");
			}
			
		}else{
			die("ERROR. Undefined newfilename");
		}
	}else{
		die("ERROR. Undefined username");
	}
}else{
	die("ERROR. Undefined filename");
	
}


?>