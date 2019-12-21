<?php
include_once("../../../auth.php");
if (isset($_GET['checkBinaryExists'])){
    $filepath = realpath("../" . $_GET['checkBinaryExists']);
    $ext = pathinfo($filepath, PATHINFO_EXTENSION);
    if ($ext !== "c"){
        die("false");
    }
    if (file_exists(dirname($filepath) . "/" . basename($filepath,".c") . ".exe") || file_exists(dirname($filepath) . "/" . basename($filepath,".c") . ".out")){
        die("true");
    }else{
        die("false");
    }
}
?>
<html>
<head>
<title>gcci</title>
<link rel="stylesheet" href="../../../script/tocas/tocas.css">
<script src="src/jquery.min.js"></script>
<script src="../../../script/ao_module.js"></script>
<style>
    body{
        background-color:white;
    }
	.invalid{
		color:#c23030;
	}
	.ready{
		color:#30c257;
	}
	.error{
		background-color:#f7e5e4;
	}
	.testcases{
	    margin-top:8px;
	    width:100%;
	    display:none;
	}
	.terminalBlock{
	    background-color:black;
	    font-family: monospace; 
	    padding:8px;
	    color:white;
	}
</style>
</head>
<body>
<br>
<div class="ts container">
Current Script: <span id="scriptname"></span><br>
<span id="status"></span><br>
<button class="tiny ts button"  onClick="$('.testcases').slideToggle('fast');"><i class="caret down icon"></i>Test Cases</button>
<button class="tiny ts button" style="margin-right:6px;" onClick="compile();">Compile Only</button>
<button class="tiny ts primary button"  onClick="compile(true);">Compile & Run</button>
<div class="testcases">
    <p>
        Fill in the input below for testing paramters.<br>
        Example: <code>-h</code> will print out the result for <code>./runThis -h</code>.
    </p>
    <div class="ts fluid input" style="padding-bottom:8px !important;">
        <textarea id="testcases" placeholder="Test Parameter, each test occupy one line."></textarea>
    </div>
    <button class="tiny ts primary button"  onClick="test();">Run Test Cases</button>
</div>
<br>
<div class="ts divider"></div>
<div id="compileResult" class="ts text container" style="padding:10px;">
    
</div>
<div id="terminalOutput">
    
</div>
</div>
<br><br>
<script>
var parentUID = ao_module_parentID;
var currentFileIsSourceCode = false;
var currentSource = "";

checkParentFocusDocument();
setInterval(checkParentFocusDocument,3000);
//Recover the test case data if exists.
var testcases = ao_module_getStorage("NotepadA","gcci-testcase");
if (!(testcases == null || testcases == undefined)){
    $('#testcases').val(testcases);
}

$('#testcases').bind('input propertychange', function() {
    //Try to store the value into the browser's localstorage
    ao_module_saveStorage("NotepadA","gcci-testcase",$('#testcases').val());
});


function test(){
    $.get("index.php?checkBinaryExists=" + currentSource,function(data){
        if (data == "true"){
            //Run the test
            let parameters = $("#testcases").val().split("\n");
            var sendObject = JSON.stringify(parameters);
            $.get("test.php?testpara=" + sendObject + "&source=" + currentSource,function(data){
                if (data.includes("ERROR") == false){
                    $("#terminalOutput").html("");
                    for (var i =0; i < data.length; i++){
                        $("#terminalOutput").append('<div class="terminalBlock">\
                                >' + basename(currentSource) + ' ' + parameters[i] + '<br>\
                                ' + data[i] + '\
                        </div>');
                    }
                }
            });
        }else{
            alert("Execution file not found. Please compile your code first before testing.");
        }
    });
}

function compile(run=false){
    $("#terminalOutput").html("");
    if (!currentFileIsSourceCode){
        if (!confirm("This doesn't seems like a c source code file. Compile anyway?")){
            return;
        }
    }
	$("#compileResult").text("Waiting for server response...");
	var command = "";
	if (run){
		command = "&run";
	}
	$.ajax({url: "compile.php?source=" + currentSource + command,
	success: function(data){
				$("#compileResult").html(data);
				if (data.includes("Error")){
					$("#compileResult").addClass("error");
				}else{
					$("#compileResult").removeClass("error");
				}
			}
	});
}

function checkParentFocusDocument(){
	var parentDOM = parent.document.getElementById(parentUID);
	var editor = $(parentDOM).find("iframe")[0].contentWindow.document;
	var focusedDocument = $(editor).find(".fileTab.focused");
	if (focusedDocument.length == 0){
		//No document focused
		return;
	}
	var currentFilepath = $(focusedDocument).attr("filename");
	$("#scriptname").text(basename(currentFilepath));
	currentSource = currentFilepath;
	if (getFileExtension(currentFilepath) == "c"){
		//This is a c source code file
		$("#status").text("Ready to compile");
		$("#status").removeClass("invalid").addClass("ready");
		currentFileIsSourceCode = true;
	}else{
		//This is not a c source code file
		$("#status").text("Not C source code");
		$("#status").removeClass("ready").addClass("invalid");
		currentFileIsSourceCode = false;
	}
}

function basename(filepath){
	if (filepath.includes("/")){
		var tmp = filepath.split("/");
		return tmp.pop();
	}else{
		return filepath;
	}
}

function getFileExtension(filepath){
	if (filepath.includes(".") == false){
		return "";
	}
	var tmp = filepath.split(".");
	return tmp.pop();
}
</script>
</body>
</html>