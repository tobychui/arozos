/*
    ArozOS Office Sheets - math and engineering functions
    =====================================================
    Registers into the formula engine (formula.js); load after it.

        rounding   ROUND ROUNDUP ROUNDDOWN TRUNC INT MROUND CEILING FLOOR
                   CEILING.MATH CEILING.PRECISE ISO.CEILING FLOOR.MATH
                   FLOOR.PRECISE EVEN ODD
        arithmetic ABS SIGN MOD QUOTIENT PRODUCT SUMSQ SQRT SQRTPI POWER EXP
                   LN LOG LOG10 PI RAND RANDBETWEEN
        trig       SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH ASINH
                   ACOSH ATANH COT COTH ACOT ACOTH CSC CSCH SEC SECH
                   DEGREES RADIANS
        integers   FACT FACTDOUBLE COMBIN COMBINA GCD LCM MULTINOMIAL ISEVEN
                   ISODD SERIESSUM BASE DECIMAL
        engineering BIN2DEC BIN2HEX BIN2OCT DEC2BIN DEC2HEX DEC2OCT HEX2BIN
                   HEX2DEC HEX2OCT OCT2BIN OCT2DEC OCT2HEX BITAND BITOR BITXOR
                   BITLSHIFT BITRSHIFT DELTA GESTEP CONVERT
*/
(function (F) {
    "use strict";
    var ERR = F.ERR, FErr = F.FErr, isErr = F.isErr;

    function def(name, min, max, fn, extra) {
        var spec = { min: min, max: max, fn: fn, cat: "Math" };
        for (var k in extra || {}) spec[k] = extra[k];
        F.defineFunction(name, spec);
    }
    function num(msg) { return new FErr(ERR.NUM, msg); }
    // NaN / Infinity never leave a function
    function fin(v) {
        if (typeof v === "number" && !isFinite(v)) return num("Result is not a finite number");
        return v === 0 ? 0 : v;       // no -0
    }
    // scaled rounding helpers that shrug off binary noise (1.005*100)
    function scaled(x) { return +x.toPrecision(15); }
    function roundTo(v, d, mode) {
        // negative places scale down instead of multiplying by 0.1, 0.01 ...
        var f = Math.pow(10, Math.abs(d));
        var a = scaled(d >= 0 ? Math.abs(v) * f : Math.abs(v) / f);
        var r = mode === "up" ? Math.ceil(a) : mode === "down" ? Math.floor(a) : Math.round(a);
        return fin(Math.sign(v) * (d >= 0 ? r / f : r * f));
    }
    /* one-number functions, element-wise inside array contexts */
    function num1(name, fn, syntax, cat) {
        def(name, 1, 1, function (a, E) {
            var x = E.num(a[0]);
            if (isErr(x)) return x;
            var r = fn(x);
            return isErr(r) ? r : fin(r);
        }, { elem: true, syntax: syntax || name + "(value)", cat: cat || "Math" });
    }
    function args2(a, E, d1) {
        var x = E.num(a[0]);
        if (isErr(x)) return x;
        var y = E.num(a[1], d1);
        if (isErr(y)) return y;
        return [x, y];
    }

    /* ---------- rounding ---------- */
    function roundFn(name, mode) {
        def(name, 1, 2, function (a, E) {
            var p = args2(a, E, 0);
            if (isErr(p)) return p;
            return roundTo(p[0], Math.trunc(p[1]), mode);
        }, { elem: true, syntax: name + "(value, [places])" });
    }
    roundFn("ROUND", "half");
    roundFn("ROUNDUP", "up");
    roundFn("ROUNDDOWN", "down");
    roundFn("TRUNC", "down");
    num1("INT", function (x) { return Math.floor(scaled(x)); });
    num1("ABS", Math.abs);
    num1("SIGN", Math.sign);
    def("MROUND", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        var v = p[0], m = p[1];
        if (m === 0) return 0;
        if (v * m < 0) return num("MROUND value and factor must have the same sign");
        return fin(Math.sign(v) * Math.round(scaled(Math.abs(v / m))) * Math.abs(m));
    }, { elem: true, syntax: "MROUND(value, factor)" });

    def("CEILING", 1, 2, function (a, E) {
        var p = args2(a, E, 1);
        if (isErr(p)) return p;
        var v = p[0], s = p[1];
        if (s === 0 || v === 0) return 0;
        if (v > 0 && s < 0) return num("CEILING factor must be positive for a positive value");
        if (v < 0 && s < 0) return fin(-Math.ceil(scaled(-v / -s)) * -s);
        return fin(Math.ceil(scaled(v / s)) * s);
    }, { elem: true, syntax: "CEILING(value, [factor])" });
    def("FLOOR", 1, 2, function (a, E) {
        var p = args2(a, E, 1);
        if (isErr(p)) return p;
        var v = p[0], s = p[1];
        if (v === 0) return 0;
        if (s === 0) return new FErr(ERR.DIV0, "FLOOR factor cannot be zero");
        if (v > 0 && s < 0) return num("FLOOR factor must be positive for a positive value");
        if (v < 0 && s < 0) return fin(-Math.floor(scaled(-v / -s)) * -s);
        return fin(Math.floor(scaled(v / s)) * s);
    }, { elem: true, syntax: "FLOOR(value, [factor])" });
    function mathRound(name, up) {
        def(name, 1, 3, function (a, E) {
            var v = E.num(a[0]), s = E.num(a[1], 1), mode = E.num(a[2], 0);
            if (isErr(v)) return v;
            if (isErr(s)) return s;
            if (isErr(mode)) return mode;
            s = Math.abs(s);
            if (s === 0 || v === 0) return 0;
            var q = scaled(v / s);
            var r;
            if (v > 0) r = up ? Math.ceil(q) : Math.floor(q);
            // negative numbers: CEILING.MATH goes toward zero, FLOOR.MATH away,
            // unless mode flips it
            else if (up) r = mode ? Math.floor(q) : Math.ceil(q);
            else r = mode ? Math.ceil(q) : Math.floor(q);
            return fin(r * s);
        }, { elem: true, syntax: name + "(number, [significance], [mode])" });
    }
    mathRound("CEILING.MATH", true);
    mathRound("FLOOR.MATH", false);
    function preciseRound(name, up) {
        def(name, 1, 2, function (a, E) {
            var p = args2(a, E, 1);
            if (isErr(p)) return p;
            var s = Math.abs(p[1]);
            if (s === 0 || p[0] === 0) return 0;
            var q = scaled(p[0] / s);
            return fin((up ? Math.ceil(q) : Math.floor(q)) * s);
        }, { elem: true, syntax: name + "(number, [significance])" });
    }
    preciseRound("CEILING.PRECISE", true);
    preciseRound("ISO.CEILING", true);
    preciseRound("FLOOR.PRECISE", false);
    num1("EVEN", function (x) {
        var r = Math.ceil(scaled(Math.abs(x)) / 2) * 2;
        return Math.sign(x) * r;
    });
    num1("ODD", function (x) {
        var ax = Math.ceil(scaled(Math.abs(x)));
        if (ax % 2 === 0) ax += 1;
        return x < 0 ? -ax : ax;
    });

    /* ---------- arithmetic ---------- */
    def("MOD", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        if (p[1] === 0) return new FErr(ERR.DIV0, "MOD by zero");
        // the result takes the divisor's sign, as in Excel
        return fin(p[0] - p[1] * Math.floor(p[0] / p[1]));
    }, { elem: true, syntax: "MOD(dividend, divisor)" });
    def("QUOTIENT", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        if (p[1] === 0) return new FErr(ERR.DIV0, "QUOTIENT by zero");
        return fin(Math.trunc(scaled(p[0] / p[1])));
    }, { elem: true, syntax: "QUOTIENT(dividend, divisor)" });
    def("PRODUCT", 1, -1, function (a, E) {
        var st = E.numbers(a, "sum");
        if (st.err) return st.err;
        if (!st.nums.length) return 0;
        return fin(st.nums.reduce(function (p, x) { return p * x; }, 1));
    }, { syntax: "PRODUCT(factor1, [factor2, ...])" });
    def("SUMSQ", 1, -1, function (a, E) {
        var st = E.numbers(a, "sum");
        if (st.err) return st.err;
        return fin(st.nums.reduce(function (p, x) { return p + x * x; }, 0));
    }, { syntax: "SUMSQ(value1, [value2, ...])" });
    num1("SQRT", function (x) { return x < 0 ? num("SQRT of a negative number") : Math.sqrt(x); });
    num1("SQRTPI", function (x) { return x < 0 ? num("SQRTPI of a negative number") : Math.sqrt(x * Math.PI); });
    def("POWER", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        return F.binValue("^", p[0], p[1]);
    }, { elem: true, syntax: "POWER(base, exponent)" });
    num1("EXP", Math.exp);
    num1("LN", function (x) { return x <= 0 ? num("LN needs a positive number") : Math.log(x); });
    num1("LOG10", function (x) { return x <= 0 ? num("LOG10 needs a positive number") : Math.log10(x); });
    def("LOG", 1, 2, function (a, E) {
        var p = args2(a, E, 10);
        if (isErr(p)) return p;
        if (p[0] <= 0 || p[1] <= 0) return num("LOG needs positive numbers");
        if (p[1] === 1) return new FErr(ERR.DIV0, "LOG base cannot be 1");
        return fin(Math.log(p[0]) / Math.log(p[1]));
    }, { elem: true, syntax: "LOG(value, [base])" });
    def("PI", 0, 0, function () { return Math.PI; }, { syntax: "PI()" });
    def("RAND", 0, 0, function () { return Math.random(); }, { volatile: true, syntax: "RAND()" });
    def("RANDBETWEEN", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        var lo = Math.ceil(p[0]), hi = Math.floor(p[1]);
        if (lo > hi) return num("RANDBETWEEN low is above high");
        return lo + Math.floor(Math.random() * (hi - lo + 1));
    }, { elem: true, volatile: true, syntax: "RANDBETWEEN(low, high)" });

    /* ---------- trigonometry ---------- */
    function trig(name, fn, guard) {
        num1(name, function (x) {
            if (guard) {
                var g = guard(x);
                if (g) return g;
            }
            return fn(x);
        }, name + "(value)");
    }
    var div0 = function (msg) { return new FErr(ERR.DIV0, msg); };
    trig("SIN", Math.sin);
    trig("COS", Math.cos);
    trig("TAN", Math.tan);
    trig("ASIN", Math.asin, function (x) { return Math.abs(x) > 1 ? num("ASIN needs -1..1") : null; });
    trig("ACOS", Math.acos, function (x) { return Math.abs(x) > 1 ? num("ACOS needs -1..1") : null; });
    trig("ATAN", Math.atan);
    trig("SINH", Math.sinh);
    trig("COSH", Math.cosh);
    trig("TANH", Math.tanh);
    trig("ASINH", Math.asinh);
    trig("ACOSH", Math.acosh, function (x) { return x < 1 ? num("ACOSH needs a value of 1 or more") : null; });
    trig("ATANH", Math.atanh, function (x) { return Math.abs(x) >= 1 ? num("ATANH needs -1 < value < 1") : null; });
    trig("COT", function (x) { return 1 / Math.tan(x); }, function (x) { return x === 0 ? div0("COT(0)") : null; });
    trig("COTH", function (x) { return 1 / Math.tanh(x); }, function (x) { return x === 0 ? div0("COTH(0)") : null; });
    trig("ACOT", function (x) { return Math.PI / 2 - Math.atan(x); });
    trig("ACOTH", function (x) { return 0.5 * Math.log((x + 1) / (x - 1)); },
        function (x) { return Math.abs(x) <= 1 ? num("ACOTH needs |value| > 1") : null; });
    trig("CSC", function (x) { return 1 / Math.sin(x); }, function (x) { return x === 0 ? div0("CSC(0)") : null; });
    trig("CSCH", function (x) { return 1 / Math.sinh(x); }, function (x) { return x === 0 ? div0("CSCH(0)") : null; });
    trig("SEC", function (x) { return 1 / Math.cos(x); });
    trig("SECH", function (x) { return 1 / Math.cosh(x); });
    num1("DEGREES", function (x) { return x * 180 / Math.PI; }, "DEGREES(angle)");
    num1("RADIANS", function (x) { return x * Math.PI / 180; }, "RADIANS(angle)");
    def("ATAN2", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        if (p[0] === 0 && p[1] === 0) return div0("ATAN2(0, 0)");
        return fin(Math.atan2(p[1], p[0]));       // Excel order: ATAN2(x, y)
    }, { elem: true, syntax: "ATAN2(x, y)" });

    /* ---------- integers ---------- */
    function factorial(n) {
        var r = 1;
        for (var i = 2; i <= n; i++) r *= i;
        return r;
    }
    num1("FACT", function (x) {
        x = Math.floor(x);
        return x < 0 ? num("FACT of a negative number") : factorial(x);
    });
    num1("FACTDOUBLE", function (x) {
        x = Math.floor(x);
        if (x < -1) return num("FACTDOUBLE needs -1 or more");
        var r = 1;
        for (var i = x; i > 1; i -= 2) r *= i;
        return r;
    });
    function combin(n, k) {
        if (k > n - k) k = n - k;
        var r = 1;
        for (var i = 1; i <= k; i++) r = r * (n - k + i) / i;
        return Math.round(r);
    }
    def("COMBIN", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        var n = Math.trunc(p[0]), k = Math.trunc(p[1]);
        if (n < 0 || k < 0 || k > n) return num("COMBIN needs 0 <= k <= n");
        return fin(combin(n, k));
    }, { elem: true, syntax: "COMBIN(n, k)" });
    def("COMBINA", 2, 2, function (a, E) {
        var p = args2(a, E);
        if (isErr(p)) return p;
        var n = Math.trunc(p[0]), k = Math.trunc(p[1]);
        if (n < 0 || k < 0 || (n === 0 && k > 0)) return num("COMBINA needs n, k >= 0");
        if (k === 0) return 1;
        return fin(combin(n + k - 1, k));
    }, { elem: true, syntax: "COMBINA(n, k)" });
    function gcd2(x, y) {
        while (y) { var t = y; y = x % y; x = t; }
        return x;
    }
    function intList(a, E, name) {
        var st = E.numbers(a, "sum");
        if (st.err) return st.err;
        var out = [];
        for (var i = 0; i < st.nums.length; i++) {
            var v = Math.trunc(st.nums[i]);
            if (v < 0) return num(name + " needs non-negative numbers");
            out.push(v);
        }
        return out;
    }
    def("GCD", 1, -1, function (a, E) {
        var l = intList(a, E, "GCD");
        if (isErr(l)) return l;
        return l.reduce(gcd2, 0);
    }, { syntax: "GCD(value1, [value2, ...])" });
    def("LCM", 1, -1, function (a, E) {
        var l = intList(a, E, "LCM");
        if (isErr(l)) return l;
        if (l.some(function (x) { return x === 0; })) return 0;
        return fin(l.reduce(function (acc, x) { return acc / gcd2(acc, x) * x; }, 1));
    }, { syntax: "LCM(value1, [value2, ...])" });
    def("MULTINOMIAL", 1, -1, function (a, E) {
        var l = intList(a, E, "MULTINOMIAL");
        if (isErr(l)) return l;
        var sum = 0, r = 1;
        l.forEach(function (x) {
            for (var i = 1; i <= x; i++) { sum++; r = r * sum / i; }
        });
        return fin(Math.round(r));
    }, { syntax: "MULTINOMIAL(value1, [value2, ...])" });
    num1("ISEVEN", function (x) { return Math.trunc(x) % 2 === 0; }, "ISEVEN(value)", "Info");
    num1("ISODD", function (x) { return Math.abs(Math.trunc(x)) % 2 === 1; }, "ISODD(value)", "Info");
    def("SERIESSUM", 4, 4, function (a, E) {
        var x = E.num(a[0]), n = E.num(a[1]), m = E.num(a[2]);
        var bad = [x, n, m].filter(isErr)[0];
        if (bad) return bad;
        var st = E.numbers([a[3]], "sum");
        if (st.err) return st.err;
        var s = 0;
        st.nums.forEach(function (c, i) { s += c * Math.pow(x, n + i * m); });
        return fin(s);
    }, { syntax: "SERIESSUM(x, n, m, a)" });
    def("BASE", 2, 3, function (a, E) {
        var v = E.num(a[0]), b = E.num(a[1]), len = E.num(a[2], 0);
        var bad = [v, b, len].filter(isErr)[0];
        if (bad) return bad;
        v = Math.trunc(v); b = Math.trunc(b); len = Math.trunc(len);
        if (v < 0 || v >= 9007199254740992 || b < 2 || b > 36 || len < 0) return num("BASE arguments out of range");
        var s = v.toString(b).toUpperCase();
        while (s.length < len) s = "0" + s;
        return s;
    }, { elem: true, syntax: "BASE(value, base, [min_length])" });
    def("DECIMAL", 2, 2, function (a, E) {
        var t = E.str(a[0]), b = E.int(a[1]);
        if (isErr(t)) return t;
        if (isErr(b)) return b;
        if (b < 2 || b > 36) return num("DECIMAL base must be 2..36");
        t = t.trim().toUpperCase();
        if (!t) return 0;
        var v = 0;
        for (var i = 0; i < t.length; i++) {
            var d = parseInt(t.charAt(i), 36);
            if (isNaN(d) || d >= b) return num("'" + t + "' is not a base-" + b + " number");
            v = v * b + d;
        }
        return fin(v);
    }, { elem: true, syntax: "DECIMAL(value, base)" });

    /* ---------- engineering: number bases (10-digit two's complement) ---------- */
    var BASES = {
        BIN: { radix: 2, re: /^[01]{1,10}$/ },
        OCT: { radix: 8, re: /^[0-7]{1,10}$/ },
        HEX: { radix: 16, re: /^[0-9A-F]{1,10}$/i },
        DEC: { radix: 10 }
    };
    function toDecimal(from, text) {
        var t = String(text).trim();
        var b = BASES[from];
        if (!b.re.test(t)) return num("'" + t + "' is not a valid " + from.toLowerCase() + " number");
        var v = parseInt(t, b.radix);
        var full = Math.pow(b.radix, 10);
        if (t.length === 10 && v >= full / 2) v -= full;       // negative
        return v;
    }
    function fromDecimal(to, v, places) {
        var b = BASES[to], full = Math.pow(b.radix, 10);
        if (v < -full / 2 || v > full / 2 - 1) return num("Value is out of range for " + to);
        if (v < 0) return (full + v).toString(b.radix).toUpperCase();
        var s = v.toString(b.radix).toUpperCase();
        if (places !== undefined) {
            if (places < s.length || places > 10) return num("Not enough places");
            while (s.length < places) s = "0" + s;
        }
        return s;
    }
    ["BIN", "OCT", "HEX", "DEC"].forEach(function (from) {
        ["BIN", "OCT", "HEX", "DEC"].forEach(function (to) {
            if (from === to) return;
            var name = from + "2" + to;
            def(name, 1, to === "DEC" ? 1 : 2, function (a, E) {
                var v;
                if (from === "DEC") {
                    v = E.num(a[0]);
                    if (isErr(v)) return v;
                    v = Math.trunc(v);
                } else {
                    var raw = E.val(a[0]);
                    if (isErr(raw)) return raw;
                    v = toDecimal(from, typeof raw === "number" ? String(raw) : F.toStr(raw));
                    if (isErr(v)) return v;
                }
                if (to === "DEC") return v;
                var places;
                if (!E.missing(a[1])) {
                    places = E.int(a[1]);
                    if (isErr(places)) return places;
                }
                return fromDecimal(to, v, places);
            }, { elem: true, cat: "Engineering", syntax: name + "(value" + (to === "DEC" ? "" : ", [significant_digits]") + ")" });
        });
    });

    /* ---------- engineering: bits (non-negative integers below 2^48) ---------- */
    var BIT_LIMIT = Math.pow(2, 48);
    function bitArg(E, node) {
        var v = E.num(node);
        if (isErr(v)) return v;
        if (v < 0 || v !== Math.floor(v) || v >= BIT_LIMIT) return num("Bit functions need whole numbers 0..2^48-1");
        return BigInt(v);
    }
    function bitFn(name, fn) {
        def(name, 2, 2, function (a, E) {
            var x = bitArg(E, a[0]);
            if (isErr(x)) return x;
            var y = bitArg(E, a[1]);
            if (isErr(y)) return y;
            return Number(fn(x, y));
        }, { elem: true, cat: "Engineering", syntax: name + "(value1, value2)" });
    }
    bitFn("BITAND", function (x, y) { return x & y; });
    bitFn("BITOR", function (x, y) { return x | y; });
    bitFn("BITXOR", function (x, y) { return x ^ y; });
    function shiftFn(name, left) {
        def(name, 2, 2, function (a, E) {
            var x = bitArg(E, a[0]);
            if (isErr(x)) return x;
            var s = E.int(a[1]);
            if (isErr(s)) return s;
            if (Math.abs(s) > 53) return num("Shift amount out of range");
            var amount = left ? s : -s;      // negative shifts go the other way
            var n = amount >= 0 ? x << BigInt(amount) : x >> BigInt(-amount);
            if (n >= BigInt(BIT_LIMIT)) return num("Result is 2^48 or more");
            return Number(n);
        }, { elem: true, cat: "Engineering", syntax: name + "(value, shift_amount)" });
    }
    shiftFn("BITLSHIFT", true);
    shiftFn("BITRSHIFT", false);
    def("DELTA", 1, 2, function (a, E) {
        var p = args2(a, E, 0);
        if (isErr(p)) return p;
        return p[0] === p[1] ? 1 : 0;
    }, { elem: true, cat: "Engineering", syntax: "DELTA(number1, [number2])" });
    def("GESTEP", 1, 2, function (a, E) {
        var p = args2(a, E, 0);
        if (isErr(p)) return p;
        return p[0] >= p[1] ? 1 : 0;
    }, { elem: true, cat: "Engineering", syntax: "GESTEP(value, [step])" });

    /* ---------- CONVERT ---------- */
    /*
        Units by quantity, each with its size in the quantity's base unit.
        "p" marks units that take metric prefixes (k, M, m, u, ...); area and
        volume units ending in 2 / 3 apply the prefix squared / cubed.
        Information units also take binary prefixes (ki, Mi, ...).
    */
    var LY = 9.4607304725808e15, PICA = 0.0254 / 72;
    var UNITS = {
        mass: { g: [1, "p"], sg: [14593.9029372064], lbm: [453.59237], u: [1.660538782e-24, "p"], ozm: [28.349523125],
            grain: [0.06479891], cwt: [45359.237], shweight: [45359.237], uk_cwt: [50802.34544], lcwt: [50802.34544],
            hweight: [50802.34544], stone: [6350.29318], ton: [907184.74], uk_ton: [1016046.9088], LTON: [1016046.9088],
            brton: [1016046.9088] },
        distance: { m: [1, "p"], mi: [1609.344], Nmi: [1852], "in": [0.0254], ft: [0.3048], yd: [0.9144],
            ang: [1e-10, "p"], ell: [1.143], ly: [LY, "p"], parsec: [3.08567758128155e16, "p"], pc: [3.08567758128155e16, "p"],
            Picapt: [PICA], Pica: [PICA], pica: [0.0254 / 6], survey_mi: [1609.34721869444] },
        time: { yr: [31557600], day: [86400], d: [86400], hr: [3600], mn: [60], min: [60], sec: [1, "p"], s: [1, "p"] },
        pressure: { Pa: [1, "p"], p: [1, "p"], atm: [101325, "p"], at: [101325, "p"], mmHg: [133.322, "p"],
            psi: [6894.75729316836], Torr: [133.322368421053] },
        force: { N: [1, "p"], dyn: [1e-5, "p"], dy: [1e-5, "p"], lbf: [4.4482216152605], pond: [0.00980665, "p"] },
        energy: { J: [1, "p"], e: [1e-7, "p"], c: [4.184, "p"], cal: [4.1868, "p"], eV: [1.602176487e-19, "p"],
            ev: [1.602176487e-19, "p"], HPh: [2684519.53769617], hh: [2684519.53769617], Wh: [3600, "p"], wh: [3600, "p"],
            flb: [1.3558179483314], BTU: [1055.05585262], btu: [1055.05585262] },
        power: { HP: [745.69987158227], h: [745.69987158227], PS: [735.49875], W: [1, "p"], w: [1, "p"] },
        magnetism: { T: [1, "p"], ga: [1e-4, "p"] },
        volume: { tsp: [4.92892159375e-6], tspm: [5e-6], tbs: [1.478676478125e-5], oz: [2.95735295625e-5],
            cup: [2.365882365e-4], pt: [4.73176473e-4], us_pt: [4.73176473e-4], uk_pt: [5.6826125e-4],
            qt: [9.46352946e-4], uk_qt: [1.1365225e-3], gal: [3.785411784e-3], uk_gal: [4.54609e-3],
            l: [1e-3, "p"], L: [1e-3, "p"], lt: [1e-3, "p"], ang3: [1e-30, "p3"], barrel: [0.158987294928],
            bushel: [0.03523907016688], ft3: [0.028316846592], in3: [1.6387064e-5], ly3: [Math.pow(LY, 3), "p3"],
            m3: [1, "p3"], mi3: [Math.pow(1609.344, 3)], yd3: [0.764554857984], Nmi3: [Math.pow(1852, 3)],
            Picapt3: [Math.pow(PICA, 3)], Pica3: [Math.pow(PICA, 3)], GRT: [2.8316846592], regton: [2.8316846592],
            MTON: [1.13267386368] },
        area: { uk_acre: [4046.8564224], us_acre: [4046.87260987425], ang2: [1e-20, "p2"], ar: [100, "p"],
            ft2: [0.09290304], ha: [10000], in2: [0.00064516], ly2: [LY * LY, "p2"], m2: [1, "p2"], Morgen: [2500],
            mi2: [1609.344 * 1609.344], Nmi2: [1852 * 1852], Picapt2: [PICA * PICA], Pica2: [PICA * PICA], yd2: [0.83612736] },
        information: { bit: [1, "pb"], byte: [8, "pb"] },
        speed: { admkn: [0.514773333333333], kn: [0.514444444444444], "m/h": [1 / 3600, "p"], "m/hr": [1 / 3600, "p"],
            "m/s": [1, "p"], "m/sec": [1, "p"], mph: [0.44704] },
        temperature: { C: [0], cel: [0], F: [0], fah: [0], K: [0, "p"], kel: [0, "p"], Rank: [0], Reau: [0] }
    };
    var PREFIX = { Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1, e: 1e1,
        d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24 };
    var BIN_PREFIX = { Yi: Math.pow(2, 80), Zi: Math.pow(2, 70), Ei: Math.pow(2, 60), Pi: Math.pow(2, 50),
        Ti: Math.pow(2, 40), Gi: Math.pow(2, 30), Mi: Math.pow(2, 20), ki: Math.pow(2, 10) };
    function findUnit(sym) {
        var q, u;
        for (q in UNITS) if (Object.prototype.hasOwnProperty.call(UNITS[q], sym)) return { q: q, sym: sym, f: UNITS[q][sym][0] };
        // prefixed: try each prefix that the rest of the symbol accepts
        var tries = [];
        Object.keys(BIN_PREFIX).forEach(function (p) { tries.push([p, BIN_PREFIX[p], true]); });
        Object.keys(PREFIX).forEach(function (p) { tries.push([p, PREFIX[p], false]); });
        for (var i = 0; i < tries.length; i++) {
            var p = tries[i];
            if (sym.indexOf(p[0]) !== 0 || sym.length === p[0].length) continue;
            var rest = sym.slice(p[0].length);
            for (q in UNITS) {
                u = UNITS[q][rest];
                if (!u || !u[1]) continue;
                if (p[2] && u[1] !== "pb") continue;
                var power = u[1] === "p2" ? 2 : u[1] === "p3" ? 3 : 1;
                return { q: q, sym: rest, f: u[0] * Math.pow(p[1], power), scale: Math.pow(p[1], power) };
            }
        }
        return null;
    }
    function toKelvin(sym, v) {
        switch (sym) {
            case "C": case "cel": return v + 273.15;
            case "F": case "fah": return (v - 32) * 5 / 9 + 273.15;
            case "Rank": return v * 5 / 9;
            case "Reau": return v * 1.25 + 273.15;
            default: return v;      // K / kel
        }
    }
    function fromKelvin(sym, k) {
        switch (sym) {
            case "C": case "cel": return k - 273.15;
            case "F": case "fah": return (k - 273.15) * 9 / 5 + 32;
            case "Rank": return k * 9 / 5;
            case "Reau": return (k - 273.15) * 0.8;
            default: return k;
        }
    }
    def("CONVERT", 3, 3, function (a, E) {
        var v = E.num(a[0]), fu = E.str(a[1]), tu = E.str(a[2]);
        var bad = [v, fu, tu].filter(isErr)[0];
        if (bad) return bad;
        var from = findUnit(fu), to = findUnit(tu);
        if (!from || !to) return new FErr(ERR.NA, "Unknown unit " + (!from ? fu : tu));
        if (from.q !== to.q) return new FErr(ERR.NA, "Cannot convert " + fu + " to " + tu);
        if (from.q === "temperature") {
            var k = toKelvin(from.sym, v * (from.scale || 1));
            return fin(fromKelvin(to.sym, k) / (to.scale || 1));
        }
        return fin(scaled(v * from.f / to.f));
    }, { elem: true, cat: "Parser", syntax: "CONVERT(value, start_unit, end_unit)" });
})(typeof module !== "undefined" && module.exports ? require("./formula.js") : SheetFormula);
