<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<html>
   <head>
      <meta charset="UTF-8">
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
			Wi-Fi Manager
			<div class="sub header">A list of stored WiFi Network Configuration.</div>
		</div>
	</div>
	<div class="ts container">


	</div>
</div>
<br>
<div class="ts container">

<div class="ts cards" id="main_wifi">

</div>
</div>
<div class="ts modals dimmer">
<dialog class="ts basic modal" id="modal" style="background-color:white" close>
    <div class="header" style="color:black" id="head_modal">
       
    </div>
	<div class="content" style="color:black">
		<p>WARNING : This action cannot be UNDONE.</p>
		<p>Core Network configuration will be changed.</p>
		<p></p>
    </div>
	<div class="actions">
        <Button class="ts primary button">Execute</button>
			<button class="ts negative button">Cancel</button>
    </div>
</dialog>
</div>
<div id="msgbox" class="ts bottom right snackbar">
    <div class="content">
        Processing...
    </div>
</div>


<script>
startup();

var previouswifi;

function startup(){
//Please ADD ALL LOAD ON STARTUP SCRIPT HERE
	get();
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

function get(){
	var wifi = [];
	var i = 0;
	
$('#main_wifi').html("");
			$.getJSON("saved_wpa.php", function(result){
			result.forEach(function(data){
					data[0].forEach(function(subelement){
						var tmp = subelement.split("=");
						wifi[tmp[0]] = tmp[1];
					});
					$('#main_wifi').append('<div class="ts card"><div class="content"><div class="ts medium comments"><div class="comment"><div class="avatar"><i class="big signal icon"></i></div><div class="content"><a class="author">' + wifi["ssid"].replace('"',"").replace('"',"") + '</a><div class="text">Priority : ' + wifi["priority"] + '</div><div class="actions"><a onclick="ask(this,\'preferred\');" ssid=' + wifi["ssid"] + '>Set as preferred</a><a onclick="ask(this,\'remove\');" ssid=' + wifi["ssid"] + '>Remove</a></div></div></div></div></div></div>');
					console.log(wifi);
				
			});
			


    });
}

function ask(ssid,act){
	ts('#modal').modal({
    approve: '.primary',
    deny: '.negative',
    onDeny: function() {
	if(act == "remove"){
		msg('Action cancelled');
	}else if(act == "preferred"){
		msg('Action cancelled');
	}
    },
    onApprove: function() {
    if(act == "remove"){
	remove(ssid);
	}else if(act == "preferred"){
	connect(ssid);
	}
    }
}).modal("show");

	$('#head_modal').html($(ssid).attr('ssid'));
}

function remove(ssid){
$.get( "wpa_supplicant_delete.php?ssid=" + $(ssid).attr("ssid") , function() {})
  .done(function() {
	$.ajax({url:"./bash/wrestart.php",async:false});
	    msg("Complete");
		get();
  })
  .fail(function() {
    msg( "Failed." );
  })
}


function connect(ssid){
$.get( "wpa_supplicant_connect.php?ssid=" + $(ssid).attr("ssid") , function() {})
  .done(function() {
	$.ajax({url:"./bash/wrestart.php",async:false});
	    msg("Complete");
		pdb_update();
		get();
  })
  .fail(function() {
    msg( "Failed." );
  })
}
function msg(content) {
		ts('.snackbar').snackbar({
			content: content,
			actionEmphasis: 'negative',
		});
}
function pdb_update() {
			$.get("priority.php")
				.done(function(data) {
					msg('Added Wi-Fi Network.');
					window.location.reload();
				});
		}
</script>

</body>
</html>