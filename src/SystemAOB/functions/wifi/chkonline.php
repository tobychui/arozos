<?php
include '../../../auth.php';
?>
<?php
if (@file_get_contents("https://api.ipify.org?format=json") === false) {
    echo 'false';
    die();
}
$json = file_get_contents("https://api.ipify.org?format=json");
header('Content-type: application/json');
echo $json;
?>