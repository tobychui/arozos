<?php
include '../../../auth.php';
function countline($filepath){
	$file=$filepath;
	$linecount = 0;
	$handle = fopen($file, "r");
	while(!feof($handle)){
	  $line = fgets($handle);
	  $linecount++;
	}
	fclose($handle);
	return $linecount;
}

$root = "../../../";
$totalLines = 0;
$di = new RecursiveDirectoryIterator($root);
foreach (new RecursiveIteratorIterator($di) as $filename => $file) {
	$ext = pathinfo($filename, PATHINFO_EXTENSION);
	if ($ext == "php" || $ext == "js"){
		$thisline = countline($filename);
		$totalLines += $thisline;
		echo $filename . ' - ' . $file->getSize() . ' bytes / '. $thisline .' lines. <br/>';
	}
}

echo "<br><br> Total Line of Code = " . $totalLines ;
?>