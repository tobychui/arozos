<?php
include '../../auth.php';
?>
<html>
<head>
<!-- Redirect to this page in iframe inorder to let the floatWindow host system kill this window-->
<title>KillProcess</title>
<script src="../../script/jquery.min.js"></script>
<style>
.center {
    position: absolute;
    width: 300px;
    height: 50px;
    top: 50%;
    left: 47%;
    margin-left: -50px; /* margin is -0.5 * dimension */
    margin-top: -25px; 
	color:white;
}​
</style>
</head>
<body style="background-color:black;">
<div class='fullscreenDiv'>
    <div class="center">You can now close this tab.</div>
</div>​
<script>
var windowID = $(window.frameElement).parent().attr("id");
parent.closeWindow(windowID);
</script>
</body>
</head>