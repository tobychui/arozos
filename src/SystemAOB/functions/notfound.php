<?php
header("HTTP/1.0 404 Not Found");
?>
<html>
    <head>
    <!-- Redirect to this page with a simple html script if you do not want to show a particular directory -->
    <title>Not Found :(</title>
    <link rel="stylesheet" href="../../script/tocas/tocas.css">
    </head>
    <body>
        <br><br><br>
        <div class="ts container">
            <div class="ts basic padded dashed slate">
                <i class="remove icon"></i>
                <span class="header">404 NOT FOUND</span>
                <span class="description">The files / directory that you are navigating cannot be found on the server.</span>
            </div>
            <p><?php echo "Page requested on: " . date("Y/m/d h:i:s a") . " " . date_default_timezone_get();?></p>
        </div>
    </body>
</html>