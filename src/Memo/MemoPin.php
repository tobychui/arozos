<?php
include '../auth.php';
?>
<?php
//Remove Memo
$id = $_POST['id'];
$filename = $id . ".txt";
if (file_exists("memos/" . $filename)){
	rename("memos/" . $filename, "save/" . $filename);
	echo 'DONE';
	die();
}
echo 'ERROR';
?>