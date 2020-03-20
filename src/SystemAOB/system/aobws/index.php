<?php
include_once("../../../auth.php");

$port = 8000;

if (file_exists("../../functions/personalization/sysconf/aobws.config")){
    $settings = json_decode(file_get_contents("../../functions/personalization/sysconf/aobws.config"),true);
    $port = $settings["aobwsport"][3];
}
?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>AOBWS</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            
        </style>
    </head>
    <body>
        <div class="ts container">
            <br>
            <div class="ts segment">
               <div class="ts header">
                    ArOZ Online WebSocket Server (aobws)
                    <div class="sub header">Real time communication for ease</div>
                </div>
            </div>
            <div class="ts segment">
                <p>Current state of ArOZ Online WebSocket Server</p>
                <p id="state"><i class="loading spinner icon"></i> Checking WebSocket Server Status</p>
            </div>
            <div class="ts segment">
                <button id="enablebtn" class="ts primary button" onclick="initWS(); ">Start aobws</button>
                <button id="disablebtn" class="ts negative disabled button" onclick="stopWS(); ">Stop aobws</button>
            </div>
        </div>
        <div style="display:none">
            <div id="data_aobwsport"><?php echo $port; ?></div>
        </div>
        <script>
            var port = $("#data_aobwsport").text().trim();
            
            //Check if the websocket server already running.
            var server = window.location.host;
        	if (server.includes(":")){
        		server = window.location.host.split(":")[0]; //To handle cases like 192.168.0.100:8080
        	}
        	
        	var serveraddr = "ws://" + server + ":" + port + "/ws";
        	console.log("Starting connection test on: " + serveraddr);
        	//Try to open the ws connection
        	var conn = new WebSocket(serveraddr);
			conn.onopen = function (evt){
				//Connection openeed
				$("#state").html("<i class='checkmark icon'></i> WebSocket Server Online.");
				$("#enablebtn").addClass("disabled");
				$("#disablebtn").removeClass("disabled");
			};
			conn.onmessage = function (evt) {
				console.log(evt);
				ao_module_ws.parse(evt,onmessage);
			};
			conn.ononerror = function(evt){
				alert("error opening ws");
			};
			conn.onclose = function(evt) {
              if (evt.code == 3001) {
                console.log('ws closed');
              } else {
                //Websocket is not started
                console.log('ws connection error');
                $("#disablebtn").addClass("disabled");
				$("#enablebtn").removeClass("disabled");
                $("#state").html("<i class='remove icon'></i> WebSocket Server Offline.");
              }
            };
            
            function initWS(){
                $.get("init.php",function(data){
                    window.location.reload();
                });
            }
            
            function stopWS(){
                $.get("stop.php",function(data){
                    window.location.reload();
                });
            }
        </script>
    </body>
</html>