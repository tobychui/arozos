<?php
include '../../../auth.php';
?>
<!DOCTYPE html> 
<html lang="en"> 
<head> 
<title>Temp Graph</title> 
<meta charset="utf-8" /> 
<link href="https://cdnjs.cloudflare.com/ajax/libs/c3/0.4.10/c3.min.css" rel="stylesheet" /> 
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/3.5.6/d3.min.js"></script> 
<script src="https://cdnjs.cloudflare.com/ajax/libs/c3/0.4.10/c3.min.js"></script> 
</head> 
<body> 
<?php
if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
    echo "This fucntion is currently not supported on Window Host.";
	exit(0);
} 
?>
<div id="chart"></div> 
<script>
    function getTemp(){ 
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", "getCPUTemp.php", false ); 
    xmlHttp.send( null ); 
    return parseFloat(xmlHttp.responseText);
    }
    var time=["time"];
    var temp=["temp"];
    var expo=["exponential average"];
    var prev_temp=getTemp();
    var count=0;
    var timeout=1*1000;
    var chart = c3.generate({
      data: {
        x:"time",
        //xSort: true,
        columns: [
          temp,
          time,
          expo
          ]
      },
      colors: {
          "temp":"#98bce2",
          "exponential average": "#13aacc"
      },
      axis: {
        x: {
          tick: {
            values: d3.range(0,70)
          }
        }
      }
    });
    //document.getElementById("chart").requestFullScreen();
    for(count=0;count<100;count++){
		time.push(Date.now() - (100 - count)*timeout);
		expo.push(prev_temp);
		temp.push(prev_temp);
	}


//var docElm = document.body;//getElementById("chart"); 
//if (docElm.requestFullscreen) { docElm.requestFullscreen(); } else if (docElm.mozRequestFullScreen) { docElm.mozRequestFullScreen(); } else if (docElm.webkitRequestFullScreen) { docElm.webkitRequestFullScreen(); } else if (docElm.msRequestFullscreen) { docElm.msRequestFullscreen(); }


    function load(){
    time.push(Date.now());
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.open( "GET", "getCPUTemp.php", false ); 
    xmlHttp.send( null );
    var nowtemp=getTemp();
    prev_temp = 0.75 * prev_temp + 0.25*nowtemp;
    temp.push(nowtemp);
    expo.push(prev_temp);
    count=count+1;
    if(count>100){
        time.splice(1,1);temp.splice(1,1);expo.splice(1,1);
    }
    chart.load({
        x:"time",
        columns: [
            temp,time,expo
            //["temp",nowtemp],
            //["time",Date.now()],
            //["exponential average",prev_temp]
        ],
colors: {
          "temp":"#d7e6f7",
          "exponential average": "#426489"
      },

        //length:count-1,
        length: (function(){if(count<=200){return count;}else{return 1;}})(),
        duration:timeout
    });
    setTimeout(load,timeout);
}
 load();
</script> </body> </html>
