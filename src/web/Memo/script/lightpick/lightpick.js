/**
* @author: Rinat G. http://coding.kz
* @copyright: Copyright (c) 2019 Rinat G.
* @license: Licensed under the MIT license. See http://www.opensource.org/licenses/mit-license.php
*/

// Following the UMD template https://github.com/umdjs/umd/blob/master/templates/returnExportsGlobal.js
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Make globaly available as well
        define(['moment'], function (moment) {
            return factory(moment);
        });
    } else if (typeof module === 'object' && module.exports) {
        // Node / Browserify
        var moment = (typeof window != 'undefined' && typeof window.moment != 'undefined') ? window.moment : require('moment');
        module.exports = factory(moment);
    } else {
        // Browser globals
        root.Lightpick = factory(root.moment);
    }
}(this, function(moment) {
    'use strict';

    var document = window.document,

    defaults = {
        field: null,
        secondField: null,
        firstDay: 1,
        parentEl: 'body',
        lang: 'auto',
        format: 'DD/MM/YYYY',
        separator: ' - ',
        numberOfMonths: 1,
        numberOfColumns: 2,
        singleDate: true,
        autoclose: true,
        repick: false,
        startDate: null,
        endDate: null,
        minDate: null,
        maxDate: null,
        disableDates: null,
        selectForward: false,
        selectBackward: false,
        minDays: null,
        maxDays: null,
        hoveringTooltip: true,
        hideOnBodyClick: true,
        footer: false,
        disabledDatesInRange: true,
        tooltipNights: false,
        orientation: 'auto',
        disableWeekends: false,
        inline: false,
        weekdayStyle: 'short',
        dropdowns: {
            years: {
                min: 1900,
                max: null,
            },
            months: true,
        },
        locale: {
            buttons: {
                prev: '&leftarrow;',
                next: '&rightarrow;',
                close: '&times;',
                reset: 'Reset',
                apply: 'Apply',
            },
            tooltip: {
                one: 'day',
                other: 'days',
            },
            tooltipOnDisabled: null,
            pluralize: function(i, locale){
                if (typeof i === "string") i = parseInt(i, 10);

                if (i === 1 && 'one' in locale) return locale.one;
                if ('other' in locale) return locale.other;

                return '';
            },
        },

        onSelect: null,
        onSelectStart: null,
        onSelectEnd: null,
        onOpen: null,
        onClose: null,
        onError: null,
        onMonthsChange: null,
        onYearsChange: null
    },

    renderTopButtons = function(opts)
    {
        return '<div class="lightpick__toolbar">'
            + ''
            + '<button type="button" class="lightpick__previous-action">' + opts.locale.buttons.prev + '</button>'
            + '<button type="button" class="lightpick__next-action">' + opts.locale.buttons.next + '</button>'
            + (!opts.autoclose && !opts.inline ? '<button type="button" class="lightpick__close-action">' + opts.locale.buttons.close + '</button>'  : '')
            + '</div>';
    },

    weekdayName = function(opts, day, weekdayStyle)
    {
        return new Date(1970, 0, day, 12, 0, 0, 0).toLocaleString(opts.lang, { weekday: weekdayStyle || opts.weekdayStyle });
    },

    renderDay = function(opts, date, dummy, extraClass)
    {
        if (dummy) return '<div></div>';

        var date = moment(date),
            prevMonth = moment(date).subtract(1, 'month'),
            nextMonth = moment(date).add(1, 'month');

        var day = {
            time: moment(date).valueOf(),
            className: ['lightpick__day', 'is-available']
        };

        if (extraClass instanceof Array || Object.prototype.toString.call(extraClass) === '[object Array]') {
            extraClass = extraClass.filter( function( el ) {
                return ['lightpick__day', 'is-available', 'is-previous-month', 'is-next-month'].indexOf( el ) >= 0;
            });
            day.className = day.className.concat(extraClass);
        }
        else {
            day.className.push(extraClass);
        }

        if (opts.disableDates) {
            for (var i = 0; i < opts.disableDates.length; i++) {
                if (opts.disableDates[i] instanceof Array || Object.prototype.toString.call(opts.disableDates[i]) === '[object Array]') {
                    var _from = moment(opts.disableDates[i][0], opts.format),
                        _to = moment(opts.disableDates[i][1], opts.format);

                    if (_from.isValid() && _to.isValid() && date.isBetween(_from, _to, 'day', '[]')){
                        day.className.push('is-disabled');
                    }
                }
                else if (moment(opts.disableDates[i], opts.format).isValid() && moment(opts.disableDates[i], opts.format).isSame(date, 'day')) {
                    day.className.push('is-disabled');
                }

                if (day.className.indexOf('is-disabled') >= 0) {

                    if (opts.locale.tooltipOnDisabled && (!opts.startDate || date.isAfter(opts.startDate) || opts.startDate && opts.endDate)) {
                        day.className.push('disabled-tooltip');
                    }

                    if (day.className.indexOf('is-start-date') >= 0) {
                        this.setStartDate(null);
                        this.setEndDate(null);
                    }
                    else if (day.className.indexOf('is-end-date') >= 0) {
                        this.setEndDate(null);
                    }
                }
            }
        }

        if (opts.minDays && opts.startDate && !opts.endDate) {
            if (date.isBetween(moment(opts.startDate).subtract(opts.minDays - 1, 'day'), moment(opts.startDate).add(opts.minDays - 1, 'day'), 'day')) {
                day.className.push('is-disabled');

                if (opts.selectForward && date.isSameOrAfter(opts.startDate)) {
                    day.className.push('is-forward-selected');
                    day.className.push('is-in-range');
                }
            }
        }

        if (opts.maxDays && opts.startDate && !opts.endDate) {
            if (date.isSameOrBefore(moment(opts.startDate).subtract(opts.maxDays, 'day'), 'day')) {
                day.className.push('is-disabled');
            }
            else if (date.isSameOrAfter(moment(opts.startDate).add(opts.maxDays, 'day'), 'day')) {
                day.className.push('is-disabled');
            }
        }

        if (opts.repick && (opts.minDays || opts.maxDays) && opts.startDate && opts.endDate) {
            var tempStartDate = moment(opts.repickTrigger == opts.field ? opts.endDate : opts.startDate);

            if (opts.minDays) {
                if (date.isBetween(moment(tempStartDate).subtract(opts.minDays - 1, 'day'), moment(tempStartDate).add(opts.minDays - 1, 'day'), 'day')) {
                    day.className.push('is-disabled');
                }
            }

            if (opts.maxDays) {
                if (date.isSameOrBefore(moment(tempStartDate).subtract(opts.maxDays, 'day'), 'day')) {
                    day.className.push('is-disabled');
                }
                else if (date.isSameOrAfter(moment(tempStartDate).add(opts.maxDays, 'day'), 'day')) {
                    day.className.push('is-disabled');
                }
            }
        }

        if (date.isSame(new Date(), 'day')) {
            day.className.push('is-today');
        }

        if (date.isSame(opts.startDate, 'day')) {
            day.className.push('is-start-date');
        }

        if (date.isSame(opts.endDate, 'day')) {
            day.className.push('is-end-date');
        }

        if (opts.startDate && opts.endDate && date.isBetween(opts.startDate, opts.endDate, 'day', '[]')) {
            day.className.push('is-in-range');
        }

        if (moment().isSame(date, 'month')) {

        }
        else if (prevMonth.isSame(date, 'month')) {
            day.className.push('is-previous-month');
        }
        else if (nextMonth.isSame(date, 'month')) {
            day.className.push('is-next-month');
        }

        if (opts.minDate && date.isBefore(opts.minDate, 'day')) {
            day.className.push('is-disabled');
        }

        if (opts.maxDate && date.isAfter(opts.maxDate, 'day')) {
            day.className.push('is-disabled');
        }

        if (opts.selectForward && !opts.singleDate && opts.startDate && !opts.endDate && date.isBefore(opts.startDate, 'day')) {
            day.className.push('is-disabled');
        }

        if (opts.selectBackward && !opts.singleDate && opts.startDate && !opts.endDate && date.isAfter(opts.startDate, 'day')) {
            day.className.push('is-disabled');
        }

        if (opts.disableWeekends && (date.isoWeekday() == 6 || date.isoWeekday() == 7)) {
            day.className.push('is-disabled');
        }

        day.className = day.className.filter(function(value, index, self) {
            return self.indexOf(value) === index;
        });

        if (day.className.indexOf('is-disabled') >= 0 && day.className.indexOf('is-available') >= 0) {
            day.className.splice(day.className.indexOf('is-available'), 1);
        }

        var div = document.createElement('div');
        div.className = day.className.join(' ');
        div.innerHTML = date.get('date');
        div.setAttribute('data-time', day.time);

        return div.outerHTML;
    },

    renderMonthsList = function(date, opts)
    {
        var d = moment(date),
            select = document.createElement('select');

        for (var idx = 0; idx < 12; idx++) {
            d.set('month', idx);

            var option = document.createElement('option');
            option.value = d.toDate().getMonth();
            option.text = d.toDate().toLocaleString(opts.lang, { month: 'long' });

            if (idx === date.toDate().getMonth()) {
                option.setAttribute('selected', 'selected');
            }

            select.appendChild(option);
        }

        select.className = 'lightpick__select lightpick__select-months';

        // for text align to right
        select.dir = 'rtl';

        if (!opts.dropdowns || !opts.dropdowns.months) {
            select.disabled = true;
        }

        return select.outerHTML;
    },

    renderYearsList = function(date, opts)
    {
        var d = moment(date),
            select = document.createElement('select'),
            years = opts.dropdowns && opts.dropdowns.years ? opts.dropdowns.years : null,
            minYear = years && years.min ? years.min : 1900,
            maxYear = years && years.max ? years.max : Number.parseInt(moment().format('YYYY'));

        if (Number.parseInt(date.format('YYYY')) < minYear) {
            minYear = Number.parseInt(date.format('YYYY'));
        }

        if (Number.parseInt(date.format('YYYY')) > maxYear) {
            maxYear = Number.parseInt(date.format('YYYY'));
        }

        for (var idx = minYear; idx <= maxYear; idx++) {
            d.set('year', idx);

            var option = document.createElement('option');
            option.value = d.toDate().getFullYear();
            option.text = d.toDate().getFullYear();

            if (idx === date.toDate().getFullYear()) {
                option.setAttribute('selected', 'selected');
            }

            select.appendChild(option);
        }

        select.className = 'lightpick__select lightpick__select-years';

        if (!opts.dropdowns || !opts.dropdowns.years) {
            select.disabled = true;
        }

        return select.outerHTML;
    },

    renderCalendar = function(el, opts)
    {
        var html = '',
            monthDate = moment(opts.calendar[0]);

        for (var i = 0; i < opts.numberOfMonths; i++) {
            var day = moment(monthDate);

            html += '<section class="lightpick__month">';
            html += '<header class="lightpick__month-title-bar">'
            html += '<div class="lightpick__month-title">'
            + renderMonthsList(day, opts)
            + renderYearsList(day, opts)
            + '</div>';

            if (opts.numberOfMonths === 1) {
                html += renderTopButtons(opts, 'days');
            }

            html += '</header>'; // lightpick__month-title-bar

            html += '<div class="lightpick__days-of-the-week">';
            for (var w = opts.firstDay + 4; w < 7 + opts.firstDay + 4; ++w) {
                html += '<div class="lightpick__day-of-the-week" title="' + weekdayName(opts, w, 'long') + '">' + weekdayName(opts, w) + '</div>';
            }
            html += '</div>'; // lightpick__days-of-the-week

            html += '<div class="lightpick__days">';

            if (day.isoWeekday() !== opts.firstDay) {
                var prevDays = day.isoWeekday() - opts.firstDay > 0 ? day.isoWeekday() - opts.firstDay : day.isoWeekday(),
                    prevMonth = moment(day).subtract(prevDays, 'day'),
                    daysInMonth = prevMonth.daysInMonth();

                for (var d = prevMonth.get('date'); d <= daysInMonth; d++) {
                    html += renderDay(opts, prevMonth, i > 0, 'is-previous-month');

                    prevMonth.add(1, 'day');
                }
            }

            var daysInMonth = day.daysInMonth(),
                today = new Date();

            for (var d = 0; d < daysInMonth; d++) {
                html += renderDay(opts, day);

                day.add(1, 'day');
            }

            var nextMonth = moment(day),
                nextDays = 7 - nextMonth.isoWeekday() + opts.firstDay;

            if (nextDays < 7) {
                for (var d = nextMonth.get('date'); d <= nextDays; d++) {
                    html += renderDay(opts, nextMonth, i < opts.numberOfMonths - 1, 'is-next-month');

                    nextMonth.add(1, 'day');
                }
            }

            html += '</div>'; // lightpick__days

            html += '</section>'; // lightpick__month

            monthDate.add(1, 'month');
        }

        opts.calendar[1] = moment(monthDate);

        el.querySelector('.lightpick__months').innerHTML = html;
    },

    updateDates = function(el, opts)
    {
        var days = el.querySelectorAll('.lightpick__day');
        [].forEach.call(days, function(day) {
            day.outerHTML = renderDay(opts, parseInt(day.getAttribute('data-time')), false, day.className.split(' '));
        });

        checkDisabledDatesInRange(el, opts);
    },

    checkDisabledDatesInRange = function(el, opts)
    {
        if (opts.disabledDatesInRange || !opts.startDate || opts.endDate || !opts.disableDates) return;

        var days = el.querySelectorAll('.lightpick__day'),
            disabledArray = opts.disableDates.map(function(entry){
                return entry instanceof Array || Object.prototype.toString.call(entry) === '[object Array]' ? entry[0] : entry;
            }),
            closestPrev = moment(disabledArray.filter(function(d) {
                return moment(d).isBefore(opts.startDate);
            }).sort(function(a,b){
                return moment(b).isAfter(moment(a));
            })[0]),
            closestNext = moment(disabledArray.filter(function(d) {
                return moment(d).isAfter(opts.startDate);
            }).sort(function(a,b){
                return moment(a).isAfter(moment(b));
            })[0]);

        [].forEach.call(days, function(dayCell) {
            var day = moment(parseInt(dayCell.getAttribute('data-time')));
            if (
                (closestPrev && day.isBefore(closestPrev) && opts.startDate.isAfter(closestPrev))
                || (closestNext && day.isAfter(closestNext) && closestNext.isAfter(opts.startDate))
            ) {
                dayCell.classList.remove('is-available');
                dayCell.classList.add('is-disabled');
            }
        });
    },

    Lightpick = function(options)
    {
        var self = this,
            opts = self.config(options);

        self.el = document.createElement('section');

        self.el.className = 'lightpick lightpick--' + opts.numberOfColumns + '-columns is-hidden';

        if (opts.inline) {
            self.el.className += ' lightpick--inlined';
        }

        var html = '<div class="lightpick__inner">'
        + (opts.numberOfMonths > 1 ? renderTopButtons(opts, 'days') : '')
        + '<div class="lightpick__months"></div>'
        + '<div class="lightpick__tooltip" style="visibility: hidden"></div>';

        if (opts.footer) {
            html += '<div class="lightpick__footer">';
            if (opts.footer === true) {
                html += '<button type="button" class="lightpick__reset-action">' + opts.locale.buttons.reset + '</button>';
                html += '<div class="lightpick__footer-message"></div>';
                html += '<button type="button" class="lightpick__apply-action">' + opts.locale.buttons.apply + '</button>';
            }
            else {
                html += opts.footer;
            }
            html += '</div>';
        }

        html += '</div>';

        self.el.innerHTML = html;


        if (opts.parentEl instanceof Node) {
            opts.parentEl.appendChild(self.el)
        }
        else if (opts.parentEl === 'body' && opts.inline) {
            opts.field.parentNode.appendChild(self.el);
        }
        else {
            document.querySelector(opts.parentEl).appendChild(self.el);
        }

        self._onMouseDown = function(e)
        {
            if (!self.isShowing) {
                return;
            }

            e = e || window.event;
            var target = e.target || e.srcElement;
            if (!target) {
                return;
            }

            e.stopPropagation();

            if (!target.classList.contains('lightpick__select')) {
                e.preventDefault();
            }

            var opts = self._opts;

            if (target.classList.contains('lightpick__day') && target.classList.contains('is-available')) {

                var day = moment(parseInt(target.getAttribute('data-time')));

                if (!opts.disabledDatesInRange && opts.disableDates && opts.startDate) {
                    var start = day.isAfter(opts.startDate) ? moment(opts.startDate) : moment(day),
                        end = day.isAfter(opts.startDate) ? moment(day) : moment(opts.startDate),

                        isInvalidRange = opts.disableDates.filter(function(d) {
                        if (d instanceof Array || Object.prototype.toString.call(d) === '[object Array]') {
                            var _from = moment(d[0]),
                                _to = moment(d[1]);

                            return _from.isValid() && _to.isValid() && (_from.isBetween(start, end, 'day', '[]') || _to.isBetween(start, end, 'day', '[]'));
                        }

                        return moment(d).isBetween(start, end, 'day', '[]');
                    });

                    if (isInvalidRange.length) {
                        self.setStartDate(null);
                        self.setEndDate(null);

                        target.dispatchEvent(new Event('mousedown'));
                        self.el.querySelector('.lightpick__tooltip').style.visibility = 'hidden';

                        updateDates(self.el, opts);
                        return;
                    }
                }

                if (opts.singleDate || (!opts.startDate && !opts.endDate) || (opts.startDate && opts.endDate)) {
                    if (opts.repick && opts.startDate && opts.endDate) {
                        if (opts.repickTrigger === opts.field) {
                            self.setStartDate(day);
                            target.classList.add('is-start-date');
                        }
                        else {
                            self.setEndDate(day);
                            target.classList.add('is-end-date');
                        }

                        if (opts.startDate.isAfter(opts.endDate)) {
                            self.swapDate();
                        }

                        if (opts.autoclose) {
                            setTimeout(function() {
                                self.hide();
                            }, 100);
                        }
                    }
                    else {
                        self.setStartDate(day);
                        self.setEndDate(null);

                        target.classList.add('is-start-date');

                        if (opts.singleDate && opts.autoclose) {
                            setTimeout(function() {
                                self.hide();
                            }, 100);
                        }
                        else if (!opts.singleDate || opts.inline || !opts.autoclose) {
                            updateDates(self.el, opts);
                        }
                    }
                }
                else if (opts.startDate && !opts.endDate) {
                    self.setEndDate(day);

                    if (opts.startDate.isAfter(opts.endDate)) {
                        self.swapDate();
                    }

                    target.classList.add('is-end-date');


                    if (opts.autoclose) {
                        setTimeout(function() {
                            self.hide();
                        }, 100);
                    }
                    else {
                        updateDates(self.el, opts);
                    }
                }

                if (!opts.disabledDatesInRange) {
                    if (self.el.querySelectorAll('.lightpick__day.is-available').length === 0) {
                        self.setStartDate(null);
                        updateDates(self.el, opts);

                        if (opts.footer) {
                            if (typeof self._opts.onError === 'function') {
                                self._opts.onError.call(self, 'Invalid range');
                            }
                            else {
                                var footerMessage = self.el.querySelector('.lightpick__footer-message');

                                if (footerMessage) {
                                    footerMessage.innerHTML = opts.locale.not_allowed_range;

                                    setTimeout(function(){
                                        footerMessage.innerHTML = '';
                                    }, 3000);
                                }
                            }
                        }
                    }
                }
            }
            else if (target.classList.contains('lightpick__previous-action')) {
                self.prevMonth();
            }
            else if (target.classList.contains('lightpick__next-action')) {
                self.nextMonth();
            }
            else if (target.classList.contains('lightpick__close-action') || target.classList.contains('lightpick__apply-action')) {
                self.hide();
            }
            else if (target.classList.contains('lightpick__reset-action')) {
                self.reset();
            }
        };
        self._onMouseEnter = function(e)
        {
            if (!self.isShowing) {
                return;
            }

            e = e || window.event;
            var target = e.target || e.srcElement;
            if (!target) {
                return;
            }

            var opts = self._opts;

            if (target.classList.contains('lightpick__day') && target.classList.contains('disabled-tooltip') && opts.locale.tooltipOnDisabled) {
                self.showTooltip(target, opts.locale.tooltipOnDisabled);
                return;
            }
            else {
                self.hideTooltip();
            }

            if (opts.singleDate || (!opts.startDate && !opts.endDate)) {
                return;
            }

            if (!target.classList.contains('lightpick__day') && !target.classList.contains('is-available')) {
                return;
            }

            if ((opts.startDate && !opts.endDate) || opts.repick) {
                var hoverDate = moment(parseInt(target.getAttribute('data-time')));

                if (!hoverDate.isValid()) {
                    return;
                }

                var startDate = (opts.startDate && !opts.endDate) || (opts.repick && opts.repickTrigger === opts.secondField) ? opts.startDate : opts.endDate;

                var days = self.el.querySelectorAll('.lightpick__day');
                [].forEach.call(days, function(day) {
                    var dt = moment(parseInt(day.getAttribute('data-time')));

                    day.classList.remove('is-flipped');

                    if (dt.isValid() && dt.isSameOrAfter(startDate, 'day') && dt.isSameOrBefore(hoverDate, 'day')) {
                        day.classList.add('is-in-range');

                        if (opts.repickTrigger === opts.field && dt.isSameOrAfter(opts.endDate)) {
                            day.classList.add('is-flipped');
                        }
                    }
                    else if (dt.isValid() && dt.isSameOrAfter(hoverDate, 'day') && dt.isSameOrBefore(startDate, 'day')) {
                        day.classList.add('is-in-range');

                        if (((opts.startDate && !opts.endDate) || opts.repickTrigger === opts.secondField) && dt.isSameOrBefore(opts.startDate)) {
                            day.classList.add('is-flipped');
                        }
                    }
                    else {
                        day.classList.remove('is-in-range');
                    }

                    if (opts.startDate && opts.endDate && opts.repick && opts.repickTrigger === opts.field) {
                        day.classList.remove('is-start-date');
                    }
                    else {
                        day.classList.remove('is-end-date');
                    }
                });

                if (opts.hoveringTooltip) {
                    days = Math.abs(hoverDate.isAfter(startDate) ? hoverDate.diff(startDate, 'day') : startDate.diff(hoverDate, 'day'));

                    if (!opts.tooltipNights) {
                        days += 1;
                    }

                    var tooltip = self.el.querySelector('.lightpick__tooltip');

                    if (days > 0 && !target.classList.contains('is-disabled')) {

                        var pluralText = '';
                        if (typeof opts.locale.pluralize === 'function') {
                            pluralText = opts.locale.pluralize.call(self, days, opts.locale.tooltip);
                        }

                        self.showTooltip(target, days + ' ' + pluralText);
                    }
                    else {
                        self.hideTooltip();
                    }
                }

                if (opts.startDate && opts.endDate && opts.repick && opts.repickTrigger === opts.field) {
                    target.classList.add('is-start-date');
                }
                else {
                    target.classList.add('is-end-date');
                }
            }
        };
        self._onChange = function(e)
        {
            e = e || window.event;
            var target = e.target || e.srcElement;
            if (!target) {
                return;
            }

            if (target.classList.contains('lightpick__select-months')) {
                if (typeof self._opts.onMonthsChange === 'function') {
                    self._opts.onMonthsChange.call(this, target.value);
                }

                self.gotoMonth(target.value);
            }
            else if (target.classList.contains('lightpick__select-years')) {
                if (typeof self._opts.onYearsChange === 'function') {
                    self._opts.onYearsChange.call(this, target.value);
                }

                self.gotoYear(target.value);
            }
        };

        self._onInputChange = function(e)
        {
            var target = e.target || e.srcElement;

            if (self._opts.singleDate) {
                if (!self._opts.autoclose) {
                    self.gotoDate(opts.field.value);
                }
            }

            self.syncFields();

            if (!self.isShowing) {
                self.show();
            }
        };

        self._onInputFocus = function(e)
        {
            var target = e.target || e.srcElement;

            self.show(target);
        };

        self._onInputClick = function(e)
        {
            var target = e.target || e.srcElement;

            self.show(target);
        };

        self._onClick = function(e)
        {
            e = e || window.event;
            var target = e.target || e.srcElement,
                parentEl = target;

            if (!target) {
                return;
            }

            do {
                if ((parentEl.classList && parentEl.classList.contains('lightpick')) || parentEl === opts.field || (opts.secondField && parentEl === opts.secondField)) {
                    return;
                }
            }
            while ((parentEl = parentEl.parentNode));

            if (self.isShowing && opts.hideOnBodyClick && target !== opts.field && parentEl !== opts.field) {
                self.hide();
            }
        };

        self.showTooltip = function(target, text)
        {
            var tooltip = self.el.querySelector('.lightpick__tooltip');

            var hasParentEl = self.el.classList.contains('lightpick--inlined'),
            dayBounding = target.getBoundingClientRect(),
            pickerBouding = hasParentEl ? self.el.parentNode.getBoundingClientRect() : self.el.getBoundingClientRect(),
            _left = (dayBounding.left - pickerBouding.left) + (dayBounding.width / 2),
            _top = dayBounding.top - pickerBouding.top;

            tooltip.style.visibility = 'visible';
            tooltip.textContent = text;

            var tooltipBounding = tooltip.getBoundingClientRect();

            _top -= tooltipBounding.height;
            _left -= (tooltipBounding.width / 2);

            setTimeout(function(){
                tooltip.style.top = _top + 'px';
                tooltip.style.left = _left + 'px';
            }, 10);
        };

        self.hideTooltip = function()
        {
            var tooltip = self.el.querySelector('.lightpick__tooltip');
            tooltip.style.visibility = 'hidden';
        };

        self.el.addEventListener('mousedown', self._onMouseDown, true);
        self.el.addEventListener('mouseenter', self._onMouseEnter, true);
        self.el.addEventListener('touchend', self._onMouseDown, true);
        self.el.addEventListener('change', self._onChange, true);

        if (opts.inline) {
            self.show();
        }
        else {
            self.hide();
        }

        opts.field.addEventListener('change', self._onInputChange);
        opts.field.addEventListener('click', self._onInputClick);
        opts.field.addEventListener('focus', self._onInputFocus);

        if (opts.secondField) {
            opts.secondField.addEventListener('change', self._onInputChange);
            opts.secondField.addEventListener('click', self._onInputClick);
            opts.secondField.addEventListener('focus', self._onInputFocus);
        }
    };

    Lightpick.prototype = {
        config: function(options)
        {
            var opts = Object.assign({}, defaults, options);

            opts.field = (opts.field && opts.field.nodeName) ? opts.field : null;

            opts.calendar = [moment().set('date', 1)];

            if (opts.numberOfMonths === 1 && opts.numberOfColumns > 1) {
                opts.numberOfColumns = 1;
            }

            opts.minDate = opts.minDate && moment(opts.minDate, opts.format).isValid() ? moment(opts.minDate, opts.format) : null;

            opts.maxDate = opts.maxDate && moment(opts.maxDate, opts.format).isValid() ? moment(opts.maxDate, opts.format) : null;

            if (opts.lang === 'auto') {
                var browserLang = navigator.language || navigator.userLanguage;
                if (browserLang) {
                    opts.lang = browserLang;
                }
                else {
                    opts.lang = 'en-US';
                }
            }

            if (opts.secondField && opts.singleDate) {
                opts.singleDate = false;
            }

            if (opts.hoveringTooltip && opts.singleDate) {
                opts.hoveringTooltip = false;
            }

            if (Object.prototype.toString.call(options.locale) === '[object Object]') {
                opts.locale = Object.assign({}, defaults.locale, options.locale);
            }

            if (window.innerWidth < 480 && opts.numberOfMonths > 1) {
                opts.numberOfMonths = 1;
                opts.numberOfColumns = 1;
            }

            if (opts.repick && !opts.secondField) {
                opts.repick = false;
            }

            if (opts.inline) {
                opts.autoclose = false;
                opts.hideOnBodyClick = false;
            }

            this._opts = Object.assign({}, opts);

            this.syncFields();

            this.setStartDate(this._opts.startDate, true);
            this.setEndDate(this._opts.endDate, true);

            return this._opts;
        },

        syncFields: function()
        {
            if (this._opts.singleDate || this._opts.secondField) {
                if (moment(this._opts.field.value, this._opts.format).isValid()) {
                    this._opts.startDate = moment(this._opts.field.value, this._opts.format);
                }

                if (this._opts.secondField && moment(this._opts.secondField.value, this._opts.format).isValid()) {
                    this._opts.endDate = moment(this._opts.secondField.value, this._opts.format);
                }
            }
            else {
                var dates = this._opts.field.value.split(this._opts.separator);

                if (dates.length === 2) {
                    if (moment(dates[0], this._opts.format).isValid()) {
                        this._opts.startDate = moment(dates[0], this._opts.format);
                    }

                    if (moment(dates[1], this._opts.format).isValid()) {
                        this._opts.endDate = moment(dates[1], this._opts.format);
                    }
                }
            }
        },

        swapDate: function()
        {
            var tmp = moment(this._opts.startDate);
            this.setDateRange(this._opts.endDate, tmp);
        },

        gotoToday: function()
        {
            this.gotoDate(new Date());
        },

        gotoDate: function(date)
        {
            var date = moment(date, this._opts.format);

            if (!date.isValid()) {
                date = moment();
            }

            date.set('date', 1);

            this._opts.calendar = [moment(date)];

            renderCalendar(this.el, this._opts);
        },

        gotoMonth: function(month)
        {
            if (isNaN(month)) {
                return;
            }

            this._opts.calendar[0].set('month', month);

            renderCalendar(this.el, this._opts);
        },

        gotoYear: function(year)
        {
            if (isNaN(year)) {
                return;
            }

            this._opts.calendar[0].set('year', year);

            renderCalendar(this.el, this._opts);
        },

        prevMonth: function()
        {
            this._opts.calendar[0] = moment(this._opts.calendar[0]).subtract(this._opts.numberOfMonths, 'month');

            renderCalendar(this.el, this._opts);

            checkDisabledDatesInRange(this.el, this._opts);
        },

        nextMonth: function()
        {
            this._opts.calendar[0] = moment(this._opts.calendar[1]);

            renderCalendar(this.el, this._opts);

            checkDisabledDatesInRange(this.el, this._opts);
        },

        updatePosition: function()
        {
            if (this.el.classList.contains('lightpick--inlined')) return;

            // remove `is-hidden` class for getBoundingClientRect
            this.el.classList.remove('is-hidden');

            var rect = this._opts.field.getBoundingClientRect(),
                calRect = this.el.getBoundingClientRect(),
                orientation = this._opts.orientation.split(' '),
                top = 0,
                left = 0;

            if (orientation[0] == 'auto' || !(/top|bottom/.test(orientation[0]))) {
                if (rect.bottom + calRect.height > window.innerHeight && window.pageYOffset > calRect.height) {
                    top = (rect.top + window.pageYOffset) - calRect.height;
                }
                else {
                    top = rect.bottom + window.pageYOffset;
                }
            }
            else {
                top = rect[orientation[0]] + window.pageYOffset;

                if (orientation[0] == 'top') {
                    top -= calRect.height;
                }
            }

            if (!(/left|right/.test(orientation[0])) && (!orientation[1] || orientation[1] == 'auto' || !(/left|right/.test(orientation[1])))) {
                if (rect.left + calRect.width > window.innerWidth) {
                    left = (rect.right + window.pageXOffset) - calRect.width;
                }
                else {
                    left = rect.left + window.pageXOffset;
                }
            }
            else {
                if (/left|right/.test(orientation[0])) {
                    left = rect[orientation[0]] + window.pageXOffset;
                }
                else {
                    left = rect[orientation[1]] + window.pageXOffset;
                }

                if (orientation[0] == 'right' || orientation[1] == 'right') {
                    left -= calRect.width;
                }
            }

            this.el.classList.add('is-hidden');

            this.el.style.top = top + 'px';
            this.el.style.left = left + 'px';
        },

        setStartDate: function(date, preventOnSelect)
        {
            var dateISO = moment(date, moment.ISO_8601),
                dateOptFormat = moment(date, this._opts.format);

            if (!dateISO.isValid() && !dateOptFormat.isValid()) {
                this._opts.startDate = null;
                this._opts.field.value = '';
                return;
            }

            this._opts.startDate = moment(dateISO.isValid() ? dateISO : dateOptFormat);

            if (this._opts.singleDate || this._opts.secondField) {
                this._opts.field.value = this._opts.startDate.format(this._opts.format);
            }
            else {
                this._opts.field.value = this._opts.startDate.format(this._opts.format) + this._opts.separator + '...'
            }

            if (!preventOnSelect && typeof this._opts.onSelect === 'function') {
                this._opts.onSelect.call(this, this.getStartDate(), this.getEndDate());
            }

            if (!preventOnSelect && !this._opts.singleDate && typeof this._opts.onSelectStart === 'function') {
                this._opts.onSelectStart.call(this, this.getStartDate());
            }
        },

        setEndDate: function(date, preventOnSelect)
        {
            var dateISO = moment(date, moment.ISO_8601),
                dateOptFormat = moment(date, this._opts.format);

            if (!dateISO.isValid() && !dateOptFormat.isValid()) {
                this._opts.endDate = null;

                if (this._opts.secondField) {
                    this._opts.secondField.value = '';
                }
                else if (!this._opts.singleDate && this._opts.startDate) {
                    this._opts.field.value = this._opts.startDate.format(this._opts.format) + this._opts.separator + '...'
                }
                return;
            }

            this._opts.endDate = moment(dateISO.isValid() ? dateISO : dateOptFormat);

            if (this._opts.secondField) {
                this._opts.field.value = this._opts.startDate.format(this._opts.format);
                this._opts.secondField.value = this._opts.endDate.format(this._opts.format);
            }
            else {
                this._opts.field.value = this._opts.startDate.format(this._opts.format) + this._opts.separator + this._opts.endDate.format(this._opts.format);
            }

            if (!preventOnSelect && typeof this._opts.onSelect === 'function') {
                this._opts.onSelect.call(this, this.getStartDate(), this.getEndDate());
            }

            if (!preventOnSelect && !this._opts.singleDate && typeof this._opts.onSelectEnd === 'function') {
                this._opts.onSelectEnd.call(this, this.getEndDate());
            }
        },

        setDate: function(date, preventOnSelect)
        {
            if (!this._opts.singleDate) {
                return;
            }
            this.setStartDate(date, preventOnSelect);

            if (this.isShowing) {
                updateDates(this.el, this._opts);
            }
        },

        setDateRange: function(start, end, preventOnSelect)
        {
            if (this._opts.singleDate) {
                return;
            }
            this.setStartDate(start, true);
            this.setEndDate(end, true);

            if (this.isShowing) {
                updateDates(this.el, this._opts);
            }

            if (!preventOnSelect && typeof this._opts.onSelect === 'function') {
                this._opts.onSelect.call(this, this.getStartDate(), this.getEndDate());
            }
        },

        setDisableDates: function(dates)
        {
            this._opts.disableDates = dates;

            if (this.isShowing) {
                updateDates(this.el, this._opts);
            }
        },

        getStartDate: function()
        {
            return moment(this._opts.startDate).isValid() ? this._opts.startDate.clone() : null;
        },

        getEndDate: function()
        {
            return moment(this._opts.endDate).isValid() ? this._opts.endDate.clone() : null;
        },

        getDate: function()
        {
            return moment(this._opts.startDate).isValid() ? this._opts.startDate.clone() : null;
        },

        toString: function(format)
        {
            if (this._opts.singleDate) {
                return moment(this._opts.startDate).isValid() ? this._opts.startDate.format(format) : '';
            }

            if (moment(this._opts.startDate).isValid() && moment(this._opts.endDate).isValid()) {
                return this._opts.startDate.format(format) + this._opts.separator + this._opts.endDate.format(format);
            }

            if (moment(this._opts.startDate).isValid() && !moment(this._opts.endDate).isValid()) {
                return this._opts.startDate.format(format) + this._opts.separator + '...';
            }

            if (!moment(this._opts.startDate).isValid() && moment(this._opts.endDate).isValid()) {
                return '...' + this._opts.separator + this._opts.endDate.format(format);
            }

            return '';
        },

        show: function(target)
        {
            if (!this.isShowing) {
                this.isShowing = true;

                if (this._opts.repick) {
                    this._opts.repickTrigger = target;
                }

                this.syncFields();

                if (this._opts.secondField && this._opts.secondField === target && this._opts.endDate) {
                    this.gotoDate(this._opts.endDate);
                }
                else {
                    this.gotoDate(this._opts.startDate);
                }

                document.addEventListener('click', this._onClick);

                this.updatePosition();

                this.el.classList.remove('is-hidden');

                if (typeof this._opts.onOpen === 'function') {
                    this._opts.onOpen.call(this);
                }

                if (document.activeElement && document.activeElement != document.body) {
                    document.activeElement.blur();
                }
            }
        },

        hide: function()
        {
            if (this.isShowing) {
                this.isShowing = false;

                document.removeEventListener('click', this._onClick);

                this.el.classList.add('is-hidden');

                this.el.querySelector('.lightpick__tooltip').style.visibility = 'hidden';

                if (typeof this._opts.onClose === 'function') {
                    this._opts.onClose.call(this);
                }
            }
        },

        destroy: function()
        {
            var opts = this._opts;

            this.hide();

            this.el.removeEventListener('mousedown', self._onMouseDown, true);
            this.el.removeEventListener('mouseenter', self._onMouseEnter, true);
            this.el.removeEventListener('touchend', self._onMouseDown, true);
            this.el.removeEventListener('change', self._onChange, true);

            opts.field.removeEventListener('change', this._onInputChange);
            opts.field.removeEventListener('click', this._onInputClick);
            opts.field.removeEventListener('focus', this._onInputFocus);

            if (opts.secondField) {
                opts.secondField.removeEventListener('change', this._onInputChange);
                opts.secondField.removeEventListener('click', this._onInputClick);
                opts.secondField.removeEventListener('focus', this._onInputFocus);
            }

            if (this.el.parentNode) {
                this.el.parentNode.removeChild(this.el);
            }
        },

        reset: function()
        {
            this.setStartDate(null, true);
            this.setEndDate(null, true);

            updateDates(this.el, this._opts);

            if (typeof this._opts.onSelect === 'function') {
                this._opts.onSelect.call(this, this.getStartDate(), this.getEndDate());
            }

            this.el.querySelector('.lightpick__tooltip').style.visibility = 'hidden';
        },

        reloadOptions: function(options)
        {
            var dropdowns = this._opts.dropdowns;
            var locale = this._opts.locale;

            Object.assign(this._opts, this._opts, options);
            Object.assign(this._opts.dropdowns, dropdowns, options.dropdowns);
            Object.assign(this._opts.locale, locale, options.locale);
        }

    };

    return Lightpick;
}));
