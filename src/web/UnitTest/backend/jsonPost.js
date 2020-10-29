//For those shitty persons who use appplication/json instead of x-www-encoded
//POST_data is constant and won't change
sendJSONResp(JSON.stringify(POST_data));
/*
$.ajax({
    type: 'POST',
    url: '/form/',
    data: '{"name":"jonas"}', // or JSON.stringify ({name: 'jonas'}),
    success: function(data) { alert('data: ' + data); },
    contentType: "application/json",
    dataType: 'json'
});
*/