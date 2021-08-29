console.log("Get argument test");
sendJSONResp(JSON.stringify([foo,bar]));
/*
//The following paramters can be passed in using POST paramters as follow
function testRunScript(){
	var script = "Dummy/backend/getParamters.js";
	$.ajax({
		url: "../system/ajgi/interface?script=" + script,
		data: {foo: "Hello", bar: "World"},
		method: "POST",
		success: function(data){
			console.log(data);
		}
	})
}
*/