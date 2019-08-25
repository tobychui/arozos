<?php
include("../../../auth.php");

if (isset($_GET['remove']) && $_GET['remove'] != ""){
	$uuid = str_replace("../","",$_GET['remove']);
	if (file_exists("tokenDB/" . $uuid . ".atok")){
		unlink("tokenDB/" . $uuid . ".atok");
	}else{
		die("ERROR. Required token not found or have been removed.");
	}
	exit(0);
}

?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>ShadowJWT</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            .shadowed{
                padding:20px !important;
                -webkit-box-shadow: 11px 8px 15px -3px rgba(0,0,0,0.2);
                -moz-box-shadow: 11px 8px 15px -3px rgba(0,0,0,0.2);
                box-shadow: 11px 8px 15px -3px rgba(0,0,0,0.2);

            }
			.centered{
				top:5%;
				bottom:5%;
				left:5%;
				right:5%;
				position:fixed !important;
				z-index:99;
			}
        </style>
    </head>
    <body>
	<br><br>
		<div class="ts container">
			<div class="ts segment">
				<div class="ts header">
					ShadowJWT
					<div class="sub header">Give other applications your permission to do stuffs.</div>
				</div>
			</div>
			<div class="ts segment">
			<p>New Token<br>
			Please enter an expire time (in seconds) for the token. Leave empty for 3600 seconds or 0 for never expire.</p>
				<div class="ts labeled fluid action input">
					<input id="expireTime" type="number" min="0" >
					<div class="ts basic label">@ <?php echo $_SESSION['login'];?></div>
					<button class="ts primary button" onClick="createToken();">Create</button>
				</div>
			</div>
			<div class="ts segment">
				<div>
					<p>A list of local generated tokens</p>
					<div class="ts ordered list">
					<?php
						//Get a list of local generated tokens
						$tokens = glob("tokenDB/*.atok");
						foreach ($tokens as $token){
							$tokenUID = basename($token, ".atok");
							$tokenInfo = json_decode(file_get_contents($token),true);
							$warning = false;
							if ($tokenUID != $tokenInfo[0]){
								//This token might be renamed. Beware of force injected token!
								$warning = true;
							}
							$tokenName = substr($tokenInfo[0],0,15) . "..." . substr($tokenInfo[0],-10);
							$expireDate = $tokenInfo[2];
							if ($expireDate == 0){
								$expireDate = "Forever";
							}else if ($tokenInfo[1] + $expireDate < time()){
								$expireDate = convertUnixTimeToDateTime($tokenInfo[1] + $tokenInfo[2]) . ' (Expired)';
							}else{
								$expireDate = convertUnixTimeToDateTime($tokenInfo[1] + $expireDate);
							}
							
							echo '<div class="item" tokenInfo=' . "'" . file_get_contents($token) . "'" . '>' . $tokenName . " / Valid Date: " . convertUnixTimeToDateTime($tokenInfo[1])  . " to ". $expireDate . ' &nbsp <i class="remove icon" onClick="removeThis(this);" style="cursor:poiner;"></i></div>';
						}
						
						function convertUnixTimeToDateTime($timestamp){
							$date = date_create();
							date_timestamp_set($date, $timestamp);
							return date_format($date, 'Y-m-d H:i:s');
						}
					?>
					</div>
				</div>
				
			</div>
			
			<details class="ts accordion">
				<summary>
					<i class="dropdown icon"></i> What is ShadowJWT
				</summary>
				<div class="content">
					<p>JWT, aka Json Web Token, is a method used in ArOZ Online System for external authentication without cookies. It is mainly designed for background tasks or daemons, hence the name Shadow.
To use token for authentication, create a php script and include shadow.php like the auth.php. Then call the script with an extra parameter "token" with the generated token to successfully authenticate.</p>
				</div>
			</details>
		</div>
		<div id="tokenTab" class="ts segment centered" style="display:none;">
			<div class="ts header">
				Generated Token
				<div class="sub header">This token will only be shown once. Please store this in a secured location.</div>
			</div>
			<div class="ts fluid input">
				<textarea id="tokenShowroom" placeholder="Token Value" rows="5"></textarea>
			</div>
			<br><br>
			<p style="">Please make sure the application that is using the token has been successfully connected to the server before closing this tab. <br>THE TOKEN VALUE WILL ONLY BE SHOWN ONCE AND PLEASE STORE IT IN A SAFE LOCATION.</p>
			<button class="ts negative button" onClick="closeTokenTab();">Close Tab</button>
		</div>
		<script>
		
		function closeTokenTab(){
			if (confirm("Confirm closing of the Token?")){
				$("#tokenTab").hide();
				$("#tokenShowroom").val("");
				window.location.reload();
			}
			
		}
		
		function createToken(){
			var exp = $("#expireTime").val();
			if (exp == 0){
				$.get("create.php",function(data){
					showToken(data);
				});
			}else{
				$.get("create.php?exp=" + exp,function(data){
					showToken(data);
				});
			}
		}
		
		function showToken(data){
			$("#tokenShowroom").val(data["token"]);
			$("#tokenTab").show();
		}
		
		function removeThis(object){
			var jwtInfo = JSON.parse($(object).parent().attr("tokenInfo"));
			var uuid = jwtInfo[0];
			$.get("index.php?remove=" + uuid,function(data){
				if (data.includes("ERROR") == true){
					alert(data);
				}else{
					window.location.reload();
				}
			});
		}
		</script>
	</body>
	
</html>