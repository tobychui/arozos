<?php
include '../auth.php';
?>
<html>
<head>
<link rel="stylesheet" href="scripts/tocas/tocas.css">
<script src="scripts/jquery.min.js"></script>
<title>AOB Documd</title>
</head>
<body>
    <br>
    <br>

    <div class="ts container stackable grid">
        <div class="sixteen wide column">
            <div class="ts secondary fitted menu">
                <div class="item">
                    <h3 class="ts header">
                        ArOZ Online Beta Documentation
                    </h3>
                </div>
                <div class="right menu">
                    <div class="item">
                        <div class="ts breadcrumb">
                            <a class="section">Documd</a>
                            <i class="right chevron icon divider"></i>
                            <div class="active section">Markdown Documentation Rendering Tool</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
		
        <div class="four wide column">
            <div class="ts icon fluid input">
				<input type="text" placeholder="Search...">
				<i class="search icon"></i>
			</div>
 
            <div class="ts top attached header">
                Documentation Chapters
            </div>
            <div class="ts bottom attached vertical menu" style="word-wrap: break-word;word-break: break-all;">
				<?php
					$folderList = [];
					$filesList = [];
					$fileNameList = [];
					$count = 0;
					$folders = glob("docs/*");
					foreach($folders as $folder){
						if (is_dir($folder)){
							echo '<a class="item" onClick="OpenFolder('.$count.')">
                    <i class="folder open outline icon"></i> '.basename($folder).'
					</a>';
					array_push($folderList,bin2hex($folder));
					$count++;
						}
					}
					
					$count = 0;
					$files = glob("docs/*.md");
					foreach($files as $file){
						if (is_file($file)){
							$shortenFilename = wordwrap(basename($file), 35, "<br />\n");
							echo '<a class="item" onClick="OpenFile('.$count.')">
                    <i class="file outline icon"></i> '.$shortenFilename.'
					</a>';
					array_push($filesList,bin2hex($file));
					array_push($fileNameList,$file);
					$count++;
						}
					}
				?>
            </div>

			
        </div>

		
        <div class="twelve wide column">
            <div class="ts segments">
                <!-- 標題工具列 -->
                <div class="ts fitted primary segment">
                    <div class="ts secondary horizontally fitted menu">
                        <!-- 標題項目 -->
                        <div class="header item">
                            Documd Viewer
                        </div>
                        <div class="right menu">
                            <div class="item">
                                <div class="ts small buttons">
                                    <button class="ts icon button" onClick="PreviousPage();">
                                        <i class="left arrow icon"></i>
                                    </button>
                                    <button class="ts icon button"onClick="NextPage();">
                                        <i class="right arrow icon"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

				
				
                <div class="ts segment">
                    <div id="DocFileName" class="ts medium header">
						Current Page
                        <div id="DocFullPath" class="sub header">
							/docs/title.md
                        </div>
                    </div>
                </div>

                <div class="ts segment"id="docContent">
                   
                </div>
				<br><br><br><br>
            </div>
        </div>
		<div style="width:100%;" align="right">Documd Markdown Documentation Rendering Interface, Developed by IMUS Laboratory</div>
    </div>
<script>
var folderList = <?php echo json_encode($folderList);?>;
var fileList = <?php echo json_encode($filesList);?>;
var fileNameList = <?php echo json_encode($fileNameList);?>;
var currentPage = 0;
$(document).ready(function(){
	$('#docContent').load("getDoc.php?filename=" + fileList[0]);
	$('#DocFullPath').html(fileNameList[0]);
});

function OpenFolder(id){
	
}

function PreviousPage(){
	if (currentPage > 0){
		currentPage--;
		$('#docContent').load("getDoc.php?filename=" + fileList[currentPage]);
		$('#DocFullPath').html(fileNameList[currentPage]);
	}
}

function NextPage(){
	if (currentPage < fileList.length-1){
		currentPage++;
		$('#docContent').load("getDoc.php?filename=" + fileList[currentPage]);
		$('#DocFullPath').html(fileNameList[currentPage]);
	}
}
function OpenFile(id){
	var file = fileList[id];
	console.log(file);
	currentPage = id;
	$('#docContent').load("getDoc.php?filename=" + file);
	$('#DocFullPath').html(fileNameList[id]);
}
</script>
</body>
</html>
</body>
</html>