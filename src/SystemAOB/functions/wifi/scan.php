<?php
include '../../../auth.php';
?>
<!--
Build 2018-06-09 15:25
Line 58:
Due to i dont have PEAP network to test it, it may not working on PEAP netowrk, please change correct value
-->
<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="../../../script/tocas/tocas.css">
    <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
    <script src="../../../script/jquery.min.js"></script>
    <title>WIFI</title>
    <style type="text/css">
        body {
            padding-top: 4em;
            background-color: rgb(250, 250, 250);
            overflow: hidden;
        }

        .ts.segmented.list {
            height: 100vh;
        }
    </style>
</head>

<body>
    <div class="ts container">
        Discover Wi-Fi Network
        <div class="ts segmented items" style="background-color: white;" id="list">
        </div>


        <div id="config">


        </div>

    </div>


    <script>
        $.getJSON("wscan.php", function(result) {
            $.each(result, function(i, wscan) {
                $("#list").append('<div class="item" id="' + wscan[5] + '">' + wscan[5] + '&nbsp;&nbsp;&nbsp;<a onclick="connect(\'' + wscan[5] + '\',\'' + wscan[6] + '\',\'' + wscan[4] + '\')"><i class="cogs icon"></i>Connect</a> </div>');
            });
            $.getJSON("getSSID.php", function(result) {
                $("#" + result[0]).attr("style", "background-color: rgb(250,250,250);");
                $("#" + result[0]).text(result[0] + " - (Connected)");
            });
        });

        function connect(ssid,method,encrypt) {
			if(method.includes("WPA2")){
            $("#config").html('<div class="field"><div class="ts form"><label>Password For ' + ssid + '</label><br><input type="password" name="pwd" id="pwd">&nbsp;<button onclick="est(\'wpa2\')" id="ssid" class="ts button" name="ssid" value="' + ssid + '">Connect</button></div></div>')
			}else if(encrypt.includes("off")){
			$("#config").html('<div class="field"><div class="ts form"><label>Connect to ' + ssid + '</label><br><button onclick="est(\'no\')" id="ssid" class="ts button" name="ssid" value="' + ssid + '">Connect</button></div></div>')
			}else if(method.includes("PEAP")){
			$("#config").html('<div class="field"><div class="ts form"><label>You are connecting to '+ ssid +'</label><br><label>Username</label><br><input type="username" name="username" id="username">&nbsp;<br><label>Password</label><br><input type="password" name="pwd" id="pwd">&nbsp;<br><button onclick="est(\'PEAP\')" id="ssid" class="ts button" name="ssid" value="' + ssid + '">Connect</button></div></div>') 
			};
        }


        var pro;

        function est(method) {
		
            $.get("connect.php", {
				method: method,
                ssid: $("#ssid").val(),
				usr: $("#username").val(),
                pwd: $("#pwd").val()
            }, restart());

            function restart() {
                $("#config").html('Restarting...');
                $.get("wrestart.php",
                    function() {
                        $("#config").html('Updating database...');
                        pdb_update();
                    }
                )
            }

			

        };

        function pdb_update() {
            $.get("/AOB/Pi-DB/table_r.php?db=db/system&opr=SELECT%20status%20FROM%20system_setting.csv%20WHERE%20name=%22wifi_priority%22'")
                .done(function(data) {
                    pdb_delete();
                    pro = data;
                });
        }

        function pdb_delete() {
            $.get("/AOB/Pi-DB/table_w.php?db=db/system&opr=DELETE%20FROM%20system_setting.csv%20KEY%20wifi_priority")
                .done(function(data) {
                    pdb_insert();
                });
        }

        function pdb_insert() {

            $.get('/AOB/Pi-DB/table_w.php?db=db/system&opr=INSERT INTO system_setting.csv VALUES wifi_priority,'.concat(String(Number(pro[0][0][1]) + 1)))
                .done(function(data) {
                    $("#config").html('Added Wi-Fi Network.');
                });
        }
    </script>

	
</body>

</html>