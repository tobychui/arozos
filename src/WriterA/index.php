<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>WriterA</title>
<script src="../script/jquery.min.js"></script>
<link rel="stylesheet" href="mde/simplemde.min.css">
<script src="../script/ao_module.js"></script>
<script src="mde/simplemde.min.js"></script>
<script src="jspdf.min.js"></script>
<style>
body{
	margin:0px;
	font-family:Georgia;
	background-color:#f9f9f9;
}

.topmenu{
    font-size:90%;
	margin-bottom: 0px !important;
	width:100%;
	font-family: Arial, Helvetica, sans-serif;
	background-color:#f9f9f9;
}

#status{
	font-size:80%; 
	text-overflow: ellipsis !important; 
	overflow: hidden !important; 
	padding-left:20px;
	padding-top:5px;
}

.rightcorner{
	position:fixed;
	top:5px;
	right:5px;
	z-index:999;
	cursor: pointer;
}

.button {
  color: black;
  border: none;
  padding: 1px 10px;
  text-align: center;
  text-decoration: none;
  display: inline;
  cursor: pointer;
    -webkit-user-select: none; /* Safari */        
    -moz-user-select: none; /* Firefox */
    -ms-user-select: none; /* IE10+/Edge */
    user-select: none; /* Standard */
}

.button:hover{
    background-color:#efefef;
}

.item{
	height: 35px;
	display: inline;
}

#main{
	top:35px;
    font-family: Georgia;
}

#contextMenu{
    min-width:100px;
    background-color:rgb(247, 247, 247);
    position:fixed;
    top:0px;
    left:0px;
    border: 1px solid #9e9e9e;
    z-index:999;
    padding-left:14px;
    padding-top:8px;
    display:none;
    padding-bottom:10px;
}

.menuItem{
    padding-bottom:3px;
    padding-left:5px;
    padding-right:15px;
    border-left: 1px solid #9e9e9e;
    cursor:pointer;
}

.menuItem:hover{
    background-color:#e3e3e3;
}

.tooltip {
  position: relative;
  display: inline-block;
  border-bottom: 1px dotted black;
}

.tooltip .tooltiptext {
  visibility: hidden;
  width: 200px;
  background-color: rgba(61,61,61, 0.8);
  color: #fff;
  text-align: center;
  border-radius: 6px;
  padding: 5px 0;
  
  /* Position the tooltip */
  position: absolute;
  z-index: 1;
  top: 100%;
  left: 50%;
  margin-left: -150px;
}

.tooltip:hover .tooltiptext {
  visibility: visible;
}

.centered{
    z-index:999;
    position:fixed;
    left:20%;
    right:20%;
    top:10%;
    max-height:80%;
    padding:20px;
    background-color:#f9f9f9;
    border: 1px solid #cccccc;
}

#specialCharInsert{
    position:fixed !important;
    z-index:999 !important;
    position:fixed !important;
    left:20% !important;
    right:20% !important;
    top:10% !important;
    height:80%;
    padding:20px;
    background-color:#ededed;
    box-shadow: 3px 3px 4px #f9f9f9;
    
}

.scs{
	display:inline-block;
	margin: 3px;
	padding-left: 3px;
	padding-top: 3px;
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

.selectable{
    border: 2px solid transparent !important;
    margin: 5px !important;
}
.selectable:hover{
    border:2px solid #2bb5ff !important;
    
}
.selected{
    border:2px solid #2bb5ff !important;
}

.closebtn{
    position:absolute;
    top:-10px;
    right:-10px;
    width:30px !important;
    height:30px !important;
    border: 1px solid #4c4c4c;

}
.image{
    max-height:200px;
}
.fluid{
    width: 80% !important;
}
.primary{
    border: 1px solid #3b3b3b;
}
</style>
</head>
<body>
<div class="topmenu">
    <div style="padding:5px;padding-left:10px;">
    	<a id="backBtn" class="item" href="../index.php">⬅️</a>
        <a class="item" style="font-size:120%;margin-right:15px;">🖋 WriterA</a>
        <a class="item button" onClick = "showContextMenu(this);">File</a>
        <a class="item button" onClick = "showContextMenu(this);">Edit</a>
    	<a class="item button" onClick = "showContextMenu(this);">Help</a>
    	<a id="extInputDisplay" class="rightcorner" style="color:red;" onClick="toggleExternalInputMode();">
    		⌨ AIME
    	</a>
    	<div style="padding-top:3px;padding-left:5px;">
    	<a class="item" id="status" style="padding-top:10px !important;"></a>
    	</div>
	</div>
</div>
<div id="main">
<textarea id="mde"></textarea>
</div>
<div id="contextMenu">
    <div class="menuItem">Loading...</div>
    
</div>
<div id="selectImage" style="display:none;" class="centered">
    <div id="previewArea" style="height:350px;overflow-y: auto;" align="left">
    </div>
    <div style="position:absolute;right:30px;bottom:30px;background-color:white;">
        <button class="ts tiny primary button" onClick="insertSelectedImages();">Insert</button>
        <button class="ts tiny basic button" onClick="$(this).parent().parent().hide();">Cancel</button>
    </div>
     <button class="closebtn button"  onClick="$(this).parent().hide();">X</button>
</div>
<div id="insertImage" style="display:none;" class="centered">
     <p><i class="file image outline icon"></i>Insert Image</p>
    <iframe width="100%" height="260px" src="../Upload%20Manager/upload_interface_min.php?target=WriterA&filetype=png,jpg,jpeg"> </iframe>
    <button class="ts right floated tiny basic button" onClick="$(this).parent().hide();">Cancel</button>
    <button class="ts right floated tiny primary button" onClick="initImageSelector();">Insert</button>
    <button class="button closebtn"  onClick="$(this).parent().hide();">X</button>
</div>
<div id="saveNewDocument" style="display:none;" class="centered">
    <p><i class="save icon"></i>💾 Save As New Document</p>
    <p>Storage Directory</p>
    <div class="ts mini fluid action left icon input">
        <input class="fluid" type="text" id="newStorageDirectory" placeholder="Storage Path" onClick="ao_module_focus();">
        <button style="display:inline-block;" class="ts primary button" onClick="selectCreatePath();">Open</button>
    </div><br><p>Document Filename</p>
    <div class="ts left icon mini fluid input">
        <input class="fluid" id="createFileName" type="text" placeholder="Filename"  onClick="ao_module_focus();">
        <i class="file text outline icon"></i>
    </div>
    <br><br>
    <div id="createError" style="display:none;" class="ts inverted mini negative segment">
        <p id="createErrorMessage">Loading...</p>
    </div>
    <button class="ts tiny primary button" onClick="$(this).parent().hide(); saveAs=false;">Cancel</button>
    <button class="ts tiny primary button" onClick="confirmCreateNewDocument();">Confirm</button>
    <button class="closebtn button"  onClick="$(this).parent().hide(); saveAs=false;">X</button>
</div>
<div id="information" style="display:none;" class="centered">
    <div style="overflow-y:auto;height:300px">
        <h4><i class="write icon"></i>WriterA for ArOZ Online System</h4>
        <p>WriterA is developed by Toby Chui for the ArOZ Online System. <br>
        Originate from the ArOZ Document (which has been deprecated), the WriterA is a new generation of Mark Down Editor powered by SimpleMDE and ArOZ File System.
        Providing the power of simple yet quick editing within the ArOZ Virtual Desktop Environment as well as Document Editing under Normal Web View Mode.<br><br>
        WriterA support new generations of ArOZ Online API including ArOZ IME, floatWindows and File Open API from the latest ArOZ Online Standard. 
        Please reference the README.txt included with the module for development details.<br><br><br>
        <small style="font-size:80%">Developed since March 2019, Project under ArOZ Online System feat. IMUS Laboratory</small>
        </p>
    </div>
    <button class="closebtn button" onClick="$(this).parent().hide();">X</button>
</div>
<div id="license" style="display:none;" class="centered">
    <div style="overflow-y:auto;height:300px">
        <p>Project licensed under MIT License<br> Copyright 2019 Toby Chui</p>
        <p style="font-size:80%">MIT License <br>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p>
    </div>
     <button class="button closebtn" onClick="$(this).parent().hide();">X</button>
</div>
<div id="specialCharInsert" class="centered ts segment" style="display:none;">
	Insert Special Character
	<br>
	<div id="iscl" style="max-height:70%;left:0;right:0;overflow-y:scroll;overflow-wrap: break-word;">
			
	</div>
	<hr>
	<button style="background-color:white;border: 1px solid #707070;padding:3px;cursor:pointer;" onClick="$('#specialCharInsert').hide();">Close</button>
	<p style="display:inline-block;padding-left:20px;" id="scid">N/A</p>
</div>
<div style="display:none">
<div id="data_editingFilePath"><?php if (isset($_GET['filepath']) && $_GET['filepath'] != "" && (file_exists($_GET['filepath']) || file_exists("../" . $_GET['filepath']))){ 
echo $_GET['filepath']; 
} ?></div>
<div id="data_modulename"><?php echo dirname(str_replace("\\","/",__FILE__)); ?></div>
<div id="data_umexists"><?php 
    if (file_exists("../Upload Manager/")){
        echo "true";
    }else{
        echo "false";
    }
    ?></div>
</div>

<script>
    var currentFilepath = $("#data_editingFilePath").text().trim().replace("../",""); 
    var menuItem = {
        File: ["New File","Open File","Save","Save As","Download","Reload","Print","Export as HTML","Export as PDF","Export as Plain Text","Close"],
        Edit:["Undo","Redo","Insert Special Characters","Toggle External Input Method","Upload Image","Insert Image","Save as HTML","Save as PDF"],
        Help:["About WriterA","Markdown Guide","License"]
    };    
    var currentContextMenuItem = "";
    var lastSaveContent = "";
    var umExists = $("#data_umexists").text().trim() == "true";
    var simplemde = new SimpleMDE({
     element: document.getElementById("mde"),
     spellChecker: false,
     showIcons: ["code", "table","clean-block","horizontal-rule"],
     hideIcons: ["guide"],
     status: ["autosave", "lines", "words", "cursor"], 	 
     });
    var enableExternalInput = false;
    var shiftHolding = false;
    var controlHolding = false;
    var saveAs = false; //If saveAs = false, after creating the new document, the current page will be updated to that new document. If set to true, new window will pop out for the new document (aka save As)
    var lastCursorPosition;
    
    //Run when the document is ready
    $(document).ready(function(){
        //Initialization function
        initWriterA();
        loadAllSpecialCharacter();
        $(".scs").hover(function(){
        	var keyid = $(this).attr("keyid");
        	$("#scid").html("HTML Keycode: #&" + keyid);
        });
        
        $(".scs").on("mousedown",function(){
        	insertTextAtCursor($(this).text());
        	$("#specialCharInsert").hide();
        });
        
        if (ao_module_getStorage("WriterA","enableExternalInput") == "true"){
            toggleExternalInputMode();
        }
        
        //Bind save check status 
        setInterval(function(){
            var icon = '<i class="home icon"></i>/';
			if (currentFilepath.substring(0,6) == "/media"){
			    //This filepath is in external storage
			    icon = "";
			}
			if (currentFilepath == ""){
			    updateStatus(icon + currentFilepath + " - NOT SAVED");
			    return;
			}
            if (!checkIfContentSaved()){
                updateStatus(icon + currentFilepath.replace("./","") + " - 💾 ❗ NOT SAVED");
            }else{
                updateStatus(icon + currentFilepath.replace("./","") + " - 💾 ✔️ Saved");
            }
        },1000);
  
    });
    //Run before the page is rendered
    if (ao_module_virtualDesktop){
        $("#backBtn").hide();
        $("body").css("padding-bottom","30px");
        ao_module_setWindowSize(1050,550);
    }else{
        $("#extInputDisplay").hide();
    }
    
    //Functions related to text insert and external input method
    function insertTextAtCursor(text,ignoreNodename = false){
        if (ignoreNodename){
            pos = simplemde.codemirror.getCursor();
            simplemde.codemirror.setSelection(pos, pos);
            simplemde.codemirror.replaceSelection(text);
            return;
        }
        if (document.activeElement.nodeName == "TEXTAREA"){
            //The user is focused on the textarea.
            pos = simplemde.codemirror.getCursor();
            simplemde.codemirror.setSelection(pos, pos);
            simplemde.codemirror.replaceSelection(text);
        }else if (document.activeElement.nodeName == "INPUT"){
            //The user is focused on an input instead.
            $(document.activeElement).val($(document.activeElement).val() + text);
        }else{
            //Not focused anywhere. Inject into simpleMDE using the last active position
             simplemde.codemirror.setSelection(lastCursorPosition,lastCursorPosition);
             simplemde.codemirror.replaceSelection(text);
        }
        
    }

    simplemde.codemirror.on("cursorActivity",function(){
        let pos = simplemde.codemirror.getCursor();
        lastCursorPosition = pos;
    });
    
    function loadAllSpecialCharacter(){
    	$("#iscl").html("");
    	for (var i =161; i < 1023; i++){
    		if (i != 173){
    			$("#iscl").append("<div class='scs' keyid='" + i +"'>" + String.fromCharCode(i) + "</div>");
    		}
    		
    	}
    }
    
    function initImageSelector(){
        //After uploading the image, allow user to select the image they want to use
        $("#insertImage").hide();
        $("#previewArea").html("");
        $.get("imageLoader.php",function(data){
           var images = data;
           for (var i =0; i < images.length; i++){
               $("#previewArea").append('<img class="ts small rounded image selectable" src="' + images[i] + '" onClick="selectThisImage(this);">');
           }
        });
        $("#selectImage").show();
    }
    
    function selectThisImage(object){
        if ($(object).hasClass("selected")){
            $(object).removeClass("selected");
        }else{
            $(object).addClass("selected");
        }
    }
    
    function insertSelectedImages(){
        $(".selected").each(function(){
            var imagePath = $(this).attr("src");
            insertTextAtCursor("![](" + imagePath + ")",true);
        });
        $("#selectImage").hide();
    }
    
    function confirmCreateNewDocument(){
        //This is a new document and now it is time to create this document and save it to file system
        var mdeContent = JSON.stringify(simplemde.value());
        var filename = $("#createFileName").val().trim();
        var saveTarget = $("#newStorageDirectory").val().trim();
        var error = false;
        if (filename == ""){
            $("#createFileName").parent().addClass("error");
            error = true;
        }
        if (saveTarget == ""){
            $("#newStorageDirectory").parent().addClass("error");
            error = true;
        }
        if (error){
            return;
        }else{
            //Remove the error class if exists
            $("#createFileName").parent().removeClass("error");
            $("#newStorageDirectory").parent().removeClass("error");
        }
        if (getExtension(filename) == filename){
            //This file do not have an extension. Save as mark down instead.
            filename = filename + ".md";
        }
        //Post the data and create the document
         $.post( "documentIO.php", { content: mdeContent,create: saveTarget + filename})
            .done(function( data ) {
                console.log("[WriterA] Created File: " + data);
                if (data.includes("ERROR") == false){
                    //Create and save success.
                    if (saveAs){
                        //save as new document. Open a new document for that.
                        var moduleName = $("#data_modulename").text().trim().split("/").pop();
                	    var uid = ao_module_utils.getRandomUID();
                	    var result = ao_module_newfw(moduleName + "/index.php?filepath=" + data.replace("../",""),"WriterA","file text outline", uid,1050,550,undefined,undefined,true,false);
                	    if (result == false){
                	        window.open("index.php?filepath=" + data);
                	    }
                    }else{
                        //Create new document. Updat the current document to that of the new one
                        updateStatus('💾 File Saved');
                        lastSaveContent = simplemde.value();
                        currentFilepath = data.replace("../",""); 
                        setWindowTitle(ao_module_codec.decodeUmFilename(basename(currentFilepath)) + " - WriterA");
                    }
                    $("#saveNewDocument").hide();
                }else{
                    $("#createErrorMessage").html(data);
                    $("#createError").slideDown().delay(5000).slideUp();
                }
            });
    }
    
    function selectCreatePath(){
        var fwID = ao_module_utils.getRandomUID();
        if (ao_module_virtualDesktop){
            ao_module_openFileSelector(fwID,"createDirSelected",undefined,undefined,false,"folder");
        }else{
            ao_module_openFileSelectorTab(fwID,"../",false,"folder",createDirSelected);
        }
    }
    
    $("#createFileName").on("keydown",function(e){
        if (e.keyCode == 13){
            //Enter pressed on the input filename, activate save as well
            confirmCreateNewDocument();
        }
    });
    
    function createDirSelected(object){
        result = JSON.parse(object);
        for (var i=0; i < result.length; i++){
    		var filename = result[i].filename;
    		var filepath = result[i].filepath;
    		$("#newStorageDirectory").val(filepath + "/");
        }
    }
    
    $(document).keydown(function(e){
       switch(e.keyCode){
            case 16:
               //Shift
               shiftHolding = true;
               break;
            case 17:
                //Ctrl
                controlHolding = true;
                break;
            case 83:
                if (controlHolding){
                    //Ctrl + S
                    e.preventDefault();
                    //Save the document here
                    saveFile();
                }else{
                    ao_module_inputs.hookKeyHandler(e);
                }
            default:
                if (enableExternalInput){
                     ao_module_inputs.hookKeyHandler(e);
                }
                break;
       }
       if (shiftHolding && controlHolding){
          toggleExternalInputMode();
       }
    }).keyup(function(e){
        switch(e.keyCode){
            case 16:
               //Shift
               shiftHolding = false;
               break;
            case 17:
                //Ctrl
                controlHolding = false;
                break;
        }
            
    });
    
    function updateStatus(text){
        $("#status").html("📄 " + text);
    }
    
    function toggleExternalInputMode(){
        //Toggle Input Method
        enableExternalInput = !enableExternalInput;
        if (!enableExternalInput){
           //External input mode disabled
           $("#extInputDisplay").css("color","red");
            ao_module_inputs.hookStdIn(function(text){});
            ao_module_saveStorage("WriterA","enableExternalInput","false");
        }else{
           //External input mode enabled
           $("#extInputDisplay").css("color","green");
           ao_module_inputs.hookStdIn(function(text){insertTextAtCursor(text);});
           ao_module_saveStorage("WriterA","enableExternalInput","true");
        }
    }
	//Run when the editor is ready
	function initWriterA(){
		//Check if the current editing filepath is empty. If yes, this is a new document.
		ao_module_setWindowIcon("file text outline");
		if (currentFilepath == ""){
		    setWindowTitle("Untitiled - WriterA");
			updateStatus("Editor Ready!");
		}else{
			setWindowTitle(ao_module_codec.decodeUmFilename(basename(currentFilepath)) + " - WriterA");
			loadDocumentFromPath(currentFilepath);
			var icon = '🏠/';
			if (currentFilepath.substring(0,6) == "/media"){
			    //This filepath is in external storage
			    icon = "";
			}
			updateStatus(icon + currentFilepath + " - Loaded");
		}
		
	}
	
	function setWindowTitle(text){
	    ao_module_setWindowTitle(text);
		document.title = text;
	}
	
	function loadDocumentFromPath(path){
	    $.get("documentIO.php?filepath=" + path,function(data){
	        data = JSON.parse(data);
	        simplemde.value(data);
	        lastSaveContent = data;
	    });
	}
	
	function checkIfContentSaved(){
	    if (simplemde.value() != lastSaveContent){
	        return false;
	    }else{
	        return true;
	    }
	}
	
	//New SaveAs Handler
    function saveAsHandler(fileData){
        result = JSON.parse(fileData);
        for (var i=0; i < result.length; i++){
            //var filename = result[i].filename;
            var filepath = result[i].filepath;
            var filename = result[i].filename;
            var tmp = filepath.split("/")
            tmp.pop();
            filepath = tmp.join("/") + "/";
            var mdeContent = JSON.stringify(simplemde.value());
            var saveTarget = filepath;
            var error = false;
            if (getExtension(filename) == filename){
                //This file do not have an extension. Save as mark down instead.
                filename = filename + ".md";
            }
            //Post the data and create the document
             $.post( "documentIO.php", { content: mdeContent,create: saveTarget + filename})
                .done(function( data ) {
                    console.log("[WriterA] Created File: " + data);
                    if (data.includes("ERROR") == false){
                        //Create and save success.
                        if (saveAs){
                            //save as new document. Open a new document for that.
                            var moduleName = $("#data_modulename").text().trim().split("/").pop();
                    	    var uid = ao_module_utils.getRandomUID();
                    	    var result = ao_module_newfw(moduleName + "/index.php?filepath=" + data.replace("../",""),"WriterA","file text outline", uid,1050,550,undefined,undefined,true,false);
                    	    if (result == false){
                    	        window.open("index.php?filepath=" + data);
                    	    }
                        }else{
                            //Create new document. Updat the current document to that of the new one
                            updateStatus('💾 File Saved');
                            lastSaveContent = simplemde.value();
                            currentFilepath = data.replace("../",""); 
                            setWindowTitle(ao_module_codec.decodeUmFilename(basename(currentFilepath)) + " - WriterA");
                        }
                        $("#saveNewDocument").hide();
                    }else{
                        $("#createErrorMessage").html(data);
                        $("#createError").slideDown().delay(5000).slideUp();
                    }
                });
        }
    }
	
	//Menu item handler
	function menuClicked(object){
	    var text = $(object).text().trim();
	    switch(text){
            case "New File":
                newFile();
                break;
            case "Open File":
                openFile();
                break;
            case "Save":
                saveFile();
                hideContextMenu();
                break
            case "Save As":
                saveAs = true;
                var uid = ao_module_utils.getRandomUID();
                if (ao_module_virtualDesktop){
                    ao_module_openFileSelector(uid,"saveAsHandler",undefined,undefined,false,"new","newdoc.md",true);
                }else{
                    ao_module_openFileSelectorTab(uid,"../",true,"new",saveAsHandler,"newdoc.md",true);
                }
                //$("#saveNewDocument").fadeIn("fast");
                hideContextMenu();
                break;
            case "Toggle External Input Method":
                toggleExternalInputMode();
                hideContextMenu();
                break;
            case "About WriterA":
                $("#information").show();
                hideContextMenu();
                break;
            case "License":
                $("#license").show();
                hideContextMenu();
                break;
            case "Print":
                printFile();
                hideContextMenu();
                break;
            case "Close":
                handleWindowClose();
                //ao_module_close();
                break;
            case "Reload":
                window.location.reload();
                break;
            case "Undo":
                simplemde.undo();
                hideContextMenu();
                break;
            case "Redo":
                simplemde.redo();
                hideContextMenu();
                break;
            case "Insert Special Characters":
                $("#specialCharInsert").show();
                hideContextMenu();
                break;
            case "Markdown Guide":
                if (ao_module_virtualDesktop){
                    ao_module_newfw("https://simplemde.com/markdown-guide",'Markdown Guide','sticky note outline',ao_module_utils.getRandomUID(),475,700);
                }else{
                    window.open("https://simplemde.com/markdown-guide");
                }
                hideContextMenu();
                break;
            case "Insert Image":
                initImageSelector();
                hideContextMenu();
                break;
            case "Upload Image":
                 if (umExists){
                    //Allow file upload and insert
                    $("#insertImage").show();
                }else{
                    //Insert url image bracket to the text
                    insertTextAtCursor("![](http://)");
                }
                hideContextMenu();
                break;
            case "Download":
                var filename = "";
                if (currentFilepath != ""){
                    filename = ao_module_codec.decodeUmFilename(basename(currentFilepath));
                }else{
                    filename = prompt("Please enter a filename","Untitled.txt");
                    if (filename == null) {
                        filename = "Untitled.txt"
                    }
                      
                }
                download(filename,simplemde.value());
                hideContextMenu();
                break;
            case "Export as PDF":
                 $.post( "documentIO.php", { parseMD: JSON.stringify(simplemde.value())})
                    .done(function( data ) {
                        printPDF(data);
                    });
                hideContextMenu();
                break;
            case "Save as PDF":
                //Work in progress
                hideContextMenu();
                break;
            case "Export as Plain Text":
                var filename = "";
                if (currentFilepath != ""){
                    filename = ao_module_codec.decodeUmFilename(basename(currentFilepath));
                }else{
                    filename = prompt("Please enter a filename","Untitled.txt");
                    if (filename == null) {
                        filename = "Untitled.txt"
                    }
                      
                }
                 $.post( "documentIO.php", { parseMD: JSON.stringify(simplemde.value())})
                 .done(function( data ) {
                     download(filename,$(data).text());
                 });
                hideContextMenu();
            default:
                hideContextMenu();
                break;
	    }
	}
	
	$(window).bind('beforeunload', function(){
	     if (!checkIfContentSaved()){
	         return 'Document is not saved yet. Confirm leaving?';
	     }
    });
    
    //Override function for ao_module_close();
    function ao_module_close(){
    	if (ao_module_virtualDesktop){
    	    handleWindowClose();
    		return true;
    	}
    	return false;
    }
 
	function handleWindowClose(){
	    if (checkIfContentSaved()){
	        //Content saved. Close window.
	        if (ao_module_virtualDesktop){
	            parent.closeWindow(ao_module_windowID);
	        }
	    }else{
	        if (confirm("Document is not saved yet. Confirm leaving?")){
	            parent.closeWindow(ao_module_windowID);
	        }
	    }
	}
	
	function printPDF(htmlContent) {
        var pdf = new jsPDF('p', 'pt', 'letter');
        // source can be HTML-formatted string, or a reference
        // to an actual DOM element from which the text will be scraped.
        source = htmlContent;
        
        // we support special element handlers. Register them with jQuery-style 
        // ID selector for either ID or node name. ("#iAmID", "div", "span" etc.)
        // There is no support for any other type of selectors 
        // (class, of compound) at this time.
        specialElementHandlers = {
            // element with id of "bypass" - jQuery style selector
            '#bypassme': function (element, renderer) {
                // true = "handled elsewhere, bypass text extraction"
                return true
            }
        };
        margins = {
            top: 80,
            bottom: 60,
            left: 40,
            width: 522
        };
        // all coords and widths are in jsPDF instance's declared units
        // 'inches' in this case
        pdf.fromHTML(
            source, // HTML string or DOM elem ref.
            margins.left, // x coord
            margins.top, { // y coord
                'width': margins.width, // max width of content on PDF
                'elementHandlers': specialElementHandlers
            },

            function (dispose) {
                // dispose: object with X, Y of the last line add to the PDF 
                //          this allow the insertion of new lines after html
                var filename = "";
                if (currentFilepath != ""){
                    filename = ao_module_codec.decodeUmFilename(basename(currentFilepath));
                }else{
                    filename = "Untitled"
                }
                pdf.save(filename + '.pdf');
            }, margins
        );
    }
    
	function download(filename, text) {
      var element = document.createElement('a');
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
      element.setAttribute('download', filename);
    
      element.style.display = 'none';
      document.body.appendChild(element);
    
      element.click();
    
      document.body.removeChild(element);
    }

	//Functions related to menus
	function newFile(){
	    var moduleName = $("#data_modulename").text().trim().split("/").pop();
	    var uid = (new Date()).getTime();
	    var result = ao_module_newfw(moduleName + "/index.php","WriterA","file text outline", uid,1050,550,undefined,undefined,true,false);
	    if (result == false){
	        window.open("index.php");
	    }
	    hideContextMenu();
	}
	
	function saveFile(){
	    if (currentFilepath.trim() != ""){
	        //This is a file with path. save with savepath function call
	        var mdeContent = JSON.stringify(simplemde.value());
	         $.post( "documentIO.php", { content: mdeContent,savepath: currentFilepath.trim()})
            .done(function( data ) {
                console.log("[WriterA] Save File: " + data);
                if (data.includes("ERROR") == false){
                    updateStatus('💾 File Saved');
                    lastSaveContent = simplemde.value();
                }else{
                    updateStatus('⚠️ Something went wrong when trying to save this file.');
                }
            });
	    }else{
	        //This is a new file. Let the user choose where to save this file first and use create function call to save
	        var uid = ao_module_utils.getRandomUID();
            if (ao_module_virtualDesktop){
                ao_module_openFileSelector(uid,"saveAsHandler",undefined,undefined,false,"new","newdoc.md",true);
            }else{
                ao_module_openFileSelectorTab(uid,"../",true,"new",saveAsHandler,"newdoc.md",true);
            }
	    }
	    
	}
	
	function openFile(){
	    var uid = ao_module_utils.getRandomUID();
	    if (ao_module_virtualDesktop){
	        ao_module_openFileSelector(uid,"openFileFromSelector");
	    }else{
	        ao_module_openFileSelectorTab(uid,"../",false,"file",openFileFromSelector);
	    }
	    hideContextMenu();
	}
	
	function openFileFromSelector(fileData){
        result = JSON.parse(fileData);
        for (var i=0; i < result.length; i++){
            var filename = result[i].filename;
            var filepath = result[i].filepath;
            //Opening file from Selector. If the current document path is undefined, then open in this windows. Otherwise, open in a new window.
            if (currentFilepath == ""){
                //Open in this window
                window.location.href = window.location.href + "?filepath=" + filepath;
            }else{
                //Open in new window
                var moduleName = $("#data_modulename").text().trim().split("/").pop();
        	    var uid = ao_module_utils.getRandomUID();
        	    var result = ao_module_newfw(moduleName + "/index.php?filepath=" + filepath,"WriterA","file text outline", uid,1050,550,undefined,undefined,true,false);
        	    if (result == false){
        	        window.open("index.php?filepath=" + filepath);
        	    }
            }
            console.log(filename,filepath);
        }
    }
	
	function printFile(){
	    try {
			var fileContent = "";
			var documentName = "Untitled Document";
			if (currentFilepath.trim() != ""){
			    var documentName = ao_module_codec.decodeUmFilename(basename(currentFilepath));
			    var ext = getExtension(currentFilepath);
			    if (ext == "md"){
			        //Use another function for markdown
			        parseMarkdownAndPrint(documentName);
			        return;
			    }else{
			        //Just print the content of the simpleMDE
			       fileContent =  simplemde.value()
			    }
			}else{
			    //Force parse it into markdown
			    parseMarkdownAndPrint(documentName);
			    return;
			}
			var printWindow = window.open("", "", "height=400,width=800");
			printWindow.document.write("<html><head><title>" + documentName + "</title>");
			printWindow.document.write("</head><xmp>");
			printWindow.document.write("Filename: '" + documentName + "' Print-time: " + new Date().toLocaleString() + "\n");
			printWindow.document.write(fileContent);
			printWindow.document.write("</xmp></html>");
			printWindow.document.close();
			printWindow.print();
		}catch (ex) {
			console.error("Error: " + ex.message);
		}
	}
	
	function parseMarkdownAndPrint(documentName){
	    var content = simplemde.value();
	    content = JSON.stringify(content);
	    $.post( "documentIO.php", { parseMD: content})
        .done(function( data ) {
            printHTML(documentName,data);
        });
	}
	
	function printHTML(documentName,fileContent){
	    	var printWindow = window.open("", "", "height=400,width=800");
			printWindow.document.write("<html><head><title>" + documentName + "</title>");
			printWindow.document.write("</head>");
			printWindow.document.write("<small>📎Filename: " + documentName + " Print-time: " + new Date().toLocaleString() + "<br></small>");
			printWindow.document.write(fileContent);
			printWindow.document.write("</html>");
			printWindow.document.close();
			printWindow.print();
	}
	
	
	function basename(path){
		return path.split("\\").join("/").split("/").pop();
	}
	
	function getExtension(path){
	    if (path.includes("/") || path.includes("\\")){
	        path = basename(path);
	    }
	    return path.split(".").pop(); //Return the last section of the array which split with dot
	}
	
	function showContextMenu(object){
	    if ($("#contextMenu").is(":visible") && currentContextMenuItem == $(object).text().trim()){
	        $("#contextMenu").hide();
	        return;
	    }
	    currentContextMenuItem = $(object).text().trim();
		var menu = $("#contextMenu");
		var position = [$(object).offset().left,$(object).offset().top + $(object).height() + 2];
		$("#contextMenu").css("left",position[0]);
		$("#contextMenu").css("top",position[1]);
		$("#contextMenu").html("");
		var items = menuItem[$(object).text().trim()];
		for (var i =0; i < items.length; i++){
		   $("#contextMenu").append('<div class="menuItem" onClick="menuClicked(this);">' + items[i] + '</div>')
		}
		$("#contextMenu").show();
	}
	
	function hideContextMenu(){
	    $("#contextMenu").hide();
	}
	
	//Click on the main edit area. 
	$("#main").on("click",function(){
	    //If context menu is shown, hide it
	    if ($("#contextMenu").is(":visible")){
	        $("#contextMenu").hide();
	    }
	    //focus this floatWindow
	    ao_module_focus();
	});

</script>
</body>
</html>

