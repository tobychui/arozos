console.log("Testing Multiline Javascript");
function getVirtualPath(path){
	return decodeVirtualPath(path);
}
sendJSONResp(JSON.stringify(getVirtualPath("user:/Desktop").split("/")));
