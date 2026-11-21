/*
    ArozOS Desktop - Quick access panel

    The quick access panel opened from the taskbar: show / hide, the
    disk and system overview frames, volume, brightness and full screen.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function initFrameLoading(){
    //Load desktop utilities into suitable positions
    $("#diskoverview").load("SystemAO/desktop/utils/diskoverview.html");
    $("#sysoverview").load("SystemAO/desktop/utils/sysoverview.html");
}

function showToolPanel(){
    if (listMenuShown = true){
        hideListMenu();
    }
    updateThemeToggleBtn();
    $("#quickAccessPanel").fadeToggle("fast");
}
function hideToolPanel(){
    $("#quickAccessPanel").fadeOut("fast");
}


document.getElementById("volumebar").parentNode.addEventListener("touchstart", function(e){
    updateVolume( document.getElementById("volumebar").parentNode, e);
});

document.getElementById("brightnessbar").parentNode.addEventListener("touchstart", function(e){
    updateBrightness( document.getElementById("brightnessbar").parentNode, e);
});

function updateVolume(object, event){
    var width = $(object).width();
    var left = $(object).offset().left;
    var clickPosition = getCoordinateFromEvent(event)[0];
    var clickRel = clickPosition - left;
    var percentage = clickRel / width * 100;
    if (percentage < 0){
        percentage = 0;
    }else if (percentage > 100){
        percentage = 100;
    }
    //Update the global volume
    $(object).find(".bar").css("width",percentage + "%");
    localStorage.setItem("global_volume", clickRel / width);
}

//Update screen brightness, for those who use ArozOS on their TV
function updateBrightness(object, event){
    var width = $(object).width();
    var left = $(object).offset().left;
    var clickPosition = getCoordinateFromEvent(event)[0];
    var clickRel = clickPosition - left;
    var percentage = clickRel / width * 100;
    if (percentage < 0){
        percentage = 0;
    }else if (percentage > 100){
        percentage = 100;
    }

    //Min is 3%
    if (percentage < 3){
        percentage = 3;
    }

    //Set body brightness filter
    $("body").css("filter", `brightness(${percentage}%)`);

    //Save changes to localStorage
    currentBrightness = percentage;
    $(object).find(".bar").css("width",percentage + "%");
    localStorage.setItem("brightness", clickRel / width);
}

function fullscreen() {
    //Opening full screen will lead to hidden of all iframe for unknown reasons
    var isInFullScreen = (document.fullscreenElement && document.fullscreenElement !== null) ||
        (document.webkitFullscreenElement && document.webkitFullscreenElement !== null) ||
        (document.mozFullScreenElement && document.mozFullScreenElement !== null) ||
        (document.msFullscreenElement && document.msFullscreenElement !== null);
    var elem = document.documentElement;
    if (!isInFullScreen) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.mozRequestFullScreen) { /* Firefox */
            elem.mozRequestFullScreen();
        } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
            elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) { /* IE/Edge */
            elem.msRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }

    hideAllContextMenus();
}
