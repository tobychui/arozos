/*
    ArozOS Office Sheets - date and time functions
    ==============================================
    Registers into the formula engine (formula.js); load after it.
    Dates are Excel 1900-system serials (days since 1899-12-30 plus a day
    fraction); date text such as "2024-05-01" is accepted wherever a date is.

        DATE TIME TODAY NOW YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY
        DATEVALUE TIMEVALUE EDATE EOMONTH DAYS DAYS360 DATEDIF YEARFRAC
        WEEKNUM ISOWEEKNUM NETWORKDAYS NETWORKDAYS.INTL WORKDAY WORKDAY.INTL
        EPOCHTODATE
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr;
    var EPOCH = F.EPOCH, DAY_MS = F.DAY_MS;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Date", elem: true };
        for (var k in extra || {}) spec[k] = extra[k];
        if (spec.hint) {
            /* A function that answers with a date asks its cell to show one:
               the grid uses the hint only when the cell has no format of its
               own, so =TODAY() reads as a date instead of a serial number. */
            var inner = spec.fn, fmt = spec.hint;
            spec.fn = function (a, E, arrayCtx) {
                var v = inner(a, E, arrayCtx);
                if (typeof v === "number") E.hint(fmt);
                return v;
            };
        }
        F.defineFunction(name, spec);
    }
    function num(msg) { return new FErr(ERR.NUM, msg); }
    function all(list) {
        for (var i = 0; i < list.length; i++) if (isErr(list[i])) return list[i];
        return list;
    }

    // serial -> {y, m (0-based), d, dow (0 = Sunday)}
    function ymd(serial) {
        var dt = new Date(EPOCH + Math.floor(serial) * DAY_MS);
        return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), dow: dt.getUTCDay() };
    }
    // (year, 0-based month, day) -> serial; month/day overflow roll over
    function serialOf(y, m, d) {
        var dt = new Date(Date.UTC(2000, 0, 1));
        dt.setUTCFullYear(y, m, d);
        return Math.round((dt.getTime() - EPOCH) / DAY_MS);
    }
    function daysInMonth(y, m) { return serialOf(y, m + 1, 1) - serialOf(y, m, 1); }
    function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
    // a date argument as a whole-day serial
    function dateArg(E, node, def) {
        var v = E.num(node, def);
        if (isErr(v)) return v;
        if (v < 0) return num("Dates cannot be negative");
        return Math.floor(v);
    }

    /* ---------- building and taking apart ---------- */
    def("DATE", 3, 3, function (a, E) {
        var p = all([E.int(a[0]), E.int(a[1]), E.int(a[2])]);
        if (isErr(p)) return p;
        var y = p[0];
        if (y >= 0 && y < 1900) y += 1900;     // Excel: DATE(12,1,1) is 1912
        if (y < 0 || y > 9999) return num("DATE year out of range");
        var s = serialOf(y, p[1] - 1, p[2]);
        return s < 0 ? num("DATE before 1900") : s;
    }, { hint: "date", syntax: "DATE(year, month, day)" });
    def("TIME", 3, 3, function (a, E) {
        var p = all([E.int(a[0]), E.int(a[1]), E.int(a[2])]);
        if (isErr(p)) return p;
        var total = p[0] * 3600 + p[1] * 60 + p[2];
        if (total < 0) return num("TIME cannot be negative");
        return (total % 86400) / 86400;
    }, { syntax: "TIME(hour, minute, second)" });
    def("TODAY", 0, 0, function () { return Math.floor(F.dateToSerial(new Date())); },
        { hint: "date", volatile: true, syntax: "TODAY()" });
    def("NOW", 0, 0, function () { return F.dateToSerial(new Date()); }, { volatile: true, syntax: "NOW()" });
    function part(name, fn) {
        def(name, 1, 1, function (a, E) {
            var v = E.num(a[0]);
            if (isErr(v)) return v;
            if (v < 0) return num(name + " of a negative date");
            return fn(v);
        }, { syntax: name + "(date)" });
    }
    part("YEAR", function (v) { return ymd(v).y; });
    part("MONTH", function (v) { return ymd(v).m + 1; });
    part("DAY", function (v) { return ymd(v).d; });
    // seconds into the day, rounded to the nearest second like Excel
    function daySeconds(v) { return Math.round((v - Math.floor(v)) * 86400) % 86400; }
    part("HOUR", function (v) { return Math.floor(daySeconds(v) / 3600); });
    part("MINUTE", function (v) { return Math.floor(daySeconds(v) / 60) % 60; });
    part("SECOND", function (v) { return daySeconds(v) % 60; });
    def("WEEKDAY", 1, 2, function (a, E) {
        // 1 (default): Sunday=1 .. Saturday=7; 2: Monday=1 .. Sunday=7;
        // 3: Monday=0 .. Sunday=6; 11-17: 1 on Monday .. Sunday respectively
        var d = dateArg(E, a[0]);
        if (isErr(d)) return d;
        var t = E.int(a[1], 1);
        if (isErr(t)) return t;
        var dow = ymd(d).dow;
        if (t === 1) return dow + 1;
        if (t === 2) return (dow + 6) % 7 + 1;
        if (t === 3) return (dow + 6) % 7;
        if (t >= 11 && t <= 17) return (dow - (t - 10) % 7 + 7) % 7 + 1;
        return num("WEEKDAY return type " + t + " is not supported");
    }, { syntax: "WEEKDAY(date, [type])" });

    def("DATEVALUE", 1, 1, function (a, E) {
        var v = E.val(a[0]);
        if (isErr(v)) return v;
        if (typeof v !== "string") return new FErr(ERR.VALUE, "DATEVALUE needs date text");
        var s = F.parseDateText(v);
        return s === null ? new FErr(ERR.VALUE, "'" + v + "' is not a date") : Math.floor(s);
    }, { hint: "date", syntax: "DATEVALUE(date_string)" });
    def("TIMEVALUE", 1, 1, function (a, E) {
        var v = E.val(a[0]);
        if (isErr(v)) return v;
        if (typeof v !== "string") return new FErr(ERR.VALUE, "TIMEVALUE needs time text");
        var s = F.parseDateText(v);
        return s === null ? new FErr(ERR.VALUE, "'" + v + "' is not a time") : s - Math.floor(s);
    }, { syntax: "TIMEVALUE(time_string)" });
    def("EPOCHTODATE", 1, 2, function (a, E) {
        var p = all([E.num(a[0]), E.int(a[1], 1)]);
        if (isErr(p)) return p;
        var div = { 1: 1, 2: 1e3, 3: 1e6 }[p[1]];
        if (!div) return num("EPOCHTODATE unit must be 1, 2 or 3");
        if (p[0] < 0) return num("EPOCHTODATE timestamp cannot be negative");
        return p[0] / div / 86400 + 25569;
    }, { syntax: "EPOCHTODATE(timestamp, [unit])" });

    /* ---------- arithmetic ---------- */
    def("EDATE", 2, 2, function (a, E) {
        var s = dateArg(E, a[0]), months = E.int(a[1]);
        if (isErr(s)) return s;
        if (isErr(months)) return months;
        var d = ymd(s), m = d.m + months;
        var y = d.y + Math.floor(m / 12);
        m = ((m % 12) + 12) % 12;
        var r = serialOf(y, m, Math.min(d.d, daysInMonth(y, m)));
        return r < 0 ? num("EDATE before 1900") : r;
    }, { hint: "date", syntax: "EDATE(start_date, months)" });
    def("EOMONTH", 2, 2, function (a, E) {
        var s = dateArg(E, a[0]), months = E.int(a[1]);
        if (isErr(s)) return s;
        if (isErr(months)) return months;
        var d = ymd(s);
        var r = serialOf(d.y, d.m + months + 1, 0);
        return r < 0 ? num("EOMONTH before 1900") : r;
    }, { hint: "date", syntax: "EOMONTH(start_date, months)" });
    def("DAYS", 2, 2, function (a, E) {
        var p = all([dateArg(E, a[0]), dateArg(E, a[1])]);
        return isErr(p) ? p : p[0] - p[1];
    }, { syntax: "DAYS(end_date, start_date)" });
    def("DATEDIF", 3, 3, function (a, E) {
        var p = all([dateArg(E, a[0]), dateArg(E, a[1]), E.str(a[2])]);
        if (isErr(p)) return p;
        var s = p[0], e = p[1], unit = p[2].toUpperCase();
        if (s > e) return num("DATEDIF start date is after the end date");
        var A = ymd(s), B = ymd(e);
        var months = (B.y - A.y) * 12 + B.m - A.m - (B.d < A.d ? 1 : 0);
        switch (unit) {
            case "Y": return Math.floor(months / 12);
            case "M": return months;
            case "D": return e - s;
            case "YM": return months % 12;
            case "MD": return B.d >= A.d ? B.d - A.d : e - serialOf(B.y, B.m - 1, A.d);
            case "YD": {
                var anniv = serialOf(B.y, A.m, A.d);
                if (anniv > e) anniv = serialOf(B.y - 1, A.m, A.d);
                return e - anniv;
            }
        }
        return num("DATEDIF unit must be Y, M, D, MD, YM or YD");
    }, { syntax: "DATEDIF(start_date, end_date, unit)" });

    def("DAYS360", 2, 3, function (a, E) {
        var p = all([dateArg(E, a[0]), dateArg(E, a[1]), E.bool(a[2], false)]);
        if (isErr(p)) return p;
        var A = ymd(p[0]), B = ymd(p[1]), d1 = A.d, d2 = B.d;
        if (p[2]) {                                   // European
            if (d1 === 31) d1 = 30;
            if (d2 === 31) d2 = 30;
        } else {                                      // US (NASD)
            if (d1 === 31) d1 = 30;
            else if (A.m === 1 && d1 === daysInMonth(A.y, 1)) d1 = 30;
            if (d2 === 31 && d1 >= 30) d2 = 30;
        }
        return (B.y - A.y) * 360 + (B.m - A.m) * 30 + d2 - d1;
    }, { syntax: "DAYS360(start_date, end_date, [method])" });

    // YEARFRAC day-count bases, shared with the finance functions
    function yearFrac(s, e, basis) {
        if (s > e) { var t = s; s = e; e = t; }
        var A = ymd(s), B = ymd(e);
        switch (basis) {
            case 0: {
                var sd = A.d, ed = B.d;
                var lastFebA = A.m === 1 && sd === daysInMonth(A.y, 1);
                var lastFebB = B.m === 1 && ed === daysInMonth(B.y, 1);
                if (sd === 31 && ed === 31) { sd = 30; ed = 30; }
                else if (sd === 31) sd = 30;
                else if (sd === 30 && ed === 31) ed = 30;
                else if (lastFebA && lastFebB) { sd = 30; ed = 30; }
                else if (lastFebA) sd = 30;
                return ((ed + B.m * 30 + B.y * 360) - (sd + A.m * 30 + A.y * 360)) / 360;
            }
            case 1: {
                var days = e - s;
                if (A.y === B.y || (A.y + 1 === B.y && (A.m > B.m || (A.m === B.m && A.d >= B.d)))) {
                    var leapDay = false;
                    if (A.y === B.y) leapDay = isLeap(A.y);
                    else {
                        // a 29 February inside the span
                        [A.y, B.y].forEach(function (y) {
                            if (!isLeap(y)) return;
                            var f29 = serialOf(y, 1, 29);
                            if (f29 >= s && f29 <= e) leapDay = true;
                        });
                    }
                    return days / (leapDay ? 366 : 365);
                }
                var years = B.y - A.y + 1;
                var total = serialOf(B.y + 1, 0, 1) - serialOf(A.y, 0, 1);
                return days / (total / years);
            }
            case 2: return (e - s) / 360;
            case 3: return (e - s) / 365;
            case 4: {
                var d1 = Math.min(A.d, 30), d2 = Math.min(B.d, 30);
                return ((B.y - A.y) * 360 + (B.m - A.m) * 30 + d2 - d1) / 360;
            }
        }
        return num("Basis must be 0-4");
    }
    F.yearFrac = yearFrac;
    def("YEARFRAC", 2, 3, function (a, E) {
        var p = all([dateArg(E, a[0]), dateArg(E, a[1]), E.int(a[2], 0)]);
        if (isErr(p)) return p;
        if (p[2] < 0 || p[2] > 4) return num("YEARFRAC basis must be 0-4");
        return yearFrac(p[0], p[1], p[2]);
    }, { syntax: "YEARFRAC(start_date, end_date, [day_count_convention])" });

    /* ---------- weeks ---------- */
    def("WEEKNUM", 1, 2, function (a, E) {
        var d = dateArg(E, a[0]), t = E.int(a[1], 1);
        if (isErr(d)) return d;
        if (isErr(t)) return t;
        var info = ymd(d);
        if (t === 21) return isoWeek(d);
        var startDow;                 // 0 = Sunday
        if (t === 1 || t === 17) startDow = 0;
        else if (t === 2 || t === 11) startDow = 1;
        else if (t >= 12 && t <= 16) startDow = t - 10;
        else return num("WEEKNUM type " + t + " is not supported");
        var jan1 = serialOf(info.y, 0, 1);
        var offset = (ymd(jan1).dow - startDow + 7) % 7;
        return Math.floor((d - jan1 + offset) / 7) + 1;
    }, { syntax: "WEEKNUM(date, [type])" });
    function isoWeek(d) {
        var dow = (ymd(d).dow + 6) % 7;            // Monday = 0
        var thursday = d - dow + 3;
        var y = ymd(thursday).y;
        return Math.floor((thursday - serialOf(y, 0, 1)) / 7) + 1;
    }
    def("ISOWEEKNUM", 1, 1, function (a, E) {
        var d = dateArg(E, a[0]);
        return isErr(d) ? d : isoWeek(d);
    }, { syntax: "ISOWEEKNUM(date)" });

    /* ---------- working days ---------- */
    // weekend spec -> 7 booleans indexed by getUTCDay (0 = Sunday)
    var WEEKEND_PAIRS = { 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6] };
    function weekendMask(E, node) {
        var mask = [false, false, false, false, false, false, false];
        if (E.missing(node)) { mask[0] = mask[6] = true; return mask; }
        var v = E.val(node);
        if (isErr(v)) return v;
        if (typeof v === "string" && (v.length === 7 || !/^\d+$/.test(v))) {
            // seven 0/1 characters, Monday first
            if (!/^[01]{7}$/.test(v) || v === "1111111") return new FErr(ERR.VALUE, "Weekend must be seven 0/1 characters with a workday");
            for (var i = 0; i < 7; i++) mask[(i + 1) % 7] = v.charAt(i) === "1";
            return mask;
        }
        var n = Math.trunc(F.toNum(v));
        if (WEEKEND_PAIRS[n]) { WEEKEND_PAIRS[n].forEach(function (k) { mask[k] = true; }); return mask; }
        if (n >= 11 && n <= 17) { mask[n - 11] = true; return mask; }   // 11 Sunday .. 17 Saturday
        return num("Unknown weekend code " + n);
    }
    function holidaySet(E, node) {
        var set = {};
        if (E.missing(node)) return set;
        var vals = E.flat(node);
        if (isErr(vals)) return vals;
        for (var i = 0; i < vals.length; i++) {
            var v = vals[i];
            if (v === null || v === undefined || v === "") continue;
            if (isErr(v)) return v;
            var n = typeof v === "number" ? v : F.toNum(v);
            if (isErr(n)) return n;
            set[Math.floor(n)] = true;
        }
        return set;
    }
    function isWorkday(d, mask, hol) {
        return !mask[ymd(d).dow] && !hol[d];
    }
    function networkdays(a, E, intl) {
        var s = dateArg(E, a[0]), e = dateArg(E, a[1]);
        if (isErr(s)) return s;
        if (isErr(e)) return e;
        var mask = intl ? weekendMask(E, a[2]) : weekendMask(E, null);
        if (isErr(mask)) return mask;
        var hol = holidaySet(E, a[intl ? 3 : 2]);
        if (isErr(hol)) return hol;
        var sign = 1;
        if (s > e) { var t = s; s = e; e = t; sign = -1; }
        var n = 0;
        for (var d = s; d <= e; d++) if (isWorkday(d, mask, hol)) n++;
        return sign * n;
    }
    def("NETWORKDAYS", 2, 3, function (a, E) { return networkdays(a, E, false); },
        { elem: false, syntax: "NETWORKDAYS(start_date, end_date, [holidays])" });
    def("NETWORKDAYS.INTL", 2, 4, function (a, E) { return networkdays(a, E, true); },
        { elem: false, syntax: "NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])" });
    function workday(a, E, intl) {
        var s = dateArg(E, a[0]), days = E.int(a[1]);
        if (isErr(s)) return s;
        if (isErr(days)) return days;
        var mask = intl ? weekendMask(E, a[2]) : weekendMask(E, null);
        if (isErr(mask)) return mask;
        if (mask.every(function (x) { return x; })) return new FErr(ERR.VALUE, "Every day is a weekend");
        var hol = holidaySet(E, a[intl ? 3 : 2]);
        if (isErr(hol)) return hol;
        var step = days < 0 ? -1 : 1, left = Math.abs(days), d = s;
        while (left > 0) {
            d += step;
            if (d < 0) return num("WORKDAY before 1900");
            if (isWorkday(d, mask, hol)) left--;
        }
        return d;
    }
    def("WORKDAY", 2, 3, function (a, E) { return workday(a, E, false); },
        { elem: false, hint: "date", syntax: "WORKDAY(start_date, num_days, [holidays])" });
    def("WORKDAY.INTL", 2, 4, function (a, E) { return workday(a, E, true); },
        { elem: false, hint: "date", syntax: "WORKDAY.INTL(start_date, num_days, [weekend], [holidays])" });
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
