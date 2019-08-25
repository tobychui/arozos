 <?php
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-cache');
header('Access-Control-Request-Headers: *');
header('Access-Control-Allow-Headers: Content-Type');
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

$config_path = "/etc/AOB/";
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	$config_path = "C:/AOB/";
}
if (file_exists("root.inf") && filesize("root.inf") > 0){
	$config_path = trim(file_get_contents("root.inf"));
}
$uuid = "win";
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//if this system is running under Windows environment
	if (!file_exists($config_path)) {
		mkdir($config_path, 0777, true);
	}
	if (!file_exists($config_path . "device_identity.config")){
		$configFile = fopen($config_path . "device_identity.config", "w") or die("Permission Error.");
		$uuid = gen_uuid();
		fwrite($configFile, $uuid);
		fclose($configFile);
	}else{
		$uuid = file_get_contents($config_path . "device_identity.config");
	}
	
	
}else{
	//if this system is running under linux environment
	if (file_exists($config_path) && file_exists($config_path . "device_identity.config")){
		$uuid = file_get_contents($config_path . "device_identity.config");
	}else{
		$reuslt = '';
		system('sudo mkdir /etc/AOB/', $result);
		system('sudo chmod 777 /etc/AOB/', $result);
		$configFile = fopen($config_path . "device_identity.config", "w") or die("Permission Error.");
		$uuid = gen_uuid();
		fwrite($configFile, $uuid);
		fclose($configFile);
	}
}

echo "AOBP,Alive," . $uuid  . "," . $_SERVER['SERVER_ADDR'];
 ?>