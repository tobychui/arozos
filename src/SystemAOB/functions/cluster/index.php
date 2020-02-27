<?php
include_once("../../../auth.php");
?>
<html>
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
<script src="../../../script/jquery.min.js"></script>
<title>ArOZ Cluster</title>
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
</head>
<body>
	<?php
	function remove_utf8_bom($text)
	{
		$bom = pack('H*','EFBBBF');
		$text = preg_replace("/^$bom/", '', $text);
		return $text;
	}

	$ips = [];
	if (file_exists("clusterList.config") == true){
		$content = file_get_contents("clusterList.config");
		$content = remove_utf8_bom($content);
		$content = explode(PHP_EOL,trim($content));
		$ips = $content;
	}
	
	if (!file_exists("clusterSetting.config")){
	    file_put_contents("clusterSetting.config","");
	}
	?>
	<br><br>
	<div class="ts container">
		<div class="ts segment">
			<div class="ts header">
				<i class="server icon"></i>ArOZ Clusters List
				<div class="sub header">List of nearby ArOZ Online Systems</div>
			</div>
		</div>
		<table class="ts table">
			<thead>
				<tr>
					<th>IPs</th>
					<th>UUID</th>
					<th>Node Type</th>
					<th>Status</th>
					<th>Storage >> (Free Space)</th>
					<th>AO version</th>
				</tr>
			</thead>
			<tbody id="clusterList">

			</tbody>
			<tfoot>
				<tr>
					<th colspan="6" id="clusterCount">N/A</th>
				</tr>
			</tfoot>
		</table>
	</div>
	<div style="display:none;">
		<div id="DATA_iplist"><?php echo json_encode($ips);?></div>
		<div id="DATA_scanconfig"><?php echo file_get_contents("clusterSetting.config");?></div>
	</div>
	<script>
		var template = '<tr>\
					<td>{ip}</td>\
					<td>{uuid}</td>\
					<td>{nodetype}</td>\
					<td>{status}</td>\
					<td>{storage}</td>\
					<td>{aover}</td>\
				</tr>';
		var clusterConfig = JSON.parse($("#DATA_scanconfig").text().trim());
		var prefix = clusterConfig["prefix"];
		var port = clusterConfig["port"];
		var ipList = JSON.parse($("#DATA_iplist").text().trim());
		var online = 0;
		var checkOnlineRetryTime = 3;
		
		$(document).ready(function(){
			initTable();
		});
		
		function initTable(){
			for (var i =0; i < ipList.length;i++){
				let thisip = ipList[i];
				$.ajax({
					url: "getInfo.php?ipaddr=" + thisip,
					success: function(data){
						//data returned should be the uuid that the client want to listen to get the information of cluster.
						var uuid = data;
						checkIfClusterOnline(thisip,uuid,0);
						//console.log(data);
						//online++;
						//$("#clusterCount").html("Available Clusters: " + online + " / " + ipList.length);
						//appendToList(thisip,data);
					},
					error: function(data){
						console.log("[Cluster] ERROR. Unable to establish connection with cluster services.");
						//appendOfflineNode(thisip);
					},
					timeout: 3000 //in milliseconds
				});
				
				//Deprecated synchronized method for getting information
				/*$.ajax({
                   url: "requestInfo.php?ip=" + thisip + ":" + port + "/" + prefix,
                   success: function(data){
                        //console.log(data);
						online++;
						$("#clusterCount").html("Available Clusters: " + online + " / " + ipList.length);
                        appendToList(thisip,data);
                   },
                   error: function(data){
                        console.log("[Cluster] ERROR. Node " + thisip + " not found. Maybe it is offline?");
                        appendOfflineNode(thisip);
                   },
                   timeout: 3000 //in milliseconds
                });
				*/
                /*
				$.get("requestInfo.php?ip=" + thisip + "/" + prefix,function(data){
				    appendToList(thisip,data);
				});
				*/
			}
			$("#clusterCount").html("Available Clusters:" + online + " / " + ipList.length);
		}
		
		function checkIfClusterOnline(thisip,uuid,count){
			$.ajax({
					url: "getInfo.php?listen=" + uuid,
					success: function(data){
						if (data == "false" && count < checkOnlineRetryTime){
							//The information is not online yet. Try again.
							setTimeout(function(){
								//Recursive function call for checking if this node online after 500ms
								checkIfClusterOnline(thisip,uuid,count + 1);
							},500);
						}else if (data == "false" && count >= checkOnlineRetryTime){
							//Terminate the search and declare offline
							appendOfflineNode(thisip);
						}else{
							//This host online and append it to list
							online++;
							$("#clusterCount").html("Available Clusters: " + online + " / " + ipList.length);
							appendToList(thisip,data);
						}
					},
					error: function(data){
						console.log("[Cluster] ERROR. Unable to establish connection with cluster services.");
						//appendOfflineNode(thisip);
					},
					timeout: 3000 //in milliseconds
			});
		}
		
		
		//appendOfflineNode(thisip);
		function appendOfflineNode(ip){
			var box = template;
			box = setValue(box,"ip",ip);
			box = setValue(box,"uuid","-");
			box = setValue(box,"nodetype","-");
			box = setValue(box,"status","Offline");
			box = setValue(box,"aover","-");
			box = setValue(box,"storage","Offline");
			$("#clusterList").append(box);
		}
		
		function appendToList(ip,data){
			var hostByte = data[0];
			if(hostByte == false){
				//There is no cluster nearby
				$("#clusterCount").html("Available Clusters:" + "0 / 0");
				return;
			}
			var aover = data[1];
			var storage = data[2];
			var box = template;
			box = setValue(box,"ip",ip);
			if (hostByte == "N/A"){
				box = setValue(box,"uuid","unknown");
				box = setValue(box,"nodetype","unknown");
				box = setValue(box,"status","unknown");
			}else{
				hostByte = hostByte.split(",");
				box = setValue(box,"uuid",hostByte[2]);
				box = setValue(box,"nodetype",hostByte[0]);
				box = setValue(box,"status",hostByte[1]);
				generateMapperRecord(ip,hostByte[2]);
			}
			if (aover == "N/A"){
				box = setValue(box,"aover","Generic");
			}else{
				box = setValue(box,"aover",aover);
			}
			if (storage == "N/A"){
				box = setValue(box,"storage","Permission Denied");
			}else{
				var storageInfo = JSON.parse(storage);
				var tmphtml = "";
				//console.log(storageInfo);
				for (var k =0; k < storageInfo.length; k++){
					var path = storageInfo[k][0];
					var name = storageInfo[k][1];
					var space = storageInfo[k][2];
					tmphtml = tmphtml + "<i class='disk outline icon'></i>" + path + "(" + name + ") <i class='angle double right icon'></i>" + space + "<br>";
				}
				box = setValue(box,"storage",tmphtml);
			}
			$("#clusterList").append(box);
		}
		function setValue(text, tag, value){
			return text.replace("{" + tag + "}",value);
		}
		
		function generateMapperRecord(ip,uuid){
		    $.get("clusterMapper.php?IPAddr=" + ip + "&MapperID=" + uuid,function(data){
		        if (data.includes("ERROR")){
		            alert("Something went wrong. " + data)
		        }
		    });
		}
		
	</script>
</body>
</html>
