<?php
include_once("../../auth.php");
if (isset($_POST['saveImage']) && isset($_POST['savePath']) && isset($_POST['filename'])){
     $encodedData = $_POST['saveImage'];
     $saveFilepath = "../../" . $_POST['savePath'];
     $filename = $_POST['filename'];
     $img = str_replace('data:image/png;base64,', '', $encodedData);
     $img = str_replace(' ', '+', $img);
     $fileData = base64_decode($img);
     if (strpos(realpath($saveFilepath),realpath($rootPath)) === 0 || strpos(realpath($saveFilepath),"/media") === 0){
         //This file is located in localStorage or media
         file_put_contents($saveFilepath .$filename, $fileData);
         echo "DONE";
     }else{
         die("ERROR. Filepath not in AOR nor external storage path.");
     }
     exit(0);
}
?>
<html>
    <head>
        <title>ArOZ Paint</title>
        <link rel="stylesheet" href="../../script/tocas/tocas.css">
        <script src="../../script/jquery.min.js"></script>
        <script src="../../script/ao_module.js"></script>
        <style>
            * {
              box-sizing: border-box;
            }
            
            main {
              width: 800px;
              border: 1px solid #e0e0e0;
              margin: 0 auto;
              display: flex;
              flex-grow: 1;
            }
            
            .left-block {
              width: 160px;
              border-right: 1px solid #e0e0e0;
            }
            
            .colors {
              background-color: #ece8e8;
              text-align: center;
              padding-bottom: 5px;
              padding-top: 10px;
            }
            
            .colors button {
              display: inline-block;
              border: 1px solid #00000026;
              border-radius: 0;
              outline: none;
              cursor: pointer;
              width: 20px;
              height: 20px;
              margin-bottom: 5px
            }
            
            .colors button:nth-of-type(1) {
              background-color: #0000ff;
            }
            
            .colors button:nth-of-type(2) {
              background-color: #009fff;
            }
            
            .colors button:nth-of-type(3) {
              background-color: #0fffff;
            }
            
            .colors button:nth-of-type(4) {
              background-color: #bfffff;
            }
            
            .colors button:nth-of-type(5) {
              background-color: #000000;
            }
            
            .colors button:nth-of-type(6) {
              background-color: #333333;
            }
            
            .colors button:nth-of-type(7) {
              background-color: #666666;
            }
            
            .colors button:nth-of-type(8) {
              background-color: #999999;
            }
            
            .colors button:nth-of-type(9) {
              background-color: #ffcc66;
            }
            
            .colors button:nth-of-type(10) {
              background-color: #ffcc00;
            }
            
            .colors button:nth-of-type(11) {
              background-color: #ffff00;
            }
            
            .colors button:nth-of-type(12) {
              background-color: #ffff99;
            }
            
            .colors button:nth-of-type(13) {
              background-color: #003300;
            }
            
            .colors button:nth-of-type(14) {
              background-color: #555000;
            }
            
            .colors button:nth-of-type(15) {
              background-color: #00ff00;
            }
            
            .colors button:nth-of-type(16) {
              background-color: #99ff99;
            }
            
            .colors button:nth-of-type(17) {
              background-color: #f00000;
            }
            
            .colors button:nth-of-type(18) {
              background-color: #ff6600;
            }
            
            .colors button:nth-of-type(19) {
              background-color: #ff9933;
            }
            
            .colors button:nth-of-type(20) {
              background-color: #f5deb3;
            }
            
            .colors button:nth-of-type(21) {
              background-color: #330000;
            }
            
            .colors button:nth-of-type(22) {
              background-color: #663300;
            }
            
            .colors button:nth-of-type(23) {
              background-color: #cc6600;
            }
            
            .colors button:nth-of-type(24) {
              background-color: #deb887;
            }
            
            .colors button:nth-of-type(25) {
              background-color: #aa0fff;
            }
            
            .colors button:nth-of-type(26) {
              background-color: #cc66cc;
            }
            
            .colors button:nth-of-type(27) {
              background-color: #ff66ff;
            }
            
            .colors button:nth-of-type(28) {
              background-color: #ff99ff;
            }
            
            .colors button:nth-of-type(29) {
              background-color: #e8c4e8;
            }
            
            .colors button:nth-of-type(30) {
              background-color: #ffffff;
            }
            
            .brushes {
              //background-color: purple;
              padding-top: 5px
            }
            
            .brushes button {
              display: block;
              width: 100%;
              border: 0;
              border-radius: 0;
              background-color: #ece8e8;
              margin-bottom: 5px;
              padding: 5px;
              height: 30px;
              outline: none;
              position: relative;
              cursor: pointer;
            }
            
            .brushes button:after {
              height: 1px;
              display: block;
              background: #808080;
              content: '';
            }
            
            .brushes button:nth-of-type(1):after {
              height: 1px;
            }
            
            .brushes button:nth-of-type(2):after {
              height: 2px;
            }
            
            .brushes button:nth-of-type(3):after {
              height: 3px;
            }
            
            .brushes button:nth-of-type(4):after {
              height: 4px;
            }
            
            .brushes button:nth-of-type(5):after {
              height: 5px;
            }
            
            .buttons {
              height: 80px;
              padding-top: 10px;
            }
            
            .buttons button {
              display: block;
              width: 100%;
              border: 0;
              border-radius: 0;
              background-color: #ece8e8;
              margin-bottom: 5px;
              padding: 5px;
              height: 30px;
              outline: none;
              position: relative;
              cursor: pointer;
              font-size: 16px;
            }
            
            .right-block {
              width: 640px;
            }
            
            #paint-canvas {
              cursor:crosshair;
            }

        </style>
    </head>
    <body>
            <main>
              <div class="left-block">
                <div class="colors">
                  <button type="button" value="#0000ff"></button>
                  <button type="button" value="#009fff"></button>
                  <button type="button" value="#0fffff"></button>
                  <button type="button" value="#bfffff"></button>
                  <button type="button" value="#000000"></button>
                  <button type="button" value="#333333"></button>
                  <button type="button" value="#666666"></button>
                  <button type="button" value="#999999"></button>
                  <button type="button" value="#ffcc66"></button>
                  <button type="button" value="#ffcc00"></button>
                  <button type="button" value="#ffff00"></button>
                  <button type="button" value="#ffff99"></button>
                  <button type="button" value="#003300"></button>
                  <button type="button" value="#555000"></button>
                  <button type="button" value="#00ff00"></button>
                  <button type="button" value="#99ff99"></button>
                  <button type="button" value="#f00000"></button>
                  <button type="button" value="#ff6600"></button>
                  <button type="button" value="#ff9933"></button>
                  <button type="button" value="#f5deb3"></button>
                  <button type="button" value="#330000"></button>
                  <button type="button" value="#663300"></button>
                  <button type="button" value="#cc6600"></button>
                  <button type="button" value="#deb887"></button>
                  <button type="button" value="#aa0fff"></button>
                  <button type="button" value="#cc66cc"></button>
                  <button type="button" value="#ff66ff"></button>
                  <button type="button" value="#ff99ff"></button>
                  <button type="button" value="#e8c4e8"></button>
                  <button type="button" value="#ffffff"></button>
                </div>
                <div class="brushes">
                  <button type="button" value="1"></button>
                  <button type="button" value="2"></button>
                  <button type="button" value="3"></button>
                  <button type="button" value="4"></button>
                  <button type="button" value="5"></button>
                </div>
                <div class="buttons">
                  <button id="clear" type="button">Clear</button>
                  <button id="save" type="button">Save</button>
                </div>
              </div>
              <div class="right-block">
                <canvas id="paint-canvas" width="640" height="400"></canvas>
              </div>
            </main>
            <script>
            ao_module_setWindowSize(802,422,true);
            ao_module_setFixedWindowSize();
            ao_module_setWindowTitle("AO-Paint");
            ao_module_setWindowIcon("paint brush");
            var canvas = document.getElementById("paint-canvas");
            var context = canvas.getContext("2d");
            var boundings = canvas.getBoundingClientRect();
                window.onload = function () {
                  // Definitions
                 
                
                  // Specifications
                  var mouseX = 0;
                  var mouseY = 0;
                  context.strokeStyle = 'black'; // initial brush color
                  context.lineWidth = 1; // initial brush width
                  var isDrawing = false;
                
                
                  // Handle Colors
                  var colors = document.getElementsByClassName('colors')[0];
                
                  colors.addEventListener('click', function(event) {
                    context.strokeStyle = event.target.value || 'black';
                  });
                
                  // Handle Brushes
                  var brushes = document.getElementsByClassName('brushes')[0];
                
                  brushes.addEventListener('click', function(event) {
                    context.lineWidth = event.target.value || 1;
                  });
                
                  // Mouse Down Event
                  canvas.addEventListener('mousedown', function(event) {
                    setMouseCoordinates(event);
                    isDrawing = true;
                
                    // Start Drawing
                    context.beginPath();
                    context.moveTo(mouseX, mouseY);
                  });
                
                  // Mouse Move Event
                  canvas.addEventListener('mousemove', function(event) {
                    setMouseCoordinates(event);
                
                    if(isDrawing){
                      context.lineTo(mouseX, mouseY);
                      context.stroke();
                    }
                  });
                
                  // Mouse Up Event
                  canvas.addEventListener('mouseup', function(event) {
                    setMouseCoordinates(event);
                    isDrawing = false;
                  });
                
                  // Handle Mouse Coordinates
                  function setMouseCoordinates(event) {
                    mouseX = event.clientX - boundings.left;
                    mouseY = event.clientY - boundings.top;
                  }
                
                  // Handle Clear Button
                  var clearButton = document.getElementById('clear');
                
                  clearButton.addEventListener('click', function() {
                    context.clearRect(0, 0, canvas.width, canvas.height);
                  });
                
                  // Handle Save Button
                  var saveButton = document.getElementById('save');
                
                  saveButton.addEventListener('click', function() {
                    var uid = ao_module_utils.getRandomUID();
                    if (ao_module_virtualDesktop){
                        ao_module_openFileSelector(uid,"startSaveProcess",undefined,undefined,false,"folder");
                    }else{
                        ao_module_openFileSelectorTab(uid,"../../",false,"folder",startSaveProcess);
                    }
                    
                  });
                  
                  
                };
                
                function startSaveProcess(fileData){
                    result = JSON.parse(fileData);
                	for (var i=0; i < result.length; i++){
                		var filename = result[i].filename;
                		var filepath = result[i].filepath;
                    	var imageName = prompt('Please enter image filename');
                    	if (imageName == null){
                    	    //Operation cancelled
                    	    return;
                    	}else if (imageName == ""){
                    	    imageName = "untitled.png";
                    	}
                    	if (imageName.includes(".") == false){
                    	    imageName = imageName + ".png";
                    	}
                    	var savePath = filepath + "/" + imageName;
                        var canvasDataURL = canvas.toDataURL();
                        console.log(canvasDataURL);
                        $.post("paint.php",{"saveImage":canvasDataURL, "savePath": filepath + "/", "filename":imageName}).done(function(data){
                            if(data.includes("ERROR") == false){
                                //Successfully saved.
                                ao_module_msgbox("Image file saved with path: " + savePath,"<i class='checkmark icon'></i> Paint File Saved");
                            }else{
                                alert(data);
                            }
                        });
                        //window.open(canvasDataURL);
                   }
                }

            </script>
    </body>
</html>

