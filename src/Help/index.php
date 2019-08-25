<?php
include '../auth.php';
?>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Online β</title>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
</head>
<body>
    <nav class="ts attached inverted borderless normal menu">
        <div class="ts narrow container">
            <a href="../" class="item">ArOZ Onlineβ</a>
        </div>
    </nav>
	<br>
<div class="ts container">
<div class="ts message">
    <div class="header">ArOZ Online BETA Modular Help Page</div>
    <p>This page is not the help page of the ArOZ Online Beta System. This is the combination of README.txt included in the modules.<br>
	Each modules has their own API or information that the developer want you to know. In this page, you can read them all without searching them one by one.</p>
	<p><i class="terminal icon"></i>For developer of modules, please place your README.txt under module_name/README.txt so this simple PHP script can scan them out, thanks :)</p>
</div>
<?php
$function_exclude = ["Help","img","script"];
$folders = glob("../*", GLOB_BRACE);
foreach ($folders as $folder){
	if (in_array(str_replace("../","",$folder),$function_exclude) !== true && is_dir($folder)){
		//echo str_replace("../","",$folder) . '<br>';
		$foldername = str_replace("../","",$folder);
		if (file_exists($folder . '/README.txt')){
			$readme = file_get_contents($folder . '/README.txt');
			$readme = str_replace("&","&amp",$readme);
			$readme = str_replace(" ","&nbsp",$readme);
			$readme = str_replace("<","&lt",$readme);
			$readme = str_replace(">","&gt",$readme);
			//$readme = str_replace('"',"&quot",$readme);
			//$readme = str_replace("'","&apos",$readme);
			$readme = str_replace("(C)","<i class='copyright icon'></i>",$readme);
			$readme = str_replace("(R)","<i class='registered icon'></i>",$readme);
			$readme = str_replace("(CC)","<i class='creative commons icon'></i>",$readme);
			$readme = str_replace("![/img]","></img>",$readme);
			$readme = str_replace("![//img]","<img class='ts image' src=",$readme);
			$readme = str_replace("\n","<br>",$readme);
			echo '<div class="ts segment" style="font-family: monospace;"><i class="file text outline icon"></i>'.$foldername.'/README.txt<br>' . $readme . '</div><br>';
		}
	}
}
?>
</div>
</body>
</html>