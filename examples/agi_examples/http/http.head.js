/*
    http.head Request the header information about the respond
*/

requirelib("http")

//Get the respond header of the localhost
var respHeader = JSON.parse(http.head("http://localhost:8080/"));
var respHeaderContentType = JSON.parse(http.head("http://localhost:8080/", "Content-Type"));
//Relay the JSON to client
sendJSONResp(JSON.stringify({
    "full-header": respHeader,
    "Content-Type": respHeaderContentType,
}));