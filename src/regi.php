<?php

function showerror($msg){
	header("Location: regi.php?msg=" . $msg);
	exit(0);
}
header('aoAuth: v1.0');
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}

$databasePath = "";
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		$rootPath = "C:/AOB/";
	}else{
		$rootPath = "/etc/AOB/";
}
if (filesize("root.inf") > 0){
	//Use the special path instead.
	$rootPath = trim(file_get_contents("root.inf"));
}
$databasePath = $rootPath . "whitelist.config";
$content = "";
$regexists = false;
if (file_exists($databasePath)){
	include_once("auth.php");
	//If the user is able to continues to proceed, that means the user has right to use this system
	$content = file_get_contents($databasePath);
	$regexists = true;
}else{
	//There is no user registration yet. Create one
}
//See if this page is requested for command.
$errormsg = "";
if (isset($_POST['act']) && $_POST['act'] != ""){
	$action = $_POST['act'];
	if ($action == "newuser"){
		if (isset($_POST['username']) && isset($_POST['secretecode'])){
			$newusername = $_POST['username'];
			$password = $_POST['secretecode'];
			if ($password == ""){
				showerror("Password cannot be empty!");
			}
			$encodedpw = hash('sha512',$password);
			$content = trim($content);
			$users = explode(PHP_EOL,$content);
			$usernameexists = false;
			foreach ($users as $userdata){
				$username = explode(",",$userdata)[0];
				if (strtolower($username) == strtolower($newusername)){
					$usernameexists = true;
				}
			}
			if ($usernameexists){
				$errormsg = "Username already exists.";
				showerror($errormsg);
			}else{
				$encodedpw = strtoupper($encodedpw);
				file_put_contents($databasePath,$newusername . "," . $encodedpw . PHP_EOL,FILE_APPEND);
				header("Location: regi.php?msg=New user added.");
				exit(0);
			}
			
		}
	}else if ($action == "rmvuser"){
		if (isset($_POST['username'])){
			$targetusername = $_POST['username'];
			$content = trim($content);
			$users = explode(PHP_EOL,$content);
			$allowedusers = [];
			foreach ($users as $userdata){
				$username = explode(",",$userdata)[0];
				if (strtolower($username) == strtolower($targetusername)){
					
				}else{
					array_push($allowedusers,$userdata);
				}
			}
			$newcontent = implode(PHP_EOL,$allowedusers);
			$newcontent .= PHP_EOL;
			if (count($allowedusers) == 0){
				unlink($databasePath);
			}else{
				file_put_contents($databasePath,$newcontent);
			}
			die("DONE");
		}else{
			die("ERROR. username not defined for act=rmvuser");
		}
		
	}
	
	exit(0);
}
?>
<html>
<!DOCTYPE HTML>
<head>
<meta name="viewport" content="width=device-width, initial-scale=0.7, shrink-to-fit=no">
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="script/tocas/tocas.css">
<script src="script/tocas/tocas.js"></script>
<script src="script/jquery.min.js"></script>
</head>
<body>
<!--
    <nav id="topbar" class="ts attached inverted borderless large menu">
        <div class="ts narrow container">
            <a href="" class="item">ArOZ Online β</a>
        </div>
    </nav>
-->
	<br><br><br>
	<div class="ts container">
		<h3 class="ts header">
			<i class="privacy icon"></i>
			<div class="content">
				ArOZ Online Authentication Register
			</div>
		</h3>
		<!-- New user adding form-->
		<div id="newuser" class="ts container" style="display:none;">
			<form class="ts small form" action="regi.php" method="POST">
				<div class="field">
					<label>Username</label>
					<input name="username" type="text">
				</div>
				<div class="field">
					<label>Password</label>
					<input id="passwordfield" name="secretecode" type="password">
				</div>
				<input name="act" type="text" value="newuser" style="display:none;">
				<code>Please login to your new account after you have added the first new user.</code><br><br>
				<div class="ts warning button" onmousedown="showpw();" onmouseup="hidepw();"><i class="unhide icon"></i>Show Password</div>
				<button class="ts primary button" type="submit" value="Submit"><i class="add user icon"></i>Add user</button>
				
			</form>
		</div>
		<!-- Message Box-->
		<?php
			if (isset($_GET['msg'])){
				echo '<div id="returnedmsg" class="ts secondary primary message">
						<div class="header">Message</div>
						<p>'.$_GET['msg'].'</p>
					</div>';
			}
		?>

		<!-- List of user -->
		<p>List of registered users for this system</p>
		<div class="ts divider"></div>
		<div class="ts segmented list">
		<?php
		$content = trim($content);
		if ($content != ""){
			$users = explode(PHP_EOL,$content);
			foreach ($users as $userdata){
				$username = explode(",",$userdata)[0];
				echo '<div class="item"><i class="user icon"></i>'.$username.'</div>';
			}
		}
		?>
		</div>
		<div style="width:100%;" align="right">
			<div class="ts buttons">
				<button class="ts primary button" onClick='$("#newuser").show();'><i class="add user icon"></i>New User</button>
				<button class="ts warning button" onClick="removeUser();"><i class="remove user icon" ></i>Remove User</button>
			</div>
		</div>
		<a id="backBtn" href="index.php">Back to index</a>
		<div class="ts divider"></div>
		ArOZ Online Authentication System feat. IMUS Laboratory
	</div>
	<script>
	var selectedUser = "";
	setTimeout(function(){ hideMsgBox(); }, 5000);
	
	if (parent.underNaviEnv){
		$("#backBtn").hide();
	}
	
	function hideMsgBox(){
		if($("#returnedmsg").length == 0) {
		  
		}else{
			$("#returnedmsg").fadeOut(1000);
		}
	}
	
	function removeUser(){
		if (selectedUser != ""){
			if (confirm("Are you sure you want to remove user: " + selectedUser) == true){
				$.post( "regi.php", { username: selectedUser, act: "rmvuser" })
				  .done(function(data){
					window.location.href="regi.php?msg=User Removed";
				  });
			}
		}
		
	}
	
	function showpw(){
		$("#passwordfield").attr("type","text");
	}
	
	function hidepw(){
		$("#passwordfield").attr("type","password");
	}
	
	$(".item").click(function(){
		$(".item").each(function(){
			$(this).removeClass("selected");
		});
		$(this).addClass("selected");
		selectedUser = $(this).text();
	});
	</script>
</body>
</html>
