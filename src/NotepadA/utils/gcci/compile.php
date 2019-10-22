<?php
include_once("../../../auth.php");
include_once("../../../SystemAOB/functions/personalization/configIO.php");
$configs = getConfig("encoding",true);
putenv('LANG=en_US.UTF-8'); 
//Check if the source file is valid
if (!isset($_GET['source']) || !file_exists("../" . $_GET['source'])){
	die("Error. Source file not defined or not found. " . $_GET['source'] . ' given.');
}

//Check if the path is located inside AOR (Yes, AOR Only, not external media)
if (!(strpos(realpath("../" . $_GET['source']),realpath($rootPath)) !== false)){
	die("Error. Script is not located within ArOZ Online Root.");
}
$filepath = realpath("../" . $_GET['source']);
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    //use Tiny gcc for the compilation, output file will be the same name as the source filename
	$binaryPath = dirname($filepath) . "\\" . basename($filepath,pathinfo($filepath, PATHINFO_EXTENSION)) . "exe";
	$output = shell_exec('tcc\\tcc.exe "' . $filepath .'" -o "'. $binaryPath . '" 2>&1');
	if ($configs["winHostEncoding"][3] == "true"){
		$output = mb_convert_encoding($output, "UTF-8",$configs["forceEncodingType"][3]);
	}
	if (trim($output) == ""){
		if (file_exists($binaryPath)){
			if (isset($_GET['run'])){
				//Run the application after compile.
				$output = shell_exec($binaryPath . ' 2>&1');
				if ($configs["winHostEncoding"][3] == "true"){
					$output = mb_convert_encoding($output, "UTF-8",$configs["forceEncodingType"][3]);
				}
				echo $output;
			}else{
				//Compile only
				echo 'Compiled succeed. Exported file: ' . $binaryPath;
			}
		}else{
			die("Unknown Error. Compiler do not return anything.");
		}
	}else{
		echo "Error. <br>" . nl2br($output);
	}
	
} else {
    //Linux, use build in gcc
    $binaryPath = dirname($filepath) . "/" . basename($filepath,pathinfo($filepath, PATHINFO_EXTENSION)) . "out";
    $output = shell_exec('gcc "' . $filepath .'" -o "'. $binaryPath . '" 2>&1');
    if (trim($output) == ""){
		if (file_exists($binaryPath)){
			if (isset($_GET['run'])){
				//Run the application after compile.
				$output = shell_exec($binaryPath . ' 2>&1');
				echo nl2br($output);
			}else{
				//Compile only
				echo 'Compiled succeed. Exported file: ' . $binaryPath;
			}
		}else{
			die("Unknown Error. Compiler do not return anything.");
		}
	}else{
		echo "Error. <br>" . nl2br($output);
	}
    
}

?>