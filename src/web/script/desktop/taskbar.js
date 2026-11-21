/*
    ArozOS Desktop - Taskbar

    The taskbar clock and the float window buttons: grouping, the stacked
    window list of a grouped button and closing a whole group. The button
    itself is created by newFloatWindow (windows.js).

    Part of desktop.html, see README.md in this folder for the load order.
*/

//Keep the clock updated
setInterval(function(){
    updateClockTime();
},5000);
updateClockTime();
function updateClockTime(){
    var d = new Date();
    var ampm = "AM";
    var currentHour = d.getHours()
    if (currentHour > 12){
        ampm = "PM";
        currentHour -= 12;
    }
    var display = `${zeropad(currentHour,2)}:${zeropad(d.getMinutes(),2)} ${ampm}<br>
    ${d.getDate()} ${monthNames[d.getMonth()].substr(0, 3)} ${d.getFullYear()}`;

    if ($(".notification.object").length > 0){
        display += `<span style="color: #f54242; margin-left: 8px; float: center;"><i class="notice circle icon"></i></span>`;
    }
    $(".clock").html(display);
    var largedate = monthNames[d.getMonth()] + " " + d.getDate() + " " + d.getFullYear() 
    $("#largedate").text(largedate);
    var dow = daysNames[d.getDay()];
    $("#dayofweek").text(dow);
}

//Handle focus through floatWindow taskbar button
function bringFloatWindowToFrontByFWB(object, event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    var targetWFID = $(object).attr("windowId");
    var targetFW = getFloatWindowByID(targetWFID);
    if (targetFW == undefined){
        //fw not found
        return;
    }
    $(targetFW).fadeIn(100);
    MoveFloatWindowToTop(targetFW);
    stackedFloatWindowListShown = false;
    $("#stackedWindowList").hide();
}

//Close FloatWindow via the floatWindowBody
function closeFWviaFWB(object, event=null) {
    if (event != null){
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    var targetWFID = $(object).parent().attr("windowId");
    var targetFW = getFloatWindowByID(targetWFID);
    if (targetFW == undefined){
        //fw not found
        return;
    }
    closeFloatWindow(targetFW.find(".close"), event);
    $(object).parent().remove();
    if ($("#stackedWindowList").find(".item").length == 0) {
        //There are no more things in this tab. Close this list as well.
        stackedFloatWindowListShown = false;
        $("#stackedWindowList").hide();
    }
}

function findFloatWindowButtonWithID(windowID) {
    var targetButtonObject;
    $(".floatWindowButton").each(function() {
        var originalIDlist = JSON.parse(decodeURIComponent($(this).attr('windowIDGroup')));
        originalIDlist = originalIDlist.map(String);
        if (originalIDlist.includes(windowID)) {
            targetButtonObject = $(this);
        }
    });
    return targetButtonObject;
}

function resizeAllFloatWindowButtons() {
    var fwbTotalWidth = $(".floatWindowButton").length * 200;
    if (fwbTotalWidth > window.innerWidth * 0.7) {
        $(".floatWindowButton").addClass("hideText");
    } else {
        $(".floatWindowButton").removeClass("hideText");
    }
}

function closeWindowGroup(groupName){
    $(".floatWindowButton").each(function(){
        if ($(this).attr("group") == groupName){
            var originalIDlist = JSON.parse(decodeURIComponent($(this).attr('windowIDGroup')));
            originalIDlist.forEach(fwid => {
                closeFloatWindowViaID(fwid);
            });

        }
    })
}
