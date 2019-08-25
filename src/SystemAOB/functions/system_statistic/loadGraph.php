<?php
include '../../../auth.php';
?>
<!DOCTYPE html> <html lang="en"> 
<head> 
<title>CPU Graph</title> 
<meta charset="utf-8" /> 
<link href="../../../script/c3/c3.min.css" rel="stylesheet" /> 
<script src="../../../script/jquery.min.js"></script> 
<script src="../../../script/c3/d3.min.js"></script> 
<script src="../../../script/c3/c3.min.js"></script> 
</head> 
<body> 
<div id="chart" style="height:150px;"></div>
 
<script>
var nextLoadValue = 0;
var i = 100;
function newGetLoad(){
	$.ajax({
		url: "getCPUload.php",
		success: function(data){
			nextLoadValue = data.split(" ")[0];
	  },
	});
}


	var time=["time"];
    var Ultilization=["Ultilization"];
    var expo=["Average"];
    var prev_temp=0;
    var count=0;
    var timeout=3*1000;
    var chart = c3.generate({
      data: {
        x:"time",
        //xSort: true,
        columns: [
          Ultilization,
          time,
          expo
          ]
      },
      colors: {
          "Ultilization":"#1f9330",
          "Average": "#a9fcb5"
      },
      axis: {
        x: {
          tick: {
            values: d3.range(0,100),
			culling: false,
            outer: false
          },
		  show:false
        },
		y:{
			max: 100,
            min: 0,
			padding: {top:0, bottom:0}
		}
      }
    });
    //document.getElementById("chart").requestFullScreen();
    for(count=0;count<100;count++){
		time.push(count);
		expo.push(0);
		Ultilization.push(0);
	}


//var docElm = document.body;
//if (docElm.requestFullscreen) { docElm.requestFullscreen(); } else if (docElm.mozRequestFullScreen) { docElm.mozRequestFullScreen(); } else if (docElm.webkitRequestFullScreen) { docElm.webkitRequestFullScreen(); } else if (docElm.msRequestFullscreen) { docElm.msRequestFullscreen(); }

function load(){
	time.push(i);
	var nowtemp = nextLoadValue;
	newGetLoad(); //Getting the next load value
	prev_temp = 0.75 * prev_temp + 0.25*nowtemp;
	Ultilization.push(nowtemp);
	expo.push(prev_temp);
	count=count+1;
	if(count>100){
		time.splice(1,1);Ultilization.splice(1,1);expo.splice(1,1);
	}
	chart.load({
		x:"time",
		columns: [
			Ultilization,time,expo
		],
		colors: {
		  "Ultilization":"#1f9330",
		  "Average": "#a9fcb5"
		},
		length: (function(){if(count<=200){return count;}else{return 1;}})(),
		duration:timeout
	});
	i+=1;
	setTimeout(load,timeout);
}

load();
</script> 
</body> 
</html>
