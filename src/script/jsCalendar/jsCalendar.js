/*
 * jsCalendar v1.4.2
 *
 *
 * MIT License
 *
 * Copyright (c) 2018 Grammatopoulos Athanasios-Vasileios
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
    JsCalendar.version = "v1.4.2";

    // Sub-Constructor
    JsCalendar.prototype._construct = function(args) {
        // Parse arguments
        args = this._parseArguments(args);
        // Init calendar
        this._init(args.options);
        // Init target
        this._setTarget(args.target);
        this._initTarget();
        // Set date
        this._setDate(args.date);
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
            months : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
            // Days Names
            days : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
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
            date : new Date(),
            options : {}
        };

        // If no arguments
        if (args.length === 0) {
            // Throw an error
            throw new Error("jsCalendar: No parameters were given.");
        }

        // Only 1 argument
        else if (args.length === 1) {

            // If target element
            if (
                (
                    // If html element
                    ((typeof HTMLElement === "object") ? (args[0] instanceof HTMLElement) : args[0]) &&
                    (typeof args[0] === "object") && (args[0] !== null) && (args[0].nodeType === 1) &&
                    (typeof args[0].nodeName === "string")
                ) || (
                    // Or string
                    typeof args[0] === "string"
                )
            ) {
                obj.target = args[0];
            }

            // Options argument
            else {
                // Init arguments
                obj.options = args[0];
                // Get target
                if (typeof args[0].target !== "undefined") {
                    obj.target = args[0].target;
                }
                else {
                    // Throw an error
                    throw new Error("jsCalendar: Not target was given.");
                }
                // Get date
                if (typeof args[0].date !== "undefined") {
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

    // Parse options
    JsCalendar.prototype._parseOptions = function(options) {
        // Default options
        this._options = {
            language : "en",
            zeroFill : false,
            monthFormat : "month",
            dayFormat : "D",
            firstDayOfTheWeek : 1,
            navigator : true,
            navigatorPosition : "both",
            min : false,
            max : false
        };
        // Check options
        if (typeof options.zeroFill !== "undefined"){
            if (options.zeroFill === "false" || !options.zeroFill) {
                this._options.zeroFill = false;
            }
            else {
                this._options.zeroFill = true;
            }
        }
        if (typeof options.monthFormat !== "undefined"){
            this._options.monthFormat = options.monthFormat;
        }
        if (typeof options.dayFormat !== "undefined"){
            this._options.dayFormat = options.dayFormat;
        }
        if (typeof options.navigator !== "undefined"){
            if (options.navigator === "false" || !options.navigator) {
                this._options.navigator = false;
            }
            else {
                this._options.navigator = true;
            }
        }
        if (typeof options.navigatorPosition !== "undefined"){
            this._options.navigatorPosition = options.navigatorPosition;
        }

        // Language
        if (typeof options.language === "string" && typeof this.languages[options.language] !== "undefined"){
            this._options.language = options.language;
        }
        // Set language
        this.setLanguage(this._options.language);

        // Set first day of the week
        if (typeof options.fdotw !== "undefined"){
            options.firstDayOfTheWeek = options.fdotw;
        }
        if (typeof options.firstDayOfTheWeek !== "undefined"){
            // If day number
            if (typeof options.firstDayOfTheWeek === "number") {
                // Range check (no need to check for bigger than 7 but I don't trust anyone)
                if (options.firstDayOfTheWeek >= 1 && options.firstDayOfTheWeek <= 7) {
                    this._options.firstDayOfTheWeek = options.firstDayOfTheWeek;
                }
            }
            // If string
            if (typeof options.firstDayOfTheWeek === "string") {
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
        if (typeof options.min !== "undefined" && options.min !== "false" && options.min !== false) {
            // Parse date
            this._options.min = this._parseDate(options.min);
        }
        // Set max calendar date
        if (typeof options.max !== "undefined" && options.max !== "false" && options.max !== false) {
            // Parse date
            this._options.max = this._parseDate(options.max);
        }
    };

    // Set target
    JsCalendar.prototype._setTarget = function(element) {
        // Parse target
        var target = this._getElement(element);
        // If target not found
        if (!target) {
            // Throw an error
            throw new Error("jsCalendar: Target was not found.");
        }
        else {
            // Save element
            this._target = target;
        }
    };

    // Get element
    JsCalendar.prototype._getElement = function(element) {
        // Check if not valid
        if (!element) {
            return null;
        }

        // If string
        if (typeof element === "string") {
            // Get element by id
            if (element[0] === "#") {
                return document.getElementById(element.substring(1));
            }
            // Get element by class-name
            else if (element[0] === ".") {
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

    // Init target
    JsCalendar.prototype._initTarget = function() {
        // Add class
        if (this._target.className.length > 0){
            this._target.className += " ";
        }
        this._target.className += "jsCalendar";

        // Create table
        this._elements.table = document.createElement("table");
        // Create table header
        this._elements.head = document.createElement("thead");
        this._elements.table.appendChild(this._elements.head);
        // Create table body
        this._elements.body = document.createElement("tbody");
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
        date = this._parseDate(date);
        
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
        // Check date not in range
        if (!this._isDateInRange(date)) {
            return;
        }
        // Set data
        this._now = this._parseDate(date);
        this._date = new Date(this._now.getFullYear(), this._now.getMonth(), 1);
    };

    // Parse Date
    JsCalendar.prototype._parseDate = function(date) {

        // If set now date
        if (typeof date === "undefined" || date === null || date === "now") {
            // Get date now
            date = new Date();
        }

        // If date is string
        else if (typeof date === "string") {
            // Parse date string
            date = date.replace(/-/g,"\/").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4,4})$/i);
            // If match
            if (date !== null) {
                var month_index = parseInt(date[2], 10) - 1;
                // Parse date
                date = new Date(date[3], month_index, date[1]);
                // Check if date does not exist
                if (!date || date.getMonth() !== month_index) {
                    // Throw an error
                    throw new Error("jsCalendar: Date does not exist.");
                }
            }
            // Can't parse string
            else {
                // Throw an error
                throw new Error("jsCalendar: Failed to parse date.");
            }
        }

        // If it is a number
        else if (typeof date === "number") {
            // Get time from timestamp
            date = new Date(date);
        }

        // If it not a date 
        else if (!(date instanceof Date)) {
            // Throw an error
            throw new Error("jsCalendar: Invalid date.");
        }

        // Return date
        return new Date(date.getTime());
    };

    // Convert to date string
    JsCalendar.prototype._parseToDateString = function(date, format) {
        var lang = this.language;
        return format.replace(/(MONTH|month|MMM|mmm|mm|m|MM|M|DAY|day|DDD|ddd|dd|d|DD|D|YYYY|yyyy)/g, function(key){
            switch(key) {
                case "MONTH":
                case "month":
                    return lang.months[date.getMonth()];
                case "MMM":
                case "mmm":
                    return lang.months[date.getMonth()].substring(0, 3);
                case "mm":
                    return lang.months[date.getMonth()].substring(0, 2);
                case "m":
                    return lang.months[date.getMonth()].substring(0, 1);
                case "MM":
                    return (date.getMonth() < 9 ? "0" : "") + (date.getMonth() + 1);
                case "M":
                    return date.getMonth() + 1;
                case "DAY":
                case "day":
                    return lang.days[date.getDay()];
                case "DDD":
                case "ddd":
                    return lang.days[date.getDay()].substring(0, 3);
                case "dd":
                    return lang.days[date.getDay()].substring(0, 2);
                case "d":
                    return lang.days[date.getDay()].substring(0, 1);
                case "DD":
                    return (date.getDate() <= 9 ? "0" : "") + date.getDate();
                case "D":
                    return date.getDate();
                case "YYYY":
                case "yyyy":
                    return date.getYear() + 1900;
            }
        });
    };

    // Get visible month
    JsCalendar.prototype._getVisibleMonth = function(date) {
        // For date
        if (typeof date === "undefined") {
            // Get saved date
            date = this._date;
        }
        else {
            date = this._parseDate(date);
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
        var name = this._options.monthFormat.replace(/(MONTH|month|MMM|mmm|##|#|YYYY|yyyy)/g, function(key){
            switch(key) {
                case "MONTH":
                case "month":
                    return lang.months[first.getMonth()];
                case "MMM":
                case "mmm":
                    return lang.months[first.getMonth()].substring(0, 3);
                case "##":
                    return (first.getMonth() < 9 ? "0" : "") + (first.getMonth() + 1);
                case "#":
                    return first.getMonth() + 1;
                case "YYYY":
                case "yyyy":
                    return first.getYear() + 1900;
            }
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
        if (typeof date === "undefined") {
            // Get saved date
            date = this._date;
        }
        else {
            date = this._parseDate(date);
        }

        // Visible days array
        var dates = [];
        // Get first day of the month
        var first = new Date(date.getTime());
        first.setDate(1);

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
        // Save instance
        var that = this;

        // Set created flag
        this._elements.created = true;

        // Head rows
        this._elements.headRows = [];
        for (var i = 0; i < 2; i++) {
            this._elements.headRows.push(document.createElement("tr"));
            this._elements.head.appendChild(this._elements.headRows[i]);
        }

        // Month row
        var title_header = document.createElement("th");
        title_header.setAttribute("colspan", 7);
        this._elements.headRows[0].className = "jsCalendar-title-row";
        this._elements.headRows[0].appendChild(title_header);

        this._elements.headLeft = document.createElement("div");
        this._elements.headLeft.className = "jsCalendar-title-left";
        title_header.appendChild(this._elements.headLeft);
        this._elements.month = document.createElement("div");
        this._elements.month.className = "jsCalendar-title-name";
        title_header.appendChild(this._elements.month);
        this._elements.headRight = document.createElement("div");
        this._elements.headRight.className = "jsCalendar-title-right";
        title_header.appendChild(this._elements.headRight);

        // Navigation
        if (this._options.navigator) {
            this._elements.navLeft = document.createElement("div");
            this._elements.navLeft.className = "jsCalendar-nav-left";
            this._elements.navRight = document.createElement("div");
            this._elements.navRight.className = "jsCalendar-nav-right";

            if (this._options.navigatorPosition === "left") {
                this._elements.headLeft.appendChild(this._elements.navLeft);
                this._elements.headLeft.appendChild(this._elements.navRight);
            }
            else if (this._options.navigatorPosition === "right") {
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
                that._eventFire_monthChange(event, that._date);
            }, false);
            this._elements.navRight.addEventListener('click', function(event){
                that.next();
                that._eventFire_monthChange(event, that._date);
            }, false);
        }

        // Days row
        this._elements.headRows[1].className = "jsCalendar-week-days";
        title_header.className = "jsCalendar-title";
        this._elements.days = [];
        var name, nameOfDay;
        for (i = 0; i < 7; i++) {
            this._elements.days.push(document.createElement("th"));
            this._elements.headRows[1].appendChild(this._elements.days[
                this._elements.days.length - 1
            ]);

            nameOfDay = this.language.days[(i + this._options.firstDayOfTheWeek - 1) % 7];
            name = this._options.dayFormat.replace(/(DAY|day|DDD|ddd|DD|dd|D)/g, function(key){
                switch(key) {
                    case "DAY":
                    case "day":
                        return nameOfDay;
                    case "DDD":
                    case "ddd":
                        return nameOfDay.substring(0, 3);
                    case "DD":
                    case "dd":
                        return nameOfDay.substring(0, 2);
                    case "D":
                        return nameOfDay.substring(0, 1);
                }
            });
            this._elements.days[this._elements.days.length - 1].textContent = name;
        }

        // Body rows
        this._elements.bodyRows = [];
        this._elements.bodyCols = [];
        // 6 rows
        for (i = 0; i < 6; i++) {
            this._elements.bodyRows.push(document.createElement("tr"));
            this._elements.body.appendChild(this._elements.bodyRows[i]);
            // 7 days
            for (var j = 0; j < 7; j++) {
                this._elements.bodyCols.push(document.createElement("td"));
                this._elements.bodyRows[i].appendChild(this._elements.bodyCols[i * 7 + j]);
                this._elements.bodyCols[i * 7 + j].addEventListener('click', (function(index){
                    return function (event) {
                        that._eventFire_dateClick(event, that._active[index]);
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
            dates[i] = this._parseDate(dates[i]);
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
            dates[i] = this._parseDate(dates[i]);
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
        var prefix = "";
        if (this._options.zeroFill) {
            prefix = "0";
        }

        // Populate days
        var text;
        for (var i = month.days.length - 1; i >= 0; i--) {
            text = month.days[i].getDate();
            this._elements.bodyCols[i].textContent = (text < 10 ? prefix + text : text);

            // If date is selected
            if (this._selected.indexOf(month.days[i].getTime()) >= 0) {
                this._elements.bodyCols[i].className = "jsCalendar-selected";
            }
            else {
                this._elements.bodyCols[i].removeAttribute("class");
            }
        }

        // Previous month
        for (i = 0; i < month.start - 1; i++) {
            this._elements.bodyCols[i].className = "jsCalendar-previous";
        }
        // Current day
        if(month.current >= 0){
            if (this._elements.bodyCols[month.current].className.length > 0) {
                this._elements.bodyCols[month.current].className += " jsCalendar-current";
            }
            else {
                this._elements.bodyCols[month.current].className = "jsCalendar-current";
            }
        }
        // Next month
        for (i = month.end; i < month.days.length; i++) {
            this._elements.bodyCols[i].className = "jsCalendar-next";
        }
    };

    // Fire all event listeners
    JsCalendar.prototype._eventFire_dateClick = function(event, date) {
        // Events
        for (var i = 0; i < this._events.date.length; i++) {
            (function(callback) {
                // Call asynchronous
                setTimeout(function(){
                    // Call callback
                    callback(event, new Date(date.getTime()));
                }, 0);
            })(this._events.date[i]);
        }
    };

    // Fire all event listeners
    JsCalendar.prototype._eventFire_monthChange = function(event, date) {
        // Get first day of the month
        var month = new Date(date.getTime());
        month.setDate(1);
        // Events
        for (var i = 0; i < this._events.month.length; i++) {
            (function(callback) {
                // Call asynchronous
                setTimeout(function(){
                    // Call callback
                    callback(event, new Date(month.getTime()));
                }, 0);
            })(this._events.month[i]);
        }
    };

    // Add a event listener
    JsCalendar.prototype.onDateClick = function(callback) {
        // If callback is a function
        if(typeof callback === "function"){
            // Add to the list
            this._events.date.push(callback);
        }

        // Not a function
        else {
            // Throw an error
            throw new Error("jsCalendar: Invalid callback function.");
        }

        // Return
        return this;
    };

    // Add a event listener
    JsCalendar.prototype.onMonthChange = function(callback) {
        // If callback is a function
        if(typeof callback === "function"){
            // Add to the list
            this._events.month.push(callback);
        }

        // Not a function
        else {
            // Throw an error
            throw new Error("jsCalendar: Invalid callback function.");
        }

        // Return
        return this;
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
            this._options.min = this._parseDate(date);
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
            this._options.max = this._parseDate(date);
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
        if (typeof date !== "undefined") {
            // If date is in range
            if (this._isDateInRange(date)) {
                this._date = this._parseDate(date);
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
        if (typeof n !== "number") {
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
        if (typeof n !== "number") {
            n = 1;
        }

        // Calculate date
        var date = new Date(this._date.getFullYear(), this._date.getMonth() - n, 1);

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
        if (typeof dates === "undefined") {
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
        if (typeof dates === "undefined") {
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
        if (typeof options !== "object") {
            options = {};
        }

        // Copy selected array
        var dates = this._selected.slice();

        // Options - Sort array
        if (options.sort) {
            if (options.sort === true) {
                dates.sort();
            }
            else if (typeof options.sort === "string") {
                if (options.sort.toLowerCase() === "asc") {
                    dates.sort();
                }
                else if (options.sort.toLowerCase() === "desc"){
                    dates.sort();
                    dates.reverse();
                }
            }
        }

        // Options - Data type
        if (options.type && typeof options.type === "string") {
            var i;
            // Convert to date object
            if (options.type.toLowerCase() === "date"){
                for (i = dates.length - 1; i >= 0; i--) {
                    dates[i] = new Date(dates[i]);
                }
            }
            // If not a timestamp - convert to custom format
            else if (options.type.toLowerCase() !== "timestamp") {
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
        if (typeof date === "undefined" || date === null) {
            // Return
            return false;
        }

        // Parse date
        date = this._parseDate(date);
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
        if (typeof date === "undefined" || date === null) {
            // Return
            return false;
        }

        // Parse date
        date = this._parseDate(date);
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
        if (typeof date === "undefined" || date === null) {
            // Return
            return false;
        }

        // Parse date and get month
        var month = this._parseDate(date);
        month.setHours(0, 0, 0, 0);
        month.setDate(1);

        // Parse active month date
        var active = this._parseDate(this._date);
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
        if (typeof code !== "string"){
            // Throw an error
            throw new Error("jsCalendar: Invalid language code.");
        }
        if (typeof this.languages[code] === "undefined"){
            // Throw an error
            throw new Error("jsCalendar: Language not found.");
        }

        // Change language
        this._options.language = code;

        // Set new language as active
        this.language.months = this.languages[this._options.language].months;
        this.language.days = this.languages[this._options.language].days;

        // Refresh calendar
        this.refresh();

        // Return
        return this;
    };


    // Static foo methods (well... not really static)

    // Auto init calendars
    JsCalendar.autoFind = function(){
        // Get all auto-calendars
        var calendars = document.getElementsByClassName("auto-jsCalendar");
        // Temp options variable
        var options;
        // For each auto-calendar
        for (var i = 0; i < calendars.length; i++) {
            // If not loaded
            if(calendars[i].getAttribute("jsCalendar-loaded") !== "true") {
                // Set as loaded
                calendars[i].setAttribute("jsCalendar-loaded", "true");
                // Init options
                options = {};
                // Add options
                for(var j in calendars[i].dataset){
                    options[j] = calendars[i].dataset[j];
                }
                // Set target
                options.target = calendars[i];
                // Create
                new jsCalendar(options);
            }
        }
    };
    
    // Tools
    JsCalendar.tools = {};
    // String to date
    JsCalendar.tools.parseDate = function() {
        return JsCalendar.prototype._parseDate.apply({}, arguments);
    };
    JsCalendar.tools.stringToDate = JsCalendar.tools.parseDate;
    // Date to string
    JsCalendar.tools.dateToString = function(date, format, lang) {
        // Find lang
        var languages = JsCalendar.prototype.languages;
        if (!lang || !languages.hasOwnProperty(lang)) {
            lang = "en";
        }
        // Call parser
        return JsCalendar.prototype._parseToDateString.apply(
            {language : languages[lang]},
            [date, format]
        );
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
    
    // Add a new language
    JsCalendar.addLanguage = function(language){
        // Check if language object is valid
        if (typeof language === "undefined") {
            // Throw an error
            throw new Error("jsCalendar: No language object was given.");
        }
        // Check if valid language code
        if (typeof language.code !== "string") {
            // Throw an error
            throw new Error("jsCalendar: Invalid language code.");
        }
        // Check language months
        if (!(language.months instanceof Array)) {
            // Throw an error
            throw new Error("jsCalendar: Invalid language months.");
        }
        if (language.months.length !== 12) {
            // Throw an error
            throw new Error("jsCalendar: Invalid language months length.");
        }
        // Check language days
        if (!(language.days instanceof Array)) {
            // Throw an error
            throw new Error("jsCalendar: Invalid language days.");
        }
        if (language.days.length !== 7) {
            // Throw an error
            throw new Error("jsCalendar: Invalid language days length.");
        }

        // Now save language
        JsCalendar.prototype.languages[language.code] = {
            // Save months
            months : language.months.slice(),
            // Save days
            days : language.days.slice()
        };
    };

    // Load any language on the load list
    (function(){
        // If a list exist
        if (typeof window.jsCalendar_language2load !== "undefined") {
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

    // Return
    return JsCalendar;
})();

// I love anonymous functions
(function(){
    // Init auto calendars
    // After the page loads
    window.addEventListener("load", function() {
        // Get calendars
        jsCalendar.autoFind();
    }, false);
})();
