<?php
include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//die('ERROR. Window not supported.');
	exec("getCPUTemp.exe",$out);
	echo $out[0];
}
$temp = exec('cat /sys/class/thermal/thermal_zone0/temp');
$temp = str_replace("\n","",$temp);
$temp = ((float) $temp) / 1000;
echo $temp;
//echo $temp . " ℃";
?>
