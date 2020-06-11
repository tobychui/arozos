<?php
include '../auth.php';
?>
<?php
//Remove Memo
$id = $_POST['id'];
$filename = $id . ".txt";
if (file_exists("memos/" . $filename)){
	unlink("memos/" .$filename);
	echo 'DONE';
	die();
}else if (file_exists("save/" . $filename)){
	unlink("save/" .$filename);
	echo 'DONE';
	die();
}
echo 'ERROR';
?>