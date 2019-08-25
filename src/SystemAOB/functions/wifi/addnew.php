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
			Add new Wi-Fi network
			<div class="sub header">Connect Wi-Fi.</div>
		</div>
	</div>
	<div class="ts container">


	</div>
</div>
<br>
<div class="ts container">
		<div class="ts form">
    <div class="field">
        <label>Encryption method</label>
        <select id="encrypt">
			<option>Select</option>
            <option id="PSK">PSK</option>
            <option id="802.1x">802.1x</option>
            <option id="no">no</option>
        </select>
    </div>
	<div id="info"></div>
</div>
		
		
	</div>
	
<div id="msgbox" class="ts bottom right snackbar">
    <div class="content">
        Your request is processing now.
    </div>
</div>
<script>
startup();



function startup(){
//Please ADD ALL LOAD ON STARTUP SCRIPT HERE

}

$( "#encrypt" ).change(function() {
  form(this);
});

function form(method){
if($(method).val().includes("PSK")){
	$( "#info" ).html('<div class="sixteen wide field"><input id="ssid" name="ssid" placeholder="SSID" type="text"></div><div class="sixteen wide field"><input id="pwd" name="pwd" placeholder="Password" type="text"></div><button class="ts button" onclick="submit()">Add</button>');
}else if($(method).val().includes("802.1x")){
	$( "#info" ).html('<div class="sixteen wide field"><input id="ssid" name="ssid" placeholder="SSID" type="text"></div><div class="sixteen wide field"><input id="usrname" name="usrname" placeholder="Username" type="text"></div><div class="sixteen wide field"><input ut id="pwd" name="pwd" placeholder="Password" type="text"></div><button class="ts button" onclick="submit()">Add</button>');
}else if($(method).val().includes("no")){
	$( "#info" ).html('<div class="sixteen wide field"><input id="ssid" name="ssid" placeholder="SSID" type="text"></div><button class="ts button" onclick="submit()">Add</button>');
}
}

function msg(content) {
		ts('.snackbar').snackbar({
			content: content,
			actionEmphasis: 'negative',
		});
}
	
function submit(){
	$.get( "connect.php?method=" + $("#encrypt").val() + "&ssid=" + $(ssid).val() + "&usr=" + $("#usrname").val() + "&pwd=" + $("#pwd").val() , function() {})
  .done(function() {
    msg("Restarting Wireless Services...");
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
					window.location.href="availablenetwork.php";
				});
		}
</script>

</body>
</html>