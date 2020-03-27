<?php
include_once '../../../auth.php';
$allowGlobalClipboard = false;
$allowRemoveSystemAOBScript = false;
if (file_exists("../personalization/sysconf/fsaccess.config")){
	$fsconfig = json_decode(file_get_contents("../personalization/sysconf/fsaccess.config"),true);
	$allowGlobalClipboard = $fsconfig["allowGlobalClipboard"];
	$allowRemoveSystemAOBScript = !$fsconfig["enablesysscriptCheckBeforeDelete"];
}
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<link rel="manifest" href="manifest.json">
<html style="min-height:300px;">
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
    <title>ArOZ File Explorer</title>
    <style type="text/css">
        body {
            padding-top: 2em;
            background-color: rgb(250, 250, 250);
            overflow-y: scroll;
        }
		
		.UMfilename.active{
			background-color: #bcd2e0 !important;
		}
		
		.UMfoldername.active{
			background-color: #b1dbb7 !important;
		}
		
		.item{
			border: 1px solid transparent;
		}
		
		.openwith{
			padding-top: 5px;
			padding-bottom: 6px !important;
			padding-left: 8px;
			padding-right: 8px;
			border-bottom: 1px solid #b2b2b2;
		}
		
		.openwith:hover{
			background-color: #e8e8e8;
		}
		
		.selected{
			background-color: #c9ddff;
		}
		
		.selectionTipsBorder{
			border: 1px solid #4286f4 !important;
		}
		
		#rightClickMenu{
			position:fixed;
			z-index:999;
			left:0px;
			top:0px;
		}
		
		.selectable{
			border: 1px solid transparent !important;
			font-size:120% !important;
		}
		
		.selectable:hover{
			border: 1px solid #5c9dff !important;
			background-color:#cfe2ff;
		}
		#filePropertiesWrapper{
			position:fixed;
			top:5%;
			left:25%;
			right:25%;
		}
		.ts.icon.mini.button{
		    margin:1px !important;
		    padding-top: 6px !important;
		    padding-bottom: 6px !important;
		    border-radius: 2px !important;
		}
		.shortcuts{
		    border:1px solid transparent;
		    padding: 3px !important;
		    padding-left:10px !important;
		    cursor: pointer;
		}
		.shortcuts:hover{
		    border: 1px solid #8c9bff;
		}
		.newfileType{
			cursor: pointer;
			margin:0px !important;
			margin-bottom:3px !important;
			
		}
		.newfileType:hover{
			background-color:#fafafa;
		}
		.oprmenu{
			margin-right:3px !important;
			margin-bottom:3px !important;
			font-size:80% !important;			
		}
		.description{
			word-break: break-word !important;
		}
		.forceHeight{
			height:145px !important;
			width:100% !important;
			object-fit: cover;
		}
		.midblue{
			background-color:#2358c2 !important;
		}
    </style>
</head>
<body>
	<?php
	$mode = "folder";
	$permissionLevel = 0;
	$dir = "";
	$moduleName = "";
	$returnPath = "";
	$embedded = false;
	$filename = "unknown";
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
		if ($mode == "file"){
			if (mv("filename") != null){
				$filename = mv("filename");
			}else{
				die("ERROR. File Mode require 'filename' variable.");
			}
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
		$requireDir = mv("dir");
		if (file_exists($edir) == false){
			//This might be a realpath filepath. Check if it is real or not.
			list($scriptPath) = get_included_files();
			$relativePath = getRelativePath(realpath($scriptPath),mv("dir"));
			if (file_exists(mv("dir")) == false){
			    //This might lead by filename too long problem in relative path. Check with custom file exists algorithm
			    if (file_exists(dirname($edir))){
			        //The parent directory did exists.
			        //Check if this was cause by filename too long on Windows Host Problem (Windows only problem :( )
			       $files = glob(dirname($edir). "/*");
			       $filename = basename($edir);
			       $tmp = explode(".",$edir);
			       $ext = array_pop($tmp);
			       $filematch = [];
			       $rpath = realpath(dirname($edir));
			       if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
			            $result = shell_exec('dir /A-D /D /B "' . $rpath . '\*' . $ext . '"');
			             $filematch = explode("\n",$result);
			       }else{
			           die("ERROR. dir '$relativePath' not exists."); 
			       }
			       for($i=0;$i<count($filematch);$i++){ $filematch[$i] = trim($filematch[$i]); }
			       if (in_array($filename,$filematch) == false){
			          die("ERROR. dir '$relativePath' not exists."); 
			       }else{
                        $textLength = strlen($filename);
                        $maxChars = 35;
                        $filename = substr_replace($filename, '...', $maxChars/2, $textLength-$maxChars);
			           echo('
            			<script>
            			    if (!(!parent.isFunctionBar)){
            			        //Prevent this window from freezing here, ask functional bar to close this windows if under VDI mode
            			        parent.msgbox("Filepath too long for your Host Operating System. Try to give it a shorter name. Filename (' .$textLength . ' chars): ' . str_replace("../","",$filename) . '","<i class=\'caution icon\'></i> Filename Too Long",undefined,false);
            			        parent.closeWindow($(window.frameElement).parent().attr("id"));
            			    }
            			</script>
            			');
            			die("ERROR. Filename too long for your Host Operating System.");
			       }
			    }
				
			}
			$dir = $relativePath;
		}else{
			$dir = $edir;
		}
		
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
		if ($mode != "file" && substr(str_replace("../","",$dir),0,13) == "media/storage"){
			//Allow access to folder directory if it is under the allowed exteral storage path
			//echo substr(str_replace("../","",$dir),0,13);
			//die("ERROR. You don't have permission to access that folder.");
		}else if ($mode == "file" && substr(str_replace("//","",str_replace("../","",$dir)),0,6) == "media/"){
			//Only allow access to files under /media/storage1 , /media/storage2 or other self mounted drives
		}else{
			echo('
			<script>
			    if (!(!parent.isFunctionBar)){
			        //Prevent this window from freezing here, ask functional bar to close this windows if under VDI mode
			        parent.msgbox("You do not have permission to access that file. Filepath: ' . str_replace("../","",$dir) . '","<i class=\'privacy icon\'></i> Permission Denied",undefined,false);
			        parent.closeWindow($(window.frameElement).parent().attr("id"));
			    }
			</script>
			');
			die("ERROR. You don't have permission to access that file.");
		}
		
	}
	
	//6. (Optional) Finishing Path, when operation finish, return to this path. Use "embedded" if require no return path
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
	
	//7. Not allow exit or redirect, when using as integrated / full embedded mode, this can be helpful
	if (mv("integrated") != null){
		$embedded = mv("integrated");
		if ($embedded == "true"){
			$embedded = true;
		}else if ($embedded == "false"){
			$embedded = false;
		}else{
			$embedded = false;
		}
	}else{
		$embedded = false;
	}
	
	//8. Start with a subdirectory that allow "open file location" functions in desktop mode
	if (mv("subdir") != null){
		$subdir = mv("subdir");
	}else{
		$subdir = "";
	}
	
	?>
    <div class="ts container">
        <!-- Menu -->
        <div class="ts breadcrumb">
            <div id="returnSC" class="section" localtext="filesystem/topbar/fileviewer">ArOZβ Files Viewer</div>
            <div class="divider">/</div>
            <a id="moduleName" href="" class="section"><?php
			if ($moduleName == ""){
				echo 'Unknown Module (READ ONLY)';
			}elseif ($moduleName == "."){
				echo $_SESSION['login'] . " <i class='cloud icon'></i>" . trim(gethostname()) . " (Mode: $permissionLevel)";
			}else{
				echo $_SESSION['login'] . " <i class='cloud icon'></i>" . $moduleName . "(Mode: $permissionLevel)";
			}
			?></a>
            <div class="divider">/</div>
            <div class="active section">
                <i class="folder icon"></i><p id="currentFolderPath" style="display:inline;word-break: break-all;"><?php 
				if ($dir == "."){
					if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
						echo trim(realPath("../../../") . "\\");
					}else{
						echo trim(realPath("../../../") . "/");
					}
				}else{
					if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
						echo trim(realpath($dir) . '\\');
					}else{
						//Not windows. There will be a lot of ../ if accessing external storage
						//This code is used to remove those dots if external storage
						if (strpos($dir,"../../../../") !== false){
							//It is outside of the web root
							echo trim(str_replace("../../../../","",realpath($dir)) . '/');
						}else{
							//It is inside the web root
							echo trim(realpath($dir) . '/');
						}
					}
				}
				
				?></p>
            </div>
        </div>

        <br><br>

        <div class="ts grid">
            <div id="fileViewPanel" class="eleven wide column" <?php
			if ($embedded){
				echo 'style="width:100%;"';
			}
			?>>
				<div id="sortedFolderList" class="ts selection segmented list">
				<div id="controls" class="item">
					<?php
					if ($permissionLevel >= 0){
						echo '<button id="backBtn" class="ts icon disabled button oprmenu" onClick="backClicked();" style="display:;" title="Parent Directory">
								<i class="arrow up icon"></i>
									
							  </button>
							  <button id="openBtn" class="ts icon disabled button oprmenu initHidden" onClick="openClicked();" title="Open Selected">
								<i class="folder open outline icon"></i>
								
							  </button>
							  <button id="openwith" class="ts icon disabled button oprmenu initHidden" onClick="openWith();" title="Open With">
								<i class="external icon"></i>
									
							  </button>
							  <button id="downloadbtn" class="ts disabled labeled icon button oprmenu initHidden" onClick="downloadFile();" style="width:146px;" title="Download">
								<i class="download icon"></i>
									<span localtext="filesystem/operations/download">Download</span>
							  </button>';
					}
					if($permissionLevel >= 1){
						echo '<button id="copybtn" onClick="copy();" class="ts icon disabled button oprmenu initHidden" title="Copy">
							<i class="copy icon"></i>
								
							</button>
							<button id="move" onClick="paste();" class="ts icon button oprmenu" title="Paste">
							<i class="paste icon"></i>
							
							</button>
							<button class="ts icon button oprmenu" onClick="newFile();" title="New File">
								<i class="file outline icon"></i>
									
							 </button>
							<button id="newfolder" class="ts icon button oprmenu" onClick="newFolder();" title="New Folder">
								<i class="folder outline icon"></i>
								
							</button>
							<button id="upload" class="ts icon button oprmenu" onClick="prepareUpload();" title="Upload Files">
								<i class="upload icon"></i>
								
							</button>
							';
					}
					if($permissionLevel >= 2){
						echo '
						<button class="ts icon disabled button oprmenu initHidden" onClick="cut();" title="Cut">
							<i class="cut icon"></i>
							
						</button>
						<button id="renamebtn" class="ts icon disabled button oprmenu initHidden" onClick="rename();" title="Rename">
							<i class="text cursor icon"></i>
							
						</button>
						<button id="nameConvert" class="ts icon disabled button oprmenu initHidden" onClick="convertFileName();" title="Filename Convert">
							<i class="exchange outline icon"></i>
							
						</button>
						<button id="delete" class="ts icon disabled negative button oprmenu initHidden" onClick="ConfirmDelete();" title="Delete">
							<i class="trash outline icon"></i>
							
						</button>';
					}
					?>
					<button id="showProperties" class="ts disabled icon button oprmenu initHidden" onClick="showProperties();" title="Properties">
							<i class="bookmark icon"></i>
							
						</button>
					<button id="refresh" class="ts icon button oprmenu" onClick="UpdateFileList(currentPath);" title="Refresh">
						<i class="refresh icon"></i>
						
					</button>
					<button id="showHelpBtn" class="ts icon button oprmenu" onClick="showHelp();" title="Show Help">
							<i class="help icon"></i>
							
						</button>
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

            <div id="sideControlPanel" class="five wide column" style="position:fixed;right:5px;">
                <div class="ts card">
                    <div class="secondary very padded extra content">
                        <div id="fileicon" class="ts icon header">
                            <i class="file outline icon"></i>
                        </div>
                    </div>

                    <div class="extra content">
                        <div id="filename" class="header" style="display:inline-block !important;overflow-wrap: break-word; word-break: break-all;" localtext="filesystem/sidebar/noSelectedFile">No selected file</div>
                    </div>

                    <div class="extra content">
                        <div class="ts list">
                            <div class="item">
                                <i class="folder outline icon"></i>
                                <div class="content">
                                    <div class="header" localtext="filesystem/sidebar/fullpath">Full Path</div>
									<div class="ts mini fluid borderless input" style="padding-top:5px;">
										<input id="thisFilePath" type="text" placeholder="N/A" readonly="true">
									</div>
                                    <!-- <div id="thisFilePath" class="description">N/A</div> -->
                                </div>
                            </div>
                            <div class="item">
                                <i class="favorite icon"></i>
                                <div class="content">
                                    <div class="header" localtext="filesystem/sidebar/shortcut">Shortcuts</div>
                                    <div id="shortcutList" class="description"></div>
								</div>
							</div>
							<!-- On-going file operation list-->
							<div id="ongoingTaskMenu" class="item">
								<i class="align justify icon"></i>
								<div class="content">
									<div class="header" localtext="filesystem/sidebar/ongoingtask">Ongoing Tasks</div>
									<div id="ongoingTasklist" class="ts list"></div>
								</div>
							</div>
                        </div>
						<?php if (strtoupper(substr(PHP_OS, 0, 3)) !== 'WIN') {
							//This section of the script only runs on Linux, debian Jessie to be more accurate
							echo '<div id="scl" class="ts horizontal divider">Shortcuts</div>';
							echo '<select id="shortCutMenu" class="ts basic fluid dropdown">';
							echo '<option onClick="ChangeCurrentDirectory($(this).text());">Internal Storage</option>';
							//Since the 17-7-2018 version, unlimited storage directory is supported
							$storages = glob("/media/*");
							foreach ($storages as $storage){
								echo '<option onClick="ChangeCurrentDirectory($(this).text());">' . basename($storage) . "</option>";
							}
							echo '</select>';
						}
						?>
						<br><br>
						<a id="doneBtn" href="<?php echo $returnPath;?>" class="ts basic primary fluid button hideEM" localtext="filesystem/sidebar/done">Done</a>
                    </div>
                </div>
                <div id="utilBottomList" class="ts horizontal right floated middoted link list">
                    <a class="item" onClick="UpdateFileList(currentPath);" localtext="filesystem/sidebar/refresh">Refresh</a>
                    <a href="<?php echo $returnPath;?>" class="item hideEM hideFW" localtext="filesystem/sidebar/cancel">Cancel</a>
                    <a href="" class="item" localtext="filesystem/sidebar/fileviewer">ArOZβ File Explorer</a>
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
	<dialog id="delConfirm" class="ts fullscreen modal" style="position:fixed;top:10%;left:30%;width:40%;max-height:70%;z-index:99;">
		<h5 class="ts fluid header" style="color:#ff778e;">
			<div class="content" style="color:#ff778e;">
				<i class="trash icon"></i><span localtext="filesystem/delete/confirm">Delete Confirm</span>
				<div class="sub header" style="color:#ff778e;" localtext="filesystem/delete/reminder">This file will be removed. This action CANNOT BE UNDONE.</div>
			</div>
		</h5>
		<div class="content" style="width:100%;height:200px;overflow-y:scroll;overflow-wrap: break-word;">
			<p id="dname">Loading...</p>
			<p id="drname" >Loading...</p>
			<p id="dfpath">Loading...</p>
		</div>
		<div class="actions">
			<button class="ts deny basic button" onClick="$('#delConfirm').fadeOut('fast');deleteConfirmInProgress = false;" localtext="filesystem/delete/cancel">
				Cancel
			</button>
			<button class="ts negative basic button" onClick="deleteFile();" localtext="filesystem/delete/yes">
				Confirm
			</button>
		</div>
	</dialog>
	
	<!-- New Folder Option -->
	<div id="newFolderWindow" class="ts primary raised segment" style="position:fixed; top:10%;left:30%; right:30%;display:none;z-index:99;">
		<h5 class="ts header">
			<i class="folder outline icon"></i>
			<div class="content">
				<span localtext="filesystem/newfolder/newfolder">New Folder</span>
				<div class="sub header"><span localtext="filesystem/newfolder/tips">Filename must only contain Alphabets, Numbers and Space.</span><br><span localtext="filesystem/newfolder/tips2"> Please tick the "Encoded Foldername" option for other special characters.</span></div>
			</div>
		</h5>
		<div class="ts container">
			<div class="ts checkbox">
				<input type="checkbox" id="efcb">
				<label for="efcb" localtext="filesystem/newfolder/efcb">Encoded Foldername (Foldername will be stored in hex format for system encoding compatibility)</label>
			</div><br><br>
			<div class="ts fluid input">
				<input id="newfoldername" type="text" placeholder="New Folder Name">
			</div><br><br>
			<button class="ts right floated positive basic button" onClick="CreateNewFolder();" localtext="filesystem/newfolder/confirm">Confirm</button>
			<button class="ts right floated negative basic button" onClick="$('#newFolderWindow').fadeOut('fast');enableHotKeys=true;" localtext="filesystem/newfolder/cancel">Cancel</button>
		</div>
	</div>
	
	<!-- Rename File Option -->
	<div id="renameFileWindow" class="ts primary raised segment" style="position:fixed; top:10%;left:20%; right:20%;display:none;z-index:99;">
		<h5 class="ts header">
			<i class="file outline icon" id="renameIcon"></i>
			<div class="content" id="renameTitle">
				<span localtext="filesystem/rename/rename">Rename File</span>
				<div class="sub header"><span localtext="filesystem/rename/tips">Filename must only contain Alphabets, Numbers and Space.</span><br><span localtext="filesystem/rename/tips2"> Please tick the "Encoded Filename" option for other special characters.</span></div>
			</div>
		</h5>
		<div class="ts container">
			<div class="ts checkbox">
				<input type="checkbox" id="efcbr">
				<label for="efcbr" localtext="filesystem/rename/efcbr">Encoded Filename (Filename will be stored in hex format for system encoding compatibility)</label>
			</div><br>
			<label><code localtext="filesystem/rename/label">Encoding change of unsupported filename may results in System Error.</code></label>
			<br><br>
			<label localtext="filesystem/rename/orgname">Original Filename</label>
			<div class="ts fluid input">
				
				<input id="oldRenameFileName" type="text" placeholder="Original Filename" readonly>
			</div><br><br>
			<label localtext="filesystem/rename/newname">New Filename</label>
			<div class="ts fluid input">
				<input id="renameFileName" type="text" placeholder="New File / Folder Name">
			</div><br><br>
			<button class="ts right floated positive basic button" onClick="confirmRename();" localtext="filesystem/rename/confirm">Confirm</button>
			<button class="ts right floated negative basic button" onClick="$('#renameFileWindow').fadeOut('fast');enableHotKeys=true;" localtext="filesystem/rename/cancel">Cancel</button>
		</div>
	</div>
	
	<!-- Show help interface-->
	<div id="helpInterface" class="ts info raised segment" style="position:fixed; top:10%;left:20%; right:20%;display:none;z-index:99;bottom:10%;">
		<div class="ts container" style="height:100%;">
			<div class="ts header">
				<span localtext="filesystem/help/helpmanual">File Operation Icons</span>
				<div class="sub header" localtext="filesystem/help/tips">List of icons on the menu bar and their meanings.</div>
			</div>
			<div style="width:100%;overflow-y:auto;height:70%;">
				<div class="ts list">
					<div class="item">
						<i class="arrow up icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/back">Back</div>
							<div class="description" localtext="filesystem/help/backdesc">Go one directory upward from the current folder tree.</div>
						</div>
					</div>
					<div class="item">
						<i class="folder open outline icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/open">Open</div>
							<div class="description" localtext="filesystem/help/opendesc">Open the selected file with the default WebApp module.</div>
						</div>
					</div>
					<div class="item">
						<i class="external icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/openwith">Open With</div>
							<div class="description" localtext="filesystem/help/openwithdesc">Open the selected file with the selected WebApp module.</div>
						</div>
					</div>
					<div class="item">
						<i class="download icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/download">Download / Zip and Down</div>
							<div class="description" localtext="filesystem/help/downloaddesc">Download the selected file(s) or Zip and Download the selected folder.</div>
						</div>
					</div>
					<div class="ts divider"></div>
					<div class="item">
						<i class="copy icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/copy">Copy</div>
							<div class="description" localtext="filesystem/help/copydesc">Copy the selected file into file explorer's memory.</div>
						</div>
					</div>
					<div class="item">
						<i class="paste icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/paste">Paste</div>
							<div class="description" localtext="filesystem/help/pastedesc">Paste the copied file into current directory.</div>
						</div>
					</div>
					<div class="item">
						<i class="file outline icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/newfile">New File</div>
							<div class="description" localtext="filesystem/help/newfilesesc">Create a new file with given filename.</div>
						</div>
					</div>
					<div class="item">
						<i class="folder outline icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/newfolder">New Folder</div>
							<div class="description" localtext="filesystem/help/newfolderdesc">Create a new folder in the current directory.</div>
						</div>
					</div>
					<div class="item">
						<i class="upload icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/upload">Upload</div>
							<div class="description" localtext="filesystem/help/uploaddesc">Upload file(s) to the current directory.</div>
						</div>
					</div>
					<div class="ts divider"></div>
					<div class="item">
						<i class="cut icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/cut">Cut</div>
							<div class="description" localtext="filesystem/help/cutdesc">Cut the selected file to be pasted on a new location.</div>
						</div>
					</div>
					<div class="item">
						<i class="text cursor icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/rename">Rename</div>
							<div class="description" localtext="filesystem/help/renamedesc">Rename the selected file.</div>
						</div>
					</div>
					<div class="item">
						<i class="exchange outline icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/filenameconv">Filename Convert</div>
							<div class="description" localtext="filesystem/help/filenameconvdesc">Convert the selected file(s) / folder's name into umfilename used by ArOZ Online System. It is recommended that filenames with non-alphanumeric characters should be converted. Converted filename / foldername will be shown as blue / green background respectivly.</div>
						</div>
					</div>
					<div class="item">
						<i class="trash outline icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/remove">Remove</div>
							<div class="description" localtext="filesystem/help/removedesc">Remove the selected file(s).</div>
						</div>
					</div>
					<div class="ts divider"></div>
					<div class="item">
						<i class="bookmark icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/properties">Properties</div>
							<div class="description" localtext="filesystem/help/propertiesdesc">Show properties of the selected file / folder.</div>
						</div>
					</div>
					<div class="item">
						<i class="refresh icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/refresh">Refresh</div>
							<div class="description" localtext="filesystem/help/refreshdesc">Refresh the list of file in the current directory.</div>
						</div>
					</div>
					<div class="item">
						<i class="bookmark icon"></i>
						<div class="content">
							<div class="header" localtext="filesystem/help/help">Help</div>
							<div class="description" localtext="filesystem/help/helpdesc">Show this help message.</div>
						</div>
					</div>
				</div>
			</div>
			<br>
			<button class="ts right floated basic button" onClick="$('#helpInterface').fadeOut('fast');enableHotKeys=true;" localtext="filesystem/help/close">Close</button>
		</div>
		
	</div>
	
	<!-- Upload New Files Window-->
	<div id="uploadFileWindow" class="ts primary raised segment" style="position:fixed; top:10%;left:20%; right:20%;display:none;z-index:99;">
		<h5 class="ts header">
			<i class="upload icon"></i>
			<div class="content">
				<span localtext="filesystem/upload/upload">Upload Files</span>
				<div class="sub header" localtext="filesystem/upload/tips">All uploaded files will be in hex encoded format following the Upload Manager FIle Naming (UMFN) format.</div>
			</div>
		</h5>
		<div class="ts container">
			<p id="msg"></p>
			<div class="ts form">
			<div class="field">
			<label localtext="filesystem/upload/target">Uplaod Target</label>
				<input type="text" id="uploadTarget" class="ts fluid input" name="utarget" value="" readonly>
			</div>
			<div class="field">
			<label localtext="filesystem/upload/files">Selected Files</label>
			<input type="file" id="multiFiles" name="files[]" multiple="multiple"/>
			</div>
			<div class="ts mini buttons">
				<button class="ts basic negative button" onClick="closeUploadWindow();$('#uploadFileWindow').fadeOut('fast');" localtext="filesystem/upload/cancel">Cancel</button>
				<button class="ts basic button" onClick="previewUplaodFileList();" localtext="filesystem/upload/preview">Preview File List</button>
				<button class="ts basic positive button" id="uploadFilesBtn" localtext="filesystem/upload/uploadconfirm">Upload</button>
			</div>
			</div>
			<div id="ulFileList" class="ts segment" style="display:none;">
			<h5 localtext="filesystem/upload/pending">Upload Pending File List</h5>
			<div id="ulFileListItems" class="ts ordered list">
			</div>
			</div>
		</div>
	</div>
	
	<!-- Open With module selection menu-->
	<div id="openWithWindow" class="ts raised segment" style="position:fixed; top:10%; left:30%;right:30%;z-index:99;bottom:10%;display:none;">
		
		<div class="ts header">
			<span localtext="filesystem/openwith/openwith">Open File With</span>
			<div class="sub header" localtext="filesystem/openwith/tips">Please select a module from the list below</div>
		</div>
		<div id="openWithModuleList" class="ts list" style="max-height:50%;overflow-y: auto;overflow-x: hidden;">
			<div class="item">
				<img class="ts avatar image" src="../../../img/loading_icon.jpg">
				<div class="content">
					<div class="header" localtext="filesystem/openwith/init">Initializing Module Information</div>
					<div class="description">
						<div class="ts horizontal mini label"><i class="spinner loading icon"></i>List requesting in progress</div>
					</div>
				</div>
			</div>
		</div>
		<div class="ts divider"></div>
		<div><span localtext="filesystem/openwith/openGuide">Open the selected File in selected Module with the following modes:</span><Br>
				<button class="ts mini basic labeled icon button openWithFloatWindow" onClick="confirmOpenWith(1);" ><i class="clone icon"></i><span localtext="filesystem/openwith/floatWindow">FloatWindow</span></button>
				<button class="ts mini basic labeled icon button" onClick="confirmOpenWith(2);"><i class="undo icon"></i><span localtext="filesystem/openwith/redirect">Redirect</span></button>
				<button class="ts mini basic labeled icon button" onClick="confirmOpenWith(0);"><i class="external icon"></i><span localtext="filesystem/openwith/newWindow">New Window</span></button>
		</div>
		<button class="ts close button" style="position:absolute;right:8px;top:8px;" onClick="$('#openWithWindow').fadeOut('fast');"></button>
	</div>
	
	<!-- New File creation menu -->
	<div id="newFileWindow" class="ts raised segment" style="position:fixed; top:10%; left:30%;right:30%;z-index:99;bottom:10%;display:none;">
		<div class="ts header">
			<span localtext="filesystem/newfile/newfile">New File</span>
			<div class="sub header" localtext="filesystem/newfile/tips">Please select a type of file to be created.</div>
		</div>
		<button class="ts close button" style="position:absolute;right:8px;top:8px;" onClick="$('#newFileWindow').fadeOut('fast');enableHotKeys = true;"></button>
		<div id="newFileList" class="ts list" style="max-height:50%;overflow-y: auto;overflow-x: hidden;">
			<div class="ts segment newfileType">
					<i class="spinner loading icon"></i> <span localtext="filesystem/newfile/loading">Loading File Creation Index</span>
			</div>
		</div>
		<p localtext="filesystem/newfile/manual">Or create an empty file with given filename.</p>
		<div class="ts action fluid input">
			<input id="newfilenameInput" type="text" placeholder="New Filename">
			<button  class="ts button" onClick="createNewFileViaInput();" localtext="filesystem/newfile/create">Create</button>
		</div>
	</div>
	<!-- Context Menu for file / folder operations-->
		<div id="rightClickMenu" class="ts contextmenu" style="min-width:260px;font-size:80%">
			<div class="selectable item" onClick="openClicked();">
				<i class="folder open icon"></i> <span localtext="filesystem/rightClickMenu/open">Open</span>
			</div>
			<div id="openWithMenuItem" class="selectable item single" onClick="openWith();">
				<i class="external icon"></i> <span localtext="filesystem/rightClickMenu/openwith">Open With</span>
			</div>
			<div class="selectable item pm1" onClick="copy();">
				<i class="copy icon"></i> <span localtext="filesystem/rightClickMenu/copy">Copy</span>
				<span class="description">Ctrl + C</span>
			</div>
			<div class="selectable item pm1" onClick="paste();">
				<i class="paste icon"></i> <span localtext="filesystem/rightClickMenu/paste">Paste</span>
				<span class="description">Ctrl + V</span>
			</div>
			<div class="selectable item pm2" onClick="cut();">
				<i class="cut icon"></i> <span localtext="filesystem/rightClickMenu/cut">Cut</span>
				<span class="description">Ctrl + X</span>
			</div>
			<div class="selectable item" onClick="newFile();">
				<i class="file outline icon"></i> <span localtext="filesystem/rightClickMenu/newfile">New File</span>
			</div>
			<div class="selectable item pm1" onClick="newFolder();">
				<i class="folder icon"></i> <span localtext="filesystem/rightClickMenu/newfolder">New Folder</span>
			</div>
			<div class="selectable item pm1 single" onClick="prepareUpload();">
				<i class="upload icon"></i> <span localtext="filesystem/rightClickMenu/upload">Upload</span>
			</div>
			<div class="selectable item pm2 single" onClick="rename();">
				<i class="text cursor icon"></i> <span localtext="filesystem/rightClickMenu/rename">Rename</span>
			</div>
			<div class="selectable item pm2" onClick="convertFileName();">
				<i class="exchange outline icon"></i> <span localtext="filesystem/rightClickMenu/filenameconv">Filename Convert</span>
			</div>
			<div class="selectable item pm2" onClick="ConfirmDelete();">
				<i class="trash outline icon"></i> <span localtext="filesystem/rightClickMenu/delete">Delete</span>
			</div>
			<div class="divider"></div>
			<div class="selectable item" onClick="downloadFile();">
				<i class="download icon"></i> <span localtext="filesystem/rightClickMenu/download">Download</span>
			</div>
			<div class="selectable item single" onClick="showProperties();">
				<i class="bookmark icon"></i> <span localtext="filesystem/rightClickMenu/properties">Properties</span>
			</div>
		</div>
	<div id="filePropertiesWrapper" style="display:none;z-index:999;">
		<div id="fileProperties" style="width:100%; height:100%;"></div>
		<button class="ts top right corner big close button" onClick="hideProperties();"></button>
	</div>
	<div id="backpanelCover" style="position:fixed;top:0px;left:0px;width:100%;height:100%;z-index:900;background:rgba(38,38,38,0.6);display:none;"></div>
	<div id="pwaAssistantUI" style="position:fixed;bottom:10px;right:10px;display:none;">
		<button class="ts inverted circular icon button" style="font-size:170%;" onClick="toggleSideControlPanel();">
			<i class="huge notice icon"></i>
		</button>
	</div>
	<div class="backgroundPlate" style="position:fixed;left:0px;top:0px;width:100%;height:100%;z-index:-1;"></div>
	<br><br><br><br><br>
	<div style="display:none;">
	<!-- Migrating the direct echo from php to passing through the DOM events-->
	<div id="permissionMode"><?php echo $permissionLevel;?></div>
	<div id="startingPath"><?php echo $dir;?></div>
	<div id="defaultWebRoot"><?php echo $_SERVER['DOCUMENT_ROOT'];?></div>
	<div id="targetedReturnPath"><?php echo $returnPath;?></div>
	<div id="embeddModeSetting"><?php echo $embedded ? 'true' : 'false';?></div>
	<div id="modeSetting"><?php echo $mode;?></div>
	<div id="targetOpenFilename"><?php echo $filename;?></div>
	<div id="aor"><?php echo realpath("../../../");?></div>
	<div id="targetSubdir"><?php echo str_replace("//","/",$subdir);?></div>
	<div id="EnablePWAMode"><?php if(isset($_GET['pwa']) && strtolower($_GET['pwa']) == "enabled"){echo "true";}else{echo "false";}?></div>
	<div id="EnableGlobalClipboard"><?php echo $allowGlobalClipboard ? 'true' : 'false'; ?></div>
    	<script id="arrayMatcher" type="javascript/worker">
          //Array matching algorithms, run as worker to prevent main page freezing
          self.onmessage = function(e) {
              var data = JSON.parse(e.data);
              var arr1 = data[0];
              var arr2 = data[1];
              self.postMessage(arraysEqual(arr1,arr2));
          };
          
          function arraysEqual(a, b) {
              if (a === b) return true;
              if (a == null || b == null) return false;
              if (a.length != b.length) return false;
              for (var i = 0; i < a.length; ++i) {
                if (a[i] !== b[i]) return false;
              }
              return true;
            }
        </script>
	</div>
	<script>
	/**
	ArOZ Online File Management System Alpha
	Written by Toby Chui under ArOZ Online Project
	This file management system is like Windows Explorer, user can do whatever they want.
	Use with care if your module is using this explorer and remind user of the risk of system damage.
	This filesystem script is directly implemented on top of the host file system (NOT DATABASE EMULATED FILE SYSTEM)
	**/
	var controlsTemplate = "";
	var PermissionMode = parseInt($("#permissionMode").text());
	var startingPath = $("#startingPath").text().trim();
	var webRoot = $("#defaultWebRoot").text().trim();
	var aor = $("#aor").text().trim();
	var currentPath = startingPath;
	var homedir = startingPath;
	var lastClicked = -1;
	var globalFilePath = [];
	var dirs = [];
	var files = [];
	var zipping = 0; //Check the number if zipping in progress
	var uploading = 0;//Check if it is uploading.
	var clipboard = ""; //Use for copy and paste
	var ctrlDown = false; //Use for Ctrl C and Ctrl V in copy and paste of files
	var shiftDown = false; //Use for Shift in multi files selection
	var deletePendingFile = "";//Delete Pending file, delete while delete confirm is true
	var deleteConfirmInProgress = false; // Record if delete confirm is in progress, then bind to suitable key press
	var hexFolderName = false; //New folder naming method 
	var newFolderPath = currentPath;//The directory where the new folder will be created
	var isFunctionBar = !(!parent.isFunctionBar); //Check if currently in embedded mode
	var finishingPath = $("#targetedReturnPath").text().trim();
	var enableHotKeys = true;
	var multiSelectMode = false; //Check if multi-selecting
	var cutting = false;//Ctrl-X, Not much to explains :)
	var ExternalStorage = false; //Use extDiskAccess.php for accessing the resources
	var renamingFolderID = -1; //Hold the renaming folder id when under renaming operation
	var prepareUplaodPath = ""; //Hold the temperary folder path for upload when the user press on the upload button
	var embeddedMode = $("#embeddModeSetting").text().trim() == "true";
	var viewMode = $("#modeSetting").text().trim();
	var filename = $("#targetOpenFilename").text().trim();
	var startingSubDir = $("#targetSubdir").text().trim();
	var lastActUnixtime = getutime();
	var openPendingFile = [];
	var openPendingModule = [];
	var isMobile = false; //initiate as false
	var pwa = $("#EnablePWAMode").text().trim() == "true";
	var webworker = false; //Check if webworker is supported in the current browser
	var arrayMatchWorker =  SCRIPT2WORKER("arrayMatcher"); //Webworker for matching two huge array in the background
	var previousScrollTopPosition = 0;
	var previousSelectedItemNames = []; //Previous selected items for filelist refresh
	var usePHPForFileOperations = false; //Use traditional way for copy or move file. Set this to false for faster implementation with golang
	var enableGlobalClipboard = $("#EnableGlobalClipboard").text().trim() == "true";
	if (isFunctionBar){ var windowID = $(window.frameElement).parent().attr("id"); }
	var fileOprListenerInterval = 2000; //Time interval between each file opr progress update
	
	
	// device detection
	if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|ipad|iris|kindle|Android|Silk|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(navigator.userAgent) 
		|| /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(navigator.userAgent.substr(0,4))) { 
		isMobile = true;
	}
	
	//if the view mode if file only, even the whole page need not to be started.
	//That means this section of script is being processed in real time
	if (viewMode == "file"){
		//Opening a given file path
		if (isFunctionBar){
			OpenFileFromRealPath(startingPath,filename,true);
		}else{
			OpenFileFromRealPath(startingPath,filename);
		}
			
	}
	
	/*
	THIS FUNCTION IS NOT PART OF THE FILE EXPLORER DEFAULT FUNCTION
	SCRIPT2WORKER() function is a conversion function to convert any special scripted div to web worker blob data.
	Please do not call anything from this function via cross iframe operation!
	*/
	function SCRIPT2WORKER(divID){
	    var result = new Blob([
            document.querySelector('#' + divID).textContent
          ], { type: "text/javascript" });
	    return result;
	}
	
	//Translation Services. Load default translation from localStorage if availble
	initLocalizationTranslation();
	function initLocalizationTranslation(){
		var lang = localStorage.getItem("aosystem.localize");
		if (lang === undefined || lang === "" || lang === null){
			//Ignore translation
		}else{
			//Translate with given lang
			$.get("../../system/lang/" + lang + ".json",function(data){
				window.localization = data;
				$("*").each(function(){
					if (this.hasAttribute("localtext")){
						var thisKey = $(this).attr("localtext");
						var localtext = data.keys[thisKey];
						$(this).text(localtext);
					}
				});
				//Update window title
    			if (isFunctionBar){
    			    parent.changeWindowTitle(windowID,localize("filesystem/topbar/fileviewer","File Explorer"));
    			}
    			document.title = localize("filesystem/topbar/fileviewer","File Explorer");
			});
		
		}
	}
	
	function localize(thiskey,defaultMsg){
		if (window.localization === undefined){
			return defaultMsg;
		}
		if (window.localization.keys[thiskey] === undefined){
			return defaultMsg;
		}else{
			return window.localization.keys[thiskey];
		}
	}
	
	
	//Clone the file controls into js after the page loaded
	//$( document ).ready(function() {
		if (embeddedMode){
			//This windows is open under iframe / embedded mode. Hide all return path and side bar
			$("#returnSC").remove();
			$("#sideControlPanel").hide();
			$("#fileViewPanel").removeClass("eleven").addClass("twelve");
		}
		
		if (isMobile){
			//If it is mobile, modify all the css and make it fit the full width of device
			$("#delConfirm").css({left:"10px",width: "97%"});
			$("#newFolderWindow").css({left:"10px",right: "10px"});
			$("#renameFileWindow").css({left:"10px",right: "10px"});
			$("#uploadFileWindow").css({left:"10px",right: "10px"});
			$("#openWithWindow").css({left:"10px",right: "10px"});
			$("#newFileWindow").css({left:"10px",right: "10px"});
			$("#fileViewPanel").removeClass("eleven").addClass("sixteen");
			$("#sideControlPanel").css({position: "fixed",width: "70%", padding: "10px",bottom: "5px"});
			$("#sideControlPanel").hide();
			$("#filePropertiesWrapper").css({left: "3%",right: "3%",top:"15%"});
			$("#helpInterface").css({left:"10px",right: "10px",top:"10px","bottom":"10px"});
			$("#pwaAssistantUI").show();
		}
		
		if (pwa){
			//$("#returnSC").remove();
			$("#utilBottomList").hide();
			$(".hideEM").hide();
		}
		
		if (isFunctionBar){
			onFileExplorerStart();
			$(".hideFW").hide();
			//Remove the index return path in VDI and set Done to close window
			$("#returnSC").attr("href","");
			$("#doneBtn").remove();
			$("#ongoingTaskMenu").hide();
			parent.setGlassEffectMode(windowID + "");
		}else{
			//If it is run standalone, then it is not necessary.
			onFileExplorerStart();
			$(".openWithFloatWindow").each(function(){
				$(this).hide();
			});
		}
		
		if (PermissionMode == 0){
			$(".pm1").remove();
			$(".pm2").remove();
		}else if (PermissionMode == 1){
			$(".pm2").remove();
		}
		
		if (typeof(Worker) !== "undefined") {
		    //Webworker supported. File update and monitoring can be done in a much more frequent way, default value 5 secounds
		    setInterval(fileChangeDaemon,5000);
		    webworker = true;
		}else{
		    //Web worker not found. Only update every 1 minute
		    setInterval(fileChangeDaemon,60000);
		    webworker = false;
		}
		
			
		if (window.location.hash){
			var tmp = window.location.hash;
			tmp = tmp.split("%20").join(" ");
			currentPath = tmp.substr(1);
			UpdateFileList(currentPath);
			//Handle updates on the current path display
			var splitter = "/";
			if ($("#currentFolderPath").text().trim().includes("\\")){
			    splitter = "\\";
			}
			var tmp = currentPath.split("../").join("");
			tmp = tmp.replace("./",""); //Replace the first ./ from the path if there is any
			tmp = tmp.split("/").join(splitter); //Replace the path splitter from / to \ if it is on windows
            tmp = tmp.split(splitter);
            for (var i =0; i < tmp.length; i++){
                var decodeResult = decode_utf8(hex2bin(tmp[i]));
                if (decodeResult != "false"){
                    tmp[i] = "*" + decodeResult;
                }
            }
            tmp = tmp.join(splitter);
            var overlappingPath = startingSubDir.split("\\").join("/").split("/").join(splitter);
			if (startingSubDir.trim() != ""){
				$("#currentFolderPath").append(tmp.replace(overlappingPath + splitter,"") + splitter);
			}else{
				$("#currentFolderPath").append(tmp + splitter);
			}
			
			//console.log(overlappingPath, tmp + splitter);
		}
        
        updateShortcutList();
        updateNewFileList();
		//bind enter press event on the new file input box
		$("#newfilenameInput").on("keypress",function(e){
			if (e.which === 13){
				createNewFileViaInput();
			}
		});
		

	//});
	
	function updateShortcutList(){
	    $("#shortcutList").html("");
	    $.get("getFileShortcuts.php",function(data){
	        for (var i=0; i < data.length; i++){
	            if (data[i][0] == "foldershrct"){
	                //This is a folder shortcut. Creat the list in the area
	                var pathInfo = encodeURIComponent(JSON.stringify(data[i]));
	                var html = ' <div pathinfo="' + pathInfo + '" class="description shortcuts" onClick="toggleShortcut(this);"><i class="' + data[i][3] + '"></i>' + data[i][1] + '</div>';
	                $("#shortcutList").append(html);
	            }
	        }
	    });
	}
	
	function updateNewFileList(){
		$("#newFileList").html("");
		var template = '<div class="ts segment newfileType" ext="{fileExt}" onClick="selectThisFileType(this);">\
					<i class="{iconType} icon"></i> {file_description} (.{fileExt})\
			</div>';
		$.ajax("newFile.php").done(function(data){
			for(var i =0; i < data.length; i++){
				var box = template;
				box = box.split("{fileExt}").join(data[i][1]);
				box = box.split("{file_description}").join(data[i][0]);
				box = box.split("{iconType}").join(data[i][2]);
				$("#newFileList").append(box);
			}
		});
	}
	
	var newFileWaitingForReply = false; //Check if there is a request on the fly. If yes, ignore any clicking.
	function selectThisFileType(object){
		if (newFileWaitingForReply){
			//Another signal is on the fly. Ignore this keypress
			return; 
		}
		var ext = $(object).attr("ext");
		$(object).addClass("disabled");
		newFileWaitingForReply = true;
		$.ajax("newFile.php?create=" + ext + "&path=" + currentPath).done(function(data){
			if (data.includes("ERROR")){
				ShowNotice('<i class="remove icon"></i> ' + localize("filesystem/popups/newfileerror",'Error occured while trying to create a new file.'));
				console.log("[File Explorer] " + data);
				$(object).removeClass("disabled");
			}else{
				$("#newFileWindow").fadeOut('fast');
				ShowNotice('<i class="checkmark icon"></i> ' + localize("filesystem/popups/newfilesuccess",'File created.'));
				UpdateFileList(currentPath);
				$(object).removeClass("disabled");
				enableHotKeys = true;
			}
			newFileWaitingForReply = false;
		});
	}
	
	function createNewFileViaInput(){
		var newfilename = $("#newfilenameInput").val();
		if (newfilename.includes(".") == false){
			//Append txt to the back of the filename
			newfilename = newfilename + ".txt";
			$("#newfilenameInput").val($("#newfilenameInput").val() + ".txt");
		}
		var fileExt = newfilename.split(".").pop();
		$.post("newFile.php?create=" + fileExt + "&path=" + currentPath,{"filename": JSON.stringify(newfilename)}).done(function(data){
			if (data.includes("ERROR")){
				ShowNotice('<i class="remove icon"></i> ' + data);
				console.log("[File Explorer] " + data);
			}else{
				$("#newFileWindow").fadeOut('fast');
				ShowNotice('<i class="checkmark icon"></i> ' + localize("filesystem/popups/newfilesuccess",'File created.'));
				UpdateFileList(currentPath);
				enableHotKeys = true;
				$("#newfilenameInput").val("");
			}
			
		});
	}
	
	function toggleShortcut(object){
	    var pathInfo = $(object).attr("pathinfo");
	    pathInfo = JSON.parse(decodeURIComponent(pathInfo));
	    //console.log(pathInfo);
	    var dirpath = pathInfo[2];
	    if (dirpath.substring(0,6) == "/media"){
	        tmp = dirpath;
	        ExternalStorage = true;
	        startingPath = "/media";
	        //Update the shortcut listbox as well
	        var temp = dirpath.split("/");temp.shift();temp.shift();temp = temp.shift(); //Should return storage*
	        $("#shortCutMenu").val(temp);
	    }else{
	        tmp = "../../.././" + dirpath;
	        ExternalStorage = false;
	        startingPath = homedir;
			if (startingPath == "."){
				//Launching from no variables at all
				startingPath = "../../../.";
			}
			//Update the shortcut listbox as well
			$("#shortCutMenu").val('Internal Storage');
	    }
	    currentPath = tmp;
		UpdateFileList(currentPath);
		window.location.hash = currentPath.split(" ").join("%20");
		var splitter = "/";
		if ($("#currentFolderPath").text().trim().includes("\\")){
		    splitter = "\\";
		}
		if (dirpath.substring(0,6) != "/media"){
		    //This is not a shortcut to external storage
		    var displaypath = aor + splitter + dirpath.split("/").join(splitter) + splitter;
		    displaypath = decodePathFromHexFoldername(displaypath);
		    $("#currentFolderPath").text(displaypath);
		}else{
		    //This is a shortcut to external storage
		    var displaypath = dirpath;
		    displaypath = decodePathFromHexFoldername(displaypath);
		     $("#currentFolderPath").text(displaypath + "/");
		}
		
	}

	function checkDirectoryReplyValid(data){
		if (typeof data === 'string' || data instanceof String){
			//String is returned as reply. ERROR might have occured.
			if (data.includes("ERROR")){
				//Error occured. Show error message.
				//console.log("[File Explorer] " + data);
				return false;
			}
			return true;
			
		}
		return true;
	}

	function showListFileError(){
		$("#controls").hide();
		$("#sortedFileList").html(`<div class="ts heading padded slate">
			<span class="header"><i class="remove icon"></i>` + localize("filesystems/error/directoryGone",`Directory has been Moved or Deleted`) + `</span>
			<span class="description">` + localize("filesystems/error/directoryGoneInfo",`The path you are trying to open no longer exists. It might have been moved or deleted.`) + `</span>
		</div>`);
	}
	
	function fileChangeDaemon(){
	    //Monitor the filechange in the current directory. If there is a file change, update the current filelist
        $.ajax({
            url:"listdir.php?dir=" + currentPath,  
                success:function(data) {
					if (checkDirectoryReplyValid(data) == false){
						//This directory is gone after this refresh.
						showListFileError();
						return;
					}
                    if (!webworker){
                        //Web worker not found. Update check with the same thread
                         var identical = arraysEqual(data[1],files);
						 identical = identical && arraysEqual(data[0],dirs);
                        if (!identical){
                            previousScrollTopPosition = $(window).scrollTop();
                            $(".item.active").each(function(){
                                previousSelectedItemNames.push($(this).text().trim());
                            });
                            UpdateFileList(currentPath,restorePreviousSection);
                        }
                    }else{
                        //Webworker exists. Use webworker to check if the array is the same
						//The following part check the file difference
                         var worker = new Worker(window.URL.createObjectURL(arrayMatchWorker));
                          worker.onmessage = function(e) {
                            if (e.data.toString() == "false"){
                                //Webworker report file list not equal. Update the current filelist
                                previousScrollTopPosition = $(window).scrollTop();
                                $(".item.active").each(function(){
                                    previousSelectedItemNames.push(JSON.stringify($(this).text().trim()));
                                });
                                UpdateFileList(currentPath,restorePreviousSection);
                            }
                          }
                          worker.postMessage(JSON.stringify([data[1],files])); //Check for file difference
						  worker.postMessage(JSON.stringify([data[0],dirs])); //Check for directory difference
                    }
               
            }
        });
	}
	
	function restorePreviousSection(){
	    if (previousScrollTopPosition != 0){
	        $(window).scrollTop(previousScrollTopPosition);
	        previousScrollTopPosition = 0;
	    }
	    if (previousSelectedItemNames.length > 0){
	        if (previousSelectedItemNames.length > 1){
	            //Multi select mode
	            lastClicked = [];
	            $(".item").each(function(){
    	            if (previousSelectedItemNames.includes(JSON.stringify($(this).text().trim()))){
    	                $(this).addClass("active");
    	                lastClicked.push(parseInt($(this).attr("id")));
    	            }
    	        });
	        }else{
	            //Single select mode
	            lastClicked = -1;
	            $(".item").each(function(){
    	            if (previousSelectedItemNames.includes(JSON.stringify($(this).text().trim()))){
    	                $(this).addClass("active");
    	                lastClicked = parseInt($(this).attr("id"));
    	            }
    	        });
	        }
	        
	        previousSelectedItemNames = [];
	    }
	}
	
	//Assistant function for checking if two array have the same content
	function arraysEqual(a, b) {
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (a.length != b.length) return false;
      for (var i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

	function onFileExplorerStart(){
		controlsTemplate = $('#controls').html();
		if (startingPath == "."){
			//Launching from no variables at all
			startingPath = "../../../.";
			currentPath = startingPath;
		}
		UpdateFileList(startingPath);
		
		if ($("#efcb").is(":checked") == true){
			hexFolderName = true;
			$('#newfoldername').css('background-color','#caf9d1');
		}
		
		if (isFunctionBar && finishingPath == "embedded"){
			//Remove all unecessary items if the window is in embedded mode
			$('#returnSC').attr('href','');
			$('.hideEM').hide();
		}
		
		if (currentPath.includes("../../../../../../..") == true){
			//Hide all shortcut as it is in /media/* directory
			//$('#sd1').hide(); 
			//$('#sd2').hide(); 
			//$('#eusb').hide(); 
			//$('#isd').hide(); 
			//$('#scl').hide(); //scl must appears as this section of code is only used in linux system
			
			//Updated to unlimited storage selection menu
			$("#shortCutMenu").hide(); 
		}else{
			//InitiateShorcuts();
		}
		
		//Reset the drop down menu of current directory as some mobile browser might change its value when init
		$('#shortCutMenu').val('Internal Storage');
		if (startingSubDir != ""){
			//There is a starting sub directory. Go into that subdir
			currentPath = currentPath + "/" + startingSubDir;
			UpdateFileList(currentPath);
			//Update the current folder path location
			var spliter = "/";
			if ($("#currentFolderPath").text().includes("\\")){
				spliter = "\\";
			}
			var tmp = startingSubDir;
			tmp = tmp.split("/").join(spliter);
			$("#currentFolderPath").append(decodePathFromHexFoldername(tmp) + spliter);
		}
	}
	
	function toggleSideControlPanel(){
		if ($("#sideControlPanel").is(":visible")){
			$("#sideControlPanel").slideUp();
		}else{
			$("#sideControlPanel").slideDown();
		}
	}
	
	function decodePathFromHexFoldername(path){
		var spliter = "/";
		if (path.includes("\\")){
		    spliter = "\\";
		}
		var data = path.split(spliter);
		for (var i =0; i < data.length;i++){
			var decodedFoldername = decode_utf8(hex2bin(data[i]));
			if (decodedFoldername == "false" || decodedFoldername == ""){
				//This is not a hex encoded foldername or it is root (i.e. [this]/ )
				decodedFoldername = data[i]
			}else{
				//This is a hex encoded foldername
				decodedFoldername = "*" + decodedFoldername;
			}
			data[i] = decodedFoldername;
		}
		return data.join(spliter)
	}
	
	function getutime(){
		return Math.round((new Date()).getTime());
	}
	
	$("#shortCutMenu").change(function () {
        var text = this.value;
        ChangeCurrentDirectory(text);
    });
	
	function closePage(){
		//Close the current window under fw mode
		window.location.href="../killProcess.php";
	}
	
	$(document).keydown(function(e) {
        if (e.keyCode == 17 || e.keyCode == 91) ctrlDown = true;
		if (e.keyCode == 16) shiftDown = true;
		if (enableHotKeys == false){return;}
		if (e.keyCode == 67 && ctrlDown == true){
			//Ctrl + C is pressed
			copy();
		}else if (e.keyCode == 86 && ctrlDown == true){
			//Ctrl + V is pressed
			paste();
		}else if (e.keyCode == 88 && ctrlDown == true){
			//Ctrl + X is pressed
			cut();
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
			$(".active.item").removeClass("active");
		}else if (e.keyCode == 40){
			e.preventDefault();
		}else if (e.keyCode == 38){
			e.preventDefault();
		}else{
			//A random key is pressed
			if ((e.keyCode >= 48 && e.keyCode <= 57) || (e.keyCode >= 65 &&e.keyCode <= 90)){
				var firstItem = -1;
				$(".item").each(function(){
					if($(this).text().substring(0,1).toLowerCase() == String.fromCharCode(e.keyCode).toLowerCase()){
						//We only need the first item of the search result of keyword
						if (firstItem == -1){
							firstItem = $(this).attr("id");
						}
					}
				});
				//console.log(firstItem);
				//Scroll to that location
				if (firstItem !== -1 && firstItem !== undefined){
					$('html, body').animate({scrollTop: $('#' + firstItem).offset().top - $(window).height() / 2}, 100);
					$("#" + firstItem).addClass("selectionTipsBorder").delay(700).queue(function(next){
						$(this).removeClass("selectionTipsBorder");
						next();
					});
				}else{
					//Item not found
				}
				
			}
		}
		
	}).keyup(function(e) {
        if (e.keyCode == 17 || e.keyCode == 91) ctrlDown = false;
		if (e.keyCode == 16) shiftDown = false; 
		if (e.keyCode == 40){
			//Down key pressed
			if (!multiSelectMode && $(".active.item").length == 1){
				e.preventDefault();
				var currentID = parseInt($(".active.item").attr("id"));
			    if (currentID == -1){
			        //Leaving the active highlighter from Back button
			        $(".active.item").removeClass("active");
			    }
				if (currentID < globalFilePath.length - 1){
					ItemClick(currentID + 1);
					scrollToElement($("#" + (currentID + 1)),0);
				}
			}else if ($(".active.item").length == 0){
			    e.preventDefault();
			    //Select the first item if nothing here is selected.
			    ItemClick(0);
				scrollToElement($("#0"),0);
			}
		}else if (e.keyCode == 38){
			//Up key pressed
			if (!multiSelectMode && $(".active.item").length == 1){
				e.preventDefault();
				var currentID = parseInt($(".active.item").attr("id"));
				if (currentID > 0){
					ItemClick(currentID - 1);
					scrollToElement($("#" + (currentID - 1)),0);
				}else if (currentID == 0){
				    //Select the back button.
				    if ($("#-1").length > 0){
				        $(".active.item").removeClass("active");
				        $("#-1").addClass("active");
				    }
				    
				}
			}else if ($(".active.item").length == 0){
				if ($("#-1").length > 0){
					$("#-1").addClass("active");
				}
			}
		}else if (e.keyCode == 13 && deleteConfirmInProgress == false){
		    if ($(".active.item").length == 1){
		        var fileID = parseInt($(".active.item").attr('id'));
		        if (fileID == -1){
		            //Back button
		            ParentDir();
		            return;
		        }
		        if (fileID < dirs.length){
		            //Is folder
		            openFolder(fileID);
		        }else{
		            //Is file
		            openClicked();
		        }
		    }
		}
	});
	
	function scrollToElement(object,timeing){
		$([document.documentElement, document.body]).finish().animate({
        scrollTop: $(object).offset().top - window.innerHeight / 2
		}, timeing);
	}
	
	function ChangeCurrentDirectory(name){
	    var splitter = "/";
		if ($("#currentFolderPath").text().trim().includes("\\")){
		    splitter = "\\";
		}
		if (name == "Internal Storage"){
			JumpToDir('');
			$("#currentFolderPath").text(aor + splitter);
		}else{
			JumpToDir('/media/' + name,true);
			$("#currentFolderPath").text(currentPath + splitter);
		}
	}
	
	/** Deprecated function
	function InitiateShorcuts(){
		//No longer usable since 17-7-2018 update (Replaced by the unlimited storage unit implementation)
		//PLEASE DO NOT USE THIS SECTION OF CODE, Thanks :)
		$.get( "file_exists.php?file=/media/storage1", function( data ) {
		  if (data.includes("DONE") && data.includes("TRUE")){
			$('#sd1').show();
		  }else{
			 $('#sd1').hide(); 
		  }
		});
		$.get( "file_exists.php?file=/media/storage2", function( data ) {
		  if (data.includes("DONE") && data.includes("TRUE")){
			 $('#sd2').show();
		  }else{
			 $('#sd2').hide(); 
		  }
		});
		$.get( "file_exists.php?file=/media/pi", function( data ) {
		  if (data.includes("DONE") && data.includes("TRUE")){
			 $('#eusb').show();
		  }else{
			 $('#eusb').hide(); 
		  }
		});
		$.get( "file_exists.php?file=/var/www/html/AOB", function( data ) {
		  if (data.includes("DONE") && data.includes("TRUE")){
			  $('#isd').show();
		  }else{
			 $('#isd').hide(); 
		  }
		});
	}
	**/
	
	$( window ).resize(function() {
		$("#rightClickMenu").hide();
	});

	function backClicked(){
		ParentDir();
		if (currentPath == startingPath){
			$('#backBtn').addClass("disabled");
		}else{
			$('#backBtn').removeClass("disabled");
		}
	}
	
	
	function JumpToDir(directory,extStorage=false){
		if (directory != ""){
			startingPath = directory;
			currentPath = directory;
			UpdateFileList(currentPath);
		}else{
			startingPath = homedir;
			if (startingPath == "."){
				//Launching from no variables at all
				startingPath = "../../../.";
				currentPath = startingPath;
			}
			UpdateFileList(currentPath);
		}
		ExternalStorage = extStorage;
	}
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
	
	function openWith(){
		if (lastClicked.length > 1 && lastClicked.constructor === Array){
			console.log("[File Explorer] Error: Call to single file function with multi-selections");
			return;
		}else{
			//Pop up the selection menu for user to choose what moduel to open this file with
			if (globalFilePath[lastClicked] === undefined){
				//No file is selected
				return;
			}
			
			//Check if the selected item is folder.
			if (lastClicked < dirs.length){
				//This is a folder
				//Open folder in a new window.
				var newhash = globalFilePath[lastClicked];
				var newURL = window.location.href;
				if (newURL.includes("#")){
					newURL = window.location.href.split("#");
					newURL.pop();
					newURL = newURL.join("#") + "#" + newhash;
				}else{
					newURL = newURL + "#" + newhash;
				}
				if (isFunctionBar){
					var randuuid = new Date().getTime();
					parent.newEmbededWindow(newURL,"loading...","folder open outline",randuuid,1080,580,undefined,undefined,true,true);
				}else{
					window.open(newURL);
				}
			}else{
				//This is a file. Let user selet what module to open
				$("#openWithWindow").fadeIn('fast');
				openPendingModule = [];
				let thisfilepath = globalFilePath[lastClicked].replace("../../","");
				let displayName = $('#' + lastClicked).text().replace("&","%26");
				openPendingFile = [thisfilepath,displayName];
				$.get( "loadAllModule.php", function( data ) {
					if (data.includes("ERROR") == false){
						var template = '<div class="item openwith" modulepath="%MODULEPATH%" supportembd="%SUPPORTEMBD%" onClick="selectOpenWith(this);" ondblclick="selectOpendbc(this);" style="cursor:pointer;">\
					<img class="ts avatar image" src="%MODULEPATH%/img/function_icon.png" style="left: 12px;top:1px;">\
					<div class="content" style="left: 16px;">\
						<div class="header">%MODULENAME%</div>\
						<div class="description">';
						var havefw = '<div class="ts horizontal mini label"><i class="checkmark icon"></i>FloatWindow</div>'
						var haveembw = '<div class="ts horizontal mini label"><i class="checkmark icon"></i>Embedded Window</div>'
						var templateend = '</div>\
					</div\
				</div>';
						$("#openWithModuleList").html("");
						for (var i =0; i < data.length; i++){
							var box = template.replace("%MODULENAME%",data[i][0].replace("../../../",""));
								box = box.split("%MODULEPATH%").join(data[i][0]);
								if (data[i][2] == true){
									box = box.replace("%SUPPORTEMBD%","true");
								}else{
									box = box.replace("%SUPPORTEMBD%","false");
								}
								
								if (data[i][1] == true){
									box += havefw;
								}
								if (data[i][2] == true){
									box += haveembw;
								}
								box += templateend;
							$("#openWithModuleList").append(box);
						}
					}
				});
			}

		}
	}
	
	function selectOpendbc(object){
		//Handle lazy double click, open with the suitable method by auto detect
		selectOpenWith(object);
		if (isFunctionBar){
			//If it is functional bar, open it with FloatWindow
			confirmOpenWith(1);
		}else if (isMobile){
			//If it is on mobile, open with the current page (so to reduce battery consumption)
			confirmOpenWith(2);
		}else{
			//If it is desktop with a normal tab, open in new tab
			confirmOpenWith(0);
		}
	}
	
	function selectOpenWith(object){
		$(".openwith").each(function(){
			$(this).removeClass("selected");
		});
		$(object).addClass("selected");
		openPendingModule = [$(object).attr("modulepath"),$(object).attr("supportembd")];
	}
	
	function confirmOpenWith(mode = 0){
		//As this will launch module from their root path, this have to be relative to its location
		if (openPendingModule == [] || openPendingFile == []){
			return;
		}
		var thisfilepath = openPendingFile[0];
		//Fixed external storage access problem --> Adding extDiskAccess API when trying to open with a file outside internal storage
		if (thisfilepath.substring(0, 7) == "/media/"){
		    thisfilepath = "../SystemAOB/functions/extDiskAccess.php?file=" + thisfilepath
		}
		var displayName = openPendingFile[1];
		var ext = GetFileExt(thisfilepath);
		console.log(thisfilepath);
		if (openPendingModule[0] === undefined){
		    //The user did not click any other modules. Launch with default but with given mode
		    $.ajax({url: "getDefaultApp.php?mode=get&ext=" + ext, success: function(result){
					var moduleName = result[0][0];
    		        if (mode == 2){
    		            //Open with redirection
    		            if (isFunctionBar){
    		                //Do not allow redirection with current floatWindow as this might lead to inconsistence between floatWindow frame and body content
    		                ShowNotice("<i class='notice circle icon'></i> " + localize("filesystem/popups/redirectionTips","Please select a module for redirection."));
    		                return;   
    		            }
    		            if (moduleName.split(".").pop() == "php"){
    		                window.location.href = "../../../" + moduleName + "?filepath=" + thisfilepath + "&filename=" + displayName
    		            }else{
    		                window.location.href = "../../../" + moduleName + "/index.php?filepath=" + thisfilepath + "&filename=" + displayName
    		            }
    		        }else if (mode == 1){
    		            //Open in floatWindow if possible, pass it through the default handler
    		            if (isFunctionBar){
    		                OpenFileFromRealPath(thisfilepath,displayName);
    		            }
    		        }else if (mode == 0){
    		            //Open in new windows
    		            if (moduleName.split(".").pop() == "php"){
    		                window.open("../../../" + moduleName + "?filepath=" + thisfilepath + "&filename=" + displayName);
    		            }else{
    		                window.open("../../../" + moduleName + "/index.php?filepath=" + thisfilepath + "&filename=" + displayName);
    		            }
    		            //Close the openWith window
    		            $("#openWithWindow").hide();
    		        }
		        }
		    });
		    return;
		}
		var moduleName = openPendingModule[0].replace("../../../","");
		var supportembd = (openPendingModule[1] == "true");
		if (mode == 0){
			window.open("../../../" + moduleName + "/index.php?filepath=" + thisfilepath + "&filename=" + displayName);
		}else if (isFunctionBar && mode == 1){
			if (supportembd == false){
				parent.newEmbededWindow(moduleName + "/index.php?filepath=" + thisfilepath + "&filename=" + displayName,'Initializing','',filename.replace(".","_") + "-ow_" + moduleName.replace(" ","_"));
			}else{
				//If embedded mode exists, optn it with embedded interface instead.
				parent.newEmbededWindow(moduleName + "/embedded.php?filepath=" + thisfilepath + "&filename=" + displayName,'Initializing','',filename.replace(".","_") + "-ow_" + moduleName.replace(" ","_"));
			}
			
		}else if (mode == 2){
			//Redirect using this page
			thisfilepath = thisfilepath.replace("../../../","");
			window.open("../../../" + moduleName + "/index.php?filepath=" + thisfilepath + "&filename=" + displayName,"_self");
		}
		moduleName = "";
		$("#openWithWindow").hide();
	}
	
	function UpdateFileList(directory,callbackAfterUpdate = undefined){
		if (isFunctionBar){
			var windowID = $(window.frameElement).parent().attr("id");
			var foldername = baseName(directory);
			if (foldername.trim() == ""){
				foldername = localize("filesystem/windowTitle/default","File Explorer");
			}else{
			    foldername = decodeHexFolderName(foldername);
				foldername += localize("filesystem/windowTitle/folderview"," - Folder View");
			}
			parent.changeWindowTitle(windowID,foldername);
		}
		ClearSortBuffer();
		setTimeout(LoadingErrorTest,15000);
		$('#sortedFileList').html('<br><br><br><br><br><br><div class="ts active inverted dimmer"><div class="ts text loader">Loading...</div></div>');
		$('#folderList').html("");
		lastClicked = -1;
		var oprCode = getutime();
		lastActUnixtime = oprCode;
		$.ajax({
			url:"listdir.php?dir=" + directory,  
			success:function(data) {
				//console.log(data);
				if (checkDirectoryReplyValid(data) == false){
					//This directory is not valid.
					$("#sortedFileList").html("");
					showListFileError();
					/*
					setTimeout(function(){
						$("#sortedFileList").html(`<div class="ts heading padded slate">
							<span class="header"><i class="remove icon"></i>` + localize("filesystems/error/directoryNotExists",`Directory Not Exists`) + `</span>
							<span class="description">` + localize("filesystems/error/directoryNotExistsInfo",`The path you are trying to open do not exists or you do not have permission to access it.`) + `</span>
						</div>`);
					},1000);
					*/

				}else{
					PhraseFileList(data,oprCode,callbackAfterUpdate); 
				}
				
			}
		  });
		//Unlock all keypress events and leave multi selection mode
		multiSelectMode = false;
		ctrlDown = false;
		shiftDown = false;
	}

	function dragObject(evt){
		//This function define the action when a file or folder object being dragged out from the file explorer
		
		//Check the event target
		$targetObject = $(evt.target)
		if ($targetObject.hasClass("file") == false){
			//User focused into the text inside the folder div
			$targetObject = $(evt.target).parent();
		}

		//There might be more than 1 files in drag selection. Add them all to the list
		var filePaths = [];
		var fileNames = [];
		if ($(".active.file.item").length > 0){
			$(".active.file.item").each(function(){
				var fileID = $(this).attr("fid");
				var filepath = globalFilePath[fileID];
				filePaths.push(filepath);
				fileNames.push($(this).text());
			});

			//Check if the last clicked item already inside the list. If not, add it as well.
			var fileID = $targetObject.attr("fid")
			var filepath = globalFilePath[fileID];
			if (!filePaths.includes(filepath)){
				filePaths.push(filepath);
				fileNames.push($targetObject.text());
			}
		}else{
			var fileID = $targetObject.attr("fid")
			var filepath = globalFilePath[fileID];
			filePaths.push(filepath);
			fileNames.push($targetObject.text());
		}
		
		//Build file explorer relative paths
		evt.dataTransfer.setData("ferfilepath", JSON.stringify(filePaths));
		evt.dataTransfer.setData("ferfilename", JSON.stringify(fileNames));
		evt.dataTransfer.setData("external",ExternalStorage);

		//Build standard aor paths
		var aorFilepaths = [];
		for (var i =0; i < filePaths.length; i++){
			//Replace the relative path from File Explorer to AOR to nothing
			aorFilepaths.push(filePaths[i].replace("../../.././",""));
		}
		evt.dataTransfer.setData("filepath", JSON.stringify(aorFilepaths));
		evt.dataTransfer.setData("filename", JSON.stringify(fileNames));
	}

	function allowDrop(evt){
		//Allow dragdrop display on folder objects.
		evt.preventDefault();
		$(".selectionTipsBorder").removeClass("selectionTipsBorder");
		$target = $(evt.target);
		while($target.hasClass("file") == false){
			$target = $target.parent();
		}
		$target.addClass('selectionTipsBorder');
		
	}

	document.addEventListener('dragover',function(evt){
		evt.preventDefault();
		evt.stopPropagation();
		if (evt.dataTransfer.getData("ferfilepath") !== ""){
			//This is a file from another file explorer tab.
			
		}else{
			//Try to open the upload interface if this windows if focused
			if ($(parent.focusedWindow).parent().attr("id") == windowID && $("#controls").is(':visible')){
				prepareUpload();
			}
			
		}
	},false);

	document.addEventListener('drop',function(evt){
		if ($(evt.explicitOriginalTarget).is("input")){
			return;
		}
		evt.preventDefault();
		evt.stopPropagation();
		if (evt.dataTransfer.getData("ferfilepath") !== ""){
			//This is a valid file for transfer between File Explorers
			//console.log(evt.dataTransfer.getData("filepath"));
			var rawfp = evt.dataTransfer.getData("ferfilepath");
			var rawfn = evt.dataTransfer.getData("ferfilename");
			var filepaths = JSON.parse(rawfp);
			var filenames = JSON.parse(rawfn);
			var extmode = (evt.dataTransfer.getData("external") == "true");
			if (filepaths.length == 0 || filepaths === undefined){
				//Something wrong with the drag in file. Ignore it
				console.log("[File Explorer] File dragging error. Are you sure that is a valid file object from file explorer?");
				return;
			}
			if (extmode == true || ExternalStorage == true){
				//Involving external storage devices. Always use copy mode
				cutting = false;
			}else{
				//Dragdrop in current directory is always in cut mode.
				cutting = true;
			}
			paste(filepaths,currentPath,cutting);
		}
		
	},false);

	function dropObject(evt){
		//Dropping file into folder or folder into folder.
		evt.preventDefault();
		evt.stopPropagation();
		var target = $(evt.explicitOriginalTarget);
		while(target.attr("fid") === undefined){
			target = $(target).parent();
		}
		var targetFolderID = target.attr("fid");

		if (targetFolderID === undefined){
			targetFolderID = $(evt.explicitOriginalTarget).parent().attr("fid");
		}

		var targetFolderPath = globalFilePath[targetFolderID];
		var rawfp = evt.dataTransfer.getData("ferfilepath");
		var rawfn = evt.dataTransfer.getData("ferfilename");
		if (rawfp == "" || rawfp === undefined){
			//This is not a standard file explorer dragdrop.
			console.log(evt, rawfp, rawfn);

			//Check if the user drag and drop a file from his PC
			let dt = evt.dataTransfer
			let files = dt.files
			if (files.length > 0){
				//Direct drag drop file upload.
				console.log(files);
				//handleFileDragdropUpload(files);
			}
			
		}else{
			//Dragdrop from file explorer.
			var filepaths = JSON.parse(rawfp);
			var filnames = JSON.parse(rawfn);
			var extmode = (evt.dataTransfer.getData("external") == "true");
			if (filepaths.length == 0 || filepaths === undefined){
				//Something wrong with the drag in file. Ignore it
				console.log("[File Explorer] File dragging error. Are you sure that is a valid file object from file explorer?");
				return;
			}
			if (extmode == true || ExternalStorage == true){
				//Involving external storage devices. Always use copy mode
				cutting = false;
				if (targetFolderPath.split("/").shift()[1] == filepaths[0].split("/").shift()[1]){
					//Try to match the storage* between two filepath. If true, that means they are drag drops between the same external storage.
					cutting = true;
				}
			}else{
				//Dragdrop in current directory is always in cut mode.
				cutting = true;
			}
			paste(filepaths,targetFolderPath,cutting);
		}
		
	}
	
	function PhraseFileList(json,ucode,callbackAfterUpdate = undefined){
		//Updated on 7-8-2018, if the operation starting unix time is not equal to the ajax call back time, that means another operation has been called
		//Hence, the data from the previous function call need not to be displayed anymore.
		if (ucode != lastActUnixtime){
			return;
		}
		$('#fileList').html("");
		$('#folderList').html("");
		globalFilePath = [];
		AppendControls();
		dirs = json[0];
		files = json[1];
		//Update 20-3-2020: Added dragdrop function to the file display div element
		/*
		var templatef = '<div id="%NUM%" class="item file" ondblclick="openFolder(%NUM%);" onClick="ItemClick(%NUM%);" style="overflow: hidden;overflow-wrap: break-word !important;" fid="%NUM%"><div style="display:inline-block !important;"><i class="folder outline icon"></i>%FILENAME%</div></div>';
		var template = '<div id="%NUM%" class="item file" ondblclick="openClicked();" onClick="ItemClick(%NUM%);" style="overflow: hidden;overflow-wrap: break-word !important;" fid="%NUM%"><div style="display:inline-block !important;"><i class="%ICON% icon"></i>%FILENAME%</div></div>';
		*/
		var templatef = '<div id="%NUM%" class="item file" draggable="true" ondrop="dropObject(event)" ondragover="allowDrop(event)"  ondblclick="openFolder(%NUM%);" onClick="ItemClick(%NUM%);" style="overflow: hidden;overflow-wrap: break-word !important;" fid="%NUM%" ondragstart="dragObject(event)"><div style="display:inline-block !important;"><i class="folder outline icon"></i>%FILENAME%</div></div>';
		var template = '<div id="%NUM%" class="item file" draggable="true" ondblclick="openClicked();" onClick="ItemClick(%NUM%);" style="overflow: hidden;overflow-wrap: break-word !important;" fid="%NUM%" ondragstart="dragObject(event)"><div style="display:inline-block !important;"><i class="%ICON% icon"></i>%FILENAME%</div></div>';
		
		var totalCount = 0;
		if (currentPath != startingPath){
			if (currentPath.includes("../../../../../../..")){
				//The directory is outside the web root.
				var pathname = currentPath.replace("../../../../../../../","External_Storage >/");
				pathname = decodePathFromHexFoldername(pathname);
				$('#folderList').append('<div id="-1" class="item file" ondblclick="ParentDir();" style="display:inline-block;width:100%;"><i class="folder outline icon" style="display:inline-block;word-break: break-all;"></i><p style="display:inline;overflow-wrap: break-word;">' + pathname +'</p></div>');
			}else{
				//The directory is inside the web root
				var pathname = currentPath.replace("./","").replace("../../","");
				pathname = decodePathFromHexFoldername(pathname);
				$('#folderList').append('<div id="-1" class="item file" ondblclick="ParentDir();" style="display:inline-block;width:100%;"><i class="reply icon" style="display:inline-block;word-break: break-all;"></i><p style="display:inline;overflow-wrap: break-word;">' + pathname  +'</p></div>');
			}
		}
		
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
		SortFolder();
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
				$('#fileList').append(thistemplate.split("%NUM%").join(totalCount).replace("%FILENAME%",filename));
				//$('#fileList').append(thistemplate.replace("%NUM%",totalCount).replace("%NUM%",totalCount).replace("%FILENAME%",filename));
				globalFilePath[totalCount] = files[i];
				totalCount++;
				//SortFiles();
			}
			
		}
		SortFiles();
		ToggleBackBtn();
		
		if (callbackAfterUpdate != undefined){
		    callbackAfterUpdate();
		}
	}

	function ToggleBackBtn(){
		if (currentPath == startingPath){
			$('#backBtn').addClass("disabled");
		}else{
			$('#backBtn').removeClass("disabled");
		}
		//Handle context menu events
		$(".file.item").off().contextmenu(function(event) {
			event.preventDefault()
			$(".single").show();
			if ($(this).hasClass("active") == false && $(this).attr("id") != "controls"){
				//Nothing is selected yet, select this
				ItemClick($(this).attr("fid"));
			}else if ($(".active.item").length == 1 && $(this).hasClass("active")){
			    //Exceptional case where a user right click on the item he want to right click first before right click it :P
			    $(".single").show();
			}else if ($(".active.item").length > 1){
				//Multie selection. Disable some function on the menu
				//Added checking if this item is active, this to prevent false activate of multi selection mode
				$(".single").hide();
			}else if ($(this).attr("id") == "controls"){
				//Invalid operations
				return;
			}
			
			//Check if the selected item is folder. If yes, change some buttons.
			if ($(this).attr("id") < dirs.length){
				//This is a folder
				$("#openWithMenuItem").html('<i class="external icon"></i> ' + localize("filesystem/rightClickMenu/openInNewWindow", 'Open in New Window'));
			}else{
				//This is something else
				$("#openWithMenuItem").html('<i class="external icon"></i> ' + localize("filesystem/rightClickMenu/openwith",'Open With'));
			}
			
			var posX = event.clientX;
			var posY = event.clientY;
			if (posY + $("#rightClickMenu").height() > $( window ).height()){
				posY = $( window ).height() - $("#rightClickMenu").height();
			}
			if (isFunctionBar){
				posY -= 20;
			}
			$("#rightClickMenu").css({left: posX,top:posY});
			$("body").css("overflow","hidden");
			$("#rightClickMenu").show();
			
		});
	}
	
	$(document).on("click",function(e){
		$("#rightClickMenu").hide();
		$("body").css("overflow","auto");
	});
	
	function AppendUMFileName(rawname,id,template){
		/**
		//Deprecated since 20-2-2019, updated with local decoding method
		$.get( "um_filename_decoder.php?filename=" + rawname, function( data ) {
		  $('#fileList').append(template.split("%NUM%").join(id).replace("%FILENAME%",data));
		  //$('#fileList').append(template.replace("%NUM%",id).replace("%NUM%",id).replace("%FILENAME%",data));
		  $('#' + id).css("background-color","#d8f0ff");
		  $('#' + id).addClass("UMfilename");
		  SortFiles();
		  ToggleBackBtn();
		});
		**/
		var decodedName = decodeUMfilename(rawname);
		$('#fileList').append(template.split("%NUM%").join(id).replace("%FILENAME%",decodedName));
		if (decodedName != rawname){
			$('#' + id).css("background-color","#d8f0ff");
			$('#' + id).addClass("UMfilename");
		}
		ToggleBackBtn();
		
	}
	
	function decodeUMfilename(umfilename){
		if (umfilename.includes("inith")){
			var data = umfilename.split(".");
			var extension = data.pop();
			var filename = data[0];
			filename = filename.replace("inith",""); //Javascript replace only remove the first instances (i.e. the first inith in filename)
			var decodedname = decode_utf8(hex2bin(filename));
			if (decodedname != "false"){
				//This is a umfilename
				return decodedname + "." + extension;
			}else{
				//This is not a umfilename
				return umfilename;
			}
		}else{
			//This is not umfilename as it doesn't have the inith prefix
			return umfilename;
		}
	}
	
	
	function AppendHexFolderName(rawname,id,template){
		/**
		//Deprecated since 20-2-2019, updated with local decoding method
		$.get( "hex_foldername_decoder.php?dir=" + rawname, function( data ) {
		  $('#folderList').append(template.split("%NUM%").join(id).replace("%FILENAME%",data));
		  //$('#folderList').append(template.replace("%NUM%",id).replace("%NUM%",id).replace("%NUM%",id).replace("%FILENAME%",data));
		  if (data == rawname){
			  //The file isn't encoded into hex
		  }else{
			 $('#' + id).css("background-color","#caf9d1"); 
			 $('#' + id).addClass("UMfoldername");
		  }
		  SortFolder();
		  ToggleBackBtn();
		});
		**/
		var decodedFoldername = decode_utf8(hex2bin(rawname));
		if (decodedFoldername != "false"){
			$('#folderList').append(template.split("%NUM%").join(id).replace("%FILENAME%",decodedFoldername));
			$('#' + id).css("background-color","#caf9d1"); 
			$('#' + id).addClass("UMfoldername");
		}else{
			$('#folderList').append(template.split("%NUM%").join(id).replace("%FILENAME%",rawname));
		}
		ToggleBackBtn();
	}
	
	function decodeHexFolderName(folderName){
	    var decodedFoldername = decode_utf8(hex2bin(folderName));
		if (decodedFoldername == "false"){
			//This is not a hex encoded foldername
			decodedFoldername = folderName;
		}else{
			//This is a hex encoded foldername
			decodedFoldername = "*" + decodedFoldername;
		}
		return decodedFoldername;
	}
	
	function GetFileIcon(ext){
		ext = ext.toLowerCase();
		if (ext == "txt" || ext == "md"){
			return "file text outline";
		}else if (ext == "pdf"){
			return "file pdf outline";
		}else if (ext == "png" || ext == "jpg" || ext == "psd" || ext == "jpeg" || ext == "ttf" || ext == "gif"){
			return "file image outline";
		}else if (ext == "7z" || ext == "zip" || ext == "rar" || ext == "tar"){
			return "file archive outline";
		}else if (ext == "flac" || ext == "mp3" || ext == "aac" || ext == "wav" || ext == "m4a"|| ext == "ogg" || ext == "wma" ){
			return "file audio outline";
		}else if (ext == "mp4" || ext == "avi" || ext == "mov" || ext == "webm" || ext == "wmv" || ext == "mkv" || ext == "3gp"){
			return "file video outline";
		}else if (ext == "php" || ext == "html" || ext == "exe" || ext == "js" || ext == "msi"){
			return "file code outline";
		}else if (ext == "db"){
			return "file";
		}else if (ext == "stl" || ext == "obj" || ext == "dae" || ext == "3ds" || ext == "ply" || ext == "dxf" || ext == "fbx"){
			return "cube";
		}else if (ext == "shortcut"){
			return "external"
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
		$(".selectionTipsBorder").removeClass("selectionTipsBorder");
		if (ctrlDown == false && shiftDown == false){
			if (multiSelectMode == true){
				//Clear all the previous selected items
				/*
				for (var k =0; k < lastClicked.length;k++){
					$('#'+lastClicked[k]).removeClass("active");
				}*/
				$(".active").each(function(){
					$(this).removeClass("active");
				});
				lastClicked = -1;
				multiSelectMode = false;
			}
			//Select a single file / folder only
			//$('#'+lastClicked).removeClass("active");
			$(".active").removeClass("active");
			$('#'+num).addClass("active");
			$('#thisFilePath').val(rtrp(globalFilePath[num]));
			var ext = GetFileExt(globalFilePath[num]);
			var fileicon = GetFileIcon(ext);
			if (fileicon == "file image outline" && ext != "psd"){
				if (ExternalStorage){
					$('#fileicon').html('<img class="ts small forceHeight rounded image" src="../extDiskAccess.php?file=/'+globalFilePath[num]+'">');
				}else if (currentPath.includes("../../../../")){
					$('#fileicon').html('<img class="ts small forceHeight rounded image" src="../extDiskAccess.php?file=/'+globalFilePath[num]+'">');
				}else{
					$('#fileicon').html('<img class="ts small forceHeight rounded image" src="'+globalFilePath[num]+'">');
				}
			}else{
				$('#fileicon').html('<i class="'+ fileicon +' icon"></i>');
			}
			$('#filename').html($('#' + num).html());
			//Deprecated as real time calculation took too much CPU
			//getMD5(globalFilePath[num]);
			//getFilesize(globalFilePath[num]);
			lastClicked = num;
			
			//Check if it is a file or folder. Change the buttons if needed
			if (lastClicked == -1){
				//Something gone wrong :(
			}else if(lastClicked < dirs.length){
				//The user clicked on a folder
				//Change download button to zip and download
				$('#downloadbtn').html('<i class="zip icon"></i>' + localize("filesystem/operations/zipAndDown",'Zip&Down'));
			}else{
				//The user clicked on a file
				//Change download button to download
				$('#downloadbtn').html('<i class="download icon"></i>' + localize("filesystem/operations/download",'Download'));
				$("#downloadbtn").removeClass("disabled");
				$("#upload").removeClass("disabled");
				$("#renamebtn").removeClass("disabled");
				$("#openwith").removeClass("disabled");
			}
				
		}else{
			//Performing multi-selection
			if (ctrlDown == true){
				//If the multiple selection is done by control (i.e. One file by one file)
				if (multiSelectMode == false){
					//Start a new multi select mode
					multiSelectMode = true;
					var tmp = lastClicked;
					lastClicked = [];
					lastClicked.push(tmp)
					//$("#downloadbtn").addClass("disabled");
					$("#upload").addClass("disabled");
					$("#renamebtn").addClass("disabled");
					$("#openwith").addClass("disabled");
					$("#showProperties").addClass("disabled");
				}
				if (lastClicked.includes(num) == false){
					//This file is not yet selected. Add it to the selected filelist
					lastClicked.push(num);
					$('#'+num).addClass("active");
				}else{
					//This file has been selected. Cancel the selection
					for(var i = lastClicked.length - 1; i >= 0; i--) {
						if(lastClicked[i] === num) {
						   lastClicked.splice(i, 1);
						}
					}
					$('#'+num).removeClass("active");
				}
				//Update the sidebar to show multifile display
				$('#thisFilePath').val(currentPath);
				var ext = GetFileExt(globalFilePath[num]);
				var fileicon = GetFileIcon(ext);
				$('#fileicon').html('<i class="icons"><i class="big text file outline icon"></i><i class="corner small text file outline icon"></i></i>');
				$('#filename').html( lastClicked.length + localize("filesystem/operations/fileSelected"," items selected."));
				//Deprecated as real time calculation took too much CPU power
				//$('#thisFileSize').html("N/A");
				//$('#thisFileMD5').html("N/A");
			}else if (shiftDown){
				//Shift dragging mode for multi file selections
				console.log(multiSelectMode,lastClicked);
				if(multiSelectMode == false && lastClicked.constructor !== Array && lastClicked == -1){
					//Shift pressing the first item
					multiSelectMode = true;
					//$("#downloadbtn").addClass("disabled");
					$("#upload").addClass("disabled");
					$("#renamebtn").addClass("disabled");
					$("#openwith").addClass("disabled");
					lastClicked = [];
					lastClicked.push(num)
					$('#'+num).addClass("active");
				}else if (lastClicked.constructor !== Array){
					//There is already one selected item in the list. Drag select from this position
					multiSelectMode = true;
					var tmp = lastClicked;
					lastClicked = [];
					if (tmp != -1){
						lastClicked.push(tmp)
					}
					var startingNumber = lastClicked[lastClicked.length - 1];
					var endNumber = num;
					if (endNumber < startingNumber){
						var tmp = startingNumber;
						startingNumber = endNumber;
						endNumber = tmp;
					}
					for (var i = startingNumber; i <= endNumber; i++){
						if (lastClicked.includes(i) == false){
							lastClicked.push(i);
						}
						$('#'+i).addClass("active");
					}
					//$("#downloadbtn").addClass("disabled");
					$("#upload").addClass("disabled");
					$("#renamebtn").addClass("disabled");
					$("#openwith").addClass("disabled");
					$('#filename').html( lastClicked.length + " items selected.");
				}else{
					//There is already at least one file selected. Drag select all of them within the range.
					multiSelectMode = true;
					var startingNumber = lastClicked[lastClicked.length - 1];
					var endNumber = num;
					if (endNumber < startingNumber){
						var tmp = startingNumber;
						startingNumber = endNumber;
						endNumber = tmp;
					}
					for (var i = startingNumber; i <= endNumber; i++){
						if (lastClicked.includes(i) == false){
							lastClicked.push(i);
						}
						$('#'+i).addClass("active");
					}
					$('#filename').html( lastClicked.length + " items selected.");
				}
				
				
			}
			
		}
		//console.log(ctrlDown,shiftDown,multiSelectMode,lastClicked);
		//Enable buttons as there is at least one item selected
		if (!multiSelectMode){
			$(".initHidden").removeClass("disabled");
		}
	}
	
	function ShowMultSelectMenu(bool){
		if (bool == true){
			//Use multi selection menu
		}else{
			//Use normal menu
		}
	}
	
	function getMD5(filepath){
	    filepath = encodeURIComponent(JSON.stringify(filepath));
		$.get("md5.php?file=" + filepath, function( data ) {
		  $('#thisFileMD5').html(data);
		});
	}
	
	function getFilesize(filepath){
	    filepath = encodeURIComponent(JSON.stringify(filepath));
		$('#thisFileSize').html("Calculating...");
		$.get("filesize.php?file=" + filepath, function( data ) {
		  $('#thisFileSize').html(data);
		});
	}
	
	
	function rtrp(path){
		if (path === undefined){
			//Something went wrong. Raise an error in console.
			console.log('[File Explorer] Error. This operaion tries to resolve a path point to undefined location.');
			return undefined;
		}
		return path.replace("../../../","");
	}
	
	function ParentDir(){
		var tmp = currentPath.split("/");
		tmp.pop();
		currentPath = tmp.join('/');
		UpdateFileList(currentPath);
		window.location.hash = currentPath.split(" ").join("%20");
		if(isFunctionBar){
		    //Update the iframe src as well
		    var newsrc =  window.frameElement.getAttribute("src");
		    if (newsrc.includes("#")){
		      newsrc = newsrc.split("#")
		      newsrc.pop();
		      newsrc = newsrc.join("#");
		    }
		    newsrc = newsrc + "#" + currentPath.split(" ").join("%20");
		    $(window.frameElement).attr("src",newsrc);
		    //console.log(window.frameElement.getAttribute("src"));
		}
		//Update the current path on top as well
		var spliter = "/";
		if ($("#currentFolderPath").text().includes("\\")){
		    spliter = "\\";
		}
		tmp = $("#currentFolderPath").text().trim().split(spliter);
		tmp.pop();tmp.pop();
		tmp = tmp.join(spliter);
		$("#currentFolderPath").text(tmp + spliter);
	}
	
	
	//Buttons interface handlers
	function openClicked(){
		if (lastClicked != -1){
			if (lastClicked.length > 1 && lastClicked.constructor === Array){
				for(var i =0; i < lastClicked.length; i++){
					if (lastClicked[i] < dirs.length){
						//The user click to open a folder
						currentPath = globalFilePath[lastClicked[i]];
						if (currentPath.includes(startingPath)){
							UpdateFileList(currentPath);
							return;
						}
					}else{
						OpenFileFromRealPath(globalFilePath[lastClicked[i]],$('#' + lastClicked[i]).text());
					}
				}
			}else{
				if (lastClicked < dirs.length){
					//The user click to open a folder
					currentPath = globalFilePath[lastClicked];
					if (currentPath.includes(startingPath)){
						UpdateFileList(currentPath);
					}
				}else{
					OpenFileFromRealPath(globalFilePath[lastClicked],$('#' + lastClicked).text());
				}
			}
		}
	}
	
	function OpenFileFromRealPath(realPath,filename,closeAfterOpen = false){
		var file = realPath.replace("../../","");
		if (file.includes("../../../../../")){
			file = htmlEncode(file);
			file = file.replace("../../../../../","../SystemAOB/functions/extDiskAccess.php?file=/");
		}else if (ExternalStorage == true){
			file = htmlEncode(file);
			file = "../SystemAOB/functions/extDiskAccess.php?file=" + file;
		}
		var ext = GetFileExt(file);
		launchExtensionFromDefaultSettings(ext,file,filename,closeAfterOpen);
		//Deprecated code since 7-8-2018 update --> Dynamic loading extension system is used.
		/**if (isFunctionBar){ //&& finishingPath == "embedded"
			//The user click to open a file in function bar mode
			var file = realPath.replace("../../","");
			if (file.includes("../../../../../")){
				file = htmlEncode(file);
				file = file.replace("../../../../../","../SystemAOB/functions/extDiskAccess.php?file=/");
			}else if (ExternalStorage == true){
				file = htmlEncode(file);
				file = "../SystemAOB/functions/extDiskAccess.php?file=" + file;
			}
			var ext = GetFileExt(file);
			ext = ext.toLowerCase();
			if (ext == "mp3" || ext == "wav" || ext == "aac" || ext == "flac"){
				//Open with Audio module
				LaunchUsingEmbbededFloatWindow('Audio',file,filename,'music','audioEmbedded',640,170,undefined,undefined,false);
			}else if (ext == "mp4" || ext == "webm"){
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
				LaunchUsingEmbbededFloatWindow('Photo',file,filename,'file image outline','imgViewer',720,480,undefined,undefined,undefined,true);
			}else if (ext == "txt" || ext == "md"){
				LaunchUsingEmbbededFloatWindow('Document',file,filename,'file text outline','textView');
			}else{
				//Update on 7-8-2018
				//if the file extension is not found in the list above, search for already installed webApps for launching
				
			}
			
		}else{
			//The user click to open a file in stand alone mode
			var file = realPath.replace("../../","");
			if (file.includes("../../../../../")){
				file = file.replace("../../../../../","../SystemAOB/functions/extDiskAccess.php?file=/");
			}else if (ExternalStorage == true){
				file = "../SystemAOB/functions/extDiskAccess.php?file=" + file;
			}
			var ext = GetFileExt(file);
			console.log(ext);
			if (ext == "mp3"){
				//Open with Audio module
				window.location.href=("../../../Audio/?share=" + file + "&display=" + filename + "&id=-1 "); 
			}else if (ext == "mp4"){
				//Open with Video Module
				window.location.href=("../../../Video/vidPlay.php?src=" + file); 
			}else if (ext == "php" || ext == "html"){
				window.location.href=("../../" + file); 
			}else if (ext == "pdf"){
				//Opening pdf with browser build in pdf viewer
				window.location.href=("../../" + file); 
			}else if (ext == "png" || ext == "jpg" || ext == "gif"){
				//Opening png with browser build in image viewer
				window.location.href=("../../" + file); 
			}else if (ext == "txt" || ext == "md"){
				window.location.href=("../../" + file);
			}
		}
		**/
		
	}
	
	function launchExtensionFromDefaultSettings(ext,filepath,filename,closeAfterOpen){
	    ext = ext.toLowerCase(); //handle the bug reported for upper cased extension will not open normally
		$.ajax({url: "getDefaultApp.php?mode=get&ext=" + ext, success: function(result){
			if(!result.includes("ERROR")){
				if (result[0] == undefined){
				    //This file type is not seen before. Ask for default action
					if (!isFunctionBar){
						window.open("../../../SystemAOB/functions/file_system/openWith.php?filepath=" + filepath + "&filename=" + filename);
					}else{
					    //Open the selection menu at the center of the screen
					    parent.newEmbededWindow("SystemAOB/functions/file_system/openWith.php?filepath=" + filepath + "&filename=" + filename,"Starting module selector...",undefined,Math.floor(Date.now() / 1000),365,575,window.screen.availWidth/2 - 180, window.screen.availHeight/2 - 387 + 30,0,1);
					    //Check if current module is called in Virtal Desktop Mode
                        ao_module_windowID = $(window.frameElement).parent().attr("id");
                        if (closeAfterOpen){
                            parent.closeWindow(ao_module_windowID);
                        }
					}
					return;
				}
				var openkey = result[0]; //Default open this file with the first registered file player / reader
				var moduleName = openkey[0];
				var mode = openkey[1];
				var icon = openkey[2];
				var sizex = openkey[3];
				if (sizex == ""){
					sizex = undefined;
				}
				var sizey = openkey[4];
				if (sizey == ""){
					sizey = undefined;
				}
				var fixedSize = 0;
				var transparent = 0;
				if (openkey[5] == "1"){
					fixedSize = 1;
				}
				if (openkey[6] == "1"){
					transparent = 1;
				}
				var openURL = "";
				//filename = filename.replace("&","%26");
				filename = encodeURIComponent(filename);
				if (!isFunctionBar){
				    if (moduleName.includes(".php") == false){
				         //If a module do not support using /? for opening (i.e. a php script), do not add the slash
				         moduleName += "/";
			    	}
					//If not in function bar, redirect to index
					if (lastClicked.length > 1 && lastClicked.constructor === Array){
						window.open("../../../"+ moduleName +"?filepath=" + filepath + "&filename=" + filename); 
					}else if (pwa){
						window.open("../../../"+ moduleName +"?filepath=" + filepath + "&filename=" + filename); 
					}else{
						window.location.href=("../../../"+ moduleName +"?filepath=" + filepath + "&filename=" + filename); 
					}
				}else{
					if (mode.toLowerCase() == "embedded"){
					//Open in embedded mode
					//var uid = baseName(filepath).replace(/[^0-9a-z]/gi,'_');
					//The above commented code will crash if two identical named file with different extension being opened
					//Updated to the code below
					var extension = filepath.split(".").pop();
					var uid = baseName(filepath).replace(/[^0-9a-z]/gi,'_') + "_" + extension;
					LaunchUsingEmbbededFloatWindow(moduleName,filepath,filename,icon,uid,sizex,sizey,undefined,undefined,fixedSize,transparent);
					}else if (mode.toLowerCase() == "floatwindow"){
						//Open in floatWindow mode
						var url = moduleName +"?filepath=" + filepath + "&filename=" + filename;
						var icon = GetFileIcon(ext);
						parent.newEmbededWindow(url,filename,icon,Math.floor(Date.now() / 1000));
						
					}else{
						//Open directly to its index
						window.open("../../../" + filepath);
					}
				}
				if (closeAfterOpen){
					closePage();
				}
			}else{
				return "";
			}
		}});
		}
	
	function baseName(str){
	   var base = new String(str).substring(str.lastIndexOf('/') + 1); 
		if(base.lastIndexOf(".") != -1)       
			base = base.substring(0, base.lastIndexOf("."));
	   return base;
	}

	function LaunchUsingEmbbededFloatWindow(moduleName, file, filename, iconTag, uid, ww=undefined, wh=undefined,posx=undefined,posy=undefined,resizable=true,transparent=false){
		var url = moduleName + "/embedded.php?filepath=" + file + "&filename=" + filename;
		parent.newEmbededWindow(url,filename,iconTag,uid,ww,wh,posx,posy,resizable,transparent);
	}
	
	function downloadFile(){
		if (lastClicked != -1){
			//Check if it is multiple download request.
			if (Array.isArray(lastClicked)){
				//Check if the array consists of folder. If yes, reject the download request
				var noFolder = true;
				for (var i =0; i < lastClicked.length; i++){
					var fileID = lastClicked[i];
					if (fileID < dirs.length){
						noFolder = false;
					}
				}
				if (!noFolder){
					ShowNotice("<i class='remove icon'></i>" + localize("filesystem/popups/multiDownloadFolderError","You cannot include folders in multiple file download request."));
					return;
				}
				for (var i =0; i < lastClicked.length; i++){
					var fileID = lastClicked[i];
					var file = globalFilePath[fileID];
					var filename = $("#" + fileID).text();
					if (fileID < dirs.length){
						//This is a folder, ignore it for now.
						
					}else{
						//This is a file
						createFileDownloadRequest(file,filename);
					}
				}
			}else{
				if (lastClicked < dirs.length){
					//The user want to download a folder
					var file = globalFilePath[lastClicked];
					var filename = $('#' + lastClicked).text();
					filename = filename.replace(/[!@#$%^&*()/?]/g, '');
					if (usePHPForFileOperations){
						//Use legacy PHP based file zipping script
						ShowNotice("<i class='caution circle icon'></i>" + localize("filesystem/popups/zippingTips","File zipping may take a while..."));
						zipping += 1;
							$.get( "zipFolder.php?folder=" + file + "&foldername=" + filename, function(data) {
							  if (data.includes("ERROR") == false){
								  //The zipping suceed.
								  ShowNotice("<i class='checkmark icon'></i>" + localize("filesystem/popups/zipready","The zip file is now ready."));
								  window.open("download.php?file_request=" + "export/" + data + "&filename=" + data); 
								  zipping -=1 ;
							  }else{
								  //The zipping failed.
								  ShowNotice("<i class='checkmark icon'></i> " + localize("filesystem/popups/zipfailed","Folder zipping failed."));
								  zipping -=1 ;
							  }
							});
					}else{
						//Use fszip for the zip operation
						//filename = filename.replace(/[^a-zA-Z0-9-_]/g, '');
						var outputFilename = dirname(file) + "/" + filename + ".zip";
						$.ajax("fsexec.php?opr=zip&from=" + file + "&target=" + outputFilename).done(function(data){
							//Returned an uuid for listening 
							createFileOprListener([data],"zip",file,outputFilename,true);
						});
					}
					
				}else{
					//The user want to download a file
					var file = globalFilePath[lastClicked];
					var filename = $('#' + lastClicked).text();
					createFileDownloadRequest(file,filename);
				}
			}
		}
	}
	
	function createFileDownloadRequest(filepath,filename){
		var ext = GetFileExt(filepath);
		var requireValidation = false;
		if (ext == "php" || ext == "js"){
			//ShowNotice("<i class='caution sign icon'></i>ERROR! System script cannot be downloaded.");
			requireValidation = true;
			
		}
		if (requireValidation){
			if (!confirm("You are downloading a system script that might be protected by CopyRight licenses. Confirm?")){
				return;
			}
		}
		//Check if the download points to external storage or local storage.
		if (filepath.substr(0,6) == "/media"){
			//File in external storage. Append ext file access to the filepath
			filepath = "../extDiskAccess.php?file=" + filepath + "&filename=" + filterDownloadFilenameInvalidChars(filename);
			
			//Deprecated since 23-7-2019, replaced with extFileAccess method using standard javascript implementation
			//window.open("download.php?file_request=" + filepath + "&filename=" + filename); 
		}
		let a = document.createElement('a')
		a.href = filepath;
		a.download = filename;
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
	}
	
	function filterDownloadFilenameInvalidChars(filename){
		filename = filename.split("?").join("_"); 
		filename = filename.split("&").join("_");
		filename = filename.split("|").join("_");
		filename = filename.split("<").join("_");
		filename = filename.split(">").join("_");
		return filename;
	}
	
	window.onbeforeunload = function(){
		if (zipping > 0){
			return 'Your zipping progress might not be finished. Are you sure you want to leave?';
		}else if (uploading > 0){
			return 'Your upload task is still in progress. Are you sure you want to leave?';
		}else{
			
		}
	  
	};
	
	//Functions releated to showing file / folder properties
	function showProperties(){
	    $("#fileProperties").html('<div class="ts active inverted dimmer" style="height:30em;background-color:#fff;"><div class="ts text loader">Loading</div></div>');
		if (lastClicked != -1){
			if (lastClicked.length > 1 && lastClicked.constructor === Array){
				//Not support more than 1 items
			}else{
					$("#fileProperties").load("properties.php?filename=" + encodeURIComponent(JSON.stringify(globalFilePath[lastClicked])));
					$("#backpanelCover").fadeIn('fast');
					$("#filePropertiesWrapper").fadeIn('fast',function(){
						$("body").css("overflow","hidden");
					});
					
			}
		}
	}
	
	function hideProperties(){
		$("body").css('overflow',"auto");
		$('#filePropertiesWrapper').fadeOut('fast');
		$('#backpanelCover').fadeOut('fast');
	}
	
	function copy(){
		if (lastClicked != -1){
			if (PermissionMode == 0){
				ShowNotice("<i class='paste icon'></i> " + localize("filesystem/popups/permissionDenied","Permission Denied."));
				return;
			}
			if (lastClicked.length > 1){
				clipboard = [];
				for(var i =0; i < lastClicked.length; i++){
					var file = globalFilePath[lastClicked[i]];
					clipboard.push(file);
				}
				cutting = false;
				ShowNotice("<i class='paste icon'></i> " + lastClicked.length + localize("filesystem/popups/itemCopied"," items copied."));
			}else{	
				if (lastClicked < dirs.length){
					//This is a folder
					//ShowNotice("<i class='copy icon'></i>Folder copying is not supported.");
					//Folder copy is now supported with "copy_folder.php"
					var file = globalFilePath[lastClicked];
					clipboard = file;
					ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/folderCopied","Folder copied."));
					cutting = false;
				}else{
					//This is a file
					var file = globalFilePath[lastClicked];
					var ext = GetFileExt(file);
					/*
					//Removed limitation on not allowing php script editing
					if (ext == "php" || ext == "js"){
						ShowNotice("<i class='paste icon'></i>System script cannot be copied via this interface.");
					}else{
						clipboard = file;
						ShowNotice("<i class='paste icon'></i>File copied.");
						cutting = false;
					}
					*/
					clipboard = file;
					ShowNotice("<i class='paste icon'></i> " + localize("filesystem/popups/filecopied","File copied."));
					cutting = false;
				}
			}
			
			//Check if Global Clipboard is enabled. If yes, move it into globalClipboard as well.
			if (enableGlobalClipboard){
				localStorage.setItem("aroz.filesystem.clipboard",JSON.stringify(clipboard));
				localStorage.setItem("aroz.filesystem.fileopr","copy");
			}
		}else{
			//When the page just initiate
			ShowNotice("<i class='copy icon'></i>" + localize("filesystem/popups/nothingToCopy","There is nothing to copy."));
		}
		
	}
	
	function cut(){
		if (lastClicked != -1){
			if (PermissionMode == 0){
				ShowNotice("<i class='cut icon'></i> " + localize("filesystem/popups/permissionDenied","Permission Denied."));
				return;
			}
			if (lastClicked.length > 1 && lastClicked.constructor === Array){
				//More than one object is selected and cut
				clipboard = [];
				for (var i = 0; i < lastClicked.length; i++){
					if (lastClicked[i] < dirs.length){
						//This is a folder
						//ShowNotice("<i class='copy icon'></i>Folder copying is not supported.");
						//Folder copy is now supported with "copy_folder.php"
						var file = globalFilePath[lastClicked[i]];
						clipboard.push(file);
						cutting = true;
					}else{
						//This is a file
						var file = globalFilePath[lastClicked[i]];
						var ext = GetFileExt(file);
						clipboard.push(file);
						cutting = true;
					}
				}
				ShowNotice("<i class='cut icon'></i>" + lastClicked.length + localize("filesystem/popups/readyToMove"," items are ready to move."));
			}else{
				//Only one object is being cut
				clipboard = "";
				if (lastClicked < dirs.length){
					//This is a folder
					//ShowNotice("<i class='copy icon'></i>Folder copying is not supported.");
					//Folder copy is now supported with "copy_folder.php"
					var file = globalFilePath[lastClicked];
					clipboard = file;
					ShowNotice("<i class='cut icon'></i>" + localize("filesystem/popups/folderReadyToMove","Folder ready to move."));
					cutting = true;
					
				}else{
					//This is a file
					var file = globalFilePath[lastClicked];
					var ext = GetFileExt(file);
					if (ext == "php" || ext == "js"){
						ShowNotice("<i class='cut icon'></i>" + localize("filesystem/popups/fileMoveSysScript","System script cannot be cut via this interface."));
					}else{
						clipboard = file;
						ShowNotice("<i class='cut icon'></i>" + localize("filesystem/popups/fileReadyToMove","File ready to move."));
						cutting = true;
					}
					
				}
			}
			if (enableGlobalClipboard){
				localStorage.setItem("aroz.filesystem.clipboard",JSON.stringify(clipboard));
				localStorage.setItem("aroz.filesystem.fileopr","cut");
			}
			
		}else{
			//When the page just initiate
			ShowNotice("<i class='copy icon'></i> " + localize("filesystem/popups/nothingToCut","There is nothing to cut."));
		}
	}
	
	//Finish the copy or paste function operation. Set targetPath if you do not want to paste in current directory.
	function paste(sourcePaths="", targetPath="", cutMode=false){
		if (PermissionMode == 0){
			return;
		}
		//Check if global clipboard is enabled. If yes, use the global clipboard instead.
		if (enableGlobalClipboard){
			if (localStorage.getItem("aroz.filesystem.clipboard") !== null && localStorage.getItem("aroz.filesystem.clipboard") !== "") {
				clipboard = JSON.parse(localStorage.getItem("aroz.filesystem.clipboard"));
				var oprmode = localStorage.getItem("aroz.filesystem.fileopr");
				if (oprmode == "cut"){
					cutting = true;
				}else{
					cutting = false;
				}
			}
		}

		if (sourcePaths != ""){
			//Source path not empty. Replace source path with program input
			var oldClipboard = clipboard;
			if (sourcePaths.length > 1){
				clipboard = sourcePaths;
			}else if (sourcePaths.length == 1){
				clipboard = sourcePaths[0];
			}
			
			//Override the cutMode
			cutting = cutMode;
		}

		
		var finalPath = currentPath;
		if (targetPath != ""){
			//Target path not empty. Replace with desired target path.
			finalPath = targetPath;
		}
		//console.log(clipboard,finalPath );
		var cutted = cutting;
		cutting = false;
		if (clipboard == "" || clipboard == []){
			ShowNotice("<i class='paste icon'></i> " + localize("filesystem/popups/nothingToPaste","There is nothing to paste."));
			return;
		}
		
		//Check if there are multiple files are editing. If yes, process multiple
		/*
			Updated on 12-8-2019
			This update deprecate the old php file operation method and implement a new golang based method for file operations.
			However, the php based file operation is still not deprecated yet just in case it is still needed.
		*/
		if (usePHPForFileOperations){
			/*
				This section retain the original code for PHP based file operations for those system that are limited to only PHP execution but not other applications.
				In most of the case, we recommend using the golang based implementation of file operations instead of PHP based.
			*/
			if (clipboard.length > 1 && clipboard.constructor === Array){
				for(var i = 0; i < clipboard.length;i++){
					if (GetFileExt(GetFileNameFrompath(clipboard[i])).trim() == GetFileNameFrompath(clipboard[i])){
						//If the paste target is a folder instead
						var target = finalPath + "/" + GetFileNameFrompath(clipboard[i]);
						ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasting","Pasting in progress..."));
						let thisfile = clipboard[i];
						$.get( "copy_folder.php?from=" + thisfile + "&target=" + target, function(data) {
							if (data.includes("DONE")){
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/onFolderPasteFinish","Folder pasted. Refershing..."));
								UpdateFileList(currentPath);
								if (cutted == true){
								//Remove the original folder if it is a cut operation
								$.get( "delete.php?filename=" + thisfile, function(data) {
									if (data.includes("ERROR") == false){
										UpdateFileList(currentPath);
									}else{
										ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
									}
								});
								}
							}else{
								console.log("[File Explorer] " + data);
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") + " <br>" + data.replace("ERROR.",""));
							}
							
						});
						
					}else{
						var target = finalPath + "/" + GetFileNameFrompath(clipboard[i]);
						let thisfile = clipboard[i];
						$.get( "copy.php?from=" + thisfile + "&target=" + target, function(data) {
							if (data.includes("DONE")){
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/filePasted","File pasted. Refershing..."));
								UpdateFileList(currentPath);
								if (cutted == true){
									//Remove the original file if it is a cut operation
									$.get( "delete.php?filename=" + thisfile, function(data) {
										if (data.includes("ERROR") == false){
											UpdateFileList(currentPath);
										}else{
											ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
										}
									});
								}
							}else{
								console.log("[File Explorer] " + data);
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +" <br>" + data.replace("ERROR.",""));
							}
							
						});
					}
				}
				clipboard = "";
			}else{
				if (GetFileExt(GetFileNameFrompath(clipboard)).trim() == GetFileNameFrompath(clipboard)){
					//If the paste target is a folder instead
					var target = finalPath + "/" + GetFileNameFrompath(clipboard);
					ShowNotice("<i class='paste icon'></i>Pasting in progress...");
					$.get( "copy_folder.php?from=" + clipboard + "&target=" + target, function(data) {
						if (data.includes("DONE")){
							ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/folderPasted","Folder pasted. Refershing..."));
							UpdateFileList(currentPath);
							if (cutted == true){
							//Remove the original folder if it is a cut operation
							$.get( "delete.php?filename=" + clipboard, function(data) {
								if (data.includes("ERROR") == false){
									UpdateFileList(currentPath);
								}else{
									ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
								}
							});
							}
						}else{
							console.log("[File Explorer] " + data);
							ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +" <br>" + data.replace("ERROR.",""));
						}
						
					});
					
				}else{
					var target = finalPath + "/" + GetFileNameFrompath(clipboard);
					$.get( "copy.php?from=" + clipboard + "&target=" + target, function(data) {
						if (data.includes("DONE")){
							ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/filePasted","File pasted. Refershing..."));
							UpdateFileList(currentPath);
							if (cutted == true){
								//Remove the original file if it is a cut operation
								$.get( "delete.php?filename=" + clipboard, function(data) {
									if (data.includes("ERROR") == false){
										UpdateFileList(currentPath);
									}else{
										ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
									}
								});
							}
						}else{
							console.log("[File Explorer] " + data);
							ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +" <br>" + data.replace("ERROR.",""));
						}
						
					});
				}
			}
			
		}else{
			/*
				New implementation of file operations (move / move folder / copy / copy folder)
				This provide much better speed than PHP based file operations.
			*/
			if (clipboard.length > 1 && clipboard.constructor === Array){
				let fileoprIDs = [];
				for(var i = 0; i < clipboard.length;i++){
					if (GetFileExt(GetFileNameFrompath(clipboard[i])).trim() == GetFileNameFrompath(clipboard[i])){
						//If the paste target is a folder instead
						let target = finalPath + "/" + GetFileNameFrompath(clipboard[i]);
						ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasting","Pasting in progress..."));
						let thisfile = clipboard[i];
						if (cutted == true){
							//Move operation
							let localClipboard = clipboard;
							$.get( "fsexec.php?opr=move_folder&from=" + thisfile + "&target=" + target, function(data) {
								if (!data.includes("ERROR")){
									fileoprIDs.push(data);
									if (localClipboard.length == fileoprIDs.length){
										createFileOprListener(fileoprIDs,"move",localClipboard, target);
										clipboard = "";
									}
								}else{
									console.log("[File Explorer] " + data);
									ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
								}
								
							});
						}else{
							//Copy operation
							let localClipboard = clipboard;
							$.get( "fsexec.php?opr=copy_folder&from=" + thisfile + "&target=" + target, function(data) {
								if (!data.includes("ERROR")){
									fileoprIDs.push(data);
									if (localClipboard.length == fileoprIDs.length){
										createFileOprListener(fileoprIDs,"copy",localClipboard, target);
										clipboard = "";
									}
								}else{
									console.log("[File Explorer] " + data);
									ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
								}
								
							});
						}
						UpdateFileList(currentPath);
					}else{
						//The paste target is a file
						var target = finalPath + "/" + GetFileNameFrompath(clipboard[i]);
						let thisfile = clipboard[i];
						if (cutted == true){
							let localClipboard = clipboard;
							$.get( "fsexec.php?opr=move&from=" + thisfile + "&target=" + target, function(data) {
								if (!data.includes("ERROR")){
									fileoprIDs.push(data);
									if (localClipboard.length == fileoprIDs.length){
										createFileOprListener(fileoprIDs,"move",localClipboard, target);
										clipboard = "";
									}
								}else{
									console.log("[File Explorer] " + data);
									ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
								}
								
							});
						}else{		
							let localClipboard = clipboard;
							$.get( "fsexec.php?opr=copy&from=" + thisfile + "&target=" + target, function(data) {
								if (!data.includes("ERROR")){
									fileoprIDs.push(data);
									if (localClipboard.length == fileoprIDs.length){
										createFileOprListener(fileoprIDs,"copy",localClipboard, target);
										clipboard = "";
									}
								}else{
									console.log("[File Explorer] " + data);
									ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
								}
								
							});
						}
						
					}
				}
			
			}else{
				//There is only one item in the clipboard
				if (GetFileExt(GetFileNameFrompath(clipboard)).trim() == GetFileNameFrompath(clipboard)){
					//If the paste target is a folder instead
					var target = finalPath + "/" + GetFileNameFrompath(clipboard);
					ShowNotice("<i class='paste icon'></i> " + localize("filesystem/popups/pasting","Pasting in progress..."));
					if (cutted == true){
						//Move mode
						$.get( "fsexec.php?opr=move_folder&from=" + clipboard + "&target=" + target, function(data) {
							if (!data.includes("ERROR")){
								createFileOprListener([data],"move",clipboard, target);
							}else{
								console.log("[File Explorer] " + data);
								howNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
							}
						});

					}else{
						//Copy mode
						var duplicated = false;
						var isHex = false;
						var sourceFoldername = GetFileNameFrompath(clipboard);
						if (decodeHexFoldername(sourceFoldername) != sourceFoldername){
						    isHex = true;
						}
						if (clipboard == target){
							//Clone folder in the same directory. Add a clone label for it.
							duplicated = true;
						}
                        
						//Check the paste target (current directory) has the same foldername as the source
						var foldernames = [];
						for(var i=0; i < dirs.length; i++){
							foldernames.push(GetFileNameFrompath(dirs[i]));
						}
						if (foldernames.includes(sourceFoldername) && targetPath==""){
							duplicated = true;
						}
                        console.log(isHex);
						if (duplicated){
							//Fix the foldername duplication problem
							var newTarget = target;
							var counter = 1;
							while(dirs.includes(newTarget)){
								if (isHex){
									//The source file is in hex foldername mode.
									newTarget = target+ bin2hex(" (" + counter +")" );
								}else{
									//The source file is not in hexfoldername mode
									newTarget = target+" (" + counter + ")";
								}
								counter += 1;
							}
							target = newTarget;
						}
						
						$.get( "fsexec.php?opr=copy_folder&from=" + clipboard + "&target=" + target, function(data) {
							if (!data.includes("ERROR")){
								createFileOprListener([data],"copy",clipboard, target);
							}else{
								console.log("[File Explorer] " + data);
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
							}
							
						});
					}
					
					
				}else{
					//The paste target is file
					var target = finalPath + "/" + GetFileNameFrompath(clipboard);
					if (cutted == true){
						$.get( "fsexec.php?opr=move&from=" + clipboard + "&target=" + target, function(data) {
							if (!data.includes("ERROR")){
								createFileOprListener([data],"move",clipboard, target);
							}else{
								console.log("[File Explorer] " + data);
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
							}
							
						});
					}else{
						//Check the paste target (current directory) has the same foldername as the source
						var filenames = [];
						var duplicated = false;
						var sourceFilename = GetFileNameFrompath(clipboard);
						var isHex = !(decodeUmFilename(sourceFilename) == sourceFilename);
						for(var i=0; i < files.length; i++){
							filenames.push(GetFileNameFrompath(files[i]));
						}
						if (filenames.includes(sourceFilename) && targetPath==""){
							//If the filename is in currentlist and targetPath is empty
							duplicated = true;
						}

						if (duplicated){
							//Fix the foldername duplication problem
							var newTarget = target;
							var counter = 1;
							while(filenames.includes(GetFileNameFrompath(newTarget))){
								if (isHex){
									//The source file is in hex foldername mode.
									newTarget = appendToFilename(target,bin2hex(" (" + counter +")" ));
								}else{
									//The source file is not in hexfoldername mode
									newTarget = appendToFilename(target," (" + counter + ")");
								}
								counter += 1;
							}
							target = newTarget;
						}
						$.get( "fsexec.php?opr=copy&from=" + clipboard + "&target=" + target, function(data) {
							if (!data.includes("ERROR")){
								createFileOprListener([data],"copy",clipboard, target);
							}else{
								console.log("[File Explorer] " + data);
								ShowNotice("<i class='paste icon'></i>" + localize("filesystem/popups/pasteError","Paste Error. Error Message:") +  " <br>" + data.replace("ERROR.",""));
							}
							
						});
					
					}
					
				}
			}
		}

		if (sourcePaths != ""){
			//Restore the original clipboard value
			clipboard = oldClipboard;
		}
		
	}

	function appendToFilename(filepath, content){
		//This function append something to the given filepath. 
		//For example, given "/media/test.txt" and "abc", "/media/testabc.txt" will be returned
		var dirpath = filepath.split("/");
		var filename = dirpath.pop();
		dirpath = dirpath.join("/");
		filename = filename.split(".");
		var ext = filename.pop();
		filename = filename.join(".");
		return dirpath + "/" + filename + content + "." + ext;

	}

	function createFileOprListener(uuid,baseOpr = "copy",source="Unknown Source",target="Unknown Target",downloadOutfile = false){
		//Create a listner object for the given uuid in large file operations
		//uuid is an array of at least one item.
		//Create a file operation dialog
		var opr = "copy";
		var title = localize("filesystem/ongoingTasks/copying","Copying ") + uuid.length;
		var iconTag = "copy";
		var outfile = target; //Store the raw output file
		if (baseOpr == "move"){
			title = localize("filesystem/ongoingTasks/moving","Moving ") + uuid.length;
			iconTag = "cut"
			opr = "move"
		}else if (baseOpr == "zip"){
			title = localize("filesystem/ongoingTasks/zipping","Zipping ") + uuid.length;
			iconTag = "file archive outline"
			opr = "zip"
		}else if (baseOpr == "unzip"){

		}
		if (uuid.length > 1){
			title += localize("filesystem/ongoingTasks/items"," items");
		}else{
			title += localize("filesystem/ongoingTasks/item"," item");
		}
		//Just in case the source is feeded in as an array, only take one for getting the main dir
		if (source.length > 1 && source.constructor === Array){
			source = source[0];
		}
		if (source != "Unknown Source" && source.includes(".")){
			source = dirname(source); //Show its source folder instead of filename
		}

		if (target != "Unknown Target" && target.includes(".")){
			target = dirname(target); //Show its source folder instead of filename
		}

		if (isFunctionBar){
			if (downloadOutfile){
				var src='SystemAOB/functions/file_system/fileoprProgress.php?opr=' + opr + '&listen=' + JSON.stringify(uuid) + "&source=" + source + "&target=" + target + "&download=" + outfile;
			}else{
				var src='SystemAOB/functions/file_system/fileoprProgress.php?opr=' + opr + '&listen=' + JSON.stringify(uuid) + "&source=" + source + "&target=" + target;
			}
			var uid = getutime();
			parent.newEmbededWindow(src, title, iconTag, uid ,480, 210, undefined, undefined, false, true);
		}else{
			//Create file operation dialog in the side panel
			//Try to shorten some path name if needed
			var dest = target;
			if (dest.includes("\\")){
				dest = dest.split("\\").join("/");
			}
			if (dest.includes("/")){
				//Only get the destination foldername if possible.
				dest = ".../" + decodeHexFolderName(dest.split("/").pop());
			}
			if(dest.length > 25) {
				dest = dest.substring(0,24) + "...";
			}
			let listenObjectUUID = new Date().getTime();
			//Default progress bar
			var progressbarType = '<div class="ts primary small progress">\
										<div class="bar" style="width: 0%">\
											<span class="text">0%</span>\
										</div>\
									</div>';
			if (uuid.length == 1){
				progressbarType = '<div class="ts preparing primary small progress">\
									<div class="bar" style="width: 100%"></div>\
								</div>';
			}
			//Multieple item progress bar
			var foprObject = '<div class="item ongoingTaskObject" uuid="' + listenObjectUUID + '" listen="' + encodeURIComponent(JSON.stringify(uuid)) + '" target="' + encodeURIComponent(outfile) + '">\
								<i class="' + iconTag + ' icon"></i>\
								<div class="content">\
									<div class="header">' + title + localize("filesystem/ongoingTasks/oprInto",' into ') + dest + '</div>\
									<div class="description">' + progressbarType + '\
										</div>\
									</div>\
								</div>\
							</div>';
			$("#ongoingTasklist").append(foprObject);

			//Create listener for this onGoing Task Object
			let thisuuid = uuid;
			let downloadResult =downloadOutfile;
			setTimeout(function(){
				listenFileOperationMainThread(listenObjectUUID,thisuuid,downloadResult);
			},fileOprListenerInterval);

		}
	}

	function listenFileOperationMainThread(listenObjectUUID,thisuuid,downloadOutfile){
		let thisObjectUUID = listenObjectUUID;
		let objectListenUUID = thisuuid;
		//Check if the process finished
		$.ajax("fsexec.php?listen=" + JSON.stringify(objectListenUUID)).done(function(data){
			//Get status from returned data
			//console.log(data,thisuuid);
			//Calculate the progress rate
			var finished = 0;
			var total = thisuuid.length;
			for (var i = 0; i < data.length; i++){
				if (data[i][1] == "done"){
					finished++;
				}else if (data[i][1] == "null"){
				    //Something odd happened. Assume finished
				    finished++;
				}
			}
			//Update the progress bar
			$(".ongoingTaskObject").each(function(){
				//Find the corrisponding ongoingTaskObject
				if ($(this).attr("uuid") == thisObjectUUID){
					//This is the correct item
					if (finished == total){
						//Task completed
						$(this).find(".bar").css("width","100%");
						if (!$(this).find(".progress").hasClass("preparing")){
							$(this).find(".bar").find(".text").text("100%");
						}
						$(this).find(".progress").removeClass("primary").removeClass("preparing").addClass("positive");
						$(this).find(".icon").attr("class","checkmark icon");
						$(this).find(".header").css("color","#258223");
						$(this).delay(5000).fadeOut('slow',function() { $(this).remove(); });
                        
                        //Download if it is zipping
						//Work in progress
                        if (downloadOutfile){
                            var outfile = decodeURIComponent($(this).attr("target"));
                            console.log("[File Explorer] File ready: " + outfile);
                            createFileDownloadRequest(outfile,GetFileNameFrompath(outfile));
                        }
						
					}else{
						//Task not completed yet, update progress bar
						if (!$(this).find(".progress").hasClass("preparing")){
							var progressPercentage = parseInt(finished / total * 100);
							$(this).find(".bar").css("width",progressPercentage + "%");
							$(this).find(".bar").find(".text").text(progressPercentage + "%");
						}
						setTimeout(function(){
							listenFileOperationMainThread(listenObjectUUID,thisuuid,downloadOutfile);
						},fileOprListenerInterval);
					}
				}
			});
		});
	}
	function dirname(path){
		var windowPathSeperator = false;
		if (path.includes("\\")){
			windowPathSeperator = true;
		}
		path = path.split("\\").join("/");
		var tmp = path.split("/");
		tmp.pop();
		if (windowPathSeperator){
			return tmp.join("\\");
		}else{
			return tmp.join("/");
		}
		
	}
	
	function ConfirmDelete(){
		if (lastClicked.constructor === Array){
			//Updates from File system code makes this variable to be either string or array. Convert it to array if it is not array.
		}else{
			var tmp = lastClicked;
			lastClicked = [];
			lastClicked.push(tmp);
		}
		if (lastClicked.length > 0 && PermissionMode == 2){
			deleteConfirmInProgress = true;
			$('#dname').html("");
			$('#drname').html("");
			$('#dfpath').html("");
			deletePendingFile = [];
			for (var i=0; i < lastClicked.length; i++){
				if (lastClicked[i] < dirs.length){
					//It is a dir
					var file = globalFilePath[lastClicked[i]].replace("../../../","");
					var filename = $('#' + lastClicked[i]).text();
					//$('#dname').append("Folder Name: " + filename + "<br>");
					//$('#drname').append("Storage Name: " + file.replace(currentPath.replace("../../../","") + "/","")  + "<br>");
					$('#dfpath').append("<i class='folder outline icon'></i>" + filename  + "<br>");
					deletePendingFile.push(globalFilePath[lastClicked[i]]);
					$('#delConfirm').fadeIn('fast');
				}else{
					//It is a file
					var file = globalFilePath[lastClicked[i]].replace("../../../","");
					var filename = $('#' + lastClicked[i]).text();
					var ext = GetFileExt(file);
					//$('#dname').append("File Name: " + filename + "<br>");
					//$('#drname').append("Storage Name: " + file.replace(currentPath.replace("../../../","") + "/","") + "<br>");
					$('#dfpath').append("<i class='file outline icon'></i>" + filename + "<br>");
					deletePendingFile.push(globalFilePath[lastClicked[i]]);
					$('#delConfirm').fadeIn('fast');
				}
			}
			
		}
	}
	
	function deleteFile(){
		if (PermissionMode < 2){
			return;
		}
		deleteConfirmInProgress = false;
		$('#delConfirm').fadeOut('fast');
		if (deletePendingFile != "" || deletePendingFile != []){
			for(var i = 0; i < deletePendingFile.length; i++){
				//Delete the path
				$.get( "delete.php?filename=" + deletePendingFile[i], function(data) {
					console.log(data);
					if (data.includes("ERROR") == false){
						ShowNotice("<i class='checkmark icon'></i> " + localize("filesystem/popups/fileRemoved","File removed."));
					}else{
						ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
					}
				});
			}
			setTimeout(function(){ UpdateFileList(currentPath); }, 500);
			
		}
	}
	
	function GetFileNameFrompath(path){
		var basename = path.replace(/\\/g,'/').replace(/.*\//, '');
		return basename;
	}
	
	function ShowNotice(text){
		$('#noticeCell').stop().clearQueue().finish();
		$('#noticeContent').html(text);
		$('#noticeCell').fadeIn("slow").delay(3000).fadeOut("slow");
	}
	
	function showHelp(){
		$("#helpInterface").fadeIn('fast');
		enableHotKeys = false;
	}
	
	function openFolder(id){
		currentPath = globalFilePath[id];
		window.location.hash = currentPath.split("%20").join(" ");
		if(isFunctionBar){
		    //Update the iframe src as well
		    var newsrc =  window.frameElement.getAttribute("src");
		    if (newsrc.includes("#")){
		      newsrc = newsrc.split("#")
		      newsrc.pop();
		      newsrc = newsrc.join("#");
		    }
		    newsrc = newsrc + "#" + currentPath.split(" ").join("%20");
		    $(window.frameElement).attr("src",newsrc);
		    //console.log(window.frameElement.getAttribute("src"));
		}
		var directoryName = currentPath.split("/").pop();
		var splitter = "/";
		if ($("#currentFolderPath").text().includes("\\")){
		    splitter = "\\";
		}
		var rawdirname = directoryName;
		var displaydirname = $("#" + id).text().trim();
		if (rawdirname != displaydirname){
		    displaydirname = "*" + displaydirname;
		}
		$("#currentFolderPath").text($("#currentFolderPath").text().trim() + displaydirname + splitter);
		if (currentPath.includes(startingPath)){
			UpdateFileList(currentPath);
		}
	}
	
	//New Folder Naming Monitoring 
	$("#efcb").change(function() {
		if(this.checked) {
			//use hex encoding
			$('#newfoldername').css('background-color','#caf9d1');
			hexFolderName = true;
		}else{
			//use normal encoding
			$('#newfoldername').css('background-color','white');
			hexFolderName = false;
			$('#newfoldername').val($('#newfoldername').val().replace(/[^a-z0-9]/gmi, " ").replace(/\s+/g, " "));
		}
	});
	
	//Rename File Naming Monitoring
	$("#efcbr").change(function() {
		if(this.checked) {
			//use hex encoding
			if (renamingFolderID < dirs.length){
				$('#renameFileName').css('background-color','#caf9d1');
			}else{
				$('#renameFileName').css('background-color','#D8F0FF');
			}
			
			hexFolderName = true;
		}else{
			//use normal encoding
			$('#renameFileName').css('background-color','white');
			hexFolderName = false;
			$('#renameFileName').val($('#renameFileName').val().replace(/[^a-z0-9]/gmi, " ").replace(/\s+/g, " "));
		}
	});
	
	$('#newfoldername').on('input', function() {
		if (!hexFolderName){
			$('#newfoldername').val($('#newfoldername').val().replace(/[^a-z0-9]/gmi, " ").replace(/\s+/g, " "));
		}
	});
	
	$('#newfoldername').on('keypress', function (e) {
        if(e.which === 13){
			CreateNewFolder();
		}
	});
	 
	$(window).scroll(function(e){
		var pos = $(this).scrollTop();
		if (pos > 300){
			//Fix the menu bar to the top of the window
			if (isMobile){
				$("#fileViewPanel").css("width","100%");
			}
			$("#controls").css("position","fixed");
			$("#controls").css("top","0px");
			$("#controls").css("left","5px");
			$("#controls").css("right","5px");
			$("#controls").css("z-index","99");
			$("#controls").css("background-color","white");
			if (!embeddedMode && !isMobile){
				$("#sideControlPanel").css("top",$("#controls").position().top + $("#controls").outerHeight(true));
			}
		}else if (pos < 150){
			//Let go the menu bar
			if (isMobile){
				$("#fileViewPanel").css("width","100%");
			}
			$("#controls").css("position","");
			$("#controls").css("background-color","");
			$("#controls").css("top","");
			$("#controls").css("left","");
			$("#controls").css("right","");
			if (!embeddedMode && !isMobile){
				$("#sideControlPanel").css("bottom","");
				$("#sideControlPanel").css("top","9%");
			}
			
		}
	});
	 
	function newFolder(){
		enableHotKeys = false;
		$('#newFolderWindow').fadeIn('fast');
		$('#newfoldername').val("");
		newFolderPath = currentPath;
	}
	
	function newFile(){
		enableHotKeys = false;
		$("#newFileWindow").fadeIn('fast');
	}
	
	function CreateNewFolder(){
		var foldername = $('#newfoldername').val();
		var bin2hex = $("#efcb").is(":checked");
		//alert(newFolderPath + "/" + foldername + " bin2hex=" + $("#efcb").is(":checked"));
		$.post( "newFolder.php", { folder: newFolderPath, foldername: foldername, hex: bin2hex}).done(function( data ) {
			if (data.includes("DONE")){
				UpdateFileList(currentPath);
				$('#newFolderWindow').fadeOut('fast');
				enableHotKeys = true;
			}else{
				ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
			}
		});
	}
	
	function stripHTML(id){
		return $("#" + id).clone().children().remove().end().text();
	}
	
	function rename(){
		if (lastClicked != -1){
			if (PermissionMode < 2){
				ShowNotice("<i class='text cursor icon'></i> " + localize("filesystem/popups/permissionDenied","Permission Denied."));
				return;
			}
			var useSpecialEncoding = false;
			var warning = '<div class="sub header">' + localize("filesystem/rename/tips",'Filename must only contain Alphabets, Numbers and Space.') + '<br>' + localize("filesystem/rename/tips2",'Please tick the "Encoded Filename" option for other special characters.') + '</div>';
			var selectedFilename = $("#" + lastClicked).find("div").text();
			$('#oldRenameFileName').val(selectedFilename);
			$('#renameFileName').val(selectedFilename);
			$('#oldRenameFileName').css("background-color",$('#' + lastClicked).css('background-color'));
			if ($('#' + lastClicked).css('background-color') != "rgb(233, 233, 233)"){
				//This might be file using UMformat or folder using bin2hex format.
				$('#efcbr').prop('checked',true);
				useSpecialEncoding = true;
			}else{
				$('#efcbr').prop('checked',false);
				$('#renameFileName').css('background-color','#E9E9E9')
			}
			if (lastClicked < dirs.length){
				//This is a folder
				enableHotKeys = false;
				$('#renameFileWindow').fadeIn('fast');
				$('#renameTitle').html(localize("filesystem/rename/renamefolder","Rename Folder") + warning);
				$('#renameIcon').removeClass('file').addClass('folder');
				if (useSpecialEncoding) $('#renameFileName').css('background-color','#caf9d1');
			}else{
				//This is a file
				enableHotKeys = false;
				$('#renameFileWindow').fadeIn('fast');
				$('#renameTitle').html(localize("filesystem/rename/renamefile","Rename File") + warning);
				$('#renameIcon').removeClass('folder').addClass('file');
				if (useSpecialEncoding) $('#renameFileName').css('background-color','#D8F0FF');
			}
			renamingFolderID = lastClicked;
		}else{
			//When the page just initiate
			ShowNotice("<i class='text cursor  icon'></i> "+ localize("filesystem/popups/nothingToRename","There is nothing to rename."));
		}
	}
	
	function confirmRename(){
		var renameFile = globalFilePath[renamingFolderID];
		renameFile = encodeURIComponent(JSON.stringify(renameFile));
		var newFileName = currentPath + "/" + $('#renameFileName').val();
		newFileName = encodeURIComponent(JSON.stringify(newFileName));
		var isHex = $('#efcbr').prop('checked');
		//console.log(renameFile,newFileName,isHex);
		if (isHex){
			$.get( "rename.php?file=" + renameFile + "&newFileName=" + newFileName + "&hex=true", function(data) {
				if (data.includes("DONE")){
					UpdateFileList(currentPath);
					$('#renameFileWindow').fadeOut('fast');
					enableHotKeys = true;
				}else{
					ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
				}
			});
		}else{
			$.get( "rename.php?file=" + renameFile + "&newFileName=" + newFileName + "&hex=false", function(data) {
				if (data.includes("DONE")){
					UpdateFileList(currentPath);
					$('#renameFileWindow').fadeOut('fast');
					enableHotKeys = true;
				}else{
					ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
				}
			});
		}
	}
	
	$('#renameFileName').on('keypress', function (e) {
         if(e.which === 13){
			confirmRename();
		 }
	 });
	 
	 function convertFileName(){
		 if (lastClicked != -1){
			if (PermissionMode < 2){
				ShowNotice("<i class='text cursor icon'></i> " + localize("filesystem/popups/permissionDenied","Permission Denied."));
				return;
			}else{
				//This function convert the filename to hex or hex back to bin
				if (lastClicked.length > 1 && lastClicked.constructor === Array){
					//Multiple files are selected for renaming
					for (var i = 0; i < lastClicked.length; i++){
					    var jsonpath = encodeURIComponent(JSON.stringify(globalFilePath[lastClicked[i]]));
						 $.get( "filename_switch.php?filename=" +jsonpath, function(data) {
							//console.log("filename_switch.php?filename=" + globalFilePath[lastClicked[i]]);
							if (data.includes("DONE")){
								//Continue to loop and convert filenames
							}else{
								ShowNotice("<i class='exchange outline icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
								return;
							}
						});
					}
					let length = lastClicked.length;
					setTimeout(function(){
						UpdateFileList(currentPath);
						ShowNotice("<i class='checkmark icon'></i> " + length + localize("filesystem/popups/itemsConverted"," items has been converted."));
					},500);
				 }else{
				     var jsonpath = encodeURIComponent(JSON.stringify(globalFilePath[lastClicked]));
					 $.get( "filename_switch.php?filename=" + jsonpath, function(data) {
						//console.log("filename_switch.php?filename=" + globalFilePath[lastClicked]);
						if (data.includes("DONE")){
							UpdateFileList(currentPath);
						}else{
							ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
						}
					});
				 }
				 
			}
		 }
	 }
	 
	 function previewUplaodFileList(){
		var inp = document.getElementById('multiFiles');
		$('#ulFileList').toggle();
		$('#ulFileListItems').html("");
		for (var i = 0; i < inp.files.length; ++i) {
		  var filename = inp.files.item(i).name;
		  $('#ulFileListItems').append('<div class="item">' + filename + "</div>");
		}
		if (inp.files.length == 0){
			$('#ulFileListItems').append('<div class="item">' + "No selected files" + "</div>");
		}
	 }
	 
	 $('#multiFiles').on("change", function(){
		var inp = document.getElementById('multiFiles');
		$('#ulFileListItems').html("");
		for (var i = 0; i < inp.files.length; ++i) {
		  var filename = inp.files.item(i).name;
		  $('#ulFileListItems').append('<div class="item">' + filename + "</div>");
		}
		if (inp.files.length == 0){
			$('#ulFileListItems').append('<div class="item">' + "No selected files" + "</div>");
		}
	 });
	 
	 function prepareUpload(){
		 if (uploading > 0){
			 ShowNotice("<i class='upload icon'></i>" + localize("filesystem/popups/prepareUploadWait","Another upload task is running.<br>Please wait until the previous one is finished."));
			 return;
		 }
		 $('#uploadFileWindow').fadeIn('fast');
		 prepareUplaodPath = currentPath.replace("../../../../../../../","/").replace("../../../","AOB/");
		 $('#uploadTarget').val(prepareUplaodPath);
		 enableHotKeys = false;
	 }
	 
	 function closeUploadWindow(){
		 prepareUplaodPath = "";
		 enableHotKeys = true;
	 }
	 
	 $('#uploadFilesBtn').on('click', function () {
                    var form_data = new FormData();
                    var ins = document.getElementById('multiFiles').files.length;
                    for (var x = 0; x < ins; x++) {
                        form_data.append("files[]", document.getElementById('multiFiles').files[x]);
                    }
					 $('#uploadFileWindow').fadeOut('fast');
					 ShowNotice("<i class='upload icon'></i>" + localize("filesystem/popups/uploadStart","The upload will be processed in the background.<br>Please wait until the process is finished."));
					 uploading++;
                    $.ajax({
                        url: 'filesUploadHandler.php?path=' + prepareUplaodPath, 
                        dataType: 'text', 
                        cache: false,
                        contentType: false,
                        processData: false,
                        data: form_data,
                        type: 'post',
                        success: function (data) {
                            //Sucess
							uploading--;
							if (data.includes("DONE")){
								closeUploadWindow();
								ShowNotice("<i class='upload icon'></i>" + localize("filesystem/popups/uploadSucceed","File upload suceed."));
								UpdateFileList(currentPath);
							}else{
								//Php return error code
								ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
							}
							
                        },
                        error: function (data) {
                            ShowNotice("<i class='remove icon'></i> " + localize("filesystem/popups/somethingWentWrong","Something went wrong. Error Message:") + " <br>" + data.replace("ERROR.",""));
							uploading--;
                        }
                    });
	 });
	 
	 function htmlEncode(value){
	  return $('<div/>').text(value).html();
	}

	function htmlDecode(value){
	  return $('<div/>').html(value).text();
	}
	
	function hex2bin(s){
      var ret = []
      var i = 0
      var l
      s += ''
      for (l = s.length; i < l; i += 2) {
        var c = parseInt(s.substr(i, 1), 16)
        var k = parseInt(s.substr(i + 1, 1), 16)
        if (isNaN(c) || isNaN(k)) return false
        ret.push((c << 4) | k)
      }
    
      return String.fromCharCode.apply(String, ret)
    }
    
    function decode_utf8(s) {
		try {
			return decodeURIComponent(escape(s));
		} catch (ex) {
			return "false";
		}
      
    }

	function decodeHexFoldername(folderName){
	    var decodedFoldername = decode_utf8(hex2bin(folderName));
		if (decodedFoldername == "false"){
			//This is not a hex encoded foldername
			decodedFoldername = folderName;
		}else{
			//This is a hex encoded foldername
			decodedFoldername = decodedFoldername;
		}
		return decodedFoldername;
	}
    
    function hex2bin(s){
      var ret = []
      var i = 0
      var l
      s += ''
      for (l = s.length; i < l; i += 2) {
        var c = parseInt(s.substr(i, 1), 16)
        var k = parseInt(s.substr(i + 1, 1), 16)
        if (isNaN(c) || isNaN(k)) return false
        ret.push((c << 4) | k)
      }
    
      return String.fromCharCode.apply(String, ret)
    }
    
	function bin2hex(s){
		var i
		var l
		var o = ''
		var n

		s += ''

		for (i = 0, l = s.length; i < l; i++) {
			n = s.charCodeAt(i)
			.toString(16)
			o += n.length < 2 ? '0' + n : n
		}

		return o
	}

	/*
    function decode_utf8(s) {
      return decodeURIComponent(escape(s));
	}
	*/

	function decodeUmFilename(umfilename){
		if (umfilename.includes("inith")){
			var data = umfilename.split(".");
			if (data.length == 1){
				//This is a filename without extension
				data = data[0].replace("inith","");
				var decodedname = decode_utf8(hex2bin(data));
				if (decodedname != "false"){
					//This is a umfilename
					return decodedname;
				}else{
					//This is not a umfilename
					return umfilename;
				}
			}else{
				//This is a filename with extension
				var extension = data.pop();
				var filename = data[0];
				filename = filename.replace("inith",""); //Javascript replace only remove the first instances (i.e. the first inith in filename)
				var decodedname = decode_utf8(hex2bin(filename));
				if (decodedname != "false"){
					//This is a umfilename
					return decodedname + "." + extension;
				}else{
					//This is not a umfilename
					return umfilename;
				}
			}
			
		}else{
			//This is not umfilename as it doesn't have the inith prefix
			return umfilename;
		}
	}
	</script>
	<?php
	function getRelativePath($from, $to)
	{
		// some compatibility fixes for Windows paths
		$from = is_dir($from) ? rtrim($from, '\/') . '/' : $from;
		$to   = is_dir($to)   ? rtrim($to, '\/') . '/'   : $to;
		$from = str_replace('\\', '/', $from);
		$to   = str_replace('\\', '/', $to);

		$from     = explode('/', $from);
		$to       = explode('/', $to);
		$relPath  = $to;

		foreach($from as $depth => $dir) {
			// find first non-matching dir
			if($dir === $to[$depth]) {
				// ignore this directory
				array_shift($relPath);
			} else {
				// get number of remaining dirs to $from
				$remaining = count($from) - $depth;
				if($remaining > 1) {
					// add traversals up to first matching dir
					$padLength = (count($relPath) + $remaining - 1) * -1;
					$relPath = array_pad($relPath, $padLength, '..');
					break;
				} else {
					$relPath[0] = './' . $relPath[0];
				}
			}
		}
		return implode('/', $relPath);
	}
	
	
	
	?>
</body>
</html>