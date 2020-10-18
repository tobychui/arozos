//This script demonstrate the iteration over storage devices
console.log("Storage Device Setting List");
var html = "";
for (var i = 0; i < LOADED_STORAGES.length; i++){
	var thisStorage = LOADED_STORAGES[i];
	html = html + "Name=" + thisStorage.Name + "<br>UUID=" + thisStorage.Uuid + "<br>Path=" + thisStorage.Path + "<br><br>";
}

//Set Response header to html
HTTP_HEADER = "text/html; charset=utf-8";
//Send Response
sendResp(html);