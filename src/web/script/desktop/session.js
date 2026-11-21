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
    });

    //Setup volume bar
    var currentGlobalVol = localStorage.getItem("global_volume");
    if (currentGlobalVol != null && currentGlobalVol != undefined && currentGlobalVol != ""){
        $("#volumebar").css("width", currentGlobalVol * 100 + "%");
    }else{
        currentGlobalVol = 0;
        localStorage.setItem("global_volume",currentGlobalVol);
    }

    //Setup brightness
    var currentBrightness = localStorage.getItem("brightness");
    if (currentBrightness != null && currentBrightness != undefined && currentBrightness != ""){
        $("#brightnessbar").css("width", currentBrightness * 100 + "%");
        $("body").css("filter", `brightness(${currentBrightness * 100}%)`);
    }else{
        currentBrightness = 1;
        localStorage.setItem("brightness",currentBrightness);
    }


    //Check if hardware management mode is enabled. Hide buttons if needed
    $.get("system/power/accessCheck",function(data){
        if (data == true){
            //Hardware management mode is on
            powerman = true;
        }else{
            //Hardware management mode is off
            $(".item.powerman, .qap-btn.powerman").remove();
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
function listAllStoredAccounts(){
    $("#alternativeAccountList").empty();
    //Request server side for the account pool
    $.get("system/auth/u/list", function(data){
        if (data.error != undefined){
            $("#alternativeAccountList").append(`<div style="padding: 0.4em; padding-left: 1em; padding-right: 1em;">
                    <i class="ui green check circle icon"></i> ${applocale.getString("account/switch/noAlternative", "No other account stored on this browser")}
            </div>`);
            $("#signoutAllButton").addClass('disabled');
        }else{
            if (data.length > 1){
                data.forEach(function(account){
                    if (account.Username == userInfo.Username){
                        //Skip
                        return;
                    }
                    $.get("system/desktop/user?target=" + account.Username, function(data){
                        let userIcon = data.UserIcon;
                        if (userIcon == ""){
                            userIcon = "img/desktop/system_icon/user.svg"
                        }
                        $("#alternativeAccountList").append(`
                            <div class="alternativeAccount item ${account.IsExpired?"expired":""}" acname="${account.Username}" onclick="switchAccount(this);">
                                <div class="ui header">
                                    <img class="usericon ui circular image" src="${userIcon}">
                                    <div class="content" style="font-size: 95% !important;">
                                        <span class="username">${account.Username}</span> ${(data.IsAdmin)?'<i style="margin-left: 0.4em; color: rgb(38, 50, 56);" title="Admin" class="small shield alternate icon themed text"></i>':""}
                                        <div class="sub header usergroup">${!account.IsExpired?"<i class='ui green check circle icon' style='margin-right: 0px;'></i> " + applocale.getString("account/switch/sessionValid", "Session Valid"):"<i class='ui red times circle icon' style='margin-right: 0px;'></i> " + applocale.getString("account/switch/sessionExpired", "Session Expired")}</div>
                                    </div>
                                </div>
                            </div>
                        `);
                    });
                });
                $("#signoutAllButton").removeClass('disabled');
            }else{
                $("#signoutAllButton").addClass('disabled');
                $("#alternativeAccountList").append(`<div style="padding: 0.4em; padding-left: 1em; padding-right: 1em;">
                    <i class="ui green check circle icon"></i> ${applocale.getString("account/switch/noAlternative", "No other account stored on this browser")}
                </div>`);
                return;
            }
        }
    })
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
