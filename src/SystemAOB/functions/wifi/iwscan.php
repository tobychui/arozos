<?php
include_once("../../../auth.php");
include_once("../personalization/configIO.php");
?>
<html>
    <head>
        <title>iwscan report</title>
        <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
        <style>
            .fullscreen{
                width:100%;
                height:100%;
            }
            body{
                padding:10px;
                padding-bottom:30px;
            }
        </style>
    </head>
    <body>
		<?php
			if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
				//Get setting from the user configuration
				$configs = getConfig("encoding",true);
				putenv('LANG=en_US.UTF-8'); 
				exec("ipconfig",$out);
				echo ' <div class="fullscreen ts input">
						<textarea class="fullscreen" readonly>';
				foreach ($out as $line){
					if ($configs["winHostEncoding"][3] == "true"){
						echo mb_convert_encoding($line, "UTF-8",$configs["forceEncodingType"][3]) . PHP_EOL;
					}else{
						echo $line . PHP_EOL;
					}
					
				}
				echo '</textarea>
						</div>';
				exit(0);
			}
		?>
        <div class="fullscreen ts input">
            <textarea class="fullscreen" readonly>
            <?php
                $content = trim(shell_exec("sudo iw wlan0 scan"));
                if($content == ""){
                    echo "Interface not found or disabled. Please make sure you have wlan0 enabled.";
                }else{
                    echo $content;
                }
            ?>
            </textarea>
        </div>
       
    </body>
</html>