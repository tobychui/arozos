<?php
include '../auth.php';
?>
<html>
<head>
<meta name="apple-mobile-web-app-capable" content="yes" />

<meta name="viewport" content="width=device-width, initial-scale=0.8, shrink-to-fit=no">
<html>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<title>SYSTEM ArOZβ</title>
</head>
<body>
<div class="ts pointing secondary menu">
    <a class="item" href="../"><i class="chevron left icon"></i></a>
    <a class="item" href="index.php";><i class="server icon"></i>SYSTEM</a>
    <a class="active item" href="status.php"><i class="area chart icon"></i>Status</a>
</div>
<iframe src="functions\system_statistic\index.php" width="100%" height="100%" frameBorder="0">Browser not compatible.</iframe>
</body>
