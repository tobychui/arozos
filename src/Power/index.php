<?php
include '../auth.php';
?>
<html>
<head>
<title>AOB Power Options</title>
<link rel="stylesheet" href="../script/tocas/tocas.css">
</head>
<body>
<?php
$redirect = false;
if (file_exists("../SystemAOB/functions/power/index.php")){
	$redirect = true;
}else{
	$redirect = false;
}

?>
<br><br>
<div class="ts container">
Loading ArOZ Online Power Management Page<br><br>
If you get stuck on this page, please make sure your browser support javascript.<br>
Click <a href="../SystemAOB/functions/power/index.php">here</a> to redirect manually.
</div>
<script>
var redirect = <?php echo $redirect ? "true" : "false";?>;
if (redirect == false){
	alert("Error when launching power menu. SystemAOB/functions/power/index.php not found.");
	window.location.href = "../"; //Back to index
}
if (redirect == true){
	if (parent.isFunctionBar == true){
		//This module is launched inside vdi, use float window instead.
		var uid = Math.floor((Math.random() * 100) + 1);
		var target = "SystemAOB/functions/power/index.php?mode=embedded";
		parent.newEmbededWindow(target,'Power','power cord',"pow-" + uid, 590, 680, 0, 0);
		window.history.back();
	}else{
		//This module is launched inside sgl, use url redirect
		var target = "SystemAOB/functions/power/index.php";
		window.location.href="../" + target;
	}
}
</script>
</body>
</html>