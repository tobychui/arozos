<?php
include '../auth.php';
?>
<html>
<body>
Now Loading...
<div id="DATA_MODULENAME"><?php echo dirname(str_replace("\\","/",__FILE__)); ?></div>
<script src="../script/jquery.min.js"></script>
<script src="../script/ao_module.js"></script>
<script>
var moduleName = $("#DATA_MODULENAME").text().trim().split("/").pop();
var uid = (new Date()).getTime();
ao_module_newfw( moduleName + "/index.php","WriterA","file text outline", uid,1050,550,undefined,undefined,true,false);
</script>
</body>
</html>