<?php
include '../auth.php';
?>
<html>
<head>
<title>ArOZ Mirror</title>
<meta charset="UTF-8">
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
</head>
<body>
<br><br><br><br><br>
<div class="ts text container">
<div id="maindiv" class="ts segment">
    <h4><i class="caution sign icon"></i>ArOZ Module Warning</h4>
	<h6>Module Directory: <?php echo basename(__DIR__);?></h6>
    <p>This function might need Internet Access permission.
	<br>If you proceed to the module, it means you have agreed to give the module the following permissions:</p>
	<div class="ts secondary segment">
		<p><i class="checkmark icon"></i>Internet Connection Permission</p>
		<p><i class="checkmark icon"></i>Read System Time</p>
		<p><i class="checkmark icon"></i>Write data into localStorage</p>
		<p><i class="checkmark icon"></i>Responsible for all internet fee accounting to the module's internet access.</p>
	</div>
    <p>ArOZ Online BETA System cannot ensure your data is secured during the connection.
	<br>Please use this module with your own risk.
	<br>You can always change your mind by removing the setting in localStorage within your browser.
	</p>
	<p>Click the confirm button below to proceed.</p>
	<a onClick="ConfirmBtn();" class="ts small basic positive button">Confirm</a>
	<a onClick="noInternet();" class="ts small basic basic button">Go without Internet</a>
	<a href="../" class="ts small basic negative button">Cancel</a>
</div>
</div>
<script>
//This script is used to store the informatio of if the user confirmed before or not.
if (localStorage.getItem("Mirror.Confirm") == null){
	//The user has never confirm before
}else if(localStorage.getItem("Mirror.Confirm") == 'true'){
	$('#maindiv').html("<h4>Standby!</h4><br>Loading Weather Information from the network...<br>If you get stuck in this page, check if your network connection is working or not :)");
	if(navigator.onLine) {
		window.location.href = "main.php";
	}else{
		$('#maindiv').html("<h4>Something went Wrong!</h4><br>You need internet access to use this module.");
	}
	
	
}

function ConfirmBtn(){
	//localStorage.setItem("Mirror.Confirm",'true');
	window.location.href="main.php";
}

function noInternet(){
	//Launch module without internet. Mainly for screen saver I guess?
	window.location.href="offline.php";
}
</script>

</body>
</html>