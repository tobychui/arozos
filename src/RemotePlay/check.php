<?php
include_once("../auth.php");
if (isset($_GET['rid'])){
	touch("data/" . $_GET['rid'] . ".alive");
	$alives = scandir("data/");
	foreach($alives as $file){
       $time = filectime("data/".$file);
        if($time + 30 <= time() && $file !== ".." && $file !== "."){
                unlink("data/".$file);
        }
    }
	
	if (file_exists("data/" . $_GET['rid'] . ".inf")){
		$data = file_get_contents("data/" . $_GET['rid'] . ".inf");
		$data = explode(",",$data);
		header('Content-Type: application/json');
		echo json_encode([true,$data]);
		unlink("data/" . $_GET['rid'] . ".inf");
	}else{
		header('Content-Type: application/json');
		echo json_encode([false,""]);
	}
}else{
	echo "ERROR. rid not given.";
}

?>