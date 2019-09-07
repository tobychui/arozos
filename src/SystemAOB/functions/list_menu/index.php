<?php
include_once("../../../auth.php");
include_once("hideApps.php");
$hideModules = getHideAppList(); //See hideApp.config for more hidden apps config
if (isset($_GET["request"]) && $_GET["request"] == "true"){
	//This page is used for data requesting
	$AOBroot = $rootPath;
	if (isset($_GET['contentType']) == false){
		echo 'Request Mode enabled. Page loading disabled by default. <br>
		Please use the following command in this page to optain information regarding the List Menu.<br>
		contentType=webapp/system<br>';
	}else{
		$contentType = $_GET['contentType'];
		if ($contentType == "webapp"){
			$modules = glob("$AOBroot*");
			$webappList = [];
			foreach ($modules as $webapp){
				if (is_dir($webapp) && in_array(str_replace($AOBroot,"",$webapp),$hideModules) == false){
					if (file_exists($webapp . "/index.php") || file_exists($webapp . "/index.html")){
						$emSupport = false;
						if (file_exists($webapp ."/embedded.php")){
							$emSupport = true;
						}
						$fwSupport = false;
						if (file_exists($webapp . "/FloatWindow.php")){
							$fwSupport = true;
						}
						$displayName = str_replace($AOBroot,"",$webapp);
						$iconPath = $webapp . "/img/function_icon.png";
						if (file_exists($webapp . "/img/small_icon.png")){
						   $iconPath = $webapp . "/img/small_icon.png"; 
						}
						array_push($webappList,[$displayName,$webapp . "/",$emSupport,$fwSupport,$iconPath]);
					}
					
				}
				
			}
			header('Content-Type: application/json');
			echo json_encode($webappList);
			
		}else if ($contentType == "system"){
			$utilDir = $AOBroot . "SystemAOB/utilities/";
			$iconDir = $utilDir . "sysicon/";
			$utils = glob($utilDir . "*.php");
			$utillist = [];
			foreach ($utils as $tool){
			    $icon = $iconDir . "noname.png";
			    if (file_exists($iconDir . basename($tool,".php") .".png")){
			        $icon = $iconDir . basename($tool,".php") .".png";
			    }
			    array_push($utillist,[basename($tool,".php"),$utilDir . $tool,$icon]);
			}
			header('Content-Type: application/json');
			echo json_encode($utillist);
		}else{
			echo "Unknown content type value.";
		}
		
	}
	exit();
}

$iconPath = "../personalization/usericon/";
if (file_exists($iconPath . $_SESSION['login'] . ".png")){
	$imagePath = $iconPath . $_SESSION['login'] . ".png";
}else if (file_exists($iconPath . $_SESSION['login'] . ".jpg")){
	$imagePath = $iconPath . $_SESSION['login'] . ".jpg";
}else if (file_exists($iconPath . $_SESSION['login'] . ".gif")){
	$imagePath = $iconPath . $_SESSION['login'] . ".gif";
}else if (file_exists($iconPath . $_SESSION['login'] . ".jpeg")){
	$imagePath = $iconPath . $_SESSION['login'] . ".jpeg";
}else{
	$imagePath = $iconPath . "user.png";
}
?>
<html>
    <head>
        <title>
            List Menu
        </title>
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
        <style>
            body{
                background:rgba(46,46,46,0.7);
				border-radius: 3px 3px 0px 0px;
            }
            .appList{
                background-color:#f5f5f5;
                position:fixed;
                left:10px;
                top:15px;
                width:66%;
                bottom:20px;
            }
            .rightList{
                position:fixed;
                padding:10px;
                right:10px;
                top:10px;
                height:510px;
                width:27%;
            }
            .shutdown{
                color:white;
                border: 1px solid white;
                padding-left:8px;
                padding-top:2px;
                padding-bottom:2px;
                padding-right:3px;
                position:absolute;
                left:0px;
                bottom: 0px;
                cursor: pointer;
                background:rgba(46,46,46,0.7);
                letter-spacing: 1px;
                font-size:80% !important;
            }
            .shutdown:hover{
                background:rgba(255,255,255,0.3) !important;
            }
            .sidebar.item{
                color:white !important;
                padding-left:5px !important;
                padding-top:6px !important;
                padding-bottom:6px !important;
                cursor: pointer !important;
                font-size:85% !important;
            }
            .sidebar.item:hover{
                background:rgba(255,255,255,0.3);
                border-radius: 2px;
            }
            #moduleList{
                height:90%;
                overflow-y:auto;
            }
            .module.item{
                border: 1px solid transparent;
                margin-right:5px !important;
            }
            .module.item:hover{
                border: 1px solid #C8D8E9;
                background-color:#DDEAFB !important;
                
            }
            .sidebar{
                color:white;
                padding-left:0px;
                padding-top:3px;
                padding-bottom:4px;
            }
            .searchbar{
                
            }
			#shutdownMenu{
				position:fixed;
				right:0px;
				background-color:#282828;
				z-index:10;
				padding-top:14px;
				padding-bottom: 14px;
			}
			.selectable{
				padding-left:10px !important;
				padding-right:5px !important;
				padding-top:5px !important;
				padding-bottom:5px !important;
				cursor: pointer;
			}
			.selectable:hover{
				background-color:#404040;
				
			}
			.textwrap{
			    text-overflow: ellipsis !important;
			    display:block !important;
			    overflow-wrap: break-word; 
			    word-break: break-all;
			}
        </style>
    </head>
    <body>
        <div class="appList">
            <div id="moduleList" class="ts middle aligned selection list">
                
            </div>
            <div class="searchbar">
                <div class="ts fluid small icon input">
                    <input id="searchInput" type="text" placeholder="Search">
                    <i class="search icon"></i>
                </div>
            </div>
        </div>
        <div class="rightList">
            <img class="ts small bordered image" style="border: 3px solid white;" src="<?php echo $imagePath;?>">
            <div id="username" class="sidebar"></div>
            <div class="ts list">
                <div class="sidebar item" onClick="openMediaFolder(1);">Music</div>
                <div class="sidebar item" onClick="openMediaFolder(2);">Video</div>
                <div class="sidebar item" onClick="openMediaFolder(3);">Pictures</div>
                <div class="sidebar item" onClick="openMediaFolder(4);">Documents</div>
                <div class="ts divider"></div>
                <div class="sidebar item" onClick="myComputer();"><i class="disk outline icon"></i>  My Host</div>
                <div class="sidebar item" onClick="AOR();"><i class="folder open outline icon"></i>  File View</div>
                <div class="sidebar item" onClick="controlPanel();"><i class="setting icon"></i>  Settings</div>
                <div class="ts divider"></div>
                <div class="sidebar item" onClick="window.open('http://aroz.online');">Help / Support</div>
            </div>
            <div class="shutdown" onClick="toggleShutDownMenu();">
                Shut down <i class="caret right icon" style="border-left: 1px solid white;"></i>
            </div>
            <div class="selectionArrow">
                <i class = ""></i>
            </div>
        </div>
		<div id="shutdownMenu" style="display:none;">
			<div class="ts list">
				<div class="selectable item" style="color:white !important;" onClick="Logout();">Logout</div>
				<div class="selectable item" style="color:white !important;" onClick="RestartApache();">Restart Apache</div>
				<div class="selectable item" style="color:white !important;" onClick="Reboot();">Reboot</div>
				<div class="selectable item" style="color:white !important;" onCLick="Shutdown();">Shutdown</div>
			</div>
		</div>
        <script>
            var moduleTemplate = '\
                <div class="module item" fw="{fw}" embedded="{embedded}" name="{name}" onClick="launchModule(this);">\
                    <img class="ts avatar image" src="{moduleIcon}">\
                    <div class="content">\
                        <div class="header">{moduleName}</div>\
                    </div>\
                </div>';
            var systoolTemplate = '\
                <div class="module item" name="{name}" path="{path}" onClick="launchTool(this);">\
                    <img class="ts avatar image" src="{toolIcon}">\
                    <div class="content">\
                        <div class="header">{tool}</div>\
                    </div>\
                </div>';
            var toggleSystemTools = '\
                <div class="module item" onClick="changeMode(this);">\
                    <div class="content">\
                        <div class="header">{label}</div>\
                    </div>\
                </div>';
            var currentMode = 0; //0 = WebApp List, 1 = System Tools
            var is_safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
			if (!is_safari){
				//If this is not Safari, hide the menu immediately
				parent.$('#powerMenu').hide();
			}
			$("body").css("background",parent.themeColor["theme"]);
			$("#shutdownMenu").css("background-color",parent.themeColor["active"]);
			$(document).ready(function(){
			    loadModules();
                updateUserName();
                
                if (is_safari){
                    //Safari requie the DIV to be visiable in order to use AJAX.load function.
                    parent.$('#powerMenu').hide();
                }
			});
			
			window.addEventListener("focus", function(event) 
            { 
                $("#searchInput").focus();
            }, false);

			//When the user type anything in the input box of the list menu
			var searchTimeout;
			$("#searchInput").on("keyup",function(e){
			    if (e.keyCode == 13){
			        //Enter is pressed. Perform action
			        if ($(".preselect").length > 0){
			            openThisResult($(".preselect")[0]);
			        }
			    }else{
			        //Other things has been inputted. Do searching.
			        if ($("#searchInput").val().length > 0){
			            //Show search menu
			            if (currentMode != 2){
			                currentMode = 2;
			                changeMode();
			            }
			            if (searchTimeout !== undefined){
			                clearTimeout(searchTimeout);
			            }
			            searchTimeout = setTimeout(updateSearchResult,1000);
			        }else{
			            //return to webapp list menu
			            if (currentMode != 1){
			                if (searchTimeout !== undefined){
    			                clearTimeout(searchTimeout);
    			            }
			                currentMode = 1;
			                changeMode();
			            }
			        }
			    }
			});
			
			function updateSearchResult(){
			    var keyword = $("#searchInput").val();
			    $( "#moduleList" ).html("");
			    $( "#moduleList" ).append('<div id="searchResultsList" class="unstyled"><div id="webAppList" class="ts selection list"></div>\
			    <div id="utilList" class="ts selection list"></div>\
			    <div id="resultFileList" class="ts selection list"></div></div>\
                    <div id="loadingCover" class="ts active inverted dimmer">\
                        <div class="ts text loader">Loading</div>\
                    </div>');
    			
			    $.get("searchFile.php?keyword=" + keyword,function(data){
			        if (data.constructor !== Array && data.includes("ERROR")){
			            //Somethings goes wrong
			        }else{
			            var ll = Math.min(data.length,12);
			            for (var i =0; i < ll; i++){
			                var obj = data[i];
			                var ext = obj[0].split(".").pop();
			                var icon = ao_module_utils.getIconFromExt(ext);
			                $("#resultFileList").append('<div class="mini textwrap searchResult item" filepath="' + obj[0] + '" rType="file" onClick="openThisResult(this);"><i class="' + icon  +' icon"></i>' + obj[1] + '</div>');
			            }
			            $("#loadingCover").hide();
			            selectFirstSearchResult();
			        }
			    });
			    
			    $.get("systemSearch.php?search=" + keyword,function(data){
			        var moduleList = data[0];
			        var utilList = data[1];
			        if (moduleList.length > 0){
			            for (var i =0; i < moduleList.length; i++){
			                $("#webAppList").append('<div class="mini textwrap searchResult item" filepath="' + moduleList[i][0] + '" rType="webApp" onClick="openThisResult(this);">\
			                <img class="ts avatar image" src="' + moduleList[i][1] + '">\
                            <span>' + moduleList[i][0] + '</span></div>');
			            }
			        }else{
			            $("#webAppList").hide();
			        }
			        if (utilList.length > 0){
			             for (var i =0; i < utilList.length; i++){
    			             $("#utilList").append('<div class="mini textwrap searchResult item" filepath="' + utilList[i][0] + '" rType="utils" onClick="openThisResult(this);">\
    			                <img class="ts avatar image" src="' + utilList[i][1] + '">\
                                <span>' + utilList[i][0] + '</span></div>');
			             }
			        }else{
			            $("#utilList").hide();
			        }
			        $("#loadingCover").hide();
			        selectFirstSearchResult();
			    });
			    //$("#searchResultsList").append('<div class="mini textwrap item" onClick="moreResult();" style="padding-left:10px;cusor:pointer;">Advance Search <i class="caret right icon"></i></div>');
			}
			
			function selectFirstSearchResult(){
			    $(".searchResult").removeClass("preselect");
			    $(".searchResult").first().addClass("preselect");
			}
			
			
			
			function moreResult(){
			    alert("Work in progress");
			}
			
			function openThisResult(object){
			    var type = $(object).attr("rType");
			    if (type == "file"){
			        //This is a file. Open it with the corrisponding module with ao_module API
			        var filepath = $(object).attr("filepath");
			        var filename = $(object).text();
			        //Quick function for removing the file extension
			        //filename = filename.split(".");filename.pop();filename = filename.join(".");
			        ao_module_openFile(filepath,filename);
			        hideListMenu();
			        //Cleanup the search result
			        $("#searchInput").val("");
			        currentMode = 1;
			        changeMode();
			    }else if (type == "webApp"){
			        //parent.LaunchFloatWindowFromModule($(object).attr("filepath"),true);
			        var moduleName = $(object).attr("filepath");
                    ao_module_newfw(moduleName + "/index.php",moduleName,"file",ao_module_utils.getRandomUID());
                    hideListMenu();
                    $("#searchInput").val("");
                    currentMode = 1;
			        changeMode();
			    }else if (type == "utils"){
			        var toolName = $(object).attr("filepath");
			        ao_module_newfw("SystemAOB/utilities/" + toolName + ".php",toolName,"file",ao_module_utils.getRandomUID());
                    hideListMenu();
                    $("#searchInput").val("");
                    currentMode = 1;
			        changeMode();
			    }
			}
			
			
			function toggleShutDownMenu(){
				$("#shutdownMenu").css("left",$(".shutdown").offset().left - 8);
				$("#shutdownMenu").css("top",$(".shutdown").offset().top - $("#shutdownMenu").height() - $(".shutdown").height() - 8);
				if ($("#shutdownMenu").is(":hidden")){
					$("#shutdownMenu").slideDown('fast');
				}else{
					$("#shutdownMenu").slideUp('fast');
				}
				
			}
			
			$(document).on("click",function(e){
				if ($(e.target).hasClass("shutdown") == false){
					if ($("#shutdownMenu").is(":hidden") == false){
						$("#shutdownMenu").slideUp('fast');
					}
				}
				
			});
			
            function updateUserName(){
                var username = localStorage.getItem("ArOZusername");
                if (username.length > 7){
                    username = username.substring(0,7) + "..";
                }
                $("#username").html('<i class="angle double right icon"></i>' + username);
            }
            
            function replaceValue(source,keyword,value){
                return source.replace("{" + keyword + "}",value);
            }
            function loadModules(){
               $( "#moduleList" ).html("<div><i class='loading spinner icon'></i>Loading...</div>");
               $.get( "index.php?request=true&contentType=webapp", function( data ) {
                   $( "#moduleList" ).html("");
                   for (var i =0; i < data.length; i++){
                       var box = moduleTemplate;
                       box = replaceValue(box,'moduleIcon',data[i][4]);
                       box = replaceValue(box,'fw',data[i][3]);
                       box = replaceValue(box,'embedded',data[i][2]);
                       box = replaceValue(box,'name',data[i][0]);
                       box = replaceValue(box,'moduleName',data[i][0]);
                       $( "#moduleList" ).append(box);
                   }
                   currentMode = 0;
                   generateButton();
                }); 
            }
            
            function changeMode(){
                if (currentMode == 0){
                    //Switch to Util Menu
                    loadSystemUtil();
                }else if (currentMode == 1){
                    //Switch to WebApp list mode
                    loadModules();
                }else if (currentMode == 2){
                    //Switch to search menu mode
                    loadSearchMenu();
                }
            }
            
            function loadSearchMenu(){
                 $( "#moduleList" ).html('<br><br><div class="ts container"><div class="ts header">\
                    <i class="search icon"></i> System Search\
                    <div class="sub header">Type something to search for webApps, utilities and files.</div>\
                    </div></div>');
            }
            
            function loadSystemUtil(){
               $( "#moduleList" ).html("<div><i class='loading spinner icon'></i>Loading...</div>");
               $.get( "index.php?request=true&contentType=system", function( data ) {
                   console.log(data);
                   $( "#moduleList" ).html("");
                   for (var i =0; i < data.length; i++){
                       var box = systoolTemplate;
                       box = replaceValue(box,'tool',data[i][0]);
                       box = replaceValue(box,'name',data[i][0]);
                       box = replaceValue(box,'path',data[i][1]);
                       box = replaceValue(box,'toolIcon',data[i][2]);
                       $("#moduleList").append(box);
                   }
                   currentMode = 1;
                   generateButton();
                });     
            }
            
            function launchTool(object){
                var toolName = $(object).attr("name");
                var uid = Math.floor(Date.now() / 1000);
                ao_module_newfw("SystemAOB/utilities/" + toolName + ".php",toolName,"file",uid,0,0,0,0);
                hideListMenu();
                window.location.reload();
            }
            
            function generateButton(){
                var box = toggleSystemTools;
                if (currentMode == 0){
                    //Generate button for going into System Tool
                    box = replaceValue(box,"label"," <i class='caret right icon'></i> System Tools");
                }else{
                    //Generate button for going back to WebApp list
                    box = replaceValue(box,"label"," <i class='caret left icon'></i> All WebApps");
                }
                $("#moduleList").append(box);
            }
            
            function launchModule(object){
                var uid = Math.floor(Date.now() / 1000);
                var moduleName = $(object).attr("name");
                var embedded = $(object).attr('embedded').trim() == "true";
                var fw = $(object).attr("fw").trim() == "true";
                if (fw){
                    //Legacy code for calling function_bar to open a FloatWindow
                    parent.LaunchFloatWindowFromModule(moduleName,true);
                }else{
                    ao_module_newfw(moduleName + "/index.php",moduleName,"file",uid);
                }
                hideListMenu();
                window.location.reload();
            }
            
            function hideListMenu(){
                parent.$('#powerMenu').fadeOut('fast');
            }
            
            function openMediaFolder(target){
                if (target == 1){
                    //Music
                    ao_module_openPath("Audio/uploads");
                }else if (target == 2){
                    //Video
                    ao_module_openPath("Video/playlist");
                }else if (target == 3){
                    //Pictures
                    ao_module_openPath("Photo/storage");
                }else if (target == 4){
                    //Documents
                    ao_module_openPath("Document/doc");
                }
                hideListMenu();
            }
            function myComputer(){
                ao_module_newfw("Desktop/myHost.php","My Host","disk outline","myHost",1050,650,undefined,undefined,true,true);
				hideListMenu();
            }
            
            function AOR(){
                ao_module_openPath("");
				hideListMenu();
            }
            
            function controlPanel(){
                ao_module_newfw("System Settings/index.php","System Settings","setting","system_setting",1300,650,50,50,true,true);
				hideListMenu();
            }
			
			function Logout(){
				window.top.location = "../../../logout.php"
			}
			
			//legacy codes are used here to make sure the power functions are working fine
			
			function RestartApache(){
				$.ajax({
				url: "../power/apache_restart.php",
				error: function(){
					// Loading for reboot
					setTimeout(Ping, 2000);
				},
				success: function(){
					//not possible
					
				},
				timeout: 3000 // sets timeout to 3 seconds
			});
			}

			function Reboot(){
				$.ajax({
				url: "../power/reboot_cb42e419a589258b332488febcd5246591ea4699974d10982255d16bee656fd8.php",
				error: function(){
					// Start a fake progress bar to make people think it is rebooting
					setTimeout(function(){
						location.reload();
					}, 30000);
				},
				success: function(){
					//something crashed when reboot.
					console.log("Something went wrong while rebooting.");
				},
				timeout: 3000 // sets timeout to 3 seconds
			});
			}

			function Ping(){
				$.ajax({
				url: "../power/ping.php",
				error: function(){
					// Start a fake progress bar to make people think it is rebooting
					setTimeout(Ping, 2000);
				},
				success: function(){
					//something crashed when reboot.
					location.reload();
				},
				timeout: 3000 // sets timeout to 3 seconds
			});
			}

			function Shutdown(){
				window.top.location = "../power/shutdown-gui_2053da6fb9aa9b7605555647ee7086b181dc90b23b05c7f044c8a2fcfe933af1.php";
			}
        </script>
    </body>
</html>