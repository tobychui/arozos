<?php
$rootPath = "";
if (file_exists("root.inf")){
	//The script is running on the root folder
}else{
	//The script is not running on the root folder, find upward and see where is the root file is placed.
	for ($x = 0; $x <= 32; $x++) {
		if (file_exists($rootPath . "/root.inf")){
			break;
		}else{
			$rootPath = $rootPath . "../";
		}
	} 
}
include_once $rootPath . 'auth.php';
?>
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
	//Windows is a bit tricky but this script will try its best to make it works. I guess?
    $result = [];
	if (file_exists("N:/")){
		array_push($result,["N:/","N:/"]);
	}
	if (file_exists("O:/")){
		array_push($result,["O:/","O:/"]);
	}
	if (file_exists("P:/")){
		array_push($result,["P:/","P:/"]);
	}
	if (isset($_GET['json'])){
		//Called by Javascript
		header('Content-Type: application/json');
		echo json_encode($result);
		exit(0);
	}else{
		//Called by php
		$mountInfo = $result;
	}
} else {
    $storageDevice = glob("/dev/sd*1");
	$result = [];
	foreach ($storageDevice as $hardstorage){
		//echo $hardstorage . '<br>';
		$output = shell_exec('cat /proc/mounts | grep ' . $hardstorage);
		$information = explode(" ",$output);
		$mountedPath = $information[1];
		if ($mountedPath != "/"){
			array_push($result,[$hardstorage,$mountedPath]);
		}else{
			//This is root, not an external storage.
		}
	}
	if (isset($_GET['json'])){
		//Called by Javascript
		header('Content-Type: application/json');
		echo json_encode($result);
		exit(0);
	}else{
		//Called by php
		$mountInfo = $result;
	}

}




?>