<?php
include_once("../../../auth.php");

?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>ArOZ Online - View Licenses</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    </head>
    <body>
        <br><br>
        <div class="ts container">
            <div class="ts segment">
                <div class="ts header">
                    <i class="leaf icon"></i>System Licenses
                    <div class="sub header">View all the licenses of software that powers the ArOZ Online Cloud Platform</div>
                </div>
            </div>
            <?php
                $licenses = glob("License/*.txt");
                foreach ($licenses as $license){
                    $licenseName = basename($license,".txt");
                    $content = file_get_contents($license);
                    $content = nl2br($content);
                    echo '<div class="ts segment"><h1 class="ts sub header">' . $licenseName . ' License </h1>' . $content . '</div>';
                }
            
            ?>
        </div>
        <br><br>
    </body>
</html>