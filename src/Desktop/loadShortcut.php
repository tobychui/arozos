<?php
include '../auth.php';
if (isset($_GET['shortcutPath']) && $_GET['shortcutPath'] != ""){
	if (isset($_GET['username']) && $_GET['username'] != ""){
		$username = $_GET['username'];
		$shortcut = $_GET['shortcutPath'];
		if (file_exists("files/" . $username . "/" . $shortcut)){
			$content = file_get_contents("files/" . $username . "/" . $shortcut);
			$data = explode(PHP_EOL,$content);
			header('Content-Type: application/json');
			echo json_encode($data);
		}else{
			echo 'ERROR. Shorcut not exists.';
		}
		
	}else{
		echo 'ERROR. Undefined username';
	}
	
}else{
	echo 'ERROR. Undefined shortcut path';
	
}

?>