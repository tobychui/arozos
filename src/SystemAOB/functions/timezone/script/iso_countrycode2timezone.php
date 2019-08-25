<?php
include '../../../../auth.php';
?>
<?php
$dbipcsv = "../data/timezone.csv";
$timezone = $_GET["timezone"];


$data = [];


$csvData = file_get_contents($dbipcsv);
$lines = explode(PHP_EOL, $csvData);
$rangeArray = array();



foreach ($lines as $line) {
    //$rangeArray[] = str_getcsv($line);
	$current = str_getcsv($line);
	

if($timezone == $current['0']){
array_push($data,$current[1]);
}
	
}

header('Content-Type: application/json');
echo json_encode($data);

?>