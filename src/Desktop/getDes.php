<?php
include '../auth.php';
?>
<?php
if (isset($_GET['module']) && $_GET['module'] != ""){
	$module = $_GET['module'];
	if (file_exists("../" . $module . "/description.txt")){
		//The module exists
		$content = file_get_contents("../" . $module . "/description.txt");
		echo strip_tags($content);
	}else{
		echo "No information.";
	}
	
}
?>