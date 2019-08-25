<?php
include_once '../../auth.php';
?>
<?php
$allowedFolders = ['/media/'];

function ArrayContain($string, $array){
	foreach ($array as $item) {
		if (strpos($string, $item) !== FALSE) { 
			return true;
		}
	}
	return false;
}

if (isset($_GET["file"]) && $_GET["file"] != ""){
	if (file_exists($_GET["file"]) && ArrayContain(realpath($_GET["file"]),$allowedFolders)){
		$path = $_GET["file"];
		$mime = mime_content_type($_GET["file"]);
	}else{
		http_response_code(404);
		die("ERROR. File not found or permission denied.");
	}
	
}else{
	http_response_code(404);
	die("ERROR. File variable not found.");
}
$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
if (strpos(mime_content_type($path),"video/") !== false || number_format(filesize($path) / 1048576, 2) > 1){ 
	//Partial streaming will be used if file larger than 1Mb or it is a video
	if (in_array("mod_xsendfile",apache_get_modules())){
		//Check if a given filename is given. If yes, also pass it to modXSendFile
		if (isset($_GET['filename']) && $_GET['filename'] != ""){
			$filename = $_GET['filename'];
		}else{
			$filename = "";
		}
	    //This system contains xsendfile mode. Stream with xsend mode instead
	    header("Location: xsendfile.php?filename=" . $path . "&downloadname=" . $filename);
	}else{
	    //Stream through PHP, painfully slow
	    require_once("videoStreamer.php");
    	$stream = new VideoStream($path);
	    $stream->start();
	}
	
}else{
	$size=filesize($path);
	$fm=@fopen($path,'rb');
	if(!$fm) {
	  // You can also redirect here
	  header ("HTTP/1.0 404 Not Found");
	  die();
	}
	$begin=0;
	$end=$size;

	if(isset($_SERVER['HTTP_RANGE'])) {
	  if(preg_match('/bytes=\h*(\d+)-(\d*)[\D.*]?/i', $_SERVER['HTTP_RANGE'], $matches)) {
		$begin=intval($matches[0]);
		if(!empty($matches[1])) {
		  $end=intval($matches[1]);
		}
	  }
	}

	if($begin>0||$end<$size)
	  header('HTTP/1.1 206 Partial Content');
	else
	  header('HTTP/1.1 200 OK');
	
	if (isset($_GET['mode']) && $_GET['mode'] == "download"){
		if (isset($_GET['filename']) && $_GET['filename'] != ""){
			$filename = json_decode($_GET['filename']);
		}else{
			$filename = basename($_GET["file"]);
		}
		header("Cache-Control: public");
		header("Content-Description: File Transfer");
		header('Content-Disposition: attachment; filename="'.$filename.'"');
		header("Content-Transfer-Encoding: binary");
		header("Content-Type: binary/octet-stream");
	}else{
		header("Content-Type: " . $mime);
		header('Accept-Ranges: bytes');
		header('Content-Length:'.($end-$begin));
		header("Content-Disposition: inline;");
		header("Content-Range: bytes $begin-$end/$size");
		header("Content-Transfer-Encoding: binary\n");
		header('Connection: close');
	}
	$cur=$begin;
	fseek($fm,$begin,0);

	while(!feof($fm)&&$cur<$end&&(connection_status()==0))
	{ print fread($fm,min(1024*16,$end-$cur));
	  $cur+=1024*16;
	  usleep(1000);
	}
	die();
}
?>