<?php
ini_set('max_execution_time', 5);
include_once("../auth.php");

if (isset($_GET['logCode'])){
	$logCode = $_GET['logCode'];
	if (file_exists("log/" . $logCode . ".log")){
		$LastLine = readlastline("log/" . $logCode . ".log");
		if (trim($LastLine) == ""){
			die("DONE");
		}
		$rll = strrpos($LastLine,"frame=");
		if ($rll == false){
			$rll = strrpos($LastLine,"bitrate=");
		}
		$rll = substr($LastLine, $rll, strlen($LastLine) - $rll);
		$ril = trim($rll);
		die($ril);
	}else{
		die("ERROR. File not found.");
	}
}

function readlastline($file) 
{ 
		/*
       $fp = @fopen($file, "r"); 
       $pos = -1; 
	   $end = -2;
       $t = " "; 
       while ($t != "\r" || $end != 0) { 
             fseek($fp, $pos, SEEK_END); 
             $t = fgetc($fp);
			 if ($t == "\r"){
				 $end++;
			 }
             $pos = $pos - 1; 
       }
       $t = fgets($fp); 
       fclose($fp); 
       return $t; 
	   */
	$lastLine = trim(implode("", array_slice(file($file), -1)));
	return $lastLine;
} 


?>