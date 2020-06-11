<?php
include_once("../auth.php");
if (isset($_GET['filename']) && $_GET['filepath']){
	header("Location: index.php?filename=" . $_GET['filename'] . "&filepath=" . $_GET['filepath']);
}
?>
<html>
<body>
Now Loading...
<script>
parent.newEmbededWindow("<?php echo basename(__DIR__); ?>/index.php","aPrint Studio","cube", Date.now(),400,500,undefined,undefined,undefined,true);
</script>
</body>
</html>