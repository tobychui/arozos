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
	* {
      font-family: arial;
    }
	
	.topbar{
		background-color: #d6d6d6;
		overflow: hidden;
		position:fixed;
		top:0;left:0;
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
		top:50px;
		left:0px;
	}
	
	#tabs{
		background-color: #d6d6d6;
		position:fixed;
		width:100%;
		height:25px;
		top:25px;
		left:0px;
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
	
	</style>
</head>
<body>
<div class="topbar">
	<button onClick="startTooggleMenu(this);">File</button>
	<button onClick="startTooggleMenu(this);">Edit</button>
	<button onClick="startTooggleMenu(this);">Search</button>
	<button onClick="startTooggleMenu(this);">View</button>
	<button onClick="startTooggleMenu(this);">Theme</button>
	<button onClick="startTooggleMenu(this);">Font_Size</button>
	<button onClick="startTooggleMenu(this);">About</button>
</div>
<div id="tabs" onClick="hideToggleMenu();">

</div>
<div id="codeArea">

</div>
<div id="topbarMenu" class="contextmenu" style="display:none;">

</div>
<div id="aboutus" class="middleFloat" style="display:none;">
	<h3>📝 NotepadA ArOZ Online In-System Text Editor</h3>
	<p>Author: Toby Chui 2017-2018</p>
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
var lastSelectedMenuItem = "";
var username = loadStorage("ArOZusername");
var fontsize = 12;
var VDI = !(!parent.isFunctionBar);
var openedFilePath = [];
var previousSavedState = true;
var functionList = {
	File: ["New","Open file","Open current directory","Reload","Save","Save As","Close All Files","Print","Exit"],
	Edit: [],
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

//Init notepadA. If there are previos stored page, load them into the environment. Or otherwise, just open a blank page.
function initNotepadA(){
	ao_module_setGlassEffectMode()
	ao_module_setWindowIcon("code");
	ao_module_setWindowSize(1080,600);
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
					ao_module_setWindowTitle("NotepadA &#8195; 	 📝 " + tab.attr("filename").replace("../../","/aor/"));
				}else{
					ao_module_setWindowTitle("NotepadA &#8195; 	 *💾 📝 " + tab.attr("filename").replace("../../","/aor/"));
				}
			}
			
			
		},1000);
	},500);
}

//Add a new editor window to the editor (?) -->ALL FILE PATH PASSED IN MUST BE FROM AOR OR /media/storage*
function newEditor(filepath){
	let tabid = Math.round((new Date()).getTime());
	var tab = '<div class="fileTab" tabid="'+tabid+'" framematch="ca'+tabid+'" filename="../../' + filepath +'">\
					loading... <div class="closeBtn">⨯</div>\
					</div>';
	var frame = '<iframe id="ca'+tabid+'" class="editor" src="ace/editor.php?theme='+theme+'&filename=../../'+filepath+'&fontsize=' + fontsize + '" width="100%" frameBorder="0"></iframe>';
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
	var frame = '<iframe id="ca'+tabid+'" class="editor" src="ace/editor.php?theme='+theme+'&filename=../../'+filepath+'&fontsize=' + fontsize + '" width="100%" frameBorder="0"></iframe>';
	$("#tabs").append(tab);
	$("#codeArea").append(frame);
	updateFrameAttr('ca' + tabid);
	setTimeout(function(){focusTab(tabid + "");},100);
	if (openedFilePath.indexOf(filepath) == -1){
		openedFilePath.push(filepath);
	}
	setStorage("NotepadA_" + username + "_sessionFiles",JSON.stringify(openedFilePath));
}

function adjustCodeAreaHeight(){
	if (VDI){
	var h = window.innerHeight;
		$("#codeArea").css("height",h - 50);
		$(".editor").each(function(i) {
			$(this).attr("height",h-50);
		});
	}else{
		$(".editor").each(function(i) {
			$(this).css("height",$(document).height());
		});
	}
}

function checkTabSaved(framematch){
	var result = $("#" + framematch)[0].contentWindow.checkIsSaved();
	return result;
}

$( window ).resize(function() {
	adjustCodeAreaHeight();
});

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
		}else{
			alert(lastSelectedMenuItem);
		}
		
	});
	
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

function handleFileMenu(itemText){
	var indexvalue = functionList.File.indexOf(itemText);
	switch (indexvalue){
		case 0:
			//nothing
			break;
			
		case 2:
			//Open the current folder in explorer
			var base = getFocusedTab()[1];
			if (base == undefined){
				break;
			}
			var uid = Math.round((new Date()).getTime() / 1000);
			var url = "SystemAOB/functions/file_system/index.php?controlLv=2&finishing=embedded&subdir=" + base;
			var title = "NotepadA" + " - Folder View";
			var icon = "folder open";
			newfw(url,title,icon,uid,1080,580);
			break;
		case 3:
			//Reload is pressed
			var currentFocusedtid = getFocusedTab()[0];
			if (currentFocusedtid == undefined){
				break;
			}
			var tabobject = findTabWithAttr("framematch",currentFocusedtid);
			reloadTab(tabobject.attr("tabid") + "");
			break;
		case 4:
			//Save is pressed
			var currentFocusedtid = getFocusedTab()[0];
			if (currentFocusedtid == undefined){
				break;
			}
			$("#" + currentFocusedtid)[0].contentWindow.Save();
			break;
		case 7:
			var id = getFocusedTab()[0];
			$("#" + id)[0].contentWindow.Print();
			break;
		case 8:
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
	console.log("Updating theme to: " + themeName);
	//Reload all tabs with the corrispoding themes after changing theme settings
	reloadAllTabs();
}

function setFontSize(newsize){
	setStorage("NotepadA_fontsize",newsize);
	fontsize = newsize;
	reloadAllTabs();
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

function setStorage(name,value){
	localStorage.setItem(name, value);
	return true;
}

function loadStorage(name){
	if (localStorage.getItem(name) == null){
		return "";
	}else{
		return localStorage.getItem(name);
	}
	
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
}

function hideToggleMenu(){
	$("#topbarMenu").hide();
}

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
	$("#" + corrispondingCodingTab).show();
	if (selectedTab.attr("filename") != undefined){
		ao_module_setWindowTitle("NotepadA &#8195; 	 📝 " + selectedTab.attr("filename").replace("../../","/aor/"));
	}else{
		ao_module_setWindowTitle("NotepadA &#8195; 	 📝 newfile");
	}
	
}

function findTabWithAttr(attr,value){
	return $('div['+attr+'="'+value+'"]').each(function() {
		return this;
	});
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



    

