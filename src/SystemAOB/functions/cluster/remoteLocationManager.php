<?php
include_once("../../../auth.php");
if (!file_exists("remotedev")){
    mkdir("remotedev",0777,true);
}
if (isset($_POST['ip']) && $_POST['ip'] != "" && isset($_POST['port']) && $_POST['port'] != "" && isset($_POST['prefix']) && $_POST['prefix'] != ""){
    $ip = $_POST['ip'];
    $port = $_POST['port'];
    $prefix = $_POST['prefix'];
    $fullPath = $ip . ":" . $port . "/" . $prefix;
    $filename = bin2hex($fullPath) . ".inf"; //Use the fullpath of the cluster for uuid instead of the build in uuid. This helps when setting up the remote host offline.
    file_put_contents("remotedev/" . $filename,$ip . "," . $port . "," . $prefix); //Store the information as csv format
    echo "DONE";
    exit(0);
}

if(isset($_POST['removeTarget']) && $_POST['removeTarget'] != ""){
    $filename = $_POST['removeTarget'] . ".inf";
    if (file_exists("remotedev/" . $filename) && strpos(realpath("remotedev/" . $filename),realpath("remotedev/")) === 0){
        //This make sures the file exists and it is inside the directory of remotedev.
        unlink("remotedev/" . $filename);
        echo "DONE";
        exit(0);
    }else{
        die("ERROR. File not exists inside remotedev.");
    }
}

if (isset($_GET['list'])){
    $data = [];
    $records = glob("remotedev/*.inf");
    foreach ($records as $record){
        $info = explode(",",file_get_contents($record));
        array_push($data,["uuid" => basename($record,".inf"),"endpoint" => $info]);
    }
    header('Content-Type: application/json');
    echo json_encode($data);
    exit(0);
}
?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>Stationary Remote Clusters</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            .shadowed{
                padding:20px !important;
                -webkit-box-shadow: 11px 8px 15px -3px rgba(0,0,0,0.2);
                -moz-box-shadow: 11px 8px 15px -3px rgba(0,0,0,0.2);
                box-shadow: 11px 8px 15px -3px rgba(0,0,0,0.2);
            }
        </style>
    </head>
    <body>
        <br><br>
        <div class="ts container">
            <div class="ts segment">
                <div class="ts header">
                    Stationary Remote Clusters
                    <div class="sub header">Add a Cluster Host using a fixed network location / ip address</div>
                </div>
            </div>
            <div class="ts secondary segment">
                <button class="ts small positive button" onClick="showAddClusterList();"><i class="plus icon"></i>Add a new Remote Cluster</button>
            </div>
            <div id="addClusterForm" class="ts segment" style="display:none;">
                <div class="ts form">
                    <div class="field">
                        <label>Remote Cluster Address</label>
                        <input id="address" type="text" placeholder="192.168.0.100">
                    </div>
                    <div class="field">
                        <label>Target Port</label>
                        <input id="targetport" type="text" placeholder="8080">
                    </div>
                    <div class="field">
                        <label>Prefix (Path from Web Root to ArOZ Online Root, end with "/" )</label>
                        <input id="prefix" type="text" placeholder="AOB/">
                    </div>
                    <details class="ts accordion">
                        <summary>
                            <i class="dropdown icon"></i> What should I fill in?
                        </summary>
                        <div class="content">
                            <p><i class="notice circle icon"></i>If your remote cluster is host on the internet with a public IP address (or with a domain name) and you are currently under a NAT based private network (aka you have to surf the web through a NAT router), 
                            you will need to setup this rules in order to reach clusters outside of the private network.<br>
                            For example, your server is host on 123.203.10.100 with port 80 and you can visit your ArOZ Online System via the url http://123.203.10.100:80/AOB, you will need to fill in the following information in order to discover the remote server with this local host.<br>
                            <i class="caret right icon"></i>Remote Cluster Address: 123.203.10.100<br>
                            <i class="caret right icon"></i>Target Port: 80<br>
                            <i class="caret right icon"></i>Prefix: AOB/<br>
                            **Beware of the "/" after the Prefix "AOB"<br>
                            And you should be able to see the cluster on the list below shortly after the new cluster is added.</p>
                        </div>
                    </details>
                    <div style="width:100%" align="right">
                    <button id="actionBtn" class="ts primary button" style="margin-right:5px;" onClick="createRemoteClusterRecord();">Add</button>
                    <button class="ts button" onClick="resetAndHideAddClusterForm();">Cancel</button>
                    </div>
                </div>
            </div>
            <div class="ts segment">
                <table class="ts celled table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Address</th>
                            <th>Port</th>
                            <th>Prefix</th>
                            <th>Status</th>
                            <th>Open</th>
                            <th>Edit / Remove</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php
                        $records = glob("remotedev/*.inf");
                        $counter = 0; //Programmer count from zero :)
                        foreach ($records as $record){
                            $data = explode(",",file_get_contents($record));
                            $metadata = json_encode($data);
                            $filename = basename($record,".inf");
                            echo "<tr class='remoteClusterRecord' uuid='". $filename ."' meta='". $metadata . "'>";
                            echo "<td>" . $counter . "</td>";
                            echo "<td>" . $data[0] . "</td>";
                            echo "<td>" . $data[1] . "</td>";
                            echo "<td>" . $data[2] . "</td>";
                            echo "<td class='status'><i class='notched circle loading icon'></i></td>";
                            echo '<td><button class="ts mini primary icon button" style="margin: 0px !important;" onClick="openCluster(this);" target="' . $data[0] . ":" . $data[1] . "/" . $data[2] . '">
                                    <i class="external icon"></i>
                                  </button></td>';
                            echo '<td><button class="ts info mini icon button" onClick="editCluster(this);">
                                <i class="edit icon"></i>
                            </button>
                            <button class="ts negative mini icon button" filename="'. $filename.'" onClick="removeCluster(this);">
                                <i class="remove icon"></i>
                            </button>
                            </td>';
                            echo "</tr>";
                            $counter++;
                        }
                        ?>
                    </tbody>
                </table>
                
            </div>
        </div>
        <script>
            var mode = "add";
            var updatingNode = '';
            $(document).ready(function(){
                $(".remoteClusterRecord").each(function(){
                    var info = JSON.parse($(this).attr('meta'));
                    var uuid = $(this).attr("uuid");
                    var ip = info[0];
                    var port = info[1];
                    var prefix = info[2];
                    tryPingCluster(uuid,ip,port,prefix,setOnline,setOffline);
                });
            });
            
            function openCluster(object){
                var url = "http://" + $(object).attr("target") + "index.php";
                window.open(url);
            }
            
            function editCluster(object){
                var info = $(object).parent().parent().attr("meta");
                info = JSON.parse(info);
                updatingNode = $(object).parent().parent().attr("uuid");
                $("#address").val(info[0]);
                $("#targetport").val(info[1]);
                $("#prefix").val(info[2]);
                mode = "update";
                $("#actionBtn").text("Update");
                $("#addClusterForm").show();
            }
            
            //Two functions for setting the states of cluster
            function setOffline(uuid,ip){
                $(".status").each(function(){
                    if ($(this).parent().attr("uuid") == uuid){
                        $(this).html("<i class='remove icon'></i>Offline");
                        $(this).css("color","red");
                    }
                });
            }
            
            function setOnline(uuid,data){
                $(".status").each(function(){
                    if ($(this).parent().attr("uuid") == uuid){
                       if (data[0] == "N/A"){
                           $(this).html("<i class='help icon'></i>Online, Non AOR");
                           $(this).css("color","#c79004"); 
                       }else{
                          $(this).html("<i class='checkmark icon'></i>Online");
                          $(this).css("color","green"); 
                       }
                    }
                });
            }
            
            $("#prefix").on("keydown",function(e){
                if (e.keyCode == 13){
                    //Enter key is pressed on prefix input. Submit the form.
                    createRemoteClusterRecord();
                }
            });
  
            function tryPingCluster(uuid,ip,port,prefix,succ,fail){
                $.ajax({
                    url: "requestInfo.php?ip=" + ip + ":" + port + "/" + prefix,
                    success: function(data){
                        //The cluster with this ip is online.
                    	succ(uuid,data);
                    },
                    error: function(data){
                        //The cluster with this ip do not exists / offline at the moment.
                        fail(uuid,ip);
                    },
                    timeout: 10000 //in milliseconds
                });
            }
            
            function removeCluster(object){
                var filename = $(object).attr("filename");
                if (confirm("Confirm removing of record: " + filename + " ?")){
                    $.post("remoteLocationManager.php",{removeTarget: filename}).done(function(data){
                        if (data.includes("ERROR") == false){
                            window.location.reload();
                        }else{
                            console.log(data);
                        }
                    });
                }
            }
            
            function showAddClusterList(){
                $("#addClusterForm").toggle();
                mode = "add";
                $("#actionBtn").text("Add");
            }
            
            function createRemoteClusterRecord(){
                var address = $("#address").val().trim();
                var targetport = $("#targetport").val().trim();
                var prefix = $("#prefix").val().trim();
                //Clear the previous error message if there are any
                $("#address").parent().removeClass("error");
                $("#targetport").parent().removeClass("error");
                $("#prefix").parent().removeClass("error");
                //Check if the current record is valid
                var valid = true;
                if (address == ""){
                    $("#address").parent().addClass("error");
                    valid = false;
                }
                if (address.includes("/")){
                    //Maybe the user filled in http://123.456.78.90, trim out only the last section of the address
                    address = address.split("/").pop();
                }
                if (targetport == ""){
                    $("#targetport").parent().addClass("error");
                    valid = false;
                }
                if (prefix.slice(-1) != "/"){
                    //Update the DOM and then update the recorded value, this make sure the UI shows the same things as recorded
                    $("#prefix").val(prefix + "/");
                    prefix = $("#prefix").val().trim();
                }
                //Prefix do not need to check of empty as some people might install AOB on their web root (which is not recommended but, they got the freedom to do so :( )
                if (!valid){
                    return;
                }
                //Everythings is doing ok, lets proceed
                if (mode == "add"){
                    $.post("remoteLocationManager.php",{ip: address,port: targetport,prefix: prefix}).done(function(data){
                        if (data.includes("ERROR") == false){
                            window.location.reload();
                        }else{
                            alert("Error. Something went wrong when creating record.");
                            console.log(data);
                        }
                    });
                }else if (mode == "update"){
                    $.post("remoteLocationManager.php",{ip: address,port: targetport,prefix: prefix}).done(function(data){
                        if (data.includes("ERROR") == false){
                            $.post("remoteLocationManager.php",{removeTarget: updatingNode}).done(function(data){
                                if (data.includes("ERROR") == false){
                                    window.location.reload();
                                }else{
                                    console.log(data);
                                }
                            });
                        }else{
                            alert("Error. Something went wrong when creating record.");
                            console.log(data);
                        }
                    });
                }
            }
            
            function resetAndHideAddClusterForm(){
                $("#address").val("");
                $("#targetport").val("");
                $("#prefix").val("");
                $("#addClusterForm").hide();
                mode = "add";
            }
        </script>
    </body>
</head>