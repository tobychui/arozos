/*
    WebSocket Test Script

    This is a special test script and should not be mixed in with normal
    AGI module test scripts. Please test this seperately

    Author: tobychui
*/

function setup(){
    //Require the WebSocket Library
    var succ = requirelib("websocket");
    if (!succ){
        console.log("WebSocket Open Failed");
        return false
    }

    //Upgrade the current connection to WebSocket, set timeout to 30 seconds
    //Timeout value: if after 30 seconds nothing has been send / received, the websocket will be closed
    //set this value to 0 to display auto socket closing
    succ = websocket.upgrade(30);
    if (!succ){
        console.log("WebSocket Upgrade Failed");
        return false
    }

    console.log("WebSocket Opened!")
    return true;
}

function waitForStart(){
    websocket.send("Send 'start' to start websocket.send test");
    var recv = "";
    for (var i = 0; i < 10; i++){
        //Read the websocket input from Client (Web UI)
        recv = websocket.read();
        if (recv == null){
            console.log("Read Failed!")
            return
        }
        if (recv != "start"){
            websocket.send(recv + " reveived. Type 'start' to start testing. (Retry count: " + i + "/10)");
        }else{
            websocket.send("'start' command received. Starting test");
            break;
        }
    }
}

function loop(i){
    //If the process reach here, that means the WebSocket connection has been opened
    console.log("Sending: Hello World: " + i);

    //Sebd Hello World {i} to Client (Web UI)
    websocket.send("Hello World: " + i);

    //Wait for 1 second before next send
    delay(1000);
}

function closing(){
    //Try to close the WebSocket connection
    websocket.close();
}

//Start executing the script
if (setup()){
    waitForStart();
    for (var i = 0; i < 10; i++){
        loop(i);
    }
    closing();
}else{
    console.log("WebSocket Setup Failed.")
}

