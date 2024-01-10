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
        });
    }
*/

function NewAppLocale(){
    return {
        lang: (localStorage.getItem('global_language') == null || localStorage.getItem('global_language') == "default" ? navigator.language : localStorage.getItem('global_language')).toLowerCase(),
        localeFile: "",
        localData: {},
        init: function(localeFile, callback = undefined) {
            this.localeFile = localeFile;
            let targetApplocaleObject = this;
            $.ajax({
                dataType: "json",
                url: localeFile,
                success: function(data) {
                    targetApplocaleObject.localData = data;
                    if (callback != undefined) {
                        callback(data);
                    }
                    
                    if (data.keys[targetApplocaleObject.lang] != undefined && data.keys[targetApplocaleObject.lang].fwtitle != undefined && data.keys[targetApplocaleObject.lang].fwtitle != "" && ao_module_virtualDesktop) {
                        //Update the floatwindow title as well
                        ao_module_setWindowTitle(data.keys[targetApplocaleObject.lang].fwtitle);
                    }
    
                    if (data.keys[targetApplocaleObject.lang] != undefined && data.keys[targetApplocaleObject.lang].fontFamily != undefined){
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
    
            if (this.localData.keys[this.lang] != undefined && this.localData.keys[this.lang].fontFamily != undefined){
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
