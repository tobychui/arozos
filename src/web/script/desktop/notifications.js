/*
    ArozOS Desktop - Notifications

    The notification and calendar panel, desktop notifications sent by
    WebApps (sendNotification), server side notifications polled from
    /system/notification and the transient toasts / browser push messages.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function toggleNotification(action=undefined){
    if (typeof action == "undefined"){
        $(".notificationbar").stop().finish().fadeToggle("fast", function(){

        });
    }else{
        if (action == "hide"){
            $(".notificationbar").stop().finish().fadeOut("fast");
        }else if (action == "show"){
            $(".notificationbar").stop().finish().fadeIn("fast");
        }
    }
}

/*
    Notification and Notification bar related functions

    Usage:
    title -> The title of the notification
    content -> The content of the notification
    icon (optional) -> The icon of the notification
    windowOpenOption (optional) -> The window opening option for user onclick redirection
*/

function sendNotification(title, content, icon="info circle", windowOpenOption=null){
    if (content.length > 100){
        shortenContent = content.substring(0,100) + "...";
    }else{
        shortenContent = content;
    }
    onClickOpenWindowOption = encodeURIComponent(JSON.parse(windowOpenOption));
    $("#notificationlist").append(` <div class="notification object" originalcontent="${content}" redirect="${onClickOpenWindowOption}" onclick="openNotification(this);">
            <p class="title"><i class="${icon} icon"></i> ${title}</p>
            <p class="notifycontent">${shortenContent}</p>
            <div class="closebtn" onclick="event.stopImmediatePropagation(); closeThisNotification(this);"><i class="remove icon"></i></div>
            <div class="ui divider"></div>
        </div>`);
    $(".nonotification").hide();

}

function openNotification(obj){
    newWindowOpeningOption = JSON.parse(decodeURIComponent($(obj).attr("redirect")));
    if (newWindowOpeningOption == null){
        //Ignore

    }else{
        //Start a floatWindow to the given target
        newFloatWindow(newWindowOpeningOption);
    }

    //Clear the notiication
    closeThisNotification($(obj).find(".closebtn"));

}

function closeThisNotification(obj){
    $(obj).parent().slideUp("fast",function(data){
        $(this).remove();
        if ($(".notification.object").length == 0){
            $(".nonotification").show();
        }
    });


}

function clearAllNotification(){
    $(".notification.object").slideUp('fast',function(data){
        $(this).remove();
        $(".nonotification").show();
    });
}

/*
    Server-side notification delivery (Notification Agent: desktop)

    The desktop notification agent (mod/notification/agents/desktopn)
    buffers notifications for this user on the server. We poll it on a
    timer and, for each new one, add it to the notification list, show a
    transient toast, and — only when this page is not focused — raise a
    browser (Chrome) push notification instead.
*/
var arozNotificationSeenIds = {};
var arozNotificationPollTimer = null;

function arozNotificationIcon(priority){
    switch (String(priority || "").toLowerCase()){
        case "high": return "exclamation circle";
        case "low": return "info circle";
        default: return "bell";
    }
}

//pageIsFocused reports whether the desktop tab is currently in the
//foreground, so we can pick a toast (focused) vs a browser push (not).
function pageIsFocused(){
    if (typeof document.hidden === "boolean" && document.hidden) return false;
    if (typeof document.hasFocus === "function") return document.hasFocus();
    return true;
}

function requestDesktopNotificationPermission(){
    try {
        if (typeof Notification !== "undefined" && Notification.permission === "default"){
            Notification.requestPermission();
        }
    } catch (e) { /* Notification API unavailable */ }
}

//showNotificationToast renders a transient popup in the bottom-right of
//the desktop. It auto-dismisses and can be closed manually.
function showNotificationToast(title, message, priority){
    var container = document.getElementById("notificationToastContainer");
    if (!container) return;
    var p = String(priority || "medium").toLowerCase();
    //Use the shared, unit-tested helpers when available, with local fallbacks.
    var priorityClass = (typeof NotificationUI !== "undefined")
        ? NotificationUI.toastPriorityClass(p)
        : ("priority-" + (p === "high" || p === "low" ? p : "medium"));
    var durationMs = (typeof NotificationUI !== "undefined")
        ? NotificationUI.toastDurationMs(p)
        : (p === "high" ? 9000 : 5000);

    var toast = document.createElement("div");
    toast.className = "notificationToast " + priorityClass;
    toast.innerHTML =
        '<i class="' + arozNotificationIcon(p) + ' icon toastIcon"></i>' +
        '<div class="toastBody">' +
            '<p class="toastTitle"></p>' +
            '<p class="toastMessage"></p>' +
        '</div>' +
        '<i class="remove icon toastClose"></i>';
    //Assign text via textContent so notification content cannot inject markup.
    toast.querySelector(".toastTitle").textContent = title;
    toast.querySelector(".toastMessage").textContent = message;

    function dismiss(){
        toast.classList.remove("show");
        setTimeout(function(){ if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }
    toast.querySelector(".toastClose").addEventListener("click", dismiss);
    toast.addEventListener("click", function(e){
        if (e.target && e.target.classList.contains("toastClose")) return;
        toggleNotification("show"); //open the full list on click
        dismiss();
    });

    container.appendChild(toast);
    //Trigger the enter transition on the next frame.
    requestAnimationFrame(function(){ toast.classList.add("show"); });
    //Auto dismiss (longer for high priority).
    setTimeout(dismiss, durationMs);
}

function showBrowserPush(title, body, priority){
    try {
        if (typeof Notification !== "undefined" && Notification.permission === "granted"){
            var n = new Notification(title, { body: body });
            //Focus this tab when the user clicks the OS notification.
            n.onclick = function(){ try { window.focus(); } catch (e) {} n.close(); };
            //Auto-close low/medium priority pushes so they do not pile up.
            if (String(priority).toLowerCase() !== "high"){
                setTimeout(function(){ try { n.close(); } catch (e) {} }, 8000);
            }
        }
    } catch (e) { /* ignore push errors */ }
}

function escapeNotificationText(text){
    return String(text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function renderServerNotification(item){
    if (!item) return;
    if (item.id && arozNotificationSeenIds[item.id]) return;
    if (item.id) arozNotificationSeenIds[item.id] = true;

    var title = item.title || "Notification";
    var message = item.message || "";
    if (item.sender){
        message = message + (message ? " " : "") + "(" + item.sender + ")";
    }

    //An optional payload carries the float window to open when the
    //notification is clicked (e.g. the share link of a file shared
    //with this user). sendNotification takes it double encoded.
    var clickTarget = null;
    if (item.payload){
        try {
            var openOption = JSON.parse(item.payload);
            if (openOption && typeof openOption.url === "string"){
                clickTarget = JSON.stringify(JSON.stringify(openOption));
            }
        } catch (e) { /* not a window option, ignore */ }
    }

    //Always add it to the persistent notification list. Server text is
    //plain text (it can carry file names), so escape it for the list.
    sendNotification(escapeNotificationText(title), escapeNotificationText(message), arozNotificationIcon(item.priority), clickTarget);

    //Surface it: the in-page toast is shown whether or not the desktop
    //is focused, so the notification is never silently swallowed; a
    //browser (OS) push is additionally raised only when the desktop is
    //not focused, to reach the user when they are looking elsewhere.
    var channels = (typeof NotificationUI !== "undefined")
        ? NotificationUI.deliveryChannelsForFocus(pageIsFocused())
        : (pageIsFocused() ? ["toast"] : ["toast", "push"]);

    if (channels.indexOf("toast") >= 0){
        showNotificationToast(title, message, item.priority);
    }
    if (channels.indexOf("push") >= 0){
        showBrowserPush(title, message, item.priority);
    }
}

function pollServerNotifications(){
    $.ajax({
        url: "system/notification/desktop/list",
        method: "GET",
        dataType: "json",
        success: function(items){
            if (!Array.isArray(items)) return;
            items.forEach(renderServerNotification);
        },
        error: function(){ /* transient; retry on next tick */ }
    });
}

function startServerNotificationPolling(){
    if (arozNotificationPollTimer !== null) return;
    requestDesktopNotificationPermission();
    pollServerNotifications();
    arozNotificationPollTimer = setInterval(pollServerNotifications, 15000);
}

//Begin polling once the desktop scripts have loaded.
$(document).ready(function(){
    startServerNotificationPolling();
});
