<?php
include '../auth.php';
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<title>7z File Manager</title>
	<style>
	body{
		background-color:white
	}
	.ts.form .inline.field label {
		min-width: 50%;
	}
	.ts.basic.dropdown, .ts.form select {
		max-width: 50%;
	}
	</style>
</head>
<body>
<br>
	<div class="ts container">
		<div class="ts grid">
			
			<div class="eight wide column">
				<span style="text-align:left">Elasped time:</span>
				<span style="text-align:right" id="time">00:00:00</span>
			</div>
			<div class="eight wide column">
				<span style="text-align:left">Total size:</span>
				<span style="text-align:right" id="totalsize">0 b</span>
			</div>
			
			<div class="eight wide column">
				<span style="text-align:left">Remaining time:</span>
				<span style="text-align:right" id="remaining">00:00:00</span>
			</div>
			<div class="eight wide column">
				<span style="text-align:left">Speed:</span>
				<span style="text-align:right" id="speed">0 b/s</span>
			</div>
			
			<div class="sixteen wide column">
				<span style="text-align:left">Loading...</span>
				<div class="ts progress">
					<div class="bar" id="bar" style="width: 0%"></div>
				</div>
			</div>	
			
			<div class="eight wide column"></div>
			<div class="eight wide column">
				<button class="ts basic button" style="width:100%" onclick="f_close();f_cancel = true;">Cancel</button>
			</div>
		</div>
	</div>
	<div class="ts bottom right snackbar">
		<div class="content"></div>
	</div>
</body>
<script>
var f_method = "<?php echo $_GET["method"] ?>";
var f_rand = "<?php echo $_GET["rand"] ?>";
var f_file = "<?php echo $_GET["file"] ?>";
var f_dir = "<?php echo $_GET["dir"] ?>";
var f_size = "<?php echo filesize($_GET["file"]); ?>";
var f_destdir = "<?php echo isset($_GET["destdir"]) ? $_GET["destdir"] : ""; ?>";
var f_time = 1;
var f_totaltime = 1;
var f_cancel = false;

//Initiate floatWindow events
ao_module_setWindowTitle("Inflating from compressed file...");
ao_module_setWindowIcon("loading spinner");

var f_load = setInterval(function(){ 

	$.ajax({
		url: "getMessage.php?id=" + f_rand + "messages",
		contentType: "text/plain"
	}).done(function(data) { 
		var progress = data.match(/ ([0-9]{0,2}%)/gim);
		console.log(progress[progress.length - 1]);
		f_totaltime = Math.floor(f_time / (parseInt(progress[progress.length - 1])/100));
		$("#bar").attr("style","width: " + progress[progress.length - 1]);
		$("#time").text(f_convert(f_time));
		$("#remaining").text(f_convert(f_totaltime - f_time));
		$("#speed").text(f_filesize(Math.floor(f_size / f_totaltime)) + "/s");
		$("#totalsize").text(f_filesize(f_size));
		f_time += 1;
	});
	
	/*
	$.get("./tmp/" + f_rand + "messages", function( data ) {
		var progress = data.match(/ ([0-9]{0,2}%)/gim);
		console.log(progress[progress.length - 1]);
		f_totaltime = Math.floor(f_time / (parseInt(progress[progress.length - 1])/100));
		$("#bar").attr("style","width: " + progress[progress.length - 1]);
		$("#time").text(f_convert(f_time));
		$("#remaining").text(f_convert(f_totaltime - f_time));
		$("#speed").text(f_filesize(Math.floor(f_size / f_totaltime)) + "/s");
		$("#totalsize").text(f_filesize(f_size));
		f_time += 1;
	});
	*/
}, 1000);

f_load;

$.get("opr.php?method=" + f_method + "&rand=" + f_rand + "&file=" + f_file + "&dir=" + f_dir , function( raw ) {
		clearInterval(f_load);
		if(!f_cancel){
			if(f_destdir.length >0){
				//console.log('../SystemAOB/functions/file_system/move.php?from=../../../7-Zip%20File%20Manager/tmp/' + f_rand +'&to=../../' + f_destdir + f_filenameToFoldername(f_file));
				
				$.get( '../SystemAOB/functions/file_system/move.php?from=../../../7-Zip%20File%20Manager/tmp/' + f_rand +'&to=../../' + f_destdir + f_filenameToFoldername(f_file), function(data) {
					if(data !== "DONE"){
						if(ao_module_virtualDesktop){
							parent.msgbox(data,'<i class="caution sign icon"></i> 7-Zip File Manager',"");
							ao_module_close();
						}else{
							msgbox(data,"","");
							setTimeout(function(){ts('#modal').modal('hide')},1500);
						}
					}else{
						f_openFile(true);
					}
				});
				/*
				console.log('../SystemAOB/functions/file_system/copy_folder.php?from=../../../7-Zip%20File%20Manager/tmp/' + f_rand +'/&target=../../' + f_destdir + f_rand + "/");
				
				console.log('../SystemAOB/functions/file_system/rename.php?file=../../' + f_destdir + f_rand + '&newFileName=../../' + f_destdir + f_file.replace(/^.*[\\\/]/, '').replace(/\./,"") + '/&hex=false');
				
				$.get( '../SystemAOB/functions/file_system/copy_folder.php?from=../../../7-Zip%20File%20Manager/tmp/' + f_rand +'/&target=../../' + f_destdir + f_rand + "/", function(data) {
					if(data !== "DONE"){
						msgbox(data,"","");
						if(ao_module_virtualDesktop){
							parent.msgbox(data,"","");
							ao_module_close();
						}else{
							msgbox(data,"","");
							setTimeout(function(){ts('#modal').modal('hide')},1500);
						}
					}
					
					$.get( '../SystemAOB/functions/file_system/rename.php?file=../../' + f_destdir + f_rand + '&newFileName=../../' + f_destdir + f_file.replace(/^.*[\\\/]/, '').replace(/\./,"") + '/&hex=false', function(data) {
						if(data !== "DONE"){
							$.get( '../SystemAOB/functions/file_system/delete.php?filename=../../' + f_destdir + f_rand, function(data) {
							});
							if(ao_module_virtualDesktop){
								parent.msgbox(data,"","");
								ao_module_close();
							}else{
								msgbox(data,"","");
								setTimeout(function(){ts('#modal').modal('hide')},1500);
							}
						}else{
							f_openFile(true);
						}
					});
				});
				*/
			}else{
				f_openFile(false);
			}
		}
});

function f_filenameToFoldername(path){
		var filename = path.split("\\").join("/").split("/").pop();
		var filename = filename.split(".");
		if (filename.length > 1){
			filename.pop();
		}
		filename = filename.join(".");
		if (filename.substring(0,5) == "inith"){
			filename = filename.replace("inith","");
		}
		return filename;
}

function f_openFile(bool){
	var Folder = "";
	// bool = true then it have destdir
	// bool = false then it dont have destdir
	if(bool == true){
		//f_method = e then it is only single file
		//f_method = x then it is a folder
		if(f_method == "e"){
			Folder = f_destdir.replace("../","") + f_filenameToFoldername(f_file) + "/" + f_dir.replace(/^.*[\\\/]/, '');
		}else if(f_method == "x"){
			Folder = f_destdir.replace("../","") + f_filenameToFoldername(f_file);
		}
	}else{
		//f_method = e then it is only single file
		//f_method = x then it is a folder
		if(f_method == "e"){
			Folder = "7-Zip File Manager/tmp/" + f_rand + "/" + f_dir.replace(/^.*[\\\/]/, '');
		}else if(f_method == "x"){
			Folder = "7-Zip File Manager/tmp/" + f_rand + "/";
		}
	}
	//console.log(f_rand + Folder);
	if(ao_module_virtualDesktop){
		if(f_method == "e"){
			ao_module_openFile(Folder,"7-Zip Preview");
		}else if(f_method == "x"){
			ao_module_openPath(Folder);
		}
		ao_module_close();
	}else{
		if(f_method == "e"){
			window.open("../" + Folder);
		}else if(f_method == "x"){
			window.open("../SystemAOB/functions/file_system/index.php?controlLv=2#../../../" + Folder);
		}
		setTimeout(function(){ts('#modal').modal('hide')},1500);
	}
}

function f_convert(time){
	var hours   = Math.floor(time / 3600);
	var minutes = Math.floor((time - (hours * 3600)) / 60);
	var seconds = time - (hours * 3600) - (minutes * 60);
	
	if(hours < 10){
		var dhour  = "0" + hours;
	}else{
		var dhour  = hours;
	}
	
	if(minutes < 10){
		var dminutes  = "0" + minutes;
	}else{
		var dminutes  = minutes;
	}

	if(seconds < 10){
		var dseconds  = "0" + seconds;
	}else{
		var dseconds  = seconds;
	}
	
	if(!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)){
		var formatted = dhour + ":" + dminutes + ":" + dseconds;
	}else{
		var formatted = "00:00:00";
	}
	return formatted;
}

function f_filesize(size){
	if(size >= 1073741824){
		return Math.floor(size/1073741824*100)/100 + "GB";
	}else if(size >= 1048576){
		return Math.floor(size/1048576*100)/100 + "MB";
	}else if(size >= 1024){
		return Math.floor(size/1024*100)/100 + "KB";
	}else{
		return size + "Bytes";
	}
}

function msgbox(content,bgcolor,fontcolor){
	$(".snackbar").attr("style",'background-color: ' + bgcolor + ';color:' + fontcolor);
	ts('.snackbar').snackbar({
		content: content,
		onAction: () => {
			$(".snackbar").removeAttr("style");
		}
	});
}

function f_close(){
	if(ao_module_virtualDesktop){
		ao_module_close();
	}else{
		setTimeout(function(){ts('#modal').modal('hide')},1500);
	}
}
</script>
</html>
