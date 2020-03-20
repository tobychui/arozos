<!DOCTYPE HTML>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<title>ArOZ Onlineβ User Authentication</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../cript/jquery.min.js"></script>
</head>
<body>
<div class="ts container">
	<br><br>
	<div class="ts segment">
		<a href="login.php" style="cursor:pointer;">Click here to Retry</a>
		<p>Error Message: </p>
		<br>

<?php
/*
Compatibility Auth Mode, support IE11 and some even older browsers for login in purpose.

*/
if (isset($_GET['username']) && !empty($_GET['username']) && isset($_GET['password']) && !empty($_GET['password'])){
	$username = $_GET['username'];
	$password = $_GET['password'];
	
	//Move GET paramter to POST and clear get values
	$_POST['username'] = $username;
	$_POST['apwd'] = $password;
	$_POST['rmbm'] = "off"; //Cannot remember me on legacy browsers
	$_POST['redirect'] = "../../../index.php"; //Force redirection after auth
	$_POST['legacyMode'] = true;
	chdir("../../../");
	include_once("auth.php");
}else{
	header("Location: login.php?err=Username or password cannot be empty.");
}
?>
	</div>
</div>
</body>
</html>