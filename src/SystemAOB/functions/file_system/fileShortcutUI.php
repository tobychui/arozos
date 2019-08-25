<?php
include_once("../../../auth.php");
?>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.8, maximum-scale=0.8"/>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <title>File Shortcut UI</title>
    <link rel="stylesheet" href="../../../script/tocas/tocas.css">
	<script src="../../../script/tocas/tocas.js"></script>
	<script src="../../../script/jquery.min.js"></script>
	<script src="../../../script/ao_module.js"></script>
	<style>
	    body{
	        background-color: rgb(247, 247, 247);
	    }
	    .selectable{
	        padding:6px !important;
	        padding-left:10px !important;
	        margin-left:5px !important;
	        cursor: pointer;
	    }
	    .selectable:hover{
	        background-color:#ebf6ff;
	    }
	    .rightFloat{
	        position: absolute;
	        right:5px;
	        top:5px;
	        z-index:10;
	    }
	</style>
</head>
	<body>
	<br><br>
		<div class="ts container">
			<div class="ts segment">
				<div class="ts header">
                    File Explorer Shortcuts
                    <div class="sub header">Change the shortcut listed in file explorer and selector</div>
                </div>
			</div>
			<div class="ts segment">
			    <p><i class="caret down icon"></i>Current List of Shortcuts:</p>
    			<ol id="shorcutlist" class="ts list">
                    <li>Loading...</li>
                </ol>
            </div>
            <div class="ts segment">
                <p><i class="caret down icon"></i>Shortcut Information</p>
                 Shortcut Name
                <div class="ts tiny fluid input">
                    <input id="shortcutName" type="text" placeholder="Shortcut Name">
                </div>
                <br><br>
                Shortcut Target
                <div class="ts action tiny fluid input">
                    <input id="shortcutTarget" type="text" placeholder="Target">
                    <button class="ts button" onClick="selectShortcutTargetPath();"><i class="folder open icon"></i>Open</button>
                </div>
                <br><br>Shortcut Icon (Preview: <i id="previewIcon" class="folder open icon"></i>)
                <select id="iconSelection" class="ts basic fluid tiny dropdown">
                    <option>folder open icon</option>
                    <option>folder open outline open icon</option>
                    <option>wordpress forms icon</option>
                    <option>file pdf outline icon</option>
                    <option>picture icon</option>
                    <option>music icon</option>
                    <option>film icon</option>
                    <option>file text outline icon</option>
                    <option>disk outline icon</option>
                    <option>trash outline icon</option>
                    <option>game icon</option>
                    <option>home icon</option>
                    <option>cloud icon</option>
                    <option>bookmark icon</option>
                    <option>star icon</option>
                </select>
            
                <div class="ts right aligned segment">
                    <button class="ts updateMode primary tiny button" onClick="updateShortcut();">Update</button>
                    <button class="ts createMode positive tiny button" onClick="createShortcut();" >Create</button>
                    <button class="ts secondary tiny opinion button" onClick="resetAllValues();">Cancel</button>
                </div>
            </div>
		</div>
		<br><br>
		<script>
	    	var updateMode = "create"; //either create or update
	    	var selectedShortcutFilename;
	    	updateInterface();
		    renderShortcutList();
		    function renderShortcutList(){
		        $("#shorcutlist").html("");
		        $.get("getFileShortcuts.php?includeFilename",function(data){
		            var list = data;
		            for(var i=0; i < list.length; i++){
		                var shortcutInfo = ao_module_utils.objectToAttr(list[i]);
		                //The values in the shortcutInfo array is as follow (0 -> 4)
		                //shortcut filename
		                //shortcut type
		                //shortcut Display Name
		                //shortcut Target Path
		                //shortcut prefered icon
		                if (i < list.length - 1){
		                    $("#shorcutlist").append("<li class='selectable shorcut' info='" + shortcutInfo + "' onClick='editThisShortcut(this);'><i class='" + list[i][4] + "'></i>" + list[i][2] + "<div class='rightFloat'><i class='caret caret down icon' onClick='moveThisUp(this);'></i><i class=' remove icon' onClick='removeThisShortcut(this);'></i></div></li>");
		                }else{
		                    $("#shorcutlist").append("<li class='selectable shorcut' info='" + shortcutInfo + "' onClick='editThisShortcut(this);'><i class='" + list[i][4] + "'></i>" + list[i][2] + "<div class='rightFloat'><i class=' remove icon' onClick='removeThisShortcut(this);'></i></div></li>");
		                }
		                
		            }
		        });
		    }
		    
		    function selectShortcutTargetPath(){
		        var uid = ao_module_utils.getRandomUID();
		        if (ao_module_virtualDesktop){
		            //ao_module_openFileSelector(uid,"updateTargetPath",undefined,undefined,false,"folder");
					ao_module_newfw("SystemAOB/functions/file_system/fileSelector.php?selectMode=folder","Starting file selector","spinner","shortcutDirSelector",1080,645,undefined,undefined,undefined,undefined,parent.ao_module_windowID,"fileSelectionPassthrough");
		        }else{
		            ao_module_openFileSelectorTab(uid,"../../../",true,"folder",updateTargetPath);
		        }
		    }
		    
			function fileReceive(object){
				updateTargetPath(object);
			}
			
		    function updateInterface(){
		        if (updateMode == "update"){
		            $(".updateMode").show();
		            $(".createMode").hide();
		        }else{
		            $(".createMode").show();
		            $(".updateMode").hide();
		            
		        }
		    }
		    
		    function updateShortcut(){
		        if (selectedShortcutFilename != undefined){
		            createShortcut(selectedShortcutFilename);
		        }
		    }
		    
		    function createShortcut(fname = ""){
		        if($("#shortcutName").val().trim() != "" && $("#shortcutTarget").val().trim() != ""){
		            var shortcutname = $("#shortcutName").val().trim();
		            var shortcutpath = $("#shortcutTarget").val().trim();
		            var selectedIconText =  $( "#iconSelection option:selected" ).text();
		            var shortcutArray = [];
		            shortcutArray.push("foldershrct"); //This is the default tag for folder base shortcuts
		            shortcutArray.push(shortcutname);
		            shortcutArray.push(shortcutpath);
		            shortcutArray.push(selectedIconText);
		            shortcutArray = JSON.stringify(shortcutArray);
		            if (fname == ""){
		                //Create shortcut
		                $.post("getFileShortcuts.php",{create: shortcutArray}).done(function(data){
    		                if (data.includes("ERROR") == false){
    		                    resetAllValues();
    		                    renderShortcutList();
    		                }
    		            });
		            }else{
		                //Update shortcut
		                $.post("getFileShortcuts.php",{create: shortcutArray, filename: fname}).done(function(data){
    		                if (data.includes("ERROR") == false){
    		                    resetAllValues();
    		                    renderShortcutList();
    		                }
    		            });
		            }
		            
		        }else{
		            alert("Unable to create shortcut: Some fields are empty!");
		        }
		    }
		    
		    function updateTargetPath(fileData){
            	result = JSON.parse(fileData);
        		for (var i=0; i < result.length; i++){
            		var filename = result[i].filename;
            		var filepath = result[i].filepath;
            		$("#shortcutTarget").val(filepath);
            		if ($("#shortcutName").val() == ""){
            		    $("#shortcutName").val(ao_module_codec.decodeUmFilename(filename));
        		    }
               }
            }
		    
		    
		    function moveThisUp(object){
		        var shortcutInfo = $(object).parent().parent().attr("info");
		        shortcutInfo = ao_module_utils.attrToObject(shortcutInfo);
		        var shortcutArray = [];
		        var fname = shortcutInfo[0];
	            shortcutArray.push("foldershrct"); //This is the default tag for folder base shortcuts
	            shortcutArray.push(shortcutInfo[2]);
	            shortcutArray.push(shortcutInfo[3]);
	            shortcutArray.push(shortcutInfo[4]);
	            shortcutArray = JSON.stringify(shortcutArray);
	            $.get("getFileShortcuts.php?remove=" + fname,function(data){
	                $.post("getFileShortcuts.php",{create: shortcutArray}).done(function(data){
    	                if (data.includes("ERROR") == false){
    	                    resetAllValues();
    	                    renderShortcutList();
    	                }
    	            });
	            });
	            
		    }
		    
		    function editThisShortcut(object){
		        var shortcutInfo = $(object).attr("info");
		        shortcutInfo = ao_module_utils.attrToObject(shortcutInfo);
		        selectedShortcutFilename = shortcutInfo[0];
		        $("#shortcutName").val(shortcutInfo[2]);
		        $("#shortcutTarget").val(shortcutInfo[3]);
		        $("#iconSelection").val(shortcutInfo[4]).change();
		        updateMode = "update";
		        updateInterface();
		    }
		    
		    function resetAllValues(){
		        $("#shortcutName").val("");
		        $("#shortcutTarget").val("");  
		        updateMode = "create";
		        updateInterface();
		        selectedShortcutFilename = undefined;
		    }
		    
		    function removeThisShortcut(object){
		        var shortcutInfo = $(object).parent().parent().attr("info");
		        shortcutInfo =  ao_module_utils.attrToObject(shortcutInfo);
		        if (confirm("Are you sure you want to remove shortcut: " + shortcutInfo[2] + " ?")){
		            $.get("getFileShortcuts.php?remove=" + shortcutInfo[0],function(data){
		                if (data.includes("ERROR") == false){
		                    //Success
		                    resetAllValues();
		                    renderShortcutList();
		                }else{
		                    alert("Unable to remove shortcut: " + data);
		                }
		            });
		        }
		    }
		    
		    
		    $("#iconSelection").change(function(){
		       var selectedIconText =  $( "#iconSelection option:selected" ).text();
		       updatePreviewicon(selectedIconText);
		    });
		    
		    function updatePreviewicon(text){
		        $("#previewIcon").attr("class",text);
		    }
		</script>
	</body>
</html>