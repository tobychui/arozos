/*
    ui.js

    Window layout, sidebar toggles, theme, toast messages and popup chrome.

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

//Preference setting and loading functions.
function setPreference(key, value){
    $.ajax({
        url:"../../system/file_system/preference?key=" + key + "&value=" + value,
        success: function(data){
            if (data.error !== undefined){
            }
        }
    });
}

function loadPreference(key, callback){
    $.get("../../system/file_system/preference?key=" + key,function(data){
        callback(data);
    });
}

// ============================== WINDOW RESIZE FUNCTIONS =====================
$(window).on("resize",function(){
    initWindowSizes(false);
    if (!isMobile && window.innerWidth < 620 && sideBarShown == true){
        toggleSidebar(false);
    }else if (!isMobile && window.innerWidth > 650 && sideBarShown == false){
        toggleSidebar(false);
    }

    //Resize the share iframe
    resizeShareIframe()

    //Resize the path display content
    if (!pathInputMode){
        updatePathDisplay(currentPath);
    }
    
});

function toggleMobileSidebar(show=undefined, callback=undefined){
    if(show == true){
        $("#mobileNaviBar").stop().finish().show();
    }else if (show == false){
        $("#mobileNaviBar").stop().finish().hide();
    }else{
        $("#mobileNaviBar").toggle();
    }

    if (callback != undefined){
        setTimeout(callback, 300);
    }
}

function toggleSidebar(useAnimation=true){
    //Fixing desktop bugs on showing the sidebar
    if (isMobile){
        if (sideBarShown){
            $("#directorySidebar").hide();
        }else{
            $("#directorySidebar").show();
        }
        
    }else{
        if (sideBarShown){
            $("#directorySidebar").stop().finish().transition("slide right out", function(){
                $("#directorySidebar").hide();
            });
        }else{
            $("#directorySidebar").stop().finish().transition("slide right in", function(){
                $("#directorySidebar").show();
            });
        }
    }
    
    sideBarShown = !sideBarShown;
    initWindowSizes(useAnimation);
}

function initWindowSizes(animate=true){
    var h = $("#navibar").css("height");
    var hint = $("#navibar").height();
    var windowHeight = window.innerHeight - hint - 12;
    if (sideBarShown){
        //Resize the sidebar 
        $("#directorySidebar").css("top",h);
        $("#directorySidebar").css("width",directorySidebarWidth);
        $("#directorySidebar").css("height",windowHeight + "px");
        //Resize the file viewer
        $("#folderView").css("top",h);
        $("#folderView").css("height",windowHeight + "px");
    }else{
        $("#folderView").css("top",h);
        if (animate){
            $("#folderView").stop().finish().animate({
                left:'0px',
                width:(window.innerWidth - 2 + "px")
            },200);
        }else{
            $("#folderView").css({
                left:'0px',
                width:(window.innerWidth - 2 + "px")
            });
        }
        $("#folderView").css("height",windowHeight + "px");
    }

    $("#propertiesView").css("height", windowHeight + "px");
}

function toggleDarkTheme(){
    if ($(".darkTheme").length > 0){
        //Set To whiteTheme
        $("body").removeClass("darkTheme").addClass("whiteTheme");
        currentTheme = "whiteTheme";
        $("#darkthemebtn").attr("class","moon icon");
        $("#darkthemebtn").parent().addClass("inverted");
        $(".dropdown").removeClass("inverted");
        setPreference("file_explorer/theme","whiteTheme");
        $("#mobileNaviBar").removeClass("inverted");
        $("#darkthemebtn").css("color", "#dadada");

        //If in vdi mode, update desktop's listMenu as well
        if (ao_module_virtualDesktop){
            parent.initTheme("whiteTheme");
        } else {
            // Standalone: notify other open tabs via localStorage
            try { localStorage.setItem('ao_system_theme', JSON.stringify({theme: 'light', ts: Date.now()})); } catch(e) {}
        }
    }else{
        //Set to DarkTheme
        $("body").removeClass("whiteTheme").addClass("darkTheme");
        currentTheme = "darkTheme";
        $("#darkthemebtn").attr("class","sun icon");
        $("#darkthemebtn").parent().removeClass("inverted");
        $("#darkthemebtn").css("color", "#3d3f47");
        $(".dropdown").addClass("inverted");
        setPreference("file_explorer/theme","darkTheme");
        $("#mobileNaviBar").addClass("inverted");

            //If in vdi mode, update desktop's listMenu as well
            if (ao_module_virtualDesktop){
            parent.initTheme("darkTheme");
        } else {
            // Standalone: notify other open tabs via localStorage
            try { localStorage.setItem('ao_system_theme', JSON.stringify({theme: 'dark', ts: Date.now()})); } catch(e) {}
        }
    }

}

function msgbox(icon, text, delay=3000){
    $($(".msgbox").find("span")[0]).text(text);
    $($(".msgbox").find("i")[0]).attr("class", icon + " icon");
    $(".msgbox").stop().finish().slideDown('fast').delay(delay).slideUp('fast', function(){
        initWindowSizes(false);
    });
}

    

$(".popupWrapper").on("click",function(){
    hideAllPopupWindows();
});

function hideAllPopupWindows(){
    $(".popup:visible").transition('slide left out');
    $(".popupWrapper").fadeOut(100);
    $('body').css("overflow","");
    if($("#shareFile").is(":visible")){
        $("#shareFileEmbedded").attr("src", "");
    }
}

function showPopupWrapper(){
    $(".popupWrapper").fadeIn('fast');
    $('body').css("overflow","hidden");
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.hideAllPopupWindows = hideAllPopupWindows;
window.toggleDarkTheme = toggleDarkTheme;
window.toggleMobileSidebar = toggleMobileSidebar;
window.toggleSidebar = toggleSidebar;


/* ---------------------------------------------------------------------- */
/*  Toolbar overflow menu                                                  */
/* ---------------------------------------------------------------------- */
/*
    Holds everything the old icon strip used to carry. Per-item actions live in
    the right click menu; this is the rest.
*/
function toggleFileOprMenu(event){
    if (event != undefined){
        event.stopPropagation();
    }
    if ($("#fmMoreMenu").hasClass("open")){
        closeFileOprMenu();
    }else{
        $("#fmMoreMenu").addClass("open");
        $("#fmMoreBtn").addClass("active");
    }
}

function closeFileOprMenu(){
    $("#fmMoreMenu").removeClass("open");
    $("#fmMoreBtn").removeClass("active");
}

//Run a menu action and dismiss the menu
function runFileOpr(fn){
    closeFileOprMenu();
    if (typeof fn === "function"){
        fn();
    }
}

$(document).on("click", function(event){
    if ($(event.target).closest("#fmMoreMenu, #fmMoreBtn").length == 0){
        closeFileOprMenu();
    }
});
