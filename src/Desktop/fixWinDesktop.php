<?php
/*
Desktop filename decode error auto fixing script
*/
function gen_uuid() {
    return sprintf( '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        // 32 bits for "time_low"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ),

        // 16 bits for "time_mid"
        mt_rand( 0, 0xffff ),

        // 16 bits for "time_hi_and_version",
        // four most significant bits holds version number 4
        mt_rand( 0, 0x0fff ) | 0x4000,

        // 16 bits, 8 bits for "clk_seq_hi_res",
        // 8 bits for "clk_seq_low",
        // two most significant bits holds zero and one for variant DCE1.1
        mt_rand( 0, 0x3fff ) | 0x8000,

        // 48 bits for "node"
        mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff ), mt_rand( 0, 0xffff )
    );
}

include_once("../auth.php");
include_once("../SystemAOB/functions/personalization/configIO.php");
$username = $_SESSION['login'];
$desktopFolder = "files/" . $username . "/";
if (file_exists($desktopFolder)){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		//Window Host
		//There might be problems when translating UTF-8 encoded filename into local encoding filenames. This might lead to load fail of the desktop icons.
		$desktopFiles = glob($desktopFolder . "*");
		$configs = getConfig("encoding",true);
		$counter = 0;
		foreach ($desktopFiles as $file){
			//Find the file that do not fits the current local encoding environment set by the system setting
			$conFilename = mb_convert_encoding($file, "UTF-8",$configs["forceEncodingType"][3]);
			if ($conFilename != $file){
				echo $conFilename;
				if (!file_exists($desktopFolder. "recovery/")){
					mkdir($desktopFolder . "recovery/");
				}
				rename($file, $desktopFolder . "recovery/" . gen_uuid() . ".zip");
				$counter++;
			}
		}
		if ($counter > 0){
			echo "DONE";
		}else{
			echo "ERROR. Unable to fix the issue.";
		}
		
	}else{
		//Linux
	}
}
?>