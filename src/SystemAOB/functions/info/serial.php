<?php
include_once("../../../auth.php");
if (file_exists($sysConfigDir . "device_identity.config")){
    $uuid = file_get_contents($sysConfigDir . "device_identity.config");
}

?>
<html>
    <head>
    <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>ArOZ Online - System Serial</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    </head>
    <body style="background-color:#f9f9f9;">
        <br><br>
        <div class="ts container">
            Work In Progress
        </div>
        
    </body>
</html>