<?php
include '../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<link rel="manifest" href="manifest.json">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<title>ArOZ Onlineβ</title>
	<style>
		body{
			background-color: #f7f7f7;
		}
	</style>
</head>
<body>
    <nav id="topMenu" class="ts attached inverted borderless normal menu">
        <div class="ts narrow container">
            <a href="../" class="item">ArOZ Onlineβ</a>
        </div>
    </nav>

	<!-- Main Header-->
	<?php
	//random image selector
	if (isset($_GET['folder']) && $_GET['folder'] != ""){
		$folder = $_GET['folder'];
		$imagesDir = 'storage/' . $folder ."/";
	}else{
		$imagesDir = 'uploads/';
		
	}
	if (isset($_GET['filepath']) && $_GET['filename']){
		header("Location: embedded.php?filename=" . $_GET['filename'] . "&filepath=" . $_GET['filepath']);
	}
	$images = glob($imagesDir . '*.{jpg,jpeg,png}', GLOB_BRACE);
	if (sizeof($images) == 0){
		array_push($images,'img/std_background.png');
	}
	$randomImage = $images[array_rand($images)];
	//Handle pwa request
	$pwa = "false";
	if (isset($_GET['pwa']) && $_GET['pwa'] == "enabled"){
		$pwa = "true";
	}
	?>
    <div class="ts center aligned borderless attached very padded segment" style="background-image:url(<?php echo $randomImage;?>);background-size: cover; background-position: center; ">
        <div class="ts narrow container">
            <br>
			<div style="background:rgba(0,0,0,0.5);border-radius: 25px;">
            <div class="ts massive header" style="color:white">
                Photo Station
                <div class="sub header" style="color:white">
                Share your photo with your friends and family
                </div>
            </div>
			</div>
            <br>
            <a onClick="uploadImage();" class="ts labeled icon button">
				<i class="upload icon"></i>
				Upload
			</a>
			<a onClick="openImageManager();" class="ts right labeled icon button">
				Manage
				<i class="folder open icon"></i>
			</a>
            <br>
            <br>
        </div>
    </div>
	<div class="ts attached pointing secondary menu">
		
		<!-- Dropdown Menu -->
		<div class="ts dropdown labeled icon button" style="width:200px">
			<i class="folder icon"></i>
			<span id="folderdir" class="text">Loading...</span>
			<div class="menu">
			<div class="header">
				<i class="folder open icon"></i> uploads/
			</div>
			<?php
				$dirs = array_filter(glob('storage/*'), 'is_dir');
				//check if defined folder path
				if (isset($_GET['folder']) && $_GET['folder'] != ""){
					$folderpath = $_GET['folder'];
				}else{
					$folderpath = "";
				}
				
				//Check if defined search keyword
				if (isset($_GET['search']) && $_GET['search'] != ""){
					$keyword = $_GET['search'];
				}else{
					$keyword = "";
				}
				
				
				if ($folderpath == ""){
					echo '<a class="active item" Onclick="changeFolderView(0)">Unsorted</a>';
				}else{
					echo '<a class="item" Onclick="changeFolderView(0)">Unsorted</a>';
				}
				echo '<div class="divider"></div>';
				echo '<div class="header">
				<i class="folder open icon"></i> storage/
				</div>';
				foreach ($dirs as $folder){
						$folder = str_replace("storage/","",$folder);
						if ($folderpath == $folder){
							if(ctype_xdigit($folder)){
								echo "<a class='active item' Onclick='changeFolderView(".'"' . $folder . '"'.")'>".hex2bin($folder).'</a>';
							}else{
								echo "<a class='active item' Onclick='changeFolderView(".'"' . $folder . '"'.")'>".$folder.'</a>';
							}
						}else{
							if(ctype_xdigit($folder)){
								echo "<a class='item' Onclick='changeFolderView(".'"' . $folder . '"'.")'>".hex2bin($folder).'</a>';
							}else{
								echo "<a class='item' Onclick='changeFolderView(".'"' . $folder . '"'.")'>".$folder.'</a>';
							}
						}
				}
			?>
			</div>
		</div>
		<div class="ts icon buttons">
			<button id="sort1" class="ts button active" Onclick="changeSortMethod(1);"><i class="sort alphabet ascending icon"></i></button>
			<button id="sort2" class="ts button" Onclick="changeSortMethod(2);"><i class="sort alphabet descending icon"></i></button>
			<button id="dlbtn" class="ts button" onClick="downloadmode();"><i class="download icon"></i></button>
			<?php 
			if (file_exists("../QuickSend/")){
				echo '<button class="ts button" onClick="shareThis();"><i class="share alternate icon"></i></button>';
			}else{
				echo '<button class="ts disabled button"><i class="share alternate icon"></i></button>';
			}
			?>
			<!-- <button class="ts button" onClick="shareThis();"><i class="share alternate icon"></i></button> -->
		</div>
		<div class="right fitted item">
			<div class="ts borderless right icon input">
				<input id="searchbar" type="text" placeholder="Search...">
				<i class="search icon"></i>
			</div>
		</div>
    </div>

    <div id="contentFrame" class="ts center aligned attached vertically very padded secondary segment">

        <div class="ts narrow container">

            <div class="ts stackable five flatted cards">

				<?php
                $template = '<div class="ts card">
                    <div class="image">
                        <img src="genthumb.php?src=%FILE_PATH%&size=%3C480" OnClick="TogglePreview('."'".'%IMGAGE_PATH%'."'".')">
                    </div>
                    <div class="left aligned content">
                        <div class="description">%UPLOAD_DATA%</div>
                    </div>
                </div>';
				//Scan all image within dir
				if (isset($_GET['folder']) && $_GET['folder'] != ""){
					$files = glob("storage/".$_GET['folder'].'/*.{jpg,jpeg,png,gif}', GLOB_BRACE);
				}else{
					$files = glob('uploads/*.{jpg,jpeg,png,gif}', GLOB_BRACE);
				}
				
				//Sort the file accordingly
				if (isset($_GET['sort']) && $_GET['sort'] != ""){
					$sortmode = $_GET['sort'];
					if ($_GET['sort'] = 'reverse'){
						rsort($files);
					}
				}else{
					$sortmode = "";
					sort($files);
				}
				$count = 0;
				$path2name = [];
				foreach($files as $file) {
					if ($keyword != ""){
						//There are set keyword for search
						$ext = pathinfo($file, PATHINFO_EXTENSION);
						$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
						$filename = hex2bin($filename);
						if (strpos(strtolower($filename),strtolower($keyword)) !== False){
							//echo $file . "<br>";
							$box = str_replace("%FILE_PATH%",$file,$template);
							$box = str_replace("%UPLOAD_DATA%",$filename,$box);
							$box = str_replace("%IMGAGE_PATH%",$file,$box);
							echo $box;
							$count += 1;
							array_push($path2name,[$file,$filename . "." .$ext]);
						}
						
					}else{
						$ext = pathinfo($file, PATHINFO_EXTENSION);
						$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
						$filename = hex2bin($filename);
						//echo $file . "<br>";
						$box = str_replace("%FILE_PATH%",$file,$template);
						$box = str_replace("%UPLOAD_DATA%",$filename,$box);
						$box = str_replace("%IMGAGE_PATH%",$file,$box);
						echo $box;
						$count += 1;
						array_push($path2name,[$file,$filename. "." .$ext]);
					}
				}
				
				if ($count == 0){
					//No result found.
					$box = str_replace("%FILE_PATH%","img/no_img_found.png",$template);
					$uploadmsg = "<div align='center'><a class='ts button' onClick='uploadImage();'>Upload</a></div>";
					$box = str_replace("%IMGAGE_PATH%","img/no_img_found.png",$box);
					$box = str_replace("%UPLOAD_DATA%",$uploadmsg,$box);
					echo $box;
				}
				?>
               
            </div>

        </div>

    </div>
	
    <!--Notification Bar -->
	<div id="nbar" class="ts bottom right active snackbar" style="display:none;">
		<div id="nbartxt" class="content">
			Download Mode Enabled.
		</div>
		<a class="primary action" Onclick="downloadmode()">Toggle</a>
	</div>
	
	<!-- Image Preview Window -->
	<div id="imagePreview" align="center" style="z-index: 99; display:none;">
	<div style="position:fixed;
    top:0;
    left:0 !important;;
    height:100%;
	width:100%;
    z-index: 100;
	background:rgba(0,0,0,0.3);
	boarder:0px;" OnClick="TogglePreview()">
	<div class="ts active dimmer"></div>	
	</div>
	<!-- Close Button -->
	<div style="position:fixed;
	z-index: 101;
	top:100px;
	background-color:#383838;
	top:0;left:0;
	">
	<button OnClick="TogglePreview(0);" class="ts big close button"></button>
	</div>
	
	<!-- Preview Image -->
	<div id="previewImageDiv" align="center" style="position:fixed;
	z-index: 101;
	top:70px;
	left:0;
	color:white;
	max-height:100%;
	//background:rgba(0,0,0,0.5);
	">
	<img id="previewingImage" class="ts massive image" src="img/std_background.png"><br>
	<div id="previewImagetxt" align="center"><i class="image icon"></i>Loading...</div>
	</div>
	</div>
	
	<!-- Bottom Bar -->
    <div class="ts bottom attached segment">
        <div class="ts narrow container">
            <br>
            <div class="ts large header">
                ArOZ Online Beta Photo Station
                <div class="smaller sub header">
                    CopyRight IMUS Laboratory, 2016-2017
                </div>
            </div>
            <br>
        </div>
    </div>
	<div id="DATA_PIPELINE_pwa" style="display:none;"><?php echo $pwa;?></div>
	<div id="DATA_PIPELINE_folder_path" style="display:none;"><?php echo $folderpath;?></div>
	<div id="DATA_PIPELINE_search_keyword" style="display:none;"><?php echo $keyword;?></div>
	<div id="DATA_PIPELINE_sort_mode" style="display:none;"><?php echo $sortmode;?></div>
	<div id="DATA_PIPELINE_path2name" style="display:none;"><?php echo json_encode($path2name); ?></div>
	<script>
				
	</script>
	<script>

	</script>
	<script src="index.js"></script>
</body>
</html>