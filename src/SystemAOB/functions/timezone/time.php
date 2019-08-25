<?php
include '../../../auth.php';
?>
﻿<!DOCTYPE html>
<html>
   <head>
      <meta charset="UTF-8">
      <link rel="stylesheet" href="../../../script/tocas/tocas.css">
      <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
      <script src="../../../script/jquery.min.js"></script>
      <title>Default Page</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
	  <style>
	  </style>
   </head>


<body>
<div class="ts container">
<br>
<h4 class="ts header">Current system time:</h4>
<h2 class="ts header" id="CurrTime">Loading...</h2>
<br>
<p>
The system synchronizes to NTP server.<br>
Manually changing time was not allowed.
</p>
</div>



      <div class="ts snackbar">
         <div class="content"></div>	
      </div>
<script>
startup();
var cur = new Date("1900-01-01 00:00:00");
var tz = "";

function startup(){
//Please ADD ALL LOAD ON STARTUP SCRIPT HERE
UpdateTime();
setInterval(ShowTime, 1000);
setInterval(UpdateTime, 30000);
os();
}

function ShowTime(){
	cur.setSeconds(cur.getSeconds() + 1);
	var formatted = cur.toLocaleDateString('en-US') + " " + cur.toLocaleTimeString('en-US');	 
	$( "#CurrTime" ).html(formatted + " ("+ tz + ")");
	}

function UpdateTime(){
	
	$.getJSON("time_bg.php?opr=query", function (data) {
		cur = new Date(data["time"]);
		tz = data["timezone"];
	});
}


function msg(content) {
	ts('.snackbar').snackbar({
		content: content,
		actionEmphasis: 'negative',
	});
}

function os(){
	<?php
	if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
		echo "console.log('WIN');";
	}else{
		echo "console.log('LINUX');";
	}
	?>
}

</script>
</body>
</html>