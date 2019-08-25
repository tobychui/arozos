<?php
include_once '../../../auth.php';

if(isset($_GET['keyword']) && $_GET['keyword'] != ""){
	$keyword = $_GET["keyword"];
	if ($keyword == ""){
		die("ERROR. Keyword cannot be empty.");
	}else if ($keyword == "/" || $keyword == "\\" || str_replace("/","",$keyword) == "" || str_replace("\\","",$keyword) == "" || str_replace("/","",str_replace("\\","",$keyword)) == ""){
		die("ERROR. Keyword cannot be directory seperator.");
	}else if ($keyword == "." || $keyword == " "){
		die("ERROR. Keyword is not a valid filename keyword.");
	}
	function getDirContents($dir, &$results = array()){
		$files = scandir($dir);
		foreach($files as $key => $value){
			$path = realpath($dir.DIRECTORY_SEPARATOR.$value);
			if(!is_dir($path)) {
				$results[] = $path;
			} else if($value != "." && $value != "..") {
				getDirContents($path, $results);
				$results[] = $path;
			}
		}
		return $results;
	}
	
	function getRelativePath($from, $to)
	{
		// some compatibility fixes for Windows paths
		$from = is_dir($from) ? rtrim($from, '\/') . '/' : $from;
		$to   = is_dir($to)   ? rtrim($to, '\/') . '/'   : $to;
		$from = str_replace('\\', '/', $from);
		$to   = str_replace('\\', '/', $to);

		$from     = explode('/', $from);
		$to       = explode('/', $to);
		$relPath  = $to;

		foreach($from as $depth => $dir) {
			// find first non-matching dir
			if($dir === $to[$depth]) {
				// ignore this directory
				array_shift($relPath);
			} else {
				// get number of remaining dirs to $from
				$remaining = count($from) - $depth;
				if($remaining > 1) {
					// add traversals up to first matching dir
					$padLength = (count($relPath) + $remaining - 1) * -1;
					$relPath = array_pad($relPath, $padLength, '..');
					break;
				} else {
					$relPath[0] = './' . $relPath[0];
				}
			}
		}
		return implode('/', $relPath);
	}

	function hexFilenameDecoder($file){
		$ext = pathinfo($file, PATHINFO_EXTENSION);
		$filename = str_replace("inith","",basename($file,"." . $ext));
		if (ctype_xdigit($filename) && strlen($filename) % 2 == 0){
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				return ($filename . "." . $ext);
			
		}else{
			//If it is not um-encoded, just echo out its original filename
			return $file;
		}
	}
	
	$files = getDirContents('../../../');
	$result = [];
	foreach ($files as $file){
		if (strpos(basename($file),$keyword)){
			$relativePath = getRelativePath(realpath("../../../"),$file);
			$decodedName = hexFilenameDecoder(basename($file));
			array_push($result,[$relativePath,$decodedName]);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
}else{
    die("ERROR. keyword not defined.");
}
	
?>