<?php
include_once '../../../auth.php';
?>
<html>
<head>
	<link rel="stylesheet" href="../../../script/tocas/tocas.css">
	<script src="../../../script/tocas/tocas.js"></script>
	<script src="../../../script/jquery.min.js"></script>
	<script src="../../../script/ao_module.js"></script>
	<title>Opening file with</title>
	<style>
	    .WebApp{
	        padding:3px !important;
	    }
	    
	    .selectable{
	        border:1px solid transparent;
	        cursor: pointer;
	    }
	    .selectable:hover{
	        background-color:#b8d0ff;
	        border: 1px solid #4f8aff;
	        border-radius: 3px;
	    }
	    #appList{
	        height:380px;
	        overflow-y:auto;
	        border:1px solid #b3b3b3;
	        padding:3px;
	        background-color:#f5f5f5;
	        border-radius: 3px;
	    }
	    body{
	        background-color:#f0f0f0;
	        overflow-y:hidden;
	        padding-top:15px;
	        padding-bottom:15px;
	    }
	    .selected{
	        background-color:#a6c5ff;
	        border: 1px solid #4f8aff;
	        border-radius: 3px;
	    }
	    .inVDI{
	       position:fixed;right:3px;bottom: 23px;font-size:80%;
	    }
	    .notVDI{
	        position:absolute;
	        right:0px;
	    }
	</style>
</head>
<?php
$filepath = "";
if (isset($_GET['filepath']) && $_GET['filepath'] != ""){
    $filepath = $_GET['filepath'];
    if (strpos("../",$filepath) == 0){
        $filepath = str_replace("../","",$filepath);
    }
    $filepath = "../../../" . $filepath;
    $value = explode(".",$filepath);
    $ext = array_pop($value);
}else if (isset($_GET['ext']) && $_GET['ext'] != ""){
    //Setting ext opener only. Do not open the file
    $ext = $_GET['ext'];
    $filepath = "NULL";
}else{
    //Test code for debugging purpose
    die("ERROR. Missing filepath.");
}
//All file path references inside FloatWindow is based on the AOR

?>
<body>
    <div class="ts container">
    <div class="ts segment">
        <p>Open files with extension .<?php echo $ext;?> with: </p>
        <div class="ts divider"></div>
        <div id="appList">
            <?php
            $folders = glob("../../../*");
            foreach ($folders as $WebApp){
                if (is_dir($WebApp) && file_exists($WebApp . "/index.php") || file_exists($WebApp . "/index.html")){
                    $imagePath =$WebApp . "/img/function_icon.png";
                    if (file_exists($WebApp . "/img/small_icon.png")){
                         $imagePath = $WebApp . "/img/small_icon.png";
                    }
                    $fw = "false";
                    $embedded = "false";
                    if (file_exists($WebApp . '/embedded.php') == true){ $embedded = "true";}
                    if (file_exists($WebApp . '/FloatWindow.php') == true){$fw = "true";}
                    echo '<div class="selectable WebApp" embedded="' . $embedded . '" fw="' .  $fw . '" ondblclick="confirmSelection(this);"><img class="ts avatar image" src="' . $imagePath .'">
                         <span>'. basename($WebApp) . '</span></img></div>';
                }
            }
            
            ?>
        </div>
        <div class="ts tiny fluid buttons" style="font-size:80%;">
            <button id="dl" class="ts basic button" href="<?php echo $filepath;?>" onClick="downloadFile(this);"><i class="download icon"></i>Download</a>
            <button id="newtab" class="ts basic button" href="<?php echo $filepath;?>" onClick="newtab(this);"><i class="external icon"></i>New Tab</button>
            <button id="fwonly" class="ts basic button" href="<?php echo $filepath;?>" onClick="newfw(this);">FloatWindow</button>
        </div>
        <br>
    </div>
    <div class="inVDI">
         <button class="ts basic tiny button" style="background-color:white;" onClick="confirmSelection();">Confirm</button>
         <button class="ts basic tiny button" style="background-color:white;" onClick="cancelSelection();">Cancel</button>
    </div>
	</div>
	<?php
	$filename = "";
	if (isset($_GET['filename']) && $_GET['filename'] != ""){
	    $filename = $_GET['filename'];
	}else{
	    $filename = basename($filepath);
	}
	
	
	?>
	<script>
	    var filename = "<?php echo $filename;?>";
	    var filepath = "<?php echo $filepath;?>";
	    var ext = "<?php echo $ext;?>";
	    window.filename = filename;
	    ao_module_setWindowSize(365,575);
	    ao_module_setWindowIcon("file");
	    ao_module_setWindowTitle("Open File Selection");
    	ao_module_setFixedWindowSize();
    	ao_module_setGlassEffectMode();
    	
    	$(document).ready(function(){
    	    if (filepath == "NULL"){
    	        //Do not show otherthings other than selecting opener
    	        $("#dl").hide();
    	        $("#newtab").hide();
    	        $("#fwonly").hide();
    	    }
    	});
    	
    	
    	$(".WebApp").on("click",function(){
    	   $(".WebApp").removeClass("selected");
    	   $(this).addClass("selected"); 
    	});
    	
    	if (!ao_module_virtualDesktop){
    	    $(".inVDI").removeClass("inVDI").addClass("notVDI");
    	    $("#fwonly").hide();
    	}
    	
    	function downloadFile(object){
    	    window.open($(object).attr("href"));
    	    //This section cannot use ao_module_close() function as a white screen will shows up on some browser
    	    window.location.href="../killProcess.php";
    	}
    	
    	function newtab(object){
    	    if ($(".selected").length > 0){
    	        //Open the selected file on a new tab once only
    	        var moduleName = $(".selected").text().trim();
    	        var targetURL = moduleName + "/index.php?filepath=" + $(object).attr("href").replace("../../","") + "&filename=" + filename;
    	        if (ao_module_virtualDesktop){
    	            window.open("../../../" + targetURL);
    	            window.location.href="../killProcess.php";
    	        }else{
    	            window.location.href = ("../../../" + targetURL);
    	        }
    	    }else{
    	        //Directly open the selected file in a new tab
    	        window.open($(object).attr("href"));
    	    }
    	    
    	    
    	}
    	
    	function newfw(object){
    	     if ($(".selected").length > 0){
    	        //Open the selected file on a new floatWindow once only
				var filename = (window.filename);
    	        var moduleName = $(".selected").text().trim();
				var hrefattr = $(object).attr("href").replace("../../","");
    	        var targetURL = moduleName + "/?filepath=" + hrefattr + "&filename=" + filename;
    	        if ($(".selected").attr("embedded") == "true"){
    	           targetURL = moduleName + "/embedded.php?filepath=" + hrefattr + "&filename=" + filename;
    	        }else if ($(".selected").attr("fw") == "true"){
    	            targetURL = moduleName + "/FloatWindow.php?filepath=" + hrefattr + "&filename=" + filename;
    	        }
    	        
    	        if (ao_module_virtualDesktop){
    	            //Opening newtab in VDI mode
    	            ao_module_newfw(targetURL,"Initializing...","spinner",new Date().getTime());
    	        }else{
    	           alert("ERROR. You cant open a floatWindow under non-VDI environment."); 
    	        }
    	    }else{
    	        //Directly open the selected file in a new floatWindow
    	        var filename = $(object).attr("href").replace("../../../",""); //Changing the path from relative from file_system to AOR
    	        var filteredFilename = baseName(filename);
    	        filteredFilename = filteredFilename.replace(/[^a-zA-Z0-9À-ž\s]/g, "");
    	        ao_module_newfw(filename,filteredFilename,"file outline",new Date().getTime());
    	    }
    	    window.location.href="../killProcess.php";
    	}
    	
    	function baseName(str){
           var base = new String(str).substring(str.lastIndexOf('/') + 1); 
            if(base.lastIndexOf(".") != -1)       
                base = base.substring(0, base.lastIndexOf("."));
           return base;
        }
        
        function confirmSelection(object=undefined){
            //IF the user selecting the target module and press confirm
            if (object == undefined && $(".selected").length > 0){
                object = $(".selected");
            }
            //Or otherwise, the user double click on the module he / she want to open
            var moduleName = $(object).text().trim();
            $.ajax({
              url: "editDefaultOpener.php?webAppName=" + moduleName + "&ext=" + ext,
            }).done(function(e) {
              if (e.includes("DONE")){
                  if (filepath == "NULL"){
                      //If the opener is in ext mode, just return nothing.
                      ao_module_parentCallback({newModule:moduleName});
                      window.location.href="../killProcess.php";
                      return;
                  }
                  if (ao_module_virtualDesktop){
                    newfw($("#fwonly")[0]);
                    window.location.href="../killProcess.php";
                  }else{
                    newtab($("#newtab")[0]);
                  }
                  
              }else{
                  alert("ERROR. Something wrong happened. Please restart your browser and try again.");
              }
            });
        }
        
        function cancelSelection(){
            ao_module_close();
        }

	</script>
</body>
</html>