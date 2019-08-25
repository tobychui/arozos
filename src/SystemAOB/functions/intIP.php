<?php
include '../../auth.php';
?>
<?php
//Grab the Internal IP Address of the system
$localIP = getHostByName(getHostName());
echo json_encode($localIP);
header('Content-Type: application/json');
?>