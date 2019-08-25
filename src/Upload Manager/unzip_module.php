<?php
include '../auth.php';
?>
<?php
if (isset($_GET['moduleFilename']) && $_GET['moduleFilename'] != "" && is_file($_GET['moduleFilename'])){
	//Unzip the reqired module with given filename
	$file = $_GET['moduleFilename'];
	$zip = new ZipArchive;
	$res = $zip->open($file);
	if ($res === TRUE) {
	  $zip->extractTo('unzip/');
	  $zip->close();
	  $filename = basename($file,".zip");
	  $decodedName = hex2bin(substr($filename,5));
	  echo "$decodedName - DONE<br>";
	}else{
		echo "ERROR";
		exit(0);
	}
	
	//Scan the new module with virus or unsafe operations
	
}else{
	echo "ERROR. Undefined name / not a file.";
	exit(0);
}

?>