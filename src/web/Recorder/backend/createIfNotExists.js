/*
    Recorder WebApp

    Create save target folder if it doesn't exists
    Require: savedir
*/

requirelib("filelib")
if (!filelib.fileExists(savedir)){
    filelib.mkdir(savedir);
}

sendResp("OK");

