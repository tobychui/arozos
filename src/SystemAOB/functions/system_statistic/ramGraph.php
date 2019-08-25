<?php
include '../../../auth.php';
?>
<!DOCTYPE html> <html lang="en"> 
<head> 
<title>Ram Graph</title> 
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
		url: "getMemoryInfo.php",
		success: function(data){
			nextLoadValue = data.split(",")[2].split(" ")[0];
			nextLoadValue = nextLoadValue * 100;
	  },
	});
}

	var time=["time"];
    var RAMUsage=["RAM Usage"];
    var RAMexpo=["Average"];
    var prev_temp=0;
    var count=0;
    var timeout=3*1000;
    var chart = c3.generate({
      data: {
        x:"time",
        //xSort: true,
        columns: [
          RAMUsage,
          time,
          RAMexpo
          ]
      },
      colors: {
          "RAM Usage":"#e0991f",
          "Average": "#f9cf86"
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
		RAMexpo.push(0);
		RAMUsage.push(0);
	}


//var docElm = document.body;
//if (docElm.requestFullscreen) { docElm.requestFullscreen(); } else if (docElm.mozRequestFullScreen) { docElm.mozRequestFullScreen(); } else if (docElm.webkitRequestFullScreen) { docElm.webkitRequestFullScreen(); } else if (docElm.msRequestFullscreen) { docElm.msRequestFullscreen(); }

function load(){
	time.push(i);
	var nowtemp = nextLoadValue;
	newGetLoad(); //Getting the next load value
	prev_temp = 0.75 * prev_temp + 0.25*nowtemp;
	RAMUsage.push(nowtemp);
	RAMexpo.push(prev_temp);
	count=count+1;
	if(count>100){
		time.splice(1,1);RAMUsage.splice(1,1);RAMexpo.splice(1,1);
	}
	chart.load({
		x:"time",
		columns: [
			RAMUsage,time,RAMexpo
		],
		colors: {
		   "RAM Usage":"#e0991f",
          "Average": "#f9cf86"
		},
		length: (function(){if(count<=200){return count;}else{return 1;}})(),
		duration:timeout
	});
	i = i+1;
	setTimeout(load,timeout);
}

load();
</script> 
</body> 
</html>
