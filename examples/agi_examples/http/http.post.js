/*
    http.post Request the content from URL with POST method, with optional JSON string data
*/

requirelib("http")

//Get the login page information from API endpoint
var dirinfo = http.post("http://localhost:8080/system/file_system/listDir", JSON.stringify({
    dir: "user:/Desktop",
    sort: "default"
}));

sendResp(dirinfo);