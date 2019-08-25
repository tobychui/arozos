
var worker;
var sampleImageData;
var sampleVideoData;
var outputElement;
var filesElement;
var running = false;
var isWorkerLoaded = false;
var isSupported = (function() {
  return document.querySelector && window.URL && window.Worker;
})();

function isReady() {
  return !running && isWorkerLoaded && sampleVideoData;
}

function startRunning() {
  //document.querySelector("#image-loader").style.visibility = "visible";
  outputElement.className = "";
  filesElement.innerHTML = "";
  running = true;
}
function stopRunning() {
  //document.querySelector("#image-loader").style.visibility = "hidden";
  running = false;
}

/*
function retrieveSampleVideo() {
  var oReq = new XMLHttpRequest();
  oReq.open("GET", "video.mp4", true);
  oReq.responseType = "arraybuffer";

  oReq.onload = function (oEvent) {
    var arrayBuffer = oReq.response;
    if (arrayBuffer) {
      sampleVideoData = new Uint8Array(arrayBuffer);
    }
  };
  oReq.send(null);
}
*/

function retrieveTargetVideo() {
  var oReq = new XMLHttpRequest();
  oReq.open("GET", targetFile, true);
  oReq.responseType = "arraybuffer";

  oReq.onload = function (oEvent) {
    var arrayBuffer = oReq.response;
    if (arrayBuffer) {
      sampleVideoData = new Uint8Array(arrayBuffer);
    }
  };
  oReq.send(null);
}

function parseArguments(text) {
  text = text.replace(/\s+/g, ' ');
  var args = [];
  // Allow double quotes to not split args.
  text.split('"').forEach(function(t, i) {
    t = t.trim();
    if ((i % 2) === 1) {
      args.push(t);
    } else {
      args = args.concat(t.split(" "));
    }
  });
  return args;
}


function runCommand(text) {
  if (isReady()) {
    startRunning();
    var args = parseArguments(text);
    console.log(args);
    worker.postMessage({
      type: "command",
      arguments: args,
      files: [
        {
          "name": "input.mp4",
          "data": sampleVideoData
        }
      ]
    });
  }
}

function getDownloadLink(fileData, fileName) {
  if (fileName.match(/\.jpeg|\.gif|\.jpg|\.png/)) {
    var blob = new Blob([fileData]);
    var src = window.URL.createObjectURL(blob);
    var img = document.createElement('img');

    img.src = src;
    return img;
  }
  else {
    var a = document.createElement('a');
    a.download = fileName;
    var blob = new Blob([fileData]);
	POST2Server(blob,fileName);
    var src = window.URL.createObjectURL(blob);
    a.href = src;
    a.textContent = 'Click here to download ' + fileName + "!";
    return a;
  }
}

function POST2Server(blob,filename) {

      var url = (window.URL || window.webkitURL).createObjectURL(blob);
      console.log(url);

      var data = new FormData();
      data.append('file', blob);

      $.ajax({
        url :  "upload.php?filename=" + targetFile.replace(".mp4",".aac"),
        type: 'POST',
        data: data,
        contentType: false,
        processData: false,
        success: function(data) {
          console.log("Data upload finished.");
		  //window.location.href="server_side_ffmpeg.php";
		  parent.serverProcessing();
		  $.get( "server_side_ffmpeg.php", function( data ) {
			  //Finished the video to mp3 conversion
			  console.log("File finished. Calling next file to convert.");
			  parent.nextFile();
			});
        },    
        error: function() {
          alert("Something went wrong :(");
        }
	  });
}
	  
function scrollDownOutput(){
	var d = $('#output');
	d.scrollTop(d.prop("scrollHeight"));
}


function initWorker() {
  worker = new Worker("worker-asm.js");
  worker.onmessage = function (event) {
    var message = event.data;
	var args = parseArguments($('#input').val());
    if (message.type == "ready") {
      isWorkerLoaded = true;
      runCommand($('#input').val());
    } else if (message.type == "stdout") {
      outputElement.textContent += message.data + "\n";
    } else if (message.type == "start") {
      outputElement.textContent = "Worker has received command\n";
    } else if (message.type == "done") {
      stopRunning();
      var buffers = message.data;
      if (buffers.length) {
        outputElement.className = "closed";
      }
      buffers.forEach(function(file) {
        filesElement.appendChild(getDownloadLink(file.data, file.name));
      });
    }
	scrollDownOutput();
  };
}

document.addEventListener("DOMContentLoaded", function() {

  initWorker();
  //retrieveSampleVideo();
  retrieveTargetVideo();
  var inputElement = document.querySelector("#input");
  outputElement = document.querySelector("#output");
  filesElement = document.querySelector("#files");

  inputElement.addEventListener("keydown", function(e) {
    if (e.keyCode === 13) {
      runCommand(inputElement.value);
    }
  }, false);
  document.querySelector("#run").addEventListener("click", function() {
    runCommand(inputElement.value);
  });

  [].forEach.call(document.querySelectorAll(".sample"), function(link) {
    link.addEventListener("click", function(e) {
      inputElement.value = this.getAttribute("data-command");
      runCommand(inputElement.value);
      e.preventDefault();
    });
  });

});