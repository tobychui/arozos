<?php
include '../../../auth.php';
?>
<?php
//base64 Decoder for server side encoding matching
if ( base64_encode(base64_decode($_GET['var'])) === $data){
} else {
    die("ERROR, not base64 encoded data.");
}
header('Content-Type: application/json');
echo json_encode(base64_decode($_GET['var']));

?>