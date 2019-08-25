<?php
include '../../../auth.php';
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
    <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
	<script src="../../../script/jquery.min.js"></script>
    <title>AOB File Explorer</title>
    <style type="text/css">
        body {
            background-color: rgb(250, 250, 250);
            overflow: scroll;
        }
    </style>
</head>
<body>
	<?php
	$mode = "file";
	$permissionLevel = 0;
	$dir = "";
	$moduleName = "";
	$returnPath = "";
	//PHP Script for modifying editing modes
	function mv($var){
		if (isset($_GET[$var]) !== false && $_GET[$var] != ""){
			return $_GET[$var];
		}else{
			return null;
		}
	}
	
	//1. Select File or Folder Mode
	//File mode can only modify filesize
	//Directory mode can modify folder as well as files
	if (mv("mode") != null){
		$mode = mv("mode");
		if ($mode != "file" && $mode != "folder"){
			die("ERROR. Mode only support 'file' or 'folder'. ");
		}
	}else{
		//Continue with file mode
	}
	
	
	//2. Allow functions of copy & paste, cut & paste, delete, move
	//Read only: Lv 0
	//Read and Write: Lv 1
	//Read, Write (Move) and Delete Lv 2
	if (mv("controlLv") != null){
		$clv = mv("controlLv");
		if ($clv < 0 || $clv > 2){
			die("ERROR. Unknown Control Level Setting ('controlLv' error)");
		}
		$permissionLevel = $clv;
	}else{
		//Continue with read only mode
	}
	
	
	//3. Select Starting Directory Path
	if (mv("dir") != null){
		$edir = "../../../" . mv("dir");
		if (file_exists($edir) == false){
			die("ERROR. dir not exists.");
		}
		$dir = $edir;
	}else{
		$dir = ".";
		//Continue with current functional directory
	}
	
	//4. Identify module name
	if (mv("moduleName") != null){
		$mn = mv("moduleName");
		if ($mn == null || file_exists("../../../" . $mn) == false){
			die("ERROR. Module not exists. Leave empty for non-modular operation but permission level will be set to READ ONLY.");
		}
		$moduleName = $mn;
	}else{
		//Continue with current functional directory and Read Only Mode
		$moduleName = ".";
		
	}
	//5. Check if the dir is inside of the module. If not, reject access
	if (strpos(realpath($dir),realpath("../../../" . $moduleName)) !== False){
		//This path is inside of the installed module
		
	}else{
		//This path is not inside of the module, reject connections
		die("ERROR. Module is trying to access files outside of the module itself.");
	}
	
	//6. (Optional) Finishing Path, when operation finish, return to this path.
	if (mv("finishing") != null){
		$returnPath = mv("finishing");
	}else{
		//If no return path, try to return to the module
		if ($moduleName != ""){
			$returnPath = "../../../" . $moduleName;
		}else{
			$returnPath = "../../../index.php";
		}
	}
	
	
	?>
    <div class="ts container">
        <!-- Menu -->
        <div class="ts breadcrumb">
            <a href="" class="section">ArOZβ Files</a>
            <div class="divider">/</div>
            <a id="moduleName" href="" class="section"><?php
			if ($moduleName == ""){
				echo 'Unknown Module (READ ONLY)';
			}elseif ($moduleName == "."){
				echo "Admin @ Root" . "(Mode: $permissionLevel)";
			}else{
				echo $moduleName . "(Mode: $permissionLevel)";
			}
			?></a>
            <div class="divider">/</div>
            <div class="active section">
                <i class="folder icon"></i><?php 
				if ($dir == "."){
					if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
						echo realPath("../../../") . "\\";
					}else{
						echo realPath("../../../") . "/";
					}
				}else{
					if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
						echo realpath($dir) . '\\';
					}else{
						//Not windows. There will be a lot of ../ if accessing external storage
						//This code is used to remove those dots if external storage
						if (strpos($dir,"../../../../") !== false){
							//It is outside of the web root
							echo str_replace("../../../../","",realpath($dir)) . '/';
						}else{
							//It is inside the web root
							echo realpath($dir) . '/';
						}
					}
				}

				
				
				?>
            </div>
        </div>

        <br><br>

        <div class="ts grid">
            <div class="eleven wide column">
				<div id="sortedFolderList" class="ts selection segmented list">
				<div id="controls" class="item">
					<?php
					if ($permissionLevel >= 0){
						echo '<button class="ts labeled mini icon button" onClick="openClicked();">
								<i class="folder open outline icon"></i>
									Open
							  </button>
							  <button id="downloadbtn" class="ts labeled mini icon button" onClick="downloadFile();">
								<i class="download icon"></i>
									Download
							  </button>';
					}
					if($permissionLevel >= 1){
						echo '<button id="copybtn" onClick="copy();" class="ts labeled mini icon button">
							<i class="copy icon"></i>
								Copy
							</button>
							<button id="move" onClick="paste();" class="ts labeled mini icon button">
							<i class="paste icon"></i>
							Paste
							</button>
							<button id="newfolder" class="ts labeled mini icon button">
								<i class="folder outline icon"></i>
								New Folder
							</button>
							<button id="upload" class="ts labeled mini icon button">
								<i class="upload icon"></i>
								Upload
							</button>
							';
					}
					if($permissionLevel >= 2){
						echo '
						<button id="delete" class="ts labeled mini icon button" onClick="ConfirmDelete();">
							<i class="trash outline icon"></i>
							Delete
						</button>';
					}
					?>	
                    </div>
				</div>
                <div id="sortedFileList" class="ts selection segmented list">
				<!-- Function Bar for file management-->
				<br><br><br><br><br><br>
					    <div class="ts active inverted dimmer">
							<div class="ts text loader">Loading...</div>
						</div>
                </div>
            </div>

            <div class="five wide column" style="position:fixed;right:5px;">
                <div class="ts card">
                    <div class="secondary very padded extra content">
                        <div id="fileicon" class="ts icon header">
                            <i class="file outline icon"></i>
                        </div>
                    </div>

                    <div class="extra content">
                        <div id="filename" class="header">No selected file</div>
                    </div>

                    <div class="extra content">
                        <div class="ts list">
                            <div class="item">
                                <i class="folder outline icon"></i>
                                <div class="content">
                                    <div class="header">Full Path</div>
                                    <div id="thisFilePath" class="description">N/A</div>
                                </div>
                            </div>

                            <div class="item">
                                <i class="file outline icon"></i>
                                <div class="content">
                                    <div class="header">File Size</div>
                                    <div id="thisFileSize" class="description">N/A</div>
                                </div>
                            </div>

                            <div class="item">
                                <i class="code icon"></i>
                                <div class="content">
                                    <div class="header">MD5</div>
                                    <div id="thisFileMD5" class="description">N/A</div>
                                </div>
                            </div>
                        </div>
						
                    </div>
                </div>
                <div class="ts horizontal right floated middoted link list">
                    <a class="item" onClick="UpdateFileList(currentPath);">Refresh</a>
                    <a href="" class="item">ArOZβ File Explorer</a>
                </div>
            </div>
        </div>
    </div>
	<!-- Sorting Buffer -->
	<div id="folderList" style="background-color:#b1cdf9;display:none;">
		
	</div>
	<div id="fileList" style="background-color:#b1efb7;display:none;">
		
	</div>
	<!-- Notice Box-->
	<div id="noticeCell" class="ts active bottom right snackbar" style="display:none;">
		<div id="noticeContent" class="content">
			Loading...
		</div>
	</div>
	
	<!-- Delete Confirm Box -->
	<dialog id="delConfirm" class="ts fullscreen modal" style="position:fixed;top:10%;left:30%;width:40%;max-height:70%">
		<h5 class="ts fluid header" style="color:#ff778e;">
			<div class="content" style="color:#ff778e;">
				<i class="trash icon"></i>Delete Confirm
				<div class="sub header" style="color:#ff778e;">This file will be removed. This action CANNOT BE UNDONE.</div>
			</div>
		</h5>
		<div class="content" style="width:100%;height:200px;overflow-y:scroll;overflow-wrap: break-word;">
			<p id="dname">Loading...</p>
			<p id="drname" >Loading...</p>
			<p id="dfpath">Loading...</p>
		</div>
		<div class="actions">
			<button class="ts deny basic button" onClick="$('#delConfirm').fadeOut('fast');deleteConfirmInProgress = false;">
				Cancel
			</button>
			<button class="ts negative basic button" onClick="deleteFile();">
				Confirm
			</button>
		</div>
	</dialog>
	
	
	<script>
	//AOB File Management System Alpha
	//This file management system is like Windows Explorer, user can do whatever they want.
	//Use with care if your module is using this explorer and remind user of the risk of system damage.
	var controlsTemplate = "";
	var PermissionMode = <?php echo $permissionLevel;?>;
	var startingPath = "<?php echo $dir;?>";
	var currentPath = startingPath;
	var lastClicked = -1;
	var globalFilePath = [];
	var dirs = [];
	var files = [];
	var zipping = 0; //Check the number if zipping in progress
	var clipboard = ""; //Use for copy and paste
	var ctrlDown = false; //Use for Ctrl C and Ctrl V in copy and paste of files
	var deletePendingFile = "";//Delete Pending file, delete while delete confirm is true
	var deleteConfirmInProgress = false; // Record if delete confirm is in progress, then bind to suitable key press

	//Clone the file controls into js after the page loaded
	$( document ).ready(function() {
		controlsTemplate = $('#controls').html();
		if (startingPath == "."){
			//Launching from no variables at all
			startingPath = "../../../.";
			currentPath = startingPath;
		}
		UpdateFileList(startingPath);
	});
	
	$(document).keydown(function(e) {
        if (e.keyCode == 17 || e.keyCode == 91) ctrlDown = true;
		if (e.keyCode == 67){
			//Key C
			if (ctrlDown == true){
				//Ctrl + C is pressed
				copy();
			}
		}else if (e.keyCode == 86){
			//Key V
			if (ctrlDown == true){
				//Ctrl + V is pressed
				paste();
			}
		}else if (e.keyCode == 46){
			//Delete Button
			ConfirmDelete();
		}else if (e.keyCode == 27 && deleteConfirmInProgress == true){
			//ESC pressed, Cancel Delete
			$('#delConfirm').fadeOut('fast');
			deleteConfirmInProgress = false;
		}else if (e.keyCode == 13 && deleteConfirmInProgress == true){
			//Enter pressed, Confirm Delete
			deleteFile();
		}
		
	}).keyup(function(e) {
        if (e.keyCode == 17 || e.keyCode == 91) ctrlDown = false;
		
	});
	
	
	function AppendControls(){
		//Append the controls back to the Filelist after reloading the filelist
		$('#sortedFolderList').append('<div id="controls" class="item">' + controlsTemplate + '</div>');
	}
	
	function LoadingErrorTest(){
		if ($('#sortedFileList').html().includes("<br><br><br><br><br><br><div")){
			//Something went wrong while loading the page
			$('#sortedFileList').html('<br><br><br><br><br><br><div class="ts active inverted dimmer"><div class="ts text loader">Seems something went wrong.<br>Try <a href="">refreshing</a> the page?</div></div>');
		}
	}
	
	function SortFolder(){
		$('#sortedFolderList').html("");
		AppendControls();
		//This function was added to sort the ids from buffer zone to corrisponding divs
		for (var i =-2 ; i < dirs.length; i++){
			if (checkIdExists(i) == true){
				$('#' + i ).clone().appendTo('#sortedFolderList');
			}
		}
	}
	
	function SortFiles(){
		$('#sortedFileList').html("");
		//AppendControls();
		//This function was added to sort the ids from buffer zone to corrisponding divs
		for (var i =dirs.length ; i < globalFilePath.length; i++){
			if (checkIdExists(i) == true){
				$('#' + i ).clone().appendTo('#sortedFileList');
			}
		}
	}
	
	function ClearSortBuffer(){
		$('#sortedFolderList').html("");
		$('#sortedFileList').html("");
	}
	
	function checkIdExists(id){
		if ($("#" + id).length == 0){
			return false;
		}else{
			return true;
		}
	}
	function UpdateFileList(directory){
		ClearSortBuffer();
		setTimeout(LoadingErrorTest,15000);
		$('#sortedFileList').html('<br><br><br><br><br><br><div class="ts active inverted dimmer"><div class="ts text loader">Loading...</div></div>');
		$('#folderList').html("");
		lastClicked = -1;
		$.ajax({
			url:"listdir.php?dir=" + directory,  
			success:function(data) {
				//console.log(data);
				PhraseFileList(data); 
			}
		  });
	}
	
	function PhraseFileList(json){
		$('#fileList').html("");
		$('#folderList').html("");
		globalFilePath = [];
		AppendControls();
		dirs = json[0];
		files = json[1];
		var templatef = '<div id="%NUM%" class="item" ondblclick="openFolder(%NUM%);" onClick="ItemClick(%NUM%);" style="overflow: hidden;"><i class="folder outline icon"></i>%FILENAME%</div>';
		var template = '<div id="%NUM%" class="item" ondblclick="openClicked();" onClick="ItemClick(%NUM%);" style="overflow: hidden;"><i class="%ICON% icon"></i>%FILENAME%</div>';
		var totalCount = 0;
		if (currentPath != startingPath){
			if (currentPath.includes("../../../../../../..")){
				//The directory is outside the web root.
				$('#folderList').append('<div id="-1" class="item" ondblclick="ParentDir();" style="overflow: hidden;"><i class="folder outline icon"></i>' + currentPath.replace("../../../../../../../","External_Storage >/") +'</div>');
			}else{
				//The directory is inside the web root
				$('#folderList').append('<div id="-1" class="item" ondblclick="ParentDir();" style="overflow: hidden;"><i class="folder outline icon"></i>' + currentPath.replace("../../","") +'</div>');
			}
		}
		SortFolder();
		for(var i = 0; i < dirs.length;i++){
			//Append all the folders into the list
			var dirname = dirs[i].replace(currentPath + "/","");
			AppendHexFolderName(dirname,totalCount,templatef);
			globalFilePath[totalCount] = dirs[i];
			totalCount++;
			/*
			$('#fileList').append(templatef.replace("%NUM%",totalCount).replace("%NUM%",totalCount).replace("%NUM%",totalCount).replace("%FILENAME%",dirname));
			totalCount++;
			*/
		}
		for(var i = 0; i < files.length;i++){
			//Append all the files into the list
			var filename = files[i].replace(currentPath + "/","");
			var ext = GetFileExt(filename);
			var fileicon = GetFileIcon(ext);
			var thistemplate = template.replace("%ICON%",fileicon);
			if (filename.substring(0, 5) == "inith"){
				//This is a file with encoded filename
				AppendUMFileName(filename,totalCount,thistemplate);
				globalFilePath[totalCount] = files[i];
				totalCount++;
			}else{
				//This is not a file uploaded with UM
				$('#fileList').append(thistemplate.replace("%NUM%",totalCount).replace("%NUM%",totalCount).replace("%FILENAME%",filename));
				globalFilePath[totalCount] = files[i];
				totalCount++;
				SortFiles();
			}
			
		}
		SortFiles();
		
	}

	function AppendUMFileName(rawname,id,template){
		$.get( "um_filename_decoder.php?filename=" + rawname, function( data ) {
		  $('#fileList').append(template.replace("%NUM%",id).replace("%NUM%",id).replace("%FILENAME%",data));
		  $('#' + id).css("background-color","#d8f0ff");
		  SortFiles();
		});
	}
	
	function AppendHexFolderName(rawname,id,template){
		$.get( "hex_foldername_decoder.php?dir=" + rawname, function( data ) {
			$('#folderList').append(template.replace("%NUM%",id).replace("%NUM%",id).replace("%NUM%",id).replace("%FILENAME%",data));
		  if (data == rawname){
			  //The file isn't encoded into hex
		  }else{
			 $('#' + id).css("background-color","#caf9d1"); 
		  }
		  SortFolder();
		  
		});
	}
	
	
	function GetFileIcon(ext){
		if (ext == "txt"){
			return "file text outline";
		}else if (ext == "pdf"){
			return "file pdf outline";
		}else if (ext == "png" || ext == "jpg" || ext == "psd" || ext == "jpeg" || ext == "ttf" || ext == "gif"){
			return "file image outline";
		}else if (ext == "7z" || ext == "zip" || ext == "rar" || ext == "tar"){
			return "file archive outline";
		}else if (ext == "flac" || ext == "mp3" || ext == "aac" || ext == "wav"){
			return "file audio outline";
		}else if (ext == "mp4" || ext == "avi" || ext == "mov" || ext == "webm"){
			return "file video outline";
		}else if (ext == "php" || ext == "html" || ext == "exe" || ext == "js"){
			return "file code outline";
		}else if (ext == "db"){
			return "file";
		}else if (ext.substring(0,1) == "/"){
			return "folder open outline";
		}else{
			return "file outline";
		}
	}
	function GetFileExt(filename){
		return filename.split('.').pop();
	}
	
	function ItemClick(num){
		//What to do when the user click on a file
		$('#'+lastClicked).removeClass("active");
		$('#'+num).addClass("active");
		$('#thisFilePath').html(rtrp(globalFilePath[num]));
		var ext = GetFileExt(globalFilePath[num]);
		var fileicon = GetFileIcon(ext);
		if (fileicon == "file image outline" && ext != "psd"){
			$('#fileicon').html('<img class="ts small rounded image" src="'+globalFilePath[num]+'">');
		}else{
			$('#fileicon').html('<i class="'+ fileicon +' icon"></i>');
		}
		$('#filename').html($('#' + num).html());
		getMD5(globalFilePath[num]);
		getFilesize(globalFilePath[num]);
		lastClicked = num;
		
		//Check if it is a file or folder. Change the buttons if needed
		if (lastClicked == -1){
			//Something gone wrong :(
		}else if(lastClicked < dirs.length){
			//The user clicked on a folder
			//Change download button to zip and download
			$('#downloadbtn').html('<i class="zip icon"></i>Zip&Down');
		}else{
			//The user clicked on a file
			//Change download button to download
			$('#downloadbtn').html('<i class="download icon"></i>Download');
		}
	}
	
	function getMD5(filepath){
		$.get("md5.php?file=" + filepath, function( data ) {
		  $('#thisFileMD5').html(data);
		});
	}
	
	function getFilesize(filepath){
		$('#thisFileSize').html("Calculating...");
		$.get("filesize.php?file=" + filepath, function( data ) {
		  $('#thisFileSize').html(data);
		});
	}
	
	
	function rtrp(path){
		return path.replace("../../../","");
	}
	function ParentDir(){
		var tmp = currentPath.split("/");
		tmp.pop();
		currentPath = tmp.join('/');
		UpdateFileList(currentPath);
	}
	
	
	//Buttons interface handlers
	function openClicked(){
		if (lastClicked != -1){
			if (lastClicked < dirs.length){
				//The user click to open a folder
				currentPath = globalFilePath[lastClicked];
				if (currentPath.includes(startingPath)){
					UpdateFileList(currentPath);
				}
			}else{
				//The user click to open a file
				var realPath = globalFilePath[lastClicked];
				var file = globalFilePath[lastClicked].replace("../../","");
				if (file.includes("../../../../../")){
					file = file.replace("../../../../../","../SystemAOB/functions/extDiskAccess.php?file=/");
				}
				var filename = $('#' + lastClicked).html().split('</i>').pop().replace("</div>");
				var ext = GetFileExt(file);
				if (ext == "mp3"){
					//Open with Audio module
					LaunchUsingEmbbededFloatWindow('Audio',file,filename,'music','audioEmbedded',640,170,undefined,undefined,false);
				}else if (ext == "mp4"){
					//Open with Video Module
					LaunchUsingEmbbededFloatWindow('Video',file,filename,'video','videoEmbedded',720,480);
				}else if (ext == "php" || ext == "html"){
					window.open("../../" + file); 
				}else if (ext == "pdf"){
					//Opening pdf with browser build in pdf viewer
					//parent.newEmbededWindow(file,'PDF Viewer','file pdf outline','pdfViewerEmbedded');
					window.open("../../" + file); 
				}else if (ext == "png" || ext == "jpg" || ext == "gif" || ext == "jpeg"){
					//Opening png with browser build in image viewer
					//window.open("../../" + file); 
					//parent.newEmbededWindow(file.replace("../",""),filename,'file image outline','imgViewer');
					LaunchUsingEmbbededFloatWindow('Photo',file,filename,'file image outline','imgViewer',720,480);
				}else if (ext == "txt" || ext == "md"){
					LaunchUsingEmbbededFloatWindow('Document',file,filename,'file text outline','textView');
				}
			}
		}
	}
	
	function LaunchUsingEmbbededFloatWindow(moduleName, file, filename, iconTag, uid, ww=undefined, wh=undefined,posx=undefined,posy=undefined,resizable=true ){
		var url = moduleName + "/embedded.php?filepath=" + file + "&filename=" + filename;
		parent.newEmbededWindow(url,filename,iconTag,uid,ww,wh,posx,posy,resizable);
	}
	
	function downloadFile(){
		if (lastClicked != -1){
			if (lastClicked < dirs.length){
				//The user want to download a folder
				var file = globalFilePath[lastClicked];
				var filename = $('#' + lastClicked).html().split('</i>').pop().replace("</div>");
				ShowNotice("<i class='caution circle icon'></i>File zipping may take a while...");
				zipping += 1;
					$.get( "zipFolder.php?folder=" + file + "&foldername=" + filename, function(data) {
					  if (data.includes("ERROR") == false){
						  //The zipping suceed.
						  ShowNotice("<i class='checkmark icon'></i>The zip file is now ready.");
						  window.open("download.php?file_request=" + "export/" + data + "&filename=" + data); 
						  zipping -=1 ;
					  }else{
						  //The zipping failed.
						  ShowNotice("<i class='checkmark icon'></i>Folder zipping failed.");
						  zipping -=1 ;
					  }
					});
			}else{
				//The user want to download a file
				var file = globalFilePath[lastClicked];
				var filename = $('#' + lastClicked).html().split('</i>').pop().replace("</div>");
				var ext = GetFileExt(file);
				if (ext == "php" || ext == "js"){
					ShowNotice("<i class='caution sign icon'></i>ERROR! System script cannot be downloaded.");
				}else{
					window.open("download.php?file_request=" + file + "&filename=" + filename); 
				}
			}
		}
	}
	
	window.onbeforeunload = function(){
		if (zipping > 0){
			return 'Your zipping progress might not be finished. Are you sure you want to leave?';
		}else{
			
		}
	  
	};
	
	function copy(){
		if (lastClicked != -1){
			if (PermissionMode == 0){
				ShowNotice("<i class='paste icon'></i>Permission Denied.");
				return;
			}
			if (lastClicked < dirs.length){
				//This is a folder
				//ShowNotice("<i class='copy icon'></i>Folder copying is not supported.");
				//Folder copy is now supported with "copy_folder.php"
				var file = globalFilePath[lastClicked];
				clipboard = file;
				ShowNotice("<i class='paste icon'></i>Folder copied.");
				
			}else{
				//This is a file
				var file = globalFilePath[lastClicked];
				var ext = GetFileExt(file);
				if (ext == "php" || ext == "js"){
					ShowNotice("<i class='paste icon'></i>System script cannot be copied via this interface.");
				}else{
					clipboard = file;
					ShowNotice("<i class='paste icon'></i>File copied.");
				}
				
			}
		}else{
			//When the page just initiate
			ShowNotice("<i class='copy icon'></i>There is nothing to copy.");
		}
		
	}
	
	function paste(){
		if (PermissionMode == 0){
			return;
		}
		var finalPath = currentPath;
		if (clipboard == ""){
			ShowNotice("<i class='paste icon'></i>There is nothing to paste.");
		}else if (GetFileExt(GetFileNameFrompath(clipboard)).trim() == GetFileNameFrompath(clipboard)){
			//If the paste target is a folder instead
			var target = finalPath + "/" + GetFileNameFrompath(clipboard);
			$.get( "copy_folder.php?from=" + clipboard + "&target=" + target, function(data) {
				if (data.includes("DONE")){
					ShowNotice("<i class='paste icon'></i>Folder pasted. Refershing...");
					UpdateFileList(currentPath);
				}else{
					console.log(data);
					ShowNotice("<i class='paste icon'></i>Paste Error. Error Message: <br>" + data.replace("ERROR.",""));
				}
			});
			
		}else{
			var target = finalPath + "/" + GetFileNameFrompath(clipboard);
			$.get( "copy.php?from=" + clipboard + "&copyto=" + target, function(data) {
				if (data.includes("DONE")){
					ShowNotice("<i class='paste icon'></i>File pasted. Refershing...");
					UpdateFileList(currentPath);
				}else{
					console.log(data);
					ShowNotice("<i class='paste icon'></i>Paste Error. Error Message: <br>" + data.replace("ERROR.",""));
				}
			});
		}
	}
	
	function ConfirmDelete(){
		if (lastClicked != -1 && PermissionMode == 2){
			deleteConfirmInProgress = true;
			if (lastClicked < dirs.length){
				//It is a dir
				var file = globalFilePath[lastClicked].replace("../../../","");
				var filename = $('#' + lastClicked).html().split('</i>').pop().replace("</div>");
				$('#dname').html("Folder Name: " + filename);
				$('#drname').html("Storage Name: " + file.replace(currentPath.replace("../../../","") + "/",""));
				$('#dfpath').html("Full Path: " + file);
				deletePendingFile = globalFilePath[lastClicked];
				$('#delConfirm').fadeIn('fast');
			}else{
				//It is a file
				var file = globalFilePath[lastClicked].replace("../../../","");
				var filename = $('#' + lastClicked).html().split('</i>').pop().replace("</div>");
				var ext = GetFileExt(file);
				$('#dname').html("File Name: " + filename);
				$('#drname').html("Storage Name: " + file.replace(currentPath.replace("../../../","") + "/",""));
				$('#dfpath').html("Full Path: " + file);
				deletePendingFile = globalFilePath[lastClicked];
				$('#delConfirm').fadeIn('fast');
			}
		}
	}
	
	function deleteFile(){
		if (PermissionMode < 2){
			return;
		}
		deleteConfirmInProgress = false;
		$('#delConfirm').fadeOut('fast');
		if (deletePendingFile != ""){
			//Delete the path
			$.get( "delete.php?filename=" + deletePendingFile, function(data) {
				if (data.includes("ERROR") == false){
					ShowNotice("<i class='checkmark icon'></i> File removed.");
					UpdateFileList(currentPath);
				}else{
					ShowNotice("<i class='remove icon'></i> Something went wrong. Error Message: <br>" + data.replace("ERROR.",""));
				}
			});
		}
	}
	
	function GetFileNameFrompath(path){
		var basename = path.replace(/\\/g,'/').replace(/.*\//, '');
		return basename;
	}
	function ShowNotice(text){
		$('#noticeCell').stop();
		$('#noticeContent').html(text);
		$('#noticeCell').fadeIn("slow").delay(3000).fadeOut("slow");
	}
	
	function openFolder(id){
		currentPath = globalFilePath[id];
		if (currentPath.includes(startingPath)){
			UpdateFileList(currentPath);
		}
	}
	</script>
</body>
</html>