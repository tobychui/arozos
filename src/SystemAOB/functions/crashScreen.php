<?php
include '../../auth.php';
?>
<html>
<head>
<!-- Redirect to this page in iframe inorder to let the floatWindow host system kill this window-->
<title>Something Crashed :(</title>
<link rel="stylesheet" href="../../script/tocas/tocas.css">
</head>
<body style="background-color:#0f0030;color:white;">
<br><br>
<div class="ts container">
	<h2 class="ts header">
		<i style="color:white;" class="lemon icon"></i>
		<div class="content" style="color:white;">
			Seems something has crashed.
			<div class="sub header"  style="color:white;">When a system gives you lemons, make lemonade for the programmer.</div>
		</div>
	</h2>
	Here are some error message sent from the WebApp before it crashs.
	<div class="ts divider"></div>
	<?php 
		if (isset($_GET['errormsg']) && $_GET['errormsg'] != ""){
			echo $_GET['errormsg'];
		}else{
			echo "No error message was received from module.";
		}
	?>
	<br><br><br>
	<div class="ts divider"></div>
	ArOZ Online System, Crash Screen Debug Interface 2018
</div>

</body>
</head>