<?php
include '../../../auth.php';
?>
<?php
//Folder Copying Script
function mv($var){
	if (isset($_GET[$var]) !== false && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return null;
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

function recurse_copy($src,$dst) { 
    $dir = opendir($src); 
    mkdir($dst); 
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

function CheckIfHexName($dir){
	global $fileList;
	$folderName = basename($dir);
	if (ctype_xdigit($folderName) && strlen($folderName) % 2 == 0) {
		//This folder is named in hexdec
		return true;
	}else{
		return false;
	}
}

function CheckContainSystemScript($dir){
	$files = listFiles($dir);
	$containPHP = false;
	$containJS = false;
	if (count($files) > 0){
		foreach ($files as $file){
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			//Bypass added to allow php / js copy
			if ($ext == "php"){
				$containPHP = false;
			}else if ($ext == "js"){
				$containJS = false;
			}
		}
		if ($containPHP || $containJS){
			return true;
		}else{
			return false;
		}
	}else{
		//There is nothing in this folder
		return false;
	}
}

if (mv("from")!= null && mv("target")!= null){
	$from = mv("from");
	$to = mv("target");
	$hfn = CheckIfHexName($from);
	if (is_dir($from)){
		$haveSystemScript = CheckContainSystemScript($from);
		if ($haveSystemScript && isset($_GET['bypass']) == false){
			die("ERROR. This folder contain System Script that cannot be copied.");
		}else{
			$count = 0;
			$tmpname = $to;
			while(file_exists($tmpname)){
				$count++;
				$tmpname = $to;
				if ($hfn == true){
					$tmpname .= bin2hex(" ($count)");
				}else{
					$tmpname .= " ($count)";
				}
				
			}
			recurse_copy($from,$tmpname);
			echo "DONE";
			die();
		}
	}else{
		echo "ERROR. from variable is not a directory.";
		die();
	}
	
}else{
	echo 'ERROR. Missing variables "from" or "target".';
	dir();
}


?>
