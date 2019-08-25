<?php
include '../../../auth.php';
?>
<html>
<head>
	<meta charset="UTF-8">
	<script type='text/javascript' charset='utf-8'>
		// Hides mobile browser's address bar when page is done loading.
		  window.addEventListener('load', function(e) {
			setTimeout(function() { window.scrollTo(0, 1); }, 1);
		  }, false);
	</script>
    <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
	<script src="../../../script/jquery.min.js"></script>
    <title>AOB Server Clock Calibration</title>
    <style type="text/css">
        body {
            padding-top: 4em;
            background-color: rgb(250, 250, 250);
            overflow: scroll;
        }
    </style>
</head>
<body>
<div class="ts container">
<div class="ts segment">
<div class="ts header">
    Server Clock Calibration Page
    <div class="sub header">ArOZ Online Utilities</div>
</div>
<p>This is a simple function to check the server side clock offset from the client side.<br>
We assume some users might use AOB system offline with their custom uses like Home Automation or Portable Cloud Streaming System.<br>
Clock checking tools can help identify if the on-board timer has problems with its battery or accuracy.</p>
</div>
<div class="ts inverted primary segment">
    <p id="clientTime">Current System Time (Client Side)<br></p>
	
</div>
<div class="ts inverted info segment">
    <p>Current System Time (Server Side)<br><?php echo time();?></p>
</div>
<div id="serTime" style="display:none;"><?php echo time();?></div>
<div id="resultBox" class="ts inverted positive segment">
    <p id="result">Loading...</p>
</div>
</div>
<script>
var seconds = new Date().getTime() / 1000;
var serTime = $('#serTime').html();
$('#clientTime').append(Math.round(seconds));
$('#result').html("Time offsets <br>" + fromSeconds(Math.abs(seconds - serTime),true));
if (Math.abs(seconds - serTime) > 900){
	$('#resultBox').removeClass("positive");
	$('#resultBox').addClass("negative");
}

function fromSeconds(seconds, showHours = false) {
	if(showHours) {
	var hours = Math.floor(seconds / 3600);
	seconds = seconds - hours * 3600;
	}
	var minutes = (Math.floor(seconds/60) < 10) ? "0" + Math.floor(seconds/60) : Math.floor(seconds/60); var seconds = (seconds % 60 > 9) ? seconds % 60 : "0" + seconds % 60;
	seconds = Math.round(seconds);
	if(showHours) {
	var timestring = hours+" Hours "+minutes+" Minutes "+seconds + " Seconds";
	} else {
	var timestring = minutes+":"+seconds;
	}
	return timestring;
}
</script>
</body>
</html>