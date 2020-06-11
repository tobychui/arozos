<?php
include '../auth.php';
$useSystemProperties = file_exists("../SystemAOB/functions/file_system/properties.php");
if ($useSystemProperties){
    header("Location: " . "../SystemAOB/functions/file_system/properties.php?filename=" . realpath($_GET["file"]));
}
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<title>7z File Manager</title>
	<style>
	body{
		background-color:white
	}
	.ts.form .inline.field label {
		min-width: 50%;
	}
	.ts.basic.dropdown, .ts.form select {
		max-width: 50%;
	}
	</style>
</head>
<body>
<br>
	<div class="ts container">
		<h3>File information</h3>
		<br>File name: <?php echo $_GET["file"];?>
		<br>File size: <?php echo filesize($_GET["file"]);?>b
		<br><button class="ts basic button" style="width:45%" onclick="f_close()">Cancel</button>
	</div>
</body>
<script>
function f_close(){
	if(ao_module_virtualDesktop){
		ao_module_close();
	}else{
		ts('#modal').modal('hide');
	}		
}
</script>
</html>
