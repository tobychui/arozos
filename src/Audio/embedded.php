<?php
include '../auth.php';
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
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
<style>
.transparent{
	background-color:rgba(255, 255, 255, 0) !important;
	border:1px solid transparent;
}

.seventytransparent{
	background-color:rgba(255, 255, 255, 0.7) !important;
	border:1px solid transparent;
}
body {
	background: rgba(255,255,255,0.7);
}

</style>
</head>
<body>
	<?php
	
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
?>

    <div class="ts small attached segmented single line selection items" style="top:0;">
		<?php 
		$_GET['id'] = -1;
		if(isset($_GET['filepath']) && $_GET['filepath'] != "" && isset($_GET['filename']) && $_GET['filename'] != ""){
					$shareMode = true;
				}else{
					$shareMode = false;
				}
				
		?>

		<!-- Audio Control System with no HTML5 Audio Attribute-->
		<div class="ts fluid container transparent" style="cursor: pointer;">
			<div id="audio_attr"style="display:none;">
			<audio id="player" controls autoplay>
			  <source src="" type="audio/mpeg">
				Your browser does not support the audio element.
			</audio>
			</div>
			<div id="YamiPlayer" class="content transparent" style="top:0;">
			<div id="songname" class="ts top attached segment transparent">
			NOW PLAYING ||
			</div>
			<div id="progressbardiv" class="ts attached progress">
				<div id="audioprogress" class="bar" style="width: 0%"></div>
			</div>
			<div class="ts bottom attached segment seventytransparent">
				<div class="ts icon buttons">
					<button class="ts disabled button" onclick="PreviousSong()"><i class="step backward icon"></i></button>
					<button class="ts button" onclick="playbtn()"><i id='playbtn' class="pause icon"></i></button>
					<button class="ts disabled button" onclick="NextSong()"><i class="step forward icon"></i></button>
					<button class="ts button" onclick="stopbtn()"><i class="stop icon"></i></button>
					<button class="ts button" onclick="volDown()"><i class="volume down icon"></i></button>
					<button class="ts button" onclick="volUp()"><i class="volume up icon"></i></button>
					<button class="ts button" onclick="repeatmode()"><i class="repeat icon"></i></button>
				</div>
				<span>
				<i id="voldis" class="volume off icon"> 100%</i>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
				<i id="timecode" class="time icon"> 0:00/0:00</i>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
				<i id="repmode" class="repeat icon"> Single</i>
				</span>
			</div>
			
			<!-- <button class="ts button" onclick="Show_Audio_Attrubute()">Show HTML5 Attrubute</button> -->
			</div>
		</div>
		<?php
		$SongS = "";
		if ($shareMode){
			$ModeS = "true";
			$SongS = json_encode([$_GET['filepath'],$_GET['filename'] ,$_GET['id']]);
		}else{
			$ModeS = "false";
		}
			
        $template = '<div href="" id="%ID%" class="ts item" onclick="PlaySong('."'".'%RAW_FILENAME%'."','" .'%AUDIO_FILE_NAME%'."','".'%ID%'."'".')">
			<div>
                <i class="big file audio outline icon"></i>
            </div>
            <div class="content">
                <div class="header">%AUDIO_FILE_NAME%</div>
                <div class="middoted meta">
                    <div>%FILE_SIZE%</div>
                   
                </div>
            </div>
        </div>';

		$files = array();
		$filepath = "uploads/";
		foreach (glob($filepath . "*.mp3") as $file) {
		  if(strpos($file,'inith') !== false){
			$files[] = $file;
		  }
		}
		$count = 0;
		$songlist = [];
		$keyword = "";
		foreach($files as $file) {
			$ext = pathinfo($file, PATHINFO_EXTENSION);
			$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
			$filename = hex2bin($filename);
			array_push($songlist,[$file,$filename,$count]);
			$count += 1;
			}		
		?>
    </div>
		<div style="display:none;">
		<div id="DATA_OBJECT_extStorageMode">false</div>
		<div id="DATA_OBJECT_extStorageFolder"></div>
		<div id="DATA_OBJECT_songlist"><?php echo json_encode($songlist); ?></div>
		<div id="DATA_OBJECT_search_keyword"><?php echo $keyword;?></div>
		<div id="DATA_OBJECT_embedded">true</div>
		<div id="DATA_OBJECT_shareMode"><?php echo $ModeS;?></div>
		<div id="DATA_OBJECT_ShareSong"><?php echo $SongS;?></div>
	</div>
	
	<div id="downloadmode_reminder" class="ts active bottom right snackbar">
		<div id="sbtext" class="content">
			Download Mode Enabled.
		</div>
		<a class="primary action" onclick="toggledownload()">Disable</a>
	</div>
<script src="index.js"></script>
<script>

</script>
</body>
</html>