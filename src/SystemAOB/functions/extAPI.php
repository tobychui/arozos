<?php
if (isset($_GET['target']) && $_GET['target'] != ""){
	$_GET['target'] = str_replace("../","",$_GET['target']); //Now allow backing to the system root
	if (isset($_GET['username']) && isset($_GET['apwd'])){
		$databasePath = "";
		if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
				$databasePath = "C:/AOB/whitelist.config";
			}else{
				$databasePath = "/etc/AOB/whitelist.config";
		}
		$loginContent = file_get_contents($databasePath);
		$loginContent = explode("\n",$loginContent);
		setcookie("username",$_GET['username'],time() + 30);
		setcookie("password",$_GET['apwd'],time() + 30);
		foreach ($loginContent as $registedUserData){
		if ($registedUserData != ""){
			$chunk = explode(",",$registedUserData);
			$username = $chunk[0];
			$hasedpw = $chunk[1];
			if ($username == $_GET['username']){
				$hashedInput = hash('sha512', $_GET['apwd']);
				if (trim(strtoupper($hasedpw)) == trim(strtoupper($hashedInput))){
					//Login suceed
					$_SESSION['login'] = $username;
					header("Location: " . $_GET['target']);
				}else{
					echo "ERROR. Password incorrect";
					exit();
				}
			}
		}
		
	}
	die("ERROR. Username not found");
		
	}else{
		die("ERROR. Auth format error.");
	}
}else{
	die("ERROR. Unset target php");
}
?>