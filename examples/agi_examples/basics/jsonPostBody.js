//For those who use appplication/json instead of x-www-encoded
//POST_data is the default variable that pass the body content into the VM
sendJSONResp(JSON.stringify(POST_data));

/*
	//Front-end side
	$.ajax({
		type: 'POST',
		url: '/form/',
		data: '{"name":"jonas"}', // or JSON.stringify ({name: 'jonas'}),
		success: function(data) { alert('data: ' + data); },
		contentType: "application/json",
		dataType: 'json'
	});
	
	//In the VM, "POST_data" variable will be set to the stringify content of '{"name":"jonas"}'
*/