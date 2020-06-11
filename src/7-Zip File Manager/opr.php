<?php
include '../auth.php';
?>
<?php
/*
|-----------------------------|
| 77777     ZZZZZ IIIII PPPPP |
|     7         Z   I   P   P |
|    7    -    Z    I   PPPP  |
|   7         Z     I   P     |
|  7        ZZZZZ IIIII P     |
|-----------------------------|
Yes ! This is an 7Zip logo
*/
$rand = $_GET["rand"];

if(!isset($_GET["method"])){
	die('["Method Error"]');
}
/*
if(!isset($_GET["rand"])){
	die('["Rand Error"]');
}
if(!isset($_GET["file"])){
	die('["File Error"]');
}
*/
if(strcasecmp(substr(PHP_OS, 0, 3), 'WIN') == 0){
    $executions = "7za";
	foreach ($_GET as $key => $value) {
		$_GET[$key] = preg_replace('/\//', '\\', $value);
	}
}else{
	if(strpos(exec('uname -m'), 'arm') !== false){
		$executions = "./7za";
	}else{
		$executions = "./7za_x86";
	}
}

if($_GET["method"] == "ListAORDir"){
	$result = [];
	$dir = $_GET["dir"] !== "" ?  "../".$_GET["dir"]."/" : "../";
	$data = scandir($dir,1);
	array_pop($data); // this two use for remove .. and .
	array_pop($data);
	foreach($data as $value){
		if(is_dir($dir.$value)){
			array_push($result,$value);
		}
	}
	echo json_encode($result);
	
}else if($_GET["method"] == "l"){
	$filesnumber = -1;
	$FileInformation = [];
	$SevenZHeader = [];
	exec($executions.' l "'.$_GET["file"].'" -ba -slt',$output);
	//   echo $_GET["dir"];
	if($_GET["dir"] !== ""){
		$dir = $_GET["dir"];
	}else{
		$dir = ".";
	}
	
		//* Special designed handler for ZIP (use for show folder)
		if(pathinfo($_GET["file"])['extension'] == "zip"){
			for($i = 0;$i < sizeOf($output);$i++){
				preg_match_all('/(.*[^=]) = (.*)/', $output[$i], $tmp);
				if(isset($tmp[1][0])){
					if($tmp[1][0] == "Path" && pathinfo($tmp[2][0])["dirname"] !== "."){
						if(!in_array("Path = ".pathinfo($tmp[2][0])["dirname"],$output)){
							array_push($output,"Path = ".pathinfo($tmp[2][0])["dirname"]);
							array_push($output,"Attributes = D");
							array_push($output,"");
						}
					}
				}
			}
		}

	//print_r($output);
	for($i = 0;$i < sizeOf($output);$i++){
		preg_match_all('/(.*[^=]) = (.*)/', $output[$i], $tmp);
		if(isset($tmp[1][0])){
			if($tmp[1][0] == "Path"){
				$currDir = pathinfo($tmp[2][0])["dirname"];
				if($currDir == $dir){
					$filesnumber += 1;
				}
			}
			if($tmp[1][0] !== NULL && $currDir == $dir){
				$FileInformation[$filesnumber][$tmp[1][0]] = $tmp[2][0];
				if(!in_array($tmp[1][0],$SevenZHeader)){
					array_push($SevenZHeader,$tmp[1][0]);
				}
			}
		}
	}
	
	if(strcasecmp(substr(PHP_OS, 0, 3), 'WIN') == 0){
		for($i = 0;$i < sizeOf($FileInformation);$i++){
			$FileInformation[$i] = preg_replace('/\\\\/', '/', $FileInformation[$i]);
		}
	}
	echo json_encode(array("Header" => $SevenZHeader,"Information" => $FileInformation));

}else if($_GET["method"] == "e"){
	$rand = $_GET["rand"];
	mkdir('tmp/'.$rand,0777);
	system($executions.' e -bsp1 -bso0 "'.$_GET["file"].'" "'.$_GET["dir"].'" -o"tmp/'.$rand.'/" > tmp/'.$rand.'messages',$output);
	//echo './'.$executions.' e -bsp1 -bso0 "'.$_GET["file"].'" "'.$_GET["dir"].'" -o"tmp/'.$rand.'/" > tmp/'.$rand.'messages';
	echo json_encode(array("Extract finished. e"));
}else if($_GET["method"] == "x"){
	$rand = $_GET["rand"];
	mkdir('tmp/'.$rand,0777);
	system($executions.' x -bsp1 -bso0 "'.$_GET["file"].'" "'.$_GET["dir"].'" -o"tmp/'.$rand.'/" > tmp/'.$rand.'messages',$output);
	echo json_encode(array("Extract finished. x"));
}
