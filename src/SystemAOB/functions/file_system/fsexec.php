<?php
include '../../../auth.php';

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

function array_basename($arr,$ext){
	$result = [];
	foreach ($arr as $item){
		array_push($result,basename($item,$ext));
	}
	return $result;
}

$acceptOprs = ["copy","copy_folder","move","move_folder","zip","unzip"];
if (isset($_GET['opr']) && $_GET['opr'] != ""){
	$opr = $_GET['opr'];
	//Check if the operation is supported
	if (!in_array($opr, $acceptOprs)){
		die("ERROR. Requested operation is not supported.");
	}
	
	if (in_array($opr,["zip","unzip"])){
		//Pass through to fszip for handling
		if (isset($_GET['from'])){
			//Only require input filepath. Use target if provided.
			$source = $_GET['from'];
			$target = "";
			if (isset($_GET['target'])){
				$target = $_GET['target'];
			}
			//Check if the source file exists.
			if (!file_exists($source)){
				die("ERROR. Source file not exists. " . $source . " given.");
			}
			$source = realpath($source);
			//Check if the target file already exists.
			if ($target != "" && $opr == "zip" && file_exists($target)){
				die("ERROR. Target file already exists.");
			}
			$command = json_encode([$opr,$source,$target]);
			$command = base64_encode($command);
			
			$uuid = str_replace(".","_",microtime(true));
			binarySelectExecution("fszip",$uuid . " " .$command);
			echo $uuid;
			exit(0);
			
		}
	}else{
		//Pass through to fsexec for handling
		//Get the source and target variabe
		if (isset($_GET['from']) && isset($_GET['target'])){
			$source = $_GET['from'];
			$target = $_GET['target'];
			//Check if the source file exists.
			if (!file_exists($source)){
				//Check for AOR starting paths
				if (file_exists("../../../" . $source)){
					$source = "../../../" . $source;
					if (substr($target,0,1) !== "/"){
						//Not real path. Add AOR relative to target too
						$target = "../../../" . $target;
					}
				}else{
					die("ERROR. Source file not exists. " . $source . " given.");
				}
			}
			//Check if the target file already exists.
			if (file_exists($target)){
				die("ERROR. Target file already exists.");
			}
			//Check if the target is not inside the source to prevent inifite recursive blackhole
			if (strpos(dirname($target),$source) !== false){
				die("ERROR. Recursive file operation.");
			}

			//Everything seems ok. Start new process to perform file operations
			$command = json_encode([$opr,$source,$target]);
			$command = base64_encode($command);
			$uuid = str_replace(".","_",microtime(true));
			binarySelectExecution("fsexec",$uuid . " " .$command);
			
			echo $uuid;
			exit(0);
		}else{
			die("ERROR. from or target paramter not set.");
		}
	}
	
}else if (isset($_GET['listen']) && $_GET['listen'] != ""){
	//Listen to the IDs given in the listen parameter
	$idList = json_decode($_GET['listen']);
	$progressing = array_basename(glob("log/*.log"),".log");
	$done = array_basename(glob("log/done/*.log"),".log");
	$error = array_basename(glob("log/error/*.log"),".log");
	$results = [];
	foreach ($idList as $id){
		if (in_array($id,$progressing)){
			array_push($results,[$id,"in-progress"]);
		}else if (in_array($id,$done)){
			array_push($results,[$id,"done"]);
		}else if (in_array($id,$error)){
			array_push($results, [$id,"error"]);
		}else{
			array_push($results, [$id,"null"]);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($results);
}else{
	die("ERROR. Undefined file operations.");
}

?>