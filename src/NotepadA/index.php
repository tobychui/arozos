<?php
include '../auth.php';
?>
<!DOCTYPE html>
<meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
<html lang="en">
<head>
  <meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
	<script src="../script/ao_module.js"></script>
	<title>ArOZ Onlineβ</title>
	<style>
	body{
		background-color:#2b2b2b;
	}
	* {
      font-family: arial;
    }
	
	.topbar{
		background-color: #d6d6d6;
		overflow: hidden;
		position:fixed;
		top:0px;
		left:0;
		width:100%;height:25px;
		padding-left: 5px;
	}
	
	button{
		padding: 5;
		border: none;
		background: none;
		height:25px;
	}
	
	button:hover {
		background-color: #edeaea;
		cursor: pointer;
	}
	
	#codeArea{
		width:100%;
		position:fixed;
		top:48px;
		left:0px;
	}
	
	#tabs{
		background-color: #d6d6d6;
		position:fixed;
		width:100%;
		height:23px;
		top:25px;
		left:0px;
		overflow-x:auto;
	}
	
	.fileTab{
		background-color: #bcbcbc;
		display:inline;
		padding-left: 8px;
		padding-right: 1px;
		marign-left:1px;
		height:25px;
		border-bottom: 3px solid #878787;
		cursor: pointer;
	}
	
	.fileTab.focused{
		background-color: #edeaea;
		display:inline;
		border-bottom: 3px solid #5b4cff;
		cursor: pointer;
	}

	.closeBtn{
		display:inline;
	}
	
	.contextmenu{
		position:fixed;
		top:25px;
		left:0px;
		width:auto;
		height:auto;
		background-color:#d6d6d6;
		z-index:100;
		border-style: solid;
		border-width: 1px;
		border-color: #626263;
		font-size:small;
		max-height: 100%;
		overflow-y: auto;
	}
	
	.menuitem{
		padding-top: 2px;
		padding-bottom: 3px;
		padding-left: 25px;
		padding-right: 10px;
	}
	
	.menuitem:hover{
		background-color: #edeaea;
		cursor: pointer;
	}
	
	.middleFloat{
		position:fixed;
		top:10%;
		bottom: 10%;
		left: 30%;
		right: 30%;
		background-color:#efefef;
		padding:25px;
		overflow-y:auto;
	}
	
	.selectable{
	    cursor: pointer;
	    padding:1px;
	    padding-left:10px;
	    border: 1px solid transparent;
	}
	
	.selectable:hover{
	    background-color:#ffffff;
	    border: 1px solid #2890ff;
	}
	
	.scs{
		display:inline-block;
		margin: 3px;
		padding-left: 10px;
		padding-top: 10px;
		width: 20px !important;
		height:30px;
		border: 1px solid #c4c4c4;
		cursor:pointer;
		font-weight: bold;
	}
	.scs:hover{
		border: 1px solid #6e86a0;
		background-color:#a9c7e8;
	}
	.npalogo{
		background-color:#2b2b2b;
		color:white;
		padding:8px;
	}
	#tabList{
		position:fixed;
		right:0px;
		top:45px;
		min-width:100px;
		z-index:99;
		background-color:#d6d6d6;
		text-align:right;
		padding-bottom:5px;
		display:none;
	}
	#showList{
		position:absolute;
		top:0px;
		cursor:pointer;
		right:0px;
		padding:5px;
		margin-top:-2px;
		display:none;
	}
	#showList:hover{
		background-color:#ffffff;
	}
	</style>
</head>
<body>
<div class="topbar">
	<button onClick="startTooggleMenu(this);">File</button>
	<button onClick="startTooggleMenu(this);">Edit</button>
	<button onClick="startTooggleMenu(this);">Search</button>
	<button onClick="startTooggleMenu(this);">Utils</button>
	<button onClick="startTooggleMenu(this);">Theme</button>
	<button onClick="startTooggleMenu(this);">Font_Size</button>
	<button onClick="startTooggleMenu(this);">About</button>
</div>
<div id="tabs" onClick="hideToggleMenu();">
<div id="showList" onClick="showFullTabMenu();">⬇️ All Tabs</div>
</div>
<div id="tabList">
</div>
<div id="codeArea">

</div>
<div id="topbarMenu" class="contextmenu" style="display:none;">

</div>
<div id="aboutus" class="middleFloat" style="display:none;">
	<h3>📝 NotepadA ArOZ Online In-System Text Editor</h3>
	<p>Author: Toby Chui 2017-2019</p>
	<hr>
	<p>This web based text editor for ArOZ Online System are made possible by the ace editor, jQuery and ArOZ Project. Part of the system are licensed under BSD License or MIT license. Please refer to the individual license information under the library folder. <br><br>For the rest of the system and interface, all codes are CopyRight Toby Chui feat. IMUS Laboratory and licnesed under IMUS license (which is something similar to MIT license but with some extra licensing information about hardware). Developed under ArOZ Online System for experimental purpose.<br><br>
Visit <a href="https://github.com/tobychui">https://github.com/tobychui</a> for more information.</p>
	<hr>
	<p>MIT License<p>
	<p style="font-size:70%;">Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.</p>
	<p>BSD License<p>
	<p style="font-size:70%;">All rights reserved.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. All advertising materials mentioning features or use of this software
   must display the following acknowledgement:
   This product includes software developed by the <organization>.
4. Neither the name of the <organization> nor the
   names of its contributors may be used to endorse or promote products
   derived from this software without specific prior written permission.
THIS SOFTWARE IS PROVIDED BY <COPYRIGHT HOLDER> ''AS IS'' AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.</p>
	<hr>
	<button style="background-color:white;border: 1px solid #707070;" onClick="$('#aboutus').hide();">Close</button>
	<br><br><br><br><br>
</div>

<div id="saveAsSelectionMenu" class="middleFloat" style="display:none;">
    <table id="directoryList" style="width:100%;font-size:80%;">
        <tr><th id="directoryPath">📂 /</th></tr>
        <tr><td>Initializing...</td></tr>
    </table>
    <br>
    <hr>
    Save Filename
    <input id="saveAsFilename" style="width:100%;"></input>
    <hr>
    <button style="background-color:white;border: 1px solid #707070;" onClick="saveToDirectory();">Save In Current Directory</button>
    <button style="background-color:white;border: 1px solid #707070;" onClick="$('#saveAsSelectionMenu').hide();">Close</button>
   <br><br><br><br><br>
</div>

<div id="specialCharInsert" class="middleFloat" style="display:none;">
	Insert Special Character
	<hr>
	<br>
	<div id="iscl" style="max-height:70%;left:0;right:0;overflow-y:scroll;overflow-wrap: break-word;">
			
	</div>
	<hr>
	<button style="background-color:white;border: 1px solid #707070;" onClick="$('#specialCharInsert').hide();">Close</button><p style="font-size:50%;display:inline-block;padding-left:20px;" id="scid">N/A</p>
</div>
<?php
	$draginFilePath = "";
	if (isset($_GET['filepath'])){
		$rootRealPath = str_replace("\\","/",realpath("../")). "/";
		if (file_exists($_GET['filepath']) == false){
			$_GET['filepath'] = "../" . $_GET['filepath'];
		}
		$fileRealPath = str_replace("\\","/",realpath($_GET['filepath']));
		$draginFilePath = str_replace($rootRealPath,"",$fileRealPath);
		echo $_GET['filepath'];
	}
?>
<script>
//Global variables
var dragIn = "<?php echo $draginFilePath;?>";
var theme = 'github';
var isChrome = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
var is_safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
var isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox')
var lastSelectedMenuItem = "";
var username = loadStorage("ArOZusername");
var fontsize = 12;
var VDI = !(!parent.isFunctionBar);
var openedFilePath = [];
var previousSavedState = true;
var currentSaveAsPath = "";
var insertTarget;
var currentTabWidth = 0;
var functionList = {
	File: ["📄 New","📂 Open File","Run in FloatWindow","Open current directory","Reload","💾 Save","💾 Save As","Close All Tabs","🖨 Print","Exit"],
	Edit: ["⤺ Undo","⤻ Redo","Open in New Tab","Insert Special Characters"],
	Search:["Find / Replace"],
	Utils:["🗃 Open Cache folder","🎨 Color Picker","📱 Mobile Preview","📔 CSS Document","📘 System Icons"],
	Theme:["ambiance","chaos","chrome","clouds","clouds_midnight","cobalt","crimson_editor","dawn","dracula","dreamweaver","eclipse","github","gob","gruvbox","idle_fingers","iplastic","katzenmilch","kr_theme","kuroir","merbivore","merbivore_soft","mono_industrial","monokai","pastel_on_dark","solarized_dark","solarized_light","sqlserver","terminal","textmate","tomorrow","tomorrow_night","tomorrow_night_blue","tomorrow_night_bright","tomorrow_night_eighties","twilight","vibrant_ink","xcode"],
	Font_Size:["8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25"],
	About:["About NotepadA"]
};

//Init functions
adjustCodeAreaHeight();
bindListener();
initTheme();
initFontSize();
initNotepadA();
reloadAllTabs();
loadAllSpecialCharacter();

//Init notepadA. If there are previos stored page, load them into the environment. Or otherwise, just open a blank page.
function initNotepadA(){
	if (!ao_module_virtualDesktop){
		$(".topbar").prepend('<div class="npalogo" style="display:inline;"><a href="../index.php">◀️</a> | NotepadA</div>');
		$(".topbar").css("padding-left","0px");
	}
	
	ao_module_setGlassEffectMode()
	ao_module_setWindowIcon("code");
	//ao_module_setWindowSize(1080,600);
	if (loadStorage("NotepadA_" + username + "_sessionFiles") != ""){
		var pages = JSON.parse(loadStorage("NotepadA_" + username + "_sessionFiles"));
		for (var i =0; i < pages.length;i++){
			let page = pages[i];
			newEditor(page);
		}
		if (dragIn != ""){
			//If there is a file dragin, and it hasn't been opened, open it
			if (pages.indexOf(dragIn) == -1){
				newEditor(dragIn);
			}else{
				focusTab($($(".fileTab")[pages.indexOf(dragIn)]).attr("tabid"));
			}
			//alert(dragIn);
		}
	}else{
		if (dragIn != ""){
			//If there is a file dragin, open it as well.
			newEditor(dragIn);
		}else{
			newTab();
		}
	}
	setTimeout(function(){
		setInterval(function(){
			var tabid = getFocusedTab();
			if (tabid.length == 0){
				return;
			}
			var tab = findTabWithAttr("framematch",tabid[0]);
			var saved = checkTabSaved(tabid[0]);
			if (saved != previousSavedState){
				previousSavedState = saved;
				if (saved){
					ao_module_setWindowTitle("NotepadA   	 📝 " + tab.attr("filename").replace("../../","/aor/"));
					document.title = "NotepadA   	 📝 " + tab.attr("filename").replace("../../","/aor/");
				}else{
					ao_module_setWindowTitle("NotepadA   	 *💾 📝 " + tab.attr("filename").replace("../../","/aor/"));
					document.title = "NotepadA   	 *💾 📝 " + tab.attr("filename").replace("../../","/aor/");
				}
			}
			
			
		},1000);
	},500);
	
	toggleFileTabsList();
}

//Add a new editor window to the editor (?) -->ALL FILE PATH PASSED IN MUST BE FROM AOR OR /media/storage*
function newEditor(filepath){
    if (openedFilePath.includes(filepath)){
        //This page is already opened. Ignore this request and focus on the existing tab.
        $(".fileTab").each(function(){
            if ($(this).attr("filename").includes(filepath)){
                var tabid = $(this).attr("tabid");
                focusTab(tabid);
            }
        });
        return;
    }
	let tabid = Math.round((new Date()).getTime());
	var fileInternalIdentifier = "../../";
	if (filepath.substring(0,14) == "/media/storage"){
		//This file is stored in external stoarge path. Use real path instead.
		fileInternalIdentifier = "";
	}
	var tab = '<div class="fileTab" tabid="'+tabid+'" framematch="ca'+tabid+'" filename="' + fileInternalIdentifier + filepath +'">\
					loading... <div class="closeBtn">⨯</div>\
					</div>';
	var frame = '<div style="position:fixed;width:100%;"><iframe id="ca'+tabid+'" class="editor" src="ace/editor.php?theme='+theme+'&filename=../../'+filepath+'&fontsize=' + fontsize + '" width="100%" frameBorder="0"></iframe></div>';
	$("#tabs").append(tab);
	$("#codeArea").append(frame);
	updateFrameAttr('ca' + tabid);
	focusTab(tabid + "");
	if (openedFilePath.indexOf(filepath) == -1){
		openedFilePath.push(filepath);
	}
	setStorage("NotepadA_" + username + "_sessionFiles",JSON.stringify(openedFilePath));
}

function newTab(){
	let tabid = Math.round((new Date()).getTime());
	let filepath = 'NotepadA/tmp/newfile_' + tabid;
	var tab = '<div class="fileTab" tabid="'+tabid+'" framematch="ca'+tabid+'" filename="../../'+filepath+'">\
					loading... <div class="closeBtn">⨯</div>\
					</div>';
	var frame = '<div style=""><iframe id="ca'+tabid+'" class="editor" src="ace/editor.php?theme='+theme+'&filename=../../'+filepath+'&fontsize=' + fontsize + '" width="100%" frameBorder="0"></iframe></div>';
	$("#tabs").append(tab);
	$("#codeArea").append(frame);
	updateFrameAttr('ca' + tabid);
	setTimeout(function(){focusTab(tabid + "");},100);
	if (openedFilePath.indexOf(filepath) == -1){
		openedFilePath.push(filepath);
	}
	setStorage("NotepadA_" + username + "_sessionFiles",JSON.stringify(openedFilePath));
}

function saveToDirectory(){
    var targetPath = currentSaveAsPath;
    if (targetPath.includes("/media/storage") == false){
        //If it is not starting from the media root, stat with aor.
        //Remove the "/" at the front of the path
        targetPath = "../" + targetPath.substr(1);
    }
    var newfilename = $("#saveAsFilename").val();
    var framematch = getFocusedTab()[0];
    var editorContent = $("#" + framematch)[0].contentWindow.getEditorContenet();
    $.post( "writeCode.php", { filename: targetPath + newfilename, content: editorContent }).done(function( data ) {
        if (data.includes("ERROR") == false){
            //Finish writting to the new file. Open the new file in new tab
            if (targetPath.includes("/media/storage")==false && targetPath.includes("../")){
                targetPath = targetPath.replace("../","");
            }
            newEditor(targetPath + newfilename);
            $("#saveAsSelectionMenu").hide();
        }else{
            console.log(data);
        }
      });
}

function changeSaveAsPath(object){
    var newdir = $(object).attr("foldername");
    SetSaveAsPath(newdir);
}

function getSelectedText(){
    var id = getFocusedTab()[0];
    var text = $("#" + id)[0].contentWindow.getSelectedText();
    return text;
}

function insertText(text){
    var id = getFocusedTab()[0];
    var text = $("#" + id)[0].contentWindow.insertGivenText(text);
}

function saveToAOCC(){
   var content = getSelectedText();
   alert(content);
}

function SetSaveAsPath(dirpath){
     $("#directoryList").html("<tr><th>Loading...</th></tr>");
    if (dirpath == "../"){
       currentSaveAsPath = currentSaveAsPath.split("/")
       while (currentSaveAsPath.pop() == ""){
           ;
       }
       currentSaveAsPath = currentSaveAsPath.join("/") + "/";
        $.ajax({url: "getDir.php?directory=" + currentSaveAsPath, success: function(result){
            if (result.includes("ERROR") == false){
                //Update the current saveAs menu to latest directory
                $("#directoryList").html("<tr><th>📂 " + currentSaveAsPath + "</th></tr>");
                if (currentSaveAsPath != "/" && currentSaveAsPath != "/media/"){
                    $("#directoryList").append('<tr><td class="selectable" foldername="../" onClick="changeSaveAsPath(this);">⏎ ../</td></tr>');
                }
                for (var i = 0; i < result.length; i++){
					var decodedFilename = ao_module_codec.decodeHexFoldername(result[i][1]);
                     $("#directoryList").append('<tr><td class="selectable" foldername="'+result[i][1]+'"  onClick="changeSaveAsPath(this);"> 📂 '+decodedFilename+'</td></tr>');
                } 
                
            }else{
                console.log(result);
            }
        }});
    }else{
        currentSaveAsPath +=  dirpath + "/";
        $.ajax({url: "getDir.php?directory=" + currentSaveAsPath, success: function(result){
            if (result.includes("ERROR") == false){
                //Update the current saveAs menu to latest directory
                $("#directoryList").html("<tr><th>📂 " + currentSaveAsPath + "</th></tr>");
                if (currentSaveAsPath != "/" && currentSaveAsPath != "/media/"){
                    $("#directoryList").append('<tr><td class="selectable" foldername="../" onClick="changeSaveAsPath(this);">⏎ ../</td></tr>');
                }
                for (var i = 0; i < result.length; i++){
					var decodedFilename = ao_module_codec.decodeHexFoldername(result[i][1]);
                     $("#directoryList").append('<tr><td class="selectable" foldername="'+result[i][1]+'"  onClick="changeSaveAsPath(this);"> 📂 '+decodedFilename+'</td></tr>');
                } 
                
            }else{
                console.log(result);
            }
        }});
    }
}


function adjustCodeAreaHeight(){
	if (VDI){
		if (isFirefox){
			$("#tabs").css("top","22px").css("height","24px");
			$("#codeArea").css("top","45px")
		}
		if (isChrome){
			$("#tabs").css("top","22px").css("height","22px");
			$("#codeArea").css("top","42px");
		}
		if (is_safari){
			$("#tabs").css("top","22px").css("height","21px");
			$("#codeArea").css("top","41px");
		}
    	var h = window.innerHeight;
    	if (isChrome){
    	    h = h - 21;
		}else if (is_safari){
			h = h - 20;
    	}else{
    	    h = h - 24;
    	}
		$("#codeArea").css("height",h);
		$(".editor").each(function(i) {
			$(this).attr("height",h - 6);
		});
	}else{
		$(".editor").each(function(i) {
			$(this).css("height",$(document).height() - 38);
		});
	}
}

function checkTabSaved(framematch){
	if (typeof $("#" + framematch)[0].contentWindow.checkIsSaved !== "undefined") { 
		var result = $("#" + framematch)[0].contentWindow.checkIsSaved();
		return result;
	}
	
}

$( window ).resize(function() {
	adjustCodeAreaHeight();
	toggleFileTabsList();
});

function showFullTabMenu(){
	$("#tabList").slideToggle('fast');
}

var inList = false;
function toggleFileTabsList(){
	//Check if the width of the container is enough for holding all the filetabs. If no, move all of them into the filtab list.
	var totalWidthOfFileTabs = 0;
	var maxWidth = 0;
	$("#tabList").show();
	$(".fileTab").each(function(){
		totalWidthOfFileTabs = totalWidthOfFileTabs + $(this).width();
		if ($(this).width() > maxWidth){
			maxWidth = $(this).width();
		}
	});
	$("#tabList").hide();
	totalWidthOfFileTabs = parseInt(totalWidthOfFileTabs);
	if (window.innerWidth < totalWidthOfFileTabs && !inList){
		//window innerWidth space is less than the space needed to put all tabs. Move all of them into the list instead.
		$(".fileTab").each(function(){
			$("#tabList").append($(this));
			$("#tabList").append("<br>");
		});
		inList = true;
		$("#showList").show();
		$("#tabList").show();
	}else if (window.innerWidth > totalWidthOfFileTabs && inList){
		$(".fileTab").each(function(){
			$("#tabs").append($(this));
		});
		$("#tabList").html("");
		inList = false;
		$("#showList").hide();
		$("#tabList").hide();
	}
	currentTabWidth = totalWidthOfFileTabs;
}

function bindListener(){
	$(document).on('click', '.closeBtn', function () {
		removeTab($(this).parent().attr('tabid'));
	});

	$(document).on('click','.fileTab',function(){
		if ($(this).hasClass("closeBtn") == false){
			focusTab($(this).attr('tabid'));
		}
	});

	$(document).on('click','#codeArea',function(){
		$("#topbarMenu").hide();
	});
	
	$(document).on('click','.menuitem',function(){
		if (lastSelectedMenuItem == "Theme"){
			setTheme($(this).text());
			$("#topbarMenu").hide();
		}else if (lastSelectedMenuItem == "Font_Size"){
			setFontSize($(this).text());
			$("#topbarMenu").hide();
		}else if (lastSelectedMenuItem == "File"){
			handleFileMenu($(this).text());
			$("#topbarMenu").hide();
		}else if (lastSelectedMenuItem == "About"){
			handleAboutMenu($(this).text());
			$("#topbarMenu").hide();
		}else if (lastSelectedMenuItem == "Search"){
		    if ($(this).text() != ""){
		        launchFocusedTabSearchBox();
		    }
		    $("#topbarMenu").hide();
		}else if (lastSelectedMenuItem == "Edit"){
		    handleEditMenu($(this).text());
		    $("#topbarMenu").hide();
		}else if (lastSelectedMenuItem == "Utils"){
			 handleCacheMenu($(this).text());
		    $("#topbarMenu").hide();
		}else{
			alert(lastSelectedMenuItem);
		}
		
	});
	
}

function handleCacheMenu(itemText){
	var indexvalue = functionList.Utils.indexOf(itemText);
	switch (indexvalue){
		case 0:
			var url = "SystemAOB/functions/file_system/index.php?controlLv=2&finishing=embedded&subdir=NotepadA/tmp";
			if (!VDI){
				window.open("../" + url);
				break;
			}
			var uid = Math.round((new Date()).getTime() / 1000);
			var title = "NotepadA" + " - Cache View";
			var icon = "folder open";
			newfw(url,title,icon,uid,1080,580);
			break;
		case 1:
			var url = "NotepadA/utils/colorpicker/";
			var uid = "colorpicker";
			var title = "NotepadA" + " - Color Picker";
			var icon = "tint";
			newfw(url,title,icon,uid,360,196,undefined,undefined,false,true);
			break;
		case 2:
			var id = getFocusedTab()[0];
			var filepath = $("#" + id)[0].contentWindow.getFilepath().replace("../","");
			//Change the filepath relative from AOR to the preview script's relative path
			filepath = "../../../" + filepath;
			var url = "NotepadA/utils/mobipreview/index.php?preview=" + filepath;
			var uid = Math.round((new Date()).getTime() / 1000);
			var title = "NotepadA" + " - Mobile Preview";
			var icon = "mobile";
			newfw(url,title,icon,uid,335,550,undefined,undefined,true,true);
			break;
		case 3:
			//Open the CSS document in a new float window
			var url = "NotepadA/utils/tocasdoc/index.php";
			var uid = Math.round((new Date()).getTime() / 1000);
			var title = "NotepadA" + " - CSS LookUp";
			var icon = "css3";
			newfw(url,title,icon,uid,450,565,undefined,undefined,true,true);
			break;
		case 4:
			//Open the CSS document in a new float window
			var url = "NotepadA/utils/tocasdoc/icons.php";
			var uid = Math.round((new Date()).getTime() / 1000);
			var title = "NotepadA" + " - System Icon List";
			var icon = "bookmark";
			newfw(url,title,icon,uid,335,550,undefined,undefined,false,true);
			break;
	}
}

function handleEditMenu(itemText){
    var indexvalue = functionList.Edit.indexOf(itemText);
	switch (indexvalue){
		case 0:
			var id = getFocusedTab()[0];
			$("#" + id)[0].contentWindow.callUndo();
			break;
		case 1:
			var id = getFocusedTab()[0];
			$("#" + id)[0].contentWindow.callRedo();
			break;
	    case 2:
			var id = getFocusedTab()[0];
	        $("#" + id)[0].contentWindow.openInNewTab();
			//Call to openInNewTab function for opening new tab;
	        break;
	    case 3:
				//Insert a special character into the passage
				$("#specialCharInsert").show();
				var id = getFocusedTab()[0];
				insertTarget = $("#" + id)[0].contentWindow;
	        break;
	    
	}
    
}

function updateFrameAttr(framematch){
	//This function will update the tab title, iframe attr at the same time. 
	var frame = $("#" + framematch);
	var tab = findTabWithAttr("framematch",framematch);
	var filepath = tab.attr("filename");
	var filedata = getFilenameAndBasedir(filepath);
	var basedir = filedata[0];
	var filename = filedata[1];
	
	//Update the tag text to the filename
	if (filename.substring(0,5) == "inith"){
		filename = ao_module_codec.decodeUmFilename(filename);
	}
	$(tab).html(filename + ' <div class="closeBtn">⨯</div>');
	//Update the iframe attr
	$(frame).attr("basedir",basedir);
	$(frame).attr("filename",filename);
	//
	adjustCodeAreaHeight();
}

function getFilenameAndBasedir(filepath){
	var f = filepath.split("/").pop();
	var b = filepath.replace(f,"");
	return [b,f];
}

function reloadAllTabs(){
	$(".fileTab").each(function(){
		var tid = $(this).attr("tabid");
		reloadTab(tid + "");
		updateFrameAttr($(this).attr("framematch"));
	});
}

function reloadTab(tabID){
	var object = findTabWithAttr("tabid",tabID);
	var filename = $(object).attr("filename");
	var codeAreaID = $(object).attr("framematch");
	$("#" + codeAreaID).attr("src","ace/editor.php?theme=" + theme + "&fontsize="+fontsize+"&filename=" + filename);
}

function launchFocusedTabSearchBox(){
    var framematch = getFocusedTab()[0];
    $("#" +framematch)[0].contentWindow.startSearchBox();
    //alert(framematch);
}

function handleOpenFileFunctionCall(fileData){
	result = JSON.parse(fileData);
	result = result[0]; //As only one file will be selected each time
	var filepath = result.filepath;
	var filename = result.filename;
	var match = false;
	var tabid = "";
	$(".fileTab").each(function(){
		if ($(this).attr("filename") == filepath){
			match = true;
			tabid = $(this).attr("tabid");
		}
	});
	if (!match){
		//This file is not opened yet. Open it
		newEditor(filepath);
	}else{
		//This file is opened. Focus to that tab
		focusTab(tabid);
	}
	
}

function handleFileMenu(itemText){
	var indexvalue = functionList.File.indexOf(itemText);
	switch (indexvalue){
		case 0:
			//New file
			newTab();
			break;
		case 1:
			//Open a file by fileSelector
			var uid = new Date().getTime();
			if (VDI){
				ao_module_openFileSelector(uid,"handleOpenFileFunctionCall");
			}else{
				ao_module_openFileSelectorTab(uid,"../",true,"file",handleOpenFileFunctionCall);
			}
			break;
		case 2:
			//Run this script in floatWindow
			if (!VDI){
				alert("[ERROR] Please launch the NotepadA in Virtual Desktop Mode to launch FloatWindow.");
				break;
			}
			var id = getFocusedTab()[0];
			var uid = Math.round((new Date()).getTime() / 1000);
			var url = $("#" + id)[0].contentWindow.getFilepath().replace("../","");
			var title = "NotepadA Runtime";
			var icon = "code";
			if (url.substr(0,14) == "/media/storage"){
				title += " (External Storage)";
				url = "SystemAOB/functions/extDiskAccess.php?file=" + url;
				newfw(url,title,icon,uid,1080,580);
			}else{
				newfw(url,title,icon,uid,1080,580);
			}
			break;
		case 3:
			//Open the current folder in explorer
			var base = getFocusedTab()[1];
			if (base == undefined){
				break;
			}
			if (base.includes("../../")){
			    base = base.replace("../../","");
			}
			var url = "SystemAOB/functions/file_system/index.php?controlLv=2&finishing=embedded&subdir=" + base;
			if (base.substr(0,14) == "/media/storage"){
				//This file is located in external storage location. Open file editor in ext mode
				url = "SystemAOB/functions/file_system/index.php?controlLv=2&finishing=embedded&dir=" + base;
			}
			var uid = Math.round((new Date()).getTime() / 1000);
			var title = "NotepadA" + " - Folder View";
			var icon = "folder open";
			if (!VDI){
				window.open("../" + url);
				break;
			}
			newfw(url,title,icon,uid,1080,580);
			break;
		case 4:
			//Reload is pressed
			var currentFocusedtid = getFocusedTab()[0];
			if (currentFocusedtid == undefined){
				break;
			}
			var tabobject = findTabWithAttr("framematch",currentFocusedtid);
			reloadTab(tabobject.attr("tabid") + "");
			break;
		case 5:
			//Save is pressed
			var currentFocusedtid = getFocusedTab()[0];
			if (currentFocusedtid == undefined){
				break;
			}
			$("#" + currentFocusedtid)[0].contentWindow.Save();
			break;
		case 6:
		    //save-as is pressed. Pop up the saveas menu to continue
		    $("#saveAsSelectionMenu").show();
		    currentSaveAsPath = "";
		    SetSaveAsPath("");
		    var focusedFramematch = getFocusedTab()[0];
		    var filename =  $("#" + focusedFramematch).attr("filename");
		    var ext = filename.split(".").pop();
		    if (ext == filename){
		        ext = "txt";
		    }
		    setTimeout( function() {$("#saveAsSelectionMenu").scrollTop(0)}, 200 );
		    $("#saveAsFilename").val("untitled." + ext);
		    break;
		case 7:
			$(".fileTab").each(function(){
				removeTab($(this).attr("tabid"));
			});
			break;
		case 8:
			var id = getFocusedTab()[0];
			$("#" + id)[0].contentWindow.Print();
			break;
		case 9:
			if (VDI){
				window.location.href = "../SystemAOB/functions/killProcess.php"
			}else{
				window.location.href = "../index.php"
			}
			break;
	}
}

function handleAboutMenu(itemText){
	var indexvalue = functionList.About.indexOf(itemText);
	if (indexvalue == 0){
		$("#aboutus").show();
	}
}

function newfw(src,windowname,icon,uid,sizex,sizey,posx = undefined,posy = undefined,fixsize = undefined,tran = undefined){
	//Example
	//newEmbededWindow('Memo/index.php','Memo','sticky note outline','memoEmbedded',475,700);
	if (!VDI){
		window.open("../" + src);
		return;
	}
	parent.newEmbededWindow(src,windowname,icon,uid,sizex,sizey,posx,posy,fixsize,tran);
}

function getFocusedTab(){
	result = [];
	$(".fileTab").each(function(){
		if ($(this).hasClass("focused")){
			//This tab is focused. Check its filename and pathinfo
			var id = $(this).attr("framematch");
			var filename = $("#" + id).attr("filename");
			var basedir = $("#" + id).attr("basedir");
			result = [id,basedir,filename];
		}
	});
	return result;
}

function setTheme(themeName){
	setStorage("NotepadA_theme",themeName);
	theme = themeName;
	
	if (checkIfAllTabSaved() == false){
		//Ask the user if confirm close
		var confirmClose = confirm("Reloading NotepadA is required to apply the changes. Confirm?");
		if (confirmClose == false){
			return false;
		}
	}
	console.log("Updating theme to: " + themeName);
	//Reload all tabs with the corrispoding themes after changing theme settings
	reloadAllTabs();
}

function setFontSize(newsize){
	setStorage("NotepadA_fontsize",newsize);
	fontsize = newsize;

	if (checkIfAllTabSaved() == false){
		//Ask the user if confirm close
		var confirmClose = confirm("Reloading NotepadA is required to apply the changes. Confirm?");
		if (confirmClose == false){
			return false;
		}
	}
	reloadAllTabs();
}

function checkIfAllTabSaved(){
	var allSaved = true;
	$(".editor").each(function(){
		if ($(this)[0].contentWindow.checkIsSaved() == false){
			allSaved = false;
		}
	});
	return allSaved;
}


function initTheme(){
	if (loadStorage("NotepadA_theme") != ""){
		theme = loadStorage("NotepadA_theme");
	}
}

function initFontSize(){
	if (loadStorage("NotepadA_fontsize") != ""){
		fontsize = loadStorage("NotepadA_fontsize");
	}
}

function setStorage(configName,configValue){
	//localStorage.setItem(name, value);
	$.ajax({
	  type: 'POST',
	  url: "../SystemAOB/functions/user/userGlobalConfig.php",
	  data: {module: "NotepadA",name:configName,value:configValue},
	  success: function(data){},
	  async:true
	});
	return true;
}

function loadStorage(configName){
	/* if (localStorage.getItem(name) == null){
		return "";
	}else{
		return localStorage.getItem(name);
	} */
	var result = "";
	$.ajax({
	  type: 'POST',
	  url: "../SystemAOB/functions/user/userGlobalConfig.php",
	  data: {module: "NotepadA",name:configName},
	  success: function(data){result = data;},
	  error: function(data){result = "";},
	  async:false,
	  timeout: 3000
	});
	return result;
}

function removeTab(tabid){
	var focusingTabFramematchBeforeRemove = getFocusedTab()[0];
	let origianlTabID = findTabWithAttr("framematch",focusingTabFramematchBeforeRemove).attr("tabid");
	var targetTab = findTabWithAttr("tabid",tabid);
	var filepath = targetTab.attr("filename").replace("../../","");
	var codeAreaTag = $(targetTab).attr("framematch");
	//Check if the tab is saved
	var saved = checkTabSaved(targetTab.attr("framematch"));
	if (saved == false){
		//Ask the user if confirm close
		var confirmClose = confirm("This file is not saved. Confirm closing?");
		if (confirmClose == false){
			return false;
		}
	}
	//Remove this record from the filepath so we will not open this again by the enxt time we startup NotepadA
	openedFilePath.remove(filepath);
	if ($(targetTab).hasClass("focused")){
		//This tab is currently focused, move focus to another tab after closing
		$(targetTab).remove();
		//I have no idea why this only works with a delay... but just don't change this.
		setTimeout(function(){
			var focusTarget = $(".fileTab").first().attr("tabid");
			focusTab(focusTarget); }, 100);
	}else{
		$(targetTab).remove();
		setTimeout(function(){ focusTab(origianlTabID);}, 100);
	}
	$("#" + codeAreaTag).remove();
	if ($(".fileTab").length == 0){
		//There is no more tab left, create a new tab instead
		setTimeout(function(){ newTab("untitled"); }, 100);
	}
	setStorage("NotepadA_" + username + "_sessionFiles",JSON.stringify(openedFilePath));
	toggleFileTabsList();
}

function hideToggleMenu(){
	$("#topbarMenu").hide();
}

$(".scs").hover(function(){
	var keyid = $(this).attr("keyid");
	$("#scid").html("HTML Keycode: #&" + keyid);
});

$(".scs").on("mousedown",function(){
	insertTarget.insertChar($(this).text());
	$("#specialCharInsert").hide();
});

function startTooggleMenu(object){
	var menu = $(object).text();
	var pos = $(object).offset().left - 5;
	toogleMenu(pos,menu);
}

function toogleMenu(left,contentID){
	$("#topbarMenu").css("left",left + "px");
	if (contentID != lastSelectedMenuItem && $("#topbarMenu").is(":visible")){
		$("#topbarMenu").hide();
	}
	loadOptionToMenu(contentID);
	$("#topbarMenu").toggle();
	lastSelectedMenuItem = contentID;
}

function loadOptionToMenu(menuItem){
	var items = functionList[menuItem];
	$("#topbarMenu").html("");
	for (var i=0; i < items.length;i++){
		$("#topbarMenu").append("<div class='menuitem'>" + items[i] + "</div>");
	}
}

function focusTab(tabid){
	//Defocus every tabs and hide all coding windows
	$(".fileTab").each(function(i) {
		$(this).removeClass("focused");
	});
	$(".editor").each(function(i) {
		$(this).hide();
	});
	//Only show the tab and code window selected
	var selectedTab = findTabWithAttr("tabid",tabid);
	$(selectedTab).addClass("focused");
	var corrispondingCodingTab = $(selectedTab).attr("framematch");
	var targetFrame = $("#" + corrispondingCodingTab);
	targetFrame.show();
	if (selectedTab.attr("filename") != undefined){
		ao_module_setWindowTitle("NotepadA   	 📝 " + selectedTab.attr("filename").replace("../../","/aor/"));
		document.title = "NotepadA   	 📝 " + selectedTab.attr("filename").replace("../../","/aor/");
	}else{
		ao_module_setWindowTitle("NotepadA   	 📝 newfile");
		document.title = "NotepadA   	 📝 newfile";
	}
	
}

function findTabWithAttr(attr,value){
	return $('div['+attr+'="'+value+'"]').each(function() {
		return this;
	});
}

function loadAllSpecialCharacter(){
	$("#iscl").html("");
	for (var i =161; i < 1023; i++){
		if (i != 173){
			$("#iscl").append("<div class='scs' keyid='" + i +"'>" + String.fromCharCode(i) + "</div>");
		}
		
	}
}

Array.prototype.remove = function() {
    var what, a = arguments, L = a.length, ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};


</script>
</body>
</html>



    

