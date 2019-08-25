<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<html>
   <head>
      <meta charset="UTF-8">
	  <link rel="stylesheet" href="style.css">
      <link rel="stylesheet" href="../../../script/tocas/tocas.css">
      <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
      <script src="../../../script/jquery.min.js"></script>
      <title>WIFI</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
   </head>


<body>
<div class="ts fluid borderless slate">
	<div class="ts segment" style="width:100%;">
		<div class="ts header">
			Connect New Wi-Fi Network
			<div class="sub header">All the WiFi SSID scanned within the range of the onboard WLAN card.</div>
		</div>
	</div>
</div>
<?php
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		echo '<div class="ts container"><div class="ts message">
		<div class="header">Not Supported OS</div>
		<p>This function is not supported in Windows Host.</p>
	</div></div>';
		exit(0);
	} 
	?>
<br>
<div class="ts container">
<div class="ts cards" id="main_wifi">

</div>

		
		
	</div>
<div class="ts modals dimmer">
<dialog class="ts basic modal" id="modal" style="background-color:white" close>
    <div class="header" style="color:black" id="head_modal">
       
    </div>
	<div class="content" style="color:black" id="content_modal">
		
    </div>
	<div class="actions">
        <Button class="ts primary button" id="connect_btn">Connect</button>
			<button class="ts negative button">Cancel</button>
    </div>
</dialog>
</div>

<div id="msgbox" class="ts bottom right snackbar">
    <div class="content">
        Your request is being processed now.
    </div>
</div>
<script>
startup();

var previouswifi;

function startup(){
//Please ADD ALL LOAD ON STARTUP SCRIPT HERE
	scannetwork();
}
var haswifi = false;
$.get("ifconfig.php", function (data) {
	data.forEach(function(element) {
         if(element["InterfaceIcon"] == "WiFi"){
			haswifi= true;
        }
    });
	if(!haswifi){
		window.location = "nowifi.html"
    }
});

function scannetwork(){
		$('#main_wifi').html("");
		 $("#availablewifi").html('<tr><th>Wi-Fi name</th></tr>');		 
		$.ajaxSettings.async = false; 
		$.getJSON("iwlist.php", function(result){
            $.each(result, function(i, field){
					var Quality = "icon-0";
					var Quality_int = parseInt(field["Quality"].split("/")[0])/parseInt(field["Quality"].split("/")[1]);
					if(Quality_int == 0){
						Quality = "icon-0";
					}else if(Quality_int > 0 && Quality_int <= 0.25){
						Quality = "icon-1";
					}else if(Quality_int > 0.25 && Quality_int <= 0.5){
						Quality = "icon-2";
					}else if(Quality_int > 0.5 && Quality_int <= 0.75){
						Quality = "icon-3";
					}else if(Quality_int > 0.75 && Quality_int <= 1){
						Quality = "icon-Full";
					}
					$('#main_wifi').append('<div class="ts card"><div class="content"><div class="ts medium comments"><div class="comment"><div class="avatar"><span class="' + Quality + '" style="font-size:2.5em"></span></div><div class="content"><a class="author">' + field["ESSID"] + '</a><div class="text">' + field["Encrpytion_Method"] + '</div><div class="actions" id="act_wifi"><a onclick="conn_modal(this)" ssid="' + field["ESSID"] + '" encrypt="' + field["Encryption_Suites"] + '">Connect</a></div></div></div></div></div></div>');
            });
        });
		$("#main_wifi").append('<div class="ts card"><div class="content"><div class="ts medium comments"><div class="comment"><div class="avatar"><i class="big add icon"></i></div><div class="content"><a class="author">Add new Wi-Fi</a><div class="text">Add new network</div><div class="actions"><a onclick="redirect()">Add</a></div></div></div></div></div></div>');
		$.ajaxSettings.async = true; 

}

function redirect(){
	window.location = "addnew.php";
}
function conn_modal(ssid){
	var method = "";
	if($(ssid).attr("encrypt") == "No Encryption"){
	method = "no";
	}else if($(ssid).attr("encrypt").includes("802.1x")){
	method = "802.1x"
	}else if($(ssid).attr("encrypt").includes("PSK")){
	method = "PSK"
	}
	
		ts('#modal').modal({
    approve: '.primary',
    deny: '.negative',
    onDeny: function() {
		msg("Cancelled");
    },
    onApprove: function() {
		submit($(ssid).attr('ssid'),method);
    }
}).modal("show");
	$('#head_modal').html("Connecting to : " + $(ssid).attr('ssid'));
	$('#content_modal').html('<div class="ts form" id="wifi" action=""><div class="fields">' + form($(ssid).attr('encrypt')) +'</div></div>');
	
	var saved=false;
	$("#connect_btn").removeAttr("disabled");
	$.getJSON("saved_wpa.php", function(result){
            $.each(result, function(i, biggestrray){
			    var secondarray = biggestrray[0];
				$.each(secondarray, function(i, thirdarray){
				console.log(thirdarray);
					if(thirdarray == 'ssid="' + $(ssid).attr("ssid") + '"' == true){
						saved=true;
						disable(ssid);
					}
				});
            });
    });
}




function disable(ssid){
	$('#content_modal').html("Record already exists. You have to remove the WiFi Network Record before reconnecting.");
	$("#connect_btn").attr("disabled","true");
}

function form(method){
console.log(method);
if(method.includes("PSK")){
	return '<div class="sixteen wide field"><input id="pwd" name="pwd" placeholder="Password" type="text"></div>';
}else if(method.includes("802.1x")){
	return '<div class="eight wide field"><input id="usrname" name="usrname" placeholder="Username" type="text"></div><div class="eight wide field"><input ut id="pwd" name="pwd" placeholder="Password" type="text"></div>';
}else if(method == "No Encryption"){
	return 'Open Network. No Password Required';
}else{
	return 'System cannot determine wifi encrpyion method.';
}
}

function msg(content) {
		ts('.snackbar').snackbar({
			content: content,
			actionEmphasis: 'negative',
		});
}
	
function submit(ssid,method){
	$.get( "connect.php?method=" + method + "&ssid=" + ssid + "&usr=" + $("#usrname").val() + "&pwd=" + $("#pwd").val() , function() {})
  .done(function() {
    msg("WPA Updated. Restarting wireless interface services.");
	$.ajax({url:"wrestart.php",async:false});
	pdb_update();
  })
  .fail(function() {
    msg( "Failed" );
  })
}

function pdb_update() {
			$.get("priority.php")
				.done(function(data) {
					msg('Added Wi-Fi Network.');
					scannetwork();
				});
		}
 
		
</script>

</body>
</html>