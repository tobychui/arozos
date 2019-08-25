<?php
/*
ArOZ Online JSON Web Token Generator
WARNING! This generator is designed to be used with AROZ Online System and it is critical for the security of the system
DO NOT CHANGE ANYLINE / COPY AND PASTE ANYTHING FROM THE INETERNET TO THIS SCRIPT IF YOU DO NOT KNOW WHAT YOU ARE DOING.
*/
require_once(__DIR__ . '/jwt.php');

//function for generating uuidv4
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

function createToken(){
	//User pass through standard authentication. Start JWT creation process.
	$username = $_SESSION['login']; //Username of the current user
	$signDevice = "unknown";

	//File location definations
	$keyFileLocation = $sysConfigDir . "serverkey/deviceKey.akey";
	//Try to get device UUID from the system configuration directory
	if (file_exists($sysConfigDir . "device_identity.config")){
		$signDevice = trim(file_get_contents($sysConfigDir . "device_identity.config"));
	}

	//Check if server key exists. If no, create one.
	if (!file_exists(dirname($keyFileLocation))){
		mkdir($sysConfigDir . "serverkey/",0755,true);
	}
	$serverKey = "";
	if (!file_exists($keyFileLocation)){
		//key file not exists. Create one for it.
		$serverKey = gen_uuid() . gen_uuid();
		file_put_contents($keyFileLocation,$serverKey);
	}else{
		//Key exists. Load key from file
		$serverKey = trim(file_get_contents($sysConfigDir . "serverkey/deviceKey.akey"));
	}

	$noExpire = false;
	$expTime = 3600; //Default expire after 1 hour
	if(isset($_GET['exp'])){
		$userDefineExpTime = $_GET['exp'];
		if (!is_numeric($userDefineExpTime)){
			die("ERROR. Expire Time must be an Integer in seconds.");
		}
		if ($userDefineExpTime <= 0){
			//Unlimited
			$noExpire = true;
			$expTime = 0;
		}else{
			$expTime = $userDefineExpTime;
		}
	}
				

	//Create a token
	$payloadArray = array();
	$payloadArray['user'] = $username; //Username
	$payloadArray['sgd'] = $signDevice; //Signed Device
	$payloadArray['crd'] = time(); //Creation Datetime
	if ($expTime != 0){
		$payloadArray['exp'] = time() + $expTime;//Expire datetime since the original timestamp
	}
	$token = JWT::encode($payloadArray, $serverKey);


	//Create backup for generated token for validation
	$hashedToken = hash("sha512",$token);
	if (!file_exists("tokenDB/")){
		mkdir("tokenDB/");
	}
	//Only store the hashed name of the token, the creation timestamp and expire time.
	file_put_contents("tokenDB/" . $hashedToken . ".atok",json_encode([$hashedToken,$payloadArray['crd'],$expTime]));

	//Return token to caller
	$returnArray = array('token' => $token);
	$jsonEncodedReturnArray = json_encode($returnArray, JSON_PRETTY_PRINT);
	header('Content-Type: application/json');
	echo $jsonEncodedReturnArray;
}


