<?php
include '../../../auth.php';

function isJson($string) {
 json_decode($string);
 return (json_last_error() == JSON_ERROR_NONE);
}


if (isset($_GET['filename']) && $_GET['filename'] != ""){
    $filename = $_GET['filename'];
	if (isJson($filename)){
	    $filename =  json_decode($filename);
	}
	if (!file_exists($filename)){
		die("ERROR. Filename not found");
	}
}else{
	die("ERROR. Undefined filename given");
}

function filesize_formatted($path)
{
    if(strcasecmp(substr(PHP_OS, 0, 3), 'WIN') == 0){
		$size = filesize($path);
		$units = array( 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB');
		$power = $size > 0 ? floor(log($size, 1024)) : 0;
		return number_format($size / pow(1024, $power), 2, '.', ',') . ' ' . $units[$power];
	}else{
		//Use linux shell is much faster than PHP filesize
		$size = shell_exec('wc -c < "' . realpath($path) . '"');
		$size = Trim($size);
		//As PHP on 32bit OS can handle 2GB file at max. 
		//Check if the conversion script can handle 64 bit integer as string first before passing into math processing.
		if (strlen($size) > 9 && (substr(0,1,$size) != "0" && substr(0,1,$size) != "1")){
			//This file is larger than 2GB which PHP can handle.
			$size = substr($size,0,strlen($size) - 6); //Base starting from MB
			if ((int)$size > 1000){
				$size = round($size/1000,2) . " GB";
			}else{
				$size = $size . " MB";
			}
			//Check if the board can continues with the calculation.
			$cpuMode = exec("uname -m 2>&1",$output, $return_var);
			switch(trim($cpuMode)){
				case "armv7l": //raspberry pi 3B+
				case "armv6l": //Raspberry pi zero w
					//Stop calculating MD5 on Raspberry Pis or otherwise the server will freeze
					die($size);
				default:
					//Other boards. Leave empty for now
					break;
			}
			return $size;
		}else{
			//File smaller than 2GB. Can be handled via simple math equation
			$units = array( 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB');
			$power = $size > 0 ? floor(log($size, 1024)) : 0;
			return number_format($size / pow(1024, $power), 2, '.', ',') . ' ' . $units[$power];
		}
		return "File too large.";
	}
    
}

function getHumanReadableSize($size){
    $units = array( 'B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB');
    $power = $size > 0 ? floor(log($size, 1024)) : 0;
    return number_format($size / pow(1024, $power), 2, '.', ',') . ' ' . $units[$power];
}

function getIcon($path){
	if (is_dir($path)){
		return "folder open outline";
	}
	$fullmime = mime_content_type($path);
	$mime = explode("/",$fullmime)[0];
	$detail = explode("/",$fullmime)[1];
	if ($mime == "audio"){
		return "file audio outline";
	}else if ($mime == "video"){
		return "file video outline";
	}else if ($detail == "x-php"){
		return "file code outline";
	}else if ($mime == "text"){
		return "file text outline";
	}else if ($mime == "model"){
		return "cube";
	}else if ($mime == "image"){
		return "file image outline";
	}else if ($mime == "directory"){
		return "folder open";
	}else if ($detail == "zip"){
		return "file archive outline";
	}else if ($detail == "javascript"){
		return "file code outline";
	}else if ($detail == "json"){
		return "file code outline";
	}else if ($detail == "pdf"){
		return "file pdf outline";
	}else if ($mime == "application"){
		return "file outline";
	}else{
		//Unknown file format
		return "cube";
	}
	
}

function getDecodeFileName($filename){
	if (strpos($filename,"inith") !== false){
		$ext = pathinfo($filename, PATHINFO_EXTENSION);
		$filenameOnly = str_replace("." . $ext,"",$filename);
		$hexname = substr($filenameOnly,5);
		if (ctype_xdigit($hexname) && strlen($hexname) % 2 == 0) {
			$originalName = hex2bin($hexname);
			return $originalName . "." . $ext;
		} else {
			//This is not an encoded filename but just so luckly that is start with inith
			return $filename;
		}
		
	}else if (ctype_xdigit($filename) && strlen($filename) % 2 == 0) {
		//This is a folder encriped in hex filename format
		return hex2bin($filename);
	}else{
		return $filename;
	}
}

function GetDirectorySize($path){
    $bytestotal = 0;
    $path = realpath($path);
    if($path!==false && $path!='' && file_exists($path)){
        foreach(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS)) as $object){
            $bytestotal += $object->getSize();
        }
    }
    return $bytestotal;
}

$ext = pathinfo($filename, PATHINFO_EXTENSION);
$fileType = "file";
if ($ext == "shortcut"){
	//This is a shortcut
	$fileType = "shortcut";
}elseif(is_dir($filename)){
	//This is a folder
	$fileType = "folder";
}
//Or otherwise it is a file
?>
<html>
<head>
	<link rel="stylesheet" href="../../../script/tocas/tocas.css">
	<script src="../../../script/tocas/tocas.js"></script>
	<script src="../../../script/jquery.min.js"></script>
	<!-- <script src="../../../script/ao_module.js"></script> -->
	<style>
	    .spcialPadding{
	        padding-top:20px;
	        padding-left:10px;
	    }
		.attached.tab.segment{
			box-shadow: 2px 2px 3px #5b5b5b;
		}
	</style>
</head>
<body style="background-color:#f0f0f0;font-size:80%;overflow-y:hidden;">
	<!-- <div class="ts top attached tabbed menu">
		<a class="active item">Summary</a>
	</div> -->
	<div class="ts active bottom attached tab segment" style="height:100%;">
			<div class="ts grid">
				<div class="four wide column"><i id="fileIcon" class="huge <?php echo getIcon($filename);?> icon spcialPadding"></i></div>
				<div class="twelve wide column">
					<div class="ts small header" style="word-wrap: break-word !important;">
					<div class="ts vertical fluid inputs">
					<div class="ts borderless input">
						<input type="text" value="<?php echo getDecodeFileName(basename($filename));?>" readonly>
					</div>
					<div class="ts borderless input">
						<input type="text" value="<?php echo basename($filename);?>" readonly>
					</div>
					</div>
						<div class="sub header"><?php 
						if ($fileType == "file"){
							echo "." . $ext . " file (".mime_content_type($filename).")";
						}elseif ($fileType == "shortcut"){
							echo "." . $ext . " file (shortcut/aroz)";
						}elseif ($fileType == "folder"){
							echo "directory (directory/aroz)";
						}?></div>
					</div>
				</div>
			</div>
			<div class="ts divider"></div>
			<table class="ts table">
			<tbody>
				<tr>
					<td><?php
					if ($fileType == "file"){
						echo '<span localtext="fileproperties/contents/openwith">Opens with</span>';
					}elseif ($fileType == "shortcut"){
						echo '<span localtext="fileproperties/contents/shortcutTarget">Target</span>';
					}
					?></td>
					<td><?php
					if ($fileType == "file"){
						if (file_exists("default/" . $ext . ".csv")){
							$line = fgetcsv(fopen("default/" . $ext . ".csv","r"));
							echo $line[0];
						}else{
							echo "N/A";
						}
					}elseif($fileType == "shortcut"){
						$content = file_get_contents($filename);
						$modulename = explode(PHP_EOL,$content)[2];
						echo $modulename;
					}
					?><br></td>
				</tr>
				<?php
				if ($fileType == "file"){
				echo "<tr>
					<td></td>
					<td><button class='ts tiny basic button' onClick='changeOpenApps();' localtext='fileproperties/contents/changeDefaultWebApp'>Change</button></td>
				</tr>";
				}
				?>
				<tr>
					<td><?php echo ($fileType=="shortcut")? "<span localtext='fileproperties/contents/shortcut'>Shortcut</span> " : "";?><span localtext="fileproperties/contents/location">Location</span></td>
					<td><div class="ts borderless tiny fluid input"><input id="filelocation" type="text" value="<?php echo realpath($filename);?>" readonly></div></td>
				</tr>
				<tr>
					<td><?php echo ($fileType=="shortcut")? "<span localtext='fileproperties/contents/shortcut'>Shortcut</span> " : "";?><span localtext="fileproperties/contents/directPath">Direct Access Path</span></td>
					<td><div class="ts borderless tiny fluid input"><input type="text" value="<?php echo str_replace(str_replace("\\","/",$_SERVER['DOCUMENT_ROOT']),"http://$_SERVER[HTTP_HOST]",str_replace("\\","/",realpath($filename)));
					?>" readonly></div></td>
				</tr>
				<?php
					if ($fileType == "shortcut"){
						if (file_exists("../../../" . explode(PHP_EOL,$content)[2])){
							//If this is a module with Path specification over the root of AOB
							//e.g. <ArOZ Online Root>/Audio
							$realPath = realpath("../../../" . explode(PHP_EOL,$content)[2]);
						}elseif (file_exists(explode(PHP_EOL,$content)[2])){
							//Just in case there are someone trying to access external storage from here
							//e.g. /media/storage1/module
							$realPath = realpath(explode(PHP_EOL,$content)[2]);
						}else if (strpos(explode(PHP_EOL,$content)[2],"https://") !== false || strpos(explode(PHP_EOL,$content)[2],"http://") !== false){
							$realPath = explode(PHP_EOL,$content)[2];
						}else{
							$realPath = "This shortcut might point to a directory no longer exists.";
						}
						echo '<tr>
					<td localtext="fileproperties/contents/shortcutTargetFullpath">Starting Location</td>
					<td><div class="ts borderless tiny fluid input"><input type="text" value="'.$realPath.'" readonly></div></td>
				</tr>';
					}
				?>
				<tr>
					<td localtext="fileproperties/contents/size">Size</td>
					<td><?php 
					if ($fileType == "folder"){
						echo getHumanReadableSize(GetDirectorySize($filename));
					}else{
						echo filesize_formatted($filename);
					};
					
					?></td>
				</tr>
				<tr>
					<td localtext="fileproperties/contents/datemodified">Date Modified</td>
					<td><?php echo date("F d Y H:i:s", filemtime($filename));?></td>
				</tr>
				<tr>
					<td localtext="fileproperties/contents/md5">MD5</td>
					<td><?php 
					if (is_dir($filename)){
            			echo "N/A";
            		}else{
            			echo md5_file($filename);
            		}
		?></td>
				</tr>
				<!--
				<tr>
					<td>Owner</td>
					<td></td>
				</tr>
				-->
			</tbody>
		</table>
	</div>
	<script>
	    var ext = "<?php echo $ext;?>";
	    var VDI = !(!parent.isFunctionBar);
	    
	    //Translation Services. Load default translation from localStorage if availble
		initLocalizationTranslation();
		function initLocalizationTranslation(){
			var lang = localStorage.getItem("aosystem.localize");
			if (lang === undefined || lang === "" || lang === null){
				//Ignore translation
			}else{
				//Translate with given lang
				$.get("../../system/lang/" + lang + ".json",function(data){
					window.localization = data;
					$("*").each(function(){
						if (this.hasAttribute("localtext")){
							var thisKey = $(this).attr("localtext");
							var localtext = data.keys[thisKey];
							$(this).text(localtext);
						}
					});
				})
			}
		}
		
        function changeOpenApps(){
	        if (VDI){
	            windowID = $(window.frameElement).parent().attr("id");
	            parent.newEmbededWindow("SystemAOB/functions/file_system/openWith.php?ext=" + ext,"Change default opener",undefined,new Date().getTime(),365,575,window.screen.availWidth/2 - 180, window.screen.availHeight/2 - 387 + 30,0,1,windowID,"updateOpenWithModuleDisplay");
	        }else{
	            //Open the select with windows on a new tab
	            window.open("openWith.php?ext=" + ext);
	        }
	    }
		
		$(document).ready(function(){
			if ($("#fileIcon").attr("class").includes("file outline")){
				//The php script above do not know what icon should be used for this kind of file ext
				//Use ao_module default icon list to get the file icon instead.
				var icon = ao_module_utils.getIconFromExt(ext);
				$("#fileIcon").attr("class","huge " + icon + " icon spcialPadding");
			}
		});
	</script>
</body>
</html>