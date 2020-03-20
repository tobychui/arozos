<?php
include_once("../../../../auth.php");

if (isset($_GET['clear'])){
    $builds = glob("./*.zip");
    foreach ($builds as $build){
        $removeSucc = unlink($build);
        if ( !$removeSucc && strtoupper(substr(PHP_OS, 0, 3) !== 'WIN')){
            //Unable to remove file. Try to use Terminal on Linux instead.
            $output = shell_exec("sudo rm " . $build);
        }elseif (!$removeSucc){
            //Remove file failed and it is on windows
            die("ERROR. Unable to remove file " . $build);
        }
    }
    echo "DONE";
    exit(0);
}

if (isset($_GET['changePermission'])){
    $output = shell_exec("sudo chmod 777 *.zip");
    echo $output;
}

function mv($var){
	if (isset($_GET[$var]) && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return "";
	}
}

if (!file_exists("../build_profile/")){
	mkdir("../build_profile/",0777,true);
}

if (mv("filename") == "" | mv("profile") == ""){
	die("ERROR. Missing filename or profile parameter.");
}else{
	$profile = mv("profile");
	$filename = strip_tags(mv("filename"));

	if (file_exists("../build_profile/" . $profile . ".config")){
		$profilePath = "../build_profile/" . $profile . ".config";
		//Create name config file
		if ($filename != "default"){
			file_put_contents("filename.config",$filename);
		}else{
			//Using default build code. Remove filename.config
			if (file_exists("filename.config")){
				unlink("filename.config");
			}
		}
		if (file_exists("../build.config")){
			unlink("../build.config");
		}
		copy($profilePath, "../build.config");
		if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
			//Running this on windows
			 $commandString = "start build_tool.exe"; 
			 pclose(popen($commandString, 'r'));
		}else{
			//Running on linux
			$cpuMode = exec("uname -m 2>&1",$output, $return_var);
			switch(trim($cpuMode)){
				case "armv7l": //raspberry pi 3B+
				case "armv6l": //Raspberry pi zero w
						die("ERROR. Please backup with SD card image software instead of using ArOZ Online internal build tool.");
					break;
			   case "aarch64": //Armbian with ARMv8 / arm64
			            //This will be slow, but it will works
						$commandString = "sudo ./build_tool_arm64.elf"; 
				   break;
			   case "i686": //x86 32bit CPU
			   case "i386": //x86 32bit CPU
					die("ERROR. Packing procedure require 64bit Operating System.");
			   case "x86_64": //x86-64 64bit CPU
						$commandString = "sudo ./build_tool_x86_64.elf"; 
				   break;
			   default:
				   //No idea why uname -m not working. In that case, x86 64bit binary is used.
						$commandString = "sudo ./build_tool_x86_64.elf"; 
				   break;
			}
			pclose(popen($commandString . " > build_log.txt 2>&1 &", 'r'));
		}
		echo "DONE";
		exit(0);
	}else{
		die("ERROR. Build profile not found.");
	}
}
?>