/*
    ReadyDir.js

    This script prepare the required folder structure for the camera app
*/

requirelib("filelib");
filelib.mkdir(savetarget);

//Return ok
sendResp("OK");