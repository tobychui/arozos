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


<body style="background-color: rgb(247, 247, 247);">
<div class="ts container">
<br>
<div class="ts segment">
	<div class="ts header">
    Current system time
    <div class="sub header">You could see the system time right here.</div>
	</div>
</div>
<div class="ts divider"></div>
<div class="ts segment">
	<div class="ts divided items">
		<h2 class="ts header" id="CurrTime">Loading...</h2>
		<br>
		<p id="timediff"></p>
        <div id="messagediv">
        </div>
	</div>
</div>

      <div class="ts snackbar">
         <div class="content"></div>	
      </div>
<script>
startup();
var cur = new Date("1900-01-01T00:00:00");
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
	$.getJSON("opr.php?opr=query", function (data) {
		cur = new Date(data["time"].replace(/-/g,"/"));
		/* then it becomes YYYY-mm-ddTHH:mm:ss */
		tz = data["f_timezone"];
		
		var timediff = (new Date() - cur);
		if(timediff >= 0 && Math.abs(timediff) <= 216000000){
			$("#timediff").text("This computer was " + convert(timediff) + " ahead.");
		}else{
			$("#timediff").text("This computer was lagging behind " + convert((-1*timediff)) + ".");
		}
		if(Math.abs(timediff) >= 216000000){
		    $("#timediff").text("Either server or client side time error.");
		}
		
		//Daylight message
		if(data["existdaylight"]){
		    if(data["nextdaylightremains"] <= 14){
		        if(data["nextdst"]){
		            if(data["nextdaylightremains"] == 0){
		                 $("#messagediv").html('<div class="ts inverted primary message"><p>Daylight Saving time starts today. The clock is set go forward 1 hour after that day.</p></div>');
		            }else{
		                 $("#messagediv").html('<div class="ts inverted primary message"><p>Daylight Saving time starts after ' + data["nextdaylightremains"] + ' days. The clock is set go forward 1 hour after that day.</p></div>');
		            }
		        }else{
		             if(data["nextdaylightremains"] == 0){
		                 $("#messagediv").html('<div class="ts inverted primary message"><p>Daylight Saving time starts today. The clock is set go forward 1 hour after that day.</p></div>');
		            }else{
		                $("#messagediv").html('<div class="ts inverted primary message"><p>Daylight Saving time ends after ' + data["nextdaylightremains"] + ' days. The clock is set go back 1 hour after that day.</p></div>'); 
		            }
		        }
		    }else{
		         $("#messagediv").html("<div></div>");
		    }
		}
	});
}

function convert(timediff){
        console.log(timediff);
		if(timediff < 1000){
			return timediff + "ms";
		}else if(timediff < 60000){
			return Math.floor(timediff/1000) + "s " + convert(timediff-Math.floor(timediff/1000)*1000);
		}else if(timediff < 3600000){
			return Math.floor(timediff/60000) + "m " + convert(timediff-Math.floor(timediff/60000)*60000);
		}else if(timediff < 216000000){ //original was 216000000
			return Math.floor(timediff/3600000) + "h " + convert(timediff-Math.floor(timediff/3600000)*3600000);
		}
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