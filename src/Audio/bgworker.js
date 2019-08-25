//Audio Module Background Worker
//ArOZ Online BETA control system

//Declare Global Variables
  var downloadmode = false;
  var lastactiveid = -1;
  var RepeatMode = 2;
  var SearchBarOn = false;
  var playingSong = [];
  
////////////////////////////

	$( document ).ready(function() {
	if (search_keyword != ""){
		//In Search Mode
		$( "#sbinput" ).val(search_keyword);
		SearchBarOn = true;
	}else{
		//Not in Search Mode
		$("#searchbar").hide();
	}
    $('#downloadmode_reminder').hide();
	$('#playbtn').attr('class', 'play icon');
	//Load the global volume from the stored data
	var globalvol = localStorage.getItem("global_volume");
	//console.log("Global Volume" + globalvol.toString());
	if (!globalvol){
		globalvol = 0.6;
	}
	player.volume = globalvol;
	$('#voldis').html(" " + (Math.round(player.volume * 100)).toString() + "%");
	//Load the repeat mode from stored data
	var repmode = localStorage.getItem("repeat_mode");
	if (repmode == 0){
		//0 
		$('#repmode').html(' Single');
		RepeatMode = 0;
	  }else if (repmode == 1){
		//1
		$('#repmode').html(' ALL');
		RepeatMode = 1;
	  }else{
		//2
		$('#repmode').html(' None');
		RepeatMode = 2;
	  }
	 console.log(songlist);
	 
	 if (ShareMode){
		 PlaySong(ShareSong[0],ShareSong[1],ShareSong[2]);
		 window.setTimeout(CheckPlaying, 500);
	 }
	});

	//On Pause or Play using Android notification on Firefox / Chrome
	var aud = document.getElementById("player");
	aud.onpause = function() {
		//Paused by the user on notification
		$('#playbtn').attr('class', 'play icon');
	};
	aud.onplay = function() {
		//Play by the user on notification
		$('#playbtn').attr('class', 'pause icon');
	};
	
	
  function toggleSearch(){
	  //Id of Search Bar: searchbar
	  if (SearchBarOn){
		  //Need to close the Search Bar
		  $("#searchbar").css("display", "none");
		  SearchBarOn = false;
	  }else{
		  $("#searchbar").css("display", "block");
		  SearchBarOn = true;
		  $(window).scrollTop(0);
		  $("#sbinput").focus();
	  }
  }
    $('#searchbar').bind("enterKey",function(e){
		var keyword = $( "#sbinput" ).val();
		if (keyword != ""){
			window.location.href = "../Audio/index.php?search=" + keyword;
		}else{
			window.location.href = "../Audio/";
		}
	});
	$('#searchbar').keyup(function(e){
		if(e.keyCode == 13)
		{
			$(this).trigger("enterKey");
		}
	});
  
  function toggledownload(){
	  if (downloadmode == true){
		  $('#downloadmode_reminder').stop();
		  $('#sbtext').html('Download Mode Disabled.');
		  $('#downloadmode_reminder').fadeIn('slow').delay(2000).fadeOut('slow');
		  downloadmode = false;
	  }else{
		  $('#downloadmode_reminder').stop();
		  $('#sbtext').html('Download Mode Enabled.');
		  $('#downloadmode_reminder').fadeIn('slow').delay(2000).fadeOut('slow');
		  downloadmode = true;
	  }
  }
  
  function getRealID(textid){
	  return parseInt(textid.replace("AudioID",""));
  }
  function change(sourceUrl) {
    var audio = $("#player");      
    $("#player").attr("src", "audio/" + sourceUrl);
    audio[0].pause();
    audio[0].load();//suspends and restores all audio element
    //audio[0].play(); changed based on Sprachprofi's comment below
    audio[0].oncanplaythrough = audio[0].play();

	}
	
	function share(){
		var shareSong = playingSong[0];
		var displayName = playingSong[1];
		var audioID = playingSong[2];
		if (shareSong != '' && shareSong != null){
			window.location.href="../QuickSend/index.php?share=" + "http://" + window.location.host + window.location.pathname + "?share=" + shareSong + "<and>display=" + displayName + "<and>id=" + audioID; 
	}	}


  function PlaySong(name,displayname,id){
	  if (downloadmode == false){
		  //This operation is for choosing song
		  $('#songname').html('NOW PLAYING || '+ displayname);
		  change(name);
		  playingSong = [name,displayname,id];
		  //console.log(playingSong);
		  $('#playbtn').attr('class', 'pause icon');
		  if (lastactiveid.toString() != id.toString()){
			$('#' + lastactiveid).attr('class', 'ts item'); 
			$('#' + id.toString()).attr('class', 'ts item active');
		  }
		  lastactiveid = id;
		  //$(document).prop('title', displayname);
		  //console.log(lastactiveid);
		  $("#Audio").animate({ scrollTop: 0 }, "slow");
	  }else if (downloadmode == true){
		  //This operation is for downloading the audio file
		  saveAs(name,displayname + ".mp3");
	  }
  }
  
  function CheckPlaying(){
	var player = document.getElementById('player');
	if (player.paused){
		//Chrome does not allow instant playing of audio so user have to click the btn themselves.
		$('#playbtn').attr('class', 'play icon');
	}
  }
  
  
  function NextSong(){
	  lastactiveid = parseInt(lastactiveid);
		if (lastactiveid != "undefined"){
			if (lastactiveid < songlist.length - 1){
			PlaySong(songlist[lastactiveid + 1][0],songlist[lastactiveid + 1][1],songlist[lastactiveid + 1][2]);
			}else{
			PlaySong(songlist[0][0],songlist[0][1],songlist[0][2]);	
			}
		}
  }
  
  function PreviousSong(){
	  lastactiveid = parseInt(lastactiveid);
		if (lastactiveid != "undefined"){
			if (lastactiveid > 0){
			PlaySong(songlist[lastactiveid - 1][0],songlist[lastactiveid - 1][1],songlist[lastactiveid - 1][2]);
			}
		}
  }
  
	function saveAs(uri, filename) {
		var link = document.createElement('a');
		if (typeof link.download === 'string') {
			document.body.appendChild(link); // Firefox requires the link to be in the body
			link.download = filename;
			link.href = uri;
			link.click();
			document.body.removeChild(link); // remove the link when done
		} else {
			location.replace(uri);
		}
	}


  function Show_Audio_Attrubute(){
	  $("#audio_attr").fadeIn("slow");
  }
  function Hide_Audio_Attrubute(){
	  $("#audio_attr").fadeOut("slow");
  }
  function repeatmode(){
	  //This set the repeat mode for the browser reference.
	  var repmode = localStorage.getItem("repeat_mode");
	  // 0 = Single Repeat, repeat the same song
	  // 1 = All Repeat, repeat when it reached the bottom of the list
	  // 2 = No Repeat, stop after finishing this song.
	  if (repmode == 0){
		//0 -> 1
		$('#repmode').html(' ALL');
		localStorage.setItem("repeat_mode", 1);
	  }else if (repmode == 1){
		//1 -> 2
		$('#repmode').html(' None');
		localStorage.setItem("repeat_mode", 2);
	  }else{
		//2 -> 0
		$('#repmode').html(' Single');
		localStorage.setItem("repeat_mode", 0);
	  }
	  
  }
  
  
  function playbtn(){
	  if (document.getElementById('player').paused == true){
		 $('#playbtn').attr('class', 'pause icon');
		 $('#player').trigger('play'); 
	  }else{
		$('#playbtn').attr('class', 'play icon');
		$('#player').trigger('pause');
	  }		
	  
  }
  function stopbtn(){
	  $('#player').trigger('pause');
	  document.getElementById('player').currentTime = 0;
	  $('#playbtn').attr('class', 'play icon');
  }
  
  $("#progressbardiv").click(function(e){
	   var parentOffset = $(this).parent().offset(); 
	   //or $(this).offset(); if you really just want the current element's offset
	   var relX = e.pageX - parentOffset.left;
	   var relY = e.pageY - parentOffset.top;
	   var divwidth = $(this).parent().width();
	   var ratio = relX / divwidth;
	   var player = document.getElementById('player');  
	   var targettime = Math.round(player.duration * ratio);
	   player.currentTime = targettime;
	   
	   //console.log(ratio);
	});

  var player = document.getElementById('player');  
	//For every time update
	player.addEventListener("timeupdate", function() {
		var currentTime = player.currentTime;
		var duration = player.duration;
		$('#timecode').html(" " + FTF(Math.round(currentTime)) + "/" + FTF(Math.round(duration)));
		$('#audioprogress').stop(true,true).animate({'width':(currentTime)/duration*100+'%'},0,'linear');
	});
	
	//When the audio file is loaded
	player.addEventListener("canplay", function() {
		//Load the global volume from the stored data
		var globalvol = localStorage.getItem("global_volume");
		//console.log("Global Volume" + globalvol.toString());
		if (!globalvol){
			globalvol = 0.6;
		}
		player.volume = globalvol;
		$('#voldis').html(" " + (Math.round(player.volume * 100)).toString() + "%");
		//Load the repeat mode from stored data
		var repmode = localStorage.getItem("repeat_mode");
		if (repmode == 0){
			//0 
			$('#repmode').html(' Single');
			RepeatMode = 0;
		  }else if (repmode == 1){
			//1
			$('#repmode').html(' ALL');
			RepeatMode = 1;
		  }else{
			//2
			$('#repmode').html(' None');
			RepeatMode = 2;
		  }
	});
	//Event when the player finished the audio playing
	player.addEventListener("ended", function() {
		var repmode = localStorage.getItem("repeat_mode");
		if (repmode == 0){
			//0 
			$('#repmode').html(' Single');
			RepeatMode = 0;
		  }else if (repmode == 1){
			//1
			$('#repmode').html(' ALL');
			RepeatMode = 1;
		  }else{
			//2
			$('#repmode').html(' None');
			RepeatMode = 2;
		  }
		if (RepeatMode == 0){
			stopbtn();
			$('#player').trigger('play'); 
		}else if (RepeatMode == 1){
			NextSong();
		}else{
			stopbtn();
		}
	});
	
  function volUp(){
	var audio = document.getElementById("player");
	if (audio.volume > 0.9){
		audio.volume = 1;
	}else{
		audio.volume += 0.1;
	}
	$('#voldis').html(" " + (Math.round(audio.volume * 100)).toString() + "%");
	localStorage.setItem("global_volume", audio.volume);
  }

  function volDown(){
	var audio = document.getElementById("player");
	if (audio.volume < 0.1){
		audio.volume = 0;
	}else{
		audio.volume -= 0.1; 
	}
	$('#voldis').html(" " + (Math.round(audio.volume * 100)).toString() + "%");
	localStorage.setItem("global_volume", audio.volume);
  }
	
	//Scroll Controller
	/*
	$(window).scroll(function (event) {
		var scroll = $(window).scrollTop();
		if (scroll > 200){
			$('#YamiPlayer').css('position', 'fixed');
			$('#YamiPlayer').css('top', '0');
			$('#YamiPlayer').css('right', '0');
			$('#YamiPlayer').css('width', '100%');
			$('#YamiPlayer').css('z-index', '1000');
		}else if (scroll < 50){
			$('#YamiPlayer').css('position', '');
			$('#YamiPlayer').css('top', '');
			$('#YamiPlayer').css('width', '100%');
			$('#YamiPlayer').css('right', '');
			$('#YamiPlayer').css('z-index', '');
		}
	});
	*/
	
	
	
	
	function FTF(time)
	{   
		// Hours, minutes and seconds
		var hrs = ~~(time / 3600);
		var mins = ~~((time % 3600) / 60);
		var secs = time % 60;

		// Output like "1:01" or "4:03:59" or "123:03:59"
		var ret = "";

		if (hrs > 0) {
			ret += "" + hrs + ":" + (mins < 10 ? "0" : "");
		}

		ret += "" + mins + ":" + (secs < 10 ? "0" : "");
		ret += "" + secs;
		return ret;
	}