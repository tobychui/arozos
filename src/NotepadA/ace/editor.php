<?php
/*NotepadA editor.php
Special modification was made to the script and make the ace editor to work with AOB system.
This is just part of the system and require php scripts outside this folder to work.

** DO NOT EDIT THIS PAGE WITH NOTEPADA ONLINE EDITOR. **
** DO NOT EDIT THIS PAGE WITH NOTEPADA ONLINE EDITOR. **
** DO NOT EDIT THIS PAGE WITH NOTEPADA ONLINE EDITOR. **

*/
include '../../auth.php';
?>
<!DOCTYPE html>
<html lang="en">
<!-- Special modification for NotepadA system, ArOZ Online Beta-->
<head>
<?php
//Init of the editor
function mv($var){
	if (isset($_GET[$var]) == true && $_GET[$var] != ""){
		return $_GET[$var];
	}else{
		return "";
	}
}
//Default value
$filename = "";
$displayName = "";
$fileExt = "";
$theme = "tomorrow_night";
$mode = "php";
$fontsize = "12"; 
//check if a correct filename has been provided
if (mv("filename") != ""){
	//Editing an existed file
	$filename = mv("filename");
	if (file_exists(dirname($filename)) == false){
		//If the file that should be containing this file is not fonund
		echo "<code>Requested Directory: " . dirname($filename) . '<br>';
		echo "<script src='../../script/jquery.min.js'></script><script>$('body').css('background-color','white');function checkIsSaved(){return true;}</script>";
		$date   = new DateTime(); //this returns the current date time
		$result = $date->format('Y-m-d H:i:s');
		die("Error. Target folder was not found on the host device. Please close this tab and reopen if needed.<br><br><hr>Request Time: " . $result . '</code>');
	}
	
	if (!file_exists($filename)){
		//File not found, creating a new one instead
		$file = fopen($filename, 'w') or die('Error opening file: ' + $filename); 
		fclose($file); 
	}
	$displayName = $filename;
	$fileExt = pathinfo($filename, PATHINFO_EXTENSION);
	//Handle the AOB Upload Manger type of naming methods
	if (substr($filename,0,5) == "inith"){
		$nameOnly = basename($filename, "." . $fileExt);
		$nameOnly = str_replace("inith","",$nameOnly);
		$displayName = hex2bin($nameOnly) . "." . $fileExt . " (Encoded Filename)";
	}else{
		$displayName = basename($filename);
	}
	//Set the mode of the editor to the extension of the file, but something this might be incorrect.
	$mode = $fileExt;
}else{
	//Creating a new file instead
	$filename = "";
	$displayName = "untitled";
}

if (mv("theme") != ""){
	$theme = mv("theme");
}

if (mv("fontsize") != ""){
	$fontsize = mv("fontsize");
}


?>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <title><?php echo "Editing " . $displayName;?></title>
  <script src="../../script/jquery.min.js"></script>
  <style type="text/css" media="screen">
    body {
        overflow: hidden;
		padding-bottom:5px;
		background-color:#2b2b2b;
    }

    #editor {
        margin: 0;
        position: absolute;
        top: 0;
        bottom: 15px;
        left: 0;
        right: 0;
    }
	
  </style>
</head>
<body>
<pre id="editor"><?php
	if ($filename != ""){
		echo str_replace("<","&lt;",file_get_contents($filename));
	}

?></pre>

<script src="src-noconflict/ace.js" type="text/javascript" charset="utf-8"></script>
<script>
	var filename = "<?php echo $filename;?>";
	var filepath = "<?php echo str_replace("\\",'/',realpath($filename));?>";
	var lastSave = "";
	//Init editor
    var editor = ace.edit("editor");
    editor.setTheme("ace/theme/<?php echo $theme;?>");
	var detectMode = getMode(filepath);
	//console.log("[NotepadA] Chaning mode to " + detectMode.toLowerCase());
	if ( detectMode != undefined){
		editor.session.setMode("ace/mode/" + detectMode.toLowerCase());
		
	}else{
		//Default mode: php
		editor.session.setMode("ace/mode/php");
	}
	editor.setOptions({
	  //fontFamily: "tahoma",
	  fontSize: "<?php echo $fontsize;?>pt"
	});
	
	$(document).ready(function(){
		//Initial assume saved
		lastSave = editor.getValue();
		
	});
	//Listener for Ctrl+S
	$(window).keypress(function(event) {
		if (!(event.which == 115 && event.ctrlKey) && !(event.which == 19)) return true;
		//console.log(filepath);
		Save();
		event.preventDefault();
		return false;
	});
	
	$(document).on("click","#editor",function() {
		//Hide the parent window in NotepadA condition
        window.parent.hideToggleMenu();
    });

	function Print() {
		try {
			var printWindow = window.open("", "", "height=400,width=800");
			printWindow.document.write("<html><head><title>NotepadA Print Window</title>");
			printWindow.document.write("</head><xmp>");
			printWindow.document.write("filename: " + filename + " \nprint-time: " + new Date().toLocaleString() + "\n");
			printWindow.document.write(editor.getSession().getDocument().getValue());
			printWindow.document.write("</xmp></html>");
			printWindow.document.close();
			printWindow.print();
		}catch (ex) {
			console.error("Error: " + ex.message);
		}
	}
	
	//Absolute path is used for saving. So no need to worry about the relative path over php issues
	function Save(){
		code = editor.getValue();
		$.post("../writeCode.php", { filename: filepath, content: code })
		  .done(function( data ) {
			if (data.includes("ERROR") == false){
				console.log("%c[NotepadA] " + filename + " -> Saved!","color:#1265ea");
				lastSave = code;
			}else{
				console.log(data);
			}
		  });
	}
	
	function getDocWidth(){
		return $(document).width();
	}
	
	function checkIsSaved(){
		if (lastSave ==  editor.getValue()){
			return true;
		}else{
			return false;
		}
	}
	
	function insertChar(text){
		editor.session.insert(editor.getCursorPosition(), text);
	}
	
	function getEditorContenet(){
		return editor.getValue();
	}
	
	function getFilepath(){
		return (filename.replace("../",""));
	}
	
	function openInNewTab(){
		if (filename.substring(0,14) == "/media/storage"){
			window.open("../SystemAOB/functions/extDiskAccess.php?file=" + filename);
		}else{
			window.open(filename.replace("../",""));
		}
		
	}
	
	function getSelectedText(){
		return editor.getSession().doc.getTextRange(editor.selection.getRange());
	}
	
	function insertGivenText(text){
		editor.session.insert(editor.getCursorPosition(), text);
	}
	
	function callUndo(){
		editor.getSession().getUndoManager().undo();
	}
	
	function callRedo(){
		editor.getSession().getUndoManager().redo();
	}

var nameOverrides = {
    ObjectiveC: "Objective-C",
    CSharp: "C#",
    golang: "Go",
    C_Cpp: "C and C++",
    Csound_Document: "Csound Document",
    Csound_Orchestra: "Csound",
    Csound_Score: "Csound Score",
    coffee: "CoffeeScript",
    HTML_Ruby: "HTML (Ruby)",
    HTML_Elixir: "HTML (Elixir)",
    FTL: "FreeMarker"
};

function startSearchBox(){
	editor.execCommand("find");
}

function getMode(filePath){
	var ext = filePath.split(".").pop();
	var supportedModes = {
		ABAP:        ["abap"],
		ABC:         ["abc"],
		ActionScript:["as"],
		ADA:         ["ada|adb"],
		Apache_Conf: ["^htaccess|^htgroups|^htpasswd|^conf|htaccess|htgroups|htpasswd"],
		AsciiDoc:    ["asciidoc|adoc"],
		ASL:         ["dsl|asl"],
		Assembly_x86:["asm|a"],
		AutoHotKey:  ["ahk"],
		BatchFile:   ["bat|cmd"],
		Bro:         ["bro"],
		C_Cpp:       ["cpp|c|cc|cxx|h|hh|hpp|ino"],
		C9Search:    ["c9search_results"],
		Cirru:       ["cirru|cr"],
		Clojure:     ["clj|cljs"],
		Cobol:       ["CBL|COB"],
		coffee:      ["coffee|cf|cson|^Cakefile"],
		ColdFusion:  ["cfm"],
		CSharp:      ["cs"],
		Csound_Document: ["csd"],
		Csound_Orchestra: ["orc"],
		Csound_Score: ["sco"],
		CSS:         ["css"],
		Curly:       ["curly"],
		D:           ["d|di"],
		Dart:        ["dart"],
		Diff:        ["diff|patch"],
		Dockerfile:  ["^Dockerfile"],
		Dot:         ["dot"],
		Drools:      ["drl"],
		Edifact:     ["edi"],
		Eiffel:      ["e|ge"],
		EJS:         ["ejs"],
		Elixir:      ["ex|exs"],
		Elm:         ["elm"],
		Erlang:      ["erl|hrl"],
		Forth:       ["frt|fs|ldr|fth|4th"],
		Fortran:     ["f|f90"],
		FTL:         ["ftl"],
		Gcode:       ["gcode"],
		Gherkin:     ["feature"],
		Gitignore:   ["^.gitignore"],
		Glsl:        ["glsl|frag|vert"],
		Gobstones:   ["gbs"],
		golang:      ["go"],
		GraphQLSchema: ["gql"],
		Groovy:      ["groovy"],
		HAML:        ["haml"],
		Handlebars:  ["hbs|handlebars|tpl|mustache"],
		Haskell:     ["hs"],
		Haskell_Cabal:     ["cabal"],
		haXe:        ["hx"],
		Hjson:       ["hjson"],
		HTML:        ["html|htm|xhtml|vue|we|wpy"],
		HTML_Elixir: ["eex|html.eex"],
		HTML_Ruby:   ["erb|rhtml|html.erb"],
		INI:         ["ini|conf|cfg|prefs"],
		Io:          ["io"],
		Jack:        ["jack"],
		Jade:        ["jade|pug"],
		Java:        ["java"],
		JavaScript:  ["js|jsm|jsx"],
		JSON:        ["json"],
		JSONiq:      ["jq"],
		JSP:         ["jsp"],
		JSSM:        ["jssm|jssm_state"],
		JSX:         ["jsx"],
		Julia:       ["jl"],
		Kotlin:      ["kt|kts"],
		LaTeX:       ["tex|latex|ltx|bib"],
		LESS:        ["less"],
		Liquid:      ["liquid"],
		Lisp:        ["lisp"],
		LiveScript:  ["ls"],
		LogiQL:      ["logic|lql"],
		LSL:         ["lsl"],
		Lua:         ["lua"],
		LuaPage:     ["lp"],
		Lucene:      ["lucene"],
		Makefile:    ["^Makefile|^GNUmakefile|^makefile|^OCamlMakefile|make"],
		Markdown:    ["md|markdown"],
		Mask:        ["mask"],
		MATLAB:      ["matlab"],
		Maze:        ["mz"],
		MEL:         ["mel"],
		MIXAL:       ["mixal"],
		MUSHCode:    ["mc|mush"],
		MySQL:       ["mysql"],
		Nix:         ["nix"],
		NSIS:        ["nsi|nsh"],
		ObjectiveC:  ["m|mm"],
		OCaml:       ["ml|mli"],
		Pascal:      ["pas|p"],
		Perl:        ["pl|pm"],
		pgSQL:       ["pgsql"],
		PHP:         ["php|phtml|shtml|php3|php4|php5|phps|phpt|aw|ctp|module"],
		Pig:         ["pig"],
		Powershell:  ["ps1"],
		Praat:       ["praat|praatscript|psc|proc"],
		Prolog:      ["plg|prolog"],
		Properties:  ["properties"],
		Protobuf:    ["proto"],
		Python:      ["py"],
		R:           ["r"],
		Razor:       ["cshtml|asp"],
		RDoc:        ["Rd"],
		Red:         ["red|reds"],
		RHTML:       ["Rhtml"],
		RST:         ["rst"],
		Ruby:        ["rb|ru|gemspec|rake|^Guardfile|^Rakefile|^Gemfile"],
		Rust:        ["rs"],
		SASS:        ["sass"],
		SCAD:        ["scad"],
		Scala:       ["scala"],
		Scheme:      ["scm|sm|rkt|oak|scheme"],
		SCSS:        ["scss"],
		SH:          ["sh|bash|^.bashrc"],
		SJS:         ["sjs"],
		Smarty:      ["smarty|tpl"],
		snippets:    ["snippets"],
		Soy_Template:["soy"],
		Space:       ["space"],
		SQL:         ["sql"],
		SQLServer:   ["sqlserver"],
		Stylus:      ["styl|stylus"],
		SVG:         ["svg"],
		Swift:       ["swift"],
		Tcl:         ["tcl"],
		Tex:         ["tex"],
		Text:        ["txt"],
		Textile:     ["textile"],
		Toml:        ["toml"],
		TSX:         ["tsx"],
		Twig:        ["twig|swig"],
		Typescript:  ["ts|typescript|str"],
		Vala:        ["vala"],
		VBScript:    ["vbs|vb"],
		Velocity:    ["vm"],
		Verilog:     ["v|vh|sv|svh"],
		VHDL:        ["vhd|vhdl"],
		Wollok:      ["wlk|wpgm|wtest"],
		XML:         ["xml|rdf|rss|wsdl|xslt|atom|mathml|mml|xul|xbl|xaml"],
		XQuery:      ["xq"],
		YAML:        ["yaml|yml"],
		Django:      ["html"]
	};
	for (var key in supportedModes) {
		if (supportedModes.hasOwnProperty(key)) {
			var thisExtension = supportedModes[key][0].split("|");
			if (thisExtension.length == 1){
				if (ext == thisExtension[0]){
					return key;
				}
			}else{
				for(var i =0; i < thisExtension.length;i++){
					if (ext == thisExtension[i]){
						return key;
					}
				}
			}
		}
	}
}

$(window).bind('keydown', function(event) {
    if (event.ctrlKey || event.metaKey) {
        switch (String.fromCharCode(event.which).toLowerCase()) {
        case 's':
            event.preventDefault();
            Save();
            break;
        }
    }
});

</script>
</body>
</html>
