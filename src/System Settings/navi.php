<?php
include '../auth.php';
include_once("../SystemAOB/functions/personalization/configIO.php");
$theme = (getConfig("function_bar",false));
$themeColor = "#4286f4";
$sideBarColor = "rgba(48,48,48,0.7)";
if (isset($theme["actBtnColor"][3])){
    $themeColor = $theme["actBtnColor"][3];
    $sideBarColor = $theme["nbcolor"][3];
}
?>
<!doctype html>
<html>
<head>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<title>System Setting</title>
	<style>
	.clickable{
		cursor:pointer;
	}
	.hovering{
		border-style: solid;
		border-width: 1px;
		border-color: #4286f4;
		background-color:#edf5ff;
		border-radius: 3px;
	}
	body{
		background-color:white;
	}
	</style>
</head>
<body>
<?php
$icon = "server";
$title = "Setting";
$sidebarContent=[];
$page = "";
if (isset($_GET['page']) && $_GET['page']!=""){
	$page = $_GET['page'];
	if ($page == "host"){
		$icon = "disk outline";
		$title = "Host Machine";
	}else if ($page == "device"){
		$icon = "laptop";
		$title = "Device Settings";
	}else if ($page == "network"){
		$icon = "wifi";
		$title = "Network Settings";
	}else if ($page == "theme"){
		$icon = "paint brush";
		$title = "Desktop Theme";
	}else if ($page == "users"){
		$icon = "user outline";
		$title = "User Accounts";
	}else if ($page == "time"){
		$icon = "clock";
		$title = "Time and Clock";
	}else if ($page == "file"){
		$icon = "file outline";
		$title = "File Management";
	}else if ($page == "sync"){
		$icon = "cloud upload";
		$title = "ArOZ Sync Service";
	}else if ($page == "backup"){
		$icon = "refresh";
		$title = "Backup / Recover";
	}else if ($page == "about"){
		$icon = "notice";
		$title = "About ArOZ";
	}
	
	
	if (file_exists("menus/$page.csv")){
		$menu = str_getcsv(file_get_contents("menus/$page.csv"), "\n"); 
		$thisline = [];
		foreach($menu as &$line) {
			$lines = str_getcsv($line, ",");
			array_push($sidebarContent,$lines);
		}
	}else{
		header("Location: ../SystemAOB/functions/badDist.php");
		die("[Critical Error] The defined setting menu is not found.");
	}
	
	$iframeContent = "../" . $sidebarContent[1][2];
	$tabID=1;
	if (isset($_GET['tab']) && $_GET['tab'] != ""){
		$tabID = (int)$_GET['tab'];
		if ($tabID < count($sidebarContent)){
			//A valid tab number that will not go out of range
			$iframeContent = "../" . $sidebarContent[$tabID][2];
		}
	}
}



?>
<div id="sidebar" class="ts vertical compact menu" style="position:fixed;top:0px;left:0px;width:235px;z-index:99;background-color:<?php echo "#ededed"; ?>;height:100%;">
	<div class="item">
		<a href="index.php" style="color:#404040;"><i class="angle left icon"></i>System Setting</a>
	</div>
	<div class="item">
		<h4><i class="<?php echo $sidebarContent[0][0];?> icon"></i><?php echo $sidebarContent[0][1];?></h4>
	</div>
	<div class="item" style="border-width:0px;">
		<div class="ts fluid right icon input">
			<input type="text" placeholder="Search Settings">
			<i class="search icon"></i>
		</div>
	</div>
	<?php
	for ($x = 1; $x < count($sidebarContent); $x++){
		if ($x == $tabID){
			echo '<a id="'.$sidebarContent[$x][0].'" class="item" href="navi.php?page='.$page.'&tab='.$x.'" style="background-color:#d1d1d1;">'.$sidebarContent[$x][1].'</a>';
		}else{
			echo '<a id="'.$sidebarContent[$x][0].'" class="item" href="navi.php?page='.$page.'&tab='.$x.'">'.$sidebarContent[$x][1].'</a>';
		}
		
	}
	
	?>
	<div class="item"></div>
</div>
<div id="mainContainer" class="ts container" style="position:fixed;overflow-y:auto;right:0px;top:0px;">
	<iframe id="ContentFrame" src="<?php echo $iframeContent; ?>" width="100%" >I have told you to use a modern browser isn't?</iframe>
</div>
<div id="toggleSideBar" onClick="toggleSideBar();" style="cursor: pointer;position:fixed;left:10px;bottom:10px;width:50px;height:50px;background-color:#424242;color:white;z-index:100;">
<h3 style="color:white;position:relative;top:15px;left:10px;"><i class="content icon"></i></h3>
</div>

<script>
var sideBarHidden = false;
var isFunctionBar = !(!parent.isFunctionBar);
var underNaviEnv = true;
var baseURL = (location.protocol + '//' + location.host + location.pathname).split("/"); baseURL.pop(); baseURL = baseURL.join("/");
setContentWidth();
updateiFrameHeight();

if (isFunctionBar){
    //$("#toggleSideBar").css("bottom","30px");
}

$( window ).resize(function() {
  setContentWidth();
  updateiFrameHeight();
});

function callToSelectionID(selectionID){
	$(".item").each(function(){
		if ($(this).attr("id") == selectionID){
			window.location.href = baseURL + "/" +  $(this).attr("href");
		}
	});
}

function toggleSideBar(){
	if (sideBarHidden){
		$("#sidebar").show();
	}else{
		$("#sidebar").hide();
	}
	sideBarHidden=!sideBarHidden;
}

function updateiFrameHeight(){
	var wh = $(window).height();
	$("#ContentFrame").css("height",wh);
	
}

function setContentWidth(){
	var ww = $(window).width();
	var contentWidth = ww - $("#sidebar").css("width").replace("px","");
	if (contentWidth > 550){
		$("#sidebar").show();
		$("#toggleSideBar").hide();
		$("#mainContainer").css("width",contentWidth + "px").css("padding-left","0px");
		$("#ContentFrame").css("width","100%");
		sideBarHidden = false;
	}else{
		$("#sidebar").hide();
		$("#toggleSideBar").show();
		$("#mainContainer").css("width",ww + "px").css("padding-left","10px");
		$("#ContentFrame").css("width",ww);
		sideBarHidden = true;
	}
	
}

function fileSelectionPassthrough(object){
	$('#ContentFrame')[0].contentWindow.fileReceive(object);
}

function newEmbededWindow(){
	parent.newEmbededWindow.apply(null, arguments);
}
</script>
</body>
</html>