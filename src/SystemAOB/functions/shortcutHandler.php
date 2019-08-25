<?php
//This is a simple script to handle shortcut opening
/*
This script is used to read ArOZ Online Shortcut files (aka .shortcut)
and redirect the users to the content labeled in the shortcut file

This script works in both VDI and non-VDI mode, to use this script, pass the shortcut file into this script using standard ArOZ file info transfer method.
(aka filepath and filename GET variable in URL)
*/
include_once("../../auth.php");
if(isset($_GET['filepath']) && $_GET['filepath'] != ""){
    if (isset($_GET['filename']) && $_GET['filename'] != ""){
        $filepath = $_GET['filepath'];
        $filename = $_GET['filename'];
        $filepath = str_replace("../","", $filepath);
        $filepath = str_replace("./","", $filepath);
        //path now should start with the location relative to AOR (e.g. Desktop/file.txt) or external storage (e.g. /media/storage1/file.txt)
        if (strpos($filepath,"/media") === 0){
            $filepath = $filepath;
        }else{
            $filepath = "../../" . $filepath;
        }
        $content = file_get_contents($filepath);
        $data = explode(PHP_EOL,$content);
        $openMode = "default";
        switch ($data[0]){
            case "module":
                $moduleName = $data[2];
                if (file_exists("../../" . $moduleName)){
                    //This module exists
                    if (file_exists("../../" . $moduleName . "/floatWindow.php")){
                        $openMode = "fw";
                        $redirectTarget = $moduleName;
                    }else{
                        $redirectTarget = $moduleName;
                    }
                }else{
                    echo "ERROR. The target module doesn't exists.";
                    exit(0);
                }
                break;
            case "foldershrct":
                $openMode = "folder";
                if (file_exists("../../" . $data[2])){
                    $redirectTarget = $data[2];
                }else{
                    die("ERROR. Target folder no longer exists.");
                }
                break;
            case "url":
                $openMode = "url";
                $redirectTarget = $data[2];
                break;
            case "script":
                $openMode = "default";
                $redirectTarget = $data[2];
                break;
        }
    }else{
        die("ERROR. Undefined filename");
    }
}else{
    die("ERROR. Undefined filepath");
}
?>
<html>
    <head>
        <title>Shortcut Handler</title>
        <script src="../../script/jquery.min.js"></script>
        <script type='text/javascript' src="../../script/ao_module.js"></script>
        <link rel="stylesheet" href="../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../script/tocas/tocas.js"></script>
        <style>
            body{
                background-color:white !important;
                color:black !important;
            }
            .center {
              position:fixed;
              top:42%;
              left:45%;
              padding: 10px;
            }
        </style>
    </head>
    <body>
        <div class="center" align="center">
            <p>Redirecting in progress...</p>
            <div id="openMode"><?php echo $openMode; ?></div>
            <div id="redirectTarget"><?php echo $redirectTarget; ?></div>
        </div>
        <script>
            var openMode = $("#openMode").text().trim();
            var redirectTarget = $("#redirectTarget").text().trim();
            $(document).ready(function(){
                if (openMode == "default"){
                    if(ao_module_virtualDesktop){
                        if (ao_module_newfw(redirectTarget,"Shortcut Redirect","external share",ao_module_utils.getRandomUID())){
                            closeWindow();
                        }
                        
                    }else{
                        window.location.href = ("../../" + redirectTarget);
                    }
                }else if (openMode == "fw"){
                    if(ao_module_virtualDesktop){
                        parent.LaunchFloatWindowFromModule(redirectTarget,true);
                        closeWindow();
                    }else{
                        window.location.href = ("../../" + redirectTarget);
                    }
                    
                }else if (openMode == "folder"){
                    if (ao_module_virtualDesktop){
                        if(ao_module_openPath(redirectTarget)){
                            closeWindow();
                        }
                    }else{
                        window.location.href = "file_system/index.php?controlLv=2&subdir=" + redirectTarget;
                    }
                    
                }else if (openMode == "url"){
                     if (ao_module_virtualDesktop){
                        window.open(redirectTarget);
                        closeWindow();
                     }else{
                        window.location.href = redirectTarget;
                     }
                    
                }
            });
            
            function closeWindow(){
                ao_module_close();
            }
        </script>
    </body>
</html>



