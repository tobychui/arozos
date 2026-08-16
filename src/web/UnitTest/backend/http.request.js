/*
    http.request Curl-like request with full control over method, headers and body.

    options: {url, method, headers, body, json, form, bodyBase64, contentType,
              username, password, timeout, followRedirect, responseType}
    returns: {ok, status, statusText, headers, body, error}
*/

requirelib("http")

//POST a JSON body with a custom header and read back the full response object
var resp = http.request({
    url: "http://localhost:8080/system/file_system/listDir",
    method: "POST",
    headers: {
        "X-Requested-With": "arozos-unittest"
    },
    json: {
        dir: "user:/Desktop",
        sort: "default"
    },
    timeout: 30
});

//Convenience helpers built on http.request
//  http.postForm(url, formObject, headers) => url-encoded form body
//  http.postJSON(url, object, headers)     => JSON body
//  http.put / http.patch / http.delete     => method helpers
var formResp = http.postForm("http://localhost:8080/system/file_system/listDir", {
    dir: "user:/Desktop",
    sort: "default"
});

//Relay the result of both calls to the client
sendJSONResp(JSON.stringify({
    "request-ok": resp.ok,
    "request-status": resp.status,
    "request-statusText": resp.statusText,
    "request-body": resp.body,
    "request-error": resp.error,
    "postForm-status": formResp.status,
    "postForm-body": formResp.body
}));
