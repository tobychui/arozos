<?php
include_once("../../../auth.php");
include_once("clusterSettingLoader.php");

if (isset($_POST['newconfig']) && $_POST['newconfig'] != ""){
    file_put_contents("clusterSetting.config",$_POST['newconfig']);
    echo "DONE";
    exit(0);
}
?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>Cluster Scanner Config</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body>
    <br><br>
    <div class="ts container">
        <div class="ts segment">
                <div class="ts header">
                    <i class="server icon"></i> ArOZ Cluster Scanning Setttings
                    <div class="sub header">Customize Custer Scanner Prefix and Port</div>
                </div>
        </div>
        <div class="ts segment">
            <p>System Prefix (The relative path from webroot to ArOZ Root)</p>
            <div class="ts fluid input">
                <input id="prefix" type="text" placeholder="System Prefix" value="<?php echo $clusterSetting["prefix"]; ?>">
            </div>
            <p>System Port (The port that host the web server for ArOZ Online Cluster)</p>
            <div class="ts fluid input">
                <input id="port" type="text" placeholder="System Port" value="<?php echo $clusterSetting["port"]; ?>">
            </div>
            <div class="ts segment" align="right">
                <button class="ts primary mini button" onClick="updateClusterSettings();">Update</button>
                <button class="ts secondary mini basic button" onClick="window.location.reload();">Cancel</button>
            </div>
            <div id="finishedLabel" class="ts inverted positive segment" style="display:none;">
                <p><i class="checkmark icon"></i>Cluster Scanning Setting Updated.</p>
            </div>
            <br><br>
            <details class="ts accordion">
                <summary>
                    <i class="dropdown icon"></i> Know more about "System Prefix" and "System Port"
                </summary>
                <div class="content">
                    <h5>ArOZ Cluster System - System Prefix and Port</h5>
                    <p><i class="caret right icon"></i>ArOZ Cluster System use the same mirror of the control ArrOZ Online System. To differentiate the different between Cluster (Storage or Compute Node) and Control Nodes, they can be host on different ports or with different system prefix. One Machine can host multiple nodes as well with different ports and prefixs depending on the cluster group. 
                    <br><br>
                    <i class="caret right icon"></i>By default, the System Prefix is the directory path relative to the ArOZ Online Root (aor) to the web root (aka / or /var/www/html on Debian Jessie with Apache).
                    <br>
                    <i class="caret right icon"></i>System Port, by default is the port that you use to host the clusters (aka port 80 for default web server settings). You can also change the port by modifying the apache config to seperate clusters with control nodes.</p>
                </div>
            </details>
        </div>
    </div>
    <script>
        function updateClusterSettings(){
            var prefix = $("#prefix").val().trim();
            var port = $("#port").val().trim();
            var newcontent = {prefix: prefix,port: port};
            newcontent = JSON.stringify(newcontent);
            $.post("clusterSettingUI.php",{newconfig: newcontent}).done(function(data){
                $("#finishedLabel").slideDown().delay(3000).slideUp();
            });
        }
    </script>
</body>
</html>