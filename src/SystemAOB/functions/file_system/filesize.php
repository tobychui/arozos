<?php
include '../../../auth.php';
?>
<?php
//Get the filesize of a given file
function GetDirectorySize($path){
    $bytestotal = 0;
    $path = realpath($path);
    if($path!==false && $path!='' && file_exists($path)){
        foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS)) as $object){
            $bytestotal += $object->getSize();
        }
    }
    return $bytestotal;
}

function format_string($size)
{
    $units = array( 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB');
    $power = $size > 0 ? floor(log($size, 1024)) : 0;
    return number_format($size / pow(1024, $power), 2, '.', ',') . ' ' . $units[$power];
}

function isJson($string) {
 json_decode($string);
 return (json_last_error() == JSON_ERROR_NONE);
}

if (isset($_GET['file']) && $_GET['file'] != ""){
	$file = $_GET['file'];
	if (isJson($file)){
	    //This is a json encoded string. Decode it first
	    $file = json_decode($file);
	}
	
	if (strpos($file,"extDiskAccess.php?file=") !== false){
		$file = array_pop(explode("=",$file));
	}
	
	if (file_exists($file)){
		$filesize = 0;
		if (is_dir($file)){
			$filesize = GetDirectorySize($file);
		}else{
			if (strncasecmp(PHP_OS, 'WIN', 3) == 0) {
				$filesize = filesize($file);
			}else{
				//Use linux shell is much faster than PHP filesize
				$filesize = shell_exec("wc -c < " . realpath($file));
			}
			
		}
		if (isset($_GET['raw'])){
			header('Content-Type: application/json');
			echo json_encode($filesize);
		}else{
			header('Content-Type: application/json');
			echo json_encode(format_string($filesize));
		}
		
		
	}else{
		die("ERROR, file not exists.");
	}
}else{
	die("ERROR, undefined file variable.");
}

?>