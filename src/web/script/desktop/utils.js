/*
    ArozOS Desktop - Shared helpers

    Small helpers used across the desktop scripts: string padding and
    truncation, touch to mouse event mapping, double tap detection, the
    user preference store (setStorage / getStorage), colours, clipboard,
    byte formatting, CSRF tokens and the input method editor binding.

    Part of desktop.html, see README.md in this folder for the load order.
*/

function centerTruncat(fullStr, strLen, separator) {
    if (fullStr.length <= strLen) return fullStr;

    separator = separator || '...';

    var sepLen = separator.length,
        charsToShow = strLen - sepLen,
        frontChars = Math.ceil(charsToShow/2),
        backChars = Math.floor(charsToShow/2);

    return fullStr.substr(0, frontChars) + 
        separator + 
        fullStr.substr(fullStr.length - backChars);
};

function zeropad(n, width, z) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
}

var tapedTwiceTouch = false;
var timeoutObject;
var tappingTarget = undefined;
function doubleTouchHandler(object, event, callback) {
    if(!tapedTwiceTouch) {
        tapedTwiceTouch = true;
        tappingTarget = object;
        timeoutObject = setTimeout( function() { tapedTwiceTouch = false; }, 300 );
        return false;
    }
    if (tappingTarget == object){
        //Double click on the same icon
        event.preventDefault();
        callback(object, event);
        tappingTarget = undefined;
    }else{
        //Although it touch twice within 300ms, but it is on different target
        //Update the tab target instead.
        tappingTarget = object;
        tapedTwiceTouch = true;
        clearTimeout(timeoutObject);
        timeoutObject = setTimeout( function() { tapedTwiceTouch = false; }, 300 );
    }

}

//Convert touch events to click events
function mapEventFromTouch(event){
    if (typeof event.originalEvent == "undefined"){
        //Mouse click / down / up events
        return event;
    }
    try{
        //Touch events
        if (typeof event.pageX == "undefined"){
            event.pageX = event.originalEvent.touches[0].pageX;
        }
        if (typeof event.pageY == "undefined"){
            event.pageY = event.originalEvent.touches[0].pageY;
        }
        return event;
    }catch{
        return event;
    }

}

function defaultOrKey(object, defaultvalue, key) {
    if (object[key] !== undefined) {
        return object[key];
    }
    return defaultvalue;
}

function requestCSRFToken(callback){
    $.ajax({
        url: "system/csrf/new",
        success: function(token){
            callback(token);
        }
    });
}



function getCoordinateFromEvent(e){
    var x = -1;
    var y = -1;
    if (e.originalEvent == undefined){
        e.originalEvent = e;
    }
    if(e.type == 'touchstart' || e.type == 'touchmove' || e.type == 'touchend' || e.type == 'touchcancel'){
        var touch = e.originalEvent.touches[0] || e.originalEvent.changedTouches[0];
        x = touch.pageX;
        y = touch.pageY;
    } else if (e.type == 'mousedown' || e.type == 'mouseup' || e.type == 'mousemove' || e.type == 'mouseover'|| e.type=='mouseout' || e.type=='mouseenter' || e.type=='mouseleave') {
        x = e.clientX;
        y = e.clientY;
    }else{
        x = e.clientX;
        y = e.clientY;
    }
    return [x,y];
}

function setStorage(key, value, callback = undefined) {
    $.ajax({
        url: "system/desktop/preference", 
        data: {preference: key, value: value},
        method: "POST",
        success: function(data) {
            if (data.error !== undefined) {
                console.log(data.error);
            } else {
                if (callback !== undefined) {
                    callback();
                }

            }
        }
    });
}

function getStorage(key, callback) {
    $.ajax({
        url: "system/desktop/preference",
        data: {preference: key},
        success: callback
    });
}

function hexToRgbA(hex, transparent=1){
    var c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length== 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c= '0x'+c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+',' + transparent + ')';
    }
    throw new Error('Bad Hex');
}

function copyStringToClipboard(content){
    var el = document.createElement('textarea');
    el.value = content;
    el.setAttribute('readonly', '');
    el.style = {position: 'absolute', left: '-9999px'};
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
}


/*
var screenshotBuf = [];
var totalFloatWindowsLeft = 0;
function screenshot(){
    totalFloatWindowsLeft = $(".floatWindow").length;
    screenshotBuf = [];
    //Get a screenshot from each floatWindow
    $(".floatWindow").each(function(){
        let contentWindow = $(this).find("iframe")[0].contentWindow;
        let offsets = [$(this).find("iframe").offset().left, $(this).find("iframe").offset().top];
        let thisWindowId = $(this).attr("windowid");
        if (contentWindow.ao_module_screenshot){
            contentWindow.ao_module_screenshot(function(capture){
                screenshotBuf.push([thisWindowId,offsets,capture]);
                totalFloatWindowsLeft--;

                if (totalFloatWindowsLeft == 0){
                    //Merge the canvas
                    mergeScreenshotCanvas();
                }
            })
        }else{
            //Float window do not allow screenshot
        }
    });

    if (totalFloatWindowsLeft == 0){
        setTimeout(function(){
            mergeScreenshotCanvas();
        }, 500);

    }
}

function mergeScreenshotCanvas(){
    //Merge the screenshots
    for (var i = 0; i < screenshotBuf.length; i++){
        var thisWindowID = screenshotBuf[i][0];
        var thisOffsets = screenshotBuf[i][1];
        var thisCanvas = screenshotBuf[i][2];
        var imgLink = thisCanvas.toDataURL();

        //Overlay the iframe with image of screenshot
        let targetFw = getFloatWindowByID(thisWindowID);
        $(targetFw).find(".iframecover").append(`<img src="${imgLink}"/>`);
        $(targetFw).find(".iframecover").show();
    }

    html2canvas(document.querySelector("body")).then(basecanvas => {
        downloadCanvas(basecanvas);

        //Clear up the mess
        screenshotBuf.forEach(function(entry){
            let targetFw = getFloatWindowByID(entry[0]);
            $(targetFw).find(".iframecover").html("");
            $(targetFw).find(".iframecover").hide();
        });

         //Reset paramters
        totalFloatWindowsLeft = 0;
        screenshotBuf = [];
    });


}

function downloadCanvas(canvas){
    var aDownloadLink = document.createElement('a');
    aDownloadLink.download = `screenshot_${new Date().toLocaleString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', weekday:"long", hour: '2-digit', hour12: false, minute:'2-digit', second:'2-digit'}).split(":").join("_").split("/").join("-")}.png`;
    aDownloadLink.href = canvas.toDataURL();
    aDownloadLink.click();
}
*/

//Function for converting bytes to human readable sizes
function formatBytes(a,b=2){if(0===a)return"0 Bytes";const c=0>b?0:b,d=Math.floor(Math.log(a)/Math.log(1024));return parseFloat((a/Math.pow(1024,d)).toFixed(c))+" "+["Bytes","KB","MB","GB","TB","PB","EB","ZB","YB"][d]}

function generateCSRFToken(callback){
    $.ajax({
        url: "../../system/csrf/new",
        success: function(token){
            callback(token);
        }
    })
}

function bindObjectToIMEEvents(object){
    object.addEventListener("keydown", function(event){
        if (window.ime && window.ime.handler != null){
            window.ime.handler(event);
        }else{
            //No IME handler. Just continue the input
        }
    });

    object.addEventListener("focus", function(event){
        if (window.ime){
            //IME exists. Set this field to focused field
            window.ime.focus = event.target;
        }
    });
}
