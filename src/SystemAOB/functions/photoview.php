<?php
include '../../auth.php';
?>
<html>
<head>
<title>Image Viewer</title>
<script src="../../script/jquery.min.js"></script>
<link rel="stylesheet" href="../../script/tocas/tocas.css">
<script type='text/javascript' src="../../script/tocas/tocas.js"></script>
</head>
<body style="background:rgba(34,34,34,1);overflow:hidden;">
<img id="display" src="<?php echo $_GET['filepath'];?>" style="object-fit: scale-down !important;max-width:100%;height:98%;"></img>

<script>
var imageWidth = $('#display').css('width').replace("px","");
var imageHeight = $('#display').css('height').replace("px","");
var inVDI = !(!parent.isFunctionBar);
var displayName = "<?php echo $_GET['filename'];?>";
$(window).resize(function() {
    clearTimeout(window.resizedFinished);
    window.resizedFinished = setTimeout(function(){
        //Resize finish, adjust the css accordingly
		adjustImgWidth();
    }, 300);
});
	
function adjustImgWidth(){
		var vw = $('#display').width();
		var sw = $( window ).width();
		var center = parseInt((sw - vw) / 2);
		$('#display').css("left",center);
}


$(document).ready(function(){
	setTimeout(function(){adjustImgWidth();}, 100);
	if (inVDI){
		//If it is currently in VDI, force the current window size and resize properties
		var windowID = $(window.frameElement).parent().attr("id");
		parent.setWindowIcon(windowID + "","file image outline");
		parent.changeWindowTitle(windowID + "",displayName);
	}
});

</script>
</body>
</html>