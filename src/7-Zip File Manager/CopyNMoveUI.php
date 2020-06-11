<?php
include '../auth.php';
?>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
	<!-- <script src="../script/jquery-ui.min.js"></script> -->
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
	<div class="ts container">
		<div class="ts grid">
			<div class="sixteen wide column">
			<br>
				<div class="ts form">

					<div class="field">
						<label>Extract to:</label>
						<div class="ts labeled input" style="width:100%">
							<div class="ts label">
								/AOR/
							</div>
							<input type="text" id="path" placeholder="Select a path for unzip.">
							<button class="ts icon button" onClick="selectFolder();">
								<i class="folder open icon"></i>
							</button>
						</div>
					</div>
				</div>
				<p id="filesshow">Target: </p>
			</div>
			

			<div class="eight wide column"></div>
			<div class="eight wide column">
				<button class="ts basic small button" style="width:45%" onclick="f_ok()">OK</button>
				<button class="ts basic small button" style="width:45%" onclick="f_close()">Cancel</button>
			</div>
		</div>
	</div>
</body>
<script>
var f_method = "<?php echo $_GET["method"] ?>";
var f_rand = "<?php echo $_GET["rand"] ?>";
var f_file = "<?php echo $_GET["file"] ?>";
var f_dir = "<?php echo $_GET["dir"] ?>";
var f_extractTo = "";

ao_module_setFixedWindowSize();
ao_module_setWindowSize(650,200);

function f_close(){
	if(ao_module_virtualDesktop){
		ao_module_close();
	}else{
		ts('#modal').modal('hide');
	}		
}

function f_ok(){
	var href = "ProgressUI.php?method=" + f_method + "&rand=" + f_rand + "&file=" + f_file + "&dir=" + f_dir + "&destdir=" + f_extractTo;

	if(ao_module_virtualDesktop){
		ao_module_newfw('7-Zip File Manager/' + href,'7-Zip','file outline','7-ZipProgressUI' + Math.floor(Math.random()*100),720,250);
		ao_module_close();
	}else{
		$.get( href, function( data ) {
			$( "#modaldata" ).html( data );
			ts('#modal').modal("show");
		});
	}
}

$( "#path" ).keyup(function() {
	updatePath();
});

function updatePath(){
	var path = $("#path").val();
	var displayPath = "";
	if(f_dir == ""){
		displayPath = "...";
	}else{
	    if(f_method == "e"){
		    displayPath = f_dir.replace(/^.*[\\\/]/, '');
	    }else{
	        displayPath = f_dir;
	    }
	}
	if(path.slice(-1) !== "/"){
		path = path + "/";
	}
	$("#filesshow").text("Target: /AOR/" + path + f_file.replace(/^.*[\\\/]/, '').replace(".","") + "/" + displayPath);
	f_extractTo = "../" + path;
}

function selectFolder(){
	if (ao_module_virtualDesktop){
		ao_module_openFileSelector(getUUID(),"setPathBySelector",undefined,undefined,false,"folder");
	}else{
		ao_module_openFileSelectorTab(getUUID(),"../",false,"folder","setPathBySelector");
	}
}

function setPathBySelector(object){
	var files = JSON.parse(object);
	console.log(files);
	$("#path").val(files[0].filepath);
	updatePath();
}

function getUUID(){
	return new Date().getTime();
}

/* still in implmention
$( "#path" ).keypress(function() {
	$.get( "opr.php?method=ListAORDir&dir=" + $( "#path" ).val(), function( data ) {
	   $( "#path" ).autocomplete({
		source: JSON.parse(data)
		});
	});
});
*/

</script>
</html>
