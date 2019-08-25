<?php
include '../auth.php';
?>
<!DOCTYPE html>
<meta name="mobile-web-app-capable" content="yes">
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<html>
<head>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<title>ArOZ Onlineβ</title>
</head>
<body style="background-color:rgba(10,10,10,1);overflow:hidden;">
	<div style="width:100%;" align="center">
	<?php
		if (isset($_GET['filepath']) && $_GET['filepath'] != ""){
			//There are given src for video attribute
			if (file_exists($_GET['filepath'])|| strpos($_GET['filepath'],"extDiskAccess.php")){
				echo '<video id="player" style="position:fixed; height:100%; max-width:100% ;top:0; left:0;" src="'.$_GET['filepath'].'" autoplay controls></video>';
				$filename = basename($_GET['filepath'], ".mp4");
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
		
		if (isset($_GET['filename']) && $_GET['filename'] != ""){
			$displayname = $_GET['filename'];
		}else{
			$displayname = $filename;
		}
	?>
	</div>
	<?php
	$playlistDir = "";
	$playlistItem = [];
	if (isset($_GET['playlist']) && $_GET['playlist'] != ""){
		if ($_GET['playlist'] == "uploads"){
			$playListName = "Unsorted";
		}else{
			$playListName = "";
		}
		$playlistDir = $_GET['playlist'];
		echo '<div class="ts segment">';
		echo '<div class="ts grid">
			<div class="ten wide column"><div class="ts segment"><h5>Playlist >> '.$playListName.'</h5></div></div>
			<div class="six wide column"><div class="ts segment">
			<div class="ts toggle checkbox">
				<input type="checkbox" id="toggle">
				<label for="toggle">Auto Play</label>
			</div>
			</div></div>
		</div>';
		$template = '<div class="ts grid">
			<div class="ten wide column"><div class="ts segment">%Video Attrubute Name%</div></div>
			<div class="six wide column"><div class="ts segment">%Operations%</div></div>
		</div>';
		$playlist = $_GET['playlist'];
		$files = glob($playlist . '/*.mp4');
		foreach ($files as $file){
			array_push($playlistItem,$file);
			$thisfilename = basename($file,'.mp4');
			$thisdecodedName = hex2bin(str_replace("inith","",$thisfilename));
			$thisitem = str_replace('%Video Attrubute Name%',$thisdecodedName,$template);
			if ($thisdecodedName == $decodedName){
				//If the looping loop back to the playing file, make it blue
				$thisitem = str_replace('ts segment','ts inverted info segment',$thisitem);
				$thisitem = str_replace('%Operations%','PLAYING',$thisitem);
			}else{
				$viewPath = "vidPlay.php?src=$file&playlist=$playlist";
				$thisitem = str_replace('%Operations%','<a href="'.$viewPath.'" style="color:#1A1A1A;">View Video</a>',$thisitem);
			}
			echo $thisitem;
		}
		echo '</div>';
	}
	?>
	
	</div>
	<script>
	//Check window resize and adjust video css
	var orgVidWidth = 0;
	var orgVidHeight = 0;
	var inVDI = !(!parent.isFunctionBar);
	var displayName = "<?php echo $displayname;?>";
	//Update functions called following the AOB 11-8-2018 updates
	//Now, the embedded windows can ask for resize properties and icon from the system
	if (inVDI){
		 //If it is currently in VDI, force the current window size and resize properties
		var windowID = $(window.frameElement).parent().attr("id");
		parent.setWindowIcon(windowID + "","video");
		parent.changeWindowTitle(windowID + "",displayName);
		//parent.setGlassEffectMode(windowID + "");
	}
	$( window ).resize(function(){
		if(this.resizeTO) clearTimeout(this.resizeTO);
        this.resizeTO = setTimeout(function() {
            $(this).trigger('resizeEnd');
        }, 100);
	});
	
	$(window).bind('resizeEnd', function() {
		//adjustVidSize();
		adjustVidWidth();
	});
	
	function adjustVidWidth(){
		var vw = $('#player').width();
		var sw = $( window ).width();
		var center = parseInt((sw - vw) / 2);
		$('#player').css("left",center);
	}
	
	function adjustVidSize(recursion = false){
		if (recursion){
			var sw = $( window ).width() - 1;
			var sh = $( window ).height()- 1;
		}else{
			var sw = $( window ).width();
			var sh = $( window ).height();
		}
		var vw = $('#player').width();
		var vh = $('#player').height();
		var ratio = orgVidWidth / orgVidHeight;
		if (vh > sh){
			if (vw > sw){
				$('#player').css('height',sh);
				$('#player').css('width',sw);
			}else if (vw < sw){
				$('#player').css('height', sh);
				$('#player').css('width', sh * ratio);
			}
		}else if (vh < sh){
			if (vw > sw){
				$('#player').css('width',sw);
				$('#player').css('height',sw / ratio);
			}else if (vw < sw){
				$('#player').css('width','auto');
				$('#player').css('height','auto');
			}
			
		}
		//Make the video element center of parent
		

		//Sometime the system will bugged and gives an incorrect scaling result.
		//This section of code is used to perform recursion checking on the video scale.
		sw = $( window ).width();
		sh = $( window ).height();
		vw = $('#player').width();
		vh = $('#player').height();
		if (vw > sw || vh > sh){
			//The height or width might be in decimal place lead to error.
			adjustVidSize(true);
		}
	}
	
	
	
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
	var thisVidName = <?php echo json_encode($_GET['filepath']); ?>;
	var playlistName = <?php echo json_encode($playlistDir); ?>;
	
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
				playlist[i] = playlist[i].replace("\\","/");
				if (thisVidName == playlist[i]){
					if (i + 1 == playlist.length){
						//if reaching the end of the playlist
						if (playlistName == ""){
						window.location.href="vidPlay.php?src=" + playlist[0] ;
						}else if (playlistName != ""){
						window.location.href="vidPlay.php?src=" + playlist[0] + "&playlist=" + playlistName;
						}
					}else{
						//If it is not the last video in the play list
						if (playlistName == ""){
							window.location.href="vidPlay.php?src=" + playlist[i+1] ;
						}else if (playlistName != ""){
							window.location.href="vidPlay.php?src=" + playlist[i+1] + "&playlist=" + playlistName;
						}
					}
				}
			}
		}
	};
	
	video.onplaying = function(){
		adjustVidWidth();
	}
	
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
	
	function LinkFunctionalBar(){
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
	}
	
	function UpdateGlobalVol(value){
		if (inVDI == false){
			value = Math.round(value / 0.1) * 10;
		}else{
			value = (value / 0.1) * 10;
		}
		value = value / 100;
		globVol = value;
		$('#globVol').html('Global Volume: ' + globVol*100 + '%');
		SaveStorage('global_volume',value);
		
	}
	
	$("#player").on("loadstart", function () {
         setTimeout(adjustVidWidth,300);
    });
	
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
		if (inVDI){
			setInterval(function() {
				LinkFunctionalBar();
			},1000);
		}
		$('#globVol').html('Global Volume: ' + globVol*100 + '%');
		if (GetStorage('VidAutoPlay') == 'true'){
			$('#toggle').prop("checked",true);
		}else{
			$('#toggle').prop("checked",false);
		}
		if (MobileCheck() == false){
			//This is a desktop / laptop PC, make the player size smaller!
			//$('#player').css('width', '70%');
			//$('#desktopMode').css('display',''); //Show display setting
		}
		//Set the video attribute to previous page size
		/*
		if (GetStorage('VidAttrScale') != null){
			$('#player').css('width', GetStorage('VidAttrScale')+ '%');
		}
		*/
		//Check if it is in mobile horizontal mode.
		if (MobileCheck() == true && CheckHorizontal() == true){
			$('#btmbar').hide();
		}
		if (MobileCheck() == true && CheckHorizontal() == false){
			$('#btmbar').show();
		}
		orgVidWidth = $('#player').width();
		orgVidHeight = $('#player').height();
		SetTitle();
		adjustVidWidth();
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
		//SaveStorage('VidAttrScale',percentage);
	}
	
	function downlaod(){
		window.location.href = "download.php?download=" + thisVidName;
	}
	
	function volDown(){
		if (globVol >= 0.1){
			UpdateGlobalVol(globVol - 0.1);
			video.volume = globVol;
		}
	}
	
	function volUp(){
		if (globVol <= 0.9){
			UpdateGlobalVol(globVol + 0.1);
			video.volume = globVol;
		}
	}

	</script>
</body>
</html>