<html>
<?php include_once("../../../auth.php");?>
    <head>
		<script src="../../../script/jquery.min.js"></script>
        <title>NotepadA Test Window</title>
        <style>
            body{
                font-family: Arial !important;
				background-color:#ebebeb;
            }
            .menu{
                position:fixed;
                top:0;
                left:0;
                width:100%;
                height:18px;
                background-color:#3d3d3d;
                padding:5px;
                color:white;
                font-size:80%;
            }
            .urlinput{
                display:inline;
            }
			.toRight{
				position:absolute;
				right:15px;
				top:3px;
			}
			.previewArea{
				width:100%;
				position:fixed;
				top:27px;
				left:0px;
			}
			#previewWindow{
				position:absolute;
				left:0px;
				top:0px;
			}
        </style>
    </head>
    <body>
        <div id="toolbar" class="menu">
            NotepadA Debug Window   <div id="windowsize" style="display:inline;">loading...</div><button class="toRight" onClick="document.getElementById('previewWindow').contentWindow.location.reload();">Refresh</button>
        </div>
		<div class="previewArea">
			<iframe id="previewWindow" frameBorder="0" width="100%" src="<?php 
			if (isset($_GET['preview']) && $_GET['preview'] != ""){
				if (file_exists($_GET['preview'])){
					echo $_GET['preview'];
				}else{
					echo 'notfound.html';
				}
			}else{
				echo "nothing.html";
			}
			
			?>"></iframe>
		</div>
    </body>
    <script>
    var bottomPadding = 8; //In pixel
	adjustIframeSize();
	function adjustIframeSize(){
		var w = window.innerWidth;
		var h = window.innerHeight;
		$("#windowsize").html(w + "px x " + (h  - parseInt($("#toolbar").height()) - bottomPadding) + "px");
		$("#previewWindow").attr("width",w + "px");
		$("#previewWindow").attr("height",(h  - parseInt($("#toolbar").height()) - bottomPadding) + "px")
		
	}
	
	$( window ).resize(function() {
		adjustIframeSize();
	});
	</script>
</html>