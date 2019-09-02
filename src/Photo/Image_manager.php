<?php
include '../auth.php';
if(isset($_GET["bkend"])){
	if(isset($_GET["query"])){
		if($_GET["query"] == "playlist"){
			$intdirs = array_filter(glob("storage/" . "*"), 'is_dir');
			$IntDirWInfo = [];
			foreach ($intdirs as &$intdir) {
				preg_match('/storage\/([^\/]*)/', $intdir, $out_playlist);
				$tmp = [];
				if(ctype_xdigit($out_playlist[1])){
					$tmp["name"] = "Internal - ".hex2bin($out_playlist[1]);
				}else{
					$tmp["name"] = "Internal - ".$out_playlist[1];
				}
				$tmp["dir"] = "../../../Video/".$intdir."/";
				$tmp["drive"] = "internal";
				$tmp["playlist"] = $out_playlist[1];
				array_push($IntDirWInfo,$tmp);
			}
			if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
				$ExtDirWInfo = []; //TODO: add ext support
			}else{
				if (file_exists("/media/")){
					$extdirs = array_filter(glob("/media/*/Video/*"), 'is_dir');
					$ExtDirWInfo = [];
					foreach ($extdirs as &$extdir) {
						preg_match('/\/media\/([^\/]*)\//', $extdir, $out_storage);
						preg_match('/Video\/([^\/]*)/', $extdir, $out_playlist);
						$tmp = [];
						if(ctype_xdigit($out_playlist[1])){
							$tmp["name"] = $out_storage[1]." - ".hex2bin($out_playlist[1]);
						}else{
							$tmp["name"] = $out_storage[1]." - ".$out_playlist[1];
						}
						$tmp["dir"] = $extdir."/";
						$tmp["drive"] = $out_storage[1];
						$tmp["playlist"] = $out_playlist[1];
						array_push($ExtDirWInfo,$tmp);
					}
				}
			}
			$dirs = array_merge($IntDirWInfo,$ExtDirWInfo);
			echo json_encode($dirs);
		}else if($_GET["query"] == "storage"){
			if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
				$extdirs = [];
			}else{
				$extdirs = array_filter(glob("/media/*"), 'is_dir');
			}
			$dirs = array_merge($extdirs,["internal"]);
			echo json_encode($dirs);
		}else if($_GET["query"] == "unsort"){
			$intdirs = glob('uploads/*.{jpg,jpeg,png,gif}', GLOB_BRACE);
			$IntDirWInfo = [];
			foreach ($intdirs as &$intdir) {
				$tmp = [];
				$tmp["dir"] = "../../../Photo/".$intdir;
				$tmp["drive"] = "internal";
				array_push($IntDirWInfo,$tmp);
			}
			if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
				$ExtDirWInfo = []; //TODO: add ext support
			}else{
				if (file_exists("/media/")){
					$extdirs = glob("/media/*/Photo/*.{jpg,jpeg,png,gif}");
					$ExtDirWInfo = [];
					foreach ($extdirs as &$extdir) {
						preg_match('/\/media\/([^\/]*)\//', $extdir, $out_storage);
						$tmp = [];
						$tmp["dir"] = $extdir;
						$tmp["drive"] = $out_storage[1];
						array_push($ExtDirWInfo,$tmp);
					}
				}
			}
			$dirs = array_merge($IntDirWInfo,$ExtDirWInfo);
			echo json_encode($dirs);
		}
	}
	die();
}
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	<title>ArOZ Onlineβ</title>
	<style>
		body{
			background:rgba(245,245,245,0.8);
		}
		@media (max-width: 767px){
			.ts.bottom.right.snackbar.active{
				width: 100% !important;
				bottom: 0px !important;
				right: 0px !important;
			}
		}
	</style>
</head>
<body>
<nav class="ts attached borderless small menu">
            <a id="rtiBtn" href="index.php" class="item"><i class="angle left icon"></i></a>
            <a href="index.php" class="item">ArOZ Photo</a>
            <div class="right menu">
				<a onclick="ts('#AddstorageModal').modal('show')" class="item"><i class="add outline icon"></i></a>
		    	<a href="../Upload Manager/upload_interface.php?target=Photo&filetype=jpg,jpeg,png,gif" class="item"><i class="upload icon"></i></a>
			    <a href="Image_manager.php" class="item"><i class="folder open outline icon"></i></a>
            </div>
</nav>
<br>
<div class="ts container">
<div class="ts inverted segment">
	<p>Batch moving :
	<select class="ts basic dropdown" name="batchfolderdropdown">
		<option>Select</option>
	</select>
	<button name="batchfolderbutton" class="ts button"><i class="move icon"></i>Move</button>
	<button onclick="ts('#AddstorageModal').modal('show')" class="ts right floated button"><i class="add icon"></i>New folder</button>
	</p>
</div>

	<div class="ts stackable grid" id="unsortlist">

	</div>
</div>

<div class="ts modals dimmer">
	<dialog id="AddstorageModal" class="ts fullscreen modal" open>
		<div class="header">
			Create new storage
		</div>
		<div class="content">
			<div class="ts form">
			    <div class="field">
					<label>Storage</label>
					<select name="storagedropdown">
						<option>Select</option>
					</select>
				</div>
				<div class="field">
					<label>New storage name</label>
					<input type="text" id="storagename">
					<small></small>
				</div>
			</div>
		</div>
		<div class="actions">
			<button class="ts deny button">
				Cancel
			</button>
			<button class="ts positive button" onclick="submit()">
				Confirm
			</button>
		</div>
	</dialog>
</div>
<br><br><br><br>
<div class="ts bottom right snackbar">
    <div class="content"></div>
</div>
<script>
//Bind enter key to the input bar
$("#storagename").on("keydown",function(e){
	if (e.keyCode == 13){
		submit();
	}
});

//first script to run
$.ajax({url: "Image_manager.php?bkend=true&query=unsort", success: function(result){
	var resultArr = JSON.parse(result);
	var allfile = "";
	$.each(resultArr, function( index, value ) {
		if(value["drive"] !== "internal"){
			var drivename = '<div class="ts horizontal right floated label"><i class="usb icon"></i>' + value["drive"] + '</div>';
		}else{
			var drivename = '';
		}
		$("#unsortlist").append('<div class="four wide column" id="' + value["dir"] + '"><div class="ts card" style="height:100%"><div class="image"><img src="AOB' + value["dir"] + '"><div class="header"><div class="sub header">' + ao_module_codec.decodeUmFilename(value["dir"].replace(/^.*[\\\/]/, '')) + drivename + '</div></div></div><div class="content"><p><i class="move icon"></i>Move to <select class="ts basic dropdown" name="folderdropdown" file="' + value["dir"] + '" storage="' + value["drive"] + '"><option>Select</option></select></p><button name="deletefile"  file="' + value["dir"] + '" class="ts mini very compact negative button"><i class="delete icon"></i>Delete</button></div></div></div>');
		allfile += value["dir"] + ",";
	});
	$("select[name='batchfolderdropdown']").attr("file",allfile.substr(0,allfile.length -1));
	step2();
}});

function step2(){
	$.ajax({url: "Image_manager.php?bkend=true&query=playlist", success: function(result){
		var resultArr = JSON.parse(result);
		$("select[name='folderdropdown']").html("");
		$("select[name='folderdropdown']").append(new Option("Select",""));
		
		$("select[name='batchfolderdropdown']").html("");
		$("select[name='batchfolderdropdown']").append(new Option("Select",""));		
		$.each(resultArr, function( index, value ) {
			$("select[name='folderdropdown'][storage='" + value["drive"] + "']").append(new Option(value["name"],value["dir"]));
			$("select[name='batchfolderdropdown']").append(new Option(value["name"],value["dir"]));
		});
		
		step3();
	}});
}

function step3(){
	$.ajax({url: "Image_manager.php?bkend=true&query=storage", success: function(result){
		var resultArr = JSON.parse(result);
		$("select[name='storagedropdown']").html("");
		$("select[name='storagedropdown']").append(new Option("Select",""));
		$.each(resultArr, function( index, value ) {
			$("select[name='storagedropdown']").append(new Option(value,value));
		});
	}});
	
	step4();
}

function step4(){
	$( "button[name='batchfolderbutton']" ).click(function() {
		if($("select[name='batchfolderdropdown']").val()!==""){
			var Arr = $("select[name='batchfolderdropdown']").attr("file").split(",");
			var DOM = $("select[name='batchfolderdropdown']");
			
			var length = Arr.length;
			var success = 0;
			var failed = 0;
			
			$.each(Arr, function( index, value ) {
				if(value!== ""){
					$(DOM).parent().parent().parent().append('<div class="ts active inverted dimmer"><div class="ts text loader" id="processingtext">Processing...</div></div>');
					$.get( "../SystemAOB/functions/file_system/fsexec.php?opr=move&from=" + value + "&target=" + $(DOM).val() + value.replace(/^.*[\\\/]/, ''), function(UUID) {
						//Return an UUID, can call fsexec.php?listen={uuid} to see the file moving progress
						if(!UUID.includes("ERROR")){
							var timer = setInterval(function(){ 
								$.get( '../SystemAOB/functions/file_system/fsexec.php?listen=["' + UUID + '"]', function(data) {
									if(data[0][1] == "done"){
										success += 1;
										if(success == length){
											$("#unsortlist").html('<div class="ts card"><div class="ts slate accordion item"><i class="notice circle icon"></i><span class="header">No file unsorted</span><span class="description">Upload some files to here :)</span></div></div>');
											$(DOM).parent().parent().parent().find(".ts.active.inverted.dimmer").remove();
										}
										if((success + failed) == length){
											location.reload();
										}
										msgbox("Moved " + value.replace(/^.*[\\\/]/, ''));
										clearInterval(timer);
									}else if(data[0][1] == "error"){
										failed += 1;
										if((success + failed) == length){
											location.reload();
										}
										msgbox("Error moving " + value.replace(/^.*[\\\/]/, ''));
										clearInterval(timer);
									}
								});
							}, 3000);
						}else{
							failed += 1;
							if((success + failed) == length){
								location.reload();
							}
							msgbox(UUID);
						}
					});
				}
			});
		}else{
			msgbox("Nothing selected");
		}
	});
	
	$( "select[name='folderdropdown']" ).change(function() {
		if($(this).val()!==""){
			var DOM = $(this);
			$(DOM).parent().parent().parent().append('<div class="ts active inverted dimmer"><div class="ts text loader">Processing...</div></div>');
			$.get( "../SystemAOB/functions/file_system/fsexec.php?opr=move&from=" + $(this).attr("file") + "&target=" + $(this).val() + $(this).attr("file").replace(/^.*[\\\/]/, ''), function(UUID) {
				//Return an UUID, can call fsexec.php?listen={uuid} to see the file moving progress
				if(!UUID.includes("ERROR")){
					var timer = setInterval(function(){ 
						$.get( '../SystemAOB/functions/file_system/fsexec.php?listen=["' + UUID + '"]', function(data) {
							if(data[0][1] == "done"){
								$(DOM).parent().parent().parent().parent().fadeOut( "slow", function() {
									$(DOM).parent().parent().parent().parent().remove();
									if($.trim($("#unsortlist").html()) == ""){
										$("#unsortlist").html('<div class="ts card"><div class="ts slate accordion item"><i class="notice circle icon"></i><span class="header">No file unsorted</span><span class="description">Upload some files to here :)</span></div></div>');
									}
								});
								$(DOM).parent().parent().parent().find(".ts.active.inverted.dimmer").remove();
								msgbox("Success moving " + $(DOM).attr("file").replace(/^.*[\\\/]/, ''));
								clearInterval(timer);
							}else if(data[0][1] == "error"){
								$(DOM).parent().parent().parent().find(".ts.active.inverted.dimmer").remove();
								msgbox("Error moving " + $(DOM).attr("file").replace(/^.*[\\\/]/, ''));
								clearInterval(timer);
							}
						});
					}, 3000);
				}else{
					$(DOM).parent().parent().parent().find(".ts.active.inverted.dimmer").remove();
					msgbox(UUID);
				}
			});
			
			/*
			$.post( "mover.php", { opr: 1, files: $(this).attr("file"), dir: $(this).val() },function( data ) {
				if(data == "DONE"){
					$(DOM).parent().parent().parent().parent().parent().fadeOut( "slow", function() {
						$(DOM).parent().parent().parent().parent().parent().remove();
						if($.trim($("#unsortlist").html()) == ""){
							$("#unsortlist").html('<div class="ts slate accordion item"><i class="notice circle icon"></i><span class="header">No file unsorted</span><span class="description">Upload some files to here :)</span></div>');
						}
					});
					msgbox("Finished.");
				}else{
					msgbox("Error.");
				}
			});
			*/
		}else{
			msgbox("Nothing selected");
		}
	});

	$( "button[name='deletefile']" ).click(function() {
		var DOM = $(this);
		$.post( "mover.php", { opr: 3, files: $(this).attr("file")},function( data ) {
			if(data == "DONE"){
				$(DOM).parent().parent().parent().parent().parent().fadeOut( "slow", function() {
					$(DOM).parent().parent().parent().parent().parent().remove();
					if($.trim($("#unsortlist").html()) == ""){
						$("#unsortlist").html('<div class="ts card"><div class="ts slate accordion item"><i class="notice circle icon"></i><span class="header">No file unsorted</span><span class="description">Upload some files to here :)</span></div></div>');
					}
				});
				msgbox("Finished.");
			}else{
				msgbox("Error.");
			}
		});
	});

	$( "details" ).click(function() {
		$("details[open='']").not(this).removeAttr('open');
	});

	$( ".ts.accordion.item" ).hover(function() {
		$(".ts.accordion.item").not(this).removeAttr('style');
		$(this).attr('style',"background-color:#f7f7f7");
	});
	
	if($.trim($("#unsortlist").html()) == ""){
		$("#unsortlist").html('<div class="ts card"><div class="ts slate accordion item"><i class="notice circle icon"></i><span class="header">No file unsorted</span><span class="description">Upload some files to here :)</span></div></div>');
	}
}

/*
    var OldArr = [];
    var firstInitOldArr = true;
	setInterval(function(){ 
		var notmatch = false;
		$.ajax({url: "Image_manager.php?bkend=true&query=unsort", success: function(result){
			var resultArr = JSON.parse(result);
    		if(resultArr.length !== OldArr.length){
    			 notmatch = true;
    		}else{
        		for (var i = 0; resultArr.length < i; i++) {
        			if (resultArr[i] !== oldArr[i]){
        				notmatch = true;
        			}
        		}
    		}
    		if(firstInitOldArr){
    		    firstInitOldArr = false;
    		    notmatch = false;
    		}
    		if(notmatch){
    		   	location.reload();
    		 }
    		 OldArr = resultArr;
		}
		});
	}, 3000);
*/
	
function submit(){
	if(storage = $("select[name='storagedropdown']").val() !== ""){
		var storage = $("select[name='storagedropdown']").val() + "/";
		if(storage == "internal/"){
			storage = "storage/";
		}
		$.post( "new_folder.php", { storage: storage, name : $("#storagename").val() },function( data ) {
			if(data == "DONE"){
				msgbox("Finished.");
				location.reload();
			}
		});
	}else{
		msgbox("You must select the directory.");
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
</script>
</body>
</html>