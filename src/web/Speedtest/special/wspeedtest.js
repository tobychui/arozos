if (!requirelib("appdata")) {
    console.log("appdata import failed");
}
/*
    WebSocket Test Script

    This is a special test script and should not be mixed in with normal
    AGI module test scripts. Please test this seperately

    Author: tobychui
*/

function setup() {
    //Require the WebSocket Library
    var succ = requirelib("websocket");
    if (!succ) {
        console.log("WebSocket Open Failed");
        return false
    }

    //Upgrade the current connection to WebSocket, set timeout to 30 seconds
    //Timeout value: if after 30 seconds nothing has been send / received, the websocket will be closed
    //set this value to 0 to display auto socket closing
    succ = websocket.upgrade(30);
    if (!succ) {
        console.log("WebSocket Upgrade Failed");
        return false
    }

    //console.log("WebSocket Opened!")
    return true;
}

function closing() {
    //Try to close the WebSocket connection
    websocket.close();
}

//Start executing the script
if (setup()) {
    websocket.send("DWL/UPL?");
    var recv = "";
    while (true) {
        //Read the websocket input from Client (Web UI)
        recv = websocket.read();
        if (recv == null) {
            console.log("Read Failed!")
            break;
        }
        if (recv == "DWL") {
            downloadTest();
            break;
        } else if (recv == "UPL") {
            uploadTest();
            break;
        } else if (recv == "PING") {
            pingTest();
            break;
        }
    }
    closing();
} else {
    console.log("WebSocket Setup Failed.")
}

function downloadTest() {
    var CurrentPow = 0;
    var CurrentDif = 0;
	randomStr = "";
	fileRandomStr = appdata.readFile("Speedtest/special/random64KB.txt");
	for(var i = 0; i < 16; i++){
		randomStr += fileRandomStr;
	}
    var filesize = "DATA:".length + randomStr.length;

    while (CurrentDif < 5) {
        var CurrentMB = Math.pow(2, CurrentPow);
        var start = new Date();
        for (var i = 0; i < CurrentMB; i++) {
            websocket.send("DATA:" + randomStr);
        }
        var end = new Date();
        CurrentDif = (end.getTime() - start.getTime()) / 1000;
        websocket.send("TIME_DIFF=" + CurrentDif);
        CurrentPow++;
    }
    websocket.send("TTL_SIZE=" + bytesToSize(CurrentMB * filesize));
    websocket.send("TTL_TIME=" + CurrentDif + "s");
    websocket.send("TTL_BANDWIDTH=" + bytesToSpeed(CurrentMB * filesize / CurrentDif));
}

function uploadTest() {
    websocket.send("UPL");
    var recv = "";
    while (true) {
        //Read the websocket input from Client (Web UI)
        recv = websocket.read();
        if (recv == null) {
            console.log("Read Failed!")
            break;
        }
        if (recv == "stop") {
            websocket.send("Stopped.");
            break;
        }
    }
}

function pingTest() {
    websocket.send("UPL");
    var recv = "";
    for (var i = 0; i < 3; i++) {
        //Read the websocket input from Client (Web UI)
        recv = websocket.read();
        if (recv == null) {
            console.log("Read Failed!")
            break;
        } else {
            var rcvTime = new Date().getTime();
            var sendTime = new Date().getTime();
            websocket.send(rcvTime + "," + sendTime);
        }
        if (recv == "stop") {
            websocket.send("Stopped.");
            break;
        }
    }
}

//https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
function rnd(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}

//https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round((bytes / Math.pow(1024, i)) * 100, 3) / 100 + ' ' + sizes[i];
}

function bytesToSpeed(bytes) {
    bytes = bytes * 8;
    var sizes = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
    if (bytes == 0) return '0 Byte';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1000)));
    return Math.round((bytes / Math.pow(1000, i)) * 100, 3) / 100 + ' ' + sizes[i];
}