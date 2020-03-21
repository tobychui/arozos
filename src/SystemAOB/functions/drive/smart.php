<?php
include_once("../../../auth.php");
?>
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
<script src="../../../script/ao_module.js"></script>
</head>
<body style="background:rgba(255,255,255,1);">
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Harddisk SMART
			<div class="sub header">
			<div class="ts divider"></div>
				<a onclick="showSMART(this)"><div class="ts left icon label">
					<i class="notice icon"></i> SMART Info
				</div></a>
				<a onclick="shortTest(this)"><div class="ts left icon label">
					<i class="treatment icon"></i> SMART Quick Test
				</div></a>
			</div>
		</div>
	</div>
		List of harddisk
	<div class="ts container">
		<div class="ts bottom attached vertical menu" id="mainmenu">

		</div>
			
	</div>
	
</div>
	
<div id="mainmenumsg" style="display:none;">
    <p>Location: <span id="location"></span></p>
    <p>Temperature: <span id="temperature"></span></p>
    <p>Serial Number: <span id="serial_number"></span></p>
    <p>Firmware Version: <span id="firmware_version"></span></p>
    <p>SMART Support: <span id="smart"></span></p>
</div>

<div>
</div>

<!-- use for displaying dialog , for VDI user , use VDI module instead -->
<div class="ts modals dimmer">
    <dialog id="modal" class="ts basic modal" style="background-color: white;color: black!important" open>
        <div class="content" id="modaldata">
        </div>
		<div class="actions">
			<div class="ts fluid separated stackable buttons">
				<button class="ts info button">Close</button>
			</div>
		</div>
</div>

<div id="msgbox" class="ts bottom right snackbar">
    <div class="content">
        Your request is processing now.
    </div>
</div>

<br><br>
<script>
var lastSelectedObject="";
startup();

function startup(){
	$.getJSON( "readsmart.php", function( data ) {
		if($(data).length == 0){
			msg("No harddisk detected.")
		}
		$.each(data, function( index, value ) {
			if(typeof value["smartctl"]["messages"] !== "undefined"){
				if(value["smartctl"]["messages"][0]["severity"] == "error"){
					msg(value["smartctl"]["messages"][0]["string"]);
					return;
				}
			}
            if(typeof value["user_capacity"] != "undefined"){
                var capacity = disksize(value["user_capacity"]["bytes"]);
            }else{
                var capacity = "Unknown";
            }
            if(typeof value["model_name"] !== "undefined"){
                var model_name = value["model_name"];
            }else{
                var model_name = "Unknown";
            }
            //for extended
            var location = "This Host";
            if(typeof value["temperature"] != "undefined"){
				var temperatureF = Math.round(1.8*parseInt(value["temperature"]["current"])+32);
                var temperature = value["temperature"]["current"] + "°C | " + temperatureF + "°F";
            }else{
                var temperature = "Unknown";
            }
            if(typeof value["serial_number"] !== "undefined"){
                var serial_number = value["serial_number"];
            }else{
                var serial_number = "Unknown";
            }
            if(typeof value["firmware_version"] != "undefined"){
                var firmware_version = value["firmware_version"];
            }else{
                var firmware_version = "Unknown";
            }
           if(typeof value["ata_smart_attributes"] != "undefined"){
                var smart = "Yes";
				var icon = "info";
				$.each(value["ata_smart_attributes"]["table"], function( indexf, valuef ) {
					if(typeof valuef["when_failed"] !== "undefined"){
						if(valuef["when_failed"] !== ""){ //probabally FAILING_NOW, but not sure.
							icon = "negative";
						}
					}
				});	
            }else{
                var smart = "No";
            }
			

		
            $("#mainmenu").append('<div class="item" ondblclick="showSMART()" onClick="selected(this);" diskid="' + index + '" location="' + location + '" temperature="' + temperature + '" serial_number="' + serial_number + '" firmware_version="' + firmware_version + '" smart="' + smart + '"><div class="ts comments"><div class="comment" style="cursor:pointer;"><div class="avatar"><i class="inverted ' + icon + ' circular disk outline icon"></i></div><div class="content"><p class="author">' + index + '</p><div class="text">' + model_name + ", " + capacity + '</div></div></div></div></div>');
            
        });	
	});
}

function showSMART(){
	if($("div[active='true']").length == 0){
		msg("Nothing selected");
	}else{
		showDialog("smarttable.php?disk=" + $("div[active='true']").attr("diskid") ,300,300);
	}
}

function shortTest(){
	if($("div[active='true']").length == 0){
		msg("Nothing selected");
	}else{
		showDialog("dotest.php?disk=" + $("div[active='true']").attr("diskid") ,300,300);
	}
}

function selected(object){
	if (lastSelectedObject != ""){
		$(lastSelectedObject).css("border-style","solid");
		$(lastSelectedObject).css("border-width","0px");
		$(lastSelectedObject).css("border-color","#ffffff");
		$(lastSelectedObject).css("background-color","#ffffff");
		$(lastSelectedObject).removeAttr("style");
		$(lastSelectedObject).removeAttr("active");
	}
	$(object).css("border-style","solid");
	$(object).css("border-width","1px");
	$(object).css("border-color","#5998ff");
	$(object).css("background-color","#e2fdff");
	$(object).attr("active","true");
	$("#mainmenumsg").appendTo(object);
	$("#mainmenumsg").show();
	$("#location").text($(object).attr("location"));
	$("#temperature").text($(object).attr("temperature"));
	$("#serial_number").text($(object).attr("serial_number"));
    $("#firmware_version").text($(object).attr("firmware_version"));
    $("#smart").text($(object).attr("smart"));
	
    lastSelectedObject = object;

}




function msg(content) {
		ts('.snackbar').snackbar({
			content: content,
			actionEmphasis: 'negative',
		});
}

function disksize(size){
	if(size >= 1000000000000){
		return Math.floor(size/1000000000000) + " TB";
	}else if(size >= 1000000000){
		return Math.floor(size/1000000000) + " GB";
	}else if(size >= 1000000){
		return Math.floor(size/1000000) + " MB";
	}else if(size >= 1024){
		return Math.floor(size/1000) + " KB";
	}else{
		return size + " Bytes";
	}
}

function showDialog(href,x,y){
	if(ao_module_virtualDesktop){
		ao_module_newfw('SystemAOB/functions/drive/' + href,'Drive Info','external','SMART' + Math.floor(Math.random()*100),x,y,undefined,undefined,false,true);
	}else{
		$( "#modaldata" ).html("");
		$( "#modaldata" ).load( href );
		ts('#modal').modal({
			approve: '.info',
			onApprove: function() {
				try {
				  clearInterval(timer);
				}catch(err) {}
			}
		}).modal("show")
	}
}
</script>
</body>
</html>