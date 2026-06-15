/*
    Musicify - Artists Worker
    Offloads listArtists fetch + JSON parsing from the main UI thread.
*/

self.onmessage = function(evt) {
    var msg = evt && evt.data ? evt.data : {};
    if (msg.type !== 'fetchArtists') return;

    var reqId = msg.reqId;
    var endpoint = msg.endpoint;

    fetch(endpoint, {
        method: 'POST',
        cache: 'no-cache',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    }).then(function(resp) {
        if (!resp.ok) {
            throw new Error('HTTP ' + resp.status);
        }
        return resp.json();
    }).then(function(data) {
        self.postMessage({
            type: 'artistsResult',
            reqId: reqId,
            items: Array.isArray(data) ? data : []
        });
    }).catch(function(err) {
        self.postMessage({
            type: 'artistsError',
            reqId: reqId,
            error: (err && err.message) ? err.message : 'Fetch failed'
        });
    });
};
