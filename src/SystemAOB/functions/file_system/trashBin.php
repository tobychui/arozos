<?php
include_once("../../../auth.php");
?>
<html>
    <head>
        <title>
            Trash Bin
        </title>
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
		<style>
		.umfilename{
			background-color: rgb(216, 240, 255);
		}
		table{
			overflow-y:auto;
		}
		</style>
	</head>
	<body>
		<div class="ts fluid basic menu">
			<div class="item"><img class="ts mini middle aligned image" src="icon/sys/trash.png" style="margin-right:12px;"> Trash Bin</div>
			<div class="right item"><button class="ts negative button" onClick="removeAllFiles();">Delete All</button></div>
			
		</div>
		<div class="ts fluid container">
			<table class="ts small compact fluid table">
				<thead>
					<tr>
						<th>UUID</th>
						<th>Filename</th>
						<th>Delete Date</th>
						<th>Recover</th>
						<th>Delete</th>
					</tr>
				</thead>
				<tbody id="filelist">

				</tbody>
				<tfoot>
					<tr>
						<th colspan="5">File Count: <span id="fcount"></span></th>
					</tr>
				</tfoot>
			</table>
			<div class="ts container">
				<p>Warning. Developer will not bear any responsibility for accidentally removed files / data loss including but not limited to power outage and hard disk failure. </p>
			</div>
		</div>
		<div id="msgbox" class="ts snackbar">
			<div class="content">
				N/A
			</div>
		</div>
		<br><br>
		<script>
		var lastUpdateFileLength = 0;
		setInterval(checkUpdates,5000);
		listAllFilesInTrashBin();
		function listAllFilesInTrashBin(){
			$.ajax({
				url:"trashHandle.php?opr=list",
				success:function(data){
					$("#filelist").html('');
					for(var i=0;i<data.length;i++){
						var thisFile = data[i];
						var filename = basename(thisFile[1]);
						var className = "";
						if (filename != ao_module_codec.decodeUmFilename(filename)){
							filename = ao_module_codec.decodeUmFilename(filename);
							className = "umfilename";
						}
						$("#filelist").append('<tr>');
						$("#filelist").append('<td>' + thisFile[0] + '</td>\
						<td class="' + className + '" style="word-break: break-all !important;">' +  filename + '</td>\
						<td>' + getTime(thisFile[2]) + '</td>');
						$("#filelist").append('<td><button uuid="' + thisFile[0] + '" class="ts tiny icon button" onClick="recover(this);"><i class="repeat icon"></i></button></td>');
						$("#filelist").append('<td><button uuid="' + thisFile[0] + '" class="ts negative tiny icon button"  onClick="deleteThis(this);"><i class="trash outline icon"></i></button></td>');
						$("#filelist").append('</tr>');
					}
					lastUpdateFileLength = data.length;
					$("#fcount").text(data.length);
				}
					
			});
		}
		
		function checkUpdates(){
			$.ajax({
				url:"trashHandle.php?opr=list",
				success: function(data){
					if (data.length != lastUpdateFileLength){
						//Something changed. Update the list
						listAllFilesInTrashBin();
					}
				}
			});
		}
		
		function recover(object){
			var uuid = $(object).attr("uuid");
			$.get("trashHandle.php?opr=recover&filepath=" + uuid,function(data){
				if (data.includes("ERROR") == false){
					//Recover finished
					listAllFilesInTrashBin();
					msgbox("<i class='checkmark icon'></i> File recovered");
				}else{
					msgbox("<i class='remove icon'></i> " + data);
				}
			});
		}
		
		function removeAllFiles(){
			if (confirm("Confirm removing ALL FILES? THIS ACTION CANNOT BE UNDONE.")){
				$.get("trashHandle.php?opr=clearAll",function(data){
					if (data.includes("ERROR") == false){
						listAllFilesInTrashBin();
						msgbox("<i class='trash outline icon'></i> Trash Bin Cleared");
					}else{
						msgbox("<i class='remove icon'></i> " + data);
					}
				});
			}
		}
		
		function deleteThis(object){
			var uuid = $(object).attr("uuid");
			if (confirm("Confirm removing this file? THIS ACTION CANNOT BE UNDONE.")){
				$.get("trashHandle.php?opr=delete&filepath=" + uuid,function(data){
					if (data.includes("ERROR") == false){
						//Recover finished
						listAllFilesInTrashBin();
						msgbox("<i class='trash outline icon'></i> File Deleted");
					}else{
						msgbox("<i class='remove icon'></i> " + data);
					}
				});
			}
			
		}
		
		function msgbox(data){
			$("#msgbox").find(".content").html(data);
			$("#msgbox").stop().finish().fadeIn('fast').delay(3000).fadeOut('fast');
		}
		
		function basename(filepath){
			filepath = filepath.split("\\").join("/");
			var tmp = filepath.split("/");
			return tmp.pop();
		}
		
		function getTime(UNIX_timestamp){
		  var a = new Date(UNIX_timestamp * 1000);
		  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
		  var year = a.getFullYear();
		  var month = months[a.getMonth()];
		  var date = a.getDate();
		  var hour = a.getHours();
		  var min = a.getMinutes();
		  var sec = a.getSeconds();
		  var time = date + ' ' + month + ' ' + year + ' ' + hour + ':' + min + ':' + sec ;
		  return time;
		}
		</script>
	</body>
</html>