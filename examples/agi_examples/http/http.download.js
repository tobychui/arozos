/*
    http.download Download the given file to the given path
*/

requirelib("http")

//Download the file
//Usage: URL, save directory, filename (optional)
var success = http.download("https://filesamples.com/samples/audio/mp3/Symphony%20No.6%20(1st%20movement).mp3", "user:/Desktop", "My Music.mp3")

if (success){
    sendResp("OK");
}else{
    sendJSONResp(JSON.stringify({
        error: "Download failed"
    }));
}