<?php
include '../../../auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//die('ERROR. Window not supported.');
	exec("USB_list.exe",$out);
	sleep(1);
	$USBlist = fopen("WIN32_USBlist.txt", "r") or die($out);
	$result = explode(",",substr(fread($USBlist,filesize("WIN32_USBlist.txt")),3));
	fclose($USBlist);
	header('Content-Type: application/json');
	echo json_encode($result);
	//$result;
}else{
	$temp = shell_exec('lsusb');
	$temp = str_replace("\n",",",$temp);
	$host = explode(",",$temp);
	header('Content-Type: application/json');
	echo json_encode($host);
}
?>