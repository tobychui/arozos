<?php
include '../../../auth.php';
?>
<?php
function CheckIfUMFile($filename){
	$ext = pathinfo($filename, PATHINFO_EXTENSION);
	$filename = basename($filename,"." . $ext);
	if (substr($filename,0,5) == "inith"){
		//it contain header inith
		$org = str_replace("inith","",$filename);
		if (ctype_xdigit($org) && strlen($org) % 2 == 0) {
			return true;
		}else{
			return false;
		}
	}else{
		return false;
	}
}

if (isset($_GET['from']) && $_GET['from'] != ""  && isset($_GET['target']) && $_GET['target'] != ""){
	$from = realpath($_GET['from']);
	//$to = realpath($_GET['copyto']);
	$to = $_GET['target'];
	$umf = CheckIfUMFile($from);
	if (file_exists($from)){
		$count = 0;
		$tmpName = $to;
		while (file_exists($tmpName)){
			//File already exists, change the name as filename_copied.ext
			$ext = pathinfo($to, PATHINFO_EXTENSION);
			$count++;
			$tmpName = $to;
			if ($umf == true){
				$tmpName = str_replace("." . $ext, bin2hex(" ($count)") . "." . $ext, $to);
			}else{
				$tmpName = str_replace("." . $ext, " ($count)." . $ext, $to);
			}
			
		}
		if (is_file($from)){
			//The copy target is a file
			/*
			if (strpos($from,".php") !== false || strpos($from,".js") !== false){
				die("ERROR. No permission in copying system script.");
			}
			*/
			if (!copy($from,$tmpName)){
				echo 'ERROR. Copy error. Maybe you have a wrong permission setting or pathname too long (Windows Host Only)' . $from . " / " . $to  ;
				die();
			}else{
				echo 'DONE';
			}
		}else{
			//The copy target is a directory
			// Not allowed
			die("ERROR. Directory copying is not allowed.");
		}
	}
	
}else{
	echo 'ERROR. Invalid path in variable.';
	die();
}

?>