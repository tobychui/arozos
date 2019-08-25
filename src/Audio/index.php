<?php
include '../auth.php';
if (!file_exists("uploads/")){
	mkdir("uploads/");
}
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.8, maximum-scale=0.8"/>
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
<link rel="manifest" href="manifest.json">
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
</head>
<body><?php
	function formatSizeUnits($bytes)
    {
        if ($bytes >= 1073741824)
        {
            $bytes = number_format($bytes / 1073741824, 2) . ' GB';
        }
        elseif ($bytes >= 1048576)
        {
            $bytes = number_format($bytes / 1048576, 2) . ' MB';
        }
        elseif ($bytes >= 1024)
        {
            $bytes = number_format($bytes / 1024, 2) . ' KB';
        }
        elseif ($bytes > 1)
        {
            $bytes = $bytes . ' bytes';
        }
        elseif ($bytes == 1)
        {
            $bytes = $bytes . ' byte';
        }
        else
        {
            $bytes = '0 bytes';
        }

        return $bytes;
}
?><div class="ts borderless basic fluid menu">
		<?php 
		$pwa = "false";
		if (isset($_GET['mode']) == true && $_GET['mode'] == "fw"){
			//Entering float window mode, remove back to index function
			echo '<a id="backBtn" href="" class="item">ArOZβ</a>';
		}else if (isset($_GET['mode']) == true && $_GET['mode'] == "pwa"){
		    $pwa = "true";
		    echo '<a id="backBtn" href="" class="item">ArOZβ</a>';
		}else{
			echo '<a id="backBtn" href="../index.php" class="item">ArOZβ</a>';
		}?>

        <div class="header stretched center aligned item">Music Bank</div>
		<?php
		if (file_exists("../QuickSend/")){
			echo '<a class="pwahide item" onClick="share();">
				<i class="share alternate icon"></i>
				</a>';
			}
		?>
    </div>

    <div class="ts small attached segmented single line selection items">
		<?php if(isset($_GET['share']) && $_GET['share'] != "" && isset($_GET['display']) && $_GET['display'] != "" & isset($_GET['id']) && $_GET['id'] != ""){
					$shareMode = true;
					$externalPlayMode = false;
				}else{
					$shareMode = false;
				}
			
			//Standard ArOZ Online File System calling variable
			if(isset($_GET['filepath']) && $_GET['filepath'] != "" && isset($_GET['filename']) && $_GET['filename'] != ""){
					$shareMode = true;
					$externalPlayMode = true;
				}else{
					$shareMode = false;
				}
		?>
		<?php
			$SongS = "";
			if ($shareMode && $externalPlayMode == false){
				$ModeS = "true";
				$SongS = json_encode([$_GET['share'],$_GET['display'],$_GET['id']]);
			}else if ($shareMode && $externalPlayMode){
				$ModeS = "true";
				$SongS = json_encode([$_GET['filepath'],$_GET['filename'],-1]);
			}else{
				$ModeS = "false";
			}
		?>
		<!-- Audio Control System with no HTML5 Audio Attribute-->
		<div class="ts fluid container" style="cursor: pointer;">
			<div id="audio_attr"style="display:none;">
			<audio id="player" controls autoplay>
			  <source src="" type="audio/mpeg">
				Your browser does not support the audio element.
			</audio>
			</div>
			<div id="YamiPlayer" class="content">
			<div id="songname" class="ts top attached segment">
			NOW PLAYING ||
			</div>
			<div id="progressbardiv" class="ts attached progress">
				<div id="audioprogress" class="bar" style="width: 0%"></div>
			</div>
			<div class="ts bottom attached segment">
				<div class="ts icon buttons">
					<button class="ts button" onclick="PreviousSong()"><i class="step backward icon"></i></button>
					<button class="ts button" onclick="playbtn()"><i id='playbtn' class="pause icon"></i></button>
					<button class="ts button" onclick="NextSong()"><i class="step forward icon"></i></button>
					<button class="ts button" onclick="stopbtn()"><i class="stop icon"></i></button>
					<button class="ts button" onclick="volDown()"><i class="volume down icon"></i></button>
					<button class="ts button" onclick="volUp()"><i class="volume up icon"></i></button>
					<button class="ts button" onclick="repeatmode()"><i class="repeat icon"></i></button>
				</div>
				<span>
				<i id="voldis" class="volume off icon"> 100%</i>      
				<i id="timecode" class="time icon"> 0:00/0:00</i>                  
				<i id="repmode" class="repeat icon"> Single</i>
				</span>
			</div>
			
			<!-- <button class="ts button" onclick="Show_Audio_Attrubute()">Show HTML5 Attrubute</button> -->
			</div>
		</div>
		<select id="basedirPath" class="ts fluid tiny basic dropdown">
			<option>Internal Storage</option>
			<?php
				$folders = glob("/media/storage*");
				foreach ($folders as $storage){
					if (file_exists($storage . "/Audio")){
						echo '<option>'.$storage.'</option>';
					}
				}
			
			?>
		</select>
		<!-- Search Bar -->
		<div id="searchbar" class="ts fluid container">
			<div class="ts fluid icon input">
				<input id="sbinput" type="text" placeholder="Search...">
				<i class="search icon"></i>
			</div>
		</div>
		<!-- end of search bar-->
		
		<?php
        $template = '<div href="" id="%ID%" class="ts item" onclick="PlaySong('."'".'%RAW_FILENAME%'."','" .'%AUDIO_FILE_NAME%'."','".'%ID%'."'".')">
			<div>
                <i class="big file audio outline icon"></i>
            </div>
            <div class="content">
                <div class="header">%AUDIO_FILE_NAME%</div>
                <div class="middoted meta">
                    <div>%FILE_SIZE% / %FILE_FORMAT%</div>
                   
                </div>
            </div>
        </div>';
		$extStorageMode = "false";
		$extStorageFolder = "";
		$files = array();
		$filepath = "uploads/";
		foreach (glob($filepath . "*.{mp3,wav,flac,aac}", GLOB_BRACE) as $file) {
		  if(strpos($file,'inith') !== false){
			$files[] = $file;
		  }
		}
		$count = 0;
		$songlist = [];
		$keyword = "";
		if(isset($_GET['search']) == true && $_GET['search'] != ""){
			$keyword = $_GET['search'];
			$loweredkeyword = mb_strtolower($keyword);
			foreach($files as $file) {
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				if (strpos(mb_strtolower($filename),$loweredkeyword) !== false){
					array_push($songlist,[$file,$filename,$count]);
					$box = str_replace("%AUDIO_FILE_NAME%",str_replace("'","",$filename),$template);
					$box = str_replace("%FILE_SIZE%",formatSizeUnits(filesize($file)),$box);
					$box = str_replace("%RAW_FILENAME%",$file,$box);
					$box = str_replace("%ID%","AudioID" + (string)$count,$box);
					$box = str_replace("%FILE_FORMAT%",$ext,$box);
					echo $box;
					$count += 1;
				}
			}
				if ($count == 0){
					//No Search Results
					echo '<div class="ts item">
					<div>
						<i class="big plus square outline icon"></i>
					</div>
					<div class="content">
						<div class="header">No matched search results.</div>
						<div class="middoted meta">
							<div>Maybe you can try upload some new audio files?<br>
							<a href="../Upload Manager/upload_interface.php?target=Audio&filetype=mp3,mp4,flac,wav,aac&finishing=ffmpeg_converter.php">Upload</a>
							</div>
						   
						</div>
					</div>
					</div>';
				}
		}elseif (isset($_GET['extstorage']) && $_GET['extstorage'] != "" && !(strtoupper(substr(PHP_OS, 0, 3)) === 'WIN')){
			//Newly added features in 27-8-2018 for accessing audio in external storage devices
			$files = array();
			$filepath = "/media/" . $_GET['extstorage'] . "/Audio/";
			$extStorageMode = "true";
			$extStorageFolder = $_GET['extstorage'];
			foreach (glob($filepath . "*.{mp3,wav,flac,aac}", GLOB_BRACE) as $file) {
			  if(strpos($file,'inith') !== false){
				$files[] = $file;
			  }
			}
			$count = 0;
			$songlist = [];
			
			foreach($files as $file) {
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				array_push($songlist,[$file,$filename,$count]);
				$box = str_replace("%AUDIO_FILE_NAME%",str_replace("'","",$filename),$template);
				$box = str_replace("%FILE_SIZE%",formatSizeUnits(filesize($file)),$box);
				$box = str_replace("%RAW_FILENAME%",$file,$box);
				$box = str_replace("%ID%","AudioID" + (string)$count,$box);
				$box = str_replace("%FILE_FORMAT%",$ext,$box);
				echo $box;
				$count += 1;
			}
			
		}else{
			foreach($files as $file) {
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				array_push($songlist,[$file,$filename,$count]);
				$box = str_replace("%AUDIO_FILE_NAME%",str_replace("'","",$filename),$template);
				$box = str_replace("%FILE_SIZE%",formatSizeUnits(filesize($file)),$box);
				$box = str_replace("%RAW_FILENAME%",$file,$box);
				$box = str_replace("%ID%","AudioID" . ((string)$count),$box);
				$box = str_replace("%FILE_FORMAT%",$ext,$box);
				echo $box;
				$count += 1;
			}
		}		
		?>
		<div class="ts fluid container">
			<br><br><br><br><br>
		</div>
    </div>



    <div id="fuctmenu" class="ts mini borderless bottom fixed evenly divided labeled icon menu" style="padding-bottom:8px;">
        <a href="../index.php" class="pwa item">
            <i class="chevron left icon"></i>
            Back
        </a>
        <a href="index.php" class="pwa item">
            <i class="browser icon"></i>
            Update List
        </a>
		<a class="item" onclick="toggleSearch()">
            <i class="search icon"></i>
            Search
        </a>
		<?php 
		if (file_exists("../Upload Manager/upload_interface.php")){
			echo '<a href="../Upload Manager/upload_interface.php?target=Audio&filetype=mp3,mp4,flac,wav,aac&finishing=ffmpeg_converter.php" class="pwa item">';
		}else{
			echo '<a href="" class="pwa disabled item">';
		}
		?>
            <i class="upload icon"></i>
            Upload
        </a>
        <a id="downloadmodeBtn" class="item" onclick="toggledownload();" style="">
            <i class="download icon"></i>
            Download
        </a>
    </div>
	
	<div id="downloadmode_reminder" class="ts active bottom right snackbar">
		<div id="sbtext" class="content">
			Download Mode Enabled.
		</div>
		<a class="primary action" onclick="toggledownload()">Disable</a>
	</div>
	
	<div style="display:none;">
		<div id="DATA_OBJECT_extStorageMode"><?php echo $extStorageMode;?></div>
		<div id="DATA_OBJECT_extStorageFolder"><?php echo $extStorageFolder;?></div>
		<div id="DATA_OBJECT_songlist"><?php echo json_encode($songlist); ?></div>
		<div id="DATA_OBJECT_search_keyword"><?php echo $keyword;?></div>
		<div id="DATA_OBJECT_shareMode"><?php echo $ModeS;?></div>
		<div id="DATA_OBJECT_ShareSong"><?php echo $SongS;?></div>
		<div id="DATA_OBJECT_pwaMode"><?php echo $pwa;?></div>
	</div>
	<script>

	</script>
<script src="index.js"></script>
</body>
</html>