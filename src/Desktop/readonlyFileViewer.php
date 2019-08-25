<?php
include '../auth.php';
?>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>Diskinfo (Read only)</title>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<script src="../script/jquery.min.js"></script>
	<style>
	.item {
		cursor: pointer;
		
	}
	.umfoldername {
		background-color: rgb(202, 249, 209);
	}
	.umfilename {
		background-color: rgb(216, 240, 255);
	}
	</style>
</head>
<body>
<?php
function decode_filename($filename){
	$file = $filename;
	if ($file != null || $file != ""){
	$isfile = false;
	if (pathinfo($file, PATHINFO_EXTENSION) != null){
		$isfile = true;
	}
	//Update: added checking for non-um encoded filename
	$ext = pathinfo($file, PATHINFO_EXTENSION);
	$filename = str_replace("inith","",basename($file,"." . $ext));
	if (ctype_xdigit($filename) && strlen($filename) % 2 == 0){
		if ($isfile){
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
			$filename = hex2bin($filename);
			return ($filename . "." . $ext);
		}else{
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
			$filename = hex2bin($filename);
			return $filename;
		}
		
	}else{
		//If it is not um-encoded, just echo out its original filename
		return $file;
	}
	
	
	}
}

$path = "";
$status = 1;
$directOpenFile = 0;

if (isset($_GET['path']) && $_GET['path'] != ""){
	if (file_exists($_GET['path'])){
		$path = $_GET['path'];
	}else{
		$path = "PATH NOT FOUND";
		$status = 0;
	}
}else{
	$path = "UNDEFINED DIRECTORY";
	$status = 0;
}

if (is_file($path)){
	//Open the file
	$directOpenFile = true;
}
?>
<div class="ts icon message">
    <i class="folder open icon"></i>
    <div class="content">
        <div class="header">Read Only File Viewing Module</div>
        <p id="currentPath"><?php echo $path;?></p>
    </div>
</div>
<?php if ($status == 0){ exit(0);}?>
<div class="ts segmented list">
<?php
	$files = glob("$path/*");
	$filePath = [];
	$folderPath = [];
	foreach ($files as $file){
		$orgifilename = $file;
		if (is_dir($file)){
			$file = decode_filename($file);
			array_push($folderPath,[$file,$orgifilename]);
		}
		if (is_file($file)){
			$file = decode_filename($file);
			array_push($filePath,[$file,$orgifilename]);
		}
	}
	echo ' <div class="item"><i class="chevron left icon"></i>../</div>';
	foreach ($folderPath as $object){
		if (str_replace($path . "/","",$object[1]) != str_replace($path . "/","",$object[0])){
			echo ' <div class="item umfoldername" filepath="'.str_replace($path . "/","",$object[1]).'"><i class="folder outline icon"></i>'.str_replace($path . "/","",$object[0]).'</div>';
		}else{
			echo ' <div class="item" filepath="'.str_replace($path . "/","",$object[1]).'"><i class="folder outline icon"></i>'.str_replace($path . "/","",$object[0]).'</div>';
		}
	}
	
	foreach ($filePath as $object){
		if (str_replace($path . "/","",$object[1]) != str_replace($path . "/","",$object[0])){
			echo ' <div class="item umfilename" filepath="'.str_replace($path . "/","",$object[1]).'"><i class="file outline icon"></i>'.str_replace($path . "/","",$object[0]).'</div>';
		}else{
			echo ' <div class="item" filepath="'.str_replace($path . "/","",$object[1]).'"><i class="file outline icon"></i>'.str_replace($path . "/","",$object[0]).'</div>';
		}
		
	}

?>
</div>
<script>
var currentPath = "<?php echo $path;?>";
var directOpenFile = <?php echo $directOpenFile ? 'true' : 'false'; ?>;
var isFunctionBar = !(!parent.isFunctionBar);

$(document).ready(function(){
	if (directOpenFile == true){
		var filename = currentPath.split("/").splice(-1,1);
		if (isFunctionBar){
			parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + currentPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare",0,0);
		}else{
			window.open("../SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + currentPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare");
		}
		
	}
});

$( ".item" ).hover(
  function() {
    $(this).addClass("selected");
  }, function() {
    $(this).removeClass("selected");
  }
);

$( ".item" ).dblclick(function(e){
	e.preventDefault();
	var divContent = $(this).text();
	if (divContent == "../"){
		//Go back one page
		if (currentPath.substring(1,currentPath.length - 1).includes("/") == false || currentPath == "/"){
			return;
		}
		currentPath = currentPath.split('\\').join("/");
		currentPath = currentPath.replace("/" + currentPath.split("/").splice(-1,1).join("/"),"");
		window.location.href = "readonlyFileViewer.php?path=" + currentPath;
	}else{
		//Redirect to new page
		if ($(this).html().includes("file outline")){
			//This is a file, open it
			//var filename = $(this).text();
			var filename = $(this).attr("filepath");
			targetPath = currentPath + "/" + filename;
			if (targetPath.includes("/var/www/html")){
				//Quick fix for something I have no idea what is happening...
				var indexOfhtml = targetPath.indexOf("/var/www/html");
				targetPath = targetPath.substring(indexOfhtml,targetPath.length - indexOfhtml + 2);
				//alert(targetPath);
			}
			if (isFunctionBar){
				parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetPath + "&filename=" + $(this).text(), filename, "file outline","fileOpenMiddleWare",0,0,0,0);
			}else{
				window.open("../SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare");
			}
		}else{
			//This is a folder, open it
			window.location.href = "readonlyFileViewer.php?path=" + currentPath + "/" + $(this).attr("filepath");
		}
		
	}
  });
  
</script>
</body>
</html>