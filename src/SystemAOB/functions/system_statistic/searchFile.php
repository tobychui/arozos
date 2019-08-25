<?php
include_once '../../../auth.php';
if(!isset($_GET["keyword"])){
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<style>
.selectable{
	border: 1px solid transparent !important;
}

.selectable:hover{
	background-color:#e5efff;
	border: 1px solid #468cfc !important;
}
</style>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			File search
			<div class="sub header">Search files with keyword</div>
		</div>
	</div>
	
	<div class="ts container">
		<div class="ts form">
			<div class="inline fields">
				<div class="sixteen wide field">
					<label>Keyword</label>
					<input type="text" placeholder="Keyword" id="keywordInput">
					&nbsp;
					<button onclick="updatelist()" id="btn" class="ts button">Search</button>
				</div>
				</div>
		</div>
		<div class="ts bottom attached vertical menu" id="mainmenu">
			<div class="item">
				<div class="ts comments">
					<div class="comment" style="cursor:pointer;">
						<div class="content">
							<div>Enter something to search?</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
<div id="operationSelect" style="padding:3px;display:none;">
<div class="ts breadcrumb">
    <a class="section" onClick="openFile(0);">Open</a>
    <div class="divider"> / </div>
    <a class="section" onClick="openFile(1);">Open File Location</a>
    <div class="divider"> / </div>
    <a class="section" onClick="openFile(2);">Open in New Tab</a>
</div>
</div>
<div>
</div>
<br><br>	
			<script>
			var VDI = !(!parent.isFunctionBar); //Check if currently in embedded mode
			var fileTemplate = '<div class="item selectable" path="%filepath%" filename="%filename%">\
				<div class="ts comments" onClick="selected(this);">\
					<div class="comment" style="cursor:pointer;">\
						<div class="content">\
							<div style="font-weight: bold;">%filename%</div>\
							<div class="text">%displatpath%</div>\
						</div>\
					</div>\
				</div>\
			</div>';
			var targetFilepath = "";
			var targetFilename = "";
			function updatelist(){
				$('#mainmenu').html('<div class="item"><div class="ts active centered inline loader"></div></div>');
				$.get("searchFile.php?keyword=" + $('#keywordInput').val(), function(data, status){
					$('#mainmenu').html("");
					if (data.includes("ERROR")){
						$('#mainmenu').html("<div class='item'>An error has occured during the search. Are you sure your keyword is valid? Error message: <br>" + data + '</div>');
						return;
					}
					for (var i =0; i < data.length; i++){
						var box = fileTemplate;
						var filepath = data[i][0];
						var filename = data[i][1];
						var displaypath = filepath.replace("./","/AOR/");
						var realpath = displaypath;
						displaypath = decodePath(displaypath);
						box = replaceAll("%filepath%",filepath,box);
						box = replaceAll("%filename%",filename,box);
						box = replaceAll("%displatpath%",displaypath,box);
						$('#mainmenu').append(box);
					}
				});
			}
			
			function decodePath(filepath){
				filepath = filepath.split("\\").join("/");
				var data = filepath.split("/");
				for (var i =0; i < data.length-1; i++){
					if (data[i] != ""){
						data[i] = ao_module_codec.decodeHexFoldername(data[i]);
					}
				}
				data[i] = ao_module_codec.decodeUmFilename(data[i]);
				return data.join("/");
			}
			
			function replaceAll(keyword,newtext,target){
				return target.split(keyword).join(newtext);
			}
			
			function selected(object){
				var filepath = $(object).parent().attr("path");
				if (filepath.substring(0,2) == "./"){
					filepath = filepath.substring(2);
				}
				var filename = $(object).parent().attr("filename");
				//console.log(filepath,filename);
				targetFilepath = filepath;
				targetFilename = filename;
				$(object).parent().append($("#operationSelect"));
				$("#operationSelect").show();
			}
			
			function openFile(mode){
				if (mode == 0){
					//Open using filesystem
					if (VDI){
						parent.parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetFilepath + "&filename=" + targetFilename, targetFilename, "file outline","fileOpenMiddleWare",0,0,-10,-10);
					}else{
						window.open("../../../SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetFilepath + "&filename=" + targetFilename);
					}
				}else if (mode == 1){
					//Open file location
					var basedir = targetFilepath
					basedir = replaceAll("\\","/",basedir);
					basedir = basedir.split("/");
					basedir.pop();
					basedir = basedir.join("/");
					if (VDI){
						parent.parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&subdir=" + basedir, "Loading", "folder open outline",Math.floor(Date.now() / 1000),1080,580,undefined,undefined);
					}else{
						window.open("../../../SystemAOB/functions/file_system/index.php?controlLv=2&subdir=" + basedir);
					}
				}else if (mode == 2){
					//Open in new tab
					window.open("../../../" + targetFilepath);
				}
			}
			
			$("#keywordInput").keypress(function(e) {
				if(e.which == 13) {
					e.preventDefault();
					updatelist();
				}
			});
			
			class ao_module_codec{
			//Decode umfilename into standard filename in utf-8, which umfilename usually start with "inith"
			//Example: ao_module_codec.decodeUmFilename(umfilename_here);
			static decodeUmFilename(umfilename){
				if (umfilename.includes("inith")){
					var data = umfilename.split(".");
					if (data.length == 1){
						//This is a filename without extension
						var decodedname = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(data[0]));
						if (decodedname != "false"){
							//This is a umfilename
							return decodedname + "." + extension;
						}else{
							//This is not a umfilename
							return umfilename;
						}
					}else{
						//This is a filename with extension
						var extension = data.pop();
						var filename = data[0];
						filename = filename.replace("inith",""); //Javascript replace only remove the first instances (i.e. the first inith in filename)
						var decodedname = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(filename));
						if (decodedname != "false"){
							//This is a umfilename
							return decodedname + "." + extension;
						}else{
							//This is not a umfilename
							return umfilename;
						}
					}
					
				}else{
					//This is not umfilename as it doesn't have the inith prefix
					return umfilename;
				}
			}
			//Decode hexFoldername into standard foldername in utf-8, return the original name if it is not a hex foldername
			//Example: ao_module_codec.decodeHexFoldername(hexFolderName_here);
			static decodeHexFoldername(folderName){
				var decodedFoldername = ao_module_codec.decode_utf8(ao_module_codec.hex2bin(folderName));
				if (decodedFoldername == "false"){
					//This is not a hex encoded foldername
					decodedFoldername = folderName;
				}else{
					//This is a hex encoded foldername
					decodedFoldername = "*" + decodedFoldername;
				}
				return decodedFoldername;
			}
			
			static hex2bin(s){
			  var ret = []
			  var i = 0
			  var l
			  s += ''
			  for (l = s.length; i < l; i += 2) {
				var c = parseInt(s.substr(i, 1), 16)
				var k = parseInt(s.substr(i + 1, 1), 16)
				if (isNaN(c) || isNaN(k)) return false
				ret.push((c << 4) | k)
			  }
			
			  return String.fromCharCode.apply(String, ret)
			}
			
			static decode_utf8(s) {
			  return decodeURIComponent(escape(s));
			}
		}
			</script>
			

</body>
</html>
<?php 
}else{
	$keyword = $_GET["keyword"];
	if ($keyword == ""){
		die("ERROR. Keyword cannot be empty.");
	}else if ($keyword == "/" || $keyword == "\\" || str_replace("/","",$keyword) == "" || str_replace("\\","",$keyword) == "" || str_replace("/","",str_replace("\\","",$keyword)) == ""){
		die("ERROR. Keyword cannot be directory seperator.");
	}else if ($keyword == "." || $keyword == " "){
		die("ERROR. Keyword is not a valid filename keyword.");
	}
	function getDirContents($dir, &$results = array()){
		$files = scandir($dir);
		foreach($files as $key => $value){
			$path = realpath($dir.DIRECTORY_SEPARATOR.$value);
			if(!is_dir($path)) {
				$results[] = $path;
			} else if($value != "." && $value != "..") {
				getDirContents($path, $results);
				$results[] = $path;
			}
		}
		return $results;
	}
	
	function getRelativePath($from, $to)
	{
		// some compatibility fixes for Windows paths
		$from = is_dir($from) ? rtrim($from, '\/') . '/' : $from;
		$to   = is_dir($to)   ? rtrim($to, '\/') . '/'   : $to;
		$from = str_replace('\\', '/', $from);
		$to   = str_replace('\\', '/', $to);

		$from     = explode('/', $from);
		$to       = explode('/', $to);
		$relPath  = $to;

		foreach($from as $depth => $dir) {
			// find first non-matching dir
			if($dir === $to[$depth]) {
				// ignore this directory
				array_shift($relPath);
			} else {
				// get number of remaining dirs to $from
				$remaining = count($from) - $depth;
				if($remaining > 1) {
					// add traversals up to first matching dir
					$padLength = (count($relPath) + $remaining - 1) * -1;
					$relPath = array_pad($relPath, $padLength, '..');
					break;
				} else {
					$relPath[0] = './' . $relPath[0];
				}
			}
		}
		return implode('/', $relPath);
	}

	function hexFilenameDecoder($file){
		$ext = pathinfo($file, PATHINFO_EXTENSION);
		$filename = str_replace("inith","",basename($file,"." . $ext));
		if (ctype_xdigit($filename) && strlen($filename) % 2 == 0){
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				return ($filename . "." . $ext);
			
		}else{
			//If it is not um-encoded, just echo out its original filename
			return $file;
		}
	}
	
	$files = getDirContents('../../../');
	$result = [];
	foreach ($files as $file){
		if (strpos(basename($file),$keyword)){
			$relativePath = getRelativePath(realpath("../../../"),$file);
			$decodedName = hexFilenameDecoder(basename($file));
			array_push($result,[$relativePath,$decodedName]);
		}
	}
	header('Content-Type: application/json');
	echo json_encode($result);
	
	
}
?>