<?php
include_once("../../../auth.php");
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
    	<script src="../../../script/ao_module.js"></script>
        <title>ArOZ Backup and Restore</title>
        <style>
            .snap{
                 border-left: 10px solid #d9d9d9;
            }
            .full{
                border-left: 10px solid #4287f5;
            }
            .building{
                border-left: 10px solid #f5b042;
            }
            .backup{
                padding:8px;
                margin-bottom:3px;
            }
            .backup:hover{
                background-color:#f7f7f7;
            }
            .oprButtons{
                position:absolute;
                right:0px;
                top:8px;
            }
            .primary.button{
                background-color: #4287f5 !important;
            }
        </style>
    </head>
    <body>
        <br><br>
        <div class="ts container">
			<div class="ts segment">
				<h4 class="ts header">
					<i class="undo icon"></i>
					<div class="content">
						Restore Points
						<div class="sub header">Restore your system to previous state using one of the restore points.</div>
					</div>
				</h4>
			</div>
			<div id="backupList" class="ts segment">
			    <div class="snap backup"><i class="spinner loading icon"></i> Backup list initializing in progress...</div>
			</div>
			
		</div>
        <div id="infoWindow" class="ts segment" style="position:fixed;top:10%;left:10%;right:10%;display:none;">
            <h5 class="ts header">
                <i class="archive icon"></i>
                <div class="content">
                    Restore Point Properties
                </div>
            </h5>
            <table class="ts table">
                <thead>
                    <tr>
                        <th>Properties</th>
                        <th>Value</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Backup Name</td>
                        <td id="bun">N/A</td>
                    </tr>
                    <tr>
                        <td>Backup Path</td>
                        <td id="bup">N/A</td>
                    </tr>
                    <tr>
                        <td>Complete</td>
                        <td id="buc">N/A</td>
                    </tr>
                    <tr>
                        <td>Creation Date</td>
                        <td id="bcd">N/A</td>
                    </tr>
                    <tr>
                        <td>Type</td>
                        <td id="type">N/A</td>
                    </tr>
                    <tr>
                        <td>Reference Image</td>
                        <td id="ref">N/A</td>
                    </tr>
                </tbody>
            </table>
            <button class="ts large close button" style="position:absolute;top:0px;right:0px;margin-top:-10px; margin-right:-10px;" onClick='$("#infoWindow").hide();'></button>
        </div>
		<script>
		    updateBackupLists();
		    function updateBackupLists(){
		        $.ajax("getBackups.php").done(function(data){
		            $("#backupList").html("");
		            for (var i =0; i < data.length; i++){
		                var template = '<div id="{backupUID}" class="{type} backup">\
            			        <i class="{display} icon"></i>{backupUID}<br>\
            			        <small style="font-size:80%;">Created on: {creationTime}</small>\
            			        <div class="oprButtons" backupInfo="{backupAttr}">\
            			            <button class="ts small primary icon button" onClick="restore(this);"><i class="repeat icon"></i></button>\
            			            <button class="ts small icon button" onClick="moreInfo(this);"><i class="notice icon"></i></button>\
            			            <button class="ts small icon button" onClick="removeThis(this);"><i class="trash icon"></i></button>\
            			        </div>\
            			    </div>';
            			var box = template;
            			if (data[i][2] == true){
            			   box = box.split("{type}").join(data[i][4][0]);
            			   if (data[i][4][0] == "full"){
            			       box = box.split("{display}").join("copy");
            			   }else{
            			       box = box.split("{display}").join("photo");
            			   }
            			}else{
            			   box = box.split("{type}").join("building");
            			   box = box.split("{display}").join("spinner loading")
            			}
            			box = box.split("{backupUID}").join(data[i][0]);
            		    box = box.split("{creationTime}").join(data[i][3]);
            		    box = box.split("{backupAttr}").join(ao_module_utils.objectToAttr(data[i]));
            		   
            		    $("#backupList").append(box);
            		    if (data[i][2] != true){
            		        $("#" + data[i][0]).find(".oprButtons").remove();
            		    }
            		    
		            }
		            if (data.length == 0){
                        $("#backupList").append('<div class="snap backup" ><i class="checkmark icon"></i> There is no backup in the current backup directory.</div>');
		            }
		        });
		    }
		    
		    function removeThis(object){
		        var uid = ao_module_utils.attrToObject($(object).parent().attr("backupInfo"))[0];
		        if (confirm("Confirm removing backup with name: " + uid + " ?")){
		            $.ajax("removeBackups.php?uuid=" + uid).done(function(data){
		                if (data.includes("ERROR") == false){
		                    window.location.reload();
		                }else{
		                    alert(data);
		                }
		            });
		        }
		        
		    }
		    
		    function restore(object){
		        var info = $(object).parent().attr("backupInfo");    
		        info = ao_module_utils.attrToObject(information);
		        alert("Work in progress");
		        
		    }
		    
		    function moreInfo(object){
		        var information = $(object).parent().attr("backupInfo");    
		        information = ao_module_utils.attrToObject(information);
		        $("#bun").html(information[0]);
		        $("#bup").html(information[1]);
		        $("#buc").html(information[2]);
		        $("#bcd").html(information[3]);
		        $("#type").html(information[4][0]);
		        if (information[4][0] == "snap"){
		            $("#ref").html(basename(information[4][2]));
		        }else{
		            $("#ref").html("self");
		        }
		        $("#infoWindow").show();
		    }
		    
		    function basename(path){
		        if (path.substring(path.length - 1) == "/"){
		            path = path.substring(0,path.length-1);
		        }
		        path = path.split("/");
		        return(path.pop());
		    }
		</script>
    </body>
</html>