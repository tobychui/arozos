<?php
include '../auth.php';
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}
function mv($var){
	if (isset($_GET[$var]) && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return "";
	}
}
//Example commands
//desktopInfo.php?username=TC&act=load --> Load all the desktop icon location from server
//desktopInfo.php?username=TC&act=set&uid=Audio.shortcut&x=10&y=110 --> Set desktop icon with uid = Audio.shortcut at position x=10 and y = 110
//desktopInfo.php?username=TC&act=rmv&uid=Audio.shortcut --> Remove the related storage information of Audio.shortcut
if (isset($_GET['username']) && $_GET['username'] != ""){
	$username = $_GET['username'];
	if (isset($_GET['act']) && $_GET['act'] != ""){
		$act = $_GET['act'];
		if ($act == "load"){
			if (file_exists("files/" . $username) && file_exists("deskinf/" . $username . ".deskinf")){
				//Load the desktop information from file
				
			}else if (file_exists("files/" . $username) && file_exists("deskinf/" . $username . ".deskinf") == false){
				//Desktop informatio not found. Creating one.
				$filename = "deskinf/" . $username . ".deskinf";
				$myfile = fopen($filename, "w") or die("ERROR. Unable to create file.");
				$txt = "MyHost,10,10".PHP_EOL;
				fwrite($myfile, $txt);
				fclose($myfile);
			}else if (file_exists("files/" . $username) == false){
				echo 'ERROR. Desktop folder of thuis user not found.';
				exit(0);
			}
			
			$filename = "deskinf/" . $username . ".deskinf";
			//Load from userfile
			$content = file_get_contents($filename);
			$chunks = explode(PHP_EOL,trim($content));
			$data = [];
			foreach ($chunks as $chunk){
				array_push($data,explode(",",$chunk));
			}			
			header('Content-Type: application/json');
			echo json_encode($data);
		}else if ($act == "set"){
			$filename = "deskinf/" . $username . ".deskinf";
			if (!(mv("uid") == "" || mv("x") == "" || mv("y") == "")){
				//If every variable is OK, search if it has been set already or not
				$contents = file_get_contents($filename);
				if (strpos($contents,mv("uid") . ",") !== false){
					unlink($filename);
					//This value has already been set. Update the old data
					$contents = explode(PHP_EOL,$contents);
					$myfile = fopen($filename, "w") or die("ERROR. Unable to create file.");
					foreach ($contents as $line){
						if (strpos($line,mv("uid") . ",") !== false){
							$txt = mv("uid") . "," . mv("x"). "," . mv("y") . PHP_EOL;
							fwrite($myfile,$txt);
						}else{
							if (trim($line) != ""){
								fwrite($myfile,$line. PHP_EOL);
							}
							
						}
					}
					fclose($myfile);
					echo 'DONE';
				}else{
					//This value hasn't been set yet. Append a new one.
					$txt = mv("uid") . "," . mv("x"). "," . mv("y");
					file_put_contents($filename, $txt.PHP_EOL , FILE_APPEND | LOCK_EX);
					echo 'DONE';
				}
				//Update to session key Desktop_username_dflt to current time (Desktop File Location Timestamp)
			}else{
				echo 'ERROR. Missing variable in uid, x or y when performing set location.';
			}
		}else if ($act == "rmv"){
			if (mv("uid") == "" ){
				die("ERROR. Undefined uid value.");
			}
			$filename = "deskinf/" . $username . ".deskinf";
			$contents = file_get_contents($filename);
			$lines = explode(PHP_EOL,trim($contents));
			$newContents = "";
			foreach ($lines as $line){
				if(strpos($line,mv("uid") . ",") !== false){
					//This line get the value we want to remove
					
				}else{
					$newContents = $newContents . $line . PHP_EOL;
				}
			}
			file_put_contents($filename, $newContents,LOCK_EX);
			//Update to session key Desktop_username_dflt to current time (Desktop File Location Timestamp)
			echo 'DONE';
		}
		
	}else{
		echo 'ERROR. Undefined act to perform.';
	}
	
	
}else{
	echo 'ERROR. Undefined username variable';
	
}



?>