<?php
include '../auth.php';
?>
<html>
<body>
Now Loading...
<script src="FloatWindow.js"></script>
<script>
var uid = (new Date()).getTime();
var fw = new FloatWindow("index.php?mode=fw","Audio","music", uid,545,765,undefined,undefined,undefined,true);
fw.launch();
</script>
</body>
</html>