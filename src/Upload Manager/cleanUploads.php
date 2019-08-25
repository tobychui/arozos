<?php
include '../auth.php';
?>
<?php
$files = glob("uploads/*.zip");
foreach ($files as $file){
	unlink($file);
}
echo "DONE";
?>