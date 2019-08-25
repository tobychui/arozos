<?php
include '../../../auth.php';
?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>ArOZ Online - System Information</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body style="background-color:#f9f9f9;">
    <br><br>
    <div class="ts narrow container">
        <div class="ts card">
            <div class="center aligned padded content">
                <div class="ts large header">
                    ArOZ Online System
                    <div class="smaller sub header">
                        <?php
							echo "Version Code: ".file_get_contents("version.inf");
						?>
                    </div>
                </div>
            </div>
            <div class="image">
                <img src="banner.png">
            </div>
            <div class="center aligned padded content">
                <p>Developed under ArOZ Project feat. IMUS Laboratory</p>
                <p>Initiated by Toby Chui since 2016, special thanks for Alan Yeung, RubMing and others who help with this project.</p>
                <div class="ts section divider"></div>
                <a href="mailto:imuslab@gmail.com" target="_blank"><i class="mail outline icon"></i>imuslab@gmail.com</a> / <a href="http://imuslab.com"><i class="home icon"></i>http://imuslab.com</a>
            </div>
        </div>
        <div class="ts left aligned basic small message">
            <p>This system is licensed under IMUS License and ArOZ License. For indivdual modules, please contact the developer of modules for more information on module license information.</p>
        </div>
    </div>
    <br><br>
</body>
</html>