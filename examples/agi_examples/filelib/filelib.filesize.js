console.log('Testing get filesize');
requirelib("filelib");
//Help function for converting byte to human readable format
function bytesToSize(bytes) {
   var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
   if (bytes == 0) return '0 Byte';
   var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
   return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}


//Get all the files filesize on desktop
var fileList = filelib.glob("user:/Desktop/*.*");
var results = [];
for (var i =0; i < fileList.length; i++){
	var filename = fileList[i].split("/").pop();
	var fileSize = filelib.filesize(fileList[i]);
	results.push({
		filename: filename,
		filesize: bytesToSize(fileSize)
	});
	
}
sendJSONResp(JSON.stringify(results));