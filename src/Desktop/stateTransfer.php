<?php
include_once("../auth.php");
$username = $_SESSION['login'];
if (file_exists("tmp/transfer_sessions/$username") == false){
    if (!mkdir("tmp/transfer_sessions/$username", 0777, true)) {
        die('ERROR. Unable to create transfer_sessions directories. Please make sure you have correct permission settings.');
    }
}

if (isset($_GET['liststate'])){
    //List all the stored states
    $result = [];
    $states = glob("tmp/transfer_sessions/$username/*.json");
    foreach ($states as $state){
        array_push($result,basename($state));
    }
    $result = array_reverse($result);
    header('Content-Type: application/json');
    echo json_encode($result);
    exit(0);
}

if (isset($_GET['clearStates'])){
    $states = glob("tmp/transfer_sessions/$username/*.json");
    foreach ($states as $state){
          unlink($state); 
    }
    echo "DONE";
    exit(0);
}

if (isset($_GET['restoreFromState'])){
    //State will be automatically removed after restore.
    $filename = $_GET['restoreFromState'];
    if (file_exists("tmp/transfer_sessions/$username/" . $filename)){
        //File exists. Read it content and send to the users
        $content = file_get_contents("tmp/transfer_sessions/$username/" . $filename);
        unlink("tmp/transfer_sessions/$username/" . $filename);
        echo $content;
        exit(0);
    }else{
        die("ERROR. State not found.");
    }
}

if(isset($_POST['createState']) && $_POST['createState'] != ""){
    //Create a new state from the given json data, and return the filename to client
    $filename = time() . ".json";
    $filepath = "tmp/transfer_sessions/$username/" . $filename;
    $content = $_POST['createState'];
    file_put_contents($filepath,$content);
    echo $filename;
    exit(0);
}
?>
<html>
    <head>
        <title>Desktop State Transfer Utilities</title>
        <link rel="stylesheet" href="../script/tocas/tocas.css">
    	<script src="../script/tocas/tocas.js"></script>
    	<script src="../script/jquery.min.js"></script>
    	<script src="../script/ao_module.js"></script>
    	<style>
    	    .item{
    	        cursor:pointer;
    	    }
    	</style>
    </head>
    <body>
        <br>
        <div class="ts container">
            <div class="ts segments">
                <div class="ts segment">
                    <div class="ts header">
                        <i class="desktop icon"></i><i class="exchange icon"></i><i class="desktop icon"></i>Desktop State Transfer
                        <div class="sub header">Transfer your current Desktop to your other devices</div>
                    </div>
                </div>
                <div class="ts segment">
                    <p>Create a new state from the current Desktop</p>
                    <div class="ts mini fluid action input">
                        <input id="generatedDesktopState" type="text" value="" readonly="true">
                        <button class="ts primary labeled icon button" onClick="generateDesktopState();">
                            <i class="plus icon"></i>
                            Create
                        </button>
                    </div>
                </div>
                <div class="ts segment">
                    <p>Or Double Click list item to restore states</p>
                    <div id="stateList" class="ts tiny segmented list" style="max-height:230px;overflow-y:auto;">
                       <div class="item"><i class="sticky note icon"></i>No Desktop State Available</div>
                    </div>
                </div>
                <div class="ts negative segment" align="right">
                    <button class="ts small labeled negative icon button" onClick="clearAllStates();">
                        <i class="trash outline icon"></i>
                        Remove All States
                    </button>
                </div>
            </div>
        </div>
        <script>
            initStateList();
            ao_module_setWindowSize(390,590);
            ao_module_setFixedWindowSize();
            
            function selectState(object){
                $(".item").removeClass("selected");
                $(object).addClass("selected");
            }
            
            function initStateList(){
                $.get("stateTransfer.php?liststate",function(data){
                   if (data.length > 0){
                        //Only update the list if there are more than 1 files
                        $("#stateList").html("");
                        for (var i =0; i < data.length; i++){
                            var d = new Date(parseInt(data[i]) * 1000);
                            $("#stateList").append('<div class="item" onClick="selectState(this);" ondblclick="restoreState(this);" filename="' + data[i] + '">' + d.toString() + '</div>');
                        }
                   }else{
                       $("#stateList").html('<div class="item"><i class="sticky note icon"></i>No Desktop State Available</div>');
                   }
                });
            }
            
            function restoreState(object){
                if (confirm("State can only be restore once. Are you sure that you want to restore the previous state?")){
                    var filename = $(object).attr("filename");
                    $.get("stateTransfer.php?restoreFromState=" + filename,function(data){
                        if (data.substring(0,5) == "ERROR"){
                            ao_module_msgbox("Something went wrong during the Window State Restore process.<br>" + data,"<i class='caution icon'></i>Desktop State Restore");
                            return;
                        }
                        console.log(data);
                        restoreFloatWindowsFromJSON(data);
                        $("#generatedDesktopState").val("");
                        initStateList();
                    });
                }
                
            }
            
            function restoreFloatWindowsFromJSON(jsonString){
                var restoreList = JSON.parse(jsonString);
                if (restoreList.length > 0){
                    //Restore the floatWindows from the list by force append the windows into the parent document body
                    var targetDocument = window.parent.document;
                    targetDocument = $(targetDocument).find("body");
                    for (var i=0; i < restoreList.length; i++){
                        targetDocument.append(restoreList[i]);
                        var iconTag = $(restoreList[i]).find(".floatWindow").find("i").attr("class").replace("icon","");
                        var uid = $(restoreList[i]).attr("id");
                        var src = $(restoreList[i]).find("iframe").attr("src");
                        injectButtonToMenu(iconTag,uid,src);
                    }
                }
                ao_module_close();
            }
            
            function injectButtonToMenu(iconTag,uid,src){
                window.parent.AppendNewIcon(iconTag,uid,src);
            }
            
            function clearAllStates(){
                if (confirm("Clear All States - Confirm?")){
                    $.get("stateTransfer.php?clearStates",function(){
                        initStateList();
                    });
                }
            }
            
            function generateDesktopState(){
                //This function get all the floatWindow in the parent windows and its properties so it can be saved as JSON on SERVER side
                if (!ao_module_virtualDesktop){
                    alert("This function can only be usd under Virtual Desktop Environment with FunctionBar Enabled.")
                    return;
                }
                var globalwindow = window.parent.document;
                var floatWindows = $(globalwindow).find(".floatWindow");
                var result = [];
                //For each floatWindow, save its HTML as JSON string
                for (var i = 0; i < floatWindows.length; i++){
                    //Record all floatWindows except itself (The state restore window) and the new window cloning code
                    if ($(floatWindows[i]).parent().attr("id") != "newWindow" && $(floatWindows[i]).parent().attr("id") != ao_module_windowID){
                        var html = $(floatWindows[i]).parent().prop('outerHTML');
                        result.push(html);
                    }
                }
                result = JSON.stringify(result);
                //Push the data to server side and save as JSON
                $.post( "stateTransfer.php", { createState: result})
                    .done(function( data ) {
                    $("#generatedDesktopState").val(data);
                    initStateList();
                });
            }
        </script>
    </body>
</html>