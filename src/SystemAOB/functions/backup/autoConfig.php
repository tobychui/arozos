<?php
include_once("../../../auth.php");
//This is a generator for aroz system configuration files
//Do not use this for configuration of user settings.
if (isset($_GET['configName']) && $_GET['configName'] != ""){
    //Generate configuration according to config name
    //include_once($rootPath . "SystemAOB/functions/user/userIsolation.php");
    //$configPath =  $userConfigDirectory . "SystemAOB/functions/personalization/" . $_GET['configName'] . ".config";
    $configPath =  "config/" . $_GET['configName'] . ".config";
    if (file_exists($configPath)){
        //Config found in user directory. Go ahead and create UI for it.
        $configContent = file_get_contents($configPath);
        $config = json_decode($configContent);
    }else{
        die("ERROR. Config cannot be found.");
    }
}else{
    die("ERROR. Undefined configName for dynamic template generation.");
}
?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
        <title><?php echo $_GET['configName']; ?> - AutoConfig</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    </head>
    <body>
        <br>
        <div class="ts container">
        <div class="ts segment">
            <form class="ts form" action="settingModifyHandler.php" method="POST">
                <input style="display:none;" name="autoConfigBaseConfigurationFilename" type="text" value="<?php echo $_GET['configName'];?>">
                <?php
                    function fillInfo($dom, $name, $title, $description, $type, $defaultValue){
                        $box = str_replace("{name}",$name,$dom);
                        $box = str_replace("{title}",$title,$box);
                        $box = str_replace("{description}",$description,$box);
                        $box = str_replace("{type}",$type,$box);
                        $box = str_replace("{defaultValue}",$defaultValue,$box);
                        return $box;
                    }
                
                    foreach ($config as $key => $value) {
                        //For each config settings, render the template for this.
                        $name = $key;
                        $title = $value[0];
                        $description = $value[1];
                        $type = $value[2];
                        $defaultValue = $value[3];
                        
                        if ($type == "boolean"){
                            //Modify the option for checkbox
                            if ($defaultValue == "true"){
                                $defaultValue = "checked";
                            }else{
                                $defaultValue = "";
                            }
                        }
                        
                        
                        //For each setting Type, load it from templates.
                        if (file_exists("templates/$type.html")){
                            echo fillInfo(file_get_contents("templates/$type.html"),$name,$title,$description,$type,$defaultValue);
                        }else{
                            echo "templates/$type.html" . " not found <br>";
                        }
                   }
                   
                ?>
                <input type="submit" class="ts primary button" value="Update"></input>
            </form>
        </div>
		<?php
		if (isset($_GET['update'])){
			echo '<div id="feedback" class="ts inverted positive segment" style="display:none;">
						<p><i class="checkmark icon"></i>Configuration updated successfully</p>
					</div>';
		}
		?>
		<br><br>
        <script>
            var focusedInput = "";
            //Allow for selecting a file in the system
            function selectFile(object){
                var objectUID = $(object).parent().find("input").attr("id");
                focusedInput = objectUID;
                if (ao_module_virtualDesktop){
                    var uid = ao_module_utils.getRandomUID();
                    ao_module_openFileSelector(uid,"addFileFromSelector",undefined,undefined,false);
                }else{
                    var uid = ao_module_utils.getRandomUID();
                    ao_module_openFileSelectorTab(uid,"../../../",false,"file",addFileFromSelector);
                }
            }
            
            function addFileFromSelector(fileData){
                result = JSON.parse(fileData);
                for (var i=0; i < result.length; i++){
                    var filename = result[i].filename;
                    var filepath = result[i].filepath;
                    $("#" + focusedInput).parent().find("input").val(filepath);
                }
            }
			
			$(document).ready(function(){
				if ($("#feedback").length > 0){
					$("#feedback").slideDown().delay(3000).slideUp();
				}
			});
        </script>
    </body>
</html>