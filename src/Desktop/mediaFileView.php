<?php
include '../auth.php';
?>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>Media Discover (Read only)</title>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<script src="../script/jquery.min.js"></script>
	<style>
	.item {
		cursor: pointer;
	}
	.umfilename{
		background-color:rgb(216, 240, 255);
	}
	</style>
</head>
<body>
<?php
$mediaType = ".txt";
$status = 1;
$directOpenFile = 0;

if (isset($_GET['mediaType']) && $_GET['mediaType'] != ""){
	$mediaType = $_GET['mediaType'];
}else{
	echo "Undefined Filter String (MediaType is empty)";
	exit(0);
}

?>
<div class="ts icon message">
    <i class="folder open icon"></i>
    <div class="content">
        <div class="header">Media Discover Module</div>
        <p id="currentPath">Search Media Type: <?php echo $mediaType;?></p>
    </div>
</div>
<div class="ts grid" align="center">
    <div class="two wide column" onClick="firstPage();" style="cursor: pointer;"><<</div>
    <div class="four wide column" onClick="Lastpage();" style="cursor: pointer;"> < </div>
	<div id="position" class="four wide column">0 - 100</div>
    <div class="four wide column" onClick="Nextpage();" style="cursor: pointer;"> > </div>
    <div class="two wide column"></div>
</div>
<?php if ($status == 0){ exit(0);}?>
<div id="filelist" class="ts segmented list">

</div>
<div class="ts container" align="center" onClick=" $('html,body').animate({scrollTop: 0}, 700);">
Back to Top<br>
</div>
<br><br>
<script>
var keyword = "<?php echo $mediaType;?>";
var directOpenFile = <?php echo $directOpenFile ? 'true' : 'false'; ?>;
var isFunctionBar = !(!parent.isFunctionBar);
var currentPath = "";
var filePaths = new Object();
var globalCounter = 0;
var startFrom = 0;
var fileCount = 0;
$(document).ready(function(){
	$.ajax({
		url: "../SystemAOB/functions/file_system/listAllFiles.php?dir=/&filter=" + keyword + "&startFrom=" + startFrom,
	}).done(function(data) {
		UpdateFileList(data);
	});
});

function RequestNextPage(){
	$("#position").html(startFrom + " - " + (startFrom + 100));
	$("#filelist").html('<div class="ts segment"><div class="ts active inverted dimmer"><div class="ts text loader">Loading...</div></div><br><br><br><br></div>');
	$.ajax({
		url: "../SystemAOB/functions/file_system/listAllFiles.php?dir=/&filter=" + keyword + "&startFrom=" + startFrom,
	}).done(function(data) {
		$("#filelist").html("");
		UpdateFileList(data);
	});
}

function Nextpage(){
	startFrom += 100;
	RequestNextPage();
}

function Lastpage(){
	startFrom -= 100;
	if (startFrom <=0 ){
		startFrom = 0;
	}
	RequestNextPage();
}

function firstPage(){
	startFrom = 0;
	RequestNextPage();
}
	
function UpdateFileList(data){
	if (data.length == 0){
		$("#filelist").html('<div class="ts message"><div class="header">No results</div><p>You do not have enough number of media to fill this page.</p></div>');
	}else{
		fileCount = data.length;
		for (var i =0; i < data.length;i++){
			AppendPath2List(data[i]);
		}
	}
	//bindMotions();
}

function AppendPath2List(filepath){
	var filename = filepath.split("/").pop();
	if (filename.includes("inith")){
		/**
		Deprecated and replaced with local filename decoding
		$.ajax({
			url: "../SystemAOB/functions/file_system/um_filename_decoder.php?filename=" + filename,
			rawpath:filepath,
			success: function(data){
			}
		}).done(function(data) {
			var template = '<div class="item" id="path_'+globalCounter+'" onmouseover="hovering(this);" onmouseleave="mouseleave(this);" ondblclick="openFile(this);"><i class="angle right icon"></i>'+ data + '</div>';
			$("#filelist").append(template);
			//console.log(this.rawpath);
			filePaths["path_" + globalCounter] = this.rawpath;
			globalCounter++;
		});
		**/
		var decodedFilename = decodeUMfilename(filename);
		var template = '<div class="item umfilename" id="path_'+globalCounter+'" onmouseover="hovering(this);" onmouseleave="mouseleave(this);" ondblclick="openFile(this);"><i class="angle right icon"></i>'+ decodedFilename + '</div>';
			$("#filelist").append(template);
			filePaths["path_" + globalCounter] = filepath;
			globalCounter++;
	}else{
		var template = '<div class="item" id="path_'+globalCounter+'"  onmouseover="hovering(this);" onmouseleave="mouseleave(this);" ondblclick="openFile(this);"><i class="angle right icon"></i>'+ filename + '</div>';
		$("#filelist").append(template);
		filePaths["path_" + globalCounter] = filepath;
		globalCounter++;
	}
}

function hovering(object){
	$(object).addClass("selected");
}

function mouseleave(object){
	$(object).removeClass("selected");
}

function openFile(object){
	var idString = $(object).attr("id");
	var filename = $(object).text();
	targetPath = filePaths[idString];
	console.log(targetPath);
	if (targetPath.substring(0,1) == "/"){
		targetPath = targetPath.substring(1,targetPath.length - 1);
	}
	//targetPath = targetPath.split("/");
	//targetPath.shift();
	//targetPath = targetPath.join("/");
	if (isFunctionBar){
		parent.newEmbededWindow("SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare",0,0,0,0);
	}else{
		window.open("../SystemAOB/functions/file_system/index.php?controlLv=2&mode=file&dir=" + targetPath + "&filename=" + filename, filename, "file outline","fileOpenMiddleWare");
	}
}  

function decodeUMfilename(umfilename){
	if (umfilename.includes("inith")){
		var data = umfilename.split(".");
		var extension = data.pop();
		var filename = data[0];
		filename = filename.replace("inith",""); //Javascript replace only remove the first instances (i.e. the first inith in filename)
		var decodedname = decode_utf8(hex2bin(filename));
		if (decodedname != "false"){
			//This is a umfilename
			return decodedname + "." + extension;
		}else{
			//This is not a umfilename
			return umfilename;
		}
	}else{
		//This is not umfilename as it doesn't have the inith prefix
		return umfilename;
	}
}
	
function hex2bin(s){
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

function decode_utf8(s) {
  return decodeURIComponent(escape(s));
}

</script>
</body>
</html>