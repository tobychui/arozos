<?php
include_once '../../../auth.php';
/**This script loads and set the default opening application for the AOB system
Example 1
getDefaultApp.php?mode=set&ext=flac&var=Audio,embedded,music,640,170,0,0
--------------------------------------------
This means set flac open mode by "Audio" module under "embedded" mode, using icon "music", with size 640 * 170 and the window is not scalable and not transparent.
You can choose between default / floatwindow / embedded
default: Open the file with default application, filename pass by variable "filename"
floatwindow: Open the file with floatWindow if it is under VDI mode. If not, redirect to the application page.
embedded: Open the file with embedded mode if it is under VDI mode.(Make sure you have the embedded.php under the module root folder).
If not, redirect to the application page.

Example 2
getDefaultApp.php?mode=get&ext=flac
----------------------------------------------
return --> [["Audio","embedded","music","640","170","0","0"]]
**/

if (isset($_GET['mode']) && $_GET['mode'] != ""){
	$mode = $_GET['mode'];
	if (isset($_GET['ext']) && $_GET['ext'] != ""){
		$ext = $_GET['ext'];
		if ($mode == "set"){
			if (isset($_GET['var']) && $_GET['var'] != ""){
				//Validate the correctness of data
				$var = trim($_GET['var']);
				$vars = explode(",",$var);
				$module = $vars[0];
				$openMode = strtolower($vars[1]);
				$moduleRoot = "../../../" . $module . "/";
				if (file_exists($moduleRoot . "embedded.php")){
					
				}else if (file_exists($moduleRoot . "FloatWindow.php")){
					if ($openMode == "embedded"){
						//embedded is not supported on this module. Switching to default instead
						$openMode = "default";
					}
				}else{
					//This module do not support either embedded or floatwindow mode. Launch directly to its index.php
					if ($openMode == "embedded" || $openMode == "floatwindow"){
						$openMode == "default";
					}
				}
				
				
				if (sizeof($vars) !=  7){
					die("ERROR. This function require 7 variable for setting correctly.");
				}
				//All variable are set. Check if the file exists.
				$filename = 'default/' . $ext . ".csv";
				if (file_exists($filename)){
					$file_data = $var . PHP_EOL;
					$file_data .= file_get_contents($filename);
					file_put_contents($filename, $file_data);
					echo "DONE";
				}else{
					$myfile = fopen($filename, "w") or die("ERROR. Unable to open file!");
					fwrite($myfile, $var . PHP_EOL);
					fclose($myfile);
					echo "DONE";
				}
			}else{
				die("ERROR. Unknown var for file operation under set mode.");
			}
		}else if ($mode == "get"){
			//Get the record from the default folder
			if (file_exists('default/' . $ext . ".csv")){
				$content = file_get_contents('default/' . $ext . ".csv");
				$content = trim($content);
				$content = explode(PHP_EOL,$content);
				$data = [];
				foreach ($content as $line){
					$line = trim($line);
					array_push($data,explode(",",$line));
				}
				header('Content-Type: application/json');
				echo json_encode($data);
			}else{
				header('Content-Type: application/json');
				echo json_encode([]);
			}
			
		}else{
			die("ERROR. Unknown mode (only get / set is allowed).");
			
		}
	}else{
		die("ERROR. Unset file extension (ext) variable.");
	}
}else{
	die("ERROR. Unset mode variable.");
}



?>