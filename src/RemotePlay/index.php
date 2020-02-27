<?php
include_once '../auth.php';
if (isset($_GET['filepath'])){
	header("Location: embedded.php?filepath=" . $_GET['filepath'] . "&filename=" . $_GET['filename']);
}
?>
<html>
<head>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script src="../script/tocas/tocas.js"></script>
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	<script src="../script/jquery.min.js"></script>
	<script src="../script/ao_module.js"></script>
	<link rel="manifest" href="manifest.json">

	
	<style>
	body{
		background-color:#0c0c0c;
		color:white;
	}
	.white{
		color:white !important;
	}
	.bottom{
		position:fixed;
		width:100%;
		height:35px;
		left:0px;
		bottom:0px;
		padding-bottom:5px;
		padding: 5px;
	}

	</style>
	</head>
<?php
$rid = rand(1000,9999);
?>
<body>
<br>

</body>
<script>

//may need update after iPadOS update.
var iOS = !!navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform);
var currDisplay = "idle";

var video = document.getElementById("video");
var audio = new Audio("");

loadScreen();
var rid = $("#rid").text().trim();
ao_module_setWindowSize(395,520);
ao_module_setWindowTitle("RemotePlay");
ao_module_setWindowIcon("feed");
if (ao_module_virtualDesktop){
	$(".dirModeOnly").hide();
}

setInterval(check,1000);

function check(){
	$.get("check.php?rid=" + rid,function(data){
		if (data.includes("ERROR") == false){
			if (data[0] == false){
				//Nothing is found
			}else{
				//There is content. Read it from JSON 
				var fileinfo = data[1];
				
				console.log(fileinfo[1]);

						if (fileinfo[0] == "fopen"){
							$.get("opr.php?opr=mime&file=" + fileinfo[1],function(filetype){
								audio.pause();
								audio.currentTime = 0;
								//Check if the file path is from external storage. If yes, append extDiskAccess into the path for web client access
								if (fileinfo[1].includes("/media/") && !fileinfo[1].includes("extDiskAccess.php?file=")){
								    fileinfo[1]  = "../SystemAOB/functions/extDiskAccess.php?file=" + fileinfo[1];
								}
								
								//open the given filepath
								if(filetype == "image"){
									
									$("body").html('<img src="' + fileinfo[1] + '" style="height: 100%;display: block;margin-left: auto;margin-right: auto;"></img');
									currDisplay = "image";
									ao_module_setWindowSize(800,800);
									
								}else if(filetype == "video"){
									
									$("body").html('<video autoplay loop id="video" style="height: 100%;display: block;margin-left: auto;margin-right: auto;width: 100%;"><source src="' + fileinfo[1] + '" type="video/mp4"></video><div class="ts snackbar"><div class="content"></div><a class="action"></a></div>');
									video = document.querySelector('video');
									var promise = video.play();

									if (promise !== undefined) {
									  promise.then(_ => {
									  }).catch(error => {
										video.muted = true;
										video.play();
										ts('.snackbar').snackbar({
											content: 'Due to browser policy, please click on unmute button.',
											action: 'Unmute',
											actionEmphasis: 'negative',
											onAction: () => {
												unmute();
											}
										});
										
									  });
									}

									currDisplay = "video";
									ao_module_setWindowSize(800,800);
									video = document.getElementById("video");
									
								}else if(filetype == "audio"){
									
									loadScreen();
									audio.volume = localStorage.getItem("global_volume");
									audio.loop = true;
									audio.pause();
									audio.currentTime = 0;
									audio.src = fileinfo[1];
									//audio.play();
									
									var promise = audio.play();
									
									if (promise !== undefined) {
									  promise.then(_ => {
									  }).catch(error => {
										audio.muted = true;
										audio.play();
										ts('.snackbar').snackbar({
											content: 'Due to browser policy, please click on unmute button.',
											action: 'Unmute',
											actionEmphasis: 'negative',
											onAction: () => {
												unmute();
											}
										});
									  });
									}
									
									
									currDisplay = "audio";
									ao_module_setWindowSize(395,520);
								}	
        				    });
        				}else if (fileinfo[0] == "setVol"){
							localStorage.setItem("global_volume",fileinfo[1]);
							if(currDisplay == "audio"){
								audio.volume = localStorage.getItem("global_volume");
							}else if(currDisplay == "video"){
								video.volume = localStorage.getItem("global_volume");
							}
        					
        				}else if (fileinfo[0] == "volup"){
							if(currDisplay == "audio"){
								localStorage.setItem("global_volume",audio.volume + 0.1);
								audio.volume = audio.volume + 0.1
							}else if(currDisplay == "video"){
								localStorage.setItem("global_volume",video.volume + 0.1);
								video.volume = video.volume + 0.1
							}
        					
        				}else if (fileinfo[0] == "voldown"){
							if(currDisplay == "audio"){
								localStorage.setItem("global_volume",audio.volume - 0.1);
								audio.volume = audio.volume - 0.1
							}else if(currDisplay == "video"){
								localStorage.setItem("global_volume",video.volume - 0.1);
								video.volume = video.volume - 0.1
							}
								  
        				}else if (fileinfo[0] == "play"){
							
							if(currDisplay == "audio"){
								audio.play();
							}else if(currDisplay == "video"){
								video.play();
							}
        					
        				}else if (fileinfo[0] == "pause"){
							
							if(currDisplay == "audio"){
								audio.pause();
							}else if(currDisplay == "video"){
								video.pause();
							}
							
        				}else if (fileinfo[0] == "fwd"){
							
							if(currDisplay == "audio"){
								audio.currentTime = audio.currentTime + 15;
							}else if(currDisplay == "video"){
								video.currentTime = video.currentTime + 15;
							}
							
        				}else if (fileinfo[0] == "bwd"){
							
							if(currDisplay == "audio"){
								audio.currentTime = audio.currentTime - 15;
							}else if(currDisplay == "video"){
								video.currentTime = video.currentTime - 15;
							}
							
        				}else if (fileinfo[0] == "stop"){
							
							if(currDisplay == "audio"){
								audio.pause();
								audio.currentTime = 0;
							}else if(currDisplay == "video"){
								video.pause();
								video.currentTime = 0;
							}
        					
							
        				}else if(fileinfo[0] == "reset"){

							loadScreen();
							
						}else if(fileinfo[0] == "newsession"){

							location.reload();
							
						}
					
        		}
    				    /* end */
			}
		
	});
}

var video=document.getElementById("video") ;   

function unmute(){
    if(video.muted){
        video.muted = false;
		video.volume = 0.5;
    }
}


function loadScreen(){
	$("body").html(`
<br><br>
<div class="ts container" style="color:white;">
	<h3 class="ts center aligned icon header" style="color:white;">
		<i class="feed icon"></i>ArOZ Remote Play
    <div class="sub header" style="color:white;">Use this devices as a remote player or player remote!</div>
	<hr>
	</h3>
	<div align="center">
		<div class="white" style="font-size:2em;padding-top:10px;"><i class="hashtag icon"></i>Remote ID: <?php echo $rid;?></div>
		<p class="white" style="font-size:80%;">To use ArOZ Remote Play function, use the OpenWith from your active device and enter the above ID to play with this window.<br><!--<i class="caution sign icon"></i>Warning! Only support Audio files.</p>-->
	</div>
	<br>
</div>
<div class="white bottom" align="right">
	<div class="ts breadcrumb">
		<a class="white section" href="mobileremote.php">Toggle P-Remote</a>
		<div class="divider"> / </div>
		<a class="white section" href="remote.php">Toggle Remote</a>
		<div class="divider"> / </div>
		<a class="white section" href="">Refresh</a>
		<div class="divider"> / </div>
		<a class="white section">Clear Sessions</a>
		<div class="divider dirModeOnly"> / </div>
		<a class="white active section dirModeOnly" href="../">Exit</a>
	</div>
</div>
<div class="ts snackbar"><div class="content"></div><a class="action"></a></div>
<div id="rid" style="display:none;"><?php echo $rid;?></div>
`);
}
</script>
</html>