<?php
include '../../../auth.php';
?>
<?php
$files = glob("TrashBin/*.zip");
foreach ($files as $file){
	unlink($file);
}
echo "DONE";
?>