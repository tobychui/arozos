<?php
include '../auth.php';
?>
<!DOCTYPE html>
	<br>
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

    <div class="ts small attached segmented single line selection items">
		<?php if(isset($_GET['share']) && $_GET['share'] != "" && isset($_GET['display']) && $_GET['display'] != "" & isset($_GET['id']) && $_GET['id'] != ""){
					$shareMode = true;
				}else{
					$shareMode = false;
				}
		?>
		<script>
		<?php
			if ($shareMode){
				echo 'var ShareMode = true;';
				echo 'var ShareSong = ["'.$_GET['share'].'","'.$_GET['display'].'",'. $_GET['id'] .']';
			}else{
				echo 'var ShareMode = false;';
			}
		?>
		</script>
		<!-- Audio Control System with no HTML5 Audio Attribute-->
		<div class="ts fluid container" style="cursor: pointer;">
			<div id="audio_attr"style="display:none;">
			<audio id="player" controls autoplay style="display:none;">
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
					<button class="ts mini button" onclick="PreviousSong()"><i class="step backward icon"></i></button>
					<button class="ts mini button" onclick="playbtn()"><i id='playbtn' class="pause icon"></i></button>
					<button class="ts mini button" onclick="NextSong()"><i class="step forward icon"></i></button>
					<button class="ts mini button" onclick="stopbtn()"><i class="stop icon"></i></button>
					<button class="ts mini button" onclick="volDown()"><i class="volume down icon"></i></button>
					<button class="ts mini button" onclick="volUp()"><i class="volume up icon"></i></button>
					<button class="ts mini button" onclick="repeatmode()"><i class="repeat icon"></i></button>
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
		if(isset($_GET['search']) == true && $_GET['search'] != ""){
			$keyword = $_GET['search'];
			$loweredkeyword = mb_strtolower($keyword);
			foreach($files as $file) {
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				if (strpos(mb_strtolower($filename),$loweredkeyword) !== false){
					array_push($songlist,[$file,$filename,$count]);
					$box = str_replace("%AUDIO_FILE_NAME%",$filename,$template);
					$box = str_replace("%FILE_SIZE%",formatSizeUnits(filesize($file)),$box);
					$box = str_replace("%RAW_FILENAME%",$file,$box);
					$box = str_replace("%ID%","AudioID" + (string)$count,$box);
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
							<a href="../Upload Manager/upload_interface.php?target=Audio&reminder=This module only allow mp3 or mp4 uploads.&filetype=mp3,mp4&finishing=ffmpeg_converter.php">Upload</a>
							</div>
						   
						</div>
					</div>
					</div>';
				}
				
			
		}else{
			foreach($files as $file) {
				$ext = pathinfo($file, PATHINFO_EXTENSION);
				$filename = str_replace("." . $ext,"",str_replace("inith","",basename($file)));
				$filename = hex2bin($filename);
				array_push($songlist,[$file,$filename,$count]);
				$box = str_replace("%AUDIO_FILE_NAME%",$filename,$template);
				$box = str_replace("%FILE_SIZE%",formatSizeUnits(filesize($file)),$box);
				$box = str_replace("%RAW_FILENAME%",$file,$box);
				$box = str_replace("%ID%","AudioID" + (string)$count,$box);
				echo $box;
				$count += 1;
			}
		}		
		?>
		<div class="ts fluid container">
			<br><br><br><br><br>
		</div>
		<script type="text/javascript">
			var songlist = <?php echo json_encode($songlist); ?>;
			var search_keyword = "<?php echo $keyword;?>";
		</script>
    </div>
	<div class="ts top left attached label" style="background-color:#444444;color:white;">Audio Module / Background Worker Unit</div>
</html>