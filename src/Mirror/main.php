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
<?php
//Information Grabber from https://www.timeanddate.com/weather/
$country = trim(file_get_contents('location.txt'));
$url = 'https://www.timeanddate.com/weather/' . $country;
$content = file_get_contents($url);
$first_step = explode( '<div id=qlook class="three columns">' , $content);
$second_step = explode("</p></div><div id=tri-focus>" , $first_step[1] );

?>
<div id="time" align="right" style="position: fixed; top: 10%; right: 5%; width: auto; height: 300px;">
<div id="dayOfWeek" style="font-size: 5vh;height:5vh;"></div>
<div id="CurrentDate" style="font-size: 4vh;height:4vh;"></div>
<div id="CurrentTime" style="font-size: 3vh;height:3vh;"></div>
</div>

<div id="weather" align="left" style="position: fixed; top: 10%; left: 5%; width: auto; height: 500px;">
<?php
echo '<div style="font-size: 4vh;height:4vh;">'.$country.'</div>';
echo '<div style="font-size: 2vh;height:2vh;">';
echo str_replace("</a>","</p>",str_replace("<a","<p",$second_step[0]));
echo '</div>';
?>
</div>
</body>
<script>
$( document ).ready(function() {
    var t = setInterval(updateTime,1000);
	var r = setInterval(Refresh,3600000); //Refresh every hour
});

function Refresh(){
	//Refresh the website with all information every 1 hour
	window.location.reload();
}
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