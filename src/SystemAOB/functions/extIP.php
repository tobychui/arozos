<?php
include '../../auth.php';
?>
<?php
//Grab External IP Address from checkip.dydns.com and return as json
//Written for self identification purpose.
$externalContent = file_get_contents('http://checkip.dyndns.com/');
preg_match('/Current IP Address: \[?([:.0-9a-fA-F]+)\]?/', $externalContent, $m);
$externalIp = $m[1];
echo json_encode($externalIp);
header('Content-Type: application/json');
?>