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
<body style="background-color: rgb(247, 247, 247);">
<div class="ts container">
<br>
<div class="ts segment">
	<div class="ts header">
    Timezone configuration
    <div class="sub header">You could change the timezone.</div>
	</div>
</div>
<div class="ts divider"></div>
<div class="ts segment">
	<div class="ts divided items">
		<div class="ts form">
			<div class="field">
				<label>Change timezone</label>
				<select id="tz">
				</select>
			</div>
			<div id="ntpfield" class="field">
				<label>Change NTP Server</label>
        		<div class="ts floating dropdown labeled icon button" style="padding: 0em;padding-left: 3em!important;padding-right: 0em!important;">
                    <i class="dropdown icon"></i>
                    <span class="text">
                        <div class="ts basic fluid input">
                         <input type="text" id="ntp" placeholder="Netowk Time Server (NTP)">
                        </div>
                    </span>
                    <div class="menu">
                        <div class="header">
                            <i class="server icon"></i> Recommended NTP server
                        </div>
                        <div class="item">ntp.google.com</div>
                        <div class="item">0.pool.ntp.org</div>
                        <div class="item">time-a-g.nist.gov</div>
                    </div>
                </div>
            </div>
			<div class="field">
				<button class="ts button" onclick="changetimezone()">Apply</button>
			</div>
		</div>
		<p>
		Please aware that a significant time difference might cause system services to crash unexpectedly.
		</p>
	</div>
</div>
<br><br><br>
</div>
</div>

<div class="ts bottom right snackbar">
	<div class="content"></div>	
</div>
<script>
//enable the dropdown feature
$(".ts.dropdown:not(.basic) > .menu > .item").click(function(elem) {
		$(this).parent().parent().children("span").children("div").children("input").val($(this).html());
});
ts('.ts.dropdown:not(.basic)').dropdown();
$(".ts.fluid.input").click(function(e) {
		e.stopPropagation();
});


var computerTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
var serverTZ = "";
var serverNTP = "";
update();

function update(){
	$.get("opr.php?opr=query", function (data) {
		var currTime = JSON.parse(data);
		serverTZ = currTime["timezone"];
		serverNTP = currTime["ntpserver"];
		$("#ntp").val(serverNTP);
		if(currTime["isWindows"]){
			$("#ntpfield").html("");
		}
		updatelist();
	});
}

function updatelist(){
	$("#tz").html('<option linuxtz="NA" wintz="NA">Updating...</option>');
	$.get("opr.php?opr=alltimezone", function (data) {
		$("#tz").html("");
		var timezone = JSON.parse(data);
		$.each(timezone, function(i, field){
			var friendlyname = field[0];
			if(serverTZ == field[1]){
				friendlyname = friendlyname + " (Current)";
			}
			if(computerTZ == field[1]){
				friendlyname = friendlyname + " (Suggested)";
			}
			$("#tz").append('<option linuxtz="' + field[1] + '" wintz="' + field[2] + '">' + friendlyname + "</option>");
	   });
	   $('#tz option[linuxtz="' + serverTZ + '"]').attr('selected','selected');
	});
}

function changetimezone(){
	$.ajax({url:"opr.php?opr=modify&tz=" + $('#tz option:selected').attr('linuxtz') + "&ntpserver=" + $('#ntp').val(),async:false});
	msg("Success.");
	update();
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