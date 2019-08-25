<?php
include '../auth.php';
?>
<html>
<head>
<title>AOB File Explorer Redirection Module</title>
<link rel="stylesheet" href="../script/tocas/tocas.css">
</head>
<body>
<?php
$redirect = false;
if (file_exists("../SystemAOB/functions/file_system/index.php") && file_exists("../SystemAOB/functions/file_system/embedded.php")){
	$redirect = true;
}else{
	$redirect = false;
}

?>
<br><br>
<div class="ts container">
Loading ArOZ Online Beta Virtual File Explorer<br><br>
If you get stuck on this page, please make sure your browser support javascript.<br>
Click <a href="../SystemAOB/functions/file_system/embedded.php">here</a> to redirect manually.
</div>
<script>
var redirect = <?php echo $redirect ? "true" : "false";?>;
if (redirect == false){
	alert("Error when launching file explorer. SystemAOB/functions/file_system/index.php not found.");
	window.location.href = "../"; //Back to index
}
if (redirect == true){
	if (parent.isFunctionBar == true){
		//This module is launched inside vdi, use float window instead.
		var uid = Math.floor((Math.random() * 100) + 1);
		var target = "SystemAOB/functions/file_system/embedded.php?controlLv=2";
		parent.newEmbededWindow(target,'File Explorer','folder',"vfe-" + uid, 1080, 580, 0, 0);
		window.history.back();
	}else{
		//This module is launched inside sgl, use url redirect
		var target = "SystemAOB/functions/file_system/index.php?controlLv=2";
		window.location.href="../" + target;
	}
}
</script>
</body>
</html>