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
<br><br>
	<div class="ts container">
		<img class="ts small image" src="img/logo.png">
		<div class="ts divider"></div>
		<div class="ts header">
			ArOZ Online System - User Authentication
			<div class="sub header">Sign in with your ArOZ Online username and password</div>
		</div>
		<div class="ts divider"></div>
		<br>
		<form class="ts form" action="compatibility_auth.php">
			<div class="field">
				<label><i class="user icon"></i> Username</label>
				<input type="text" name="username">
			</div>
			<div class="field">
				<label><i class="key icon"></i> Password</label>
				<input type="password" name="password">
			</div>
			<button class="ts primary button" name="submit">Sign In</button>
		</form>
		<?php
			if (isset($_GET['err'])){
				$errMsg = $_GET['err'];
				echo '<div class="ts inverted negative segment">
						<p><i class="remove icon"></i> ' . $errMsg . '</p>
					</div>';
			}
		?>
		<br><br>
		<div class="ts divider"></div>
		<p><i class="notice icon"></i>You are launching ArOZ Online System in compatibility mode. Some function might be limited in your current browser. <br>We recommending using a modern browser like Firefox.</p>
	</div>
</body>
</html>