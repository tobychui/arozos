<?php
include '../../../auth.php';
?>
<?php
//Check if a file exists or not
if (isset($_GET['file']) && $_GET['file'] != ""){
	if (file_exists($_GET['file'])){
		echo 'DONE, TRUE';
	}else{
		echo 'DONE, FALSE';
	}
}else{
	die("ERROR. file variable is undefined.");
	
}
?>