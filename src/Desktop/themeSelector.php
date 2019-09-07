<?php
include_once("../auth.php");
if (isset($_GET['load'])){
    //Load color blocks from files.
    $confs = glob("script/theme/index/*.json");
    $result = [];
    foreach ($confs as $conf){
        $themeName = basename($conf,".json");
        $themeContent = file_get_contents($conf);
        array_push($result,[$themeName,$themeContent]);
    }
    header('Content-Type: application/json');
    echo json_encode($result);
    exit(0);
}else if (isset($_GET['setTheme']) && !empty($_GET['setTheme'])){
    include_once("../SystemAOB/functions/personalization/configIO.php");
    $targetFile = $configPath . "function_bar.config";
    $sourceFile = "script/theme/conf/" . $_GET['setTheme'] . ".config";
    if (!file_exists($sourceFile)){
        die("ERROR. Theme config file not found.");
    }
    file_put_contents($targetFile,file_get_contents($sourceFile));
    echo "DONE";
    exit(0);
}
?>
<html>
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
        <title>Theme Selector</title>
        <link rel="stylesheet" href="../script/tocas/tocas.css">
    	<script src="../script/tocas/tocas.js"></script>
    	<script src="../script/jquery.min.js"></script>
    	<script src="../script/ao_module.js"></script>
    	<style>
        	body{
        	    background-color:#f2f2f2;
        	}
    	    .previewBlock{
    	        height:300px;
    	        width:100%;
    	        background:white;
    	        background-size: 100% 100%;
    	    }
    	    .demoMenuBar{
    	        height:25px;
    	        width:100%;
    	        position:absolute;
    	        left:0px;
    	        bottom:0px;
    	        background-color:#333;
    	        color:white;
    	        padding-left:20px;
    	    }
    	    .whiteFont{
    	        color:White;
    	    }
    	    .menuBarButton{
    	        height:25px;
    	        width:45px;
    	        cursor:pointer;
    	        margin:0px !important;
    	    }
    	    .menuBarButton.active{
    	        background-color:#222;
    	    }
    	    .demoStartupMenu{
    	        position:absolute;
    	        left:0px;
    	        bottom:25px;
    	        height:220px;
    	        width:160px;
    	        background-color:rgba(48,48,48,0.7);
    	    }
    	    .dummyInterface{
    	        background-color:white;
    	        position:absolute;
    	        background-size: 100% 100%;
    	    }
    	    .demoWindow{
    	        position:absolute;
    	        top:38px;
    	        left:187px;
    	        width:250px;
    	        height:150px;
    	        background-color:white;
    	    }
    	    .demoFloatWindow{
    	        width:100%;
    	        height:8px;
    	        background-color:rgba(48,48,48,0.7);
    	    }
    	    .dummyWindowContent{
    	        position:absolute;
    	        top:8px;
    	        width:100%;
    	        height: calc(100% - 8px);
    	        background-image:url(img/dummy/fsexp.png);
    	        background-size: 100% 100%;
    	    }
    	    #cpRender{
    	        border: 1px solid #333;
    	    }
    	    .colorblock{
    	        width:80px;
    	        height:80px;
    	        margin-right:5px;
    	        cursor:pointer;
    	        border: 1px solid transparent;
    	    }
    	    .colorblock:hover{
    	        border: 1px solid #2dadfc;
    	    }
    	    .colorBlockSelector{
    	        overflow-x: scroll;
    	        overflow-y: hidden;
    	        height:100px !important;
    	        white-space: nowrap;
    	    }
    	</style>
    </head>
    <body>
        <div class="previewBlock">
            <div class="demoStartupMenu">
                <div class="dummyInterface" style="left:10px;top:10px;width:90px;height:200px;background-image:url(img/dummy/listmenu.png);"></div>
                <div class="dummyInterface" style="right:10px;top:10px;width:40px;height:40px;background-image:url(img/dummy/user.png);"></div>
                <div class="dummyInterface" style="right:10px;bottom:10px;width:40px;height:14px;background-color: #292929;background-image:url(img/dummy/shutdown.png);"></div>
            </div>
            <div class="demoWindow">
                <div class="demoFloatWindow"></div>
                <div class="dummyWindowContent"></div>
            </div>
            <div class="demoMenuBar">
                <button class="menuBarButton" style="width: 55px;"><i class="cloud icon whiteFont"></i></button>
                <button class="menuBarButton active"><i class="folder icon whiteFont"></i></button>
            </div>
        </div>
        <div class="ts container">
            <div class="ts fitted segment">Please select a color palette from the options below.</div>
            <div id="colorBlockDisplay" class="colorBlockSelector">
            </div>
            
        </div>
        
        <div style="display: none;">
            <canvas id="cpRender" width="80" height="80"></canvas>
        </div>
        <script>
            var currentDesktopTheme = "default";
            var username = localStorage.getItem("ArOZusername");
            if (localStorage.getItem("desktop-theme-" + username) !== null){
                currentDesktopTheme = localStorage.getItem("desktop-theme-" + username);
            }
            
            //Load aomodule events
            if (ao_module_virtualDesktop){
                ao_module_setWindowIcon("eyedropper");
                ao_module_setWindowTitle("Personalization - Theme Color");
                ao_module_setFixedWindowSize();
                ao_module_setWindowSize(640,460, true);
            }
            
            //Get the current theme and display the first image in the preview window
            $.get("getBackgroundThemes.php",function(data){
                for (var i =0; i < data.length; i++){
                    if (data[i][0] == currentDesktopTheme){
                        var imagePath = data[i][1] + "/0." + data[i][3];
                        $(".previewBlock").css("background-image","url(" + imagePath + ")");
                    }
                }
            });
            
        function changePreviewThemeColor(theme, button, activeButton){
            $(".demoMenuBar").css("background-color",theme);
            $(".demoStartupMenu").css("background-color",theme);
             $(".menuBarButton").css("background-color",button);
            $(".menuBarButton.active").css("background-color",activeButton);
            $(".demoFloatWindow").css("background-color",theme);
        }
        
        function createColorBlocks(themeName, theme, button, activeButton){
            var canvas = document.getElementById('cpRender');
            if (canvas.getContext) {
              var ctx = canvas.getContext('2d');
                //Clear the old drawing
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                //Fill in new color blocks
                ctx.fillStyle = theme;
                ctx.fillRect(0, 0, 80, 27);
                ctx.fillStyle = button;
                ctx.fillRect(0, 27, 80, 26);
                ctx.fillStyle = activeButton;
                ctx.fillRect(0, 53, 80, 27);
                ctx.fillStyle = "white";
                ctx.font = "10px Arial";
                ctx.fillText(themeName, 10, 70);
                var dataURL = canvas.toDataURL();
                $("#colorBlockDisplay").append('<img class="colorblock" name="' + themeName  + '" src="' + dataURL + '" theme="' + theme + '" button="' + button + '" act="' + activeButton  +'" onmouseover="loadPreviewObject(this);"  onClick="selectThisColorBlock(this);" >');
            } else {
                alert("Canvas not supported on this browser.")
            }
        }
        
        //Select this object as the color block
        function selectThisColorBlock(object){
            var themeName = $(object).attr("name");
            if (confirm("Change theme to " + themeName + ". Confirm?")){
                $.get("themeSelector.php?setTheme=" + themeName,function(result){
                   if (result.includes("ERROR") == false){
                       ao_module_msgbox("Refresh is needed for the settings to be effective. <br><a onClick='window.location.reload(true);'>Refresh Now</a>" ,"<i class='refresh icon'></i> Refresh Pending","",false);
                   }else{
                       ao_module_msgbox("Theme Selector return the following error: " + result,"Unable to set Theme");
                   }
                });
            }
            
        }
        
        //Load all the theme from the page
        $.get("themeSelector.php?load",function(data){
            for (var i =0; i < data.length; i++){
                var themeName = data[i][0];
                var themeColor = JSON.parse(data[i][1]);
                //console.log(themeColor);
                createColorBlocks(themeName,themeColor[0],themeColor[1],themeColor[2]);
            }
        });
        
        for (var i= 0; i < 10; i++){
           // 
        }

        function loadPreviewObject(object){
             var theme = $(object).attr("theme");
             var button = $(object).attr("button");
             var activeButton = $(object).attr("act");
             changePreviewThemeColor(theme,button,activeButton);
        }
        </script>
    </body>
</html>