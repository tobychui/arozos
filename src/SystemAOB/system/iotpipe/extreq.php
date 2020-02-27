<?php
include_once("../../../auth.php");
function binarySelectExecution ($binaryName, $command){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        //Use windows binary
        $commandString = "start curl/" . $binaryName . ".exe " . $command;
		pclose(popen($commandString, 'r'));		
    } else {
        //Use linux binary
    	$cpuMode = exec("uname -m 2>&1",$output, $return_var);
    	switch(trim($cpuMode)){
    	    case "armv7l": //raspberry pi 3B+
    	    case "armv6l": //Raspberry pi zero w
    	            $commandString = "sudo ./curl/" . $binaryName . "_armv6l.elf " . $command; 
    	        break;
    	   case "aarch64": //Armbian with ARMv8 / arm64
    	            $commandString = "sudo ./curl/" . $binaryName . "_arm64.elf " . $command;
				break;
    	   case "i686": //x86 32bit CPU
    	   case "i386": //x86 32bit CPU
				$commandString = "sudo ./curl/" . $binaryName . "_i386.elf " . $command;
				break;
    	   case "x86_64": //x86-64 64bit CPU
    	            $commandString = "sudo ./curl/" . $binaryName . "_amd64.elf " . $command;
				break;
    	   default:
    	       //No idea why uname -m not working. In that case, x86 32bit binary is used.
    	            $commandString = "sudo ./curl/" . $binaryName . "_i386.elf " . $command;
				break;
		}
	    pclose(popen($commandString . " > null.txt 2>&1 &", 'r'));
    }
}

function syncBinarySelectExecution($binaryName, $command){
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        //Use windows binary
        $output = shell_exec("curl\\" . $binaryName . ".exe " . $command);
		return $output;
    } else {
        //Use linux binary
    	$cpuMode = exec("uname -m 2>&1",$output, $return_var);
    	switch(trim($cpuMode)){
    	    case "armv7l": //raspberry pi 3B+
    	    case "armv6l": //Raspberry pi zero w
    	            $output = shell_exec("sudo ./curl/" . $binaryName . "_armv6l.elf "); 
    	        break;
    	   case "aarch64": //Armbian with ARMv8 / arm64
    	            $output = shell_exec("sudo ./curl/" . $binaryName . "_arm64.elf " . $command);
				break;
    	   case "i686": //x86 32bit CPU
    	   case "i386": //x86 32bit CPU
				    $output = shell_exec("sudo ./curl/" . $binaryName . "_i386.elf " . $command);
				break;
    	   case "x86_64": //x86-64 64bit CPU
    	            $output = shell_exec("sudo ./curl/" . $binaryName . "_amd64.elf " . $command);
				break;
    	   default:
    	       //No idea why uname -m not working. In that case, x86 32bit binary is used.
    	            $output = shell_exec("sudo ./curl/" . $binaryName . "_i386.elf " . $command);
				break;
		}
	    return $output;
    }
}

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


//Provide api for the external access request
$port = 80;
if (file_exists("iotsettings.conf")){
	$scanInfo = json_decode(file_get_contents("iotsettings.conf"),true);
	$port = $scanInfo["port"];
}

if (!file_exists("req/")){
	mkdir("req/",0777,true);
}

if (isset($_GET['ipa']) && isset($_GET['subpath'])){
	//Create a new request.
	$outfilename = gen_uuid() . ".inf";
	binarySelectExecution("curl",'http://' . $_GET['ipa'] . ":" . $port . '/' . $_GET['subpath'] . ' -o "req/' . $outfilename .'"');
	echo $outfilename;
}else if (isset($_GET['getreq'])){
	//Get previous requested file.
	$outfilename = str_replace("../","",str_replace("/","",$_GET['getreq']));
	if (file_exists("req/" . $outfilename)){
		if (! @is_writable("req/" . $outfilename)){
			die("ERROR. Request ongoing.");
		}else{
			$content = file_get_contents("req/" . $outfilename);
			echo $content;
			unlink("req/" . $outfilename);
		}
		
	}else{
		die("ERROR. Request not found.");
	}
}else if (isset($_GET['getPort'])){
    //Read the port information from file and echo the result
    echo $port;    
}else if (isset($_GET['reqestRepeat'])){
    $targetURL = $_GET['reqestRepeat'];
    //Repeat the reqest to the target location and get its feedback
    echo syncBinarySelectExecution("curl","--max-time 10 http://" . $targetURL);
}




?>