<?php
include_once '../auth.php';
function mv($var){
	if (isset($_GET[$var]) && $_GET[$var] != ""){
		return $_GET[$var];
	}
	return "";
}

function getExt($filepath){
	return pathinfo($filepath, PATHINFO_EXTENSION);
}

function buildBatFile($ffmpegPath,$command){
	$date = new DateTime();
	$timestamp = $date->getTimestamp();
	$content = 'CD /D "' . realpath("./") . '"' . PHP_EOL; //cd to the path that the user currently working
	$content = $content . '"' . $ffmpegPath . '" '; //Generate ffmpeg path from realpath
	$content = $content . trim($command) . " -y"; //Append command into the bat file
	$content = $content . " > log\\" . $timestamp . ".log 2>&1" . PHP_EOL; //Export the log to log folder
	$content = $content . 'del "%~f0"';//Allow script self destruct after use
	file_put_contents("tmp/" . $timestamp . ".bat",$content);
	return $timestamp;
}

function buildBashFile($command){
    $date = new DateTime();
	$timestamp = $date->getTimestamp();
	$content = "#!/bin/bash" . PHP_EOL;
	$osname = shell_exec("lsb_release -a | grep Distributor");
	$osname = trim(array_pop(explode(":",$osname)));
    $osRelease = shell_exec("lsb_release -a | grep Release");
    $osRelease = trim(array_pop(explode(":",$osRelease)));
	if (strpos($osname,"Ubuntu") !== false){
	    //Ubuntu
	    $content = $content ."ffmpeg" . " " . trim($command) . " > /dev/null 2>log/" . $timestamp . ".log &" . PHP_EOL;
	}else if(strpos($osname,"Debian") !== false && (strpos($osRelease,"10") !== false || strpos($osRelease,"9.9") !== false)){
	    //Debian 10, which use ffmpeg instead of avconv lib
	    $content = $content ."ffmpeg" . " " . trim($command) . " > /dev/null 2>log/" . $timestamp . ".log &" . PHP_EOL;
	}else if(strpos($osname,"Raspbian") !== false && strpos($osRelease,"10") !== false){
	    //Rasbian 10, also based on Debian 10
	    $content = $content ."ffmpeg" . " " . trim($command) . " > /dev/null 2>log/" . $timestamp . ".log &" . PHP_EOL;
	}else{
	    //Debian 
	    $content = $content ."avconv" . " " . trim($command) . " > /dev/null 2>log/" . $timestamp . ".log &" . PHP_EOL;
	}
	$content = $content . 'rm -- "$0"';
	file_put_contents("tmp/" . $timestamp . ".sh",$content);
	return $timestamp;
}

function checkOutfileExists($command){
	//Check if the command and the given variables are correct.
	$commandArray = parseCommand($command);
	$files = [];
	foreach ($commandArray as $commandChunk){
		$commandChunk = trim($commandChunk);
		if (file_exists($commandChunk) && !in_array($commandChunk, $files)){
			//This is the source file. Record it in files.
			array_push($files,$commandChunk);
		}else if (in_array($commandChunk, $files)){
			//This is a file and it have been duplicated in this command.			
			return true;
		}
	}
	return false;
}

function parseCommand($command){
	$array = str_split($command);
	$converted = "";
	$insideBracket = false;
	foreach ($array as $char) {
		if ($char == '"'){
				$insideBracket = !$insideBracket;
		}else if ($char == " "){
			if 	($insideBracket){
				$converted = $converted . "%20";
			}else{
				$converted = $converted . " ";
			}
		}else{
			$converted = $converted . $char;
		}
	}
	$array = explode(" ",$converted);
	$command = [];
	foreach ($array as $chunk){
		$chunk = str_replace("%20"," ",$chunk);
		array_push($command,$chunk);
	}
	return $command;
}
if (mv("command") != ""){
	if ( base64_encode(base64_decode(mv("command"), true)) === mv("command")){
		$command = base64_decode(mv("command"));
	}else{
		die("ERROR. Invalid command encoding. " .  base64_decode(mv("command")) . " given." );
	}
	
}else{
	die("ERROR. Undefined parameter: command");
}

function rebuildCommand($command){
	//Rebuild the command if duplicated outfilename is found.
	$commandArray = parseCommand($command);
	$files = [];
	$newCommandArray = [];
	foreach ($commandArray as $commandChunk){
		$commandChunk = trim($commandChunk);
		if (file_exists($commandChunk) && !in_array($commandChunk, $files)){
			//This is the source file. Record it in files.
			array_push($files,$commandChunk);
		}else if (in_array($commandChunk, $files)){
			//This is a file and it have been duplicated in this command.
			$filepath = explode(".",$commandChunk);
			$fileExt = array_pop($filepath);
			$fileHead = implode(".",$filepath);
			if (strpos($commandChunk,"/inith") !== false){
				//This is umfilename
				$commandChunk = $fileHead . "5f636f6e76." . $fileExt;
			}else{
				//This is normal filename
				$commandChunk = $fileHead . "_conv." . $fileExt;
			}
		}
		array_push($newCommandArray,$commandChunk);
	}
	return implode(" ",$newCommandArray);
	//var_dump($newCommandArray);
}

if (checkOutfileExists($command) == true){
	//The output file already exists. Rebuild the command with postfix to fix the problem.
	$command = rebuildCommand($command);
}
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    //Running on Windows Hosts
	if (file_exists("ffmpeg-4.0.2-win32-static/bin/ffmpeg.exe")){
		$ffmpegPath = realpath("ffmpeg-4.0.2-win32-static/bin/ffmpeg.exe");
		$filename = buildBatFile($ffmpegPath,$command);
		$filepath = realpath("tmp/" . $filename . ".bat");
		pclose(popen('start /low /B cmd /C "' . $filepath . '"', 'r'));
		sleep(1);
		echo ("DONE," . $filename);
	}else{
		die("ERROR. FFmpeg binary not found.");
	}
} else {
	//Running on Linux Hosts
	$filename = buildBashFile($command);
	$filepath = realpath("tmp/" . $filename . ".sh");
	shell_exec('bash "' . $filepath . '"'); 
	sleep(1);
	echo ("DONE," . $filename);
}

?>