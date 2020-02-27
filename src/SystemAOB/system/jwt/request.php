<?php
include_once("../../../auth.php");
include_once("../../functions/personalization/configIO.php");
$configs = getConfig("login",true);
$iconPath = "../../../" . $configs['title-image'][3];
$themeColor = $configs['theme-color'][3];
$module = "Unknown Module";
if (isset($_GET['module']) && !empty($_GET['module'])){
    $module = $_GET['module'];
    if (!file_exists("../../../" . $_GET['module'])){
        die("ERROR. Module not exists.");
    }
}else{
    die("ERROR. Unset module name.");
}
?>
<html>
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="../../../script/tocas/tocas.css">
        <script type='text/javascript' src="../../../script/tocas/tocas.js"></script>
        <script src="../../../script/jquery.min.js"></script>
        <title>ShadowJWT</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <style>
            body{
                padding:10px;
                overflow:hidden;
            }
        </style>
    </head>
    <body>
    <div class="ts segment" style="height:100%; padding:40px; background-color:white;">
       <img class="ts image" style="width:250px; margin-bottom:15px;" src="<?php echo $iconPath; ?>"></img>
       <h3 style="margin-bottom:-10px;">JWT Authentication</h3>
       <p>to continue with module <a  style="cursor:pointer;"> <?php echo $module; ?></a></p>
       <br>
       <p>Using an existsing token: </p>
       <div class="ts fluid input">
            <textarea id="tokenString" placeholder="JWT Token String (Leave empty for auto generate)" rows=5></textarea>
        </div>
        <p>or Generate a new token: </p>
        <div class="ts labeled fluid action input">
            <div class="ts basic label">+</div>
            <input id="expireTime" type="number" min="-1" placeholder="Expire time in seconds (-1 for not expire)">
            <button class="ts button" onClick="generateJWT();">Generate</button>
        </div>
        <br><br>
        <a style="cursor:pointer;">Why I am seeing this?</a>
        <div id="msgbox" class="ts inverted negative segment" style="display:none;">
            <p class="textholder"></p>
        </div>

        <div style="width:100%; position:absolute;bottom:20px;left:0px;padding:20px;" align="right">
            <button class="ts button" onClick="cancel();">Cancel</button>
            <button class="ts primary button" onClick="confirm();">Confirm</button>
        </div>
    </div>
    <div style="display:none;">
            <div id="data_targetModule"><?php echo $module; ?></div>
    </div>
    <script>
    var targetModule = $("#data_targetModule").text().trim();

    function generateJWT(reloadAfterGen = false, saveAfterGen = false){
        var expireTime = $("#expireTime").val();
        if (expireTime == ""){
            //If expireTime is not set, put it -1 (forever)
            $("#expireTime").val("-1");
            expireTime = -1;
        }
        var url = "create.php?exp=" + expireTime;
        if (saveAfterGen){
            var url = "create.php?exp=" + expireTime + "&module=" + targetModule;
        }
        $.get(url,function(data){
            console.log("Token generated: " + data.token);
            $("#tokenString").val(data.token)

            if (reloadAfterGen){
                parent.window.location.reload();
            }
        });
    }

    function cancel(){
        parent.window.wsAuthFailedCallback();
        parent.$("#system_jwtauth_ui_dimmer").fadeOut('fast',function(){
            $(this).remove();
        });
        parent.$("#system_jwtauth_ui_iframe").fadeOut('fast',function(){
            $(this).remove();
		});
    }

    function confirm(){
        if ($("#tokenString").val() == ""){
            //Nothing exists yet. Generate a new token
            generateJWT(true,true);
        }else{
            //Given a token manually. Validate it and put it to file if valid.
            var token = $("#tokenString").val();
            $.get("validate.php?token=" + token,function(data){
                if (data["error"] === undefined && data["discarded"] !== true){
                    //This token is valid
                    $("#tokenString").parent().removeClass("error").addClass("success");
                    $.post("storeToken.php", {"module": targetModule, "token": token}).done(function(data){
                        if (data.includes("ERROR")){
                            $("#msgbox").find(".textholder").text("Error while trying to store token. (" + data + ")");
                            console.log(data);
                        }
                        //Reload the page
                        parent.window.location.reload();
                    });
                }else{
                    //This token is not valid
                    console.log("[JWT Auth] ERROR. Token not valid.");
                    $("#msgbox").finish().stop().fadeIn('fast').delay(3000).fadeOut('fast');
                    $("#tokenString").parent().addClass("error");
                    if (data["error"] === undefined){
                        $("#msgbox").find(".textholder").text("Invalid Token. Given token has been discarded.");
                    }else{
                        $("#msgbox").find(".textholder").text("Invalid Token. " + data.error + ".");
                    }
                    
                }
            });

        }
    }
    </script>
    </body>
</html>