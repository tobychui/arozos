<?php
function binarySelectExecution ($binaryName, $command, $async=true){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        //Use windows binary
		if (!file_exists($binaryName . ".exe")){
			throw new Exception("Required binary not exists.");
		}
        $commandString = "start " . $binaryName . ".exe " . $command;
		if ($async){
			pclose(popen($commandString, 'r'));
		}else{
			return shell_exec($commandString);
		}
				
    } else {
        //Use linux binary
    	$cpuMode = exec("uname -m 2>&1",$output, $return_var);
    	switch(trim($cpuMode)){
    	    case "armv7l": //raspberry pi 3B+
    	    case "armv6l": //Raspberry pi zero w
					if (!file_exists($binaryName . "_armv6l.elf")){ throw new Exception("Required binary not exists."); }
    	            $commandString = "sudo ./" . $binaryName . "_armv6l.elf " . $command; 
    	        break;
    	   case "aarch64": //Armbian with ARMv8 / arm64
					if (!file_exists($binaryName . "_arm64.elf")){ throw new Exception("Required binary not exists."); }
    	            $commandString = "sudo ./" . $binaryName . "_arm64.elf " . $command;
				break;
    	   case "i686": //x86 32bit CPU
    	   case "i386": //x86 32bit CPU
				if (!file_exists($binaryName . "_i386.elf")){ throw new Exception("Required binary not exists."); }
				$commandString = "sudo ./" . $binaryName . "_i386.elf " . $command;
				break;
    	   case "x86_64": //x86-64 64bit CPU
					if (!file_exists($binaryName . "_amd64.elf")){ throw new Exception("Required binary not exists."); }
    	            $commandString = "sudo ./" . $binaryName . "_amd64.elf " . $command;
				break;
    	   default:
    	       //No idea why uname -m not working. In that case, x86 32bit binary is used.
    	            $commandString = "sudo ./" . $binaryName . "_i386.elf " . $command;
				break;
		}
		if ($async){
			pclose(popen($commandString . " > null.txt 2>&1 &", 'r'));
		}else{
			return shell_exec($commandString);
		}
	    
    }
}
?>