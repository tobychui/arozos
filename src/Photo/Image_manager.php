<?php
include '../auth.php';
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<title>ArOZ Onlineβ</title>
</head>
<body>
    <nav id="topbar" class="ts attached inverted borderless normal menu">
        <div class="ts narrow container">
            <a href="../" class="item">ArOZ Onlineβ</a>
        </div>
    </nav>
	<br>

    <div class="ts fluid container">

        <div class="ts breadcrumb">
			<a href="index.php" class="section"><i class="arrow left icon"></i>Back</a>
            <div class="divider">/</div>
            <div class="section"><i class="folder icon"></i>Photo Station File Management System</div>
            <div class="divider">/</div> 
            
        </div>

		<div align="center"><i class="chevron right icon"></i><i class="chevron right icon"></i><i class="chevron right icon"></i><i class="chevron right icon"></i></div>

        <div class="ts grid">
			<!-- Left file browsing zone -->
	
            <div class="six wide column">
				<div id="imagelist" class="ts form">
					 <div class="ts selection segmented list">
					 <?php
						$leftTemplate='<div class="item" style="overflow: hide;">
											<div class="ts checkbox">
												<input id="%FILE_ID%" name="box2check" type="checkbox" onClick="showPreview('."'"."%FILE_ID%"."'".')">
												<label for="%FILE_ID%"><i class="image icon"></i>%FILE_NAME%</label>
												<div id="%FILE_ID%-ext" style="display:none;">%FILE_EXTENSION%</div>
												<div id="%FILE_ID%-ofn" style="display:none;">%ORIGINAL_FILENAME%</div>
												<div id="%FILE_ID%-rfp" style="display:none;">%FILE_PATH%</div>
												<div id="%FILE_ID%-size" style="display:none;">%FILE_SIZE%</div>
											</div>
										</div>';
						$files = glob('uploads/*.{jpg,jpeg,png,gif}', GLOB_BRACE);
						foreach($files as $file){
							$filename = basename($file);
							$ext = pathinfo($file, PATHINFO_EXTENSION);
							$orgfilename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
							$orgfilename = hex2bin($orgfilename);
							$lbox = str_replace("%FILE_ID%",str_replace(".","-dot-",str_replace(" ","-space-",$orgfilename)),$leftTemplate);
							$lbox = str_replace("%FILE_NAME%",$filename,$lbox);
							$lbox = str_replace("%ORIGINAL_FILENAME%",$orgfilename,$lbox);
							$lbox = str_replace("%FILE_PATH%",$file,$lbox);
							$lbox = str_replace("%FILE_EXTENSION%",$ext,$lbox);
							$lbox = str_replace("%FILE_SIZE%",filesize($file),$lbox);
							echo $lbox;
						}
					?>
					</div>	
				</div>	
			</div>
			

			<!-- Center file browsing zone -->
            <div class="four wide column">
                <div class="ts card">
					<!-- Image preview -->
                    <div class="secondary very padded extra content">
                        <div class="ts icon header">
                            <img id="previewWindow" class="ts medium image" src="img/Photo_manager.png"></img>
                        </div>
                    </div>


					<!-- File Information -->
                    <div class="extra content">
                        <div class="header" id="ImageName">Photo Station File Management System</div>
                    </div>
					<div align="center">
						<div class="ts icon buttons">
							<button id="btn1" class="ts button" onclick="TogglePreview()"><i class="mouse pointer icon"></i><i class="eye icon"></i></button>
							<button id="btn2" class="ts button" onClick="MoveFile(1);"><i class="checkmark box icon"></i><i class="arrow right center icon"></i></button>
							<button id="btn3" class="ts button" onClick="MoveFile(2);"><i class="folder outline icon"></i><i class="arrow right center icon"></i></button>
							<button id="btn4" class="ts negative button" onClick="MoveFile(3)"><i class="checkmark box icon"></i><i class="trash outline icon"></i></button>
						</div>
					</div>

                    <div class="extra content">
                        <div class="ts list">

                            <div class="item">
                                <i class="file image outline icon"></i>
                                <div class="content">
                                    <div class="header">File Extension</div>
                                    <div id="fileext" class="description">/</div>
                                </div>
                            </div>



                            <div class="item">
                                <i class="terminal icon"></i>
                                <div class="content">
                                    <div class="header">Storage Name</div>
                                    <div id="storagename" class="description">/</div>
                                </div>
                            </div>
 


                            <div class="item">
                                <i class="image icon"></i>
                                <div class="content">
                                    <div class="header">Image Size</div>
                                    <div id="imgsize" class="description">/</div>
                                </div>
                            </div>

							
							
							<div class="item">
                                <i class="folder icon"></i>
                                <div class="content">
                                    <div class="header">Target Folder</div>
                                    <div id="targetdir" class="description">/</div>
                                </div>
                            </div>
							
                        </div>
                    </div>
					<!-- Functional Butons -->
					<div align="center">
					<div class="ts icon buttons">
						<button class="ts button" OnClick="toggle();"><i class="checkmark box icon"></i>All</button>
						<button class="ts button" OnClick="toggleFalse();"><i class="square outline icon"></i>All</button>
						<button class="ts button" OnClick="newfolder()"><i class="folder outline icon"></i>New</button>
						<button class="ts button" OnClick="done();"><i class="checkmark icon"></i>DONE</button>
					</div>
					</div>
                </div>
                <div class="ts horizontal right floated middoted link list">
                    <div class="item">CopyRight IMUS Laboratory</div>
                </div>
            </div>
			
			<!-- Right file browsing zone -->
            <div class="six wide column">
                <div class="ts selection segmented list">
					<div id="filenamer" class="item" style="display:none;">
						<div class="ts fluid borderless icon input">
							<input id="fileNameInput" type="text" placeholder="New Folder">
							<i class="folder outline icon"></i>
						</div>
					</div>
					<?php
					$storagedir = "storage/";
					echo '<a class="item">
								<i class="folder open icon"></i>
								storage/
								</a>';
					$rightTemplate=' <a id="%FOLDER_ID%" class="item" onClick="%FUNCTION_CALL%">
								&nbsp&nbsp&nbsp
								<i class="folder icon"></i>
								%FOLDER_NAME%
								</a>';
					$dirs = array_filter(glob($storagedir . "*"), 'is_dir');
					foreach($dirs as $dir){
						$foldername = str_replace($storagedir,"",$dir);
						$rbox = str_replace("%FUNCTION_CALL%","selectFolder('$foldername')",$rightTemplate);
						$rbox = str_replace("%FOLDER_NAME%",$foldername,$rbox);
						$rbox = str_replace("%FOLDER_ID%",$foldername,$rbox);
						echo $rbox;
					}
					
					?>
                    
                </div>

            </div>

        </div>

    </div>
	<!-- Notifier Div-->
	<div id="nfb" class="ts active bottom right snackbar" style="display:none;">
		<div id="nfbtxt" class="content">
			Loading...
		</div>
		<a class="primary action" onclick="$('#nfb').fadeOut('slow');">Close</a>
	</div>
	<!-- Action Confirm div-->
	<dialog id="confirmbox" class="ts basic fullscreen modal" style="display:none; background:rgba(0,0,0,0.7);position:fixed;top:100px;" open>
		<div class="ts icon header">
			<i class="exchange icon"></i>File Operation Confirmation
		</div>
		<div id="confirminfo" class="content">
			<p></p>
		</div>
		<div class="actions">
			<button class="ts inverted basic deny button" onClick="$('#confirmbox').fadeOut('slow');">
				Cancel
			</button>
			<button class="ts inverted basic positive button" OnClick="ConfirmAction();">
				Confirm
			</button>
		</div>
	</dialog>
	<script>
		var VDI = ao_module_virtualDesktop;
		if (VDI){
			$("#topbar").hide();
			$("body").css("background","rgba(255,255,255,0.7)").css("padding","20px");
		}
	</script>
<script src="Image_manager.js"></script>
</body>
</html>
