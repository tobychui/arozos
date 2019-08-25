<?php
include '../auth.php';
?>
<html>
<head>
	<meta charset="UTF-8">
	<script type='text/javascript' charset='utf-8'>
		// Hides mobile browser's address bar when page is done loading.
		  window.addEventListener('load', function(e) {
			setTimeout(function() { window.scrollTo(0, 1); }, 1);
		  }, false);
	</script>
    <link href="../script/tocas/tocas.css" rel='stylesheet'>
	<script src="../script/jquery.min.js"></script>
    <title>AOB ffmpeg experimental</title>
    <style type="text/css">
        body {
            padding-top: 4em;
            background-color: rgb(250, 250, 250);
            overflow: scroll;
        }
    </style>
</head>
<body>
<?php
if (isset($_GET['cmd']) && $_GET['cmd'] != ""){
		$command = $_GET['cmd'];
}else{
		$command = "-help";
}

if (isset($_GET['filename']) && $_GET['filename'] != ""){
		$filename = $_GET['filename'];
}else{
		die("Undefined converting filename");
}
?>
<div class="ts container" >
	<div id="terminal">
	  <div class="terminal-top-bar">
		ffmpeg-all-codecs.js browser based media converter interface (experimental)
	  </div>
	  <div class="terminal-header">
		<input id="input" value="<?php echo $command;?>" style="width:50%;"/>
		<button id="run" class="ts button">Run Command</button>
	  </div>
	  <pre id="output" style="word-wrap: break-word; width:100%;height:720px;overflow-y: scroll;">Loading JavaScript files (it may take a minute)</pre>
    </div>
	<div id="files"></div>
</div>
<script>
var targetFile = "<?php echo $filename;?>";
</script>
<script type='text/javascript' src='terminal.js'></script>
</body>
</html>