<?php
include '../auth.php';
?>
<!DOCTYPE html>
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="viewport" content="user-scalable=no, width=device-width, initial-scale=1, maximum-scale=1"/>
<html>
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
	<script src="jscolor.js"></script>
	<title>ArOZ Onlineβ</title>
</head>
<body>
    <nav class="ts attached inverted borderless normal menu">
        <div class="ts narrow container">
            <a href="../" class="item">ArOZ Onlineβ</a>
       </div>
    </nav>
	<br><br>
    <!-- Head Banner -->
    <div class="ts narrow relaxed stackable container grid">

        <div class="sixteen wide column">

            <h1 class="ts center aligned header">
                <i class="sticky note outline icon"></i>
			<div class="sub header">
			Memo Wall
			</div>
        </h1>
    </div>


        <div class="sixteen wide column">

            <div class="ts segment">
				<div class="ts borderless horizontally fitted fluid left icon input">
					<input id="memoTitle" type="text" placeholder="Give it a title">
					<i class="book icon"></i>
				</div>
                <div class="ts borderless horizontally fitted fluid input">
                    <textarea id = "memoContent" placeholder="Have something to share?"></textarea>
                </div>


				<!-- Text Editing Area-->
                <div class="ts secondary fitted menu">
                    <div class="stretched item">
                        <div class="ts tiny faded fitted basic message">
                            <div id="writerName">Identification: Unknown </div>
							<div class="ts buttons">
							<button id="colorpicker" class="ts left icon label jscolor {valueElement:'chosen-value', onFineChange:'setColor(this);'}">
								<i class="eyedropper icon"></i> Background Color
							</button>
							<input name="fontcolor" type="hidden" id="color_value" value="000000">
							<button id="colorpicker" class="ts left icon label jscolor {valueElement:'color_value', onFineChange:'setFontColor(this);'}" value="000000">
								<i class="eyedropper icon"></i> Font Color
							</button>
							</div>
                        </div>
						
                    </div>
				</div>
				<div class="ts secondary fitted menu">
                    <div class="right item">
						<button id="cencelbtn" class="ts mini basic button" onClick="CancelEdit();" style="display:none;">Cancel</button>
                        <button class="ts mini basic button" onClick="SaveMemo();">Publish</button>
					</div>
				</div>
                

            </div>

        </div>
		

        <!-- Memo Area -->
        <div class="sixteen wide column">
		
			
            
				
				<?php
				$pinMemoHeader = '<h5 class="ts header">
							<i class="pin icon"></i>
							<div class="content">
								Pinned Memo
							</div>
					</h5><div class="ts stackable three waterfall cards">';
                $template = '<div class="ts card" style="background-color: %BG_COLOR%;">
                    <div class="content">
                        <div class="header" style="color: %FONT_COLOR%;">%MEMO_TITLE%</div>
                        <div class="meta">
                            <div>%AUTHOR%</div>
							
                        </div>
                    </div>
                    <div class="content">
                        <div class="description" style="color: %FONT_COLOR%;">
						%MEMO_CONTENT%
						</div>
						<br>
						<a OnClick="RemoveMemo(%MEMO_ID%);"><i class="trash outline icon"></i></a>
                    </div>
                </div>';
				$storage = "save/";
				$files = scandir($storage);
				if (count($files) > 2){
					echo $pinMemoHeader;
				}else{
					echo '<div class="ts stackable three waterfall cards">';
				}
				foreach($files as $file) {
					if ($file != "." && $file != ".."){
						$content = file_get_contents($storage . $file);
						$content = explode("\n",$content);
						$memoid = str_replace(".txt","",$file);
						$box = str_replace("%MEMO_TITLE%",$content[0], $template);
						$box = str_replace("%AUTHOR%",$content[1], $box);
						$box = str_replace("%BG_COLOR%",$content[2], $box);
						$box = str_replace("%FONT_COLOR%",$content[3], $box);
						$box = str_replace("%MEMO_CONTENT%",str_replace("%0A","<br>",strip_tags($content[4])), $box);
						$box = str_replace("%MEMO_ID%",$memoid, $box);
						echo $box;
					}
				}
				echo '</div>';
				?>
				<h5 class="ts header">
					<i class="sticky note icon"></i>
					<div class="content">
						Memos
					</div>
				</h5>
				<?php
				echo '<div class="ts stackable three waterfall cards">';
				$template = '<div class="ts card" style="background-color: %BG_COLOR%;">
                    <div class="content">
                        <div id="%MEMO_ID%-title" class="header" style="color: %FONT_COLOR%;">%MEMO_TITLE%</div>
                        <div class="meta">
                            <div>%AUTHOR%</div>
							
                        </div>
                    </div>
                    <div class="content">
                        <div id="%MEMO_ID%-content" class="description" style="color: %FONT_COLOR%;">
						%MEMO_CONTENT%
						</div>
						<br><a OnClick="">
						<a OnClick="PinMemo(%MEMO_ID%);"><i class="pin icon"></i></a>/
						<a OnClick="EditMemo(%MEMO_ID%)"><i class="edit icon"></i></a>/
						<a OnClick="RemoveMemo(%MEMO_ID%);"><i class="trash outline icon"></i></a>
                    </div>
                </div>';
				$storage = "memos/";
				$files = scandir($storage);
				foreach($files as $file) {
					if ($file != "." && $file != ".."){
						$content = file_get_contents($storage . $file);
						$content = explode("\n",$content);
						$memoid = str_replace(".txt","",$file);
						$box = str_replace("%MEMO_TITLE%",$content[0], $template);
						$box = str_replace("%AUTHOR%",$content[1], $box);
						$box = str_replace("%BG_COLOR%",$content[2], $box);
						$box = str_replace("%FONT_COLOR%",$content[3], $box);
						$box = str_replace("%MEMO_CONTENT%",str_replace("%0A","<br>",strip_tags($content[4])), $box);
						$box = str_replace("%MEMO_ID%",$memoid, $box);
						echo $box;
					}
				}
				?>


            </div>

        </div>

    </div>

	
	<script src="index.js"></script>
</body>
</html>