function rememberDevice(uuid,classname){
	var para = uuid + "_" + classname;
	var xhr = new XMLHttpRequest();
	xhr.open("GET", "../recordType.php?type=" + para);
	xhr.onreadystatechange = function() {
		if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 200) {         
			console.log(xhr.response);
		}
	}
	xhr.send();
}