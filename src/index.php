<?php
include_once 'auth.php';
?>
<html>
<!DOCTYPE HTML>
<head>
<meta name="viewport" content="width=device-width, initial-scale=0.7, shrink-to-fit=no">
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="script/tocas/tocas.css">
<script src="script/tocas/tocas.js"></script>
<script src="script/jquery.min.js"></script>
</head>
<?php
include_once("SystemAOB/functions/personalization/configIO.php");
$indexConfig = getConfig("index",true);
//Folders that exclude in the function arranging process.
$function_exclude = ["Help","img","script","msb"];
?>
<body>
	<style>
		.mobilemenulist{
			width:100%;
			padding-left:0px !important;
			padding-right:0px !important;
		}

		.mobileTsContainer{
			padding-left:0px !important;
			padding-right:0px !important;

		}

		.mobileTsClass{
			margin-top:10px !important;
			margin-bottom:10px !important;
			border: 1px solid transparent;
		}

		.h4mobile{
			font-size:12px !important;
			text-align: center !important;
			text-align-last: center !important;
			margin-left: auto !important;
			padding-left: auto !important;
		}
		.extraRightPadding{
			margin-right:10px !important;
		}
		
		.selectable{
			cursor:pointer;
		}
		
	</style>
    <nav id="topbar" class="ts attached inverted borderless large menu">
        <div class="ts narrow container">
            <a href="index.php" class="item localtext" localtext="index/menu/title">ArOZ Online β</a>
        </div>
		<div id="langbtn" style="position:absolute;top:12px;right:22px;color:white;cursor:pointer;"><i class="globe icon"></i> Language</div>
    </nav>

    <!-- Main Banner -->
    <div id="mainarea" class="ts center aligned attached very padded segment">
        <div class="ts narrow container">
            <br>
            <div class="ts massive header">
                <img class="ts fluid image" src="<?php echo $indexConfig["index-image"][3]; ?>">
                <div class="sub header">
                        <?php echo $indexConfig["index-tag"][3]; ?>
					<div class="ts outlined message">
						<div id="identity"><span class="localtext" localtext="index/banner/identify">You are now identify as</span> <i class="loading spinner icon"></i></div>
					</div>
					
                </div>
            </div>
            <br>
			<div class="ts buttons">
            <button id="fbBtn" class="ts primary button" onClick="toggleFunctionBar();"><i class="tasks icon"></i><span class="localtext" localtext="index/button/desktop">Activate Virtual Desktop</span></button>
			<button id="extDt" class="nvdio ts info button" onClick="extFunctionBar();"><i class="tasks icon"></i><span class="localtext" localtext="index/button/extdesktop">Extend Desktop</span></button>
			<button class="ts button" OnClick="window.location.href='logout.php';"><i class="log out icon"></i><span class="localtext" localtext="index/button/logout">Logout</span></button>
			</div>
            <br>
            <br>
        </div>
    </div>
    <!-- Main Banner -->

	<!-- Mobile Banner-->
		<div id="mobilebanner" class="ts fluid top attached small buttons" style="display:none;">
				<div id="vpdm" class="ts primary button"><i class="mobile icon"></i><span class="localtext" localtext="index/mobile/yourip">Your IP: </span><?php echo $_SERVER['REMOTE_ADDR'];?></div>
				<button class="ts button" OnClick="window.location.href='logout.php';"><i class="log out icon"></i><span class="localtext" localtext="index/mobile/logout">Logout</span></button>
		</div>
			
	</div>
    <!-- Main Area -->
    <div class="ts center aligned attached vertically very padded secondary segment">
        <div id="menulistcontainer" class="ts container" align="center">
            <!-- Conainer for scanning -->
            <div id="menulist" class="ts four flatted cards">

				<?php
				//Template for one scan function unit
                $scantemplate = '<div class="ts card">
                    <div class="image">
                         <a href="%FUNCTION_PATH%"><img src="%FUNCTION_ICON_PATH%"></a>
                    </div>
                    <div class="left aligned content">
						<h4>%FOLDERTITLE%</h4>
                        <div class="description">%DESCRIPTION_TEXT%<br><a href="%FUNCTION_PATH%" class="localtext" localtext="index/launcher/launch">Launch</a></div>
						
                    </div>
                </div>';
				$directories = glob("./" . '/*' , GLOB_ONLYDIR);
				foreach($directories as $result) {
					//echo str_replace(".//","",$result), '<br>';
					$foldername = str_replace(".//","",$result);
					if (in_array($foldername,$function_exclude) != True){
						//If this folder is not excluded in the function list
						$thisbox = str_replace("%FUNCTION_PATH%",$foldername . "/",$scantemplate);
						if (file_exists($foldername . "/img/function_icon.png") !== False){
							$thisbox = str_replace("%FUNCTION_ICON_PATH%",$foldername . "/img/function_icon.png",$thisbox);
						}else{
							$thisbox = str_replace("%FUNCTION_ICON_PATH%","img/no_icon.png",$thisbox);
						}
						$thisbox = str_replace("%FOLDERTITLE%",$foldername,$thisbox);
						if (file_exists($foldername . "/description.txt")){
							$descripton = file_get_contents($foldername .'/description.txt', FILE_USE_INCLUDE_PATH);
							$thisbox = str_replace("%DESCRIPTION_TEXT%",$descripton,$thisbox);
						}else{
							$lazytext = "It seems the developer don't even know what is this for.";
							$thisbox = str_replace("%DESCRIPTION_TEXT%",$lazytext,$thisbox);
						}
						echo $thisbox;
					}
				}
				
				$DesktopExists = "false";
				if (file_exists("Desktop/index.php")){
					$DesktopExists = "true";
				}
				?>
				<div class="ts card">
                    <div class="image">
                        <a href="Help/"><img src="Help/img/function_icon.png"></a>
                    </div>
                    <div class="left aligned content">
						<h4>Help</h4>
                        <div class="description">Click here if you need help on how to use this system or you just want to know more.<br><a href="Help/">Launch</a></div>
						
                    </div>
                </div>

               
            </div>

        </div>

    </div>
    <!-- / End of Main Area -->
	<!-- Lanuage Selection Menu -->
	<div id="langSelection" style="position:absolute;top:45.7px;right:0px;display:none;background-color:#f7f7f7;">
		<div class="ts segmented items">
			<div class="selectable language item" lang="">
				<img class="ts mini middle aligned image extraRightPadding" src="SystemAOB/system/lang/flags/disable.png"> Disable Translation
			</div>
			<?php
			$langs = glob("SystemAOB/system/lang/*.json");
			foreach ($langs as $lang){
				$flags = 'SystemAOB/system/lang/flags/' . basename($lang,".json") . ".png";
				if (!file_exists($flags)){
					$flags = 'SystemAOB/system/lang/flags/unknown.png';
				}
				echo '<div class="selectable language item" lang="' . basename($lang,".json") . '">
						<img class="ts mini middle aligned image extraRightPadding" src="' . $flags . '">' . basename($lang,".json") . '
					</div>';
			}
			?>
		</div>
	</div>
    <!-- Foot -->
    <div class="ts bottom attached segment">
        <div class="ts narrow container">
            <br>
            <div class="ts large header">
                <?php echo $indexConfig["bottomTag"][3]; ?>
                <div class="smaller sub header">
                    <?php echo $indexConfig["licenseTerm"][3]; ?>
                </div>
            </div>
            <br>
        </div>
    </div>
    <!-- / Foot -->
	<br><br>
	
	<script>
	var DesktopExists = "<?php echo $DesktopExists;?>";
	var DirectDesktopMode = <?php echo $indexConfig["directDesktop"][3]; ?>;
	var desktopSettings;
	var lang = localStorage.getItem("aosystem.localize");
	var translationkeys;
	
	//Handle localization translation and its settings
	if (lang === undefined || lang == "" || lang === null){
		if (localStorage.ArOZusername == null || localStorage.ArOZusername == ""){
		//No User Name
			var message = localize("index/identify/notfound") || "You have not identified yourself.";
			$('#identity').html('<i class="user icon"></i>' + message);
		}else{
			var message = localize("index/identify/welcomeback") || "Welcome back";
			$('#identity').html('<i class="user icon"></i>' + message + ' ' + localStorage.ArOZusername + ".");
		}
	}
	
	$(".selectable").hover(
       function(){ $(this).addClass('active') },
       function(){ $(this).removeClass('active') }
	)
	
	$("#langbtn").on("click",function(e){
		$("#langSelection").slideToggle('fast');
	});
	
	$(".language").on("click",function(){
		$("#langSelection").slideUp('fast');
		var targetlang = $(this).attr("lang");
		localStorage.setItem("aosystem.localize",targetlang);
		if (targetlang != ""){
			alert("Language changed to " + targetlang);
		}else{
			alert("Translation Disabled.");
		}
		window.location.reload();
	});
	
	$.get("SystemAOB/system/lang/" + lang + ".json",function(data){
		translationkeys = data;
		console.log("Localization loaded. Lang: " + lang);
		//Update the on-screen objects with localized translationkeys
		$(".localtext").each(function(){
			if (this.hasAttribute("localtext")){
				var thisKey = $(this).attr("localtext");
				var localtext = translationkeys.keys[thisKey];
				$(this).text(localtext);
			}
		});
		
		if (localStorage.ArOZusername == null || localStorage.ArOZusername == ""){
		//No User Name
			var message = localize("index/identify/notfound") || "You have not identified yourself.";
			$('#identity').html('<i class="user icon"></i>' + message);
		}else{
			var message = localize("index/identify/welcomeback") || "Welcome back";
			$('#identity').html('<i class="user icon"></i>' + message + ' ' + localStorage.ArOZusername + ".");
		}
	});
	
	function localize(key){
		if (translationkeys === undefined){
			return null;
		}
		return translationkeys.keys[key];
	}
	
	$.get("SystemAOB/functions/personalization/desktopConfig.php",function(data){
		if (typeof(data) === "object"){
			desktopSettings = data;
			//console.log(desktopSettings);
			if (desktopSettings.systemExtendedDesktop == "disabled"){
				$("#extDt").addClass("disabled");
			}
		}
	});
	function extFunctionBar(){
		if (desktopSettings != undefined){
			//Use the defined external desktop settings
			var extDesktopPath = desktopSettings.systemExtendedDesktop + "/" + desktopSettings.systemExtentedPath;
		}
	}
	
	function toggleFunctionBar(){
		if (parent.isFunctionBar == true){
			window.top.location = "index.php";
		}else{
			if (desktopSettings != undefined && desktopSettings.systemDesktopModule != ""){
				//Use the informatin get from the config
				window.location.href = "function_bar.php#" + desktopSettings.systemDesktopModule + "/" + desktopSettings.systemStartingPath;
			}else{
				if (DesktopExists){
					//Desktop exists and no defined Desktop. Use default instead
					window.location.href = "function_bar.php#Desktop/";
				}else{
					//Desktop not exists. Use SystemAOB main page as Desktop environment
					window.location.href = "function_bar.php#SystemAOB/";
				}
				
			}
		}
	}

	/*
	//Deprecated background worker function
	function bgworker(){
		if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
			// is mobile..
			window.open('index.php', '_blank');
			window.open('backgroundWorker.php', '_self');
		}else{
			//Desktop
		window.open ('backgroundWorker.php','_blank',false)
		}
		
	}
	
	*/
	
	
	$(document).ready(function(){
		//Check if function bar exists or not
		if (parent.isFunctionBar == true){
			//The current page is viewed in Function Bar Mode
			$('#fbBtn').html('<i class="tasks icon"></i>Disable Virtual Desktop');
			$(".nvdio").hide();
		}else{
			//The current page is not viewed in Function Bar Mode
			if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
				//This is a mobile devices
				//Not support function bar system
				$('#fbBtn').attr('class','ts disabled button');
				$('#fbBtn').html('<i class="tasks icon"></i>Function Bar (Desktop Only)');
				//Hide and shrink all non-important information on index
				$('.description').each(function(){
					$(this).hide();
				});
				$('h4').each(function(){
					$(this).addClass("h4mobile");
				});
				//Adjusting the App icon width to fit better on the mobile interface
				$("#menulist").addClass("mobilemenulist");
				$("#menulistcontainer").addClass("mobileTsContainer");
				$("#menulistcontainer").parent().addClass("mobileTsContainer");
				$("#mainarea").css("padding-left","0px");
				$("#mainarea").css("padding-right","0px");
				//Make each icon looks better
				$(".ts.card").each(function(){
					$(this).addClass("mobileTsClass");
				});
				$(".left.aligned.content").each(function(){
					$(this).css("height","40px");
					$(this).css("padding-top","5px")
				});
				$("#mainarea").hide();
				$("#topbar").removeClass("large").addClass("mini");
				$("#mobilebanner").show();
				$("#langbtn").css("top","5px");
				$("#langSelection").css("top",$("#topbar").height());
			}else if (DirectDesktopMode){
			    //This is not mobile, not in fw mode and direct desktop mode is enabled
			    toggleFunctionBar();
			}
		}
	});

	</script>
</body>
</html>