<?php
include_once("../auth.php");
if (isset($_GET['id'])){
	if (file_exists("tmp/" . $_GET['id'])){
		echo file_get_contents("tmp/" . $_GET['id']);
		exit(0);
	}
}else{
	die("ERROR. unset id value for lookup.");
}
?>