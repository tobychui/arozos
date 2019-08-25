<?php
include '../auth.php';
?>
<!DOCTYPE HTML>
<html>
<head>
<script src="../script/jquery.min.js"></script>
<script src="../script/dropzone/dropzone.js"></script>
<link rel="stylesheet" href="../script/dropzone/min/dropzone.min.css">
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>

<title>ArOZ Onlineβ</title>
    <style type="text/css">
        body {
            //padding-top: 4em;
            background-color: rgb(250, 250, 250);
        }
        .ts.segmented.list {
            //height: 100vh;
        }
    </style>
</head>
<body>
<br>
	<div class="ts container">
	<div class="ts bottom attached vertical menu">
	<div class="item" style="background-color:#fcbdbd;"><i class="caution icon"></i>Do not close this page until all installation have been finished.</div>
	<?php
	$ids = [];
	$template = '<div id="%ID%" class="item" decodedName="%DECNAME%">
				<div class="ts comments">
					<i class="disk outline icon"></i>%CONTENT%
					<div id="%ID%_progress" class="sub header"><i class="clock icon"></i>Install Pending...</div>
				</div>
				</div>';
	$files = glob('uploads/*.zip', GLOB_BRACE);
	foreach($files as $file) {
		$filename = basename($file,".zip");
		$decodedName = hex2bin(substr($filename,5));
		$box = str_replace("%ID%",substr($filename,5),$template);
		$box = str_replace("%DECNAME%",$decodedName,$box);
		array_push($ids,substr($filename,5));
		$box = str_replace("%CONTENT%","$file / $decodedName",$box);
		echo $box;
	}

	?>
	</div>
	</div>
	<script>
	var installTask = <?php echo json_encode($ids);?>;
	var redirectType = "<?php if (isset($_GET['rdt'])){echo $_GET['rdt'];}else{ echo " ";}?>";
	var progress = 0;
	if (installTask.length == 0){
		returnToPreviousPage();
	}else{
		installNextModule();
	}
	
	function returnToPreviousPage(){
		if (redirectType == "um"){
			window.location.href = "index.php";
		}else if (redirectType == "aorw"){
			window.location.href = "../SystemAOB/functions/system_management/addOrRemoveWebApp.php";
		}else{
			window.location.href = "../";
		}
	}
	
	function installNextModule(){
		if (progress >= installTask.length){
			//Finished installing
			$.get( "cleanUploads.php" + name, function(result) {
				returnToPreviousPage();				
			});
		}
		
		updateStatus(progress,'<i class="circle notched loading icon"></i>Unpacking WebApp',"#f9fcbd");
		$.get( "unzip_module.php?moduleFilename=uploads/inith" + installTask[progress] + ".zip", function(result) {
			if (result.includes("ERROR") == false){
				//No problem with the unzip process
				updateStatus(progress,'<i class="circle notched loading icon"></i>Installing WebApp',"#bdc6fc");
				//alert($("#" + installTask[progress]).attr("decodedName") + " unzip done");
				MoveUnzippedWebApp($("#" + installTask[progress]).attr("decodedName"));
			}else{
				console.log(result);
				updateStatus(progress,'<i class="remove icon"></i>Error when unzipping WebAPP.',"#fcbdbd");
				progress++;
				installNextModule();
			}
		});
	}
	
	function MoveUnzippedWebApp(name){
		$.get( "install_module_from_unzip.php?moduleName=" + name, function(result) {
			if (result.includes("ERROR") == false){
				//No problem with the unzip process
				updateStatus(progress,'<i class="checkmark icon"></i>Installation Completed',"#bdfcc1");
				progress++;
				installNextModule();
			}else{
				console.log(result);
				updateStatus(progress,'<i class="remove icon"></i>Error when installing WebAPP.',"#fcbdbd");
				progress++;
				installNextModule();
			}
		});
		
	}
	
	function updateStatus(progressNum,text,color){
		$("#" +  installTask[progressNum] + "_progress").html(text);
		$("#" +  installTask[progress]).css("background-color",color);
	}
	
	$(document).ready(function(){
		console.log(installTask);
	});
	
	</script>
</body>
</html>