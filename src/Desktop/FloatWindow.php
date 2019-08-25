<?php
include '../auth.php';
?>
<html>
<body>
Now Loading...
<script src="FloatWindow.js"></script>
<script>
var uid = "hostdrive";
var fw = new FloatWindow("myHost.php","My Host","disk outline", uid,1050,650,undefined,undefined,undefined,true,true);
fw.launch();
</script>
</body>
</html>