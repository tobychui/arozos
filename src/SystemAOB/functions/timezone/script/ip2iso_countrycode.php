<?php
include '../../../../auth.php';
?>
<?php
$dbipcsv = "../data/dbip-country-2018-06.csv";
$ip = $_GET["ip"];


$data = "Not found";


$csvData = file_get_contents($dbipcsv);
$lines = explode(PHP_EOL, $csvData);
$rangeArray = array();



foreach ($lines as $line) {
    //$rangeArray[] = str_getcsv($line);
	$current = str_getcsv($line);
	
$array_start = explode(".", $current['0']);
$array_stop = explode(".", $current['1']);

if(ip2long($ip)>=ip2long($current[0])&&ip2long($ip)<=ip2long($current[1])){
$data = $current[2];
break;
}
	
}

header('Content-Type: application/json');
echo '"'.$data.'"';

?>