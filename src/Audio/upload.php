<?php
include '../auth.php';
?>
<?php 

if(isset($_FILES['file']) and !$_FILES['file']['error']){
    $fname = $_GET['filename'];
    move_uploaded_file($_FILES['file']['tmp_name'], "./" . $fname);
}
?>