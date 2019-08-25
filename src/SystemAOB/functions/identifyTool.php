<?php
include '../../auth.php';
?>
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
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../script/tocas/tocas.css">
<script src="../../script/tocas/tocas.js"></script>
<script src="../../script/jquery.min.js"></script>
</head>
<body>
<?php
//Connect to Pi-DB
$PiDBExists = false;
if (file_exists("../../Pi-DB/") == true){
	$PiDBExists = true;
	echo '<script src="../../script/Pi-DB.js"></script>';
}
?>
	<div class="ts narrow container">
	<br>
		<div id="changeidentity" class="ts centered secondary segment" style="display: none;">
		<div class="ts grid">
			<!-- User information -->
			<div class="five wide column">
			<div class="ts slate">
			<i class="user icon"></i>
				<span class="ts tiny header">Current User</span>
				<span class="description" id="currentUsername">Connecting...</span>
			</div>
				<a onClick="ClearIdentification();" style="cursor: pointer;">Logout</a>
			</div>
			<!-- Re-identify function -->
			<div class="eleven wide column">
			<div class="ts container">
			<p>Wanna change your nick name?</p>
			<div class="ts form">
				<i class="user icon"></i>Set Display Name
                <div class="ts fluid input">
                    <input id="changeUsername" type="text" placeholder="Username" name="username">
                </div>
				<br><br>
				<!-- 
				<i class="asterisk icon"></i>PIN
				<div class="ts fluid input">
                    <input type="changePassword" placeholder="PIN" name="PIN">
                </div>
				<br><br>
				-->
				<details class="ts accordion">
				<summary>
					<i class="dropdown icon"></i> What is Display Name?
				</summary>
				<div class="content">
					<p style="font-size:90%">Display name (identification cache) is one of the ArOZ Online features provide multiple user's resources to one single actual user by changing the user's cached username in browser localStorage.<br>
					Different modules might react differently to additional username. For example, Desktop module will create an extra Desktop environment for your display name other than the original "real" username. However, not all module make use of this system and provide multiple resources to single user. </p>
					</div>
				</details>
                <button class="ts basic positive fluid button" onClick="ChangeIdentification();">Update</button>
				

            </div>
			</div>
			</div>
			<p id="lastlogin">Last Login: ...</p>
		</div>
		</div>
        <div id="newIdentity" class="ts centered secondary segment">

            <div class="ts form">
                <div class="field">
                    <label><i class="user icon"></i>Username for Display</label>
                    <input id="arozusername" type="text" placeholder="Username" name="username">
                </div>
				<!-- 
				<div class="field">
                    <label><i class="asterisk icon"></i>PIN number</label>
                    <input type="password" placeholder="PIN" name="PIN">
                </div>
				-->
                <button class="ts basic positive fluid button" onClick="SaveIdentification();">Update</button>

            </div>
		
        </div>
		<div id="reminderText" class="ts raised segment">
			<h4><i class="question circle icon"></i>What is Display Name? Is it the same as login?</h4>
			<p><i class="notice circle icon"></i>You can choose if you want to show your name in the form of nick name or not. If you choose not to show your display name, your login username will be used instead.</p>
			
		</div>
		<br>
    </div>
	<script>
	var current_Identified = false;
	var PiDBExists = <?php echo $PiDBExists;?>;
	var userIP = "<?php echo $_SERVER['REMOTE_ADDR'];?>";
	var db = new PiDB("../../Pi-DB/","db/system");
	var session_username = "<?php echo $_SESSION['login'];?>";
	var acList = [];
	var VDI = !(!parent.isFunctionBar);
	if (PiDBExists == true){
		$.when(db.request('SELECT * FROM user_activity.csv')).done(function (x){
			//console.log(x);
			acList = x;
		});
	}
	if (localStorage.ArOZusername == null || localStorage.ArOZusername == ""){
		//No username found
		//alert(localStorage.ArOZusername);
	}else{
		//there already exists username in the storage data
		//alert(localStorage.username);
		$('#newIdentity').hide();
		$('#changeidentity').show();
		$('#currentUsername').html(localStorage.ArOZusername).append("(" + session_username + ")");
		$("#reminderText").hide();
		GetLastLoginTime(localStorage.ArOZusername);
	}
	
	function ClearIdentification(){
		localStorage.setItem("ArOZusername","");
		if (VDI){
			window.top.location.href = "../../logout.php";
		}else{
			window.location.href = "../../logout.php";
		}
		
	}
	
	function SaveIdentification(){
		//alert($('#arozusername').val());
		var username = $('#arozusername').val();
		localStorage.setItem('ArOZusername',username.replace(/<(?:.|\n)*?>/gm, ''));
		logRecord(username);
	}
	
	function ChangeIdentification(){
		var username = $('#changeUsername').val();
		localStorage.setItem('ArOZusername',username.replace(/<(?:.|\n)*?>/gm, ''));
		logRecord(username);
	}
	
	function GetLastLoginTime(username){
		$.when(db.request('SELECT * FROM user_activity.csv')).done(function (x){
			var acList = x;
			var largest = 0;
			for (var i =0; i < acList.length;i++){
				if (acList[i][1] == username){
					if (acList[i][0] > largest){
						 largest = acList[i][0];
					}
				}
			}
			$("#lastlogin").html("Last Login: " + TimeStampToTime(largest));
		});
	}
	
	function TimeStampToTime(unix_timestamp){
		var date = new Date(unix_timestamp*1000);
		var month = date.getUTCMonth() + 1;
		var day = date.getUTCDate();
		var year = date.getUTCFullYear();
		var hours = date.getHours();
		var minutes = "0" + date.getMinutes();
		var seconds = "0" + date.getSeconds();
		var formattedTime = day + "/" + month + "/" + year + " " + hours + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
		return formattedTime;
	}
	
	function logRecord(username){
		if (PiDBExists == true){
		$.when(db.write('INSERT INTO user_activity.csv VALUES ' + time() + "," + username + "," + userIP)).done(function (x){
			if (x.includes("DONE")){
				//Refresh when done writing to log
				window.location.href = window.location.href;
			}else{
				alert("ERROR\n" + x);
			}
		});
		}
	}
	
	function time(){
		return Math.floor(Date.now() / 1000);
	}
	
	document.getElementById("arozusername").addEventListener("keyup", function(event) {
		event.preventDefault();
		if (event.keyCode === 13) {
			SaveIdentification();
		}
	});
	
	document.getElementById("changeUsername").addEventListener("keyup", function(event) {
		event.preventDefault();
		if (event.keyCode === 13) {
			ChangeIdentification();
		}
	});
	</script>
</body>
</html>