<?php
include_once '../auth.php';
?>
<!DOCTYPE html>
<meta name="mobile-web-app-capable" content="yes">
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
    <script type='text/javascript' src="../script/ao_module.js"></script>
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<title>ArOZ Onlineβ</title>
	<style>
	    body{
	        background-color:#f5f5f5;
	    }
	    
	    .vdi{
	        padding-bottom:30px;
	        
	    }
		.segment{
			padding: 4px !important;
			padding-left: 10px !important; 
			padding-right: 10px !important;
		}
		.playable{
			border: 1px solid transparent !important;
			height:100% !important;
		}
		.playable:hover{
			border: 1px solid #0469d4 !important;
		}
		.info.segment{
			background-color: #0469d4 !important;
		}
	</style>
</head>
<body>
    <nav id="topnavbar" class="ts attached borderless small menu">
            <a href="index.php" class="item"><i class="angle left icon"></i></a>
            <a href="#" class="item">ArOZ Video</a>
    </nav>
	
	<div id="innerWrapper" style="width:100%" align="center">
	<?php
	    $infoTemplate = '<details class="ts small accordion">
            <summary>
                <i class="bookmark icon"></i>Video file details
            </summary>
            <div class="content" style="background-color:#ffffff;padding:8px;">
                <p><i class="folder open icon"></i>File access path: %FILEPATH%</p>
                <p><i class="file icon"></i>File storage size: %FILESIZE%</p>
            </div>
        </details>';
		if (isset($_GET['src']) && $_GET['src'] != ""){
			//There are given src for video attribute
			if (file_exists($_GET['src'])|| strpos($_GET['src'],"extDiskAccess.php")){
				echo '<video id="player" style="width:100%" src="'.$_GET['src'].'" autoplay controls></video>';
				//$filename = basename($_GET['src'], ".mp4");
				  $filedata = explode('/',$_GET['src']);
				  $fullFileName = array_pop($filedata);
				  $filename = str_replace(".mp4","",$fullFileName);
				if (ctype_xdigit(str_replace("inith","",$filename)) && strlen(str_replace("inith","",$filename)) % 2 == 0) {
					$decodedName = hex2bin(str_replace("inith","",$filename));
				}else{
					$decodedName = $filename;
				}
			}else{
				die('<i class="remove icon"></i>API call error: 404 File not found.');
			}
		}else{
			die('<i class="remove icon"></i>API call error: src value not found.');
		}
	?>
	</div>
	<div class="ts attached message">
		<?php
		function formatBytes($size, $precision = 2)
			{
				$base = log($size, 1024);
				$suffixes = array('Byte', 'KB', 'MB', 'GB', 'TB');   

				return round(pow(1024, $base - floor($base)), $precision) .' '. $suffixes[floor($base)];
			}
		echo '<div class="header" id="videoName">' . $decodedName . '</div>';
		$box = $infoTemplate;
		$box = str_replace("%FILEPATH%",$_GET['src'],$box);
		if (strpos($_GET['src'],"extDiskAccess.php") !== false){
			$extFile = explode("=",$_GET['src'])[1];
			$filesize = formatBytes(filesize($extFile));
		}else{
			$filesize =  formatBytes(filesize($_GET['src']));
		}
		$box = str_replace("%FILESIZE%",$filesize,$box);
		echo $box;
		?>
		<details class="ts small accordion">
            <summary>
                <i class="dropdown icon"></i>Display Setting
            </summary>
            <div class="content" style="background-color:#ffffff;padding:15px;">
                <div id="desktopMode"class="ts icon stackable fluid tiny buttons" style="display:none;">
        			<button class="ts basic button" onClick="Resize(50);">Small</button>
        			<button class="ts basic button" onClick="Resize(70);"><i class="expand icon"></i>Medium</button>
        			<button class="ts basic button" onClick="Resize(80);"><i class="maximize icon"></i>Large</button>
        			<button class="ts basic button" onClick="Resize(100);"><i class="resize horizontal icon"></i>Max Width</button>
        		</div>
            </div>
        </details>
        <div id="globVol">Global Volume: 100%</div>
	</div>
	<?php
	$playlistDir = "";
	$playlistItem = [];
	$extAccess = false;
	if (isset($_GET['playlist']) && $_GET['playlist'] != ""){
		if ($_GET['playlist'] == "uploads"){
			$playListName = "Unsorted";
		}else{
			$playListName = "";
		}
		$playlistDir = $_GET['playlist'];
		echo '<div class="ts segment">';
		echo '<div class="ts grid">
			<div class="ten wide column"><div class="ts segment"><p>Playlist <i class="angle double right icon"></i> '.$playListName.'</p></div></div>
			<div class="six wide column"><div class="ts segment">
			<div class="ts toggle checkbox">
				<input type="checkbox" id="toggle">
				<label for="toggle">Auto Play</label>
			</div>
			</div></div>
		</div>';
		$template = '<div class="ts grid">
			<div class="ten wide column"><div class="ts fluid segment">%Video Attrubute Name%</div></div>
			<div class="six wide column"><div class="ts fluid segment playable" align="center">%Operations%</div></div>
		</div>';
		$playlist = $_GET['playlist'];
		$files = glob($playlist . '/*.mp4');
		if (isset($_GET['isExt']) && $_GET['isExt'] == "true"){
			$extAccess = true;
		}else{
			$extAccess = false;
		}
		foreach ($files as $file){
			array_push($playlistItem,$file);
			//$thisfilename = basename($file,'.mp4');
			$filedata = explode('/',$file);
			$fullFileName = array_pop($filedata);
			$thisfilename = str_replace(".mp4","",$fullFileName);
			if (ctype_xdigit(str_replace("inith","",$thisfilename)) && strlen(str_replace("inith","",$thisfilename)) % 2 == 0) {
				$thisdecodedName = hex2bin(str_replace("inith","",$thisfilename));
			}else{
				$thisdecodedName = $thisfilename;
			}
			//$thisdecodedName = hex2bin(str_replace("inith","",$thisfilename));
			$thisitem = str_replace('%Video Attrubute Name%',$thisdecodedName,$template);
			if ($thisdecodedName == $decodedName){
				//If the looping loop back to the playing file, make it blue
				$thisitem = str_replace('ts fluid segment','ts inverted info segment',$thisitem);
				$thisitem = str_replace('%Operations%','PLAYING',$thisitem);
			}else{
				if ($extAccess == true){
					$viewPath = "vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=$file&playlist=$playlist&isExt=true";
					$thisitem = str_replace('%Operations%','<a href="'.$viewPath.'"><i class="play icon"></i>Play Video</a>',$thisitem);
				}else{
					$viewPath = "vidPlay.php?src=$file&playlist=$playlist";
					$thisitem = str_replace('%Operations%','<a href="'.$viewPath.'"><i class="play icon"></i>Play Video</a>',$thisitem);
				}
			}
			echo $thisitem;
		}
		echo '</div>';
	}
	?>
		<!-- Bottom Bar -->
	<br><br><br>
	<div id="btmbar"style="  position: fixed;
    z-index: 100; 
    bottom: 0; 
    left: 0;
    width: 100%;">
		<div class="ts tiny menu">
		    <a id="backbtn" class="item" href="index.php"><i class="angle left icon"></i></a>
			<a class="item" onClick="volDown();"><i class="volume down icon"></i>Vol-</a>
			<a class="item" onClick="volUp();"><i class="volume up icon"></i>Vol+</a>
			<?php
			//Check if QuickSend system exists for sharing function
			if (file_exists("../QuickSend/")){
				echo '<a class="item" onClick="share();"><i class="share alternate icon"></i>Share</a>';
			}else{
				echo '<a class="disabled item"><i class="share alternate icon"></i>Share</a>';
			}
			?>
			
			<a class="item" onClick="downlaod();"><i class="download icon"></i>Download</a>
		</div>
	</div>
	
	</div>
	<script>
	//These function is for ArOZ Online System quick storage data processing
	function CheckStorage(id){
		if (typeof(Storage) !== "undefined") {
			return true;
		} else {
			return false;
		}
	}
	function GetStorage(id){
		//All data get are string
		return localStorage.getItem(id);
	}
	function SaveStorage(id,value){
		localStorage.setItem(id, value);
		return true;
	}
	
	//Declare global variables
	var globVol;
	var video = document.getElementById('player');
	var playlist = <?php echo json_encode($playlistItem); ?>;
	var thisVidName = <?php echo json_encode($_GET['src']); ?>;
	var playlistName = <?php echo json_encode($playlistDir); ?>;
	var extAccess = <?php echo $extAccess? 'true' : 'false';?>; //1 = Accessing files outside of the web root, 0 = within web root
	
	video.onvolumechange = function() {
		UpdateGlobalVol(video.volume);
	};
	
	video.onended = function() {
		console.log("Video ended!");
		if (GetStorage('VidAutoPlay') == 'true'){
			//Play next item in the playlist
			for(var i = 0;i<playlist.length;i++){
				//console.log(thisVidName,playlist[i]);
				thisVidName = thisVidName.replace("\\","/");
				//console.log(thisVidName);
				playlist[i] = playlist[i].replace("\\","/");
				//console.log(playlist[i]);
				if (thisVidName.includes(playlist[i])){
					if (i + 1 == playlist.length){
						//if reaching the end of the playlist
						if (extAccess == 1){
							//Reading from external storage
							if (playlistName == ""){
							window.location.href="vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=" + playlist[0] ;
							}else if (playlistName != ""){
							window.location.href="vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=" + playlist[0] + "&playlist=" + playlistName + "&isExt=true";
							}
						}else{
							//Reading from web root
							if (playlistName == ""){
							window.location.href="vidPlay.php?src=" + playlist[0] ;
							}else if (playlistName != ""){
							window.location.href="vidPlay.php?src=" + playlist[0] + "&playlist=" + playlistName;
							}
						}
					}else{
						if (extAccess == 1){
							//Reading from exteranl storage
							if (playlistName == ""){
								window.location.href="vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=" + playlist[i+1] ;
							}else if (playlistName != ""){
								window.location.href="vidPlay.php?src=../SystemAOB/functions/extDiskAccess.php?file=" + playlist[i+1] + "&playlist=" + playlistName + "&isExt=true";
							}
						}else{
							//Reading from web root
							//If it is not the last video in the play list
							if (playlistName == ""){
								window.location.href="vidPlay.php?src=" + playlist[i+1];
							}else if (playlistName != ""){
								window.location.href="vidPlay.php?src=" + playlist[i+1] + "&playlist=" + playlistName;
							}
						}
					}
				}
			}
		}else{
			console.log("Playlist Finished.");
		}
	};
	
	function MobileCheck(){
	 var check = false;
	  (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
	  return check;	
	}
	
	function SetTitle(){
		$(document).attr("title",$('#videoName').html());
	}
	
	function CheckHorizontal(){
		screenHeight = $(window).height();
		screenWidth = $(window).width();
		if (screenWidth > screenHeight){
			return true;
		}else{
			return false;
		}
	}
	
	window.onresize = function(event) {
		if (MobileCheck() == true && CheckHorizontal() == true){
			$('#btmbar').hide();
		}
		if (MobileCheck() == true && CheckHorizontal() == false){
			$('#btmbar').show();
		}
	};

	function UpdateGlobalVol(value){
		//value = Math.round(value / 0.1) * 10;
		//value = value / 100;
		globVol = value;
		//To fix the terrible Javascript rounding problem
		var displayVol = (globVol * 100).toString();
		if (displayVol.includes(".")){
		    displayVol = displayVol.split(".");
		    displayVol.pop();
		}
		$('#globVol').html('Global Volume: ' +  displayVol + '%');
		SaveStorage('global_volume',value);
		
	}
	
	//On System ready
	$( document ).ready(function() {
		var lastvol = GetStorage('global_volume');
		if (lastvol != null){
			globVol = parseFloat(GetStorage('global_volume'));
			video.volume = globVol;
		}else{
			//no previous volume info
			globVol = 0.6;
			video.volume = globVol;
			SaveStorage('global_volume',0.6);
		}
		$('#globVol').html('Global Volume: ' + globVol*100 + '%');
		if (GetStorage('VidAutoPlay') == 'true'){
			$('#toggle').prop("checked",true);
		}else{
			$('#toggle').prop("checked",false);
		}
		if (MobileCheck() == false){
			//This is a desktop / laptop PC, make the player size smaller!
			$('#player').css('width', '70%');
			$('#desktopMode').css('display',''); //Show display setting
		}
		//Set the video attribute to previous page size
		if (GetStorage('VidAttrScale') != null){
			$('#player').css('width', GetStorage('VidAttrScale')+ '%');
			if (GetStorage('VidAttrScale') == "100"){
			    $("#topnavbar").hide();
			}
		}
		//Check if it is in mobile horizontal mode.
		if (MobileCheck() == true && CheckHorizontal() == true){
			$('#btmbar').hide();
		}
		if (MobileCheck() == true && CheckHorizontal() == false){
			$('#btmbar').show();
		}
		SetTitle();
	});
	
	$('#toggle').change(function() {
        if(this.checked) {
			SaveStorage('VidAutoPlay','true');
		}else{
			SaveStorage('VidAutoPlay','false');
		}
	});
	
	function share(){
		var url = window.location.href.replace("&","<and>");
		window.location.href = "../QuickSend/index.php?share=" + url;
	}
	
	function Resize(percentage){
		$('#player').css('width', percentage + '%');
		SaveStorage('VidAttrScale',percentage);
		if (percentage == 100){
		    $("#topnavbar").slideUp();
		}else{
		    $("#topnavbar").slideDown();
		}
	}
	
	function downlaod(){
		window.location.href = "download.php?download=" + thisVidName;
	}
	
	function volDown(){
		if (globVol >= 0.1){
			UpdateGlobalVol(globVol - 0.05);
			video.volume = globVol;
		}
	}
	
	function volUp(){
		if (globVol <= 0.9){
			UpdateGlobalVol(globVol + 0.05);
			video.volume = globVol;
		}
	}
    
    if (ao_module_virtualDesktop){
        $("body").addClass("vdi");
    }
	</script>
</body>
</html>