/*
    Application Locale Module
    author: tobychui

    This module translate the current web application page 
    to the desired language specific by the browser.


    Example Usage:
     if (applocale){
        //Applocale found. Do localization
        applocale.init("../locale/file_explorer.json", function(){
            applocale.translate();
            //Do other init things on the page
        }, function(){
            //Optional: called instead when the locale file cannot be loaded
        });
    }
*/

/*
    A page that styles its own fonts (e.g. System Settings) can set
    window.applocaleSkipFontFamily = true before loading its locale: the
    language's preferred font family is then not written inline onto every
    element, and the page applies it itself.
*/
function applocaleInjectsFont(){
    return typeof window === "undefined" || window.applocaleSkipFontFamily !== true;
}

/*
    A page that hosts other pages' fragments (System Settings) sets
    window.applocaleKeepWindowTitle = true once its own title is in place, so
    a fragment's locale file does not rename the float window.
*/
function applocaleSetsWindowTitle(){
    return typeof window === "undefined" || window.applocaleKeepWindowTitle !== true;
}

/*
    A language may use a font from the system font library (System Settings >
    System Fonts). The server then adds to its locale block fontCSS, the style
    sheet declaring that font, relative to the locale file. It is linked once
    per document; reload=true reloads it after the font choice changed.
*/
function applocaleLinkFonts(localeFile, block, reload){
    if (typeof document === "undefined" || !block || !block.fontCSS){
        return;
    }
    var href;
    try {
        href = new URL(block.fontCSS, new URL(localeFile, document.baseURI)).href;
    } catch (e) {
        return;
    }
    var link = document.getElementById("applocale-fonts");
    if (!link){
        link = document.createElement("link");
        link.id = "applocale-fonts";
        link.rel = "stylesheet";
        document.head.appendChild(link);
    } else if (!reload){
        return;
    }
    link.href = reload ? href + (href.indexOf("?") >= 0 ? "&" : "?") + "v=" + Date.now() : href;
}

/*
    The system font (systemFont in the locale block, picked in System Fonts)
    applies to the whole page through CSS rather than inline styles, so text
    an app creates later gets it too:
      - every font-family rule of the page's style sheets that asks for a
        general UI font (below) gets the system font in front of its own list,
        with the same selector, so it wins by coming later;
      - the page root and form controls without a font of their own follow it.
    Rules naming any other font (monospace, icon fonts, an app's own web
    fonts or var()) are the app's choice and stay as they are. Style sheets
    added later are handled when they load.
*/
var APPLOCALE_UI_FONTS = [
    "sans-serif", "system-ui", "-apple-system", "blinkmacsystemfont", "segoe ui", "helvetica neue",
    "helvetica", "arial", "lato", "roboto", "ubuntu", "cantarell", "tahoma", "verdana", "sf pro text",
    "noto sans", "open sans", "arial unicode ms", "microsoft jhenghei", "microsoft jhenghei ui",
    "microsoft yahei", "microsoft yahei ui", "simhei", "apple ligothic medium", "stheiti", "stxihei",
    "pingfang tc", "pingfang hk", "pingfang sc", "pingfangsc-medium", "hiragino sans",
    "hiragino kaku gothic pro", "meiryo", "meiryo ui", "yu gothic", "yu gothic ui",
    "malgun gothic", "apple sd gothic neo", "nanum gothic"
];

var applocaleSystemFontState = null;

function applocaleNamesUIFont(fontFamily){
    var first = String(fontFamily).split(",")[0].trim().replace(/^["']|["']$/g, "").toLowerCase();
    return APPLOCALE_UI_FONTS.indexOf(first) >= 0;
}

// applocaleFontOverrides returns the override rules for a list of CSS rules
function applocaleFontOverrides(rules, family){
    var out = "";
    for (var i = 0; i < rules.length; i++){
        var rule = rules[i];
        if (typeof CSSStyleRule !== "undefined" && rule instanceof CSSStyleRule){
            var value = rule.style.getPropertyValue("font-family");
            if (value && applocaleNamesUIFont(value)){
                var important = rule.style.getPropertyPriority("font-family") ? " !important" : "";
                out += rule.selectorText + "{font-family:" + family + ", " + value + important + "}\n";
            }
        } else if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule){
            var media = applocaleFontOverrides(rule.cssRules, family);
            if (media) out += "@media " + rule.conditionText + "{\n" + media + "}\n";
        } else if (typeof CSSSupportsRule !== "undefined" && rule instanceof CSSSupportsRule){
            var supports = applocaleFontOverrides(rule.cssRules, family);
            if (supports) out += "@supports " + rule.conditionText + "{\n" + supports + "}\n";
        }
    }
    return out;
}

// applocaleRefreshSystemFont rebuilds the override style sheet, keeping it last
function applocaleRefreshSystemFont(){
    var state = applocaleSystemFontState;
    if (!state){
        return;
    }
    var css = ":where(html){font-family:" + state.stack + "}\n" +
        ":where(button, input, select, textarea){font-family:inherit}\n";
    for (var i = 0; i < document.styleSheets.length; i++){
        var sheet = document.styleSheets[i];
        if (sheet.ownerNode === state.style){
            continue;
        }
        var cached = state.done.get(sheet);
        if (cached === undefined){
            try {
                cached = applocaleFontOverrides(sheet.cssRules, state.family);
            } catch (e) {
                cached = ""; //another origin, or not loaded yet (it is redone on load)
            }
            if (sheet.cssRules && sheet.cssRules.length > 0){
                state.done.set(sheet, cached);
            }
        }
        css += cached;
    }
    if (state.style.textContent !== css){
        state.style.textContent = css;
    }
    var parent = document.body || document.head;
    if (parent && parent.lastChild !== state.style){
        parent.appendChild(state.style);
    }
}

function applocaleUseSystemFont(block){
    if (typeof document === "undefined" || !block || !block.systemFont || !applocaleInjectsFont()){
        return false;
    }
    var family = '"' + String(block.systemFont).replace(/["\\]/g, "") + '"';
    var state = applocaleSystemFontState;
    if (state && state.family === family){
        return true;
    }
    if (!state){
        var style = document.createElement("style");
        style.id = "applocale-system-font";
        state = applocaleSystemFontState = { style: style, done: new WeakMap() };
        var timer = null;
        var schedule = function(){
            clearTimeout(timer);
            timer = setTimeout(applocaleRefreshSystemFont, 30);
        };
        //Style sheets added later: rescan once they are in (links: once loaded)
        new MutationObserver(function(records){
            records.forEach(function(r){
                r.addedNodes.forEach(function(node){
                    if (node === style || node.nodeType !== 1){
                        return;
                    }
                    var sheets = (node.matches && node.matches("style, link[rel~=stylesheet]")) ? [node] : (node.querySelectorAll ? node.querySelectorAll("style, link[rel~=stylesheet]") : []);
                    Array.prototype.forEach.call(sheets, function(s){
                        if (s.tagName === "LINK"){
                            s.addEventListener("load", schedule);
                        }
                        schedule();
                    });
                });
            });
        }).observe(document.documentElement, { childList: true, subtree: true });
        Array.prototype.forEach.call(document.querySelectorAll("link[rel~=stylesheet]"), function(link){
            link.addEventListener("load", schedule);
        });
    }
    state.family = family;
    state.stack = block.fontFamily || family;
    state.done = new WeakMap();
    applocaleRefreshSystemFont();
    return true;
}

function NewAppLocale(){
    return {
        lang: (localStorage.getItem('global_language') == null || localStorage.getItem('global_language') == "default" ? navigator.language : localStorage.getItem('global_language')).toLowerCase(),
        localeFile: "",
        localData: {},
        init: function(localeFile, callback = undefined, onError = undefined) {
            this.localeFile = localeFile;
            let targetApplocaleObject = this;
            $.ajax({
                dataType: "json",
                url: localeFile,
                error: function() {
                    //Locale file missing or invalid. Let the page start with its built-in strings
                    if (onError != undefined) {
                        onError();
                    }
                },
                success: function(data) {
                    targetApplocaleObject.localData = data;
                    if (data && data.keys) {
                        applocaleLinkFonts(localeFile, data.keys[targetApplocaleObject.lang]);
                    }
                    if (callback != undefined) {
                        callback(data);
                    }
                    
                    if (applocaleSetsWindowTitle() && data.keys[targetApplocaleObject.lang] != undefined && data.keys[targetApplocaleObject.lang].fwtitle != undefined && data.keys[targetApplocaleObject.lang].fwtitle != "" && ao_module_virtualDesktop) {
                        //Update the floatwindow title as well
                        ao_module_setWindowTitle(data.keys[targetApplocaleObject.lang].fwtitle);
                    }
    
                    if (data.keys && applocaleUseSystemFont(data.keys[targetApplocaleObject.lang])) {
                        //A system font: applied through CSS (applocaleUseSystemFont), not inline
                    } else if (applocaleInjectsFont() && data.keys[targetApplocaleObject.lang] != undefined && data.keys[targetApplocaleObject.lang].fontFamily != undefined){
                        //This language has a prefered font family. Inject it
                        $("h1, h2, h3, p, span, div, a, button").css({
                            "font-family":data.keys[targetApplocaleObject.lang].fontFamily
                        });
                        console.log("[Applocale] Updating font family to: ", data.keys[targetApplocaleObject.lang].fontFamily)
                    }
                  
                }
            });
        },
        translate: function(targetLang = "") {
            var targetLang = targetLang || this.lang;
            //Check if the given locale exists
            if (this.localData == undefined || this.localData.keys === undefined || this.localData.keys[targetLang] == undefined) {
                console.log("[Applocale] This language is not supported. Using default")
                return
            }
    
            //Update the page content to fit the localization
            let hasTitleLocale = (this.localData.keys[targetLang].titles !== undefined);
            let hasStringLocale = (this.localData.keys[targetLang].strings !== undefined);
            let hasPlaceHolderLocale = (this.localData.keys[targetLang].placeholder !== undefined);
            let localizedDataset =  this.localData.keys[targetLang];
            $("*").each(function() {
                if ($(this).attr("title") != undefined && hasTitleLocale) {
                    let targetString = localizedDataset.titles[$(this).attr("title")];
                    if (targetString != undefined) {
                        $(this).attr("title", targetString);
                    }
    
                }
    
                if ($(this).attr("locale") != undefined && hasStringLocale) {
                    let targetString = localizedDataset.strings[$(this).attr("locale")];
                    if (targetString != undefined) {
                        $(this).html(targetString);
                    }
                }
    
                if ($(this).attr("placeholder") != undefined && hasPlaceHolderLocale) {
                    let targetString = localizedDataset.placeholder[$(this).attr("placeholder")];
                    if (targetString != undefined) {
                        $(this).attr("placeholder", targetString);
                    }
                }
            })
    
            if (applocaleInjectsFont() && this.localData.keys[this.lang] != undefined && this.localData.keys[this.lang].fontFamily != undefined && !this.localData.keys[this.lang].systemFont){
                //This language has a prefered font family. Inject it
                $("h1, h2, h3, h4, h5, p, span, div, a").css({
                    "font-family":this.localData.keys[this.lang].fontFamily
                });
            }
        },
        getString: function(key, original, type = "strings") {
            var targetLang = this.lang;
            if (this.localData.keys === undefined || this.localData.keys[targetLang] == undefined) {
                return original;
            }
            let targetString = this.localData.keys[targetLang].strings[key];
            if (targetString != undefined) {
                return targetString
            } else {
                return original
            }
        },
        applyFontStyle: function(target){
            $(target).css({
                "font-family":applocale.localData.keys[applocale.lang].fontFamily
            })
        }
    }
}

if (applocale == undefined){
    //Only allow once instance of global applocale obj
    var applocale = NewAppLocale();
}
