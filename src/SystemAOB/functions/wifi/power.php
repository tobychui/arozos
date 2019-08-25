<?php
include_once("../../../auth.php");

//This php can be called with ajax and ask for waking up wlan0 and wlan1. However, one of them must be on at a time.
function mv($value){
    if (isset($_GET[$value]) && $_GET[$value] != ""){
        return $_GET[$value];
    }else{
        return "";
    }
}

function checkLinuxWlanUpDown($wlanID){
    $result = trim(shell_exec("cat /sys/class/net/wlan" . $wlanID . "/operstate"));
    if (trim($result) == ""){
        return "not_found";
    }else{
        return $result;
    }
    
    
}
if (strtoupper(substr(PHP_OS, 0, 3)) !== 'WIN') {
    //Running on Linux host
    if (mv("enable") != ""){
        $wlan = mv("enable");
        if ($wlan == "wlan0"){
            //Enable wlan0 no matter it is enabled or not
            system("sudo ifup wlan0");
            die("DONE");
        }else if ($wlan == "wlan1"){
            //Enable wlan1 no matter it is enable or not
            system("sudo ifup wlan1");
            die("DONE");
        }
    }
    
    if (mv("disable") != ""){
        if (mv("disable") == "wlan0"){
            if (checkLinuxWlanUpDown(1) == "down"){
                die("ERROR. Cannot disable wlan0 while wlan1 is also disabled.");
            }else{
                system("sudo ifdown wlan0");
                die("DONE");
            }
        }else if (mv("disable") == "wlan1"){
            if (checkLinuxWlanUpDown(0) == "down"){
                die("ERROR. Cannot disable wlan1 while wlan0 is also disabled.");
            }else{
                system("sudo ifdown wlan1");
                die("DONE");
            }
        }
    }
    
    if (mv("check") != ""){
        die(checkLinuxWlanUpDown(mv("check")));
    }
    
}else{
    //Running on a Window host
}
?>
<html>
    <head>
        <title>WiFi Power Status</title>
        <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
    	<script src="../../../script/jquery.min.js"></script>
    	<style>
        	body{
        	    background-color:#f7f7f7;
        	}
    	    .selectable{
    	        cursor:pointer;
    	    }
    	</style>
    </head>
    <body>
        <br><br>
        <div class="ts container">
            <div class="ts segment">
                <div class="ts header">
                    WiFi Adapter Power Management
                    <div class="sub header">Shutdown unused wireless hardware to save power</div>
                </div>
            </div>
            <?php
                if (strtoupper(substr(PHP_OS, 0, 3)) === 'WIN') {
                    echo '<div class="ts message">
                        <div class="header">Not Supported OS</div>
                        <p>This function is not supported in Windows Host.</p>
                    </div>';
                    exit(0);
                }
            ?>
            <div id="errormsg" class="ts primary segment" style="display:none;">
                <p>Error Message: </p>
            </div>
            <div class="ts inverted segment">
                <p id="wlan0">wlan0: N/A</p>
            </div>
            <div>Action: <a onClick="onwlan(0);" class="selectable">wlan0-up</a> / <a onClick="offwlan(0);" class="selectable">wlan0-down</a></div>
            <div class="ts inverted segment">
                <p id="wlan1">wlan1: N/A</p>
            </div>
            <div>Action: <a onClick="onwlan(1);" class="selectable">wlan1-up</a> / <a onClick="offwlan(1);" class="selectable">wlan1-down</a></div>
            <details class="ts accordion">
                <summary>
                    <i class="dropdown icon"></i> What is wlan0 and wlan1?
                </summary>
                <div class="content">
                    <p>ArOZ Online System that runs on Raspberry Pi Zero W / Pi 3B+ or above require at least two WiFi Adapter to work.
                    But in most of the cases, even two wireless hardware is built in, most people only use one of them at the same time.
                    Hence, switching on of them off will save more power and extend the battery life of the device.</p>
                    <mark>By default, wlan0 is WiFi Client and wlan1 is Acess Point</mark>
                    <p>If you are accessing the ArOZ Online System via Local IP Scanner (e.g. lanips.imuslab.com or ArOZ Portable Scanner Apps), do not shutdown wlan0<br>
                    If you are accessing the ArOZ Online System via directly connect to the devices' WiFi Hotspot, do not turn of wlan1.</p>
                    <p>If you don't know anything about WiFi or AP, just leave both of them on.</p>
                </div>
            </details>
        </div>
        <script>
            $(document).ready(function(){
               updateBothwlanStatus();
            });
            
            var haswifi = false;
$.get("ifconfig.php", function (data) {
	data.forEach(function(element) {
         if(element["InterfaceIcon"] == "WiFi"){
			haswifi= true;
        }
    });
	if(!haswifi){
		window.location = "nowifi.html"
    }
});

            function onwlan(id){
                if (id == 0){
                     $.get("power.php?enable=wlan0",function(data){
                         updateBothwlanStatus();
                     });
                }else if (id == 1){
                    $.get("power.php?enable=wlan1",function(data){
                         updateBothwlanStatus();
                     });
                }
                
            }
            function offwlan(id){
                if (id == 0){
                    $.get("power.php?disable=wlan0",function(data){
                        if (data.includes("ERROR")){
                            $("#errormsg").find("p").text(data);
                            $("#errormsg").fadeIn().delay(5000).fadeOut();
                        }else{
                            updateBothwlanStatus();
                        }
                         
                    });
                }else if (id == 1){
                    $.get("power.php?disable=wlan1",function(data){
                        if (data.includes("ERROR")){
                            $("#errormsg").find("p").text(data);
                            $("#errormsg").fadeIn().delay(5000).fadeOut();
                        }else{
                            updateBothwlanStatus();
                        }
                         
                    });
                }
                
            }
            
            function updateBothwlanStatus(){
                $("#wlan0").parent().removeClass("positive").removeClass("negative");
                $("#wlan1").parent().removeClass("positive").removeClass("negative");
                $.get("power.php?check=0",function(data){
                    
                    if (data == "up"){
                        $("#wlan0").parent().addClass("positive");
                        $("#wlan0").html("<i class='checkmark icon'></i>wlan0: " + data);
                    }else if (data == "down"){
                        $("#wlan0").parent().addClass("negative");
                        $("#wlan0").html("<i class='remove icon'></i>wlan0: " + data);
                    }
                });
                $.get("power.php?check=1",function(data){
                    if (data == "up"){
                        $("#wlan1").html("<i class='checkmark icon'></i>wlan1: " + data);
                        $("#wlan1").parent().addClass("positive");
                    }else if (data == "down"){
                        $("#wlan1").html("<i class='remove icon'></i>wlan1: " + data);
                        $("#wlan1").parent().addClass("negative");
                    }
                });
            }
        </script>
    </body>
</html>