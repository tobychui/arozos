/*
    ArozOS Desktop - Wallpaper

    Desktop wallpaper themes and the background slideshow.

    Part of desktop.html, see README.md in this folder for the load order.
*/

//====================== DESKTOP THEME RELATED FUNCTIONS =====================

//Initiate desktop theme list and user current theme
function initDesktopTheme() {
    //Update 1 April 2021: Check if the user customize the desktop with the given path

    $.get("system/desktop/theme", function(data) {
        //Return a list of theme stored on the system
        desktopThemeList = data;
        $.get("system/desktop/theme?get=true", function(data) {
            //Get the user theme settings
            changeDesktopTheme(data);
        });
    });
}

function setDesktopTheme(themeName) {
    $.get("system/desktop/theme?set=" + themeName, function(data) {
        //Get the user theme settings
        changeDesktopTheme(themeName);
        if (data.includes("Error")) {
            console.log(data);
        }
    });
}

//Actiave background cross fade changing animation
function initBackgroundSwitchingAnimation() {
    if (localStorage.getItem("ao/desktop/backgroundInterval") !== null && !isNaN(parseInt(localStorage.getItem("ao/desktop/backgroundInterval")))){
        //Localstorage has interval setting that is not NaN
        backgroundCrossfadeInterval = parseInt(localStorage.getItem("ao/desktop/backgroundInterval")) * 1000;
    }
    if (backgroundIntervalCounter != undefined){
        clearInterval(backgroundIntervalCounter);
    }

    backgroundIntervalCounter = setInterval(function() {
        $("body").css("background-image", "none").css({
            'background-color': '#000000'
        });
        $(".showBackground").removeClass("showBackground");
        $($(".backgroundFrame")[nextSlideshowIndex]).addClass("showBackground");
        nextSlideshowIndex++;
        if (nextSlideshowIndex > currentBackgroundList.length - 1) {
            nextSlideshowIndex = 0;
        }
    }, backgroundCrossfadeInterval);
}

//Function for changing the desktop theme
function changeDesktopTheme(targetThemeName) {
    currentUserTheme = targetThemeName;

    if (currentUserTheme.includes(":/") == false){
        //This is default theme pack name
        for (var i = 0; i < desktopThemeList.length; i++) {
            var thisTheme = desktopThemeList[i];
            if (thisTheme["Theme"] == targetThemeName) {
                //Use this config as the target theme
                currentBackgroundList = thisTheme["Bglist"];
                break;
            }
        }
        //Initiate the background image.
        $("#bgwrapper").html("");
        for (var i = 0; i < currentBackgroundList.length; i++) {
            var id = "dbg" + i;
            var thisImage = "img/desktop/bg/" + currentUserTheme + "/" + currentBackgroundList[i];
            $("#bgwrapper").append('<img id="' + id + '" rel="preload" draggable="false" onclick="this.focus();" style="background-image:url(\'' + thisImage + '\');" class="backgroundFrame"></img>');
        }
        setTimeout(function() {
            $("#dbg0").addClass("showBackground");
        }, 300);

        if (currentBackgroundList.length == 1) {
            //There are only 1 background in this pack. Make the next slice be 0 as well.
            nextSlideshowIndex = 0;
        }else if (currentBackgroundList.length == 0){
            //Background no longer exists. Change to default
            changeDesktopTheme("default");
        } else {
            nextSlideshowIndex = 1;
        }
    }else{
        //This is user defined photo file
        $.get("system/desktop/theme?load=" + targetThemeName, function(data){
            if (data.error !== undefined){
                //The folder is gone. Use default instead
                console.log(data.error);
                changeDesktopTheme("default");
            }else{
                //OK! Load it
                currentBackgroundList = data;

                $("#bgwrapper").html("");
                for (var i = 0; i < currentBackgroundList.length; i++) {
                    var id = "dbg" + i;
                    var thisImage = "media/?file=" + currentBackgroundList[i];
                    $("#bgwrapper").append('<img id="' + id + '" rel="preload" draggable="false" style="background-image:url(\'' + thisImage + '\');" class="backgroundFrame"></img>');
                }
                setTimeout(function() {
                    $("#dbg0").addClass("showBackground");
                }, 300);

                if (currentBackgroundList.length == 1) {
                    //There are only 1 background in this pack. Make the next slice be 0 as well.
                    nextSlideshowIndex = 0;
                }else if (currentBackgroundList.length == 0){
                    //Background no longer exists. Change to default
                    changeDesktopTheme("default");
                } else {
                    nextSlideshowIndex = 1;
                }

            }
        });

    }

}

$("#bgwrapper").on("click", function(evt) {
    evt.preventDefault();
});
