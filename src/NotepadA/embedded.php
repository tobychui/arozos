<html>
<head>
<?php
include_once '../auth.php';
?>
</head>
<body>
Initializing Environment...<br>
This window should close automatically. If not, click <a onClick="ao_module_close();">here</a>.
<?php
$filepath = "";
$filename = "";
if (isset($_GET['filepath'])){
	$filepath = str_replace("./","",str_replace("../","",str_replace("\\","/",$_GET['filepath'])));
}
if (isset($_GET['filename'])){
	$filename = $_GET['filename'];
}
?>
<script src="../script/jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
<script>
//Try its best to hide this window
ao_module_setGlassEffectMode();
ao_module_setWindowTitle("NotepadA Initializing...");
var instances = ao_module_getProcessID("NotepadA");
var filepath = "<?php echo $filepath;?>";
var filename = "<?php echo $filename;?>";
remove(instances,ao_module_windowID);
if (instances.includes("newWindow")){
	remove(instances,"newWindow");
}
if (instances.length == 0){
	//Open a new window for the file
	console.log("[NotepadA] Opening " + filepath + " in a new floatWindow");
	window.location.href = "index.php?filename=" + filename + "&filepath=" + filepath;
}else if (instances.length > 0){
	//Open the new page in the first instances in list
	var targetWindow = instances[0];
	console.log("[NotepadA] Opening " + filepath + " in floatWindow " + targetWindow);
	parent.crossFrameFunctionCall(targetWindow,"newEditor('" + filepath + "');");
	ao_module_close();
}

function remove(array, element) {
    const index = array.indexOf(element);
    array.splice(index, 1);
}
</script>
</body>
</html>