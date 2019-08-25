<?php
include_once("../../../auth.php");

function ck($a,$key){
	return array_key_exists($key,$a);
}

$keys = ["systemDesktopModule","systemStartingPath","systemExtendedDesktop","systemExtentedPath"];
//Check if the config storage exists. If no, create it
if (!file_exists("desktop-config/")){
	mkdir("desktop-config/",0777);
}
$username = $_SESSION['login'];
$configFile = "desktop-config/" . $username . "-desktop.config";
if (!file_exists($configFile)){
	//The config file for this user doesn't exists. Create one for him.
	$template = '{"systemDesktopModule":"Desktop","systemStartingPath":"index.php","systemExtendedDesktop":"Desktop","systemExtentedPath":"extented.php"}';
	file_put_contents($configFile,$template);
	echo $template;
	exit(0);
}else if (isset($_POST['newConfig']) && $_POST['newConfig'] != ""){
	//Updating the user config for desktop.
	$c = json_decode($_POST['newConfig']); //Move the new config JSON string into $c
	//Check if the most basic json keys exists or not.
	$validInput = true;
	foreach ($keys as $key){
		if (ck($c,$key) == false){
			$validInput = false;
		}
	}
	if ($validInput){
		//This new setting is valid. Write it to file.
		file_put_contents($configFile,json_encode($c));
		echo "DONE";
		exit(0);
	}else{
		die("ERROR. Given JSON object do not satisfy the minimal key requirement. One or more of the following keys are missing. <br>" . implode(",",$keys));
	}
}else{
	//The config file already existed. Read the config file and deliver it to the user
	$settings = file_get_contents($configFile);
	header('Content-Type: application/json');
	echo $settings;
	exit(0);
}

?>