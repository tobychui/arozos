<?php
	header("Access-Control-Allow-Origin: *");
	
	if(strcasecmp(substr(PHP_OS, 0, 3), 'WIN') == 0){
		chdir("bin/");
		$executions = "smartctl.exe ";
	}else{
		if(strpos(exec('uname -m'), 'arm') !== false){
			$executions = "sudo ./smartctl_armv6";
		}else{
			$executions = "sudo ./smartctl_x86_64";
		}
	}
    $scanResult = json_decode(shell_exec($executions.' --scan -j'),true);
    //$scanResult = json_decode(fileread('scan.txt'),true);

    foreach($scanResult["devices"] as $drive){
        $execResult[$drive["name"]] = json_decode(shell_exec($executions.' -i '.$drive["name"].' -j -a'),true);
        //$execResult[$drive["name"]] = json_decode(fileread(explode("/",$drive["name"])[2].".txt"),true);
    }
	header('Content-Type: application/json');
    echo json_encode($execResult);

    function fileread($filepath){
        $handle = fopen($filepath, "r");
        $contents = fread($handle, filesize($filepath));
        fclose($handle);
        return $contents;
    }
?>
