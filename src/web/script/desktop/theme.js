/*
    ArozOS Desktop - Light / dark theme and theme colour

    The light and dark desktop theme (shared with File Manager), the user
    defined theme colour and the assistive access window title glow.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function initTheme(targetTheme=undefined){
    if (targetTheme == undefined){
        $.get("system/file_system/preference?key=file_explorer/theme", function(data){
            if (data == "darkTheme"){
                setDarkTheme();
            }else{
                setWhiteTheme();
            }
        });
    }else{
        //Manual override mode
        if (targetTheme == "darkTheme"){
            setDarkTheme();
        }else if (targetTheme == "whiteTheme"){
            setWhiteTheme();
        }
    }

}

function setDarkTheme(){
    $("body").removeClass("whiteTheme").addClass("darkTheme");
    $("#powerIcon").attr("src","img/system/power-white.svg");
    updateThemeToggleBtn();
    broadcastDesktopThemeChange("dark");
}

function setWhiteTheme(){
    $("body").removeClass("darkTheme").addClass("whiteTheme");
    $("#powerIcon").attr("src","img/system/power.svg");
    updateThemeToggleBtn();
    broadcastDesktopThemeChange("light");
}

function broadcastDesktopThemeChange(theme){
    $(".floatWindow iframe").each(function(){
        try {
            var fw = this.contentWindow;
            if (fw && typeof fw.desktopThemeChanged === "function"){
                fw.desktopThemeChanged(theme);
            }
        } catch(e) {}
    });
    // Notify standalone browser tabs that have called ao_module_onThemeChanged
    try {
        localStorage.setItem('ao_system_theme', JSON.stringify({theme: theme, ts: Date.now()}));
    } catch(e) {}
}

function toggleDesktopTheme(){
    if ($("body").hasClass("darkTheme")){
        setWhiteTheme();
        $.get("system/file_system/preference?key=file_explorer/theme&value=whiteTheme");
    }else{
        setDarkTheme();
        $.get("system/file_system/preference?key=file_explorer/theme&value=darkTheme");
    }
}

//The Dark Mode tile of the quick access panel is lit while the dark theme is on
function updateThemeToggleBtn(){
    var isDark = $("body").hasClass("darkTheme");
    $("#themeToggleBtn").toggleClass("active", isDark).attr("aria-pressed", isDark ? "true" : "false");
}

function setThemeColor(newThemeColor){
    //Update the global theme color
    desktopThemeColor = newThemeColor;

    //Update the related elements
    $("#statusbar").css("background-color",hexToRgbA(newThemeColor, 0.8));
    $("#navimenu, #dockTray").css("background-color",hexToRgbA(newThemeColor, 0.5));
    document.body.style.setProperty("--dt-accent", newThemeColor);
    //The tinted dock and tray use light text, as the old taskbar did (dock.css)
    $("body").addClass("themeTinted");

    var themeColorForBoarders = hexToRgbA(newThemeColor, 0.25);
    $(".floatWindow .controls").css("background-color",themeColorForBoarders);
    $(".floatWindow .iframewrapper").css({
        "border-left":"3px solid " + themeColorForBoarders,
        "border-right":"3px solid " + themeColorForBoarders,
        "border-bottom":"3px solid " + themeColorForBoarders,
    });

    $(".themed.text").css("color", newThemeColor);

    //Connection lost notification css
    $("#connectionLost").find(".ui.card").css("background-color", hexToRgbA(newThemeColor, 0.5));
}

/*
    Back to the default look, undoing everything setThemeColor painted:
    no tint on the dock and tray, the default accent, untinted windows.
    System Settings calls it after "Restore Default" removed the saved
    colour, so the desktop changes without a reload.
*/
function resetThemeColor(){
    desktopThemeColor = "";
    $("#statusbar, #navimenu, #dockTray").css("background-color", "");
    document.body.style.removeProperty("--dt-accent");
    $("body").removeClass("themeTinted");

    $(".floatWindow .controls").css("background-color", "");
    $(".floatWindow .iframewrapper").css({
        "border-left": "",
        "border-right": "",
        "border-bottom": "",
        "backdrop-filter": ""
    });

    $(".themed.text").css("color", "");
    $("#connectionLost").find(".ui.card").css("background-color", "rgba(14,14,14,0.5)");
}

//Load the user define theme color to overwrite the default color if exists
function initUserDefinedThemeColor(){
    $.ajax({
        url: "system/desktop/preference",
        data: {preference: "themecolor"},
        method: "POST",
        success: function(data){
            if (data.error == undefined && data != ""){
                setThemeColor(data);
            }
        }
    });
}

/*
    Assistive access (System Settings > Desktop & Themes > Assistive Access)

    Readable window titles: a body class that ao.css keys the title
    glow on. Off unless the user turned it on. The settings page calls
    setAssistiveTitles directly when it runs inside this desktop, and
    announces every write on localStorage so a desktop in another tab
    follows too.
*/
const ASSISTIVE_TITLES_PREF = "assistive-titles";

function setAssistiveTitles(enabled){
    $("body").toggleClass("assistiveTitles", enabled === true);
}

function initAssistiveAccess(){
    $.ajax({
        url: "system/desktop/preference",
        data: {preference: ASSISTIVE_TITLES_PREF},
        method: "POST",
        success: function(data){
            setAssistiveTitles(data === "true");
        }
    });

    window.addEventListener("storage", function(e){
        if (e.key !== "desktop/assistiveChanged" || !e.newValue){
            return;
        }
        try {
            let change = JSON.parse(e.newValue);
            if (change.key === ASSISTIVE_TITLES_PREF){
                setAssistiveTitles(change.value === "true");
            }
        } catch (err) {}
    });
}
