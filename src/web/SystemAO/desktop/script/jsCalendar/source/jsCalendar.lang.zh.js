/*
 * jsCalendar language extension
 * Add Chinese Language support
 * Translator: Lucas Suehara (BlackEgg@github)
 */

// We love anonymous functions
(function(){

    // Get library
    var jsCalendar = window.jsCalendar;

    // If jsCalendar is not loaded
    if (typeof jsCalendar === 'undefined') {
        // If there is no language to load array
        if (typeof window.jsCalendar_language2load === 'undefined') {
            window.jsCalendar_language2load = [];
        }
        // Wrapper to add language to load list
        jsCalendar = {
            addLanguage : function (language) {
                // Add language to load list
                window.jsCalendar_language2load.push(language);
            }
        };
    }

    // Add a new language
    jsCalendar.addLanguage({
        // Language code
        code : 'zh',
        // Months of the year
        months : [
            '一月',
            '二月',
            '三月',
            '四月',
            '五月',
            '六月',
            '七月',
            '八月',
            '九月',
            '十月',
            '十一月',
            '十二月'
        ],
        // Days of the week
        days : [
            '星期日',
            '星期一',
            '星期二',
            '星期三',
            '星期四',
            '星期五',
            '星期六'
        ],

        // Overwrite day string format rules
        dayStringParser : function(key, day) {
            switch(key) {
                case 'DD':
                case 'dd':
                case 'D':
                    return this.days[day].substring(2, 3);
            }
        }
    });

})();
