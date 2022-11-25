/*
    getTitle.js
    Get the title of the page
*/  

requirelib("http");
var pageContent = http.get(url);
var matches = pageContent.match(/<title>(.*?)<\/title>/);
if (matches == null || matches.length == 0){
    sendResp("");
}else{
    sendResp(matches[0].replace(/(<([^>]+)>)/gi, ""));
}
