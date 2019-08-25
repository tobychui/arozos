<?php
include '../../../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=0.6, maximum-scale=0.6"/>
<html>
<head>
<meta charset="UTF-8">
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
<title>ArOZ Onlineβ</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
</head>
<body style="background-color: rgb(247, 247, 247);">
<div class="ts container">
<br>
<div class="ts segment">
	<h4>ArOZ Online Network Neighbour</h4>
	This tool can only scan for php script with allow origin enabled. (Usually ArOZ Online System come with build in scannable script)<br>
	If that is not the case, please put a "hb.php" under ip_address/AOB/hb.php with allow origin *<br>
	Your LAN IP is: <p id="list">Loading</p>
</div>
	<div class="ts primary segment">
		<p id="debug"></p>
	</div>
</div>
<script>
$(document).ready(function(){
	GrapIP();
	setTimeout(function() {
		StartWebWorker();
    }, 2000);
});

var StartedRequest = 0;
var detectedUnits = 0;

function StartWebWorker(){
var ip = $("#list").html();
var webWorkers = [];
if (ip.includes("ifconfig")){
	$("#debug").append("[info] This browser is not supported.<br>");
	return;
}
if (typeof(Worker) !== "undefined") {
    $("#debug").append("[info] Web Worker Exists. IP Scanning Started.<br>");
	//The browser support everything and ready to start scanning
	var ipg = ip.split(".");
	var header = ipg[0] + "." + ipg[1] + "." + ipg[2] + "."; //a.b.c.
	GetWorkingOrNot("192.168.4.1");
	for (var i=1; i < 255;i++){
		GetWorkingOrNot(header + i);
		StartedRequest++;
	}
	
	$("#debug").append("[info] Scan done. Waiting for reply...<br>");
} else {
    $("#debug").html("[info] Error. Web Worker not supported.");
} 

}

function GetWorkingOrNot(ip){
	$.ajax({url: "http://" + ip + "/AOB/hb.php",
			type: "HEAD",
			timeout:5000,
			statusCode: {
				200: function (response) {
					$.get( "http://" + ip + "/AOB/hb.php", function(data) {
						$("#debug").append("[OK]" +ip + "<br>");
						$("#debug").append("<a href='http://" +ip + "/AOB/' target='_blank'><i class='caret right icon'></i>Click here to redirect</a><br>");
						if (data.split(",").length == 4){
							$("#debug").append('[UUID] ' + data.split(",")[2] + '<br>');
						}else{
							$("#debug").append('[Warning] Incorrectly formatted GUID. Probably an experimental build?<br>');
						}
						window.detectedUnits++;
					});
				},
				400: function (response) {
					$("#debug").append("[NOT FIND]" +ip + "<br>");
				},
				0: function (response) {
					//$("#debug").append("[DROPPED]" +ip + "<br>");
				}              
			},
			complete: function(data) {
				window.StartedRequest--;
				if (window.StartedRequest == 0){
					if (detectedUnits == 0){
					$("#debug").append("[info] No device found in this local area network.<br>       Click <a href=''>here</a> to rescan.<br>");
					}
					$("#debug").append("[info] Scan done. All Asynchronous JavaScript And XML request completed.<br>");
				}
			}
		});
}

function GrapIP(){
	// NOTE: window.RTCPeerConnection is "not a constructor" in FF22/23
	var RTCPeerConnection = /*window.RTCPeerConnection ||*/ window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

	if (RTCPeerConnection) (function () {
		var rtc = new RTCPeerConnection({iceServers:[]});
		if (1 || window.mozRTCPeerConnection) {      // FF [and now Chrome!] needs a channel/stream to proceed
			rtc.createDataChannel('', {reliable:false});
		};
		
		rtc.onicecandidate = function (evt) {
			// convert the candidate to SDP so we can run it through our general parser
			// see https://twitter.com/lancestout/status/525796175425720320 for details
			if (evt.candidate) grepSDP("a="+evt.candidate.candidate);
		};
		rtc.createOffer(function (offerDesc) {
			grepSDP(offerDesc.sdp);
			rtc.setLocalDescription(offerDesc);
		}, function (e) { console.warn("offer failed", e); });
		
		
		var addrs = Object.create(null);
		addrs["0.0.0.0"] = false;
		function updateDisplay(newAddr) {
			if (newAddr in addrs) return;
			else addrs[newAddr] = true;
			var displayAddrs = Object.keys(addrs).filter(function (k) { return addrs[k]; });
			document.getElementById('list').textContent = displayAddrs.join(" or perhaps ") || "n/a";
		}
		
		function grepSDP(sdp) {
			var hosts = [];
			sdp.split('\r\n').forEach(function (line) { // c.f. http://tools.ietf.org/html/rfc4566#page-39
				if (~line.indexOf("a=candidate")) {     // http://tools.ietf.org/html/rfc4566#section-5.13
					var parts = line.split(' '),        // http://tools.ietf.org/html/rfc5245#section-15.1
						addr = parts[4],
						type = parts[7];
					if (type === 'host') updateDisplay(addr);
				} else if (~line.indexOf("c=")) {       // http://tools.ietf.org/html/rfc4566#section-5.7
					var parts = line.split(' '),
						addr = parts[2];
					updateDisplay(addr);
					
				}
			});
		}
	})(); else {
		document.getElementById('list').innerHTML = "<code>ifconfig | grep inet | grep -v inet6 | cut -d\" \" -f2 | tail -n1</code>";
		document.getElementById('list').nextSibling.textContent = "In Chrome and Firefox your IP should display automatically, by the power of WebRTCskull.";
		
		//Callback to next function
		
	}
	
}
</script>

</body></html>