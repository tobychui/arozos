<html>
<head>
<title>Tocas UI 2.3.3 min.document</title>
<link rel="stylesheet" href="dist/tocas.css">
<script src="jquery-3.3.1.min.js"></script>
<style>
    body{
        background-color:white;
    }
</style>
</head>
<body>
<br><br>
<div class="ts container">
<h4 class="ts center aligned icon header">
    <i class="code icon"></i>ArOZ Online CSS Reference Document
    <div class="sub header">Powered by Tocas UI 2.3.3 by Yami Odymel<br>Mapped from Go to PHP by Toby Chui</div>
</h4>
<div class="ts segmented list">
<?php
$dir = ["collections","elements","modules","views"];
$exclude = ["collections/grid.json","collections/menu.json","elements/flag.json","elements/icon.json","elements/placeholder.json","elements/text.json","elements/typography.json","modules/carousel.json","modules/comparison.json","modules/contextmenu.json","modules/modal.json","modules/rating.json","modules/search.json","modules/slider.json","modules/snackbar.json","modules/sortable.json","modules/transfer.json","modules/window.json"];
foreach ($dir as $item){
	$files = glob($item . "/*.json");
	foreach ($files as $file){
		if (in_array($file,$exclude) == false){
			echo '<div class="item" style="cursor:pointer;" onClick="openThis(this);" filename="' . $file .'">'.$file.'</div>';
		}
		
	}
}
?>
</div>
Document provided for ArOZ Online Developer. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/deed.zh_TW">CC BY 4.0</a> (Following the original Tocas UI license)
</div>
<br><br>
<script>
function openThis(object){
	window.location.href = "load.php?docname=" + $(object).attr("filename");
}

$(function() {
   $('.item').hover( function(){
      $(this).addClass("selected");
   },
   function(){
      $(this).removeClass("selected");
   });
});
</script>
</body>
</html>