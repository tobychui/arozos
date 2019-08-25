<?php
include '../../../auth.php';
?>
<?php
	header("Status: 301 Moved Permanently");
    header("Location:index.php?". $_SERVER['QUERY_STRING'] . "&finishing=embedded");
    exit;
?>