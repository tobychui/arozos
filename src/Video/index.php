<?php
include '../auth.php';

//Patch for uploads folder not found exception during upload with Upload Manager
if (!file_exists("uploads/")){
	mkdir("uploads",0777,true);
}
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<html>
<head>
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
	<script src="../script/ao_module.js"></script>
	<title>ArOZ Video</title>
	<style>
    	body{
    	    background-color:#f5f5f5;
    	}
	    .videoborder{
	        border-left: 5px solid #525252;
	        padding:8px !important;
	        margin:3px;
			cursor:pointer;
	    }
	    .videoborder:hover{
	        border-left: 5px solid #675cff;
	        background-color:#d7d4ff;
	    }
	    .rightFloatAbsolute{
			position: absolute;
	        top:30%;
	        right:8px;
	    }
	    .rightFloatAbsolute:hover{
	        color:#1f44fc;
	    }
	    .limited{
	        text-overflow: ellipsis;
            overflow: hidden; 
            max-width: 75%; 
            white-space: nowrap;
	    }
	    .hidden{
	        display:none;
	    }
	    .shortList{
	        max-height:300px !important;
	        overflow-y:auto;
	        overflow-x:hidden;
	    }
	</style>
</head>
<body>
<?php
$uploadPath = "../Upload Manager/upload_interface.php?target=Video&filetype=mp4";
function formatBytes($size, $precision = 2)
			{
				$base = log($size, 1024);
				$suffixes = array('Byte', 'KB', 'MB', 'GB', 'TB');   

				return round(pow(1024, $base - floor($base)), $precision) .' '. $suffixes[floor($base)];
			}

if (isset($_GET['filepath']) && $_GET['filepath'] != "" ){
	header('Location: vidPlay.php?src='.$_GET['filepath']);
}
?>
    <nav class="ts attached borderless small menu">
            <a id="rtiBtn" href="../" class="item"><i class="angle left icon"></i></a>
            <a href="" class="item">ArOZ Video</a>
            <div class="right menu">
		    	<a href="<?php echo $uploadPath;?>" class="item"><i class="upload icon"></i></a>
			    <a href="manager.php" class="item"><i class="folder open outline icon"></i></a>
            </div>
    </nav>
    
	<!-- Main Header-->
	<div class="ts container" style="padding-top:8px;">
	<?php
	$templateA = '
	<div class="ts horizontal divider">%PlayListName%</div>
	<div class="ts list shortList">';
    $templateB= '<div class="item videoborder" >
            <i class="video icon"></i>
            <div class="content" href="%VideoPlayPath%" onClick="playVideo(this);">
                <div class="header limited">%VideoFileName%</div>
                <div class="description">%FileInfo%</div>
            </div>
            <a class="rightFloatAbsolute" href="%DownloadPath%" download><i class="download icon"></i></a>
        </div>';
    $templateC = '</div>
    <a class="ts mini basic fluid button" href="%PlayPlayList%"><i class="play icon"></i>View Playlist</a>';
	$playlists = glob('playlist/*');
	foreach($playlists as $playlist){
		if (is_dir($playlist)){
			$videos = glob($playlist . '/*.mp4');
			
			//check if PHP was higher than 7.4, if true then not using inith filename
			if(ctype_xdigit($playlist)){
				$playlistName = hex2bin(basename($playlist));
			}else{
				$playlistName = basename($playlist);
			}

			
			$box = str_replace("%PlayListName%",$playlistName,$templateA);
			if (count($videos) != 0){
				$box = str_replace("%PlayPlayList%","vidPlay.php?src=".$videos[0]."&playlist=".$playlist."",$box);
			}else{
				//$box = str_replace('<a class="ts mini basic fluid button" href="%PlayPlayList%"><i class="play icon"></i>View Playlist</a>','  <kbd>Empty playlist</kbd>',$box);
			}
			echo $box;
			foreach($videos as $video){
				//echo $video . '<br>';
				$filename = basename($video,".mp4");
				if (ctype_xdigit(str_replace("inith","",$filename)) && strlen(str_replace("inith","",$filename)) % 2 == 0) {
					$decodedName = hex2bin(str_replace("inith","",$filename));
				}else{
					$decodedName = $filename;
				}
				$box = str_replace("%VideoPlayPath%","vidPlay.php?src=".$video,$templateB);
				$box = str_replace("%VideoFileName%",$decodedName,$box);
				$box = str_replace("%DownloadPath%","download.php?download=".$video,$box);
				$box = str_replace("%FileInfo%",formatBytes(filesize($video)) . " [".pathinfo($video, PATHINFO_EXTENSION)."]",$box);
				echo $box;
			}
		
			if (count($videos) != 0){
        	    echo str_replace("%PlayPlayList%","vidPlay.php?src=".$videos[0]."&playlist=uploads",$templateC);
        	}else{
        	    echo str_replace("%PlayPlayList%","",$templateC);
        	}
			
		}
	}
	
	$unsorted = glob("uploads/*.mp4");
	$box = str_replace("%PlayListName%","Unsorted Videos",$templateA);
	if (count($unsorted) != 0){
				$box = str_replace("%PlayPlayList%","vidPlay.php?src=".$unsorted[0]."&playlist=uploads",$box);
	}else{
				//$box = str_replace('  <a href="%PlayPlayList%"> Play playlist</a>','  <kbd>Empty playlist</kbd>',$box);
	}
	echo $box;
	foreach ($unsorted as $video){
		$filename = basename($video,".mp4");
		if (ctype_xdigit(str_replace("inith","",$filename)) && strlen(str_replace("inith","",$filename)) % 2 == 0) {
			$decodedName = hex2bin(str_replace("inith","",$filename));
		}else{
			$decodedName = $filename;
		}
		$box = str_replace("%VideoPlayPath%","vidPlay.php?src=".$video,$templateB);
		$box = str_replace("%VideoFileName%",$decodedName,$box);
		$box = str_replace("%DownloadPath%","download.php?download=".$video,$box);
		$box = str_replace("%FileInfo%",formatBytes(filesize($video)) . " [".pathinfo($video, PATHINFO_EXTENSION)."]",$box);
		echo $box;
	}
	if (count($unsorted) != 0){
	    echo str_replace("%PlayPlayList%","vidPlay.php?src=".$unsorted[0]."&playlist=uploads",$templateC);
	}else{
	    echo str_replace('<a class="ts mini basic fluid button" href="%PlayPlayList%"><i class="play icon"></i>View Playlist</a>',"<p style='width:100%;' align='center'>/// Empty Playlist ///</p>",$templateC);
	}
	
	
	//Check for external storage devices
	if (file_exists("/media/")){
		//This system have media directory and check for mounting points
		$extstorages = glob("/media/storage*");
		foreach ($extstorages as $storage){
			if (file_exists("$storage/Video/")){
				$unsorted = glob("$storage/Video/*.mp4");
				$box = str_replace("%PlayListName%","External Storage ($storage)",$templateA);
				if (count($unsorted) != 0){
							$box = str_replace("%PlayPlayList%","vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=".$unsorted[0]."&playlist=$storage/Video/&isExt=true",$box);
				}else{
							$box = str_replace('  <a href="%PlayPlayList%"> Play playlist</a>','  <kbd>Empty playlist / Not Plugged In</kbd>',$box);
				}
				echo $box;
				foreach ($unsorted as $video){
					$filedata = explode('/',$video);
					$fullFileName = array_pop($filedata);
					$filename = str_replace(".mp4","",$fullFileName);
					//$filename = basename($video,".mp4");
					if (strpos($filename,"inith") !== false){
						$decodedName = hex2bin(str_replace("inith","",$filename));
					}else{
						$decodedName = $filename;
					}
					$box = str_replace("%VideoPlayPath%","vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=".$video,$templateB);
					$box = str_replace("%VideoFileName%",$decodedName,$box);
					$box = str_replace("%DownloadPath%","download.php?download=".$video,$box);
					$box = str_replace("%FileInfo%",formatBytes(filesize($video)) . " [".pathinfo($video, PATHINFO_EXTENSION)."]",$box);
					echo $box;
				}
					if (count($unsorted) != 0){
                	    echo str_replace("%PlayPlayList%","vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=".$unsorted[0]."&playlist=$storage/Video/&isExt=true",$templateC);
                	}else{
                	    echo str_replace('<a class="ts mini basic fluid button" href="%PlayPlayList%"><i class="play icon"></i>View Playlist</a>',"<p style='width:100%;' align='center'>/// Empty Playlist ///</p>",$templateC);
                	}
				}
		}
	}
	//scan for external playlist. This won't show if nothing is found.
	if (file_exists("/media/")){
		//This system have media directory and check for mounting points
		$extstorages = glob("/media/storage*");
		foreach ($extstorages as $storage){
			if (file_exists("$storage/Video/")){
				$playlists = glob( $storage . '/Video/*');
				foreach($playlists as $playlist){
					if (is_dir($playlist)){
						$unsorted = glob($playlist . "/*.mp4");
						//basename in traiditional mode to prevent utf-8 encoding error
						$tmp_1 = explode("/",$playlist);
						$basename = array_pop($tmp_1);
						if (ctype_xdigit($basename) && strlen($basename) % 2 == 0) {
							$playlistName = hex2bin($basename);
						} else {
							$playlistName = $basename;
						}
						$box = str_replace("%PlayListName%", $playlistName . " - ($storage)",$templateA);
						$box = str_replace('layout icon','disk outline icon',$box);
						if (count($unsorted) != 0){
									$box = str_replace("%PlayPlayList%","vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=".$unsorted[0]."&playlist=$storage/Video/$basename&isExt=true",$box);
						}else{
									//$box = str_replace('  <a href="%PlayPlayList%"> Play playlist</a>','  <kbd>Empty playlist / Not Plugged In</kbd>',$box);
						}
						echo $box;
						foreach ($unsorted as $video){
							$filedata = explode('/',$video);
							$fullFileName = array_pop($filedata);
							$filename = str_replace(".mp4","",$fullFileName);
							if (strpos($filename,"inith") !== false){
								$decodedName = hex2bin(str_replace("inith","",$filename));
							}else{
								$decodedName = $filename;
							}
							$box = str_replace("%VideoPlayPath%","vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=".$video,$templateB);
							$box = str_replace("%VideoFileName%",$decodedName,$box);
							$box = str_replace("%DownloadPath%","download.php?download=".$video,$box);
							$box = str_replace("%FileInfo%",formatBytes(filesize($video)) . " [".pathinfo($video, PATHINFO_EXTENSION)."]",$box);
							echo $box;
						}
						if (count($unsorted) != 0){
                    	    echo str_replace("%PlayPlayList%","vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=".$unsorted[0]."&playlist=$playlist&isExt=true",$templateC);
                    	}else{
                    	    echo str_replace('<a class="ts mini basic fluid button" href="%PlayPlayList%"><i class="play icon"></i>View Playlist</a>',"<p style='width:100%;' align='center'>/// Empty Playlist ///</p>",$templateC);
                    	}
					}
				}
			}
		}
	}
	?>
	
	<br><br>
	</div>
	<script>
	if (ao_module_virtualDesktop){
	    $("#rtiBtn").hide();
	}
	    ao_module_setWindowIcon("film");
	    ao_module_setWindowTitle("ArOZ Video");
	    ao_module_setGlassEffectMode();
		
	function playVideo(object){
		var url = $(object).attr("href");
		window.location.href = url;
	}
	
	$( window ).resize(function() {
	    if ($(window).width() < 425){
	        $(".video.icon").each(function(){
	            $(this).css("display","none");
	        });
	    }else{
	        $(".video.icon").each(function(){
	            $(this).css("display","");
	        });
	    }
	});
	</script>
</body>
</html>