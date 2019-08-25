<?php
include '../../../auth.php';
?>
<?php
//Clear all files inside the export folder
$files = glob("export/*.zip");
foreach ($files as $file){
	unlink($file);
}
echo "DONE";
?>