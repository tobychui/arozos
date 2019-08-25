<?php
include '../auth.php';
?>
<?php
//background Image counting script for Ajax Call
$bgcount = 0;
if (isset($_GET['theme']) && $_GET['theme'] != ""){
	$bgs = glob("img/bg/".$_GET['theme']."/*.{jpg,gif,png}" , GLOB_BRACE);
	$bgNum = count($bgs);
	$bgcount = $bgNum;
}else{
	$bgcount = 1;
}
$bgs = glob("img/bg/".$_GET['theme']."/*.*");
$ext = pathinfo($bgs[0], PATHINFO_EXTENSION);
header('Content-Type: application/json');
echo json_encode([$bgcount,$ext]);

?>