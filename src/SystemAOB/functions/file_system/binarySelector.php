<?php
/*
ArOZ Online File System Binary Selector
--------------------------------------------------
This is a simple function to select the suitable binary for your operating system.
Call with binarySelectExecution("{binary_filename}","{command following the binary}");

*/
function binarySelectExecution ($binaryName, $command){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        //Use windows binary
        $commandString = "start " . $binaryName . ".exe " . $command;
		pclose(popen($commandString, 'r'));		
    } else {
        //Use linux binary
    	$cpuMode = exec("uname -m 2>&1",$output, $return_var);
    	switch(trim($cpuMode)){
    	    case "armv7l": //raspberry pi 3B+
    	    case "armv6l": //Raspberry pi zero w
    	            $commandString = "sudo ./" . $binaryName . "_armv6l.elf " . $command; 
    	        break;
    	   case "aarch64": //Armbian with ARMv8 / arm64
    	            $commandString = "sudo ./" . $binaryName . "_arm64.elf " . $command;
				break;
    	   case "i686": //x86 32bit CPU
    	   case "i386": //x86 32bit CPU
				$commandString = "sudo ./" . $binaryName . "_i386.elf " . $command;
				break;
    	   case "x86_64": //x86-64 64bit CPU
    	            $commandString = "sudo ./" . $binaryName . "_amd64.elf " . $command;
				break;
    	   default:
    	       //No idea why uname -m not working. In that case, x86 32bit binary is used.
    	            $commandString = "sudo ./" . $binaryName . "_i386.elf " . $command;
				break;
		}
	    pclose(popen($commandString . " > null.txt 2>&1 &", 'r'));
    }
}

function asyncBinarySelectExecution ($binaryName, $command){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        //Use windows binary
        $commandString = $binaryName . '.exe ' . $command;
		$output = shell_exec($commandString);
		return $output;
    } else {
        //Use linux binary
    	$cpuMode = exec("uname -m 2>&1",$output, $return_var);
    	switch(trim($cpuMode)){
    	    case "armv7l": //raspberry pi 3B+
    	    case "armv6l": //Raspberry pi zero w
    	            $commandString = "sudo ./" . $binaryName . "_armv6l.elf " . $command; 
    	        break;
    	   case "aarch64": //Armbian with ARMv8 / arm64
    	            $commandString = "sudo ./" . $binaryName . "_arm64.elf " . $command;
				break;
    	   case "i686": //x86 32bit CPU
    	   case "i386": //x86 32bit CPU
				$commandString = "sudo ./" . $binaryName . "_i386.elf " . $command;
				break;
    	   case "x86_64": //x86-64 64bit CPU
    	            $commandString = "sudo ./" . $binaryName . "_amd64.elf " . $command;
				break;
    	   default:
    	       //No idea why uname -m not working. In that case, x86 32bit binary is used.
    	            $commandString = "sudo ./" . $binaryName . "_i386.elf " . $command;
				break;
		}
	    $output = shell_exec($commandString);
		return $output;
    }
}
?>