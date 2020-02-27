<?php
//ArOZ Online Cluster Information Pipelining Script
//This is a script to replace the old requestInfo.php for faster ping and information get using golang as backstage adapter.
//Usage: /getInfo.php?ipaddr=192.168.0.100 --> uuid
//       /getInfo.php?listen=uuid --> {false if the file not exists yet; data in JSON format if file already exists}
//(Compatible Mode) /getInfo.php?ipaddr=192.168.0.100&force-sync --> wait until the file for the scanning returned. DO NOT USE THIS AS THIS WILL BLOCK OTHER REQUEST
include_once("../../../auth.php");
set_time_limit(5);
ini_set('max_execution_time', 5);
ini_set("default_socket_timeout", 5);
error_reporting(0);
ini_set('display_errors', 0);
include_once("clusterSettingLoader.php");

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

if (isset($_GET["ipaddr"]) && $_GET["ipaddr"] != ""){
    $ip = $_GET["ipaddr"];
    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
        //Use windows binary
        $outfilename = gen_uuid();
        $commandString = "start aoc-getinfo.exe $ip " . " " . $clusterSetting["port"] . " " . $clusterSetting["prefix"] . " " . $outfilename; 
	    //echo $commandString . '<br>';
	    pclose(popen($commandString, 'r'));
	    if (isset($_GET['force-sync'])){
            while (!file_exists("tmp/" . $outfilename . ".txt")){
               sleep(1);
            }
            if (file_exists("tmp/" . $outfilename . ".txt")){
                $content = file_get_contents("tmp/" . $outfilename . ".txt");
                $lines = explode("\n",$content);
                header('Content-Type: application/json');
                echo json_encode($lines);
                unlink("tmp/" . $outfilename . ".txt");
            }
	    }else{
	        echo $outfilename;
	    }
	    exit(0);
    } else {
        //Use linux binary
    	$outfilename = gen_uuid();
    	$cpuMode = exec("uname -m 2>&1",$output, $return_var);
    	switch(trim($cpuMode)){
    	    case "armv7l": //raspberry pi 3B+
    	    case "armv6l": //Raspberry pi zero w
    	            $commandString = "sudo ./aoc-getinfo_armv6l.elf $ip " . " " . $clusterSetting["port"] . " " . $clusterSetting["prefix"] . " " . $outfilename; 
    	        break;
    	   case "aarch64": //Armbian with ARMv8 / arm64
    	            $commandString = "sudo ./aoc-getinfo_arm64.elf $ip " . " " . $clusterSetting["port"] . " " . $clusterSetting["prefix"] . " " . $outfilename; 
    	       break;
    	   case "i686": //x86 32bit CPU
    	   case "i386": //x86 32bit CPU
    	   case "x86_64": //x86-64 64bit CPU
    	            $commandString = "sudo ./aoc-getinfo_amd64.elf $ip " . " " . $clusterSetting["port"] . " " . $clusterSetting["prefix"] . " " . $outfilename; 
    	       break;
    	   default:
    	       //No idea why uname -m not working. In that case, x86 32bit binary is used.
    	            $commandString = "sudo ./aoc-getinfo_i386.elf $ip " . " " . $clusterSetting["port"] . " " . $clusterSetting["prefix"] . " " . $outfilename; 
    	       break;
    	}
        //$commandString = "sudo ./aoc-getinfo_i386 $ip " . " " . $clusterSetting["port"] . " " . $clusterSetting["prefix"] . " " . $outfilename; 
	    //echo $commandString . '<br>';
	    pclose(popen($commandString . " > null.txt 2>&1 &", 'r'));
	    if (isset($_GET['force-sync'])){
            while (!file_exists("tmp/" . $outfilename . ".txt")){
               sleep(1);
            }
            if (file_exists("tmp/" . $outfilename . ".txt")){
                $content = file_get_contents("tmp/" . $outfilename . ".txt");
                $lines = explode("\n",$content);
                header('Content-Type: application/json');
                echo json_encode($lines);
                unlink("tmp/" . $outfilename . ".txt");
            }
	    }else{
	        echo $outfilename;
	    }
	    exit(0);
    }
}

if (isset($_GET["listen"]) && $_GET["listen"] != ""){
    //Javascript function for checking if the result returned yet. It should be quite fast normally.
    if (file_exists("tmp/" . $_GET["listen"] . ".txt")){
        $content = file_get_contents("tmp/" . $_GET["listen"] . ".txt");
        $lines = explode("\n",$content);
        header('Content-Type: application/json');
        echo json_encode($lines);
        unlink("tmp/" . $_GET["listen"] . ".txt");
    }else{
        die("false");
    }
    
    
}

?>