/*
    getHeader.js
    Get Header of the target website and return it as JSON
*/
requirelib("http");
if (url == "" || typeof(url) == "undefined"){
    sendResp(JSON.stringify({}));
}else{
    var header = http.head(url, "x-frame-options"); 
    var code = http.getCode(url);
    var redest = "";
    if (typeof(_location) != "undefined"){
        redest = _location;
    }
    var result = JSON.stringify({
        "header": JSON.parse(header),
        "code": code,
        "location": redest,
    })
    sendResp(result);
}
