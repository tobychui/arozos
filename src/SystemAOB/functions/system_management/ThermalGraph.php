<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background-color: rgb(247, 247, 247);">
<div class="ts container">
<br>
<div class="ts segment">
	<div class="ts header">
    System Thermal Graph
    <div class="sub header">The thermal information of the host system.</div>
	</div>
</div>
<div class="ts divider"></div>
<p  style="display:inline;">System Thermal Info
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    echo '<div class="ts secondary message">
		<div class="header">Host Operation System not supported</div>
		<p>This function is currently not supported on Windows Host.<br> If you are sure this function should be available, please check if your ArOZ Online system is up to date.</p>
	</div>';
}else{
	echo '<iframe src="../system_statistic/tempGraph.php" width="100%" height="350px"></iframe>';
	
}

?>
<div class="ts divider"></div>
<br><br><br>
</div>
</body>
</html>