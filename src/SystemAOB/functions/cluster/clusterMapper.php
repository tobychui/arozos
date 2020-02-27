<?php
include_once("../../../auth.php");
//Create a directory to store mappers files
if (!file_exists("mappers")){
    mkdir("mappers",0777);
}
if (isset($_GET['MapperID']) && $_GET['MapperID'] != "" && isset($_GET['IPAddr']) && $_GET['IPAddr'] != ""){
    //Record the MapperID and IPAddr into the key value pairs
    //Check if this is a valid IPv4 Address
    $tmp = explode(".",$_GET['IPAddr']);
    if (count($tmp) != 4){
        die("ERROR. Invalid IPv4 Address provided.");
    }
    file_put_contents("mappers/" . $_GET['MapperID'] . ".inf",$_GET['IPAddr']);
    echo "DONE";
    exit(0);
}else if (isset($_GET['list'])){
    $mappers = glob("mappers/*.inf");
    $results = [];
    foreach ($mappers as $map){
        $content = file_get_contents($map);
        array_push($results, [basename($map,".inf"),trim($content)]);
    }
    header('Content-Type: application/json');
    echo json_encode($results);
    exit(0);
}
?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>Cluster Mapping List</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            .absolute{
                position:absolute !important;
                top:5px !important;
                right:5px !important;
            }
        </style>
    </head>
    <body>
        <br><br>
        <div class="ts container">
            <div class="ts segment">
                <div class="ts header">
                    <i class="block layout icon"></i>Cluster Mapper
                    <div class="sub header">Manage Cluster Mapping with Host ID and IP Address</div>
                </div>
            </div>
            <div class="ts segment">
                <table class="ts celled table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Device UUID</th>
                            <th>Last seen IP address</th>
                            <th>Tag Name</th>
                        </tr>
                    </thead>
                    <tbody id="mapperList">
                        
                    </tbody>
                </table>
            </div>
            <div class="ts segment">
                <p><i class="help icon"></i>What is Cluster Mapping? What is it difference from Cluster List?</p>
                <p>Cluster List is the real time preview of the current cluster host on the network, while 
                Cluster Mapping is a stored record of the last seens for any clusters that have appeared on the network.
                <br>
                Not all the files on the list is usable as some ip address might change and the list is not updated yet or the target cluster host has been shutted down.
                <br><br>
                To remove an record from the list, enter the mappers folder under SystemAOB/functions/clusters/ and remove the one with the correct uuid.<br>THIS ACTION MIGHT AFFECT THE CLUSTER STABILITY. </p>
            </div>
        </div>
        <br><br>
        <script>
            var template = '<tr>\
                            <td>{count}</td>\
                            <td id="uiddiv">{UUID}</td>\
                            <td>{IPadrr}</td>\
                            <td>{tagName}<button class="ts mini basic icon button absolute" onClick="rename(this);"><i class="edit icon"></i></button></td>\
                        </tr>';
            var nicknameList = [];
            getClusterNickNameList(initMapperList);
            
            function getClusterNickNameList(callback){
                $.get("clusterNicknameConfig.php",function(data){
                    nicknameList = data;
                    callback(data);
                });
            }
            
            function rename(object){
                var uid = $(object).parent().parent().find("#uiddiv").text();
                if ($(object).parent().text() != "N/A"){
                    display = $(object).parent().text().trim();
                }else{
                    display = uid;
                }
                var newname = prompt("Please enter a name for this host.",display);
                if (newname != "" && newname != null){
                    $.post("clusterNicknameConfig.php",{uuid: uid, newNickname: newname}).done(function(data){
                        if (data.includes("ERROR") == false){
                            //Successfully added. Reload the list
                            getClusterNickNameList(initMapperList);
                        }else{
                            alert("ERROR. Operation cancelled. " + data);
                        }
                    });
                }else{
                   //Opr cancelled
                }
            }
            
            function initMapperList(tagNameList){
                $("#mapperList").html("");
                $.get("clusterMapper.php?list",function(data){
                    for (var i =0; i < data.length;i++){
                        var box = template;
                        box = box.replace("{count}",i);
                        box = box.replace("{UUID}",data[i][0]);
                        box = box.replace("{IPadrr}",data[i][1]);
                        box = box.replace("{tagName}",searchForNickNameInNameList(tagNameList,data[i][0]));
                        $("#mapperList").append(box);
                    }
                    
                });
            }
            
            function searchForNickNameInNameList(namelist,uuid){
                for (var i =0; i < namelist.length; i++){
                    if (namelist[i][0] == uuid){
                        return namelist[i][1];
                    }
                }
                return "N/A";
            }
        </script>
    </body>
</html>