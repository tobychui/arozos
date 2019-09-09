<?php
include_once("../../../auth.php");

$mode = "copy";
if (isset($_GET['opr']) && $_GET['opr'] != ""){
    if ($_GET['opr'] == "move"){
        $mode = "move";
    }else if ($_GET['opr'] == "zip"){
        $mode = "zip";
    }else if ($_GET['opr'] == "unzip"){
        $mode = "unzip";
    }else{
        $mode = "copy";
    }
}

function isJson($string) {
    return ((is_string($string) &&
            (is_object(json_decode($string)) ||
            is_array(json_decode($string))))) ? true : false;
}

$listeningIDs = "";
if (isset($_GET['listen']) && $_GET['listen'] != ""){
    if (isJson($_GET['listen'])){
        $listeningIDs = $_GET['listen'];
    }else{
        die("ERROR. Invalid JSON ID list.");
    }
}else{
    die("ERROR. Undefined file operation listening IDs.");
}

$source = "Unknown Source";
$target = "Unknown Target";

if (isset($_GET['source']) && $_GET['source'] != ""){
    $source = strip_tags($_GET['source']);
}
if (isset($_GET['target']) && $_GET['target'] != ""){
    $target = strip_tags($_GET['target']);
}
if (isset($_GET['download'])){
    //Download the given file after the operation finished
    $download = $_GET['download'];
    //Check if the download target is inside AOR. If not, add handling script in front of the filepath
    //if (strpos(realpath($download),realpath("../../../")) !== 0){
	if (strpos(realpath($download),"/media/") === 0){
        //This file might be in external storage. Try to give it extDiskAccess
        $download = "../extDiskAccess.php?file=" . $download;
    }
}else{
    $download = "false";
}

//var_dump([realpath($download),realpath("../../../")]);
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<link rel="manifest" href="manifest.json">
<html style="min-height:300px;">
    <head>
        <meta charset="UTF-8">
        <script type='text/javascript' charset='utf-8'>
            // Hides mobile browser's address bar when page is done loading.
            window.addEventListener('load', function(e) {
                setTimeout(function() { window.scrollTo(0, 1); }, 1);
            }, false);
        </script>
        <link href="../../../script/tocas/tocas.css" rel='stylesheet'>
        <script src="../../../script/jquery.min.js"></script>
        <script src="../../../script/ao_module.js"></script>
        <title>File Progress Listener</title>
        <style>
            body{
                background-color:#fcfcfc;
            }
            #topBar{
                background-color:#404040;
                width:100%;
                height:50px;
                top:0px;
            }
            .oprIcon{
                position:fixed;
                top:0px;
                right:0px;
                width:100px;
                height:100px;
            }
            .largerText{
                color:white;
                font-size:130%;
            }
            .topBarTitle{
                padding:15px;
                font-weight: 80% !important;
            }
            #main{
                padding-left: 20px;
                padding-right:10px;
                padding-top:5px;
            }
            .progressBar{
                margin-top: 8px !important;
            }
			.copyInfo{

			}
			.mainListItem{
				
			}
        </style>
    </head>
    <body>
        <div id="topBar">
            <div id="topBarTitle" class="topBarTitle largerText">Copying N/A Files</div>
        </div>
        <div id="main">
            <div class="mainListItem">From: <span id="source" class="copyInfo">No Data</span> </div>
            <div class="mainListItem">To:  <span id="target" class="copyInfo">No Data</span> </div>
            <div class="mainListItem">Remining Items:  <span id="remain" class="copyInfo">No Data</span> </div>
            <div class="mainListItem">Progress:  <span id="progress" class="copyInfo">No Data</span> </div>
            <div id="pbar" class="ts small preparing positive progress progressBar">
                <div id="pbarStatus" class="bar"></div>
            </div>
        </div>
        <img class="oprIcon" src="icon/file_opr/<?php 
                echo $mode . ".gif";
            ?>">
        <div style="display:none">
                <div id="data_mode"><?php echo $mode;?></div>
                <div id="data_listeningIDs"><?php echo $listeningIDs;?></div>
                <div id="data_source"><?php echo $source; ?></div>
                <div id="data_target"><?php echo $target; ?></div>
                <div id="data_download"><?php echo $download; ?></div>
        </div>
        <script>
            var oprMode = $("#data_mode").text().trim();
            var listeningIDs = JSON.parse($("#data_listeningIDs").text().trim());
            var totalIDs = Array.from(listeningIDs);
            var source = $("#data_source").text().trim();
            var target = $("#data_target").text().trim();
            var fileListener = setInterval(listenFileProgressChange,1500);
            var downloadAfterComplete = $("#data_download").text().trim() != "false";
            var downloadTarget = "";
            if (downloadAfterComplete){
                downloadTarget =  $("#data_download").text().trim();
            }
            //Initiate The title of the file operation
            initTopBarTitle();
            initSourceAndTarget();
            if (ao_module_virtualDesktop){
                $("body").css("overflow-y","hidden");
            }
            updateProgress();
            listenFileProgressChange();
           

            function listenFileProgressChange(){
                $.ajax("fsexec.php?listen=" + JSON.stringify(listeningIDs)).done(function(data){
                    for(var i =0; i < data.length; i++){
                        if (data[i][1] == "done"){
                            //This id has been finished. Remove it from the listening IDs
                            removeIDFromListeningIDs(data[i][0])
                        }else if (data[i][1] == "error"){
                            //This id has error. Show copy error.
                            clearInterval(fileListener);
                            $("#pbar").removeClass("active").removeClass("preparing").removeClass("positive").addClass("negative");
                            $("#pbarStatus").css('width',"100%");
                            //Show error title message
                            if (oprMode == "copy"){
                                $("#topBarTitle").text("Unable to copy file(s)");
                            }else{
                                $("#topBarTitle").text("Unable to move file(s)");
                            }
                            $("#progress").text("See log/error/" + data[i][0] + ".log for more information.");
                            $(".oprIcon").attr("src","icon/file_opr/error.png");
                            return;
                        }else if (data[i][1] == "null"){
                            //This copy record is not found. Something odd happened, assume finished.
                            removeIDFromListeningIDs(data[i][0])
                        }
                    }
                    updateProgress();
                });
            }

            function removeIDFromListeningIDs(id){
                for (var i = 0; i < listeningIDs.length; i++){
                    if (listeningIDs[i] == id){
                        listeningIDs.splice(i,1)
                    }
                }
            }

            function updateProgress(){
                $("#remain").text(listeningIDs.length);
                var remainsPercentage = calculateProgress();
                if (remainsPercentage == 1 && listeningIDs.length == 1){
                    //Only one item is copied.
                    $("#progress").text("Will be finishing in a moment...");
                }else if (remainsPercentage == 1 && listeningIDs.length > 1){
                    $("#pbarStatus").css('width',"5%");
                    $("#pbar").addClass("active").removeClass("preparing");
                    $("#progress").text("Preparing files for file operations...");
                }else{
                    //Display the current completed progress
                    $("#progress").text(parseInt((1-remainsPercentage) * 100) + " %");
                    $("#pbar").addClass("active").removeClass("preparing");
                    $("#pbarStatus").css('width',(1-remainsPercentage) * 100 + "%");
                }

                if (remainsPercentage == 0){
                    //This job has been finished.
                    clearInterval(fileListener);
                    if (oprMode == "copy"){
                        $("#topBarTitle").text(totalIDs.length + " Items Copied");
                    }else if (oprMode == "zip"){
                        $("#topBarTitle").text(totalIDs.length + " Items Zipped");
                    }else{
                        $("#topBarTitle").text(totalIDs.length + " Items Moved");
                    }
                    $(".oprIcon").attr("src","icon/file_opr/done.png");
                    if (ao_module_virtualDesktop && !downloadAfterComplete){
                        setTimeout(ao_module_close,1000);
                    }else if (downloadAfterComplete){
                        //Download the file after the file operation complete.
                        var url = downloadTarget;
                        var filename = url.split('/').pop();
                        filename = ao_module_codec.decodeUmFilename(filename);
                       
                       
                        //Check if the generated file is larger than 2GB or not. If larger, use redirect instead of blob
                        $.get("filesize.php?file=" + url + "&raw",function(size){
                            
                            if (size > 16000000000){ //Larger than 2GB
                                $("#topBarTitle").text("File Ready!");
                                $(".oprIcon").attr("src","icon/file_opr/done.png");
                                $("#progress").text("Redirercting to download location.");
                                window.location.href = url;
                            }else{
                                 //Update the interface to download mode
                                $("#topBarTitle").text("Downloading File");
                                $("#progress").text("Buffering downloaded chunks into blob.");
                                $("#pbar").removeClass("positive").addClass("primary");
                                $("#pbarStatus").css('width',"0%");
                                $(".oprIcon").attr("src","icon/file_opr/download.png");
                                //Download the given file with blob
                                blobDownloadElement(url,filename);
                            }
                        }); 
                    }
                }
            }

            function blobDownloadElement(filepath,filename){
                $("#pbarStatus").css("width","0%");
                var xhr = new XMLHttpRequest();
                xhr.onreadystatechange = function(){
                    if (this.readyState == 4 && this.status == 200){
                        var url = window.URL || window.webkitURL;
                        generateDownloadElement(url.createObjectURL(this.response),filename);
                        $("#topBarTitle").text("File Downloaded");
                        $(".oprIcon").attr("src","icon/file_opr/done.png");
                        $("#progress").text("Ready to move from Memory to Disk.");
                        setTimeout(ao_module_close,5000);
                    }
                }
                xhr.onprogress = function (event) {
                    $("#pbarStatus").css("width",(event.loaded / event.total) * 100 + "%");
                };
                xhr.open('GET', filepath);
                xhr.responseType = 'blob';
                xhr.send();
            }

            function generateDownloadElement(filepath, filename){
                var link = document.createElement('a');
                link.href = filepath;
                link.setAttribute('download', filename);
                document.getElementsByTagName("body")[0].appendChild(link);
                // Firefox
                if (document.createEvent) {
                    var event = document.createEvent("MouseEvents");
                    event.initEvent("click", true, true);
                    link.dispatchEvent(event);
                }
                // IE
                else if (link.click) {
                    link.click();
                }
                link.parentNode.removeChild(link);
            }

            function calculateProgress(){
                var remainingProgress = listeningIDs.length / totalIDs.length;
                return remainingProgress;
            }

            function initSourceAndTarget(){
				var maxStringLength = 50;
                if (target.substring(-1) != "/"){
                    target += "/";
                }
                if (source.substring(-1) != "/"){
                    source += "/";
                }
                target = target.replace("../../../","AOR://")
                target = target.split("./").join("");
                source = source.replace("../../../","AOR://")
                source = source.split("./").join("");
				
				//Convert any hex foldername inside the source and target into human readable text
				target = decodeHexFolderPath(target);
				source = decodeHexFolderPath(source);
				
				if (target.length > maxStringLength){
					target = "..." + target.substring(target.length - maxStringLength,maxStringLength);
				}
				
				if (source.length > maxStringLength){
					source = "..." + source.substring(source.length - maxStringLength,maxStringLength);
				}
				
                $("#source").text(source);
                $("#target").text(target);
            }
			
			function decodeHexFolderPath(folderpath){
				var tmp = folderpath.split("/");
				var result = [];
				for(var i=0; i < tmp.length; i++){
					if (tmp[i] == ""){
						result.push("");
					}else{
						result.push(ao_module_codec.decodeHexFoldername(tmp[i]));
					}
					
				}
				return result.join("/");
			}
            
            function initTopBarTitle(){
                var text = "";
                if (oprMode == "copy"){
                    text = "Copying ";
                }else if (oprMode == "zip"){
                    text = "Zipping ";
                }else if (oprMode == "unzip"){
                    text = "Unzipping "
                }else{
                    text = "Moving "; 
                }
                text += listeningIDs.length;
                if (listeningIDs.length > 1){
                    text += " items";
                }else{
                    text += " item";
                }
                $("#topBarTitle").text(text);
            }
            
        </script>
    </body>
</html>
