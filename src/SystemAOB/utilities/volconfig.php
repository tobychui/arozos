<?php
include_once("../../auth.php");

//Audio setting tools for ArOZ Online System
//Include Audio Channel testing and global volume settings

//If you are module developer, please consider listening global_volume value from localStorage 
//So your module can support master volume * local volume for more fine adjustment tuning
?>
<html>
    <head>
        <title>ArOZ Online Audio Tools</title>
        <link rel="stylesheet" href="../../script/tocas/tocas.css">
    	<script src="../../script/tocas/tocas.js"></script>
    	<script src="../../script/jquery.min.js"></script>
    	<script src="../../script/ao_module.js"></script>
    	<style>
    	    body{
    	        background-color:#f0f0f0;
    	    }
    	    .flip{
    	        -moz-transform: scale(-1, 1);
                -webkit-transform: scale(-1, 1);
                -o-transform: scale(-1, 1);
                -ms-transform: scale(-1, 1);
                transform: scale(-1, 1);
    	    }
    	    .selectable{
    	        padding:15px !important;
    	        border: 1px solid transparent;
    	        border-radius: 10px;
    	    }
    	    .selectable:hover{
    	        border: 1px solid #3d6eff;
    	        background-color:#ccd9ff;
    	        cursor: pointer;
    	    }
    	</style>
    </head>
    <body>
        <div class="ts raised segment" align="center">
            <p>System Audio Settings</p>
        </div>
        <div class="ts container">
            <div class="ts grid">
                <div class="five wide column selectable" align="center" onClick="PlaySound('left');"><i class="volume up huge icon flip"></i><br>Left Speaker</div>
                <div class="six wide column selectable" align="center" onClick="PlaySound('both');"><i class="computer huge icon"></i><br>Speaker Test</div>
                <div class="five wide column selectable" align="center" onClick="PlaySound('right');"><i class="volume up huge icon"></i><br>Right Speaker</div>
            </div> 
            <br>
            <div class="ts raised segment">
                <div class="ts horizontal divider">Master Volume</div>
                <div class="ts slider">
                    <input id="gblvol" min="0" max="100" type="range" value="0">
                    <div id="numdis" class="ts basic left pointing label">0%</div>
                </div>
                <small style="font-size:70%;">Some modules use stand-alone volume management system. Master volume may not be able to control all module's volume.</small>
            </div>
            <div style="display:none;">
                <audio id="both" controls><source src="sound/audiconfig_both.mp3" type="audio/mp3"></audio>
                <audio id="left" controls><source src="sound/audiconfig_left.mp3" type="audio/mp3"></audio>
                <audio id="right" controls><source src="sound/audiconfig_right.mp3" type="audio/mp3"></audio>
            </div>
        </div>
        <script>
             if (parent.document.title.includes("System Setting") == false){
                 ao_module_setGlassEffectMode();
                   ao_module_setWindowIcon("volume up");
                   ao_module_setWindowTitle("Audio Settings");
                   ao_module_setWindowSize(550,380);
                   ao_module_setFixedWindowSize();
             }else{
                 $("body").css("padding","15px");
             }
           getGlobalVol();
           setInterval(getGlobalVol,1000);
            function getGlobalVol(){
               var vol = localStorage.getItem("global_volume");
               if (vol == undefined || vol == ""){
                   vol = 0;
                   localStorage.setItem("global_volume",0);
               }
               $("audio").prop("volume", parseFloat(vol));
               vol = parseFloat(vol) * 100; //Back to 0 - 100 scale
               vol = vol.toFixed(0);
               $("#gblvol").attr("value",vol);
               $("#numdis").html(vol + "%")
               
            }
            
            var b = document.getElementById("both");
            var l = document.getElementById("left");
            var r = document.getElementById("right");

            function PlaySound(keyword){
                resetAllSoundTracks();
                if (keyword == "both"){
                    b.play();
                }else if (keyword == "left"){
                    l.play();
                }else{
                    r.play();
                }
            }
            
            function resetAllSoundTracks(){
                b.pause();
                b.currentTime = 0;
                l.pause();
                l.currentTime = 0;
                r.pause();
                r.currentTime = 0;
            }
           
           $('input[type=range]').on('input', function () {
                $(this).trigger('change');
                var newval = ($(this).val());
                $("#numdis").html(newval + "%");
                newval = (newval / 100).toFixed(2);
                localStorage.setItem("global_volume",newval);
           });
        </script>
    </body>
</html>