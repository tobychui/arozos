<?php
include_once("../../../../../auth.php");
$mode = "local";
if (isset($_GET['location']) && $_GET['location'] == 'remote'){
    $mode = "remote";
}

if (isset($_GET['getStatus'])){
    header('Content-Type: application/json');
    echo file_get_contents("http://" . $_GET['getStatus'] . "/status");
    die();
}else if (isset($_GET['getUUID'])){
    header('Content-Type: application/json');
    echo file_get_contents("http://" . $_GET['getStatus'] . "/uuid");
    die();
}

//Get a list of current in system devices and give a list for ipaddrs.
$devs = glob("../../devices/auto/*.inf");
$fixedevs = glob("../../devices/fixed/*.inf");
$devs = array_merge($devs, $fixedevs);

?>
<html>
<head>
<title>three_button_panel</title>
<link rel="stylesheet" href="../basic/tocas.css">
<script src="../basic/jquery.min.js"></script>
<style>

</style>
</head>
<body>
<div id="ipv4" style="position:fixed;top:3px;left:3px;z-index:10;"><?php echo $_GET['ip'];?></div>
<br><br>
<div class='ts container'>
	<p>Please enter the endpoint in which the button corrisponding to.</p>
	<div class="ts fluid action input" style="margin-top:8px;">
		<input id="ep0" type="text" placeholder="Endpoint 1">
		<button class="ts button" onclick="updateEndpoint(0);">Update</button>
	</div>
	<div class="ts fluid action input" style="margin-top:8px;">
		<input id="ep1" type="text" placeholder="Endpoint 2">
		<button class="ts button" onclick="updateEndpoint(1);">Update</button>
	</div>
	<div class="ts fluid action input" style="margin-top:8px;">
		<input id="ep2" type="text" placeholder="Endpoint 3">
		<button class="ts button" onclick="updateEndpoint(2);">Update</button>
	</div>
	<div class="ts divider"></div>
	<p>Change the item below and press "Update" in the input box above to update a toogle URL.</p>
	<select id="toggleTarget" class="ts basic fluid dropdown">
		<?php
			foreach ($devs as $dev){
				$uuid = basename($dev,".inf");
				$name = $uuid;
				$devInfo = explode(",",file_get_contents($dev));
				$ipa = $devInfo[0];
				
				if (strpos($devInfo[1],"_") !== false){
					//For auto devices
					$driver = explode("_",$devInfo[1])[1];
				}else{
					//For fixed devices
					$driver = $devInfo[1];
				}
				if (file_exists("../../drivers/" . $driver . "/toggle.inf")){
					//This device support toggling. Set its toggle url.
					$toggleSuffix = trim(file_get_contents("../../drivers/" . $driver . "/toggle.inf"));
					if (file_exists("../../name/" .$uuid . ".inf")){
						$name = trim(file_get_contents("../../name/" .$uuid . ".inf"));
					}
					
					echo '<option toggleaddr="' . $ipa . $toggleSuffix . '">' . $name . '</option>';
				}
			}
		?>
	</select>
	<br><br>
	<button class="ts primary button" onclick="updatepanel();">Update Panel</button>

</div>
<div id="uuid" style="position:fixed;bottom:3px;left:3px;"></div>
<div id="mode" mode="<?php echo $mode; ?>" style="position:fixed;bottom:18px;left:3px;"><?php echo "Control Mode: " . $mode; ?></div>
<script>
var mode = $("#mode").attr("mode").trim();
var scriptName = "three.panel.hd.com.imuslab.php";
var ipaddr = "<?php echo $_GET['ip']; ?>";

uuid();
status();

function status(){
    var targetUrl = "http://" + ipaddr + "/status";
    if (mode == "remote"){
        targetUrl = scriptName + "?getStatus=" + ipaddr;
    }
    $.ajax({url: targetUrl, 
	success: function(result){
		console.log(result);
		$("#ep0").val(result["ep0"]);
		$("#ep1").val(result["ep1"]);
		$("#ep2").val(result["ep2"]);
	}});
}


function uuid(){
    var targetURL = "http://" + ipaddr + "/uuid"
    if (mode == "remote"){
        targetURL = scriptName + "?getUUID=" + ipaddr;
    }
	$.ajax({url: targetURL, success: function(result){
        $("#uuid").text(result);
    }});
}

function updateEndpoint(num){
	var newEndpoint = getSelectedEndpoint();
	if (num == 0){
		$("#ep0").val(newEndpoint);
	}else if (num == 1){
		$("#ep1").val(newEndpoint);
	}else if (num == 2){
		$("#ep2").val(newEndpoint);
	}
}

function updatepanel(){
	$.get("http://" + ipaddr + "/setep?ep=0&val=" + $("#ep0").val(),function(data){
		console.log(data)
		$.get("http://" + ipaddr + "/setep?ep=1&val=" + $("#ep1").val(),function(data){
			console.log(data);
				$.get("http://" + ipaddr + "/setep?ep=2&val=" + $("#ep2").val(),function(){
					console.log(data);
					alert("Panel Updated");
				});
		});
	});
}

function getSelectedEndpoint(){
	return $("#toggleTarget option:selected").attr("toggleaddr");
}
</script>
</body>
</html>