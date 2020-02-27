<?php
if (isset($_GET['opr'])){
	if($_GET["opr"] == "scanalive"){
		$output = [];
		$file = glob('data/*.alive');
		foreach($file as $alive){
			array_push($output,basename($alive,".alive"));
		}
		echo json_encode($output);
		
	}else if($_GET["opr"] == "mime"){
		$file = $_GET["file"];
		if (!file_exists($_GET["file"])){
			//Check if it is a path with extDiskAccess.php
			if (strpos($_GET["file"],"extDiskAccess.php?file=") !== false){
				$file = array_pop(explode("=",$_GET['file']));
			}
		}
		echo explode("/",mime_content_type($file))[0];
		
	}else{
		
		echo "[]";
		
	}
	
}else{
	echo "[]";
}