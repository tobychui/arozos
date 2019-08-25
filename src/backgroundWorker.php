<?php
include 'auth.php';
?>
<html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="script/tocas/tocas.css">
<script src="script/tocas/tocas.js"></script>
<script src="script/jquery.min.js"></script>
</head>
<body>
<nav class="ts attached inverted borderless large menu">
    <div class="ts narrow container">
        <a href="" class="item">Background Worker</a>
    </div>
</nav>
<audio src="img/notification.mp3" autoplay></audio>
<?php
$folders = glob("*", GLOB_BRACE);
$scripts = [];
$workers = [];
foreach ($folders as $folder){
	//echo $folder . '<br>';
	if (file_exists($folder . "/bgworker.php")){
		echo "<div id='$folder' style='height:300px;width:100%;overflow-y: scroll;'></div>";
		array_push($workers,$folder);
		if (file_exists($folder . "/bgworker.js")){
			array_push($scripts,$folder . "/bgworker.js");
		}
		echo '<div class="ts horizontal divider"></div>';
	}
}
?>

<script>
var workers = <?php echo json_encode($workers); ?>;
var scripts = <?php echo json_encode($scripts); ?>;
for (var i=0;i<workers.length;i++){
	$("#" + workers[i]).load(workers[i] + '/bgworker.php');
}
$(document).ready(function(){
	for (var j=0;j<scripts.length;j++){
		$.getScript(scripts[j], function(){
			console.log(scripts[j] + "is loaded.");
		});
	}
	
});
</script>
</body>
</html>