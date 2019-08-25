<?php
include '../../../auth.php';
?>
<?php
//This is only a testing function. This was not suppose to use in any part of the file system.
//This function is now accessable via filtering options
function mv($var){
	if (isset($_GET[$var]) !== false && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return null;
	}
}

function listFiles($dir,$layer){
	$files = [];
    $ffs = scandir($dir);
    unset($ffs[array_search('.', $ffs, true)]);
    unset($ffs[array_search('..', $ffs, true)]);
	
    // prevent empty ordered elements
    if (count($ffs) < 1)
        return;
	
    foreach($ffs as $ff){
		if (is_dir($dir . '/' . $ff)){
			$subfiles = listFiles($dir.'/'.$ff, $layer+1);
			if (sizeof($subfiles) > 0){
				$files = array_merge($files,$subfiles);
			}
		}else{
			array_push($files,$dir .'/'. $ff);
		}
    }
	if ($layer == 0){
		$result = [];
		foreach ($files as $file){
			array_push($result,str_replace($dir . '/',"",$file));
		}
		return $result;
	}else{
		return $files;
	}
	

}

if (mv('dir') != null){
	$dir = mv('dir');
	if ($dir == "/"){
		$dir = "../../../";
	}
	if (strpos($dir, "<aor>") !== false){
		$dir = str_replace("<aor>","../../../",$dir);
	}
	if (file_exists($dir) && is_dir($dir)){
		//listFiles($dir);
		$result = (listFiles($dir,0));
		$filter = "";
		$startFrom = 0;
		$fileNumber = 100;
		if (mv('startFrom') != null){
			$startFrom = mv('startFrom');
		}
		if (mv('fileNumber') != null){
			$fileNumber = mv('fileNumber');
		}
		
		if (mv("filter") != null){
			//Add filter keyword to the search results
			$tempresult = [];
			$filter = mv("filter");
			$counter = 0;
			$stopVal = $startFrom + $fileNumber;
			foreach ($result as $item){
				if (strpos($item,$filter) !== false){
					if ($counter >= $startFrom && $counter < $stopVal){
						array_push($tempresult,$item);
					}
					$counter++;
				}
			}
			header('Content-Type: application/json');
			echo json_encode($tempresult);
		}else{
			header('Content-Type: application/json');
			echo json_encode($result);
		}
		
	}else{
		echo 'ERROR. Directroy not found or it is not a directory.';
	}
	
}


?>