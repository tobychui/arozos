<!DOCTYPE HTML>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=0.7, shrink-to-fit=no">
<title>ArOZ Onlineβ User Authentication</title>
<link rel="stylesheet" href="script/tocas/tocas.css">
<script src="script/paperjs/paper-full.min.js"></script>
<script src="script/tocas/tocas.js"></script>
<script src="script/jquery.min.js"></script>
<?php
//This is a script for checking config files as the standard checking method requires user to be authed first.
if (file_exists("SystemAOB/functions/personalization/sysconf/login.config")){
    $settings = json_decode(file_get_contents("SystemAOB/functions/personalization/sysconf/login.config"),true);
    $bgi = $settings["background-image"][3];
    $ipdebug = $settings["enable-ipdebug"][3] == "true";
    $themeColor = $settings["theme-color"][3];
    $titleImg = $settings["title-image"][3];
}else{
    $bgi = "img/background3.png";
    $ipdebug = true;
    $themeColor = "#007f78";
    $titleImg = "img/auth_icon.png";
}
?>
<style>
@media only screen and (max-height: 1000px) {
    .leftPictureFrame {
     height:auto !important;
    }
}

.leftPictureFrame{
	position:fixed;
	top:0px;
	left:0px;
	min-width:calc(100% - 500px);
	min-height:100%;
	background-color:#faf7eb;
	background-image:url("<?php echo $bgi; ?>");
	-webkit-background-size: cover;
	-moz-background-size: cover;
	-o-background-size: cover;
	background-size: cover;
	background-repeat: no-repeat, no-repeat;
	background-position:bottom left;
}

.rightLoginFrame{
	position:fixed;
	top:0;
	right:0;
	height:100%;
	width:500px;
	background-color:white;
	z-index:100%;
	padding-left: 50px;
	padding-right: 30px;
}

.fullHeightImage{
	height:100% !important;
	position:relative;
	left:-20px;
	
}

.bottombar{
	position:absolute;
	bottom:0;
	left:0;
	padding-left: 20px;
	width:100%;
}

#animationFrame{
	position:absolute;
	bottom:0px;
	width:100%;
}
#preload-01 { background: url(http://img/background2.jpg) no-repeat -9999px -9999px; }
</style>
</head>
<body>
	<img id="mascot" src="img/login_mascot.png" style="display:none;"></img>
	<div class="leftPictureFrame">
		
	</div>
	<div id="loginInterface" class="rightLoginFrame">
	<br><br><br>
		<img class="ts medium image" src="<?php echo $titleImg;?>">
		<br><br>
		<p><i class="privacy icon"></i>Sign in with your ArOZ Online username and password</p>
		<?php //print_r($_COOKIE); //Debug only
			$autoLogin = true;
		?>
		<br>
		<div class="ts fluid input textbox">
			<input id="username" type="text" placeholder="Username" style="border-radius: 0px !important;" value="<?php 
			if (isset($_COOKIE['username']) && $_COOKIE['username'] != ""){
				echo $_COOKIE['username'];
			}else{
				$autoLogin = false;
			}
			?>">
		</div>
		<br><br>
		<div class="ts fluid input textbox">
			<input id="password" type="password" placeholder="Password" style="border-radius: 0px !important;" value="<?php 
			if (isset($_COOKIE['password']) && $_COOKIE['password'] != ""){
				echo $_COOKIE['password'];
			}else{
				$autoLogin = false;
			}
			?>">
		</div>
		<br><br>
        <div class="ts checkbox">
		<?php
			//echo ($autoLogin ? "true" : "false");
			if ($autoLogin){
				echo '<input id="rmbme" name="rememberMe" type="checkbox" checked>';
			}else{
				echo '<input id="rmbme" name="rememberMe" type="checkbox">';
			}
		?>
            
            <label for="rmbme">Keep Me logged In</label>
        </div><br><br>
		<div id="errmsg" style="color:<?php echo $themeColor; ?>;"></div>
		<br>
		<button class="ts primary button" style="background-color:<?php echo $themeColor; ?>;border-width: 0px;" onClick="postLogin();">Sign In</button>
		<?php
		$template = '<div class="ts outlined message">
			<div id="logoutmsg" style="color:#3fb7e2;"><i class="log out icon"></i>You have been logged out.</div>
		</div>';
		if (isset($_GET['logout'])){
			echo $template;
		}
		?>
		
		<div class="bottombar">
		© ArOZ Online Project 2019 feat. <a href="http://imuslab.com/" target="_blacnk">IMUS Laboratory</a><br>
		<div style="display:inline;font-size:80%;"><?php 
		if ($ipdebug){
		    echo "<i class='disk outline icon'></i> " . $_SERVER['SERVER_NAME'] . ' ⇄ <i class="laptop icon"></i>' . $_SERVER['REMOTE_ADDR'];
		}
		?></div>
		<br><br>
		</div>
	</div>
	
<script>
var session_login = <?php echo ($autoLogin)? "true" : "false"; ?>;
window.mobilecheck = function() {
  var check = false;
  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
  return check;
};
if (window.mobilecheck() == true){
	$("#loginInterface").css("width","100%");
}

$(document).ready(function(){
	if (session_login){
		postLogin();
	}
});

function postLogin(){
	$.ajax({
	  type: "POST",
	  url: "auth.php",
	  data: {username:$("#username").val(),apwd:$("#password").val(),rmbm:$("#rmbme").val()}
	}).done(function( data ){
		console.log(data);
		if (data.includes("ERROR")){
			if (data.includes("Username not find")){
				$("#username").parent().addClass("error");
				$("#password").parent().removeClass("error");
				showErrorMsg("<i class='close icon'></i> Username not found.");
			}else if (data.includes("Password incorrect")){
				$("#password").parent().addClass("error");
				$("#username").parent().removeClass("error");
				showErrorMsg("<i class='close icon'></i> Password incorrect.");
			}
		}
		if (data.includes("DONE")){
			//Data contain DONE. Try to perform redirection
			localStorage.setItem("ArOZusername", $("#username").val());
			//Prase the URL in which it might contains multiple &
				var actualRedirectURL = window.location.href;
				actualRedirectURL = actualRedirectURL.split("=");
				actualRedirectURL.shift();
				actualRedirectURL = actualRedirectURL.join("=");
				if (actualRedirectURL.substring(actualRedirectURL.length - 1, actualRedirectURL.length) == "?"){
					actualRedirectURL = actualRedirectURL.substring(0,actualRedirectURL.length - 1);
				}
				if (actualRedirectURL == ""){
					window.location.href="index.php";
				}else{
					//Redirect check
					try{
						window.location.href=actualRedirectURL;
						return
					}catch(err){
						window.location.href="index.php";
					}
				}
			
			
		}
	});
}

$('#password').keyup(function(e){
    if(e.keyCode == 13)
    {
        postLogin();
    }
});

$('#username').keyup(function(e){
    if(e.keyCode == 13){
        $('#password').focus();
    }else if (e.keyCode == 9){
		$('#password').focus();
	}
});


$.urlParam = function(name){
	var results = new RegExp('[\?&#]' + name + '=([^&]*)').exec(window.location.href);
	if (results == null || results == undefined){
		return "index.php";
	}
	return results[1] || 0;
}

function showErrorMsg(text){
	$("#errmsg").html(text);
}
var selectedCircle = "\u26AA";
var emptyCircle = "\u25EF";

$("#btn1").click(function(){
	$("#btn1").text(selectedCircle);
	$("#btn2").text(emptyCircle);
	$("#bgimage").fadeOut('fast',function(){
		$("#bgimage").attr("src","img/background.jpg").delay(500).fadeIn('slow');
	})
});
$("#btn2").click(function(){
	$("#btn1").text(emptyCircle);
	$("#btn2").text(selectedCircle);
	$("#bgimage").fadeOut('fast',function(){
		$("#bgimage").attr("src","img/background2.jpg").delay(500).fadeIn('slow');
	})
});

//Left pictureframe animation

</script>
</body>
</html>