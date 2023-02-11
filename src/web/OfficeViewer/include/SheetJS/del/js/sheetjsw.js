importScripts('xlsx.full.min.js');
postMessage({t:'ready'});
onmessage = function(evt) {
  var v;
  try { v = XLSX.read(evt.data.d, evt.data.b); }
  catch(e) { postMessage({t:"e",d:e.stack}); }
  postMessage({t:evt.data.t, d:JSON.stringify(v)});
}
