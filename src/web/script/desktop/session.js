/*
    ArozOS Desktop - Session, host and accounts

    Connection checks, the signed in user and host information, startup
    sound, logout, restart / shutdown and the stored alternative accounts
    shown in the quick access panel.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function handleManualCheckReconnect(button){
    $(button).addClass("loading");
    checkConnection(undefined, function(status){
        let oldText = $(button).text();
        $(button).removeClass("loading");
        if (status == false){
            //Still unable to connect. Show cross icon
            $(button).html(`<i class="remove icon"></i>`);
            setTimeout(function(){
                //Restore its original text after 5 sec
                $(button).text(oldText);
            }, 5000);
        }
    });
}

function checkConnection(timeout=15000, callback=undefined){
    $.ajax({
        url: 'system/auth/checkLogin',
        success: function(data) {
            if (data == true) {
                //Continue session
                updateBackgroundgTaskList();

            } else {
                //Session timeout. Redirect to system index
                loggingOut = true;
                window.location.href = "index.html";
            }
            $("#connectionLost").hide();
            document.title = hostInfo.Hostname;
            if (callback != undefined){
                callback(true);
            }
        },
        error: function(evt) {
            //Server closed or freezed?
            $("#connectionLost").show();
            document.title = "Reconnecting...";
            if (callback != undefined){
                callback(false);
            }
        },
        timeout: timeout
    });
}

function initStartupSounds(){
    $.ajax({
        url: "system/desktop/preference",
        method: "POST",
        data: {preference: "startup-audio"},
        success: function(data){
            if (data == undefined || data == ""){
                return;
            }
            var currentGlobalVol = localStorage.getItem("global_volume");
            if (currentGlobalVol != null && currentGlobalVol != undefined && currentGlobalVol != ""){

            }else{
                currentGlobalVol = 0;
            }

            var audio = new Audio("media?file=" + data);
            audio.volume = currentGlobalVol;
            audio.play();
        }
    });
}

function initDesktopUserInfo(callback=undefined){
    $.get("system/desktop/user", function(data){
        if (data.error !== undefined){
            alert(data.error);
        }else{
            userInfo = data;
            listAllStoredAccounts();

            //Update the user tag
            $("#username").text(userInfo.Username);
            $("#usergroups").text("@" + userInfo.UserGroups.join("/"));
            $("#usergroups").attr("title",userInfo.UserGroups.join(" / "));
            if (data.UserIcon !== ""){
                $(".usericon").attr("src",data.UserIcon);
            }else{
                $(".usericon").attr("src", "img/desktop/system_icon/user.svg")
            }

            if (data.IsAdmin == false){
                //Hide the power buttons
                $(".hardware").hide();
            }else{
                //User is admin. Add admin icon
                $("#username").append(`<i style="margin-left: 0.4em; color: #${desktopThemeColor}" class="small shield alternate icon themed text"></i>`);
            }

            if (callback != undefined){
                callback();
            }
        }
    });
}

function initDesktopHostInfo(){
    //Load the data into variable
    $.get("system/desktop/host",function(data){
        hostInfo = data;

        //Update the ui element as well
        $(".hostname").text(hostInfo.Hostname);
        document.title = hostInfo.Hostname;
        $("#sysinfo").text(hostInfo.DeviceModel + " firmware:" + hostInfo.BuildVersion + " " + hostInfo.InternalVersion);
        qaRenderFacts();
    });

    //Volume and brightness are kept in localStorage (0 to 1), which WebApps
    //read too; the quick access sliders show and change them (quickaccess.js)
    if (localStorage.getItem("global_volume") == null || localStorage.getItem("global_volume") === ""){
        localStorage.setItem("global_volume", 0);
    }
    if (localStorage.getItem("brightness") == null || localStorage.getItem("brightness") === ""){
        localStorage.setItem("brightness", 1);
    }
    qaSyncSliders();


    //Check if hardware management mode is enabled. Hide buttons if needed
    $.get("system/power/accessCheck",function(data){
        if (data == true){
            //Hardware management mode is on
            powerman = true;
        }else{
            //Hardware management mode is off
            $(".item.powerman").remove();
            powerman = false;
        }   
    });


}

function logout() {
    loggingOut = true;
    if (confirm("Exiting Session. Confirm?")){
        $.get("system/auth/logout", function() {
            window.location.href = "./";
        });
    }
    hideAllContextMenus();
}

function openSwitchAccountPanel(){
    var uuid = newFloatWindow({
        url: 'SystemAO/advance/switchAccount.html',
        width: 470,
        height: 680,
        appicon: "SystemAO/desktop/img/account-switch.png",
        title: "Switch Account"
    });
}

function restart(){
    if (!powerman){
        return
    }
    var apiObject = {
        api: "/system/power/restart",
        data: {},
        title: applocale.getString("power/restart/text", "Password Required"),
        desc: applocale.getString("power/restart/instruction", "for restarting the ArozOS Host"),
        thisuser: true, //This username as default, set to false for entering other user
        method: "GET"
    }

    apiObject = encodeURIComponent(JSON.stringify(apiObject));
    newFloatWindow({
        url: "SystemAO/security/authreq.html#" + apiObject,
        width: 480,
        height: 300,
        appicon: "SystemAO/security/img/lock.svg",
        title: applocale.getString("power/restart/title", "Restart - Authentication Required"),
        parent: ao_module_windowID,
        callback: "handleRestartCallback"
    });
}

function shutdown(){
    if (!powerman){
        return
    }

    var apiObject = {
        api: "system/power/shutdown",
        data: {},
        title: `<i class='red exclamation triangle icon'></i> ${applocale.getString("power/shutdown/text", "Shutdown Host")} <i class='red exclamation triangle icon'></i>`,
        desc: applocale.getString("power/shutdown/instruction", "Please enter your password to confirm operation."),
        thisuser: true, //This username as default, set to false for entering other user
        method: "GET",
        success: "SystemAO/boot/shutdown.html" //Success redirection
    }
    apiObject = encodeURIComponent(JSON.stringify(apiObject));

    newFloatWindow({
        url: "SystemAO/security/authreq.html#" + apiObject,
        width: 480,
        height: 300,
        appicon: "SystemAO/security/img/lock.svg",
        title: applocale.getString("power/shutdown/title", "Shutdown - Authentication Required"),
        parent: ao_module_windowID,
        callback: "handleShutdownCallback"
    });

}

/*
    Alternative account manager
*/
/*
    The other accounts signed in on this browser, listed in the launcher's
    account panel (#alternativeAccountList). A row switches to its account
    (switchAccount); an expired session opens the sign in window instead.
    Avatars use their own class: initDesktopUserInfo sets every .usericon to
    the signed in user's picture.
*/
function listAllStoredAccounts(){
    var list = $("#alternativeAccountList");
    list.empty();
    var showNone = function(){
        list.empty().append($('<div class="accountEmpty"></div>').text(applocale.getString("account/switch/noAlternative", "No other account stored on this browser")));
        $("#signoutAllButton").addClass("disabled");
    };
    //Request server side for the account pool
    $.get("system/auth/u/list", function(data){
        if (data.error != undefined || !Array.isArray(data) || data.length <= 1){
            showNone();
            return;
        }
        $("#signoutAllButton").removeClass("disabled");
        data.forEach(function(account){
            if (account.Username == userInfo.Username){
                //Skip
                return;
            }
            var row = $('<div class="accountRow alternativeAccount" onclick="switchAccount(this);">' +
                '<img class="accountAvatar" draggable="false"><div class="accountRowText">' +
                '<div class="accountRowName"></div><div class="accountRowState"></div></div></div>');
            row.attr("acname", account.Username).toggleClass("expired", account.IsExpired === true);
            row.find(".accountAvatar").attr("src", "img/desktop/system_icon/user.svg");
            row.find(".accountRowName").text(account.Username);
            row.find(".accountRowState").text(account.IsExpired ?
                applocale.getString("account/switch/sessionExpired", "Session Expired") :
                applocale.getString("account/switch/sessionValid", "Session Valid"));
            list.append(row);
            $.get("system/desktop/user?target=" + encodeURIComponent(account.Username), function(info){
                if (info && info.UserIcon){
                    row.find(".accountAvatar").attr("src", info.UserIcon);
                }
                if (info && info.IsAdmin){
                    row.find(".accountRowName").append($('<i class="shield alternate icon"></i>').attr("title", "Admin"));
                }
            });
        });
        if (list.children().length == 0){
            showNone();
        }
    });
}

function switchAccount(object){
    let targetUsername = $(object).attr("acname");
    if (targetUsername == undefined || targetUsername == ""){
        console.log("Unable to load username from element")
        return;
    }

    //Check if it is expired
    if ($(object).hasClass("expired")){
        openSwitchAccountPanel();
        return;
    }

    //Close all floatWindows
    $(".floatWindow").each(function(){
        let thisFloatWindowID = $(this).attr("windowid");
        closeFloatWindowViaID(thisFloatWindowID);
    })

    $.ajax({
        url: "system/auth/u/switch",
        data: {
            "username": targetUsername,
        },
        success: function(data){
            if (data.error != undefined){
                alert(data.error);
            }else{
                initDesktop();
            }
        }
    })
}

function logoutAllAccounts(){
    if (confirm(applocale.getString("account/switch/logout/confirm", "This will logout all other accounts from this browser. Confirm?"))){
        $.ajax({
            url: "system/auth/u/logoutAll",
            success: function(data){
                if (data.error != undefined){
                    alert(data.error);
                }else{
                    //Reset the browser pool id
                    localStorage.removeItem("ao_acc");
                    listAllStoredAccounts();
                    hideToolPanel();
                }
            }
        })
    }
}
