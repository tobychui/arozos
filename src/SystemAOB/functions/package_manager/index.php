<?php
	include 'dependencyinstaller.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			WebApp Package Manager
			<div class="sub header">
			<div class="ts divider"></div>
				<a href="settings.php"><div class="ts left icon label">
					<i class="add icon"></i> New repository
				</div></a>
			</div>
		</div>
	</div>
	<div class="ts container">
<div class="ts form">
    <div class="inline fields">
        <div class="sixteen wide field">
            <label>Keywords</label>
            <input type="text" placeholder="Keywords" id="qstring">&nbsp;&nbsp;
			<a class="ts basic button" onclick="updatelist()" id="searchbtn">Search</a>
        </div>
    </div>
</div>



	</div>
</div>
<br>
<div class="ts container">

<div class="ts cards" id="mainmenu">

</div>

<div class="ts modals dimmer">
<dialog class="ts basic modal" id="modal" style="background-color:white" close>
    <div class="header" style="color:black">
<div class="ts small comments">
    <div class="comment">
        <p class="avatar">
            <img id="app_icn">
        </p>
        <div class="content">
            <a class="author" id="app_name"></a>
            <div class="middoted actions">
                <p class="reply" id="author"></p>
            </div>
        </div>
    </div>
</div>
    </div>
    <div class="content">
        <div class="description" style="color:black" id="des_modal">
            <div class="ts header"  style="color:black">This app requires the following permission:</div>
        </div>
    </div>
	<div class="actions">
        <button class="ts deny button">
            Deny
        </button>
        <button class="ts positive button" id="installbtn" onclick="downloadThisModule(this)">
            Install
        </button>
    </div>
</dialog>
</div>
<div id="msgbox" class="ts active bottom right snackbar" style="display:none;">
    <div class="content">
        Your request is processing now.
    </div>
</div>

<br><br>
<script>

var flag=0;
var source = "<?php echo str_replace("\r\n",",",file_get_contents('source.csv')); ?>";
var AOBmoduleinstalled = ",<?php echo aobinst(); ?>";
var querystring = "";

startup();

//Init script
function startup(){
	updatelist();
}

function sleep(milliseconds) {
  var start = new Date().getTime();
  for (var i = 0; i < 1e7; i++) {
    if ((new Date().getTime() - start) > milliseconds){
      break;
    }
  }
}


function updatelist(){
	$('#searchbtn').html('<div class="ts active inline mini loader"></div> Loading');
	$('#searchbtn').attr("disabled","disabled");
	$('.ts.card').remove();
	var arr_source = source.split(",");
	arr_source.pop();
	arr_source.forEach(function(element) {
		
		sourceinited = 0;
		//console.log("Source Detected : ".concat(element));
		$.getJSON("query.php?url=" + element + "&query=" + $('#qstring').val() + "&ver=1.1", function (data) {
			if(data["status_code"] !== 200){
				msgbox("System ERROR.");
			}
			//console.log(data);
			if(typeof data["result"] !== "undefined"){
			data["result"].forEach(function(ee) {
				var arg = "";
				var des = "";
				if(ee["description"].length > 30){
					des = ee["description"].substring(0,31) + "...";
				}else{
					des = ee["description"];
				}
						
				arg += 'icn="' +  element + "/app/" + ee["icn"] + '"';
				arg += 'name="' + ee["name"] + '"';
				arg += 'version="' + ee["version"] + '"';
				arg += 'description="' + ee["description"] + '"';
				arg += 'updatenote="' + ee["updatenote"] + '"';
				arg += 'author="' + ee["author"] + '"';
				arg += 'installurl="' + ee["installurl"] + '"';
				arg += 'category="' + ee["category"] + '"';
				arg += 'permission="' + ee["permission"] + '"';
				arg += 'server="' + element + '"';
				
			$("#mainmenu").append('<div class="ts card"><div class="content"><div class="ts medium comments"><div class="comment"><div class="avatar"><img src="' + element + "/apps/" + ee["icn"] + '"></div><div class="content"><p class="author">' + ee["name"] + '</p><div class="text">' + des + '</div><div class="actions"><a '+ arg +' onclick="popup(this);">Install</a></div></div></div></div></div></div>');
			});
			}
			sourceinited = sourceinited + 1;
			//console.log(sourceinited);
			if($('.ts.card').length == 0 && sourceinited == arr_source.length){
				$("#mainmenu").append('<div class="ts negative card"><div class="content"><div class="header">Not found</div><div class="description">Nothing here :(</div></div></div>');
				$('#searchbtn').html("Search");
				$('#searchbtn').removeAttr("disabled");
			}else{
				$('#searchbtn').html("Search");
				$('#searchbtn').removeAttr("disabled");
			}
			
		});
});
}

function popup(app){
	if(AOBmoduleinstalled.indexOf($(app).attr('name') + ",") > 0){
		$('#installbtn').attr("disabled","disabled");
		$('#installbtn').html("Installed");
	}else{
		$('#installbtn').removeAttr("disabled");
		$('#installbtn').html("Install");
	}
	$("#app_name").text($(app).attr('name'));
	$("#author").text($(app).attr('author'));
	$('#app_icn').attr('src',$(app).attr('icn'))
	$('#installbtn').attr('onclick','downloadThisModule("' + $(app).attr('server') + '","' + $(app).attr('installurl') + '")');
	
	$('#des_modal').html('');
	$('#des_modal').append('<p>' + $(app).attr('description') + '</p>');
	$('#des_modal').append('<div class="ts header"  style="color:black">this app requires the following permission:</div>');
	

	
	$(app).attr('permission').split(",").forEach(function(permission){
				$('#des_modal').append("<p>" + permission + "</p>");
	});
			
	//console.log($(app).attr('permission'));
	ts('#modal').modal("show");
}



function downloadThisModule(url,moduleName){
		$.get("install.php?url=".concat(url,"&name=",moduleName), function(data, status){
			msgbox(data);
		});
	
}

function msgbox(message){
	$("#msgbox .content").html(message);
	$("#msgbox").hide().fadeIn().delay(3000).fadeOut();
}

$(document).keypress(function(e) {
	if(e.which == 13) {
		e.preventDefault();
		updatelist();
	}
});
</script>
</body>
</html>
<?php
function aobinst(){
	$tmp = "";
	$dir = scandir("../../../");
	foreach($dir as &$itm){
		if($itm !== "." && $itm !== ".."){
			$tmp = $tmp.$itm.",";
		}
	}
	return $tmp;
}
?>