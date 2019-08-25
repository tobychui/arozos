<?php
include '../../../auth.php';
?>
<?php
//Clean.php, cleaning all the process in the process folder.
sleep(6);
$process = glob("process/*.log");
foreach ($process as $target){
	$contents = file_get_contents($target);
	$vars = explode(",",$contents);
	$output = shell_exec("sudo kill " . $vars[0]);
	echo "Killed: " . $vars[0] . "<br>";
	unlink($target);
}
echo "DONE";
?>
