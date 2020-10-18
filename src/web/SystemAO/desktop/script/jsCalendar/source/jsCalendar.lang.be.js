/*
 * jsCalendar language extension
 * Add Belarusian Language support
 * Translator: Alexander Vorvule (vorvule@github)
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
        code : 'be',
        // Months of the year
        months : [
            'Студзень',
            'Люты',
            'Сакавік',
            'Красавік',
            'Травень',
            'Чэрвень',
            'Ліпень',
            'Жнівень',
            'Верасень',
            'Кастрычнік',
            'Лістапад',
            'Снежань'
        ],
        // Days of the week
        days : [
            'Нядзеля',
            'Панядзелак',
            'Аўторак',
            'Серада',
            'Чацвер',
            'Пятніца',
            'Субота'
        ]
    });

})();
