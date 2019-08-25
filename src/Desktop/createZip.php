<?php
include '../auth.php';

function mg($var){
	if (isset($_GET[$var]) && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return "";
	}
}

function mp($var){
	if (isset($_POST[$var]) && $_POST[$var] != ""){
		return $_POST[$var];
	}else{
		return "";
	}
}

$foundFiles = [];
function finddir($target) {
	global $foundFiles;
	if(is_dir($target)){
		$files = glob( $target . '*', GLOB_MARK );
			foreach( $files as $file ){
				finddir( $file );
			}
	}elseif(is_file($target)){
		$target = str_replace('\\', '/', $target);
		array_push($foundFiles,$target);
	}
}


if (mg("mode") != ""){
	$mode = mg("mode");
	$username = mg("username");
	if ($mode == "zip"){
		//Zip the folder under ArOZ Online naming method (raw)
		$files = json_decode(mp("filelist"));
		foreach ($files as $file){
			$filename = "files/" . $username . "/" . $file;
			if (is_dir($filename)){
				finddir($filename);
			}else if (is_file($filename)){
				array_push($foundFiles,$filename);
			}
		}
		$zipname = "tmp/" . time() . '.zip';
		$zip = new ZipArchive;
		$zip->open($zipname, ZipArchive::CREATE);
		foreach ($foundFiles as $file) {
			$savePath = str_replace("files/" . $username . "/","",$file);
			$zip->addFile($file,$savePath);
		}
		$zip->close();
		header('Content-Type: application/json');
		echo json_encode([$zipname,basename($zipname)]);
		/**
		//Start streaming the content of the zip file
		header('Content-Type: application/zip');
		header('Content-disposition: attachment; filename='.$zipname);
		header('Content-Length: ' . filesize($zipname));
		readfile($zipname);
		**/
	}else if ($mode == "zipWindow"){
		//Zip the folder under Window naming convension
		$files = json_decode(mp("filelist"));
		foreach ($files as $file){
			$filename = "files/" . $username . "/" . $file;
			if (is_dir($filename)){
				finddir($filename);
			}else if (is_file($filename)){
				array_push($foundFiles,$filename);
			}
		}
		$zipname = "tmp/" . time() . '.zip';
		$zip = new ZipArchive;
		$zip->open($zipname, ZipArchive::CREATE);
		
		foreach ($foundFiles as $file) {
			$savePath = str_replace("files/" . $username . "/","",$file);
			//Convert each part of the path to Windows readable paths

			if (is_file($file)){
				//Convert the filename if this is a filename
				$fileOnly = basename($savePath);
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($fileOnly)));
				if(ctype_xdigit($filename) && strlen($filename) % 2 == 0) {
					$filename = hex2bin($filename);
				}
				$decodedFileName = $filename . "." . $ext;
				$pathChunks = explode("/",$savePath);
				//Remove the filename from path, and start processing the path
				array_pop($pathChunks);
			}else{
				$pathChunks = explode("/",$savePath);
			}

			$decodedPath = [];
			foreach ($pathChunks as $data){
				if(ctype_xdigit($data) && strlen($data) % 2 == 0) {
					$decodedName = hex2bin($data);
				} else {
					$decodedName = $data;
				}
				array_push($decodedPath,$decodedName);
			}
			
			array_push($decodedPath,$decodedFileName);
			$newPath = implode("/",$decodedPath);
			//echo $newPath . PHP_EOL;

			$zip->addFile($file,$newPath);
		}
		$zip->close();
		header('Content-Type: application/json');
		echo json_encode([$zipname,basename($zipname)]);

	}else if ($mode == "zipTo"){
		//Zip the folder under Window naming convension and put it to somewhere
		if (mg("target") != ""){
			$storeTarget = mg("target");
			if (file_exists($storeTarget) == false){
				die("ERROR. ZipTo target not exists.");
			}
			$name = time();
			if (mp("filename") != ""){
				$name = mp("filename");
				//If there is already a file with the same name, overwrite as default
				if (file_exists($storeTarget . "/" . $name . '.zip')){
					unlink($storeTarget . "/" . $name . '.zip');
				}
				if (preg_match("/^[a-zA-Z0-9 ]*$/u", $string) == 1){
					//If this filename contains non alphbetical or numerical string like Japanese and Chinese
					$name = "inith" . bin2hex($name);
				}
			}
			$files = json_decode(mp("filelist"));
			foreach ($files as $file){
				$filename = "files/" . $username . "/" . $file;
				if (is_dir($filename)){
					finddir($filename);
				}else if (is_file($filename)){
					array_push($foundFiles,$filename);
				}
			}
			$zipname = $storeTarget . "/" . $name . '.zip';
			$zip = new ZipArchive;
			$zip->open($zipname, ZipArchive::CREATE);
			
			foreach ($foundFiles as $file) {
				$savePath = str_replace("files/" . $username . "/","",$file);
				//Convert each part of the path to Windows readable paths

				if (is_file($file)){
					//Convert the filename if this is a filename
					$fileOnly = basename($savePath);
					$ext = pathinfo($file, PATHINFO_EXTENSION);
					$filename = str_replace("." . $ext,"",str_replace("inith","",basename($fileOnly)));
					if(ctype_xdigit($filename) && strlen($filename) % 2 == 0) {
						$filename = hex2bin($filename);
					}
					$decodedFileName = $filename . "." . $ext;
					$pathChunks = explode("/",$savePath);
					//Remove the filename from path, and start processing the path
					array_pop($pathChunks);
				}else{
					$pathChunks = explode("/",$savePath);
				}

				$decodedPath = [];
				foreach ($pathChunks as $data){
					if(ctype_xdigit($data) && strlen($data) % 2 == 0) {
						$decodedName = hex2bin($data);
					} else {
						$decodedName = $data;
					}
					array_push($decodedPath,$decodedName);
				}
				array_push($decodedPath,$decodedFileName);
				$newPath = implode("/",$decodedPath);
				//echo $newPath . PHP_EOL;

				$zip->addFile($file,$newPath);
			}
			$zip->close();
			header('Content-Type: application/json');
			echo json_encode([$zipname,basename($zipname)]);
		}else{
			die("ERROR. Unset zipTo target.");
		}
		
		
		
	}else if ($mode == "debug"){
		$files = json_decode(mp("filelist"));
		foreach ($files as $file){
			$filename = "files/" . $username . "/" . $file;
			if (is_dir($filename)){
				finddir($filename);
			}else if (is_file($filename)){
				array_push($foundFiles,$filename);
			}
		}
		header('Content-Type: application/json');
		echo json_encode($foundFiles);
	}
}else{
	echo 'ERROR. Unset zipping mode.';
}

?>