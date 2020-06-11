<?php
include '../auth.php';
?>
<?php
$storage = "memos/";
$id = $_POST['id'];
$content = $_POST['content'];
$title = $_POST['title'];
$bgcolor = $_POST['bgcolor'];
$fontcolor = $_POST['fontcolor'];
$username = $_POST['username'];
//Get the number of memo in storage
$maxnum = 0;

$num = $maxnum + 1; //New file named as +1 of the prvious memo
$memofile = fopen($storage . $id . ".txt", "w") or die("Unable to open file!");
$txt = $title . "\n";
$txt .= $username . "\n";
$txt .= $bgcolor . "\n";
$txt .= $fontcolor . "\n";
$txt .= str_replace("\n","%0A",$content);
fwrite($memofile, $txt);
fclose($memofile);
echo 'DONE';
?>