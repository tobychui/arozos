/*
    Application Locale Module
    author: tobychui
    contributor: GT610

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

function NewAppLocale() {
    return {
        lang: (localStorage.getItem('global_language') == null || localStorage.getItem('global_language') == "default" ? navigator.language : localStorage.getItem('global_language')).toLowerCase(),
        localeFile: "",
        localData: {},
        _cache: new Map(), // Cache layer
        _observer: null,  // MutationObserver

        init: function(localeFile, callback) {
            // Check memory cache
            if (this._cache.has(localeFile)) {
                this.localData = this._cache.get(localeFile);
                if (callback) callback(this.localData);
                return;
            }

            let targetApplocaleObject = this;
            $.ajax({
                dataType: "json",
                url: localeFile,
                success: function(data) {
                    targetApplocaleObject._cache.set(localeFile, data); // Cache result
                    targetApplocaleObject.localData = data;
                    
                    // Automatically observe DOM changes
                    if (!targetApplocaleObject._observer) {
                        targetApplocaleObject._observer = new MutationObserver(mutations => {
                            mutations.forEach(mutation => {
                                $(mutation.addedNodes).find('[locale]').addBack('[locale]').each(function() {
                                    targetApplocaleObject._translateElement(this);
                                });
                            });
                        });
                        targetApplocaleObject._observer.observe(document, {
                            subtree: true,
                            childList: true
                        });
                    }

                    if (data.keys[targetApplocaleObject.lang]?.fwtitle && ao_module_virtualDesktop) {
                        ao_module_setWindowTitle(data.keys[targetApplocaleObject.lang].fwtitle);
                    }
                    
                    if (data.keys[targetApplocaleObject.lang]?.fontFamily) {
                        $("body").css("font-family", data.keys[targetApplocaleObject.lang].fontFamily);
                    }

                    callback && callback(data);
                }
            });
        },

        translate: function(targetLang = "") {
            const lang = targetLang || this.lang;
            if (lang === 'en-us') return; // Don't translate English
            if (!this.localData || !this.localData.keys?.[lang]) {
                console.warn(`[Applocale] failed to load language ${lang}, falling back to default`);
                return;
            }

            // Optimize selector performance
            const elements = document.querySelectorAll('[locale], [data-i18n]');
            elements.forEach(el => this._translateElement(el));
        },

        // Use private method to translate element
        _translateElement: function(el) {
            const localized = this.localData.keys[this.lang];
            const attr = el.getAttribute('locale') || el.getAttribute('data-i18n');
            
            if (el.hasAttribute('title') && localized?.titles?.[attr]) {
                el.title = localized.titles[attr];
            }
            if (localized?.strings?.[attr]) {
                el.textContent = localized.strings[attr];
            }
            if (el.placeholder && localized?.placeholder?.[attr]) {
                el.placeholder = localized.placeholder[attr];
            }
        },

        // API
        getString: function(key, original) {
            if (this.lang === 'en-us') return original; // Directly return original if English
            if (!!this.localData ){
                return original;
            }
            return this.localData.keys[this.lang]?.strings?.[key] || original;
        }
    };
}

if (typeof applocale === 'undefined') {
    var applocale = NewAppLocale();
}
