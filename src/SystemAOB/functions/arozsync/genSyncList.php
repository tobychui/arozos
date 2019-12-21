<?php
include_once("../../../auth.php");
$syncPaths = json_decode(file_get_contents("syncPaths.conf"),true);
$rootPath = str_replace("\\","/",realpath($rootPath)) . "/";
$paths = [];
foreach ($syncPaths as $path){
	$recursivePaths = getDirContents("../../../" . $path);
	$rpaths = [];
	foreach ($recursivePaths as $rpath){
		$thispath = str_replace("\\","/",$rpath);
		//All files start from either ArOZ Online Root or /media external storage.
		$rpath = str_replace($rootPath,"",$thispath);
		if (is_file($thispath)){
			array_push($rpaths,[$rpath,md5_file($thispath),filemtime($thispath)]);
		}else{
			array_push($rpaths,[$rpath,"",filemtime($thispath)]);
		}
		
	}
	array_push($paths,$rpaths);
}
file_put_contents("synclist.json",json_encode(utf8ize($paths)));
echo "DONE";

function utf8ize($d) {
    if (is_array($d)) {
        foreach ($d as $k => $v) {
            $d[$k] = utf8ize($v);
        }
    } else if (is_string ($d)) {
        return utf8_encode($d);
    }
    return $d;
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
?>