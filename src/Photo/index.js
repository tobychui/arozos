//Photo Station Main Control Javascript for index.php
	var VDI = ao_module_virtualDesktop;
	var pwa = $("#DATA_PIPELINE_pwa").text().trim() == "true";
	if (VDI){
		//Inside VDI mode, init window properties
		$("#topMenu").hide();
		ao_module_setWindowIcon("photo");
		ao_module_setWindowTitle("ArOZ Photo");
		ao_module_setGlassEffectMode();
	}else if (pwa){
		$("#topMenu").hide();
		$("#contentFrame").css("padding","3px");
	}
	//Injecting variable from PHP using DOM event
	var folder_path = $("#DATA_PIPELINE_folder_path").text().trim();
	var search_keyword = $("#DATA_PIPELINE_search_keyword").text().trim();
	var sort_mode = $("#DATA_PIPELINE_sort_mode").text().trim();
	var path2name = JSON.parse($("#DATA_PIPELINE_path2name").text().trim());
	
	//Global variables
		var downloadOn = false;
		var previewmode = false;
		var screenWidth = 0;
		var screenHeight = 0;
		var PreviewWidth = 0;
		var PreviewHeight = 0;
		var resizecount = 0;
		var currentViewingPath = "";
		/////////////////
		$(document).ready(function() {
		  //If there are search result, put it into the search bar
		  if (search_keyword != ""){
			$('#searchbar').val(search_keyword);
		  }
		  //Update the folder path shown on file explorer (?
		  if (folder_path != ""){
				$('#folderdir').html(ao_module_codec.decodeHexFoldername(folder_path));
		  }else{
				$('#folderdir').html('Unsorted');
		  }
		  //Update Sort Mode
		  if (sort_mode == ""){
			  $("#sort1").attr('class', 'ts button active');
			  $("#sort2").attr('class', 'ts button');
		  }else if (sort_mode == "reverse"){
			  $("#sort1").attr('class', 'ts button');
			  $("#sort2").attr('class', 'ts button active');
		  }
		  //Hide the notification bar
		  $('#nbar').hide();
		  
		  //Get Preview Image Size
		  var img = document.getElementById('previewingImage'); 
		  PreviewWidth = img.clientWidth;
		  if (PreviewWidth < $('#previewImageDiv').width()){
			  PreviewWidth = $('#previewImageDiv').width();
		  }
		  
		  //Get Screen Width
		  screenWidth = $(window).width();
		  screenHeight = $(window).height();
		  centerPreview(screenWidth,PreviewWidth);
		  
		  //console.log(path2name);
		});
		ts('.ts.dropdown:not(.basic)').dropdown();
		
		function uploadImage(){
			if (pwa){
				window.open("../Upload Manager/upload_interface.php?target=Photo&filetype=jpg,png,jpeg,gif&finishing=Image_manager.php");
			}else{
				window.location.href = "../Upload Manager/upload_interface.php?target=Photo&filetype=jpg,png,jpeg,gif&finishing=Image_manager.php";
			}
		}
		
		function openImageManager(){
			if (pwa){
				window.open("Image_manager.php");
			}else{
				window.location.href = "Image_manager.php";
			}
		}
		
		$(window).resize(function() {
			var img = document.getElementById('previewingImage'); 
			PreviewWidth = img.clientWidth;
			if (PreviewWidth < $('#previewImageDiv').width()){
			  PreviewWidth = $('#previewImageDiv').width();
			}
			PreviewHeight = img.clientHeight;
			screenWidth = $(window).width();
			screenHeight = $(window).height();
			setTimeout(resizeImage, 100);
			console.log(PreviewWidth,screenWidth);
			console.log(PreviewHeight,screenHeight);
		});
		
		//Share this page
		function shareThis(){
			//alert(window.location.href);
			var currentHref = window.location.href;
			if (pwa){
				window.open("../QuickSend/index.php?share=" + currentHref);
			}else{
				window.location.href = "../QuickSend/index.php?share=" + currentHref;
			}
			
		}
		
		//Handle document keypress events
		$(document).keydown(function(e) {
			  if (e.keyCode == 37){
				  //Previous Image
				  if (previewmode == true){
					  //It is currently previewing and user want to switch to previous image
					  var viewingCount = GetPosInFileList(currentViewingPath);
					  TogglePreview(0);
					  var Path = path2name[viewingCount-1][0];
					  if (Path != "undefined"){
						TogglePreview(path2name[viewingCount-1][0]);
					  }
				  }
			  }
			  if(e.keyCode == 39){
				  //Next Image
				  if (previewmode == true){
					  //It is currently previewing and user want to switch to next image
					  var viewingCount = GetPosInFileList(currentViewingPath);
					  TogglePreview(0);
					  if (Path != "undefined"){
						TogglePreview(path2name[viewingCount+1][0]);
					  }
				  }
			  }
		
		});

		function GetPosInFileList(path){
			var files = path2name;
			for(var i = 0; i < files.length;i++){
				if (files[i][0] == path){
					return i;
				}
			}
			return -1;
		}
		
		//Load Image to Preview
		function TogglePreview(imagepath){
			if (downloadOn == false){
				var img = document.getElementById('previewingImage'); 
				if (previewmode == false && imagepath != 0){
					currentViewingPath = imagepath;
					//Amazing hack to make the auto resize work :)
					setTimeout(resizeImage, 100);
					//Open Preview Window
					$("#previewingImage").attr('class', 'ts massive image');
					$('#previewingImage').attr("src", imagepath);
					$('#imagePreview').fadeIn('fast');
					var ext = imagepath.split(".").pop();
					$('#previewImagetxt').html('  <i class="image icon"></i>' + ext + '    <i class="folder open icon"></i>/' + imagepath + '    <i class="external icon"></i><a href="' + imagepath +'" target="_blank">View Raw</a>  <br><p></p>');
					previewmode = true;
				}else{
					//Closing preview mode
					$('#imagePreview').fadeOut('fast');
					previewmode = false;
				}
			}else{
				//Download Mode is On
				var orgname = GetFileName(imagepath)
				saveAs(imagepath,orgname);
			}
		}
		
		//Save as specific filename
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
		
		
		//Get the real filename from the PHP JSON
		function GetFileName(filepath){
			for(var k = 0; k < path2name.length; k++){
				if(path2name[k][0] == filepath ){
					return path2name[k][1];
				}
			}
		}
		
		//Auto resize handler
		function resizeImage() {
			var img = document.getElementById('previewingImage'); 
			PreviewWidth = img.clientWidth;
			if (PreviewWidth < $('#previewImageDiv').width()){
			  PreviewWidth = $('#previewImageDiv').width();
			}
			PreviewHeight = img.clientHeight;
			screenWidth = $(window).width();
			screenHeight = $(window).height();
			centerPreview(screenWidth,PreviewWidth);
			resizecount += 1;
			if (resizecount < 10){
				setTimeout(resizeImage, 50);
			}else{
				resizecount = 0;
				if (PreviewHeight > screenHeight - 150){
					//Change it to a smaller class
					console.log('Adjusting Image Size');
					$("#previewingImage").attr('class', 'ts large image');
					setTimeout(resizeImageTiny, 100);
				}
			}
		}
		
		function resizeImageTiny() {
			var img = document.getElementById('previewingImage'); 
			PreviewWidth = img.clientWidth;
			if (PreviewWidth < $('#previewImageDiv').width()){
			  PreviewWidth = $('#previewImageDiv').width();
			}	
			PreviewHeight = img.clientHeight;
			screenWidth = $(window).width();
			screenHeight = $(window).height();
			centerPreview(screenWidth,PreviewWidth);
			resizecount += 1;
			if (resizecount < 10){
				setTimeout(resizeImageTiny, 50);
			}else{
				resizecount = 0;
				if (PreviewHeight > screenHeight){
					//Change it to a smaller class
					console.log('Adjusting Image Size');
					$("#previewingImage").attr('class', 'ts medium image');
					//setTimeout(SingleImageUpdate, 100);
				}
			}
		}
		
		function SingleImageUpdate(){
			var img = document.getElementById('previewingImage'); 
			PreviewWidth = img.clientWidth;
			if (PreviewWidth < $('#previewImageDiv').width()){
			  PreviewWidth = $('#previewImageDiv').width();
			}
			PreviewHeight = img.clientHeight;
			screenWidth = $(window).width();
			screenHeight = $(window).height();
			centerPreview(screenWidth,PreviewWidth);
		}
		//Move Preview Image from Left
		function centerPreview(sw,iw){
			var offsets = Math.round(sw / 2 - iw / 2);
			$("#previewImageDiv").css("left", offsets + "px");
		}
		
		
		//Download Mode
		function downloadmode(){
			if (downloadOn == false){
				//Turn download mode on
				$('#nbartxt').html('Download Mode Enabled.');
				$('#nbar').stop().fadeIn('slow').delay(2000).fadeOut('slow');
				downloadOn = true;
				$("#dlbtn").attr('class', 'ts button active');
			}else{
				//Turn off download mode
				$('#nbartxt').html('Download Mode Disabled.');
				$('#nbar').stop().fadeIn('slow').delay(2000).fadeOut('slow');
				$("#dlbtn").attr('class', 'ts button');
				downloadOn = false;
			}
		}
		
		
		//Switch sorting mode
		function changeSortMethod(id){
			var cmd = "";
			if (folder_path != ""){
				cmd += "?folder=" + folder_path;
			}
			if (search_keyword != ""){
				if (cmd == ""){
					cmd += "?search=" + search_keyword;
				}else{
					cmd += "&search=" + search_keyword;
				}
				
			}
			
			if (pwa){
				if (cmd.includes("?") == false){
					cmd += "?pwa=enabled";
				}else{
					cmd += "&pwa=enabled";
				}
				
			}
			if (id == 1){
				//Change to sort mode
				window.location = "index.php" + cmd;
			}else if (id == 2){
				//Change to rsort mode
				var pwaSupport = "";
				if (pwa && window.location.href.includes("pwa") == false){
					pwaSupport = "&pwa=enabled";
				}
				if (cmd == ""){
					window.location = "index.php?sort=reverse" + pwaSupport;
				}else{
					window.location = "index.php" + cmd + "&sort=reverse" + pwaSupport;
				}
			}
		}
		
		//Switch viewing folder
		function changeFolderView(folder_name){
			if (folder_name != 0){
				if (pwa){
					window.location = "index.php?folder=" + folder_name + "&pwa=enabled";
				}else{
					window.location = "index.php?folder=" + folder_name;
				}
				
			}else{
				if (pwa){
					window.location = "index.php?pwa=enabled";	
				}else{
					window.location = "index.php";	
				}
				
			}
		}
		//On Search Enter pressed
		$('#searchbar').on('keydown', function(e) {
			if (e.which == 13) {
				e.preventDefault();
				if (folder_path != ""){
					window.location = "index.php?folder=" + folder_path + "&search=" + $('#searchbar').val();
				}else{
					window.location = "index.php?search=" + $('#searchbar').val();
				}
			}
		});