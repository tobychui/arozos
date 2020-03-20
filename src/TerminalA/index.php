<?php
include '../auth.php';
?>
<html>
<head>
<head>
<script type='text/javascript' charset='utf-8'>
    // Hides mobile browser's address bar when page is done loading.
      window.addEventListener('load', function(e) {
        setTimeout(function() { window.scrollTo(0, 1); }, 1);
      }, false);
</script>
    <meta charset="UTF-8">
	<script src="../script/jquery.min.js"></script>
    <link rel="stylesheet" href="../script/tocas/tocas.css">
	<script type='text/javascript' src="../script/tocas/tocas.js"></script>
	<script type='text/javascript' src="../script/ao_module.js"></script>
	<title>AOB Terminal</title>
</head>

<body style="background-color:#061d42;">
<div id="cmdResult" style="position:fixed;top:0;width:100%;color:white;font-size:120%;overflow-y:scroll;padding:10px;">
<?php
if (file_exists("../SystemAOB/functions/info/version.inf")){
    echo file_get_contents("../SystemAOB/functions/info/version.inf") . "<br>";
}else{
    echo "Genuine ArOZ Online System (Device Version Code Unknown)" . "<br>";
}
if (file_exists("../SystemAOB/functions/file_system/index.php")){
	echo "TERMINAL_A_OK!";
}else{
	echo "_CHECK ERROR --> AROZ FILE SYSTEM NOT EXISTS.";
	exit(0);
}

$utilList = [];
if (file_exists("../SystemAOB/utilities/")){
    $utils = glob("../SystemAOB/utilities/*.php");
    foreach ($utils as $util){
        array_push($utilList,str_replace("../","",$util));
    }
}
?><br>
>> ArOZ Online Beta Javascript Terminal<br>
>> Build 3/2019<br>
>> Type "help" in the bottom black bar for more information.<br>
</div>
<input type="text" id="cmdIn" rows="1" style="position:fixed;bottom:5px;padding-left:10px;width:100%;height:25px;background-color:black;color:white;outline: none; border-width:0px; border:none;"></input>
<script>
var VDI = ao_module_virtualDesktop;
var usedCommands = [];
var searching = 0;
var shiftHeld = false;
var numOfRow = 1;
var utilist = <?php echo json_encode($utilList);?>;

//Init of the window
autoSize();
ao_module_setWindowTitle("TerminalA");
ao_module_setGlassEffectMode();
ao_module_setWindowIcon("code");

$("#cmdIn").on('keyup', function (e) {
    if (e.keyCode == 13) {
		if (shiftHeld == false){
			//Send the command to process
			var command = $('#cmdIn').val();
			$('#cmdIn').val("");
			$('#cmdResult').append(">> " + command + "<br>")
			var result = runCommand(command);
			if (result != "undefined" && result != null){
				$('#cmdResult').append( + "<br>")
			}
		}else{
			//Add a new line to the textbox
			numOfRow++;
			$('#cmdIn').attr("rows",numOfRow);
			$('#cmdIn').val($('#cmdIn').val() + "\n");
		}
    }
});

function runCommand(cmdImport){
	var command = cmdImport.split(" ");
	usedCommands.unshift(cmdImport);
	searching = 0;
	numOfRow = 1;
	if (command[0] == "help"){
		return showHelp();
	}else if (command[0] == "print"){
		lt(cmdImport.replace("print ",""));
		return;
	}else if (command[0] == "cls"){	
		$("#cmdResult").html("");
		lt("_OK");
		return;
	}else if (command[0] == "newfw"){
		var url = command[1];
		var title = url;
		var uid = Math.floor(Date.now() / 1000);
		var icon = "block layout";
		if (command[2] != null){
			title = command[2];
		}
		if (command[3] != null){
			icon = command[3];
		}
		window.parent.newEmbededWindow(url,title,icon,uid);
		
	}else if (command[0] == "exit"){	
		//console.log(window.parent.$("iframe").remove());
		window.location.href="../SystemAOB/functions/killProcess.php"
		return;
	}else if (command[0].includes("lt(")){
		lt("Please use 'print' command to print text. lt('text'); function are only used in functions for printing to online console.");
		return;
	}else if (command[0].toLowerCase() == "var"){
		window[command[1]] = cmdImport.replace(command[0] + " " + command[1] + " " + command[2] + " ","");
		lt("Variable '" + command[1] + "' declared as '" + cmdImport.replace(command[0] + " " + command[1] + " " + command[2] + " ","") + "'.");
		return;
	}else if (command[0].toLowerCase() == "function" && (command[1].includes("(") || command[2].includes("("))){
		var functionStartPos = cmdImport.indexOf("(");
		var functionName = cmdImport.substring(0,functionStartPos).replace("function ","").trim();
		eval('window["' + functionName + '"] = function' + cmdImport.substring(functionStartPos,cmdImport.length))
		lt("New function '" + functionName + "' is declared.");
		return;
	}else if (command[0] == "?"){
	    lt("Please use 'help' for printing the help information.");
	}else if (command[0] == ""){
		lt("(´・ω・`)??");
		return
	}else if (command[0] == "bash"){
	    if (command[1] && command[1] == "-confirm"){
	        lt("[OK] Redirection in progress...");
	        window.location.href = "plugins/bash.php";
	    }else{
	        lt("[WARNING] Misuse of BASH commands might lead to system corruption or data loss.<br> To confirm this action, please use the command: bash -confirm");
	    }
	    
	}else if (checkInUtilList(command[0])){
	    var url = "";
	    for (var i =0; i < utilist.length;i++){
	        if (utilist[i].split("/").pop() == command[0]){
	            url = utilist[i];
	        }
	    }
		var title = url;
		var uid = Math.floor(Date.now() / 1000);
		var icon = "block layout";
		if (command[2] != null){
			title = command[2];
		}
		if (command[3] != null){
			icon = command[3];
		}
		window.parent.newEmbededWindow(url,title,icon,uid);
		lt("OK");
	}else{
		try {
			var result = eval(cmdImport);
			if (result == null){
				lt("OK");
			}else{
				lt(result);
			}
			
		} catch (e) {
			lt("[ERROR] " + e.message);
		}
	}
	return "Command Not Found.";
}

function checkInUtilList(moduleName){
    for (var i =0; i < utilist.length;i++){
        if (utilist[i].split("/").pop() == moduleName){
            return true;
        }
    }
    return false;
}

$(document).keydown(function (e) {
    if (e.keyCode == 16) {
        shiftHeld = true;
    }
});

$(document).keyup(function (e) {
    if (e.keyCode == 16) {
        shiftHeld = false;
    }
});

$("#cmdIn").keyup(function(e) {
    if(e.which == 38) {
        $("#cmdIn").val(usedCommands[searching]);
		if (searching < usedCommands.length){
			searching++;
		}
    }else if (e.which == 40){
		if (searching > 0){
			searching--;
		}
		$("#cmdIn").val(usedCommands[searching]);
		
	}
});

function showHelp(args){
	lt("--- AOB Terminal Help Document ---");
	lt("Print text from terminal -> print your_text");
	lt("Clear screen -> cls");
	lt("New Float Window -> newfw url_here title(optional) icon(optional)");
	lt("Show help information -> help");
	lt("");
	lt("-- Declare new function / variables --");
	lt('New variable -> window["variable"] = value');
	lt('New function -> window["function_name"] = function(parameter){ //code here }');
	lt('New variable (JavaScript) -> var variable = value');
	lt('New function (JavaScript) -> function funct_name(parameter){ //code here }');
	lt('lt("text") -> Print text in functions to terminal interface');
	lt("");
	lt("--- Math Library ---");
	lt("Math.round() / Math.pow() / Math.sqrt() / Math.abs() / Math.ceil() / Math.floor()");
	lt("Math.sin() / Math.cos() / Math.min(array) / Math.max(array) / Math.random()");
	lt("");
	lt("--- System Utilities ---");
	for (var i =0; i < utilist.length;i++){
	    lt(utilist[i].split("/").pop());
	}
	lt("");
	lt("--- ao_module APIs ---");
	var functList = getAllAOModuleFunctions();
	for (var i =0; i < functList.length; i++){
	    lt(functList[i]);
	}
	return null;
}

function getAllAOModuleFunctions(){ 
    var allfunctions=[];
        for ( var i in window) {
        if((typeof window[i]).toString()=="function"){
            if (i.includes("ao_module")){
                allfunctions.push(window[i].name);
            }
        }
    }
    return allfunctions;
}

function lt(text){
	//Log Terminal
	$('#cmdResult').append(text + "<br>")
	$("#cmdResult").scrollTop($("#cmdResult")[0].scrollHeight);
}

function autoSize(){
	var w = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
	var h = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
	$("#cmdResult").css("height",(h - (25 * numOfRow)) - 15 + "px");
	$("#cmdResult").scrollTop($("#cmdResult")[0].scrollHeight);
	if (VDI){
		$("#cmdIn").css("bottom","0px");
	}else{
		$("#cmdIn").css("bottom","0px");
	}
	
}

$(window).resize(function(){
   autoSize();
});
</script>
</body>
</html>