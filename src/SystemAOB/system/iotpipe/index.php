<?php
include_once("../../../auth.php");
if (!file_exists("req/")){
	mkdir("req/",0777,true);
}
if (!file_exists("name/")){
	mkdir("name/",0777,true);
}

?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
        <title>Manage IoT Devices</title>
        <style>
            .devices{
                padding:5px;
                display: flex;
                align-items:center;
            }
            .devices.image{
                width:80px !important;
                height:80px !important;
                vertical-align:middle;
            }
            .device.desc{
                padding-left:8px;
            }
            .selectable{
                cursor:pointer;
            }
            b{
                font-weight:bold;
            }
            .device.info{
                font-size:85%;
            }
            .device.panel{
                position:absolute;
                top:0px;
                right:0px;
                padding-top:12px;
                padding-right:12px;
            }
        </style>
	</head>
	<body>
	<br><br>
		<div class="ts container">
		    <div class="ts segment">
                <div class="ts header">
                    <i class="sitemap icon"></i>
                    <div class="content">
                        Manage Internet of Things Devices
                        <div class="sub header">Rename and test your devices.</div>
                    </div>
                </div>
            </div>
            <div class="ts segment">
                <?php
                    $devices = glob("devices/auto/*.inf");
                    $fixeddev = glob("devices/fixed/*.inf");
                    foreach ($fixeddev as $fd){
                        array_push($devices,$fd);
                    }
                    foreach ($devices as $dev){
                        $uuid = basename($dev,".inf");
                        //Get information about this device.
                        $devName = "Unnamed";
                        if (file_exists("name/" . $uuid . ".inf")){
                            $devName = strip_tags(file_get_contents("name/" . $uuid . ".inf"));
                        }
                        $devScanInfo = explode(",",file_get_contents($dev));
                        $classInfo = [];
                        if (strpos($devScanInfo[1],"_") !== false){
                            //This is an auto scanned devices.
                            $classInfo = explode("_",$devScanInfo[1]);
                        }else{
                            //This is a fixed location network devices.
                            if (file_exists("drivers/" . $devScanInfo[1] . "/classname.inf")){
                                array_push($classInfo,file_get_contents("drivers/" . $devScanInfo[1] . "/classname.inf"));
                            }else{
                                 array_push($classInfo,"Unknown Device");
                            }
                            array_push($classInfo,$devScanInfo[1]);
                        }
                        $manufactuere = "Generic";
                        if (file_exists("drivers/" . $classInfo[1] . "/manufacturer.inf")){
                            $manufactuere = file_get_contents("drivers/" . $classInfo[1] . "/manufacturer.inf");
                        }
                        
                        $devImage = "img/unknown.png";
                        if (file_exists("drivers/" . $classInfo[1] . "/img/driver.png")){
                            $devImage = "drivers/" . $classInfo[1] . "/img/driver.png";
                        }
                        echo '<div class="devices">
                            <img class="devices image" src="' . $devImage . '">
                            <span class="device desc">
                                <b>' . $devName . '</b> <a devUUID="' . $uuid . '" onClick="renameThis(this);"><i class="edit icon selectable"></i></a> <br>
                                <span class="device info">[' . $uuid . ']</span><br>
                                <span class="device info">' .  $classInfo[0] . '</span> 
                            </span>
                            <div class="device panel" align="right">
                                <button onClick="showMore(this);" class="ts mini button">Show More</button><br>
                                <div class="ts secondary message showMoreContent" style="background-color:white;display:none;z-index:999;" align="left">
                                    <div class="header">Device Information</div>
                                    <p>Driver Type: <span>' . $classInfo[1] . '</span></p>
                                    <p>Last Seen IP: <span>' . $devScanInfo[0] . '</span></p>
                                    <p>Manufacturer: <span>' . $manufactuere . '</span></p>
                                    <button class="ts close button" onClick="closeThis(this);"></button>
                                </div>
                            </div>
                        </div>';
                    }
                ?>
            </div>
		</div>
		<br><br><br><br>
		<script>
		
		    function renameThis(object){
		        var uuid = $(object).attr("devUUID");
		        var name = prompt("Please enter a name for this device.", "");
		        if (name != "" && name != undefined && name != null){
		            $.get("setname.php?name=" + name + "&uuid=" + uuid,function(data){
		                if (data.includes("ERROR")){
		                    alert(data);
		                }else{
		                    window.location.reload();
		                }
		            });
		        }
		        
		    }
		
		    function closeThis(object){
		        $(object).parent().hide();
		    }
		
		    function showMore(object){
		        if ($(object).parent().find(".showMoreContent").is(":visible")){
		            $(".showMoreContent").slideUp('fast');
		            return;
		        }
                $(".showMoreContent").hide();
                $(object).parent().find(".showMoreContent").slideDown('fast');
		        
		    }
		</script>
	</body>
</html>