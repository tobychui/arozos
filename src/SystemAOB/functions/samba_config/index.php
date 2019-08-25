
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Server Message Block Configuration
			<div class="sub header">
			<div class="ts divider"></div>
				<a href="setsmb.php"><div class="ts left icon label">
					<i class="add icon"></i> New Directory
				</div></a>
				<a href="downloadsmbconfig.php" target="_blank"><div class="ts left icon label">
					<i class="download icon"></i> Download Configuration
				</div></a>
			</div>
		</div>
	</div>
		List of Samba Directories
	<div class="ts container">
		<div class="ts bottom attached vertical menu" id="mainmenu">

		</div>
			
	</div>
	
</div>
	<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    echo '<div class="ts container"><div class="ts divider"></div><div class="ts secondary message">
		<div class="header">Host Operation System not supported</div>
		<p>This function is currently not supported on Windows Host.<br> If you are sure this function should be available, please check if your ArOZ Online system is up to date.</p>
	</div><div class="ts divider"></div></div>';
	die();
}
?>

<div id="mainmenumsg" style="display:none;">
<p id="path"></p>
<p id="permission"></p>
<p id="readonly"></p>
<div class="ts breadcrumb">
<a style="color:#0000EE;cursor:pointer;" class="section" id="edit">Edit</a> 
</div>
</div>

<div>
</div>


<div id="msgbox" class="ts bottom right snackbar">
    <div class="content">
        Your request is processing now.
    </div>
</div>
<br><br>
<script>
<?php 
if(isset($_GET["msg"])){
	echo 'msg("'.$_GET["msg"].'");'."\r\n";
}
?>
var lastSelectedObject="";
startup();
var d = "";

function startup(){
	$.get( "readsmbconf.php", function( data ) {
		console.log(data);
		Object.keys(data).forEach(function (key){
			if(key !== "global" && key !== "printers" && key !== "print$"){
			console.log(data[key]);
			if(data[key]["comment"] == null){
				comment = "None";
			}else{
				comment = data[key]["comment"];
			}
			
			if(data[key]["path"] == null){
				path = "None";
			}else{
				path = data[key]["path"];
			}

			if(data[key]["read only"] == null){
				readonly = "None";
			}else{
				readonly = data[key]["read only"];
			}

			if(data[key]["directory mask"] == null){
				dirmask = "None";
			}else{
				dirmask = data[key]["directory mask"];
			}
			Object.keys(data[key]).forEach(function (key_two){
				d = d + key_two + ":" + data[key][key_two] + ";";
			});
			$("#mainmenu").append('<div class="item" onClick="selected(this);" data="' + d + '" sharefolder="' + key + '" path="' + path + '"  rd="' + readonly + '" dirmask="' + dirmask + '"><div class="ts comments"><div class="comment" style="cursor:pointer;"><div class="avatar"><img src="share_icon.png"></div><div class="content"><p class="author">' + key + '</p><div class="text">' + comment + '</div></div></div></div></div>');
			
			d = "";
			}
		});
		
		
	});
}

function selected(object){
	if (lastSelectedObject != ""){
		$(lastSelectedObject).css("border-style","solid");
		$(lastSelectedObject).css("border-width","0px");
		$(lastSelectedObject).css("border-color","#ffffff");
		$(lastSelectedObject).css("background-color","#ffffff");
		$(lastSelectedObject).removeAttr("style");
	}
	$(object).css("border-style","solid");
	$(object).css("border-width","1px");
	$(object).css("border-color","#5998ff");
	$(object).css("background-color","#e2fdff");
	$("#mainmenumsg").appendTo(object);
	$("#mainmenumsg").show();
	$("#path").text("Path : " + $(object).attr("path"));
	$("#permission").text("Directory mask : " + $(object).attr("dirmask"));
	$("#readonly").text("Read Only : " + $(object).attr("rd"));
	
	$("#edit").attr("href","setsmb.php?data=" + $(object).attr("data") + "&section=" + $(object).attr("sharefolder"));
	
	lastSelectedObject = object;
}




function msg(content) {
		ts('.snackbar').snackbar({
			content: content,
			actionEmphasis: 'negative',
		});
}

</script>
</body>
</html>