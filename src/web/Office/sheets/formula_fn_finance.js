/*
    ArozOS Office Sheets - financial functions
    ==========================================
    Registers into the formula engine (formula.js); load after it.
    Cash paid out is negative, cash received positive (spreadsheet
    convention); type 0 = payments at period end, 1 = at the start.

        loans       PMT IPMT PPMT CUMIPMT CUMPRINC ISPMT FV PV NPER RATE
        cash flows  NPV IRR MIRR XNPV XIRR FVSCHEDULE
        rates       EFFECT NOMINAL RRI PDURATION
        depreciation SLN SYD DB DDB VDB
        fractions   DOLLARDE DOLLARFR
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Financial", elem: true };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function num(msg) { return new FErr(ERR.NUM, msg); }
    function fin(v) {
        if (typeof v === "number" && !isFinite(v)) return num("Result is not a finite number");
        return v;
    }
    // numeric arguments with defaults: spec like [["rate"], ["fv", 0]]
    function nums(E, a, defaults) {
        var out = [];
        for (var i = 0; i < defaults.length; i++) {
            var v = defaults[i] === undefined ? E.num(a[i]) : E.num(a[i], defaults[i]);
            if (isErr(v)) return v;
            out.push(v);
        }
        return out;
    }

    /* ---------- time value of money ---------- */
    function pmt(rate, nper, pv, fv, type) {
        if (rate === 0) return -(pv + fv) / nper;
        var f = Math.pow(1 + rate, nper);
        return -(rate * (fv + pv * f)) / ((1 + rate * type) * (f - 1));
    }
    function fv(rate, nper, payment, pv, type) {
        if (rate === 0) return -(pv + payment * nper);
        var f = Math.pow(1 + rate, nper);
        return -(pv * f + payment * (1 + rate * type) * (f - 1) / rate);
    }
    function pv(rate, nper, payment, fvv, type) {
        if (rate === 0) return -(fvv + payment * nper);
        var f = Math.pow(1 + rate, nper);
        return -(fvv + payment * (1 + rate * type) * (f - 1) / rate) / f;
    }
    function ipmt(rate, per, nper, pvv, fvv, type) {
        var payment = pmt(rate, nper, pvv, fvv, type);
        var interest;
        if (per === 1) interest = type === 1 ? 0 : -pvv;
        else if (type === 1) interest = fv(rate, per - 2, payment, pvv, 1) - payment;
        else interest = fv(rate, per - 1, payment, pvv, 0);
        return interest * rate;
    }
    function typeArg(t) { return t ? 1 : 0; }

    def("PMT", 3, 5, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, 0, 0]);
        if (isErr(p)) return p;
        if (p[1] === 0) return num("PMT needs a non-zero number of periods");
        return fin(pmt(p[0], p[1], p[2], p[3], typeArg(p[4])));
    }, { syntax: "PMT(rate, number_of_periods, present_value, [future_value], [end_or_beginning])" });
    def("FV", 3, 5, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, 0, 0]);
        if (isErr(p)) return p;
        return fin(fv(p[0], p[1], p[2], p[3], typeArg(p[4])));
    }, { syntax: "FV(rate, number_of_periods, payment_amount, [present_value], [end_or_beginning])" });
    def("PV", 3, 5, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, 0, 0]);
        if (isErr(p)) return p;
        return fin(pv(p[0], p[1], p[2], p[3], typeArg(p[4])));
    }, { syntax: "PV(rate, number_of_periods, payment_amount, [future_value], [end_or_beginning])" });
    def("NPER", 3, 5, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, 0, 0]);
        if (isErr(p)) return p;
        var rate = p[0], payment = p[1], pvv = p[2], fvv = p[3], type = typeArg(p[4]);
        if (rate === 0) {
            if (payment === 0) return num("NPER needs a payment when the rate is 0");
            return fin(-(pvv + fvv) / payment);
        }
        var num1 = payment * (1 + rate * type) - fvv * rate;
        var den = payment * (1 + rate * type) + pvv * rate;
        if (num1 / den <= 0) return num("NPER has no solution for these values");
        return fin(Math.log(num1 / den) / Math.log(1 + rate));
    }, { syntax: "NPER(rate, payment_amount, present_value, [future_value], [end_or_beginning])" });
    def("IPMT", 4, 6, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined, 0, 0]);
        if (isErr(p)) return p;
        if (p[1] < 1 || p[1] > p[2]) return num("IPMT period is out of range");
        return fin(ipmt(p[0], p[1], p[2], p[3], p[4], typeArg(p[5])));
    }, { syntax: "IPMT(rate, period, number_of_periods, present_value, [future_value], [end_or_beginning])" });
    def("PPMT", 4, 6, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined, 0, 0]);
        if (isErr(p)) return p;
        if (p[1] < 1 || p[1] > p[2]) return num("PPMT period is out of range");
        var type = typeArg(p[5]);
        return fin(pmt(p[0], p[2], p[3], p[4], type) - ipmt(p[0], p[1], p[2], p[3], p[4], type));
    }, { syntax: "PPMT(rate, period, number_of_periods, present_value, [future_value], [end_or_beginning])" });
    function cumulative(name, principal) {
        def(name, 6, 6, function (a, E) {
            var p = nums(E, a, [undefined, undefined, undefined, undefined, undefined, undefined]);
            if (isErr(p)) return p;
            var rate = p[0], nper = p[1], pvv = p[2], start = Math.ceil(p[3]), end = Math.floor(p[4]), type = p[5];
            if (rate <= 0 || nper <= 0 || pvv <= 0 || start < 1 || end < start || end > nper || (type !== 0 && type !== 1)) {
                return num(name + " arguments are out of range");
            }
            var payment = pmt(rate, nper, pvv, 0, type), total = 0;
            for (var per = start; per <= end; per++) {
                var interest = ipmt(rate, per, nper, pvv, 0, type);
                total += principal ? payment - interest : interest;
            }
            return fin(total);
        }, { syntax: name + "(rate, number_of_periods, present_value, first_period, last_period, end_or_beginning)" });
    }
    cumulative("CUMIPMT", false);
    cumulative("CUMPRINC", true);
    def("ISPMT", 4, 4, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined]);
        if (isErr(p)) return p;
        if (p[2] === 0) return new FErr(ERR.DIV0, "ISPMT needs a non-zero number of periods");
        return fin(p[3] * p[0] * (p[1] / p[2] - 1));
    }, { syntax: "ISPMT(rate, period, number_of_periods, present_value)" });

    // Newton's method with a bisection fallback over [-0.9999, 10]
    function solve(f, df, guess) {
        var x = guess;
        for (var i = 0; i < 100; i++) {
            var y = f(x), d = df(x);
            if (!isFinite(y) || !isFinite(d) || d === 0) break;
            var nx = x - y / d;
            if (Math.abs(nx - x) < 1e-10) return nx;
            x = nx;
            if (x <= -1) break;
        }
        var lo = -0.9999999, hi = 10, flo = f(lo), fhi = f(hi);
        if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
        for (i = 0; i < 300; i++) {
            var mid = (lo + hi) / 2, fm = f(mid);
            if (Math.abs(fm) < 1e-12 || (hi - lo) / 2 < 1e-12) return mid;
            if (fm * flo < 0) hi = mid; else { lo = mid; flo = fm; }
        }
        return (lo + hi) / 2;
    }

    def("RATE", 3, 6, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, 0, 0, 0.1]);
        if (isErr(p)) return p;
        var n = p[0], payment = p[1], pvv = p[2], fvv = p[3], type = typeArg(p[4]);
        if (n <= 0) return num("RATE needs a positive number of periods");
        var f = function (r) {
            if (Math.abs(r) < 1e-12) return pvv + payment * n + fvv;
            var g = Math.pow(1 + r, n);
            return pvv * g + payment * (1 + r * type) * (g - 1) / r + fvv;
        };
        var df = function (r) {
            var h = 1e-6;
            return (f(r + h) - f(r - h)) / (2 * h);
        };
        var r = solve(f, df, p[5]);
        return r === null ? num("RATE did not converge") : r;
    }, { syntax: "RATE(number_of_periods, payment_per_period, present_value, [future_value], [end_or_beginning], [rate_guess])" });

    /* ---------- cash flows ---------- */
    // numbers from range / array arguments (text and blanks skipped)
    function flows(E, node) {
        var st = E.numbers([node], "sum");
        return st.err ? st.err : st.nums;
    }
    function npv(rate, values) {
        var s = 0;
        for (var i = 0; i < values.length; i++) s += values[i] / Math.pow(1 + rate, i + 1);
        return s;
    }
    def("NPV", 2, -1, function (a, E) {
        var rate = E.num(a[0]);
        if (isErr(rate)) return rate;
        var st = E.numbers(a.slice(1), "sum");
        if (st.err) return st.err;
        if (rate === -1) return new FErr(ERR.DIV0, "NPV rate cannot be -1");
        return fin(npv(rate, st.nums));
    }, { elem: false, syntax: "NPV(discount, cashflow1, [cashflow2, ...])" });
    function signsOk(values) {
        return values.some(function (v) { return v > 0; }) && values.some(function (v) { return v < 0; });
    }
    def("IRR", 1, 2, function (a, E) {
        var values = flows(E, a[0]);
        if (isErr(values)) return values;
        var guess = E.num(a[1], 0.1);
        if (isErr(guess)) return guess;
        if (!signsOk(values)) return num("IRR needs at least one positive and one negative cash flow");
        var f = function (r) {
            var s = 0;
            for (var i = 0; i < values.length; i++) s += values[i] / Math.pow(1 + r, i);
            return s;
        };
        var df = function (r) {
            var s = 0;
            for (var i = 1; i < values.length; i++) s -= i * values[i] / Math.pow(1 + r, i + 1);
            return s;
        };
        var r = solve(f, df, guess);
        return r === null ? num("IRR did not converge") : r;
    }, { elem: false, syntax: "IRR(cashflow_amounts, [rate_guess])" });
    def("MIRR", 3, 3, function (a, E) {
        var values = flows(E, a[0]);
        if (isErr(values)) return values;
        var p = nums(E, [a[1], a[2]], [undefined, undefined]);
        if (isErr(p)) return p;
        if (!signsOk(values)) return new FErr(ERR.DIV0, "MIRR needs positive and negative cash flows");
        var n = values.length, fr = p[0], rr = p[1];
        var pos = values.map(function (v) { return v > 0 ? v : 0; });
        var neg = values.map(function (v) { return v < 0 ? v : 0; });
        var top = -npv(rr, pos) * Math.pow(1 + rr, n);
        var bottom = npv(fr, neg) * (1 + fr);
        return fin(Math.pow(top / bottom, 1 / (n - 1)) - 1);
    }, { elem: false, syntax: "MIRR(cashflow_amounts, financing_rate, reinvestment_return_rate)" });
    function datedFlows(E, vNode, dNode) {
        var vs = E.flat(vNode), ds = E.flat(dNode);
        if (isErr(vs)) return vs;
        if (isErr(ds)) return ds;
        if (vs.length !== ds.length) return num("Cash flows and dates must be the same size");
        var values = [], dates = [];
        for (var i = 0; i < vs.length; i++) {
            if (isErr(vs[i])) return vs[i];
            if (isErr(ds[i])) return ds[i];
            var v = F.toNum(vs[i]), d = F.toNum(ds[i]);
            if (isErr(v) || isErr(d)) return new FErr(ERR.VALUE, "Cash flows and dates must be numbers");
            values.push(v);
            dates.push(Math.floor(d));
        }
        for (i = 1; i < dates.length; i++) if (dates[i] < dates[0]) return num("Dates must not precede the first date");
        return { v: values, d: dates };
    }
    function xnpv(rate, fl) {
        var s = 0;
        for (var i = 0; i < fl.v.length; i++) s += fl.v[i] / Math.pow(1 + rate, (fl.d[i] - fl.d[0]) / 365);
        return s;
    }
    def("XNPV", 3, 3, function (a, E) {
        var rate = E.num(a[0]);
        if (isErr(rate)) return rate;
        var fl = datedFlows(E, a[1], a[2]);
        if (isErr(fl)) return fl;
        if (rate <= -1) return num("XNPV rate must be above -1");
        return fin(xnpv(rate, fl));
    }, { elem: false, syntax: "XNPV(discount, cashflow_amounts, cashflow_dates)" });
    def("XIRR", 2, 3, function (a, E) {
        var fl = datedFlows(E, a[0], a[1]);
        if (isErr(fl)) return fl;
        var guess = E.num(a[2], 0.1);
        if (isErr(guess)) return guess;
        if (!signsOk(fl.v)) return num("XIRR needs at least one positive and one negative cash flow");
        var df = function (r) {
            var s = 0;
            for (var i = 0; i < fl.v.length; i++) {
                var t = (fl.d[i] - fl.d[0]) / 365;
                s -= t * fl.v[i] / Math.pow(1 + r, t + 1);
            }
            return s;
        };
        var r = solve(function (x) { return xnpv(x, fl); }, df, guess);
        return r === null ? num("XIRR did not converge") : r;
    }, { elem: false, syntax: "XIRR(cashflow_amounts, cashflow_dates, [rate_guess])" });
    def("FVSCHEDULE", 2, 2, function (a, E) {
        var principal = E.num(a[0]);
        if (isErr(principal)) return principal;
        var rates = E.flat(a[1]);
        if (isErr(rates)) return rates;
        var v = principal;
        for (var i = 0; i < rates.length; i++) {
            if (rates[i] === null || rates[i] === undefined) continue;
            var r = F.toNum(rates[i]);
            if (isErr(r)) return r;
            v *= 1 + r;
        }
        return fin(v);
    }, { elem: false, syntax: "FVSCHEDULE(principal, rate_schedule)" });

    /* ---------- rates ---------- */
    def("EFFECT", 2, 2, function (a, E) {
        var p = nums(E, a, [undefined, undefined]);
        if (isErr(p)) return p;
        var n = Math.trunc(p[1]);
        if (p[0] <= 0 || n < 1) return num("EFFECT needs a positive rate and periods");
        return fin(Math.pow(1 + p[0] / n, n) - 1);
    }, { syntax: "EFFECT(nominal_rate, periods_per_year)" });
    def("NOMINAL", 2, 2, function (a, E) {
        var p = nums(E, a, [undefined, undefined]);
        if (isErr(p)) return p;
        var n = Math.trunc(p[1]);
        if (p[0] <= 0 || n < 1) return num("NOMINAL needs a positive rate and periods");
        return fin(n * (Math.pow(1 + p[0], 1 / n) - 1));
    }, { syntax: "NOMINAL(effective_rate, periods_per_year)" });
    def("RRI", 3, 3, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined]);
        if (isErr(p)) return p;
        if (p[0] <= 0 || p[1] === 0) return num("RRI needs positive periods and a non-zero present value");
        return fin(Math.pow(p[2] / p[1], 1 / p[0]) - 1);
    }, { syntax: "RRI(number_of_periods, present_value, future_value)" });
    def("PDURATION", 3, 3, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined]);
        if (isErr(p)) return p;
        if (p[0] <= 0 || p[1] <= 0 || p[2] <= 0) return num("PDURATION needs positive values");
        return fin((Math.log(p[2]) - Math.log(p[1])) / Math.log(1 + p[0]));
    }, { syntax: "PDURATION(rate, present_value, future_value)" });

    /* ---------- depreciation ---------- */
    def("SLN", 3, 3, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined]);
        if (isErr(p)) return p;
        if (p[2] === 0) return new FErr(ERR.DIV0, "SLN life cannot be 0");
        return fin((p[0] - p[1]) / p[2]);
    }, { syntax: "SLN(cost, salvage, life)" });
    def("SYD", 4, 4, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined]);
        if (isErr(p)) return p;
        var life = p[2], per = p[3];
        if (life <= 0 || per <= 0 || per > life) return num("SYD period is out of range");
        return fin((p[0] - p[1]) * (life - per + 1) * 2 / (life * (life + 1)));
    }, { syntax: "SYD(cost, salvage, life, period)" });
    def("DB", 4, 5, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined, 12]);
        if (isErr(p)) return p;
        var cost = p[0], salvage = p[1], life = p[2], period = Math.trunc(p[3]), month = Math.trunc(p[4]);
        if (cost < 0 || salvage < 0 || life <= 0 || period < 1 || month < 1 || month > 12 || period > life + 1) {
            return num("DB arguments are out of range");
        }
        if (cost === 0) return 0;
        var rate = Math.round((1 - Math.pow(salvage / cost, 1 / life)) * 1000) / 1000;
        var total = 0, dep = cost * rate * month / 12;
        if (period === 1) return fin(dep);
        total = dep;
        for (var i = 2; i <= period; i++) {
            dep = i === life + 1 ? (cost - total) * rate * (12 - month) / 12 : (cost - total) * rate;
            total += dep;
        }
        return fin(dep);
    }, { syntax: "DB(cost, salvage, life, period, [month])" });
    function ddbPeriod(cost, salvage, life, period, factor) {
        var rate = factor / life, oldValue;
        if (rate >= 1) { rate = 1; oldValue = period === 1 ? cost : 0; }
        else oldValue = cost * Math.pow(1 - rate, period - 1);
        var newValue = cost * Math.pow(1 - rate, period);
        var dep = newValue < salvage ? oldValue - salvage : oldValue - newValue;
        return dep < 0 ? 0 : dep;
    }
    def("DDB", 4, 5, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined, 2]);
        if (isErr(p)) return p;
        if (p[0] < 0 || p[1] < 0 || p[2] <= 0 || p[3] <= 0 || p[3] > p[2] || p[4] <= 0) return num("DDB arguments are out of range");
        return fin(ddbPeriod(p[0], p[1], p[2], p[3], p[4]));
    }, { syntax: "DDB(cost, salvage, life, period, [factor])" });
    // VDB as spreadsheets define it: declining balance, switching to
    // straight line once that is larger, with fractional start/end periods
    function interVdb(cost, salvage, life, life1, period, factor) {
        var vdb = 0, intEnd = Math.ceil(period), sln = 0, remaining = cost - salvage, nowSln = false;
        for (var i = 1; i <= intEnd; i++) {
            var term;
            if (!nowSln) {
                var ddb = ddbPeriod(cost, salvage, life, i, factor);
                sln = remaining / (life1 - (i - 1));
                if (sln > ddb) { term = sln; nowSln = true; }
                else { term = ddb; remaining -= ddb; }
            } else term = sln;
            if (i === intEnd) term *= period + 1 - intEnd;
            vdb += term;
        }
        return vdb;
    }
    def("VDB", 5, 7, function (a, E) {
        var p = nums(E, a, [undefined, undefined, undefined, undefined, undefined, 2]);
        if (isErr(p)) return p;
        var noSwitch = E.bool(a[6], false);
        if (isErr(noSwitch)) return noSwitch;
        var cost = p[0], salvage = p[1], life = p[2], start = p[3], end = p[4], factor = p[5];
        if (cost < 0 || salvage < 0 || life <= 0 || start < 0 || end < start || end > life || factor <= 0) {
            return num("VDB arguments are out of range");
        }
        var intStart = Math.floor(start), intEnd = Math.ceil(end), vdb = 0, i, term;
        if (noSwitch) {
            for (i = intStart + 1; i <= intEnd; i++) {
                term = ddbPeriod(cost, salvage, life, i, factor);
                if (i === intStart + 1) term *= Math.min(end, intStart + 1) - start;
                else if (i === intEnd) term *= end + 1 - intEnd;
                vdb += term;
            }
            return fin(vdb);
        }
        var part = 0;
        if (start !== intStart) {
            var v1 = cost - interVdb(cost, salvage, life, life, intStart, factor);
            part += (start - intStart) * interVdb(v1, salvage, life, life - intStart, 1, factor);
        }
        if (end !== intEnd) {
            var tmpStart = intEnd - 1;
            var v2 = cost - interVdb(cost, salvage, life, life, tmpStart, factor);
            part += (intEnd - end) * interVdb(v2, salvage, life, life - tmpStart, intEnd - tmpStart, factor);
        }
        var c2 = cost - interVdb(cost, salvage, life, life, intStart, factor);
        vdb = interVdb(c2, salvage, life, life - intStart, intEnd - intStart, factor) - part;
        return fin(vdb);
    }, { syntax: "VDB(cost, salvage, life, start_period, end_period, [factor], [no_switch])" });

    /* ---------- dollar fractions ---------- */
    function dollarFn(name, toDecimal) {
        def(name, 2, 2, function (a, E) {
            var p = nums(E, a, [undefined, undefined]);
            if (isErr(p)) return p;
            var v = p[0], f = Math.trunc(p[1]);
            if (f < 0) return num(name + " fraction cannot be negative");
            if (f === 0) return new FErr(ERR.DIV0, name + " fraction cannot be 0");
            var whole = Math.trunc(v), frac = v - whole;
            var scale = Math.pow(10, Math.ceil(Math.log10(f)));
            return fin(toDecimal ? whole + frac * scale / f : whole + frac * f / scale);
        }, { syntax: name + "(" + (toDecimal ? "fractional_price" : "decimal_price") + ", unit)" });
    }
    dollarFn("DOLLARDE", true);
    dollarFn("DOLLARFR", false);
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
