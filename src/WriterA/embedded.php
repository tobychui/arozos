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
<title>View Document</title>
<style type="text/css">
        body {
            padding: 20px 20px;
        }
		.CodeMirror, .CodeMirror-scroll {
			max-height: 500px;
		}
		.p{
			font-family: monospace, monospace;
		}
</style>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
</head>
<body style="background-color:#ededed;">
<?php
//Prepare the document
$docName = "";
$filePath = "";
$mimeType = "";
if (isset($_GET['filepath']) && $_GET['filepath'] != ""){
	if (file_exists($_GET['filepath'])){
		$filePath = trim($_GET['filepath']);
		$mimeType = mime_content_type($filePath);
	}else{
	    if (strpos($_GET['filepath'],"../SystemAOB/functions/extDiskAccess.php?file=") === 0){
	        //This is a file in external storage. Extract the filepath from extDiskAccess path
	        $tmp = explode(".php?file=",$_GET['filepath']);
	        $filePath = trim($tmp[1]);
	        $mimeType = mime_content_type($filePath);
	    }
	}
}
if (isset($_GET['filename']) && $_GET['filename'] != ""){
	$docName = $_GET['filename'];
}
?>
	<div style="position:absolute; background-color:white;left:2%;right:2%;">
	<div class="ts text container" style="font-size: 100%;overflow-wrap: break-word;font-family: monospace, monospace;">
	<br>
<?php
$generalType = explode("/",$mimeType)[0];
if ($filePath != "" && $generalType=="text"){
	include_once("Parsedown.php");
	$Parsedown = new Parsedown();
	echo $Parsedown->text(file_get_contents($filePath));
}else if (explode("/",$mimeType)[1] == "x-empty"){
    //This is an empty file. Go ahead and allow something to be written in.
    echo '<code>[WARNING] This is an empty file.</code>';

}else{
	echo '[Error. Unable to open file due to not supported datatype] <br>';
	echo "Sorry. This file format is not supported. <br> " . mime_content_type($filePath) . " mime type was given. <br> filepath: " . $filePath;
	
}

?>
<br><br><br><br>
<div class="ts horizontal divider">End of File</div>
<br><br><br><br>
	</div>
	</div>
<div style="position:fixed;right:1%;top 1%;" onClick="editFile();">
	<div style="font-size:250%;"><i class="edit icon"></i></div>
</div>
<script>
	var filePath = "<?php echo $filePath;?>";
	var fileName = "<?php echo $docName;?>";
	var inVDI = !(!parent.isFunctionBar);
	if (inVDI){
		var windowID = $(window.frameElement).parent().attr("id");
		parent.setWindowIcon(windowID + "","file text outline");
		parent.changeWindowTitle(windowID + "",fileName);
	}
	
	//Force embed tocas table into the parse result
	$("table").each(function(){
	    $(this).addClass("ts").addClass("small").addClass("celled").addClass("table");
	});
	function editFile(){
		if (ao_module_virtualDesktop){
			if (filePath.includes("../")){
				filePath = filePath.replace("../",""); //Replace the first ../ with nothing
			}
			ao_module_newfw('WriterA/index.php?filepath=' + filePath,'Initializing - WriterA','file text outline',ao_module_utils.getRandomUID(),1050,550);
			ao_module_close();
		}else{
			window.open("index.php?filepath=" + filePath);
		}
		
	}
	function BrowseFileInFS(){
		 alert("wip");
	 }
	 
	 function DownloadDoc(){
		 saveAs(filePath,fileName);
	 }
	 
	 function ShareDoc(){
		 window.location.href="../QuickSend/index.php?share=" + window.location.href.replace("&","<and>");
		 
	 }

	function saveAs(uri, filename) {
		var link = document.createElement('a');
		if (typeof link.download === 'string') {
			document.body.appendChild(link); // Firefox requires the link to be in the body
			link.download = filename;
			link.href = uri;
			link.click();
			document.body.removeChild(link); // remove the link when done
		} else {
			location.replace(uri);
		}
	}
</script>
</body>
</html>