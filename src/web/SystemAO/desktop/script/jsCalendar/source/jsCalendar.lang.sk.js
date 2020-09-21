/*
 * jsCalendar language extension
 * Add Slovak Language support
 * Translator: Grammatopoulos Apostolos (greatapo@github)
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
        code : 'sk',
        // Months of the year
        months : [
            'Január',
            'Február',
            'Marec',
            'Apríl',
            'Máj',
            'Jún',
            'Júl',
            'August',
            'September',
            'Október',
            'November',
            'December'
        ],
        // Days of the week
        days : [
            'Nedeľa',
            'Pondelok',
            'Utorok',
            'Streda',
            'Štvrtok',
            'Piatok',
            'Sobota'
        ]
    });

})();
