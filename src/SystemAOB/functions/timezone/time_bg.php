<?php
include '../../../auth.php';
?>
<?php
$result = [];
if(isset($_GET["opr"]) == false){
	$result["return"] = "500";
	echo json_encode($result);
	die();
}
if($_GET["opr"] == "query"){


if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
$result["timezone"] = exec("tzutil /g");
$result["fulltime"] = exec('getTime.exe');
$result["time"] =  explode(" ",exec('getTime.exe'))[1]." ".explode(" ",exec('getTime.exe'))[2];

} else {
$result["timezone"] = exec("cat /etc/timezone");
$result["fulltime"] = exec('date +"%a %Y-%m-%d %T %Z %z"');
$result["time"] = exec('date +"%Y-%m-%d %T"');
}


}else if($_GET["opr"] == "edit"){
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		$tz_win = '';
		$tz = json_decode(file_get_contents('data/wintz.json'));
		foreach($tz->{"supplementalData"}->{"windowsZones"}->{"mapTimezones"}->{"mapZone"} as $item){
		if($item->{"_type"} == $_GET["timezone"]){
			$tz_win = $item->{"_other"};
		};
		}
		$result["newtimezone"] = $tz_win;
		exec('tzutil /s "'.$tz_win.'"');
		$result["return"] = "200";
	} else {
		exec("sudo timedatectl set-timezone '".$_GET["timezone"]."'");
		$result["return"] = "200";
	}
	
}
echo json_encode($result);
?>