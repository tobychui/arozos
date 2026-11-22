/*
    ArozOS Desktop - Quick access panel (control centre)

    The panel the tray's server icon opens, one column of cards:
    - status: server health (disk SMART check and RAID arrays), host name,
      the main network address with a menu for the other interfaces,
      device UUID and firmware;
    - controls: dark mode, full screen and System Settings tiles, volume and
      brightness sliders;
    - storage: usage of every disk and RAID array (administrators only, as
      the disk endpoints are).

    Everything comes from the JSON endpoints the old loaded fragments used
    (/system/network/getNICinfo, /system/disk/smart/getSMART,
    /system/disk/diskmg/view, /system/disk/raid/overview), so the panel
    takes the desktop's --dt-* colours and the dark theme. The health verdict
    also drives the dot on the tray icon (setTrayServerStatus in dock.js).

    Kept for other code: showToolPanel, hideToolPanel, initFrameLoading
    (boot.js), fullscreen, updateThemeToggleBtn (theme.js), the
    localStorage keys global_volume and brightness (0 to 1), which WebApps
    and the startup sound read.

    Part of desktop.html, see README.md in this folder for the load order.
*/

var QA_REFRESH_AFTER = 60 * 1000;       //Opening the panel refreshes data older than this
var QA_BACKGROUND_REFRESH = 900 * 1000; //And everything refreshes every 15 minutes
var QA_DISKS_SHOWN = 4;                 //Disks shown before "Show all"
var QA_IFACE_KEY = "desktop-qa-iface";  //The interface the user picked, per browser

var qaLastRefresh = 0;
var qaHealth = {smart: 0, raid: 0};     //0 good, 1 warning, 2 failing
var qaNics = [];
var qaDisks = [];
var qaShowAllDisks = false;
var qaRaidWaiting = false;              //RAID overview waits for the host info (session.js)
var qaRaidLogged = false;               //"no RAID on this host" was logged once

/*
    Open and close
*/
function showToolPanel(){
    if (typeof trayToggleAllowed == "function" && !trayToggleAllowed("quickaccess")){
        return;
    }
    hideListMenu();
    if ($("#quickAccessPanel").is(":visible")){
        hideToolPanel();
        return;
    }
    if (typeof trayClosePanels == "function"){
        trayClosePanels("#quickAccessPanel");
    }
    updateThemeToggleBtn();
    qaUpdateFullscreenTile();
    qaSyncSliders();
    if (Date.now() - qaLastRefresh > QA_REFRESH_AFTER){
        qaRefresh();
    }
    $("#quickAccessPanel").stop(true, true).fadeIn("fast");
}

function hideToolPanel(){
    $("#quickAccessPanel").stop(true, true).fadeOut("fast");
    if (contextMenuAnchor != null && $(contextMenuAnchor).closest("#quickAccessPanel").length > 0){
        contextMenuHideOnly();
    }
}

//Called once by boot.js: fill the panel and set the tray dot
function initFrameLoading(){
    qaSyncSliders();
    qaRefresh();
    setInterval(qaRefresh, QA_BACKGROUND_REFRESH);
}

function qaRefresh(){
    qaLastRefresh = Date.now();
    qaLoadHealth();
    qaLoadNetwork();
    qaLoadDisks();
    qaRenderFacts();
}

//Text with {name} placeholders filled in
function qaFormat(key, fallback, values){
    var text = applocale.getString(key, fallback);
    Object.keys(values).forEach(function(name){
        text = text.split("{" + name + "}").join(values[name]);
    });
    return text;
}

function qaFormatBytes(bytes){
    if (typeof ao_module_utils != "undefined" && ao_module_utils.formatBytes){
        return ao_module_utils.formatBytes(bytes, 1);
    }
    return Math.round(bytes / 1073741824) + " GB";
}

/*
    Status card
*/
function qaRenderFacts(){
    if (typeof hostInfo != "undefined" && hostInfo != null){
        $("#qaUUID").text(hostInfo.DeviceUUID || "");
    }
}

function qaLoadHealth(){
    $.ajax({
        url: "system/disk/smart/getSMART",
        success: function(data){
            //No SMART support or no permission: nothing to report
            qaHealth.smart = 0;
            if (data && data.error == undefined){
                if (data.healthy == "Attention"){
                    qaHealth.smart = 1;
                }else if (data.healthy == "Failing"){
                    qaHealth.smart = 2;
                }
            }
            qaRenderHealth();
        },
        error: function(){
            qaHealth.smart = 0;
            qaRenderHealth();
        }
    });
}

function qaRenderHealth(){
    var level = Math.max(qaHealth.smart, qaHealth.raid);
    if (typeof setTrayServerStatus == "function"){
        setTrayServerStatus(level);
    }
    var texts = [
        ["quickAccess/overview/status/healthy", "Good", "Server seems to be operating well!", "check"],
        ["quickAccess/overview/status/warning", "Warning", "There seems to be some minor issues", "exclamation"],
        ["quickAccess/overview/status/screwed", "Failing", "Looks like something went wrong", "times"]
    ][level];
    $("#qaStatusTitle").text(applocale.getString(texts[0], texts[1]));
    $("#qaStatusDesc").text(applocale.getString(texts[0] + "/desc", texts[2]));
    $("#qaStatusIcon i").attr("class", texts[3] + " icon");
    $("#quickAccessPanel .qaStatus").removeClass("level0 level1 level2").addClass("level" + level);
}

/*
    Network: the main address, the other interfaces in a menu
*/
function qaNicAddress(nic){
    if (nic.IPv4Addr && nic.IPv4Addr != "N/A"){
        return nic.IPv4Addr;
    }
    if (nic.IPv6Addr && nic.IPv6Addr != "N/A"){
        return nic.IPv6Addr;
    }
    return "";
}

//The interface most likely to be how people reach this server
function qaNicScore(nic){
    var score = 0;
    if (nic.Type == "loopback" || nic.Name == "lo" || nic.IPv4Addr == "127.0.0.1"){
        score -= 100;
    }
    if (nic.Type == "ethernet" || nic.Type == "wifi"){
        score += 3;
    }else if (nic.Type == "virtual" || nic.Type == "vpn"){
        score -= 2;
    }
    //The type is only worked out from Linux names; these give away virtual
    //adapters and overlay networks on Windows and macOS too
    var name = String(nic.Name || "").toLowerCase();
    if (/virtual|vmware|vmnet|hyper-v|vethernet|docker|wsl|bridge/.test(name)){
        score -= 3;
    }else if (/zerotier|tailscale|wireguard|vpn|tap|tun|utun/.test(name)){
        score -= 2;
    }
    if (nic.OperState == "up"){
        score += 2;
    }else if (nic.OperState == "down"){
        score -= 4;
    }
    if (nic.IPv4Addr && nic.IPv4Addr != "N/A"){
        score += 2;
        //Link-local addresses are rarely the way in
        if (nic.IPv4Addr.indexOf("169.254.") == 0){
            score -= 3;
        }
    }
    return score;
}

function qaLoadNetwork(){
    $.get("system/network/getNICinfo", function(data){
        if (!Array.isArray(data)){
            qaNics = [];
            qaRenderNetwork();
            return;
        }
        qaNics = data.filter(function(nic){
            return qaNicAddress(nic) != "";
        });
        //Best first; the sort is stable, so equal ones keep the system's order
        qaNics.sort(function(a, b){
            return qaNicScore(b) - qaNicScore(a);
        });
        qaRenderNetwork();
    }).fail(function(){
        qaNics = [];
        qaRenderNetwork();
    });
}

function qaSelectedNic(){
    var saved = null;
    try {
        saved = localStorage.getItem(QA_IFACE_KEY);
    } catch (ex) {}
    for (var i = 0; i < qaNics.length; i++){
        if (qaNics[i].Name == saved){
            return qaNics[i];
        }
    }
    return qaNics.length > 0 ? qaNics[0] : null;
}

function qaRenderNetwork(){
    var nic = qaSelectedNic();
    if (nic == null){
        $("#qaNetworkRow").hide();
        return;
    }
    $("#qaNetworkRow").show();
    $("#qaIfaceName").text(nic.Name);
    $("#qaIfaceAddr").text(qaNicAddress(nic));
    $("#qaIfaceBtn").toggleClass("single", qaNics.length < 2);
}

function qaShowIfaceMenu(button){
    var menu = $("#contextmenu");
    if (menu.is(":visible") && contextMenuAnchor === button){
        contextMenuHideOnly();
        return;
    }
    if (qaNics.length < 2){
        return;
    }
    //Only the menu: hideAllContextMenus would close this panel too
    contextMenuHideOnly();
    menu.html("");
    var current = qaSelectedNic();
    qaNics.forEach(function(nic){
        var label = $("<span></span>").text(nic.Name + "  " + qaNicAddress(nic)).html();
        addContextMenuItem(menu, label, undefined, "qaMenuPickIface", false, {
            payload: nic.Name,
            checked: current != null && current.Name == nic.Name
        });
    });
    menu.show();
    placeContextMenu(0, 0);
    //Below the button, left edges aligned, kept on screen
    var rect = button.getBoundingClientRect();
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.outerWidth() - 8));
    var top = rect.bottom + 4;
    if (top + menu.outerHeight() > window.innerHeight - 8){
        top = Math.max(8, rect.top - menu.outerHeight() - 4);
    }
    menu.css({left: left, top: top});
    contextMenuAnchor = button;
}

function qaMenuPickIface(target, event){
    var name = getContextMenuPayload(target);
    try {
        localStorage.setItem(QA_IFACE_KEY, name);
    } catch (ex) {}
    contextMenuHideOnly();
    qaRenderNetwork();
}

/*
    Controls: tiles and sliders
*/
function qaUpdateFullscreenTile(){
    var isFull = !!(document.fullscreenElement || document.webkitFullscreenElement ||
        document.mozFullScreenElement || document.msFullscreenElement);
    $("#qaFullscreen").toggleClass("active", isFull).attr("aria-pressed", isFull ? "true" : "false");
    $("#qaFullscreen i").attr("class", (isFull ? "compress" : "expand") + " icon");
}

function qaReadFraction(key, fallback){
    var value = NaN;
    try {
        value = parseFloat(localStorage.getItem(key));
    } catch (ex) {}
    if (isNaN(value)){
        return fallback;
    }
    return Math.max(0, Math.min(1, value));
}

//Show the stored volume and brightness, and apply the brightness
function qaSyncSliders(){
    var volume = qaReadFraction("global_volume", 0);
    var brightness = Math.max(0.03, qaReadFraction("brightness", 1));
    $("#qaVolume").val(Math.round(volume * 100));
    $("#qaBrightness").val(Math.round(brightness * 100));
    qaPaintSlider($("#qaVolume")[0]);
    qaPaintSlider($("#qaBrightness")[0]);
    $("body").css("filter", brightness < 1 ? "brightness(" + (brightness * 100) + "%)" : "");
}

//The filled part of the track, and the value and icon next to it
function qaPaintSlider(input){
    if (!input){
        return;
    }
    var min = parseFloat(input.min) || 0;
    var max = parseFloat(input.max) || 100;
    var value = parseFloat(input.value);
    input.style.setProperty("--qa-fill", ((value - min) / (max - min) * 100) + "%");
    var row = $(input).closest(".qaSlider");
    row.find(".qaSliderValue").text(Math.round(value) + "%");
    if (input.id == "qaVolume"){
        var icon = value == 0 ? "volume off" : (value < 50 ? "volume down" : "volume up");
        row.find(".qaSliderIcon").attr("class", icon + " icon qaSliderIcon");
    }
}

/*
    A slider only renders while it is dragged ("input") and saves once it
    is let go ("change"), so nothing is written on every step of a drag.
*/
function qaSaveVolume(percent){
    try {
        localStorage.setItem("global_volume", percent / 100);
    } catch (ex) {}
}

//The screen follows the brightness slider live
function qaApplyBrightness(percent){
    percent = Math.max(3, Math.min(100, percent));
    $("body").css("filter", percent < 100 ? "brightness(" + percent + "%)" : "");
    return percent;
}

function qaSaveBrightness(percent){
    percent = qaApplyBrightness(percent);
    try {
        localStorage.setItem("brightness", percent / 100);
    } catch (ex) {}
}

/*
    Storage card. /system/disk/diskmg/view answers per platform:
    Windows: rows [id, ?, label, ?, ?, free bytes, total bytes];
    Linux: [lsblk -b, lsblk -f -b, df rows (1K blocks, as text)].
    Other platforms (macOS) and users without access get no card.
*/
function qaLoadDisks(){
    $.ajax({
        url: "system/disk/diskmg/view",
        success: function(data){
            var disks = (data && data.error == undefined) ? qaParseDisks(data) : null;
            if (disks == null){
                qaDisks = [];
                qaRenderDisks();
                return;
            }
            qaDisks = disks;
            qaRenderDisks();
            qaLoadRaid();
        },
        error: function(){
            qaDisks = [];
            qaRenderDisks();
        }
    });
}

function qaParseDisks(data){
    if (!Array.isArray(data) || data.length == 0){
        return null;
    }
    if (data[0] && Array.isArray(data[0].blockdevices)){
        return qaParseLinuxDisks(data);
    }
    if (Array.isArray(data[0]) && data[0].length == 7){
        return qaParseWindowsDisks(data);
    }
    return null;
}

function qaParseWindowsDisks(data){
    var disks = [];
    data.forEach(function(row){
        if (!Array.isArray(row) || row.length < 7){
            //Not a hard disk
            return;
        }
        var total = parseFloat(row[6]);
        var free = parseFloat(row[5]);
        if (!(total > 0)){
            return;
        }
        disks.push({
            name: String(row[2] || "").trim(),
            id: String(row[0] || "").replace("\\\\", "\\"),
            total: total,
            free: isNaN(free) ? 0 : free,
            mounted: true
        });
    });
    return disks;
}

function qaParseLinuxDisks(data){
    var devices = data[0].blockdevices;
    var formats = (data[1] && Array.isArray(data[1].blockdevices)) ? data[1].blockdevices : [];
    var df = Array.isArray(data[2]) ? data[2] : [];
    var disks = [];
    devices.forEach(function(dev, index){
        if (!Array.isArray(dev.children) || dev.children.length == 0){
            //Not formatted or damaged
            return;
        }
        if (formats[index] && formats[index].fstype == "linux_raid_member"){
            //Part of a RAID array, shown with the array
            return;
        }
        //df rows: device, 1K blocks, used, available, use%, mount point
        var total = 0;
        var free = 0;
        var prefix = "/dev/" + dev.name;
        df.forEach(function(row){
            if (Array.isArray(row) && row.length >= 4 && String(row[0]).indexOf(prefix) == 0){
                var blocks = parseFloat(row[1]);
                var available = parseFloat(row[3]);
                if (!isNaN(blocks) && !isNaN(available)){
                    total += blocks * 1024;
                    free += available * 1024;
                }
            }
        });
        var mountpoint = "";
        dev.children.forEach(function(part){
            if (mountpoint == "" && part.mountpoint){
                mountpoint = part.mountpoint;
            }
        });
        disks.push({
            name: mountpoint != "" ? mountpoint : (dev.model || ""),
            id: dev.name,
            total: total > 0 ? total : (parseFloat(dev.size) || 0),
            free: free,
            mounted: total > 0
        });
    });
    return disks;
}

/*
    /system/disk/raid/* only exists while the server runs its RAID manager
    (Linux with mdadm and -enable_hwman), which the host info tells as
    RAIDSupported. Asking anyway would put a 404 in the console on every
    refresh, so a host without it is skipped with one debug line.
*/
function qaLoadRaid(){
    if (typeof hostInfo == "undefined" || hostInfo == null || hostInfo.RAIDSupported === undefined){
        //The host info is not in yet: qaHostInfoLoaded asks again
        qaRaidWaiting = true;
        return;
    }
    qaRaidWaiting = false;
    if (hostInfo.RAIDSupported !== true){
        if (!qaRaidLogged){
            qaRaidLogged = true;
            console.debug("[Desktop] RAID is not supported on this host (needs Linux with mdadm and -enable_hwman), skipping the RAID overview");
        }
        qaHealth.raid = 0;
        qaRenderHealth();
        return;
    }
    $.ajax({
        url: "system/disk/raid/overview",
        success: function(data){
            if (!Array.isArray(data)){
                //No RAID support or not an administrator
                qaHealth.raid = 0;
                qaRenderHealth();
                return;
            }
            var failing = false;
            data.forEach(function(raid){
                if (!raid.IsHealthy){
                    failing = true;
                }
                var total = parseFloat(raid.TotalSize) || 0;
                qaDisks.push({
                    name: String(raid.Name || ""),
                    id: String(raid.Level || "").toUpperCase(),
                    total: total,
                    free: Math.max(0, total - (parseFloat(raid.UsedSize) || 0)),
                    mounted: total > 0,
                    raid: true,
                    healthy: !!raid.IsHealthy,
                    status: String(raid.Status || "")
                });
            });
            qaHealth.raid = failing ? 1 : 0;
            qaRenderHealth();
            qaRenderDisks();
        },
        error: function(){
            qaHealth.raid = 0;
            qaRenderHealth();
        }
    });
}

//Called by initDesktopHostInfo (session.js) once the host info is in
function qaHostInfoLoaded(){
    if (qaRaidWaiting){
        qaLoadRaid();
    }
}

function qaRenderDisks(){
    var card = $("#qaStorage");
    var list = $("#qaDiskList").empty();
    if (qaDisks.length == 0){
        card.hide();
        return;
    }
    card.show();
    var shown = qaShowAllDisks ? qaDisks : qaDisks.slice(0, QA_DISKS_SHOWN);
    shown.forEach(function(disk){
        list.append(qaDiskRow(disk));
    });
    var more = $("#qaStorageMore");
    if (qaDisks.length > QA_DISKS_SHOWN){
        more.show().text(qaShowAllDisks ?
            applocale.getString("quickAccess/storage/showLess", "Show less") :
            qaFormat("quickAccess/storage/showAll", "Show all ({n})", {n: qaDisks.length}));
    }else{
        more.hide();
    }
}

function qaDiskRow(disk){
    var row = $('<div class="qaDisk">' +
        '<div class="qaDiskIcon"><i class="icon"></i></div>' +
        '<div class="qaDiskBody">' +
            '<div class="qaDiskHead"><span class="qaDiskName"></span><span class="qaDiskSide"></span></div>' +
            '<div class="qaDiskBar"><div class="qaDiskFill"></div></div>' +
        '</div>' +
    '</div>');
    row.find(".qaDiskIcon i").addClass(disk.raid ? "database" : "hdd outline");
    var label = disk.name != "" ? disk.name : disk.id;
    if (disk.name != "" && disk.id != "" && disk.id != disk.name){
        label += " (" + disk.id + ")";
    }
    row.find(".qaDiskName").text(label);

    var side = row.find(".qaDiskSide");
    if (!disk.mounted){
        side.text(applocale.getString("quickAccess/storage/notMounted", "Not mounted"));
        row.addClass("unmounted");
        row.attr("title", label);
        return row;
    }
    var used = Math.max(0, disk.total - disk.free);
    var percent = disk.total > 0 ? Math.min(100, used / disk.total * 100) : 0;
    row.find(".qaDiskFill").css("width", percent.toFixed(1) + "%");
    if (percent >= 90){
        row.addClass("full");
    }else if (percent >= 80){
        row.addClass("warn");
    }
    var detail = qaFormat("quickAccess/storage/detail", "{pct}% used, {free} free of {total}", {
        pct: percent.toFixed(1),
        free: qaFormatBytes(disk.free),
        total: qaFormatBytes(disk.total)
    });
    if (disk.raid){
        //The array's health is what matters most on its row
        side.addClass("raidState").toggleClass("failing", !disk.healthy).text(disk.healthy ?
            applocale.getString("quickAccess/raid/healthy", "Healthy") :
            applocale.getString("quickAccess/raid/failing", "Degraded"));
        if (!disk.healthy){
            row.addClass("failing");
        }
        detail = disk.status + ", " + detail;
    }else{
        side.text(qaFormat("quickAccess/storage/freeShort", "{free} free", {free: qaFormatBytes(disk.free)}));
    }
    row.attr("title", label + "\n" + detail);
    return row;
}

/*
    Events
*/
$("#quickAccessPanel").on("click", "#settingButton", function(){
    showSystemSettings();
    hideToolPanel();
});

$("#quickAccessPanel").on("click", "#qaDetails", function(){
    showSystemSettings();
    hideToolPanel();
});

$("#quickAccessPanel").on("click", "#qaFullscreen", function(){
    fullscreen();
    hideToolPanel();
});

$("#quickAccessPanel").on("click", "#themeToggleBtn", function(){
    toggleDesktopTheme();
    updateThemeToggleBtn();
});

$("#quickAccessPanel").on("click", "#qaIfaceBtn", function(event){
    event.stopPropagation();
    qaShowIfaceMenu(this);
});

$("#quickAccessPanel").on("click", "#qaStorageMore", function(){
    qaShowAllDisks = !qaShowAllDisks;
    qaRenderDisks();
});


/*
    Sliders. The drag is ours, not the browser's: Firefox cancels a native
    range thumb drag when the slider loses the mouse midway, puts the value
    back where the drag started and never fires "change". So the range input
    takes no pointer events (quickaccess.css); a press anywhere on its row
    captures the pointer on the row, every move sets the value from the
    pointer position, and the value is saved once on release (or if the
    capture is lost anyway, keeping what the user saw). The input stays
    focusable, and its own "input" / "change" events serve the keyboard.
*/
var qaSliderDrag = null; //{row, input, pointerId} while a slider is dragged

//The value under clientX, the thumb (16 px) centred on the pointer
function qaSliderValueAt(input, clientX){
    var rect = input.getBoundingClientRect();
    var thumb = 16;
    var min = parseFloat(input.min) || 0;
    var max = parseFloat(input.max) || 100;
    var ratio = (clientX - rect.left - thumb / 2) / Math.max(1, rect.width - thumb);
    ratio = Math.max(0, Math.min(1, ratio));
    return Math.round(min + ratio * (max - min));
}

//Show a value: the slider, and for brightness the screen
function qaSliderPreview(input, value){
    input.value = value;
    qaPaintSlider(input);
    if (input.id == "qaBrightness"){
        qaApplyBrightness(parseFloat(input.value));
    }
}

function qaSliderSave(input){
    if (input.id == "qaVolume"){
        qaSaveVolume(parseFloat(input.value));
    }else if (input.id == "qaBrightness"){
        qaSaveBrightness(parseFloat(input.value));
    }
}

function qaSliderDragEnd(){
    if (qaSliderDrag == null){
        return;
    }
    var drag = qaSliderDrag;
    qaSliderDrag = null;
    $(drag.row).removeClass("dragging");
    try {
        if (drag.row.hasPointerCapture && drag.row.hasPointerCapture(drag.pointerId)){
            drag.row.releasePointerCapture(drag.pointerId);
        }
    } catch (ex) {}
    qaSliderSave(drag.input);
}

$("#quickAccessPanel").on("pointerdown", ".qaSlider", function(event){
    var e = event.originalEvent;
    if (e.pointerType == "mouse" && e.button != 0){
        return;
    }
    var input = $(this).find("input[type=range]")[0];
    if (!input){
        return;
    }
    //No text selection, no native drag, focus for the arrow keys
    event.preventDefault();
    input.focus({preventScroll: true});
    qaSliderDragEnd();
    qaSliderDrag = {row: this, input: input, pointerId: e.pointerId};
    try {
        this.setPointerCapture(e.pointerId);
    } catch (ex) {}
    $(this).addClass("dragging");
    qaSliderPreview(input, qaSliderValueAt(input, e.clientX));
});

$("#quickAccessPanel").on("pointermove", ".qaSlider", function(event){
    var e = event.originalEvent;
    if (qaSliderDrag == null || qaSliderDrag.row !== this || e.pointerId != qaSliderDrag.pointerId){
        return;
    }
    qaSliderPreview(qaSliderDrag.input, qaSliderValueAt(qaSliderDrag.input, e.clientX));
});

$("#quickAccessPanel").on("pointerup pointercancel lostpointercapture", ".qaSlider", function(event){
    if (qaSliderDrag != null && qaSliderDrag.row === this && event.originalEvent.pointerId == qaSliderDrag.pointerId){
        qaSliderDragEnd();
    }
});

//Keyboard (arrow keys, Home, End on the focused slider)
$("#qaVolume, #qaBrightness").on("input", function(){
    qaPaintSlider(this);
    if (this.id == "qaBrightness"){
        qaApplyBrightness(parseFloat(this.value));
    }
});

$("#qaVolume, #qaBrightness").on("change", function(){
    qaPaintSlider(this);
    qaSliderSave(this);
});

$(document).on("fullscreenchange webkitfullscreenchange mozfullscreenchange MSFullscreenChange", function(){
    qaUpdateFullscreenTile();
});

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
