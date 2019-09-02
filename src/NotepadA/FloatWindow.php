<?php
include '../auth.php';
?>
<html>
<body>
Now Loading...
<script src="FloatWindow.js"></script>
<script>
var uid = "notepadA";
var fw = new FloatWindow("index.php","NotepadA","code", uid,1080,600,0,0,undefined,true);
fw.launch();
</script>
</body>
</html>