<?php
include_once("../../../auth.php");
?>
<html>
    <head>
        <title>Advanced System Configuration</title>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
         <script src="../../../script/ao_module.js"></script>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            a{
                cursor:pointer;
            }
        </style>
    </head>
    <body>
        <br><br>
	    <div class="ts container">
			<div class="ts segment">
				<div class="ts header">
					<i class="setting icon"></i>Advanced System Configuration
					<div class="sub header">Change the system configuration for critical system modules.</div>
				</div>
			</div>
			<div class="ts inverted warning segment">
                <p><i class="caution sign icon"></i>WARNING! The configuration listed in the table below might be critical to system operations. Invalid settings might lead to system corruption or data lost. Please make sure you know what you are doing when trying to edit any of the settings below and edit at your own risk.</p>
            </div>
			<div class="ts segment">
			    <table class="ts table">
                    <thead>
                        <tr>
                            <th>Config Name (sysconf/*.config)</th>
                            <th>Launch Edit Window</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php
        				    $configs = glob("sysconf/*.config");
        				    foreach ($configs as $config){
        				        echo '<tr>
                                        <td>' . basename($config) . '</td>
                                        <td><a class="configEditor" configName="' .basename($config,".config") .'"><i class="edit icon"></i>Edit</a></td>
                                    </tr>';
        				    }
        				
        				?>
                    </tbody>
                </table>
			</div>
		</div>
		<script>
		    $(".configEditor").on("click",function(){
		        var configName = $(this).attr("configName");
		        if (ao_module_virtualDesktop){
		            //Launch in floatWindow
		             ao_module_newfw("SystemAOB/functions/personalization/autoConfig.php?configName=" + configName,configName.toUpperCase() + "  - AutoConfig", "setting", ao_module_utils.getRandomUID(),600,780);
		        }else{
		            //launch with new window / tab
		           window.open("autoConfig.php?configName=" + configName);
		        }
		    });
		</script>
	</body>
</html>