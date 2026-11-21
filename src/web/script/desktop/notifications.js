/*
    ArozOS Desktop - Notifications and calendar

    The panel the tray clock opens: a column of two cards at the bottom
    right, the notifications (newest first, each with its relative time) and
    a month calendar that opens the Calendar app on a day. Also desktop
    notifications sent by WebApps (sendNotification), server side
    notifications polled from /system/notification and the transient toasts
    and browser push messages.

    Kept for other code: toggleNotification(action), sendNotification(title,
    content, icon, windowOpenOption), openNotification, closeThisNotification,
    clearAllNotification, and the .notification.object class the tray clock
    counts for its dot (updateClockTime in dock.js).

    Part of desktop.html, see README.md in this folder for the load order.
*/

//Open ("show"), close ("hide") or flip the notification and calendar panel
function toggleNotification(action=undefined){
    var panel = $(".notificationbar");
    if (action == undefined && typeof trayToggleAllowed == "function" && !trayToggleAllowed("notifications")){
        return;
    }
    var open = (action == "show") || (action == undefined && !panel.is(":visible"));
    if (!open){
        panel.stop(true, true).fadeOut(120);
        return;
    }
    if (typeof trayClosePanels == "function"){
        trayClosePanels(".notificationbar");
    }
    ncCalendarMonth = null;
    ncRenderCalendar();
    ncUpdateTimes();
    ncUpdateHeader();
    $("#ncOpenCalendar").toggle(getModuleInfoFromName("Calendar") != false);
    panel.stop(true, true).fadeIn(120);
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
    content = String(content);
    var shortenContent = content.length > 300 ? content.substring(0, 300) + "..." : content;
    var onClickOpenWindowOption = encodeURIComponent(JSON.parse(windowOpenOption));
    var card = $('<div class="notification object" onclick="openNotification(this);">' +
        '<div class="notifyIcon"><i class="icon"></i></div>' +
        '<div class="notifyBody"><div class="notifyHead"><span class="title"></span><span class="notifyTime"></span></div>' +
        '<div class="notifycontent"></div></div>' +
        '<div class="closebtn" onclick="event.stopImmediatePropagation(); closeThisNotification(this);"><i class="close icon"></i></div>' +
        '</div>');
    card.attr({"originalcontent": content, "redirect": onClickOpenWindowOption, "data-time": Date.now()});
    card.find(".notifyIcon i").addClass(icon);
    //Callers pass text, already escaped where it comes from the server
    card.find(".title").html(title);
    card.find(".notifycontent").html(shortenContent);
    $("#notificationlist").prepend(card);
    $(".nonotification").hide();
    ncUpdateTimes();
    ncUpdateHeader();
    updateClockTime();
}

function openNotification(obj){
    newWindowOpeningOption = JSON.parse(decodeURIComponent($(obj).attr("redirect")));
    if (newWindowOpeningOption == null){
        //Ignore

    }else{
        //Start a floatWindow to the given target
        newFloatWindow(newWindowOpeningOption);
        toggleNotification("hide");
    }

    //Clear the notiication
    closeThisNotification($(obj).find(".closebtn"));

}

function closeThisNotification(obj){
    $(obj).parent().slideUp(150, function(){
        $(this).remove();
        if ($(".notification.object").length == 0){
            $(".nonotification").show();
        }
        ncUpdateHeader();
        updateClockTime();
    });
}

function clearAllNotification(){
    var cards = $(".notification.object");
    if (cards.length == 0){
        return;
    }
    cards.slideUp(150).promise().done(function(){
        cards.remove();
        $(".nonotification").show();
        ncUpdateHeader();
        updateClockTime();
    });
}

//"Clear All" only when there is something to clear
function ncUpdateHeader(){
    $(".notificationbar .clearall").toggle($(".notification.object").length > 0);
}

/*
    Relative times on the cards ("now", "5 minutes ago"), in the user's language
*/
function ncLanguage(){
    if (typeof applocale != "undefined" && applocale.lang){
        return applocale.lang;
    }
    return navigator.language || "en";
}

function ncRelativeTime(timestamp){
    var seconds = Math.round((timestamp - Date.now()) / 1000);
    try {
        var rtf = new Intl.RelativeTimeFormat(ncLanguage(), {numeric: "auto"});
        if (Math.abs(seconds) < 60){
            return rtf.format(0, "second");
        }
        var minutes = Math.round(seconds / 60);
        if (Math.abs(minutes) < 60){
            return rtf.format(minutes, "minute");
        }
        var hours = Math.round(minutes / 60);
        if (Math.abs(hours) < 24){
            return rtf.format(hours, "hour");
        }
        return rtf.format(Math.round(hours / 24), "day");
    } catch (ex) {
        return new Date(timestamp).toLocaleTimeString();
    }
}

function ncUpdateTimes(){
    $("#notificationlist .notification.object").each(function(){
        var time = parseInt($(this).attr("data-time"));
        if (!isNaN(time)){
            $(this).find(".notifyTime").text(ncRelativeTime(time));
        }
    });
}

setInterval(function(){
    if ($(".notificationbar").is(":visible")){
        ncUpdateTimes();
    }
}, 30000);

/*
    Calendar card: today's date and a month grid, weeks starting on Sunday,
    names from the browser in the user's language. A day opens the Calendar
    app on that day (it reads {"date": "YYYY-MM-DD", "view": "day"} from its
    URL hash); without the app the days are only shown.
*/
var ncCalendarMonth = null; //First day of the month on screen, null for this month

function ncDateKey(date){
    return date.getFullYear() + "-" + zeropad(date.getMonth() + 1, 2) + "-" + zeropad(date.getDate(), 2);
}

function ncRenderCalendar(){
    var today = new Date();
    if (ncCalendarMonth == null){
        ncCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    var lang = ncLanguage();
    var format = function(date, options){
        try {
            return date.toLocaleDateString(lang, options);
        } catch (ex) {
            return date.toLocaleDateString(undefined, options);
        }
    };
    $("#ncWeekday").text(format(today, {weekday: "long"}));
    $("#ncDate").text(format(today, {year: "numeric", month: "long", day: "numeric"}));
    $("#ncMonthLabel").text(format(ncCalendarMonth, {year: "numeric", month: "long"}));

    var hasCalendarApp = getModuleInfoFromName("Calendar") != false;
    var grid = $("#ncDays").empty().toggleClass("clickable", hasCalendarApp);
    for (var i = 0; i < 7; i++){
        //2023-01-01 was a Sunday
        grid.append($('<div class="ncWeekday"></div>').text(format(new Date(2023, 0, 1 + i), {weekday: "narrow"})));
    }
    var first = ncCalendarMonth;
    var start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    var todayKey = ncDateKey(today);
    //Always six weeks, so the card keeps its height from month to month
    for (var d = 0; d < 42; d++){
        var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
        var cell = $('<div class="ncDay"></div>').text(day.getDate());
        cell.attr({"data-date": ncDateKey(day), "title": format(day, {year: "numeric", month: "long", day: "numeric"})});
        cell.toggleClass("otherMonth", day.getMonth() != first.getMonth());
        cell.toggleClass("today", ncDateKey(day) == todayKey);
        grid.append(cell);
    }
}

function ncShiftMonth(delta){
    if (ncCalendarMonth == null){
        var today = new Date();
        ncCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    }
    ncCalendarMonth = new Date(ncCalendarMonth.getFullYear(), ncCalendarMonth.getMonth() + delta, 1);
    ncRenderCalendar();
}

//Open the Calendar app, on a day (YYYY-MM-DD) when one is given
function ncOpenCalendar(dateKey){
    var mod = getModuleInfoFromName("Calendar");
    if (!mod){
        return;
    }
    var url = (mod.SupportFW && mod.LaunchFWDir) ? mod.LaunchFWDir : mod.StartDir;
    if (dateKey){
        url += "#" + encodeURIComponent(JSON.stringify({date: dateKey, view: "day"}));
    }
    var size = (mod.SupportFW && Array.isArray(mod.InitFWSize)) ? mod.InitFWSize : [undefined, undefined];
    toggleNotification("hide");
    newFloatWindow({
        url: url,
        width: size[0],
        height: size[1],
        appicon: mod.IconPath || "img/system/favicon.png",
        title: mod.Name
    });
}

$("#ncPrevMonth").on("click", function(){ ncShiftMonth(-1); });
$("#ncNextMonth").on("click", function(){ ncShiftMonth(1); });
//The month label brings the calendar back to this month
$("#ncMonthLabel").on("click", function(){
    ncCalendarMonth = null;
    ncRenderCalendar();
});
$("#ncDays").on("click", ".ncDay", function(){
    ncOpenCalendar($(this).attr("data-date"));
});
$("#ncOpenCalendar").on("click", function(){
    ncOpenCalendar();
});

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
