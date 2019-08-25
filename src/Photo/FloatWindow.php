<?php
include_once("../auth.php");

?>
<html>
<head>
<script src="../script/FloatWindow.js"></script>
<script>
var fw = new FloatWindow("index.php?mode=fw","Audio","music", (new Date().getTime()),1050,700,undefined,undefined,true,true);
fw.launch();
</script>
</head>
<body>
Starting FloatWindow...
</body>
</html>