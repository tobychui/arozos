<?php
include '../auth.php';
?>
<html>
<head>
<?php
//header("Content-Type: text/plain");
?>
<title>ArOZ Mirror</title>
<link rel="stylesheet" href="../script/tocas/tocas.css">
<script src="../script/tocas/tocas.js"></script>
<script src="../script/jquery.min.js"></script>
</head>
<body style="background-color:black;color:white;">
<div id="time" align="right" style="position: fixed; top: 10%; right: 5%; width: auto; height: 300px;">
<div id="dayOfWeek" style="font-size: 5vh;height:5vh;"></div>
<div id="CurrentDate" style="font-size: 4vh;height:4vh;"></div>
<div id="CurrentTime" style="font-size: 3vh;height:3vh;"></div>
</div>

<div id="weather" align="left" style="position: fixed; top: 10%; left: 5%; width: auto; height: 500px;">
</div>
</body>
<script>
$( document ).ready(function() {
    var t = setInterval(updateTime,1000);
});

function updateTime(){
	var currentdate = new Date(); 
	$("#dayOfWeek").html(GetDay());
	$("#CurrentTime").html(zeroFill(currentdate.getHours(),2) + ":"+ zeroFill(currentdate.getMinutes(),2) + ":"  + zeroFill(currentdate.getSeconds(),2));
	//$("#CurrentDate").html(currentdate.getDate() + "/" + (currentdate.getMonth()+1) + "/" + currentdate.getFullYear());
	$("#CurrentDate").html(GetMonthName() + " " + currentdate.getDate() +", " + currentdate.getFullYear());
}

function GetDay(){
	var d = new Date();
	var weekday = new Array(7);
	weekday[0] =  "Sunday";
	weekday[1] = "Monday";
	weekday[2] = "Tuesday";
	weekday[3] = "Wednesday";
	weekday[4] = "Thursday";
	weekday[5] = "Friday";
	weekday[6] = "Saturday";

	var n = weekday[d.getDay()];
	return n;
}

function GetMonthName(){
	var monthNames = ["January", "February", "March", "April", "May", "June","July", "August", "September", "October", "November", "December"];
	var d = new Date();
	return(monthNames[d.getMonth()]);
}
function zeroFill( number, width )
{
  width -= number.toString().length;
  if ( width > 0 )
  {
    return new Array( width + (/\./.test( number ) ? 2 : 1) ).join( '0' ) + number;
  }
  return number + ""; // always return a string
}
</script>
</html>