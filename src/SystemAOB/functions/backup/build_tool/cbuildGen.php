<?php
include_once("../../../../auth.php");
$root = "../../../../";
$allowModules = ["Audio","Desktop","Documd","File Explorer","Help","NotepadA","Photo","Power","System Settings","SystemAOB","Upload Manager", "Video", "img", "msb", "script"];
$modules = glob($root . "*");
foreach ($modules as $file){
	if (is_dir($file)){
		if (!in_array(basename($file), $allowModules)){
			//Modules that should be skipped during building
			echo basename($file) . "<br>";
		}
	}
}
?>