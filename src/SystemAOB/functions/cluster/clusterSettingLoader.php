<?php
if (file_exists("clusterSetting.config") && !isset($_GET['json'])){
	$content = file_get_contents("clusterSetting.config");
	$data = json_decode( preg_replace('/[\x00-\x1F\x80-\xFF]/', '', $content), true );
	$clusterSetting = $data;
}else if (isset($_GET['json'])){
    include_once("../../../auth.php");
    $content = file_get_contents("clusterSetting.config");
	$data = json_decode( preg_replace('/[\x00-\x1F\x80-\xFF]/', '', $content), true );
	header('Content-Type: application/json');
    echo json_encode($data);
}else{
	die("ERROR. clusterSetting.config not found.");
}
?>