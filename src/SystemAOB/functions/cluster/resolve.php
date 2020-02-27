<?php
include_once("../../../auth.php");
if (isset($_GET['uuid']) && $_GET['uuid'] != ""){
	if (file_exists("mappers/" . $_GET['uuid'] . ".inf")){
		echo file_get_contents("mappers/" . $_GET['uuid'] . ".inf");
		exit(0);
	}else{
		die("");
	}
}else if (isset($_GET['remoteDev']) && $_GET['remoteDev'] != ""){
	if (file_exists("remotedev/" . $_GET['remoteDev'] . ".inf")){
		echo file_get_contents("remotedev/" . $_GET['remoteDev'] . ".inf");
		exit(0);
	}else{
		die("");
	}
}else{
	die("ERROR. Undefined UUID or remoteDev");
}


?>