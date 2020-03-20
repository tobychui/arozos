<?php
/*
ArOZ Online Auth Script
This script is designed to provide all auth function for the whole ArOZ Online System
Please do not modify this script unless you know what you are doing.

CopyRight ArOZ Online Project feat. IMUS Laboratory, All right reserved.
Developed by Toby Chui since 2016
*/

//Uncomment the following line for emergency terminating all services on ArOZ Online System
//header("HTTP/1.0 503 Service Unavailable"); echo "<p>ArOZ Online System on this site has been emergency shut down by system administrator.</p>"; exit(0);
header('aoAuth: v1.0');
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}
//Auth System Settings. DO NOT TOUCH THESE VALUES
$maxAuthscriptDepth = 32;
$sysConfigDir = ""; //Remember to end with "/"

//You can get the following variable from any script that included this auth script.
/*
$sysConfigDir --> Location of the ArOZ Online Storage Directory, usually C:/AOB/ on Windows or /etc/AOB/ on Linux
$rootPath --> Relative directory to root, in backslash format (aka ../)
*/
function checkIfCookieSeedsMatch($seedsbank,$cookieString){
	$data = explode("_",$cookieString);
	$timestamp = $data[0];
	$seedfile = $seedsbank . $timestamp . '.auth';
	if (time() > $timestamp){
		if (file_exists($seedfile)){
			//This session has been expired. Remove the session from server side
			unlink($seedfile);
		}
		return false;
	}
	$seeds = $data[1];
	
	if (file_exists($seedfile)){
		$seedvalue = file_get_contents($seedfile);
		if ($seedvalue == $seeds){
			return true;
		}else{
			return false;
		}
	}else{
		return false;
	}
}


$databasePath = "";
if ($sysConfigDir == ""){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		$sysConfigDir = "C:/AOB/";
	}else{
		$sysConfigDir = "/etc/AOB/";
	}
}else{
	//This system use a specially configured root location. Append that to system root.inf if this is launched on the root location.
	if(file_exists("root.inf")){
		file_put_contents("root.inf",$sysConfigDir);
	}
}

$databasePath = $sysConfigDir . "whitelist.config";
$seedsbank = $sysConfigDir . "cookieseeds/";

if (file_exists($seedsbank) == false){
	if (!@mkdir($seedsbank,0777,true)){
	    //mkdir failed. Try to override it with sudo permission if on linux.
	    if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	        die("ERRPR. Unable to write to directory: " . $seedsbank);
	    }else{
	        exec('sudo mkdir "' . realpath($seedsbank) . '"');
	        exec('sudo chmod 777 "' . realpath($seedsbank) . '"');
	    }
	}
}


if (isset($_POST['username']) && isset($_POST['apwd']) && isset($_POST['rmbm'])){
	$loginContent = file_get_contents($databasePath);
	$loginContent = explode("\n",$loginContent);
	$rememberMe = $_POST['rmbm'];
	if ($rememberMe == "on"){
		//There might be auto login. Check if the password field matched any seed first.
		if (checkIfCookieSeedsMatch($seedsbank,$_POST['apwd'])){
			//Update the current cookies
			$cookieExpireTime = time()+ 172800;
			setcookie("username",$_POST["username"],$cookieExpireTime );
			$password = $_POST["apwd"];
			$rndnum = rand(10000000, 90000000);
			$seedString = hash("sha512",$password . $rndnum);
			setcookie("password",$cookieExpireTime . "_" . $seedString,$cookieExpireTime);
			file_put_contents($seedsbank . $cookieExpireTime . '.auth',$seedString);
			$_SESSION['login'] = $_POST["username"];
			echo "DONE. Login suceed.";
			exit();
		}
		$rememberMe = true;
	}else{
		$rememberMe = false;
	}
	
	$cookieContent = "";
	if ($rememberMe){
		setcookie("username",$_POST["username"],time()+ 172800 );
		//Updates in 28-9-2018, removed raw password storage in cookie (who the hell think of this in the first place lol)
		//setcookie("password",$_POST["apwd"],time()+ 172800 );
		$cookieExpireTime = time()+ 172800;
		$password = $_POST["apwd"];
		$rndnum = rand(10000000, 90000000);
		if ($password == ""){
			echo "ERROR. Password cannot be empty.";
			exit();
		}
		$seedString = hash("sha512",$password . $rndnum);
		$cookieContent = $seedString;
	}else{
		setcookie("username","",time()+ 172800);
		setcookie("password","",time()+ 172800);
	}
	foreach ($loginContent as $registedUserData){
		if ($registedUserData != ""){
			$chunk = explode(",",$registedUserData);
			$username = $chunk[0];
			$hasedpw = $chunk[1];
			if ($username == $_POST['username']){
				$hashedInput = hash('sha512', $_POST['apwd']);
				if (trim(strtoupper($hasedpw)) == trim(strtoupper($hashedInput))){
					//Login suceed
					$_SESSION['login'] = $username;
					if ($rememberMe && $cookieContent != ""){
						//Store the cookie to browser as well as the server side for future access
						setcookie("password",$cookieExpireTime . "_" . $cookieContent,time()+ 172800);
						file_put_contents($seedsbank . $cookieExpireTime . '.auth',$cookieContent);
					}
					echo "DONE. Login suceed.";
					if (isset($_POST['redirect'])){
						//Redirect before exit
						header("Location: " . $_POST['redirect']);
					}
					if (isset($_POST['legacyMode'])){
						//Visiting site with legacy mode. Ignore cookie updates.
						$_SESSION['legacyMode'] = true;
					}
					exit();
				}else{
					echo "ERROR. Password incorrect";
					exit();
				}
			}
		}
		
	}
	echo "ERROR. Username not find.";
	exit();
}

if (file_exists($databasePath)){
	//$actual_link = "http://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]";
	$rootPath = "";
	if (file_exists("root.inf")){
		//The script is running on the root folder
	}else{
		//The script is not running on the root folder, find upward and see where is the root file is placed.
		for ($x = 0; $x <= $maxAuthscriptDepth; $x++) {
			if (file_exists($rootPath . "/root.inf")){
				break;
			}else{
				$rootPath = $rootPath . "../";
			}
		} 
	}
	//Get the number of layers this script is below root
	if ($rootPath == ""){
		$layers = 1;
	}else{
		$layers = count(explode("../",$rootPath));
	}
	header("aoRoot: " . $rootPath);
	//Resolve the link and use it as redirection
	$uri = $_SERVER['REQUEST_URI'];
	$paramter = "";
	if (strpos($uri,"?") !== false){
		$tmp = explode("?",$uri);
		$uri = array_shift($tmp);
		$paramter = implode("?",$tmp);
	}
	//Resolve the relative uri segment from webroot
	$uri = explode("/",$uri);
	$validURISegment = [];
	for ($i=0; $i < $layers; $i++){
		array_push($validURISegment,array_pop($uri));
	}
	$validURISegment = array_reverse($validURISegment);
	$validURISegment = implode("/",$validURISegment);
	$actual_link = $validURISegment . "?" . $paramter;
	
if (session_id() == '' || !isset($_SESSION['login']) || $_SESSION['login'] == "") {
	//echo $actual_link;
	//header('Location: ' . $rootPath .'login.php?target=' . str_replace("&","%26",$actual_link));

	header('Location: ' . $rootPath .'login.php?target=' . urlEncodeRFC3986($actual_link));
	exit();
}else{
	//session exists. Let the user go through with updates cookie
	if (isset($_COOKIE['username']) && $_COOKIE['username'] != "" && !isset($_SESSION['legacyMode'])) {
		setcookie("username",$_COOKIE["username"],time()+ 172800 );
		setcookie("password",$_COOKIE["password"],time()+ 172800 );
	}else if ($_SESSION['legacyMode']){
		//Visiting the site with legacy mode. Continue to location without updating cookies
		
	}else{
		//cookie expired. Request for another update with login
		$_SESSION['login'] = "";
		//header('Location: ' . $rootPath .'login.php?target=' . str_replace("&","%26",$actual_link));
		header('Location: ' . $rootPath .'login.php?target=' . urlEncodeRFC3986($actual_link));
		exit();
	}
	
}
}else{
	//Database file do not exists. As the user to create one
	header("Location: regi.php");
	exit();
	
}

function urlEncodeRFC3986($string) {
    $entities = array('%21', '%2A', '%27', '%28', '%29', '%3B', '%3A', '%40', '%26', '%3D', '%2B', '%24', '%2C', '%2F', '%3F', '%25', '%23', '%5B', '%5D');
    $replacements = array('!', '*', "'", "(", ")", ";", ":", "@", "&", "=", "+", "$", ",", "/", "?", "%", "#", "[", "]");
    return str_replace($entities, $replacements, urlencode($string));
}
?>
