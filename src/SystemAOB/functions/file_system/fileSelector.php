<?php
include_once '../../../auth.php';
?>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.8, maximum-scale=0.8"/>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>File Selector</title>
    <link rel="stylesheet" href="../../../script/tocas/tocas.css">
	<script src="../../../script/tocas/tocas.js"></script>
	<script src="../../../script/jquery.min.js"></script>
	<script src="../../../script/ao_module.js"></script>
	<style>
	.item {
		cursor: pointer;
	}
	body{
	    background-color:#f0f0f0;
	}
	
	.topbar{
	    position:fixed !important;
	    left:0px !important;
	    top:-13px !important;
	    width:100%;
	    z-index:99;
	}
	
	.dirbar{
	    width:80%;
	    display:inline;
	}
	
	.dirbarHorizon{
	    width:100% !important;
	    padding-top:10px !important;
	}
	
	.sidebar{
	    border-right: 1px solid #d6d6d6;
	    padding-left:30px !important;
	    padding-right:15px !important;
	    background-color:white;
	    padding-top:20px !important;
	    min-height:300px;
	}
	
	.selectable{
	    padding:5px !important;
	    padding-left:12px !important;
	    border: 1px solid transparent !important;
	    white-space: nowrap !important;
		text-overflow: ellipsis;
		overflow: hidden; 
	}
	
	.selectable:hover{
	    border: 1px solid #aab7fa !important;
	    background-color:#d6ddff !important;
	}
	
	.fileListMenu{
	    padding-right:20px !important; 
	}
	
	.selected{
	    background-color:#c2cdff !important;
	    white-space: normal !important;
		text-overflow:initial;
		overflow: visible;
	}
	.dimmer{
		height:100% !important;
		position:fixed !important;
		left:0px !important;
		top:0px !important;
		z-index:99 !important;
	}
	</style>
</head>
<body>
<?php
$allowMultiple = "false";
$selectMode = "file"; //Allow file, folder or mix (both file and folder)
$defaultFilename = "newfile.txt";
$useUMF = "false";
if (isset($_GET['allowMultiple']) && $_GET['allowMultiple'] == "true" ){
    $allowMultiple = "true";
}

if (isset($_GET['selectMode']) && $_GET['selectMode'] != "" ){
    if (in_array($_GET['selectMode'],["file","folder","mix","new"])){
        $selectMode = $_GET['selectMode'];
    }else{
        die("ERROR. Not supported selectMode. Only allow 'file', 'folder' or 'mix' mode");
    }
}

if (isset($_GET['newfn']) && !empty($_GET['newfn'])){
    $defaultFilename = strip_tags($_GET['newfn']);
}

if (isset($_GET['useUMF']) && $_GET['useUMF'] == "true"){
    $useUMF = "true";
}

if (isset($_GET['puid']) && $_GET['puid'] != ""){
    $parentUID = $_GET['puid'];
}

if ($selectMode == "new"){
    //You can only create one new file at a time.
    $allowMultiple = "false";
}
?>
<div style="display:none;">
    <div id="allowMultiple"><?php echo $allowMultiple;?></div>
    <div id="selectMode"><?php echo $selectMode;?></div>
    <div id="parentUID"><?php echo $parentUID;?></div>
    <div id="defaultFilename"><?php echo $defaultFilename;?></div>
    <div id="useUMF"><?php echo $useUMF;?></div>
</div>
<div id="topMenubar" class="ts fluid raised segment topbar">
    <button class="ts tiny icon button" onClick="back();"><i class="arrow left icon"></i></button>
    <button class="ts tiny icon button" onClick="exitLayer();"><i class="arrow up icon"></i></button>
    <button class="ts tiny icon button" onClick="refresh();"><i class="refresh icon"></i></button>
    <div class="dirbar" style="display:inline-block;vertical-align:top;">
        <div id="pathbar" class="ts tiny action fluid input" >
            <input type="text" id="pathcontent" style="width:100%;" placeholder="Current Directory" readonly="readonly">
            <button class="ts icon positive button" onClick="confirmSelections();" ><i class="checkmark icon"></i></button>
        </div>
        <div id="fnameinput" class="ts left icon action tiny fluid input" style="margin-top:5px; display:none;">
            <input id="newfilename" type="text" placeholder="New Filename" style="width:100%;">
            <i class="file icon"></i>
            <button class="ts icon button" onClick="changeFMode();" ><i class="exchange icon"></i></button>
        </div>
    </div>
</div>
<div id="content" class="ts fluid stackable grid padded">
    <div class="four wide column sidebar">
        <p id="fsd">Laoding file selection description...</p>
        <p id="sfc">Selected file / folder: 0</p>
        <p>Directories Shortcuts</p>
        <div id="shortcutList" class="ts list">
            <a class="item" onClick="gotopath('AOR');">
                <i class="home icon"></i>
                <div class="content">
                    <div class="header">AOR</div>
                </div>
            </a>
            <a class="item" onClick="gotopath('Desktop');">
                <i class="desktop icon"></i>
                <div class="content">
                    <div class="header">Desktop</div>
                </div>
            </a>
            <?php
            if (file_exists("/media/") == true){
                echo '<a class="item" onClick="gotopath(' . "'" . 'ES' . "'" . ');">
                <i class="disk outline icon"></i>
                <div class="content">
                    <div class="header">External Storage</div>
                </div>
            </a>';
            }
            ?>
            
        </div>
    </div>
    <div id="fileList" class="twelve wide column fileListMenu">
        <div id="" class="ts list">
            <div class="selectable item">
                <i class="loading spinner icon"></i>
                <div class="content">
                    <div class="header">Loading...</div>
                </div>
            </div>
        </div>
        <br><br>
    </div>
    
</div>
<div id="dimmer" class="ts active dimmer" style="display:none;">
	<div id="dimmerText" class="ts text loader">Processing...</div>
</div>
 <script>
    var currentPath = "../../../";
    var backStack = [];
    var allowMultiple = $("#allowMultiple").text().trim();
    var selectMode = $("#selectMode").text().trim();
    var puid = $("#parentUID").text().trim();
    var defaultFilename = $("#defaultFilename").text().trim();
    var useUMF = $("#useUMF").text().trim() == "true";
    var selectionConfirmed = false;
	var shortcuts = [];
	
	//Initialize the shortcut sidebar
	$.get("getFileShortcuts.php",function(data){
		shortcuts = data;
		for (var i =0; i < shortcuts.length; i++){
			if (shortcuts[i][0] == "foldershrct"){
				$("#shortcutList").append('<a class="item" openPath="' + shortcuts[i][2] + '" onClick="gotoShortcut(this);">\
					<i class="' + shortcuts[i][3] + '"></i>\
					<div class="content">\
						<div class="header">' + shortcuts[i][1] +'</div>\
					</div>\
				</a>');
			}
			
		}
	});
	
     $(document).ready(function(){
         listDir(currentPath);
         if (allowMultiple == "true"){
             allowMultiple = true;
         }
         initDescription();
         resizeDirBar();
     });
     
     function changeFMode(){
         useUMF = !useUMF;
         if (useUMF){
             $("#newfilename").css("background-color","rgb(216, 240, 255)");
         }else{
             $("#newfilename").css("background-color","");
             var safeFilename = $("#newfilename").val().replace(/[^a-zA-Z0-9._]/gi, '_')
             $("#newfilename").val(safeFilename);
         }
     }
	 
	 function gotoShortcut(object){
		 var openTarget = $(object).attr("openPath");
		 backStack.push(currentPath);
         currentPath = "../../..//" + openTarget;
         listDir(currentPath);
	 }
     
     function enterFolder(object){
         backStack.push(currentPath);
         var path = $(object).attr("filepath");
         path = baseName(path);
         currentPath = currentPath + "/" + path;
         listDir(currentPath);
     }
     
     function back(){
         if (backStack.length > 0){
             currentPath = backStack.pop();
             listDir(currentPath);
         }else{
             //No more things to go back
         }
    
     }
     
     function initDescription(){
         var text = "Select file to open.";
         if (selectMode == "file"){
             if (allowMultiple == true){
                 text = "Select multiple files to open.";
             }else{
                 text = "Select only one file from the list below.";
             }
         }else if (selectMode == "folder"){
             if (allowMultiple == true){
                 text = "Select multiple folders to open.";
             }else{
                 text = "Select only one folder from the list below.";
             }
         }else if (selectMode == "new"){
             text = "Select the target to create a new file";
             $("#newfilename").val(defaultFilename);
             $("#fnameinput").show();
             if (useUMF){
                 $("#newfilename").css("background-color","rgb(216, 240, 255)");
             }
         }else{
             if (allowMultiple == true){
                 text = "Select multiple files / folders.";
             }else{
                 text = "Select only one file or folder.";
             }
         }
         $("#fsd").text(text);
         
     }
     
     function confirmSelections(){
         var selectedFiles = [];
         $(".selected").each(function(){
             var filepathData = $(this).attr('filepath');
             var filenameData = $(this).text().trim();
             var fileObject = {filepath: filepathData, filename: filenameData};
             selectedFiles.push(fileObject);
         });
         
         //To handle special case of selecting under folder mode and the user entered the select folder and select nothing inside it 
         //(i.e. the current folder that user is in is the file that they want to select)
         if (selectedFiles.length == 0 && selectMode == "folder"){
            var filepathData = $("#pathcontent").val().trim().replace("/AOR/","").replace("/AOR","");
            var filenameData = baseName(filepathData);
            var fileObject = {filepath: filepathData, filename: filenameData};
            selectedFiles.push(fileObject);
         }
         
         //Handle new file request
         if (selectMode == "new"){
             var saveFilename = $("#newfilename").val();
             if (useUMF){
                 saveFilename = ao_module_codec.encodeUMFilename(saveFilename);
             }
             var filepathData = $("#pathcontent").val().trim().replace("/AOR/","").replace("/AOR","") + "/" + saveFilename;
             var filenameData = $("#newfilename").val();
             var fileObject = {filepath: filepathData, filename: filenameData};
             selectedFiles.push(fileObject);
         }
         
         if (ao_module_virtualDesktop){
             //If the selector is in VDI mode, callback using cross iFrame pipeline
             var returnvalue = ao_module_parentCallback(selectedFiles);
             if (returnvalue == false){
                 console.log("%c[File Selector] ERROR. Something wrong happened during sending selected file to parent. Are you sure the parent is alive?",'color: #ff4a4a');
             }else{
                 console.log("%c[File Selector] File Selected. Closing file selector...",'background: #f2f2f2; color: #363636');
                 ao_module_close();
                 selectionConfirmed = true;
             }             
         }else{
             //If the selector is not in VDI mode, callback using tmp variable in localStorage
             ao_module_writeTmp(puid,selectedFiles);
             selectionConfirmed = true;
			 $("#dimmer").show();
			 setTimeout(timeOutWarning,10000);
         }

     }
	 
	 function timeOutWarning(){
		 $("#dimmerText").html("<i class='remove icon'></i>Error. Parent window has no response. Please retry later.");
	 }
     function refresh(){
         listDir(currentPath);
     }
     
     function exitLayer(){
         if (currentPath != "../../../" && currentPath != "/media"){
             currentPath = currentPath.split("/");
             currentPath.pop();
             currentPath = currentPath.join("/");
             listDir(currentPath);
         }
         
     }
     
     function resizeDirBar(){
        if ($(window).width() < 650){
             $("#pathbar").parent().removeClass("dirbar");
             $("#pathbar").parent().addClass("dirbarHorizon");
             $("#content").css("padding-top",(parseInt($("#topMenubar").css("height").replace("px","")) + 12) + "px", 'important');
         }else{
             $("#pathbar").parent().removeClass("dirbarHorizon");
             $("#pathbar").parent().addClass("dirbar");
             $("#content").css("padding-top",(parseInt($("#topMenubar").css("height").replace("px","")) + 12) + "px", 'important');
         }
         
     }
     $(window).on("resize",function(){
         resizeDirBar();
     });
     
    function displayReturnedData(data){
        var folders = data[0];
        var files = data[1];
        $("#fileList").html("");
        for (var i = 0; i < folders.length; i++){
            var filename = baseName(folders[i]);
            appendFolderToList(filename,folders[i]);
        }
        for (var i = 0; i < files.length; i++){
            var filename = baseName(files[i]);
            appendFileToList(filename,files[i]);
        }
        
        
        $(".item.selectable").each(function(){
            let filepath = $(this).attr("filepath");
            let filename = $(this).text().trim();
            let filetype = $(this).attr("type");
            if (filetype == "file" && filename.substring(0,5) == "inith"){
                //This might be a um-encoded filename
                /*
                //Deprecated on 3-4-2019, replaced with Javascript decoding
                $.get( "um_filename_decoder.php?filename=" + filename, function( data ) {
                    if (filename != data){
                        replaceFilenameWithDecodedFilename(filepath,data);
                    }
                });
                */
                var decodedFilename = ao_module_codec.decodeUmFilename(filename);
                if (filename != decodedFilename){
                        replaceFilenameWithDecodedFilename(filepath,decodedFilename);
                }
            }else if (filetype == "folder"){
                 /*
                //Deprecated on 3-4-2019, replaced with Javascript decoding
                $.get( "hex_foldername_decoder.php?dir=" + filename, function( data ) {
                    if (filename != data){
                        replaceFoldernameWithDecodedFoldername(filepath,data);
                    }
                });
                */
                var decodedFoldername = ao_module_codec.decodeHexFoldername(filename);
                 if (filename != decodedFoldername){
                    replaceFoldernameWithDecodedFoldername(filepath,decodedFoldername);
                }
            }
            
        });
    }
    
    function replaceFoldernameWithDecodedFoldername(filepath,decodedName){
        $(".item.selectable").each(function(){
            if ($(this).attr("filepath") == filepath){
                $(this).css("background-color","rgb(202, 249, 209)");
                $(this).attr("fmode","hex")
                $(this).find(".header").text(decodedName);
                return;
            }
        });
    }
    
    function replaceFilenameWithDecodedFilename(filepath,decodedName){
        $(".item.selectable").each(function(){
            if ($(this).attr("filepath") == filepath){
                $(this).css("background-color","rgb(216, 240, 255)");
                $(this).attr("fmode","um")
                $(this).find(".header").text(decodedName);
                return;
            }
        });
    }
    
    function selectItem(object){
        if (selectMode == "file"){
            if ($(object).attr("type") == "file"){
                if (allowMultiple == true){
                    if ($(object).hasClass("selected")){
                        $(object).removeClass("selected");
                    }else{
                        $(object).addClass("selected");
                    }
                }else{
                    $(".selected").each(function(){
                        $(this).removeClass("selected");
                    });
                    $(object).addClass("selected");
                }
            }
        }else if (selectMode == "folder"){
            if ($(object).attr("type") == "folder"){
                if (allowMultiple == true){
                    if ($(object).hasClass("selected")){
                        $(object).removeClass("selected");
                    }else{
                        $(object).addClass("selected");
                    }
                }else{
                    $(".selected").each(function(){
                        $(this).removeClass("selected");
                    });
                    $(object).addClass("selected");
                }
            }
        }else if (selectMode == "new"){
            //Copy the filename to the newfilename input
            if ($(object).attr("type") == "file"){
                 $(".selected").each(function(){
                    $(this).removeClass("selected");
                });
                $(object).addClass("selected");
                //Move this to the newfile input
                $("#newfilename").val($(object).text().trim());
                if ($(object).attr('fmode') != "default" && useUMF == false){
                    //This file is not default encoded file. Force use UMF mode
                    changeFMode();
                }
            }
        }else{
             if (allowMultiple == true){
                if ($(object).hasClass("selected")){
                    $(object).removeClass("selected");
                }else{
                    $(object).addClass("selected");
                }
            }else{
                $(".selected").each(function(){
                    $(this).removeClass("selected");
                });
                $(object).addClass("selected");
            }
        }
       
        //Update selected file count
        $("#sfc").text("Selected file / folder: " + $(".selected").length);
        
        
    }
    
    function resetSelectedItem(){
         $("#sfc").text("Selected file / folder: 0");
    }
    
    function getUserName(){
        return localStorage.getItem("ArOZusername");
    }
    
    function gotopath(value){
        backStack.push(currentPath);
        if (value == "AOR"){
            currentPath = "../../../";
        }else if (value == "Desktop"){
            currentPath = "../../..//Desktop/files/" + getUserName();
        }else if (value == "ES"){
            currentPath = "/media"
        }
        listDir(currentPath);
    }
    
    function appendFolderToList(filename,filepath){
        if (filepath.includes("//")){
            filepath = filepath.split("//").join("/");
        }
        filepath = filepath.replace("../../../","");
        var template = '<div class="item selectable" onClick="selectItem(this);" fmode="default" ondblClick="enterFolder(this);" filepath="' + filepath + '" type="folder">\
                <i class="folder icon"></i>\
                <div class="content" style="display:inline;">\
                    <div class="header" style="display:inline;">' + filename.trim() + '</div>\
                </div>\
            </div>';
        $("#fileList").append(template);
        
    }
    
    function appendFileToList(filename,filepath){
        if (filepath.includes("//")){
            filepath = filepath.split("//").join("/");
        }
        filepath = filepath.replace("../../../","");
        var ext = filename.split(".").pop();
        var icon = ao_module_utils.getIconFromExt(ext);
        var template = '<div class="item selectable" onClick="selectItem(this);" fmode="default" ondblClick="dblclickSelect(this);" filepath="' + filepath + '" type="file">\
                <i class="' + icon +' icon"></i>\
                <div class="content" style="display:inline;">\
                    <div class="header" style="display:inline;">' + filename.trim() + '</div>\
                </div>\
            </div>';
        $("#fileList").append(template);
        
    }
	
	function dblclickSelect(object){
		 if (selectMode == "file"){
			 //Only files are allowed for double click selection
			 $(object).addClass("selected");
			 confirmSelections();
		 }
	}
    
    function baseName(filepath){
        return filepath.split("/").pop();
    }
    
    function listDir(filepath){
        resetSelectedItem();
        $("#fileList").html('<div id="" class="ts list">\
            <div class="selectable item">\
                <i class="loading spinner icon"></i>\
                <div class="content">\
                    <div class="header">Loading...</div>\
                </div>\
            </div>\
        </div>');
        $("#pathcontent").val(filepath.replace("../../../","/AOR"))
        var result;
        $.ajax({
            type: "GET",
            url: 'listdir.php?dir=' + filepath,
            success: function(data) {
                displayReturnedData(data);
            },
            error: function() {
                console.log('Error when listing directory');
            }
        });
    }
     
     if (selectMode == "folder"){
         ao_module_setWindowIcon("folder open outline");
         ao_module_setWindowTitle("Open Folder");
     }else if (selectMode == "new"){
         ao_module_setWindowIcon("add");
         ao_module_setWindowTitle("New File");
     }else{
         ao_module_setWindowIcon("file outline");
         ao_module_setWindowTitle("Open File");
     }
     ao_module_setGlassEffectMode();
     
     window.onbeforeunload = function(){
       //On before unload
       if (ao_module_virtualDesktop == false && selectionConfirmed == false){
           //As there are module waiting for returned data, if the user try to close this page without selection, the return tmp variable will also be set to an empty array.
           ao_module_writeTmp(puid,[]);
       }
    }

 </script>
</body>
</html>