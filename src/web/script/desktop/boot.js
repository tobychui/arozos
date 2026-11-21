/*
    ArozOS Desktop - Desktop startup

    Loaded last: loads the desktop locale, then runs initDesktop. Every
    other desktop script only declares functions and binds events, so the
    start must wait until all of them are loaded.

    The first background task listing is requested here, right after the
    locale request, so the locale is normally in by the time the (empty)
    task panel is drawn, as it was when all of this was one inline script.

    Part of desktop.html, see README.md in this folder for the load order.
*/

//Check and prepare localization
if (typeof(applocale) != "undefined"){
    //Applocale found. Do localization
    applocale.init("./SystemAO/locale/desktop.json", function(){
        applocale.translate();
        initDesktop();
    });
}else{
    //Applocale not found. Is this a trim down version of ArozOS?
    var applocale = {
        getString: function(key, original){
            return original;
        }
    }
    initDesktop();
}


function initDesktop(){
    //Fetch module-registered extension icons once so the desktop can use them
    $.get("system/modules/exticons", function(data) {
        if (typeof data === "string") { try { data = JSON.parse(data); } catch(e) {} }
        if (data && typeof data === "object") { extIconRegistry = data; }
    });

    //Initiation functions
    initDesktopTheme();
    initDesktopHostInfo();
    initDesktopUserInfo();
    initBackgroundSwitchingAnimation();
    //Commented for debug purpose
    initUploadMode();
    initModuleList();
    initDesktopIconPreference()
    initUserDefinedThemeColor();
    initAssistiveAccess();
    initStartMenuLayout();
    hookFloatWindowEvents();
    hookLaunchMenuEvents();
    initTheme();
    initStartupSounds();
    initUploadCuttoffValues();
    initFrameLoading();
    dockInit();

    //Login cookie expire check
    setInterval(function() {
        checkConnection();
    }, 120 * 1000);

    //Activate all dropdowns
    $(".dropdown").dropdown();
}
updateBackgroundgTaskList();
