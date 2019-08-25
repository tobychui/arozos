<?php
include_once("../../../auth.php");

?>
<html>
    <head>
        <title>User Profile Icon</title>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
         <script src="../../../script/ao_module.js"></script>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    </head>
    <body><br><br>
        <div class="ts container">
            <div class="ts segment">Personalization <i class="caret right icon"></i> Edit User Profile Icon
            <br><br>
            <div class="ts grid">
                <div class="six wide column" align="right">
                    <?php
                    $iconPath = "usericon/";
                    if (file_exists($iconPath . $_SESSION['login'] . ".png")){
                        $imagePath = $iconPath . $_SESSION['login'] . ".png";
					}else if (file_exists($iconPath . $_SESSION['login'] . ".jpg")){
						$imagePath = $iconPath . $_SESSION['login'] . ".jpg";
					}else if (file_exists($iconPath . $_SESSION['login'] . ".gif")){
						$imagePath = $iconPath . $_SESSION['login'] . ".gif";
					}else if (file_exists($iconPath . $_SESSION['login'] . ".jpeg")){
						$imagePath = $iconPath . $_SESSION['login'] . ".jpeg";
                    }else{
                        $imagePath = $iconPath . "user.png";
                    }
                    ?>
                    <img id="userIcon" class="ts small image" src="<?php echo $imagePath;?>">
                </div>
                <div class="ten wide column">
                    <div class="ts big header">
                        <?php echo $_SESSION['login'];?>
                        <div id="duid" class="sub header">Checking UUID...</div>
                    </div>
                    <button class="ts labeled icon button" onClick="selectImage();">
                        <i class="write icon"></i>
                        Change Icon
                    </button>
					<div id="update" class="ts primary segment" style="display:none;">
						<p><i class="checkmark icon"></i>User Profile Icon updated.</p>
					</div>
					<p style="font-size:90%">Profile Image will not be updated until you restart your browser due to caching issues.</p>
                </div>
            </div>
           
            </div>
        </div>
		<div id="username" style="display:none;"><?php echo $_SESSION['login'];?></div>
        <script>
            var fileAwait;
            var rid;
            var windowObject;
            var fileList = [];
			var username = $("#username").text().trim();
			
            //Starting init event
            loadDUID();
            bindFeedbackFunctioncall();
			function bindFeedbackFunctioncall(){
				if (parent.fileSelectionCallback = undefined){
					parent.fileSelectionCallback = function(object){
						console.log(object);
					}
				}
			}
			
            function loadDUID(){
                $.get("../../../hb.php",function(result){
                    if (result != "" && result.includes(",") == true){
                        result = result.trim();
                        var uid = result.split(",")[2];
                        $("#duid").text("@" + uid);
                    }else{
                        $("#duid").text("Unable to obtain the UUID of this device");
                    }
                   
                });
                
            }
            function selectImage(){
                if (ao_module_virtualDesktop){
                    //Opening a floatWindow in VDI mode
                    //ao_module_openFileSelector("userProfileImageSelector","processSelectedImage");
					ao_module_newfw("SystemAOB/functions/file_system/fileSelector.php","Starting file selector","spinner","userIconSelector",undefined,undefined,undefined,undefined,undefined,undefined,parent.ao_module_windowID,"fileSelectionPassthrough");
                }else{
                    //Opening a floatWindow under non-VDI mode
					ao_module_removeTmp("profilePicFileSelectedResult");
                    rid = "profilePicFileSelectedResult";
                    windowObject = ao_module_openFileSelectorTab(rid,"../../../",undefined,undefined,processSelectedImage);
                }
                
            }
			
			function fileReceive(object){
				processSelectedImage(object);
			}
            
            function processSelectedImage(object){
                fileList = JSON.parse(object)
				var filename = fileList[0].filename;
				var filepath = fileList[0].filepath;
				var ext = filename.split(".").pop().toLowerCase();
				if (ext == "png" || ext == "jpeg" || ext == "jpg" || ext == "gif"){
					//Supported format, moving it to the user directory
					$.get("createProfilPic.php?imagePath=" + filepath,function(data){
						if (data.includes("ERROR") == false){
							d = new Date();
							$("#userIcon").attr('src',"usericon/" + username + "." + ext + "?" + d.getTime());
							$("#update").show().delay(2000).fadeOut('slow');
						}else{
							console.log(data);
						}
					});
				}else{
					parent.ao_module_msgbox("The selected file is not an image file or this format is not supported.","<i class='caution sign icon'></i>User Profile Setting");
				}
            }
        </script>
    </body>
</html>