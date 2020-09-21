/*
 * jsCalendar v1.4.4
 *
 *
 * MIT License
 *
 * Copyright (c) 2019 Grammatopoulos Athanasios-Vasileios
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

var jsCalendar = (function(){

    // Constructor
    function JsCalendar(){
        // No parameters
        if (arguments.length === 0) {
            // Do nothing
            return;
        }
        else {
            // Construct calendar
            this._construct(arguments);
        }
    }

    // Version
    JsCalendar.version = 'v1.4.4';

    // Sub-Constructor
    JsCalendar.prototype._construct = function(args) {
        // Parse arguments
        args = this._parseArguments(args);
        // Set a target
        this._setTarget(args.target);
        // Init calendar
        this._init(args.options);
        // Init target
        this._initTarget();
        // Set date
        this._setDate(
            (args.date !== null) ? args.date :
            (this._target.dataset.hasOwnProperty('date')) ? this._target.dataset.date :
            new Date()
        );
        // If invalid date
        if (!this._now) throw new Error('jsCalendar: Date is outside range.');
        // Create
        this._create();
        // Update
        this._update();
    };

    // Languages
    JsCalendar.prototype.languages = {
        // Default English language
        en : {
            // Months Names
            months : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
            // Days Names
            days : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
            // Default handlers
            _dateStringParser : function(key, date) {return JsCalendar._defaultDateStringParser(key, date, this);},
            _dayStringParser : function(key, date) {return JsCalendar._defaultDayStringParser(key, date, this);}
        }
    };

    // Init calendar
    JsCalendar.prototype._init = function(options) {
        // Init elements object
        this._elements = {};
        // Events init
        this._events = {};
        this._events.date = [];
        this._events.month = [];
        this._events.day_render = [];
        this._events.date_render = [];
        this._events.month_render = [];
        // Dates variables
        this._now = null;
        this._date = null;
        this._selected = [];
        // Language object
        this.language = {};
        // Parse options
        this._parseOptions(options);
    };

    // Parse options
    JsCalendar.prototype._parseArguments = function(args) {
        // Arguments object
        var obj = {
            target : null,
            date : null,
            options : {}
        };

        // If no arguments
        if (args.length === 0) {
            // Throw an error
            throw new Error('jsCalendar: No parameters were given.');
        }

        // Only 1 argument
        else if (args.length === 1) {

            // If target element
            if (
                (
                    // If html element
                    ((typeof HTMLElement === 'object') ? (args[0] instanceof HTMLElement) : args[0]) &&
                    (typeof args[0] === 'object') && (args[0] !== null) && (args[0].nodeType === 1) &&
                    (typeof args[0].nodeName === 'string')
                ) || (
                    // Or string
                    typeof args[0] === 'string'
                )
            ) {
                obj.target = args[0];
            }

            // Options argument
            else {
                // Init arguments
                obj.options = args[0];
                // Get target
                if (typeof args[0].target !== 'undefined') {
                    obj.target = args[0].target;
                }
                else {
                    // Throw an error
                    throw new Error('jsCalendar: Not target was given.');
                }
                // Get date
                if (typeof args[0].date !== 'undefined') {
                    obj.date = args[0].date;
                }
            }
        }

        // Many arguments
        else {

            // First is target
            obj.target = args[0];

            // If date
            if (args.length >= 2) {
                obj.date = args[1];
            }

            // If options
            if (args.length >= 3) {
                obj.options = args[2];
            }

        }

        // Return object
        return obj;
    };

    // Default options
    JsCalendar.options = {
        language : 'en',
        zeroFill : false,
        monthFormat : 'month',
        dayFormat : 'D',
        firstDayOfTheWeek : 1,
        navigator : true,
        navigatorPosition : 'both',
        min : false,
        max : false,
        onMonthRender : false,
        onDayRender : false,
        onDateRender : false
    };

    // Parse options
    JsCalendar.prototype._parseOptions = function(doptions) {
        // Options Object
        this._options = {};
        // Input options object (dirty)
        var options = {};

        // Load default and input options
        for (var item in JsCalendar.options) {
            // Default options
            if (JsCalendar.options.hasOwnProperty(item)) {
                this._options[item] = JsCalendar.options[item];
            }
            // Dynamic options
            if (doptions.hasOwnProperty(item)) {
                options[item] = doptions[item];
            }
            // Dataset options
            else if (this._target.dataset.hasOwnProperty(item)) {
                options[item] = this._target.dataset[item];
            }
        }

        // Check options
        if (typeof options.zeroFill !== 'undefined'){
            if (options.zeroFill === 'false' || !options.zeroFill) {
                this._options.zeroFill = false;
            }
            else {
                this._options.zeroFill = true;
            }
        }
        if (typeof options.monthFormat !== 'undefined'){
            this._options.monthFormat = options.monthFormat;
        }
        if (typeof options.dayFormat !== 'undefined'){
            this._options.dayFormat = options.dayFormat;
        }
        if (typeof options.navigator !== 'undefined'){
            if (options.navigator === 'false' || !options.navigator) {
                this._options.navigator = false;
            }
            else {
                this._options.navigator = true;
            }
        }
        if (typeof options.navigatorPosition !== 'undefined'){
            this._options.navigatorPosition = options.navigatorPosition;
        }

        // Language
        if (typeof options.language === 'string' && typeof this.languages[options.language] !== 'undefined'){
            this._options.language = options.language;
        }
        // Set language
        this.setLanguage(this._options.language);

        // Set first day of the week
        if (typeof options.fdotw !== 'undefined'){
            options.firstDayOfTheWeek = options.fdotw;
        }
        if (typeof options.firstDayOfTheWeek !== 'undefined'){
            // If day number
            if (typeof options.firstDayOfTheWeek === 'number') {
                // Range check (no need to check for bigger than 7 but I don't trust anyone)
                if (options.firstDayOfTheWeek >= 1 && options.firstDayOfTheWeek <= 7) {
                    this._options.firstDayOfTheWeek = options.firstDayOfTheWeek;
                }
            }
            // If string
            if (typeof options.firstDayOfTheWeek === 'string') {
                // If day number
                if (options.firstDayOfTheWeek.match(/^[1-7]$/)) {
                    this._options.firstDayOfTheWeek = parseInt(options.firstDayOfTheWeek, 10);
                }
                // else use it as a day name
                else {
                    // So find day
                    this._options.firstDayOfTheWeek = this.language.days.indexOf(options.firstDayOfTheWeek) + 1;

                    // Range check (no need to check for bigger then 7 but I don't trust anyone)
                    if (this._options.firstDayOfTheWeek < 1 || this._options.firstDayOfTheWeek > 7) {
                        this._options.firstDayOfTheWeek = 1;
                    }
                }
            }
        }

        // Set min calendar date
        if (typeof options.min !== 'undefined' && options.min !== 'false' && options.min !== false) {
            // Parse date
            this._options.min = tools.parseDate(options.min);
        }
        // Set max calendar date
        if (typeof options.max !== 'undefined' && options.max !== 'false' && options.max !== false) {
            // Parse date
            this._options.max = tools.parseDate(options.max);
        }
        
        // Set render handlers
        if (typeof options.onMonthRender !== 'undefined') {
            // Passed as function name string
            if (
                typeof options.onMonthRender === 'string' &&
                typeof window[options.onMonthRender] === 'function'
            ) {
                this._on('month_render', window[options.onMonthRender]);
            }
            // Passed as function
            else if (typeof options.onMonthRender === 'function') {
                this._on('month_render', options.onMonthRender);
            }
        }
        if (typeof options.onDayRender !== 'undefined') {
            // Passed as function name string
            if (
                typeof options.onDayRender === 'string' &&
                typeof window[options.onDayRender] === 'function'
            ) {
                this._on('day_render', window[options.onDayRender]);
            }
            // Passed as function
            else if (typeof options.onDayRender === 'function') {
                this._on('day_render', options.onDayRender);
            }
        }
        if (typeof options.onDateRender !== 'undefined') {
            // Passed as function name string
            if (
                typeof options.onDateRender === 'string' &&
                typeof window[options.onDateRender] === 'function'
            ) {
                this._on('date_render', window[options.onDateRender]);
            }
            // Passed as function
            else if (typeof options.onDateRender === 'function') {
                this._on('date_render', options.onDateRender);
            }
        }
    };

    // Set target
    JsCalendar.prototype._setTarget = function(element) {
        // Parse target
        var target = tools.getElement(element);
        // If target not found
        if (!target) {
            // Throw an error
            throw new Error('jsCalendar: Target was not found.');
        }
        else {
            // Save element
            this._target = target;

            // Link object to list
            var id = this._target.id;
            if (id && id.length > 0) {
                jsCalendarObjects['#' + id] = this;
            }
        }
    };

    // Init target
    JsCalendar.prototype._initTarget = function() {
        // Add class
        if (this._target.className.length > 0){
            this._target.className += ' ';
        }
        this._target.className += 'jsCalendar';

        // Create table
        this._elements.table = document.createElement('table');
        // Create table header
        this._elements.head = document.createElement('thead');
        this._elements.table.appendChild(this._elements.head);
        // Create table body
        this._elements.body = document.createElement('tbody');
        this._elements.table.appendChild(this._elements.body);

        // Insert on page
        this._target.appendChild(this._elements.table);
    };

    // Check if date in range
    JsCalendar.prototype._isDateInRange = function(date) {
        // If no range
        if (this._options.min === false && this._options.max === false) {
            return true;
        }

        // Parse date
        date = tools.parseDate(date);
        
        // Check min
        if (this._options.min !== false && this._options.min.getTime() > date.getTime()) {
            return false;
        }
        // Check max
        if (this._options.max !== false && this._options.max.getTime() < date.getTime()) {
            return false;
        }

        // In range
        return true;
    };

    // Set a Date
    JsCalendar.prototype._setDate = function(date) {
        // Parse date
        date = tools.parseDate(date);
        // Check date not in range
        if (!this._isDateInRange(date)) {
            return;
        }
        // Set data
        this._now = date;
        this._date = new Date(this._now.getFullYear(), this._now.getMonth(), 1);
    };

    // Convert to date string
    JsCalendar.prototype._parseToDateString = function(date, format) {
        var lang = this.language;
        return format.replace(/(MONTH|month|MMM|mmm|mm|m|MM|M|DAY|day|DDD|ddd|dd|d|DD|D|YYYY|yyyy)/g, function(key) {
            return lang.dateStringParser(key, date);
        });
    };

    // Get visible month
    JsCalendar.prototype._getVisibleMonth = function(date) {
        // For date
        if (typeof date === 'undefined') {
            // Get saved date
            date = this._date;
        }
        else {
            date = tools.parseDate(date);
        }

        // Get month's first day
        var first = new Date(date.getTime());
        first.setDate(1);

        // First day of the month index
        var firstDay = first.getDay() - (this._options.firstDayOfTheWeek - 1);
        if (firstDay < 0) {
            firstDay += 7;
        }

        // Get month's name
        var lang = this.language;
        var name = this._options.monthFormat.replace(/(MONTH|month|MMM|mmm|##|#|YYYY|yyyy)/g, function(key) {
            return lang.dateStringParser(key, first);
        });

        // Get visible days
        var days = this._getVisibleDates(date);
        var daysInMonth = new Date(first.getYear() + 1900, first.getMonth() + 1, 0).getDate();

        var current = -1;
        // If this is the month
        if (first.getYear() === this._now.getYear() && first.getMonth() === this._now.getMonth()) {
            // Calculate current
            current = firstDay + this._now.getDate() - 1;
        }

        // Return object
        return {
            name : name,
            days : days,
            start : firstDay + 1,
            current : current,
            end : firstDay + daysInMonth
        };
    };

    // Get visible dates
    JsCalendar.prototype._getVisibleDates = function(date) {
        // For date
        if (typeof date === 'undefined') {
            // Get saved date
            date = this._date;
        }
        else {
            date = tools.parseDate(date);
        }

        // Visible days array
        var dates = [];
        // Get first day of the month
        var first = new Date(date.getTime());
        first.setDate(1);
        first.setHours(0, 0, 0, 0);

        // Count days of previous month to show
        var previous = first.getDay() - (this._options.firstDayOfTheWeek - 1);
        if (previous < 0) {
            previous += 7;
        }
        // Set day to month's first
        var day = new Date(first.getTime());
        // Previous month's days
        while (previous > 0) {
            // Calculate previous day
            day.setDate(day.getDate() - 1);
            // Add page on frond of the list
            dates.unshift(new Date(day.getTime()));
            // Previous
            previous --;
        }

        // Set day to month's first
        day = new Date(first.getTime());
        // This month's days
        do {
            // Add page on back of the list
            dates.push(new Date(day.getTime()));
            // Calculate next day
            day.setDate(day.getDate() + 1);
            // Repeat until next month
        } while (day.getDate() !== 1);

        // Next month's days
        var next = 42 - dates.length;
        // Add days left
        while (next > 0) {
            // Add page on back of the list
            dates.push(new Date(day.getTime()));
            // Calculate next day
            day.setDate(day.getDate() + 1);
            // Next
            next --;
        }

        // Return days
        return dates;
    };

    // Create calendar
    JsCalendar.prototype._create = function() {
        var i, j;
        // Save instance
        var that = this;

        // Set created flag
        this._elements.created = true;

        // Head rows
        this._elements.headRows = [];
        for (i = 0; i < 2; i++) {
            this._elements.headRows.push(document.createElement('tr'));
            this._elements.head.appendChild(this._elements.headRows[i]);
        }

        // Month row
        var title_header = document.createElement('th');
        title_header.setAttribute('colspan', 7);
        this._elements.headRows[0].className = 'jsCalendar-title-row';
        this._elements.headRows[0].appendChild(title_header);

        this._elements.headLeft = document.createElement('div');
        this._elements.headLeft.className = 'jsCalendar-title-left';
        title_header.appendChild(this._elements.headLeft);
        this._elements.month = document.createElement('div');
        this._elements.month.className = 'jsCalendar-title-name';
        title_header.appendChild(this._elements.month);
        this._elements.headRight = document.createElement('div');
        this._elements.headRight.className = 'jsCalendar-title-right';
        title_header.appendChild(this._elements.headRight);

        // Navigation
        if (this._options.navigator) {
            this._elements.navLeft = document.createElement('div');
            this._elements.navLeft.className = 'jsCalendar-nav-left';
            this._elements.navRight = document.createElement('div');
            this._elements.navRight.className = 'jsCalendar-nav-right';

            if (this._options.navigatorPosition === 'left') {
                this._elements.headLeft.appendChild(this._elements.navLeft);
                this._elements.headLeft.appendChild(this._elements.navRight);
            }
            else if (this._options.navigatorPosition === 'right') {
                this._elements.headRight.appendChild(this._elements.navLeft);
                this._elements.headRight.appendChild(this._elements.navRight);
            }
            else {
                this._elements.headLeft.appendChild(this._elements.navLeft);
                this._elements.headRight.appendChild(this._elements.navRight);
            }

            // Event listeners
            this._elements.navLeft.addEventListener('click', function(event){
                that.previous();
                var date = new Date(that._date.getTime());
                date.setDate(1);
                that._eventFire('month', date, event);
            }, false);
            this._elements.navRight.addEventListener('click', function(event){
                that.next();
                var date = new Date(that._date.getTime());
                date.setDate(1);
                that._eventFire('month', date, event);
            }, false);
        }

        // Days row
        this._elements.headRows[1].className = 'jsCalendar-week-days';
        title_header.className = 'jsCalendar-title';
        this._elements.days = [];
        for (i = 0; i < 7; i++) {
            this._elements.days.push(document.createElement('th'));
            this._elements.headRows[1].appendChild(this._elements.days[
                this._elements.days.length - 1
            ]);
        }

        // Body rows
        this._elements.bodyRows = [];
        this._elements.bodyCols = [];
        // 6 rows
        for (i = 0; i < 6; i++) {
            this._elements.bodyRows.push(document.createElement('tr'));
            this._elements.body.appendChild(this._elements.bodyRows[i]);
            // 7 days
            for (j = 0; j < 7; j++) {
                this._elements.bodyCols.push(document.createElement('td'));
                this._elements.bodyRows[i].appendChild(this._elements.bodyCols[i * 7 + j]);
                this._elements.bodyCols[i * 7 + j].addEventListener('click', (function(index){
                    return function (event) {
                        that._eventFire('date', that._active[index], event);
                    };
                })(i * 7 + j), false);
            }
        }
    };

    // Select dates on calendar
    JsCalendar.prototype._selectDates = function(dates) {
        // Copy array instance
        dates = dates.slice();

        // Parse dates
        for (var i = 0; i < dates.length; i++) {
            dates[i] = tools.parseDate(dates[i]);
            dates[i].setHours(0, 0, 0, 0);
            dates[i] = dates[i].getTime();
        }

        // Insert dates on array
        for (i = dates.length - 1; i >= 0; i--) {
            // If not already selected
            if (this._selected.indexOf(dates[i]) < 0) {
                this._selected.push(dates[i]);
            }
        }
    };

    // Un-select dates on calendar
    JsCalendar.prototype._unselectDates = function(dates) {
        // Copy array instance
        dates = dates.slice();

        // Parse dates
        for (var i = 0; i < dates.length; i++) {
            dates[i] = tools.parseDate(dates[i]);
            dates[i].setHours(0, 0, 0, 0);
            dates[i] = dates[i].getTime();
        }

        // Remove dates of the array
        var index;
        for (i = dates.length - 1; i >= 0; i--) {
            // If selected
            index = this._selected.indexOf(dates[i]);
            if (index >= 0) {
                this._selected.splice(index, 1);
            }
        }
    };

    // Unselect all dates on calendar
    JsCalendar.prototype._unselectAllDates = function() {
        // While not empty
        while (this._selected.length) {
            this._selected.pop();
        }
    };

    // Update calendar
    JsCalendar.prototype._update = function() {
        // Get month info
        var month = this._getVisibleMonth(this._date);
        // Save data
        this._active = month.days.slice();
        // Update month name
        this._elements.month.textContent = month.name;

        // Check zeros filling
        var prefix = (this._options.zeroFill) ? '0' : '';

        // Populate days
        var text;
        for (var i = month.days.length - 1; i >= 0; i--) {
            text = month.days[i].getDate();
            this._elements.bodyCols[i].textContent = (text < 10 ? prefix + text : text);

            // If date is selected
            if (this._selected.indexOf(month.days[i].getTime()) >= 0) {
                this._elements.bodyCols[i].className = 'jsCalendar-selected';
            }
            else {
                this._elements.bodyCols[i].removeAttribute('class');
            }
        }

        // Previous month
        for (i = 0; i < month.start - 1; i++) {
            this._elements.bodyCols[i].className = 'jsCalendar-previous';
        }
        // Current day
        if (month.current >= 0) {
            if (this._elements.bodyCols[month.current].className.length > 0) {
                this._elements.bodyCols[month.current].className += ' jsCalendar-current';
            }
            else {
                this._elements.bodyCols[month.current].className = 'jsCalendar-current';
            }
        }
        // Next month
        for (i = month.end; i < month.days.length; i++) {
            this._elements.bodyCols[i].className = 'jsCalendar-next';
        }

        // Set days of the week locale
        for (i = 0; i < 7; i++) {
            var that = this;
            this._elements.days[i].textContent = this._options.dayFormat.replace(/(DAY|day|DDD|ddd|DD|dd|D)/g, function(key) {
                return that.language.dayStringParser(
                    key,
                    (i + that._options.firstDayOfTheWeek - 1) % 7
                );
            });
        }

        // Call render handlers
        var j;
        if (this._events.month_render.length > 0) {
            var date = month.days[month.start];
            // Clear any style
            this._elements.month.removeAttribute('style');
            // Call the render handlers
            for (j = 0; j < this._events.month_render.length; j++) {
                this._events.month_render[j].call(this,
                    // Month index
                    date.getMonth(),
                    // Pass the html element
                    this._elements.month,
                    // Info about that month
                    {
                        start : new Date(date.getTime()),
                        end : new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
                        numberOfDays : month.end - month.start + 1
                    }
                );
            }
        }
        if (this._events.day_render.length > 0) {
            for (i = 0; i < 7; i++) {
                // Clear any style
                this._elements.days[i].removeAttribute('style');
                // Call the render handler
                for (j = 0; j < this._events.day_render.length; j++) {
                    this._events.day_render[j].call(this,
                        // Day index
                        (i + this._options.firstDayOfTheWeek - 1) % 7,
                        // Pass the html element
                        this._elements.days[i],
                        // Info about that day
                        {
                            position : i
                        }
                    );
                }
            }
        }
        if (this._events.date_render.length > 0) {
            for (i = 0; i < month.days.length; i++) {
                // Clear any style
                this._elements.bodyCols[i].removeAttribute('style');
                // Call the render handler
                for (j = 0; j < this._events.date_render.length; j++) {
                    this._events.date_render[j].call(this,
                        // Date should be clonned
                        new Date(month.days[i].getTime()),
                        // Pass the html element
                        this._elements.bodyCols[i],
                        // Info about that date
                        {
                            isCurrent : (month.current == i),
                            isSelected : (this._selected.indexOf(month.days[i].getTime()) >= 0),
                            isPreviousMonth : (i < month.start),
                            isCurrentMonth : (month.start <= i && i <= month.end),
                            isNextMonth : (month.end < i),
                            position : {x: i%7, y: Math.floor(i/7)}
                        }
                    );
                }
            }
        }
    };

    // Fire all event listeners
    JsCalendar.prototype._eventFire = function(name, date, event) {
        if (!this._events.hasOwnProperty(name)) return;
        // Search events
        for (var i = 0; i < this._events[name].length; i++) {
            (function(callback, instance) {
                // Call asynchronous
                setTimeout(function(){
                    // Call callback
                    callback.call(instance, event, new Date(date.getTime()));
                }, 0);
            })(this._events[name][i], this);
        }
    };

    // Add a event listener
    // This method will be exposed on the future
    JsCalendar.prototype._on = function(name, callback) {
        // If callback is a function
        if(typeof callback === 'function'){
            // Add to the list
            this._events[name].push(callback);
        }

        // Not a function
        else {
            // Throw an error
            throw new Error('jsCalendar: Invalid callback function.');
        }

        // Return
        return this;
    };

    // Add a event listeners
    JsCalendar.prototype.onDateClick = function(callback) {
        return this._on('date', callback);
    };
    JsCalendar.prototype.onMonthChange = function(callback) {
        return this._on('month', callback);
    };
    JsCalendar.prototype.onDayRender = function(callback) {
        return this._on('day_render', callback);
    };
    JsCalendar.prototype.onDateRender = function(callback) {
        return this._on('date_render', callback);
    };
    JsCalendar.prototype.onMonthRender = function(callback) {
        return this._on('month_render', callback);
    };

    // Goto a date
    JsCalendar.prototype.set = function(date){
        // Set new date
        this._setDate(date);
        // Refresh
        this.refresh();

        // Return
        return this;
    };

    // Set min date
    JsCalendar.prototype.min = function(date){
        // If value
        if (date) {
            // Set min date
            this._options.min = tools.parseDate(date);
        }
        // Disable
        else {
            this._options.min = false;
        }

        // Refresh
        this.refresh();

        // Return
        return this;
    };

    // Set max date
    JsCalendar.prototype.max = function(date){
        // If value
        if (date) {
            // Set max date
            this._options.max = tools.parseDate(date);
        }
        // Disable
        else {
            this._options.max = false;
        }

        // Refresh
        this.refresh();

        // Return
        return this;
    };

    // Refresh
    // Safe _update
    JsCalendar.prototype.refresh = function(date) {
        // If date provided
        if (typeof date !== 'undefined') {
            // If date is in range
            if (this._isDateInRange(date)) {
                this._date = tools.parseDate(date);
            }
        }

        // If calendar elements ready
        if (this._elements.created === true) {
            this._update();
        }

        // Return
        return this;
    };

    // Next month
    JsCalendar.prototype.next = function(n){
        // Next number
        if (typeof n !== 'number') {
            n = 1;
        }

        // Calculate date
        var date = new Date(this._date.getFullYear(), this._date.getMonth() + n, 1);

        // If date is not in range
        if (!this._isDateInRange(date)) {
            return this;
        }

        // Set date
        this._date = date;
        this.refresh();

        // Return
        return this;
    };

    // Next month
    JsCalendar.prototype.previous = function(n){
        // Next number
        if (typeof n !== 'number') {
            n = 1;
        }

        // Calculate date (last day of previous month)
        var date = new Date(this._date.getFullYear(), this._date.getMonth() - n + 1, 0);

        // If date is not in range
        if (!this._isDateInRange(date)) {
            return this;
        }

        // Set date
        this._date = date;
        this.refresh();

        // Return
        return this;
    };

    // Goto a date
    JsCalendar.prototype.goto = function(date){
        this.refresh(date);

        // Return
        return this;
    };

    // Reset to the date
    JsCalendar.prototype.reset = function(){
        this.refresh(this._now);

        // Return
        return this;
    };

    // Select dates
    JsCalendar.prototype.select = function(dates){
        // If no arguments
        if (typeof dates === 'undefined') {
            // Return
            return this;
        }

        // If dates not array
        if (!(dates instanceof Array)) {
            // Lets make it an array
            dates = [dates];
        }
        // Select dates
        this._selectDates(dates);
        // Refresh
        this.refresh();

        // Return
        return this;
    };

    // Unselect dates
    JsCalendar.prototype.unselect = function(dates){
        // If no arguments
        if (typeof dates === 'undefined') {
            // Return
            return this;
        }

        // If dates not array
        if (!(dates instanceof Array)) {
            // Lets make it an array
            dates = [dates];
        }
        // Unselect dates
        this._unselectDates(dates);
        // Refresh
        this.refresh();

        // Return
        return this;
    };

    // Unselect all dates
    JsCalendar.prototype.clearselect = function(){
        // Unselect all dates
        this._unselectAllDates();
        // Refresh
        this.refresh();

        // Return
        return this;
    };
    // Unselect all dates (alias)
    JsCalendar.prototype.clearSelected = JsCalendar.prototype.clearselect;

    // Get selected dates
    JsCalendar.prototype.getSelected = function(options){
        // Check if no options
        if (typeof options !== 'object') {
            options = {};
        }

        // Copy selected array
        var dates = this._selected.slice();

        // Options - Sort array
        if (options.sort) {
            if (options.sort === true) {
                dates.sort();
            }
            else if (typeof options.sort === 'string') {
                if (options.sort.toLowerCase() === 'asc') {
                    dates.sort();
                }
                else if (options.sort.toLowerCase() === 'desc'){
                    dates.sort();
                    dates.reverse();
                }
            }
        }

        // Options - Data type
        if (options.type && typeof options.type === 'string') {
            var i;
            // Convert to date object
            if (options.type.toLowerCase() === 'date'){
                for (i = dates.length - 1; i >= 0; i--) {
                    dates[i] = new Date(dates[i]);
                }
            }
            // If not a timestamp - convert to custom format
            else if (options.type.toLowerCase() !== 'timestamp') {
                for (i = dates.length - 1; i >= 0; i--) {
                    dates[i] = this._parseToDateString(new Date(dates[i]), options.type);
                }
            }
        }

        // Return dates
        return dates;
    };

    // Check if date is selected
    JsCalendar.prototype.isSelected = function(date){
        // If no arguments or null
        if (typeof date === 'undefined' || date === null) {
            // Return
            return false;
        }

        // Parse date
        date = tools.parseDate(date);
        date.setHours(0, 0, 0, 0);
        date = date.getTime();

        // If selected
        if (this._selected.indexOf(date) >= 0) {
            return true;
        }
        // If not selected
        else {
            return false;
        }
    };

    // Check if date is visible in calendar
    JsCalendar.prototype.isVisible = function(date){
        // If no arguments or null
        if (typeof date === 'undefined' || date === null) {
            // Return
            return false;
        }

        // Parse date
        date = tools.parseDate(date);
        date.setHours(0, 0, 0, 0);
        date = date.getTime();

        // Get visible dates
        var visible = this._getVisibleDates();
        // Check if date is inside visible dates
        if (visible[0].getTime() <= date && visible[visible.length - 1].getTime() >= date) {
            return true;
        }
        // Not visible
        else {
            return false;
        }
    };

    // Check if date is in active month
    JsCalendar.prototype.isInMonth = function(date){
        // If no arguments or null
        if (typeof date === 'undefined' || date === null) {
            // Return
            return false;
        }

        // Parse date and get month
        var month = tools.parseDate(date);
        month.setHours(0, 0, 0, 0);
        month.setDate(1);

        // Parse active month date
        var active = tools.parseDate(this._date);
        active.setHours(0, 0, 0, 0);
        active.setDate(1);
        
        // If same month
        if (month.getTime() === active.getTime()) {
            return true;
        }
        // Other month
        else {
            return false;
        }
    };

    // Set language
    JsCalendar.prototype.setLanguage = function(code) {
        // Check if language exist
        if (typeof code !== 'string'){
            // Throw an error
            throw new Error('jsCalendar: Invalid language code.');
        }
        if (typeof this.languages[code] === 'undefined'){
            // Throw an error
            throw new Error('jsCalendar: Language not found.');
        }

        // Change language
        this._options.language = code;

        // Set new language as active
        var language = this.languages[code];
        this.language.months = language.months;
        this.language.days = language.days;
        this.language.dateStringParser = language._dateStringParser;
        this.language.dayStringParser = language._dayStringParser;

        // Refresh calendar
        this.refresh();

        // Return
        return this;
    };


    // Static foo methods (well... not really static)

    // Auto init calendars
    JsCalendar.autoFind = function() {
        // Get all auto-calendars
        var calendars = document.getElementsByClassName('auto-jsCalendar');
        // For each auto-calendar
        for (var i = 0; i < calendars.length; i++) {
            // If not loaded
            if (calendars[i].getAttribute('jsCalendar-loaded') !== 'true') {
                // Set as loaded
                calendars[i].setAttribute('jsCalendar-loaded', 'true');
                // Create
                new JsCalendar({target: calendars[i]});
            }
        }
    };
    
    // Tools
    var tools = JsCalendar.tools = {};
    // Parse to javascript date object
    tools.parseDate = function(date, silent) {
        // If set now date
        if (typeof date === 'undefined' || date === null || date === 'now') {
            // Get date now
            date = new Date();
        }

        // If date is string
        else if (typeof date === 'string') {
            // Parse date string
            date = date.replace(/-/g,'/').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4,4})$/i);
            // If match
            if (date !== null) {
                var month_index = parseInt(date[2], 10) - 1;
                // Parse date
                date = new Date(date[3], month_index, date[1]);
                // Check if date does not exist
                if (!date || date.getMonth() !== month_index) {
                    // Throw an error
                    if (!silent) throw new Error('jsCalendar: Date does not exist.');
                    return null;
                }
            }
            // Can't parse string
            else {
                // Throw an error
                if (!silent) throw new Error('jsCalendar: Failed to parse date.');
                return null;
            }
        }

        // If it is a number
        else if (typeof date === 'number') {
            // Get time from timestamp
            date = new Date(date);
        }

        // If it not a date 
        else if (!(date instanceof Date)) {
            // Throw an error
            if (!silent) throw new Error('jsCalendar: Invalid date.');
            return null;
        }

        // Return date
        return new Date(date.getTime());
    };
    tools.stringToDate = tools.parseDate;
    // Date to string
    tools.dateToString = function(date, format, lang) {
        // Find lang
        var languages = JsCalendar.prototype.languages;
        if (!lang || !languages.hasOwnProperty(lang)) {
            lang = 'en';
        }

        // Call parser
        return JsCalendar.prototype._parseToDateString.apply(
            {language : {
                months : languages[lang].months,
                days : languages[lang].days,
                dateStringParser : languages[lang]._dateStringParser,
                dayStringParser : languages[lang]._dayStringParser
            }},
            [date, format]
        );
    };
    // Get element
    tools.getElement = function(element) {
        // Check if not valid
        if (!element) {
            return null;
        }

        // If string
        if (typeof element === 'string') {
            // Get element by id
            if (element[0] === '#') {
                return document.getElementById(element.substring(1));
            }
            // Get element by class-name
            else if (element[0] === '.') {
                return document.getElementsByClassName(element.substring(1))[0];
            }
        }
        
        // or if it is HTML element (just a naive-simple check)
        else if (element.tagName && element.nodeName && element.ownerDocument && element.removeAttribute) {
            return element;
        }

        // Unknown
        return null;
    };
    
    // Get a new object
    JsCalendar.new = function(){
        // Create new object
        var obj = new JsCalendar();
        // Construct calendar
        obj._construct(arguments);
        // Return new object
        return obj;
    };
    
    // Manage existing jsCalendar objects
    var jsCalendarObjects = {};
    JsCalendar.set = function(identifier, calendar){
        if (calendar instanceof JsCalendar) {
            jsCalendarObjects[identifier] = calendar;
            return true;
        }
        throw new Error('jsCalendar: The second parameter is not a jsCalendar.');
    };
    JsCalendar.get = function(identifier){
        if (jsCalendarObjects.hasOwnProperty(identifier)) {
            return jsCalendarObjects[identifier];
        }
        return null;
    };
    JsCalendar.del = function(identifier){
        if (jsCalendarObjects.hasOwnProperty(identifier)) {
            delete jsCalendarObjects[identifier];
            return true;
        }
        return false;
    };
    
    // Add a new language
    JsCalendar.addLanguage = function(language){
        // Check if language object is valid
        if (typeof language === 'undefined') {
            // Throw an error
            throw new Error('jsCalendar: No language object was given.');
        }
        // Check if valid language code
        if (typeof language.code !== 'string') {
            // Throw an error
            throw new Error('jsCalendar: Invalid language code.');
        }
        // Check language months
        if (!(language.months instanceof Array)) {
            // Throw an error
            throw new Error('jsCalendar: Invalid language months.');
        }
        if (language.months.length !== 12) {
            // Throw an error
            throw new Error('jsCalendar: Invalid language months length.');
        }
        // Check language days
        if (!(language.days instanceof Array)) {
            // Throw an error
            throw new Error('jsCalendar: Invalid language days.');
        }
        if (language.days.length !== 7) {
            // Throw an error
            throw new Error('jsCalendar: Invalid language days length.');
        }

        // Now save language
        JsCalendar.prototype.languages[language.code] = language;

        // Generate language string format handlers
        language._dateStringParser = (
            language.hasOwnProperty('dateStringParser') ?
            function(key, date) {return language.dateStringParser(key, date) || JsCalendar._defaultDateStringParser(key, date, language);} :
            function(key, date) {return JsCalendar._defaultDateStringParser(key, date, language);}
        );
        language._dayStringParser = (
            language.hasOwnProperty('dayStringParser') ?
            function(key, day) {return language.dayStringParser(key, day) || JsCalendar._defaultDayStringParser(key, day, language);} :
            function(key, day) {return JsCalendar._defaultDayStringParser(key, day, language);}
        );
    };

    // Default function to handle date-string parsing
    JsCalendar._defaultDateStringParser = function(key, date, lang){
        switch(key) {
            case 'MONTH':
            case 'month':
                return lang.months[date.getMonth()];
            case 'MMM':
            case 'mmm':
                return lang.months[date.getMonth()].substring(0, 3);
            case 'mm':
                return lang.months[date.getMonth()].substring(0, 2);
            case 'm':
                return lang.months[date.getMonth()].substring(0, 1);
            case 'MM':
                return (date.getMonth() < 9 ? '0' : '') + (date.getMonth() + 1);
            case 'M':
                return date.getMonth() + 1;
            case '##':
                return (date.getMonth() < 9 ? '0' : '') + (date.getMonth() + 1);
            case '#':
                return date.getMonth() + 1;
            case 'DAY':
            case 'day':
                return lang.days[date.getDay()];
            case 'DDD':
            case 'ddd':
                return lang.days[date.getDay()].substring(0, 3);
            case 'dd':
                return lang.days[date.getDay()].substring(0, 2);
            case 'd':
                return lang.days[date.getDay()].substring(0, 1);
            case 'DD':
                return (date.getDate() <= 9 ? '0' : '') + date.getDate();
            case 'D':
                return date.getDate();
            case 'YYYY':
            case 'yyyy':
                return date.getYear() + 1900;
        }
    };

    // Default function to handle date-string parsing
    JsCalendar._defaultDayStringParser = function(key, day, lang){
        switch(key) {
            case 'DAY':
            case 'day':
                return lang.days[day];
            case 'DDD':
            case 'ddd':
                return lang.days[day].substring(0, 3);
            case 'DD':
            case 'dd':
                return lang.days[day].substring(0, 2);
            case 'D':
                return lang.days[day].substring(0, 1);
        }
    };

    // Load any language on the load list
    (function(){
        // If a list exist
        if (typeof window.jsCalendar_language2load !== 'undefined') {
            // While list not empty
            while (window.jsCalendar_language2load.length) {
                // Make it asynchronous
                setTimeout((function (language) {
                    // Return timeout callback
                    return function() {
                        JsCalendar.addLanguage(language);
                    };
                })(window.jsCalendar_language2load.pop()), 0);
            }
            // Clean up useless list
            delete window.jsCalendar_language2load;
        }
    })();

    // Init auto calendars
    // After the page loads
    window.addEventListener('load', function() {
        // Get calendars
        JsCalendar.autoFind();
    }, false);

    // Return
    return JsCalendar;
})();
