<?php
include_once("../../../auth.php");

if (isset($_POST['createKey']) && $_POST['createKey'] != ""){
    //When creating a new key entry
    $key = json_decode($_POST['createKey'],true);
    $keyStorage = $sysConfigDir . "keypairs/remote/";
    if (!file_exists($keyStorage)){
        mkdir($keyStorage,0777,true);
    }
    $targetUUID = $key[0];
    $pkey = $key[1];
    file_put_contents($keyStorage . $targetUUID . "_rsa.pub",$pkey);
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
        <title>Access Key Manager</title>
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
                    <i class="key icon"></i>Access Key Manager
                    <div class="sub header">Create or manage existing public and private keys</div>
                </div>
            </div>
            <div class="ts segment">
                <div class="ts positive small button" onClick="createNewKeypairs();"><i class="plus icon"></i>Generate New Keypair</div>
                <div class="ts primary small button" onClick="importPublicKey();"><i class="key icon"></i>Import Public Key</div>
                <div style="display:inline;padding-left:30px;" id="deviceuuid"><?php include_once("../../../hb.php");?>
              </div>
            </div>
            <div class="ts segment">
                <table class="ts table">
                    <thead>
                        <tr>
                            <th>Public Key UUID</th>
                            <th>Local Generated Key</th>
                            <th>Creation Date</th>
                            <th>Show Key</th>
                        </tr>
                    </thead>
                    <tbody id="keyList">
                    </tbody>
                </table>
                <table class="ts table">
                    <thead>
                        <tr>
                            <th>Remote Host UUID</th>
                            <th>Local Generated Key</th>
                            <th>Creation Date</th>
                            <th>Show Key</th>
                        </tr>
                    </thead>
                    <tbody id="rkeyList">
                    </tbody>
                </table>
            </div>
        </div>
        
        <div id="newKeyEntry" class="ts raised segment" style="position:fixed;top:30px;left:20px;right:20px;display:none;">
            <p>Remote Devices UUID</p>
            <div class="ts mini fluid action input">
                <input id="ruuid" type="text" placeholder="Remote UUID">
                <button class="ts button" onClick="toggleNearbyClusterList();"><i class="caret down icon"></i>Select From Nearby Hosts</button>
            </div>
            <div id="clusterList" class="ts ordered shadowed list" style="max-height:200px;overflow-y:auto;display:none;">
                <a class="item">Loading...</a>
            </div>
            <p>Remote Public Key (Copy and Paste in the textarea below)</p>
            <div class="ts mini fluid input">
                <textarea id="pkeycontent" placeholder="Public Key" rows="7"></textarea>
            </div>
            <div class="ts segment" align="right">
                <button class="ts primary button" onClick="createNewPublicKey();">Add</button>
                <button class="ts button" onClick="cancelSelections();">Cancel</button>
            </div>
        </div>
        
        <dialog id="details"  class="ts fullscreen modal" style="position:fixed;top:10%;">
            <div id="publicKeyUUID" class="header">
                Public Key - 
            </div>
            <div class="content">
                <textarea class="ts fluid input" style="min-height:200px" id="publicKeyContent"></textarea>
            <div class="actions">
                <button id="copybtn" class="ts primary button">
                    Copy
                </button>
                <button class="ts basic button" onClick="$(details).hide();">
                    Close
                </button>
            </div>
            <p>Copy the public key to <ins>another host's key registration page</ins> to establish cross cluster communication pipeline.</p>
            <div id="copyFinished" class="ts inverted primary segment" style="display:none;">
                <p><i class="copy icon"></i>Public Key copied.</p>
            </div>
        </dialog>
        
        <script>
        var nickNameList = [];
        updateNickNameList();
        updateKeyList();
        filterUUID();
        
        function updateNickNameList(){
            $.get("clusterNicknameConfig.php",function(data){
                nickNameList = data;
            });    
        }
        
        function importPublicKey(){
            $("#newKeyEntry").show();
        }
        
        function selectThisHost(object){
            var uid = $(object).text();
            if (uid.includes(" ")){
                uid = uid.split(" ")[0];
            }
            $("#ruuid").val(uid);
            $("#clusterList").slideUp();
        }
        
        function toggleNearbyClusterList(){
            $("#clusterList").html("<a class='item'>Loading...</a>");
            $("#clusterList").slideToggle();
            $.get("getClusterList.php",function(data){
                $("#clusterList").html("");
                for (var i =0; i < data.length; i++){
                    var nickname = searchForNickNameInNameList(nickNameList,data[i][0]);
                    if (nickname == "N/A"){
                        nickname = data[i][1]; //Use last seen IP address instead of nickname
                    }
                    $("#clusterList").append('<a class="item" onClick="selectThisHost(this);">' + data[i][0] + ' (' + nickname + ')' + '</a>');
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
            
        function createNewPublicKey(){
            var pKeyValue = $("#pkeycontent").val();
            var targetUUID = $("#ruuid").val();
            $.post("keyManager.php",{createKey: JSON.stringify([targetUUID,pKeyValue])}).done(function(data){
                //creation process finished. Reload page
                window.location.reload();
            });
        }
        
        function cancelSelections(){
            $("#ruuid").val("");
            $("#pkeycontent").val("");
            $("#newKeyEntry").fadeOut('fast');
        }
        
        function filterUUID(){
            var uuidRaw = $("#deviceuuid").text().trim();
            if (uuidRaw.includes(",")){
                var uuid = uuidRaw.split(",")[2];
                $("#deviceuuid").text("UUID of this Host: " + uuid);
            }
        }
        
        function updateKeyList(){
            $("#keyList").html("");
            $.get("getPublicKey.php",function(data){
                for (var i = 0; i < data.length; i++){
                    var uuid = data[i][1];
                    var localKey = data[i][2];
                    if (localKey){
                        icon = '<i class="checkmark large positive icon"></i>';
                    }else{
                        icon = '<i class="remove large negative icon"></i>';
                    }
                    var creationDate = data[i][3];
                    $("#keyList").append('<tr>\
                            <td>' + uuid + '</td>\
                            <td>' + icon + '</td>\
                            <td>' + creationDate + '</td>\
                            <td><button uuid="' + uuid + '" class="ts icon primary basic button" onClick="showContent(this);"><i class="unhide icon"></i></button></td>\
                        </tr>');
                }
            }); 
            $.get("getPublicKey.php?remoteKey",function(data){
                for (var i = 0; i < data.length; i++){
                    var uuid = data[i][1];
                    var localKey = data[i][2];
                    if (localKey){
                        icon = '<i class="checkmark large positive icon"></i>';
                    }else{
                        icon = '<i class="remove large negative icon"></i>';
                    }
                    var creationDate = data[i][3];
                    $("#rkeyList").append('<tr>\
                            <td>' + uuid + '</td>\
                            <td>' + icon + '</td>\
                            <td>' + creationDate + '</td>\
                            <td><button uuid="' + uuid + '" class="ts icon primary basic button" onClick="showrKey(this);"><i class="unhide icon"></i></button></td>\
                        </tr>');
                }
            }); 
        }
        
        function showContent(object){
            clearKeyDisplay();
            var uuid = $(object).attr("uuid").trim();
            $.get("getPublicKey.php?getkey=" + uuid,function(data){
                $("#publicKeyUUID").text("Public Key: " + uuid);
                $("#publicKeyContent").text(data);
                $("#details").show();
            });
        }
        
        function clearKeyDisplay(){
            $("#publicKeyUUID").text("");
            $("#publicKeyContent").text("");
        }
        
        function showrKey(object){
            clearKeyDisplay();
            var uuid = $(object).attr("uuid").trim();
            $.get("getPublicKey.php?getrkey=" + uuid,function(data){
                $("#publicKeyUUID").text("Public Key: " + uuid);
                $("#publicKeyContent").text(data);
                $("#details").show();
            });
        }
        
        function createNewKeypairs(){
            if (confirm("Please only generate the necessary amount of key pairs. Extra key pairs might lead to security issues. Confirm Creation?")){
              $.get("generatePkey.php",function(data){
                    if (data.includes("ERROR") == false){
                        window.location.reload();
                    }
                }); 
            }
            
        }
        
        $("#copybtn").on("click",function(){
            $("#publicKeyContent").select();
            document.execCommand('copy');
            $("#copyFinished").slideDown().delay(3000).slideUp();
        });

        </script>
    </body>
</html>