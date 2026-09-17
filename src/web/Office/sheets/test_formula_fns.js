/*
    ArozOS Office Sheets - function library tests
    Run with: node test_formula_fns.js   (exits 1 on failure)

    Expected values come from Microsoft's Excel function documentation
    examples (cross-checked in Python where arithmetic was involved), so a
    failure means we differ from Excel, not merely from ourselves. Every
    registered function must appear in at least one test (checked at the end).
*/
var F = require("./formula_node.js");

var failures = 0, passes = 0, tested = {};
function show(v) { return F.isErr(v) ? v.code : (F.isArr(v) ? "Arr" + JSON.stringify(v.data) : v); }
function report(ok, name, got, want) {
    if (ok) passes++;
    else {
        failures++;
        console.log("FAIL " + name + ": got " + JSON.stringify(show(got)) + ", want " + JSON.stringify(want));
    }
}

/* A small workbook: book({ A1: "10", B1: "=A1*2" }, { Other: {...} }, names) */
function book(cells, others, names) {
    var sheets = [{ name: "Sheet1", cells: cells || {}, hidden: {}, filtered: {}, formats: {} }];
    Object.keys(others || {}).forEach(function (n) { sheets.push({ name: n, cells: others[n], hidden: {}, filtered: {}, formats: {} }); });
    var calc = F.createCalculator(function (c, r, s) {
        return sheets[s].cells[F.cellName(c, r)];
    }, {
        activeSheet: function () { return 0; },
        sheetIndex: function (name) {
            for (var i = 0; i < sheets.length; i++) if (sheets[i].name.toLowerCase() === String(name).toLowerCase()) return i;
            return -1;
        },
        rowState: function (s, r) { return sheets[s].filtered[r] ? 2 : (sheets[s].hidden[r] ? 1 : 0); },
        cellFormat: function (s, c, r) { return sheets[s].formats[F.cellName(c, r)]; },
        definedName: function (n) { return (names || {})[String(n).toUpperCase()]; },
        formulaCells: function (si) {
            return Object.keys(sheets[si].cells).filter(function (k) {
                return String(sheets[si].cells[k]).charAt(0) === "=";
            }).map(function (k) { var pos = F.parseCellKey(k); return { col: pos.col, row: pos.row }; });
        },
        sheetCount: function () { return sheets.length; },
        sheetName: function (i) { return sheets[i] ? sheets[i].name : ""; },
        // used range, as the app computes it for A:A and 2:5
        bounds: function (si) {
            var rows = 0, cols = 0;
            Object.keys(sheets[si].cells).forEach(function (k) {
                var pos = F.parseCellKey(k);
                if (!pos || k === "Z99") return;
                rows = Math.max(rows, pos.row + 1);
                cols = Math.max(cols, pos.col + 1);
            });
            return { rows: rows, cols: cols };
        }
    });
    var api = {
        sheets: sheets,
        // evaluate a formula as if typed into Z99 of Sheet1
        run: function (formula) {
            calc.reset();
            sheets[0].cells.Z99 = "=" + formula;
            var v = calc.value(25, 98, 0);
            api.hint = calc.hintAt(25, 98, 0);
            delete sheets[0].cells.Z99;
            return v;
        },
        // the whole spilled result of a formula typed into Z99, as rows
        spill: function (formula) {
            calc.reset();
            sheets[0].cells.Z99 = "=" + formula;
            var first = calc.value(25, 98, 0);
            var sp = calc.spillAt(25, 98, 0);
            var rows = [];
            if (!sp) rows = [[first]];
            else {
                for (var r = sp.r1; r <= sp.r2; r++) {
                    var line = [];
                    for (var c = sp.c1; c <= sp.c2; c++) line.push(calc.value(c, r, 0));
                    rows.push(line);
                }
            }
            delete sheets[0].cells.Z99;
            return rows;
        },
        calc: calc
    };
    return api;
}
var W = book();
function names(formula) {
    (formula.match(/[A-Z][A-Z0-9._]*(?=\()/g) || []).forEach(function (n) { tested[n] = true; });
}
function eq(formula, want, wb) {
    names(formula);
    var got = (wb || W).run(formula);
    var g = F.isErr(got) ? got.code : got;
    var ok = typeof want === "number" && typeof g === "number" ? Math.abs(g - want) < 1e-9 * Math.max(1, Math.abs(want)) : g === want;
    report(ok, formula, got, want);
}
// a spilled result, compared cell by cell (numbers to 1e-9, errors by code)
function arrEq(formula, want, wb, decimals) {
    names(formula);
    var got = (wb || W).spill(formula);
    var tol = decimals === undefined ? 1e-9 : 0.5 * Math.pow(10, -decimals) + 1e-12;
    var ok = got.length === want.length && got.every(function (row, r) {
        return row.length === want[r].length && row.every(function (v, c) {
            var w = want[r][c];
            var g = F.isErr(v) ? v.code : v;
            if (typeof w === "number" && typeof g === "number") return Math.abs(g - w) <= tol * Math.max(1, decimals === undefined ? Math.abs(w) : 1);
            return g === w;
        });
    });
    report(ok, formula, got.map(function (row) { return row.map(function (v) { return F.isErr(v) ? v.code : v; }); }), want);
}
// numbers compared to the given number of decimals (Excel docs round)
function near(formula, want, decimals, wb) {
    names(formula);
    var got = (wb || W).run(formula);
    var ok = typeof got === "number" && Math.abs(got - want) <= 0.5 * Math.pow(10, -decimals) + 1e-12;
    report(ok, formula + " ~" + decimals, got, want);
}

/* ================= Phase 0 foundations ================= */
eq('_xlfn.IFS(1>2,"a",TRUE,"b")', "b");
eq('_xlfn._xlws.SUM(1,2)', 3);
eq("ROUND(1)", 1);
eq("ROUND()", "#N/A");                              // arity check
eq('"2024-05-01"+1', 45414);                       // date text coerces
eq('"12:00"*2', 1);
eq('"May 1, 2024"-"2024-04-30"', 1);
eq("SUM(A1)", 0, book({ A1: "hello" }));          // text in a referenced cell is skipped
eq('SUM("hello")', "#VALUE!");                     // typed text is an error
eq("SUMPRODUCT(LEN(A1:A3))", 8, book({ A1: "ab", A2: "cde", A3: "fgh" }));   // element-wise LEN
eq('SUMPRODUCT(--(LEFT(A1:A3,1)="c"))', 1, book({ A1: "ab", A2: "cde", A3: "fgh" }));
eq("SUM(IF(A1:A3>1,A1:A3,0))", 5, book({ A1: "1", A2: "2", A3: "3" }));

/* criteria matcher (via COUNTIF) */
var CR = book({
    A1: "apples", A2: "oranges", A3: "peaches", A4: "apples", A5: "", A6: "32", A7: "54", A8: "75", A9: "86",
    A10: "'75", A11: "TRUE", A12: "2024-05-01", A13: "a*b", A14: "Apple pie"
});
CR.sheets[0].cells.A12 = "45413";
eq('COUNTIF(A1:A14,"apples")', 2, CR);
eq('COUNTIF(A1:A14,"APPLES")', 2, CR);
eq('COUNTIF(A1:A14,"*es")', 4, CR);
eq('COUNTIF(A1:A14,"?????")', 0, CR);
eq('COUNTIF(A1:A14,"a*")', 4, CR);
eq('COUNTIF(A1:A14,">55")', 4, CR);
eq('COUNTIF(A1:A14,"<>75")', 12, CR);
eq("COUNTIF(A1:A14,75)", 2, CR);                   // number and numeric text
eq('COUNTIF(A1:A14,"")', 1, CR);
eq('COUNTIF(A1:A14,"<>")', 13, CR);
eq('COUNTIF(A1:A14,TRUE)', 1, CR);
eq('COUNTIF(A1:A14,">=2024-01-01")', 1, CR);
eq('COUNTIF(A1:A14,"a~*b")', 1, CR);
eq('COUNTIF(A1:A14,"<b")', 5, CR);                 // text below "b" (incl. the text '75)

/* ================= logical / info / operator ================= */
eq('SWITCH(2,1,"one",2,"two","other")', "two");
eq('SWITCH(9,1,"one",2,"two","other")', "other");
eq('SWITCH(9,1,"one")', "#N/A");
eq("XOR(TRUE,FALSE)", true);
eq("XOR(TRUE,TRUE)", false);
eq("XOR(1>0,2>1,3>2)", true);
eq("TRUE()", true);
eq("FALSE()", false);
eq("NOT(FALSE)", true);
eq("CHOOSE(2,10,20,30)", 20);
var INF = book({ A1: "", A2: "5", A3: "text", A4: "TRUE", A5: "=1/0", A6: "=NA()", A7: "=A2*2", A8: "45413" });
INF.sheets[0].formats.A8 = "date";
eq("ISBLANK(A1)", true, INF);
eq("ISBLANK(A2)", false, INF);
eq("ISNUMBER(A2)", true, INF);
eq("ISTEXT(A3)", true, INF);
eq("ISNONTEXT(A2)", true, INF);
eq("ISLOGICAL(A4)", true, INF);
eq("ISERROR(A5)", true, INF);
eq("ISERR(A6)", false, INF);
eq("ISERR(A5)", true, INF);
eq("ISNA(A6)", true, INF);
eq("ISFORMULA(A7)", true, INF);
eq("ISFORMULA(A2)", false, INF);
eq("ISDATE(A8)", true, INF);
eq("ISDATE(A2)", false, INF);
eq('ISEMAIL("someone@example.com")', true);
eq('ISEMAIL("not an email")', false);
eq('ISURL("https://www.example.com/path")', true);
eq('ISURL("hello")', false);
eq("NA()", "#N/A");
eq("N(A2)", 5, INF);
eq("N(A4)", 1, INF);
eq("N(A3)", 0, INF);
eq("TYPE(A2)", 1, INF);
eq("TYPE(A3)", 2, INF);
eq("TYPE(A4)", 4, INF);
eq("TYPE(A5)", 16, INF);
eq("TYPE(A1:A3)", 64, INF);
eq("ERROR.TYPE(A5)", 2, INF);
eq("ERROR.TYPE(A6)", 7, INF);
eq("ERROR.TYPE(A2)", "#N/A", INF);
eq("ADD(2,3)", 5);
eq("MINUS(2,3)", -1);
eq("MULTIPLY(2,3)", 6);
eq("DIVIDE(3,0)", "#DIV/0!");
eq("POW(2,10)", 1024);
eq("EQ(2,2)", true);
eq("NE(2,2)", false);
eq("GT(3,2)", true);
eq("GTE(2,2)", true);
eq("LT(1,2)", true);
eq("LTE(3,2)", false);
eq("UMINUS(4)", -4);
eq("UPLUS(4)", 4);
eq("UNARY_PERCENT(50)", 0.5);
eq("ISBETWEEN(5,1,5)", true);
eq("ISBETWEEN(5,1,5,TRUE,FALSE)", false);

/* ================= math ================= */
eq("ROUNDUP(3.2,0)", 4);
eq("ROUNDUP(76.9,0)", 77);
eq("ROUNDUP(3.14159,3)", 3.142);
eq("ROUNDUP(-3.14159,1)", -3.2);
eq("ROUNDUP(31415.92654,-2)", 31500);
eq("ROUNDUP(0.1+0.2,1)", 0.3);
eq("ROUNDDOWN(3.2,0)", 3);
eq("ROUNDDOWN(-3.14159,1)", -3.1);
eq("ROUNDDOWN(31415.92654,-2)", 31400);
eq("ROUND(1.005,2)", 1.01);
eq("TRUNC(8.9)", 8);
eq("TRUNC(-8.9)", -8);
eq("TRUNC(0.45,1)", 0.4);
eq("INT(-8.9)", -9);
eq("MROUND(10,3)", 9);
eq("MROUND(-10,-3)", -9);
eq("MROUND(1.3,0.2)", 1.4);
eq("MROUND(5,-2)", "#NUM!");
eq("CEILING(2.5,1)", 3);
eq("CEILING(-2.5,-2)", -4);
eq("CEILING(-2.5,2)", -2);
eq("CEILING(1.5,0.1)", 1.5);
eq("CEILING(0.234,0.01)", 0.24);
eq("FLOOR(3.7,2)", 2);
eq("FLOOR(-2.5,-2)", -2);
eq("FLOOR(2.5,-2)", "#NUM!");
eq("FLOOR(1.58,0.1)", 1.5);
eq("FLOOR(0.234,0.01)", 0.23);
eq("CEILING.MATH(24.3,5)", 25);
eq("CEILING.MATH(6.7)", 7);
eq("CEILING.MATH(-8.1,2)", -8);
eq("CEILING.MATH(-5.5,2,-1)", -6);
eq("FLOOR.MATH(24.3,5)", 20);
eq("FLOOR.MATH(-8.5,2)", -10);
eq("FLOOR.MATH(-5.5,2,-1)", -4);
eq("CEILING.PRECISE(-4.1,-2)", -4);
eq("ISO.CEILING(4.3)", 5);
eq("FLOOR.PRECISE(-3.2,-1)", -4);
eq("EVEN(1.5)", 2);
eq("EVEN(3)", 4);
eq("EVEN(-1)", -2);
eq("ODD(1.5)", 3);
eq("ODD(2)", 3);
eq("ODD(-1)", -1);
eq("ODD(-2)", -3);
eq("ISEVEN(-1)", false);
eq("ISODD(5)", true);
eq("SIGN(-0.5)", -1);
eq("QUOTIENT(-10,3)", -3);
eq("PRODUCT(5,15,30)", 2250);
eq("SUMSQ(3,4)", 25);
eq("SQRT(16)", 4);
eq("SQRT(-16)", "#NUM!");
near("SQRTPI(2)", 2.506628, 6);
eq("POWER(5,2)", 25);
eq("POWER(0,-1)", "#DIV/0!");
near("EXP(1)", 2.718282, 6);
near("LN(86)", 4.454347, 6);
eq("LOG(8,2)", 3);
eq("LOG(10)", 1);
near("LOG10(86)", 1.934498451, 9);
near("PI()", 3.14159265358979, 14);
eq("AND(RAND()>=0,RAND()<1)", true);
eq("AND(RANDBETWEEN(1,3)>=1,RANDBETWEEN(1,3)<=3)", true);
near("SIN(PI()/6)", 0.5, 12);
near("COS(PI()/3)", 0.5, 12);
near("TAN(PI()/4)", 1, 12);
near("ASIN(-0.5)", -0.523598776, 9);
near("ACOS(-0.5)", 2.094395102, 9);
near("ATAN(1)", 0.785398163, 9);
near("ATAN2(-1,-1)", -2.35619449, 8);
near("SINH(1)", 1.175201194, 9);
near("COSH(4)", 27.30823284, 8);
near("TANH(-2)", -0.96402758, 8);
near("ASINH(10)", 2.99822295, 8);
near("ACOSH(10)", 2.993222846, 9);
near("ATANH(0.76159416)", 1.00000001, 8);
near("COT(30)", -0.156119952, 9);
near("COTH(2)", 1.037314721, 9);
near("ACOT(2)", 0.463647609, 9);
near("ACOTH(6)", 0.168236118, 9);
near("CSC(15)", 1.537780562, 9);
near("CSCH(1.5)", 0.469642441, 9);
near("SEC(45)", 1.903594407, 9);
near("SECH(45)", 5.7304E-20, 24);
eq("COT(0)", "#DIV/0!");
eq("DEGREES(PI())", 180);
near("RADIANS(270)", 4.712389, 6);
eq("FACT(5)", 120);
eq("FACT(1.9)", 1);
eq("FACTDOUBLE(7)", 105);
eq("COMBIN(8,2)", 28);
eq("COMBINA(4,3)", 20);
eq("PERMUT(100,3)", 970200);
eq("PERMUTATIONA(3,2)", 9);
eq("GCD(24,36)", 12);
eq("LCM(24,36)", 72);
eq("MULTINOMIAL(2,3,4)", 1260);
var SS = book({ A1: "1", A2: "=-1/2", A3: "=1/24", A4: "=-1/720" });
near("SERIESSUM(PI()/4,0,2,A1:A4)", 0.707103, 6, SS);
eq("BASE(7,2)", "111");
eq("BASE(100,16,4)", "0064");
eq('DECIMAL("FF",16)', 255);
eq('DECIMAL("zap",36)', 45745);
eq('ROMAN(499,0)', "CDXCIX");
eq('ROMAN(499,1)', "LDVLIV");
eq('ROMAN(499,2)', "XDIX");
eq('ROMAN(499,3)', "VDIV");
eq('ROMAN(499,4)', "ID");
eq('ROMAN(2013)', "MMXIII");
eq('ARABIC("mcmxii")', 1912);
eq('ARABIC("-CDXCIX")', -499);

/* engineering */
eq("DEC2BIN(9,4)", "1001");
eq("DEC2BIN(-100)", "1110011100");
eq("DEC2BIN(512)", "#NUM!");
eq("DEC2OCT(58,3)", "072");
eq("DEC2HEX(-54)", "FFFFFFFFCA");
eq("DEC2HEX(100,4)", "0064");
eq('BIN2DEC("1111111111")', -1);
eq("BIN2DEC(1100100)", 100);
eq('BIN2HEX("11111011",4)', "00FB");
eq('BIN2OCT("1001",3)', "011");
eq('HEX2DEC("FFFFFFFF5B")', -165);
eq('HEX2BIN("F",8)', "00001111");
eq('HEX2OCT("F",3)', "017");
eq('OCT2DEC("7777777533")', -165);
eq('OCT2BIN("3",3)', "011");
eq('OCT2HEX("100",4)', "0040");
eq("BITAND(13,25)", 9);
eq("BITOR(23,10)", 31);
eq("BITXOR(5,3)", 6);
eq("BITLSHIFT(4,2)", 16);
eq("BITRSHIFT(13,2)", 3);
eq("BITLSHIFT(4,-2)", 1);
eq("DELTA(5,4)", 0);
eq("DELTA(5,5)", 1);
eq("GESTEP(5,4)", 1);
eq("GESTEP(-4,-5)", 1);
near('CONVERT(1,"lbm","kg")', 0.4535924, 7);
eq('CONVERT(68,"F","C")', 20);
eq('CONVERT(2.5,"ft","sec")', "#N/A");
near('CONVERT(CONVERT(100,"ft","m"),"ft","m")', 9.290304, 6);
near('CONVERT(1,"km","mi")', 0.621371, 6);
eq('CONVERT(1,"Mibyte","byte")', 1048576);
near('CONVERT(1,"gal","l")', 3.785411784, 9);
eq('CONVERT(1,"hr","mn")', 60);

/* ================= statistics ================= */
var ST = book({
    A1: "1345", A2: "1301", A3: "1368", A4: "1322", A5: "1310", A6: "1370", A7: "1318", A8: "1350", A9: "1303", A10: "1299",
    B1: "3", B2: "4", B3: "5", B4: "2", B5: "3", B6: "4", B7: "5", B8: "6", B9: "4", B10: "7",
    C1: "4", C2: "5", C3: "8", C4: "7", C5: "11", C6: "4", C7: "3",
    D1: "1", D2: "2", D3: "3", D4: "6", D5: "6", D6: "6", D7: "7", D8: "8", D9: "9",
    E1: "13", E2: "12", E3: "11", E4: "8", E5: "4", E6: "3", E7: "2", E8: "1", E9: "1", E10: "1",
    F1: "6", F2: "7", F3: "15", F4: "36", F5: "39", F6: "40", F7: "41", F8: "42", F9: "43", F10: "47", F11: "49",
    G1: "1", G2: "2", G3: "4", G4: "7", G5: "8", G6: "9", G7: "10", G8: "12",
    H1: "10", H2: "TRUE", H3: "text", H4: "",
    I1: "4", I2: "5", I3: "6", I4: "7", I5: "5", I6: "4", I7: "3",
    J1: "4", J2: "5", J3: "6", J4: "7", J5: "2", J6: "3", J7: "4", J8: "5", J9: "1", J10: "2", J11: "3"
});
near("STDEV(A1:A10)", 27.46391572, 8, ST);
near("STDEV.S(A1:A10)", 27.46391572, 8, ST);
near("STDEVP(A1:A10)", 26.05455814, 8, ST);
near("STDEV.P(A1:A10)", 26.05455814, 8, ST);
near("VAR(A1:A10)", 754.2666667, 7, ST);
near("VAR.S(A1:A10)", 754.2666667, 7, ST);
near("VARP(A1:A10)", 678.84, 9, ST);
near("VAR.P(A1:A10)", 678.84, 9, ST);
eq("AVERAGEA(H1:H4)", 11 / 3, ST);                  // 10, TRUE=1, text=0
eq("MAXA(H1:H3)", 10, ST);
eq("MINA(H1:H3)", 0, ST);
near("STDEVA(H1:H3)", 5.507570547, 9, ST);
near("STDEVPA(H1:H3)", 4.496912521, 9, ST);
near("VARA(H1:H3)", 30.33333333, 8, ST);
near("VARPA(H1:H3)", 20.22222222, 8, ST);
near("SKEW(B1:B10)", 0.359543071, 9, ST);
near("SKEW.P(B1:B10)", 0.303193339, 9, ST);
near("KURT(B1:B10)", -0.151799637, 9, ST);
near("GEOMEAN(C1:C7)", 5.476986969656962, 12, ST);
near("HARMEAN(C1:C7)", 5.028375962061728, 12, ST);
near("AVEDEV(I1:I7)", 1.020408163, 9, ST);
eq("DEVSQ(C1:C7)", 48, ST);
near("TRIMMEAN(J1:J11,0.2)", 3.777777778, 9, ST);
eq("MEDIAN(D1:D9)", 6, ST);
eq("MEDIAN(1,2,3,4,5,6)", 3.5);
eq("MODE(5.6,4,4,3,2,4)", 4);
eq("MODE.SNGL(D1:D9)", 6, ST);
eq("MODE(1,2,3)", "#N/A");
eq("LARGE(G1:G8,3)", 9, ST);
eq("SMALL(G1:G8,2)", 2, ST);
eq("SMALL(G1:G8,9)", "#NUM!", ST);
eq("RANK(7,B1:B10)", 1, ST);
eq("RANK(3,B1:B10,1)", 2, ST);
eq("RANK.EQ(4,B1:B10)", 5, ST);
eq("RANK.AVG(4,B1:B10)", 6, ST);
near("PERCENTILE(G1:G8,0.3)", 4.3, 12, ST);
near("PERCENTILE.INC(G1:G4,0.3)", 1.9, 12, ST);
eq("PERCENTILE.EXC(D1:D9,0.25)", 2.5, ST);
eq("PERCENTILE.EXC(D1:D9,0)", "#NUM!", ST);
eq("QUARTILE(G1:G8,1)", 3.5, ST);
eq("QUARTILE.INC(G1:G8,3)", 9.25, ST);
eq("QUARTILE.EXC(F1:F11,1)", 15, ST);
eq("QUARTILE.EXC(F1:F11,3)", 43, ST);
eq("PERCENTRANK.INC(E1:E10,2)", 0.333, ST);
eq("PERCENTRANK.INC(E1:E10,4)", 0.555, ST);
eq("PERCENTRANK.INC(E1:E10,8)", 0.666, ST);
eq("PERCENTRANK(E1:E10,5)", 0.583, ST);
eq("PERCENTRANK.EXC(D1:D9,7)", 0.7, ST);
eq("PERCENTRANK.EXC(D1:D9,5.43)", 0.381, ST);
eq("PERCENTRANK.EXC(D1:D9,5.43,1)", 0.3, ST);
eq("STANDARDIZE(42,40,1.5)", 4 / 3);
near("FISHER(0.75)", 0.972955075, 9);
near("FISHERINV(0.972955)", 0.75, 6);
var PR = book({ A1: "0", A2: "1", A3: "2", A4: "3", B1: "0.2", B2: "0.3", B3: "0.1", B4: "0.4" });
near("PROB(A1:A4,B1:B4,2)", 0.1, 12, PR);
near("PROB(A1:A4,B1:B4,1,3)", 0.8, 12, PR);
var WA = book({ A1: "10", A2: "20", A3: "30", B1: "1", B2: "2", B3: "3" });
eq("AVERAGE.WEIGHTED(A1:A3,B1:B3)", 140 / 6, WA);
eq("AVERAGE.WEIGHTED(A1:A3,B1:B3,5,4)", 160 / 10, WA);
eq("COUNTBLANK(H1:H4)", 1, ST);
eq("COUNTUNIQUE(D1:D9)", 7, ST);
eq('COUNTUNIQUE(1,1,"a","A")', 3);

var PAIR = book({
    A1: "3", A2: "2", A3: "4", A4: "5", A5: "6", B1: "9", B2: "7", B3: "12", B4: "15", B5: "17",
    C1: "2", C2: "3", C3: "9", C4: "1", C5: "8", C6: "7", C7: "5", D1: "6", D2: "5", D3: "11", D4: "7", D5: "5", D6: "4", D7: "4",
    E1: "6", E2: "7", E3: "9", E4: "15", E5: "21", F1: "20", F2: "28", F3: "31", F4: "38", F5: "40",
    G1: "2", G2: "4", G3: "8", H1: "5", H2: "11", H3: "12"
});
near("CORREL(A1:A5,B1:B5)", 0.997054486, 9, PAIR);
near("PEARSON(A1:A5,B1:B5)", 0.997054486, 9, PAIR);
near("RSQ(C1:C7,D1:D7)", 0.05795, 5, PAIR);
near("SLOPE(C1:C7,D1:D7)", 0.305555556, 9, PAIR);
near("INTERCEPT(C1:C5,D1:D5)", 0.048387097, 9, PAIR);
near("STEYX(C1:C7,D1:D7)", 3.305718950, 9, PAIR);
near("FORECAST(30,E1:E5,F1:F5)", 10.607253, 6, PAIR);
near("FORECAST.LINEAR(30,E1:E5,F1:F5)", 10.607253, 6, PAIR);
near("COVAR(A1:A5,B1:B5)", 5.2, 12, PAIR);
near("COVARIANCE.P(A1:A5,B1:B5)", 5.2, 12, PAIR);
near("COVARIANCE.S(G1:G3,H1:H3)", 9.666666667, 9, PAIR);
eq("SUMX2MY2(G1:G3,H1:H3)", 4 + 16 + 64 - 25 - 121 - 144, PAIR);
eq("SUMX2PY2(G1:G3,H1:H3)", 4 + 16 + 64 + 25 + 121 + 144, PAIR);
eq("SUMXMY2(G1:G3,H1:H3)", 9 + 49 + 16, PAIR);

/* conditional aggregates (Excel doc tables) */
var CI = book({
    A1: "100000", A2: "200000", A3: "300000", A4: "400000",
    B1: "7000", B2: "14000", B3: "21000", B4: "28000",
    C1: "250000", C2: "", C3: "", C4: "",
    D1: "Vegetables", D2: "Vegetables", D3: "Fruits", D4: "",
    E1: "Tomatoes", E2: "Celery", E3: "Oranges", E4: "Butter",
    F1: "2300", F2: "5500", F3: "800", F4: "400",
    G1: "89", G2: "93", G3: "96", G4: "85", G5: "91", G6: "88",
    H1: "1", H2: "2", H3: "2", H4: "3", H5: "1", H6: "1"
});
eq('SUMIF(A1:A4,">160000",B1:B4)', 63000, CI);
eq('SUMIF(A1:A4,">160000")', 900000, CI);
eq('SUMIF(A1:A4,300000,B1:B4)', 21000, CI);
eq('SUMIF(A1:A4,">"&C1,B1:B4)', 49000, CI);
eq('SUMIF(D1:D4,"Fruits",F1:F4)', 800, CI);
eq('SUMIF(E1:E4,"*es",F1:F4)', 3100, CI);
eq('SUMIF(D1:D4,"",F1:F4)', 400, CI);
eq('SUMIF(D1:D4,"Vegetables",F1)', 7800, CI);      // sum range resized from its top-left
eq('SUMIFS(F1:F4,D1:D4,"Vegetables",E1:E4,"T*")', 2300, CI);
eq('COUNTIFS(D1:D4,"Vegetables",F1:F4,">3000")', 1, CI);
eq('AVERAGEIF(B1:B4,"<23000")', 14000, CI);
eq('AVERAGEIF(A1:A4,"<95000")', "#DIV/0!", CI);
eq('AVERAGEIF(A1:A4,">250000",B1:B4)', 24500, CI);
eq('AVERAGEIFS(G1:G6,H1:H6,1)', 268 / 3, CI);
eq('MAXIFS(G1:G6,H1:H6,1)', 91, CI);
eq('MINIFS(G1:G6,H1:H6,2)', 93, CI);
eq('MAXIFS(G1:G6,H1:H6,9)', 0, CI);
eq('SUMIFS(G1:G6,H1:H5,1)', "#VALUE!", CI);

/* SUBTOTAL with hidden and filtered rows */
var SUB = book({ A1: "1", A2: "2", A3: "3", A4: "4", A5: "=SUBTOTAL(9,A1:A4)", A6: "10" });
SUB.sheets[0].hidden[1] = true;          // row 2 hidden by the user
SUB.sheets[0].filtered[2] = true;        // row 3 hidden by a filter
eq("SUBTOTAL(9,A1:A6)", 1 + 2 + 4 + 10, SUB);   // skips the nested SUBTOTAL and the filtered row
eq("SUBTOTAL(109,A1:A6)", 1 + 4 + 10, SUB);
eq("SUBTOTAL(2,A1:A6)", 4, SUB);
eq("SUBTOTAL(1,A1:A4)", 7 / 3, SUB);
eq("SUBTOTAL(4,A1:A4)", 4, SUB);
eq("SUBTOTAL(99,A1:A4)", "#VALUE!", SUB);

/* database functions (Excel doc orchard table) */
var DB = book({
    A1: "Tree", B1: "Height", C1: "Age", D1: "Yield", E1: "Profit", F1: "Height",
    A2: "=\"=Apple\"", B2: "'>10", C2: "", D2: "", E2: "", F2: "'<16",
    A3: "=\"=Pear\"",
    A6: "Tree", B6: "Height", C6: "Age", D6: "Yield", E6: "Profit",
    A7: "Apple", B7: "18", C7: "20", D7: "14", E7: "105",
    A8: "Pear", B8: "12", C8: "12", D8: "10", E8: "96",
    A9: "Cherry", B9: "13", C9: "14", D9: "9", E9: "105",
    A10: "Apple", B10: "14", C10: "15", D10: "10", E10: "75",
    A11: "Pear", B11: "9", C11: "8", D11: "8", E11: "76.8",
    A12: "Apple", B12: "8", C12: "9", D12: "6", E12: "45"
});
eq('DCOUNT(A6:E12,"Age",A1:F2)', 1, DB);
eq('DCOUNTA(A6:E12,"Profit",A1:F2)', 1, DB);
eq('DMAX(A6:E12,"Profit",A1:A3)', 105, DB);
eq('DMIN(A6:E12,"Profit",A1:B2)', 75, DB);
eq('DSUM(A6:E12,"Profit",A1:A2)', 225, DB);
eq('DSUM(A6:E12,"Profit",A1:F2)', 75, DB);
eq('DPRODUCT(A6:E12,"Yield",A1:F2)', 10, DB);
eq('DAVERAGE(A6:E12,"Yield",A1:B2)', 12, DB);
eq('DAVERAGE(A6:E12,3,A6:E12)', 13, DB);
near('DSTDEV(A6:E12,"Yield",A1:A3)', 2.966479395, 9, DB);
near('DSTDEVP(A6:E12,"Yield",A1:A3)', 2.653299832, 9, DB);
near('DVAR(A6:E12,"Yield",A1:A3)', 8.8, 9, DB);
near('DVARP(A6:E12,"Yield",A1:A3)', 7.04, 9, DB);
eq('DGET(A6:E12,"Yield",A1:A3)', "#NUM!", DB);
eq('DGET(A6:E12,"Yield",A1:F2)', 10, DB);

/* ================= text ================= */
eq('LEFT("Sale Price",4)', "Sale");
eq('LEFT("Sweden")', "S");
eq('RIGHT("Sale Price",5)', "Price");
eq('MID("Fluid Flow",7,20)', "Flow");
eq('MID("Fluid Flow",0,5)', "#VALUE!");
eq('FIND("M","Miriam McGovern")', 1);
eq('FIND("m","Miriam McGovern")', 6);
eq('FIND("M","Miriam McGovern",3)', 8);
eq('FIND("x","abc")', "#VALUE!");
eq('SEARCH("e","Statements",6)', 7);
eq('SEARCH("margin","Profit Margin")', 8);
eq('SEARCH("m?rg*","Profit Margin")', 8);
eq('SEARCH("~*","a*b")', 2);
eq('SUBSTITUTE("Sales Data","Sales","Cost")', "Cost Data");
eq('SUBSTITUTE("Quarter 1, 2008","1","2",1)', "Quarter 2, 2008");
eq('SUBSTITUTE("Quarter 1, 2011","1","2",3)', "Quarter 1, 2012");
eq('REPLACE("abcdefghijk",6,5,"*")', "abcde*k");
eq('REPLACE("2009",3,2,"10")', "2010");
eq('REPT("*-",3)', "*-*-*-");
eq('PROPER("this is a TITLE")', "This Is A Title");
eq('PROPER("2-way street")', "2-Way Street");
eq('PROPER("76BudGet")', "76Budget");
eq('EXACT("word","Word")', false);
eq('EXACT("word","word")', true);
eq('VALUE("$1,000")', 1000);
eq('VALUE("(250)")', -250);
near('VALUE("16:48:00")-VALUE("12:00:00")', 0.2, 12);
eq('VALUE("12%")', 0.12);
eq('VALUE("abc")', "#VALUE!");
eq('NUMBERVALUE("2.500,27",",",".")', 2500.27);
eq('NUMBERVALUE("3.5%")', 0.035);
eq('TEXT(1234.567,"$#,##0.00")', "$1,234.57");
eq('TEXT(0.285,"0.0%")', "28.5%");
eq('TEXT(DATE(2024,5,1),"dddd")', "Wednesday");
eq('TEXT("1234","0.00")', "1234.00");
eq('TEXT(4.34,"# ?/?")', "4 1/3");
eq('TEXTJOIN(", ",TRUE,"a","","b")', "a, b");
eq('TEXTJOIN(", ",FALSE,"a","","b")', "a, , b");
var TJ = book({ A1: "US", A2: "Canada", A3: "", A4: "Mexico" });
eq('TEXTJOIN("-",TRUE,A1:A4)', "US-Canada-Mexico", TJ);
eq('JOIN("-",A1:A2,"x")', "US-Canada-x", TJ);
eq('CONCAT(A1:A2,"!")', "USCanada!", TJ);
eq('TEXTBEFORE("Red riding hood","riding")', "Red ");
eq('TEXTAFTER("Red riding hood"," ",-1)', "hood");
eq('TEXTAFTER("Red riding hood","basket",1,0,0,"Not found")', "Not found");
eq('TEXTAFTER("Red riding hood","RIDING",1,1)', " hood");
eq('TEXTBEFORE("a-b-c","-",2)', "a-b");
eq("CHAR(65)", "A");
eq('CODE("A")', 65);
eq("UNICHAR(937)", "Ω");
eq('UNICODE("Ω")', 937);
eq('CLEAN(CHAR(9)&"Monthly report"&CHAR(10))', "Monthly report");
eq('T("Rainfall")', "Rainfall");
eq("T(19)", "");
eq("FIXED(1234.567,1)", "1,234.6");
eq("FIXED(1234.567,-1)", "1,230");
eq("FIXED(-1234.567,-1,TRUE)", "-1230");
eq("FIXED(44.332)", "44.33");
eq("DOLLAR(1234.567,2)", "$1,234.57");
eq("DOLLAR(-1234.567,-2)", "-$1,200");
eq("DOLLAR(-0.123,4)", "-$0.1230");
eq('REGEXMATCH("Spreadsheets","^S")', true);
eq('REGEXMATCH("spreadsheets","(?i)^S")', true);
eq('REGEXEXTRACT("abc123def","\\d+")', "123");
eq('REGEXEXTRACT("abc123def","([a-z]+)(\\d+)")', "abc");
eq('REGEXEXTRACT("abc","\\d")', "#N/A");
eq('REGEXREPLACE("a-b-c","-","+")', "a+b+c");
eq('REGEXREPLACE("2024-05-01","(\\d+)-(\\d+)-(\\d+)","$3/$2/$1")', "01/05/2024");
eq('REGEXMATCH("a","(")', "#REF!");
eq('ENCODEURL("a b&c")', "a%20b%26c");
eq('LENB("日本語ab")', 8);
eq('LEFTB("日本語",4)', "日本");
eq('LEFTB("日本語",3)', "日");
eq('RIGHTB("日本語",2)', "語");
eq('MIDB("日本語",3,2)', "本");
eq('FINDB("本","日本語")', 3);
eq('SEARCHB("B","a日b")', 4);
eq('REPLACEB("日本語",3,2,"x")', "日x語");
eq('ASC("ＡＢＣ　ガパ")', "ABC ｶﾞﾊﾟ");

/* ================= dates ================= */
eq('DATEVALUE("2008-08-22")', 39682);
eq('DATEVALUE("8/22/2008")', 39682);
eq('DATEVALUE("22-Aug-2008")', 39682);
eq('DATEVALUE("August 22, 2008")', 39682);
eq('DATEVALUE("hello")', "#VALUE!");
near('TIMEVALUE("2:24 AM")', 0.1, 12);
near('TIMEVALUE("22-Aug-2008 6:35 AM")', 0.274305556, 9);
eq("TIME(12,0,0)", 0.5);
near("TIME(16,48,10)", 0.700115741, 9);
eq("TIME(25,0,0)", 1 / 24);
eq('EDATE("2011-01-15",1)', 40589);
eq('EDATE("2011-01-31",1)', 40602);
eq('EDATE("2011-01-15",-1)', 40527);
eq('EOMONTH("2011-01-01",1)', 40602);
eq('EOMONTH("2011-01-01",-3)', 40482);
eq('DAYS("2021-03-15","2021-02-01")', 42);
eq('DAYS("2011-12-31","2011-01-01")', 364);
eq('DATEDIF("2001-01-01","2003-01-01","Y")', 2);
eq('DATEDIF("2001-06-01","2002-08-15","D")', 440);
eq('DATEDIF("2001-06-01","2002-08-15","YD")', 75);
eq('DATEDIF("2001-06-01","2002-08-15","MD")', 14);
eq('DATEDIF("2001-06-01","2002-08-15","M")', 14);
eq('DATEDIF("2001-06-01","2002-08-15","YM")', 2);
eq('DATEDIF("2003-01-01","2001-01-01","Y")', "#NUM!");
eq('DAYS360("2011-01-30","2011-12-31")', 330);
eq('DAYS360("2011-01-01","2011-01-31")', 30);
eq('DAYS360("2011-01-01","2011-02-28")', 57);
eq('DAYS360("2011-01-30","2011-12-31",TRUE)', 330);
near('YEARFRAC("2012-01-01","2012-07-30")', 0.580555556, 9);
near('YEARFRAC("2012-01-01","2012-07-30",1)', 0.576502732, 9);
near('YEARFRAC("2012-01-01","2012-07-30",3)', 0.57808219, 8);
near('YEARFRAC("2012-01-01","2012-07-30",2)', 211 / 360, 12);
near('YEARFRAC("2012-01-01","2012-07-30",4)', 0.580555556, 9);
eq('WEEKNUM("2012-03-09")', 10);
eq('WEEKNUM("2012-03-09",2)', 11);
eq('WEEKNUM("2012-03-09",21)', 10);
eq('ISOWEEKNUM("2012-03-09")', 10);
eq('ISOWEEKNUM("2021-01-01")', 53);
var HOL = book({ A1: "41235", A2: "41247", A3: "41295", B1: "38719", B2: "38733" });   // 2012-11-22, 2012-12-04, 2013-01-21 / 2006-01-02, 2006-01-16
eq('NETWORKDAYS("2012-10-01","2013-03-01")', 110, HOL);
eq('NETWORKDAYS("2012-10-01","2013-03-01",A1)', 109, HOL);
eq('NETWORKDAYS("2012-10-01","2013-03-01",A1:A3)', 107, HOL);
eq("NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,1,31))", 22, HOL);
eq("NETWORKDAYS.INTL(DATE(2006,2,28),DATE(2006,1,31))", -21, HOL);
eq("NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),7,B1:B2)", 22, HOL);
eq('NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),"0010001",B1:B2)', 20, HOL);
var HOL2 = book({ A1: "39778", A2: "39786", A3: "39834" });   // 2008-11-26, 2008-12-04, 2009-01-21
eq('WORKDAY("2008-10-01",151)', 39933, HOL2);
eq('WORKDAY("2008-10-01",151,A1:A3)', 39938, HOL2);
eq("WORKDAY.INTL(DATE(2012,1,1),30,0)", "#NUM!");
eq("WORKDAY.INTL(DATE(2012,1,1),90,11)", 41013);
eq('TEXT(WORKDAY.INTL(DATE(2012,1,1),30,17),"m/d/yyyy")', "2/5/2012");
near("EPOCHTODATE(1655906710)", 44734.5869212963, 9);
near("EPOCHTODATE(1655906710000,2)", 44734.5869212963, 9);
eq('YEAR("2024-05-01")', 2024);
eq('HOUR("2024-05-01 13:45")', 13);

/* ================= lookup ================= */
var LK = book({
    A1: "Bananas", A2: "Oranges", A3: "Apples", A4: "Pears",
    B1: "25", B2: "38", B3: "40", B4: "41",
    C1: "41", C2: "40", C3: "38", C4: "25",
    D1: "Blue", D2: "Red", D3: "Green", D4: "Yellow",
    E1: "4.14", E2: "4.19", E3: "5.17", E4: "5.77",
    F1: "a", G1: "b", H1: "c", F2: "1", G2: "2", H2: "3"
});
eq("MATCH(39,B1:B4,1)", 2, LK);
eq("MATCH(41,B1:B4,0)", 4, LK);
eq("MATCH(40,B1:B4,-1)", 3, LK);            // unsorted for -1: Excel is undefined, we answer the smallest >= key
eq("MATCH(40,C1:C4,-1)", 2, LK);
eq('MATCH("app*",A1:A4,0)', 3, LK);
eq('MATCH("b",F1:H1,0)', 2, LK);
eq("MATCH(1,A1:B4,0)", "#N/A", LK);
eq("XMATCH(41,B1:B4)", 4, LK);
eq("XMATCH(39,B1:B4,1)", 3, LK);
eq("XMATCH(39,B1:B4,-1)", 2, LK);
eq('XMATCH("*es",A1:A4,2,-1)', 3, LK);
eq('XLOOKUP("Apples",A1:A4,B1:B4)', 40, LK);
eq('XLOOKUP("Kiwi",A1:A4,B1:B4,"none")', "none", LK);
eq('XLOOKUP("Kiwi",A1:A4,B1:B4)', "#N/A", LK);
eq('XLOOKUP(39,B1:B4,A1:A4,,1)', "Apples", LK);
eq('XLOOKUP("b",F1:H1,F2:H2)', 2, LK);
eq('SUM(XLOOKUP("Oranges",A1:A4,B1:C4))', 78, LK);
eq('XLOOKUP("Apples",A1:A4,B1:B3)', "#VALUE!", LK);
eq("LOOKUP(4.19,E1:E4,D1:D4)", "Red", LK);
eq("LOOKUP(5.75,E1:E4,D1:D4)", "Green", LK);
eq("LOOKUP(7.66,E1:E4,D1:D4)", "Yellow", LK);
eq("LOOKUP(0,E1:E4,D1:D4)", "#N/A", LK);
eq('LOOKUP("c",F1:H2)', 3, LK);
eq("INDEX(A1:B4,2,2)", 38, LK);
eq("INDEX(A1:B4,3,1)", "Apples", LK);
eq("INDEX(F1:H1,2)", "b", LK);
eq("INDEX(A1:A4,3)", "Apples", LK);
eq("INDEX(A1:B4,5,1)", "#REF!", LK);
eq("SUM(INDEX(B1:C4,0,2))", 144, LK);
eq("SUM(INDEX(B1:C4,2,0))", 78, LK);
eq("VLOOKUP(\"Pe*\",A1:B4,2,FALSE)", 41, LK);
eq("ROW(C10)", 10);
eq("ROW()", 99);                                  // formulas run in Z99
eq("COLUMN(D1)", 4);
eq("COLUMN()", 26);
eq("SUM(ROW(A1:A3))", 6);
eq("ROWS(A1:C4)", 4);
eq("COLUMNS(A1:C4)", 3);
eq("ROWS(A1)", 1);

/* ================= finance ================= */
near("PMT(0.08/12,10,10000)", -1037.03, 2);
near("PMT(0.08/12,10,10000,0,1)", -1030.16, 2);
near("PMT(0.06/12,18*12,0,50000)", -129.08, 2);
near("PMT(0,10,1000)", -100, 12);
near("FV(0.06/12,10,-200,-500,1)", 2581.40, 2);
near("FV(0.12/12,12,-1000)", 12682.50, 2);
near("PV(0.08/12,12*20,500,0)", -59777.15, 2);
near("NPER(0.12/12,-100,-1000,10000,1)", 59.67386567, 8);
near("NPER(0.12/12,-100,-1000)", -9.57859404, 8);
near("RATE(4*12,-200,8000)", 0.007701472, 9);
near("IPMT(0.1/12,1,3*12,8000)", -66.67, 2);
near("IPMT(0.1,3,3,8000)", -292.45, 2);
near("PPMT(0.1/12,1,2*12,2000)", -75.62, 2);
near("PPMT(0.08,10,10,200000)", -27598.05, 2);
near("CUMIPMT(0.09/12,30*12,125000,13,24,0)", -11135.23, 2);
near("CUMIPMT(0.09/12,30*12,125000,1,1,0)", -937.50, 2);
near("CUMPRINC(0.09/12,30*12,125000,13,24,0)", -934.1071234, 7);
near("CUMPRINC(0.09/12,30*12,125000,1,1,0)", -68.27827118, 8);
near("ISPMT(0.1/12,1,36,8000000)", -64814.8, 1);
var NP = book({
    A1: "-10000", A2: "3000", A3: "4200", A4: "6800",
    B1: "-70000", B2: "12000", B3: "15000", B4: "18000", B5: "21000", B6: "26000",
    C1: "-120000", C2: "39000", C3: "30000", C4: "21000", C5: "37000", C6: "46000",
    D1: "-10000", D2: "2750", D3: "4250", D4: "3250", D5: "2750",
    E1: "39448", E2: "39508", E3: "39751", E4: "39859", E5: "39904",
    F1: "0.09", F2: "0.11", F3: "0.1"
});
near("NPV(0.1,A1:A4)", 1188.44, 2, NP);
near("NPV(0.08,8000,9200,10000,12000,14500)-40000", 1922.06, 2, NP);
near("IRR(B1:B6)", 0.086630948, 9, NP);
near("IRR(B1:B3,-0.1)", -0.443506941, 9, NP);
near("MIRR(C1:C6,0.1,0.12)", 0.126094130, 9, NP);
near("XNPV(0.09,D1:D5,E1:E5)", 2086.65, 2, NP);
near("XIRR(D1:D5,E1:E5)", 0.373362535, 8, NP);
near("FVSCHEDULE(1,F1:F3)", 1.33089, 5, NP);
near("EFFECT(0.0525,4)", 0.053542667, 9);
near("NOMINAL(0.053543,4)", 0.05250032, 8);
near("RRI(96,10000,11000)", 0.0009933, 7);
near("PDURATION(0.025,2000,2200)", 3.86, 2);
eq("SLN(30000,7500,10)", 2250);
near("SYD(30000,7500,10,1)", 4090.91, 2);
near("SYD(30000,7500,10,10)", 409.09, 2);
near("DB(1000000,100000,6,1,7)", 186083.33, 2);
near("DB(1000000,100000,6,2,7)", 259639.42, 2);
near("DB(1000000,100000,6,3,7)", 176814.44, 2);
near("DB(1000000,100000,6,4,7)", 120410.64, 2);
near("DB(1000000,100000,6,5,7)", 81999.64, 2);
near("DB(1000000,100000,6,6,7)", 55841.76, 2);
near("DB(1000000,100000,6,7,7)", 15845.10, 2);
near("DDB(2400,300,10*365,1)", 1.32, 2);
near("DDB(2400,300,10*12,1,2)", 40, 12);
near("DDB(2400,300,10,1,2)", 480, 12);
near("DDB(2400,300,10,2,1.5)", 306, 12);
near("DDB(2400,300,10,10)", 22.12, 2);
near("VDB(2400,300,10*365,0,1)", 1.32, 2);
near("VDB(2400,300,10*12,0,1)", 40, 12);
near("VDB(2400,300,10,0,1)", 480, 12);
near("VDB(2400,300,10*12,6,18)", 396.31, 2);
near("VDB(2400,300,10*12,6,18,1.5)", 311.81, 2);
near("VDB(2400,300,10,0,0.875,1.5)", 315, 12);
eq("DOLLARDE(1.02,16)", 1.125);
eq("DOLLARDE(1.1,32)", 1.3125);
near("DOLLARFR(1.125,16)", 1.02, 12);
near("DOLLARFR(1.125,32)", 1.04, 12);

/* ================= Phase 2: references, names, arrays ================= */
var RF = book({
    A1: "Region", B1: "Sales", C1: "Cost",
    A2: "North", B2: "100", C2: "40",
    A3: "South", B3: "200", C3: "70",
    A4: "East", B4: "300", C4: "90",
    A5: "West", B5: "400", C5: "120",
    E1: "=SUM(B:B)", E2: "hello", E3: "=1/0"
}, {
    Data: { A1: "10", A2: "20", A3: "30", B1: "x" }
}, {
    SALES: { formula: "=Sheet1!$B$2:$B$5" },
    RATE: { formula: "=0.2" },
    DATARANGE: { formula: "=Data!A1:A3" }
});

/* array literals */
eq("SUM({1,2,3})", 6);
eq("SUM({1,2;3,4})", 10);
eq("SUMPRODUCT({1,2,3},{4,5,6})", 32);
eq('VLOOKUP(2,{1,"a";2,"b"},2,FALSE)', "b");
eq("{1,2}+{10,20}", 11);                        // spills: 11 here, 22 to the right
eq("SUM({1,2}+{10,20})", 33);
eq("COUNT({1,2;3,4})", 4);

/* whole columns, whole rows, open-ended ranges */
eq("SUM(B:B)", 1000, RF);
eq("SUM(B:C)", 1320, RF);
eq("COUNTA(A:A)", 5, RF);
eq("SUM(2:2)", 140, RF);                        // row 2 across the used columns
eq("SUM(B2:B)", 1000, RF);                      // open-ended, Sheets style
eq("SUM(Data!A:A)", 60, RF);
eq("COUNTIF(A:A,\"North\")", 1, RF);
eq("ROWS(B:B)", 5, RF);
eq("SUM($B:$B)", 1000, RF);

/* defined names */
eq("SUM(SALES)", 1000, RF);
eq("SUM(sales)", 1000, RF);                     // names are case-insensitive
eq("RATE*100", 20, RF);
eq("SUM(DataRange)", 60, RF);
eq("AVERAGE(SALES)", 250, RF);
eq("NOSUCHNAME", "#NAME?", RF);
eq("INDEX(SALES,2)", 200, RF);

/* OFFSET */
eq("OFFSET(A1,1,1)", 100, RF);
eq("SUM(OFFSET(B1,1,0,4,1))", 1000, RF);
eq("SUM(OFFSET(B2:B5,0,1))", 320, RF);
eq("OFFSET(A1,-1,0)", "#REF!", RF);
eq("OFFSET(A1,0,0,0,1)", "#REF!", RF);
eq("ROWS(OFFSET(A1,0,0,3,2))", 3, RF);
eq("COLUMNS(OFFSET(A1,0,0,3,2))", 2, RF);

/* INDIRECT */
eq('INDIRECT("B3")', 200, RF);
eq('SUM(INDIRECT("B2:B5"))', 1000, RF);
eq('INDIRECT("Data!A2")', 20, RF);
eq('SUM(INDIRECT("Sheet1!B2:B3"))', 300, RF);
eq('INDIRECT("$B$4")', 300, RF);
eq('INDIRECT("nonsense!!")', "#REF!", RF);
eq('INDIRECT("B3",FALSE)', "#REF!", RF);
eq('SUM(A1:INDIRECT("B5"))', 1000, RF);

/* the range operator over functions */
eq("SUM(B2:INDEX(B2:B5,3))", 600, RF);
eq("SUM(INDEX(B2:B5,1):INDEX(B2:B5,2))", 300, RF);
eq("ROWS(A1:OFFSET(A1,3,0))", 4, RF);

/* ADDRESS */
eq("ADDRESS(2,3)", "$C$2");
eq("ADDRESS(2,3,2)", "C$2");
eq("ADDRESS(2,3,3)", "$C2");
eq("ADDRESS(2,3,4)", "C2");
eq("ADDRESS(2,3,1,FALSE)", "R2C3");
eq("ADDRESS(2,3,2,FALSE)", "R2C[3]");
eq('ADDRESS(2,3,1,TRUE,"Sheet 1")', "'Sheet 1'!$C$2");
eq("ADDRESS(0,3)", "#VALUE!");
eq('INDIRECT(ADDRESS(3,2))', 200, RF);

/* ISREF, FORMULATEXT, CELL */
eq("ISREF(A1)", true, RF);
eq("ISREF(B2:B5)", true, RF);
eq('ISREF(INDIRECT("A1"))', true, RF);
eq("ISREF(SALES)", true, RF);
eq('ISREF("A1")', false, RF);
eq("ISREF(42)", false, RF);
eq("FORMULATEXT(E1)", "=SUM(B:B)", RF);
eq("FORMULATEXT(A1)", "#N/A", RF);
eq('CELL("address",B3)', "$B$3", RF);
eq('CELL("row",B3)', 3, RF);
eq('CELL("col",B3)', 2, RF);
eq('CELL("contents",B3)', 200, RF);
eq('CELL("type",B3)', "v", RF);
eq('CELL("type",A3)', "l", RF);
eq('CELL("type",Z50)', "b", RF);
eq('CELL("format",B3)', "G", RF);
eq('CELL("protect",B3)', 1, RF);
eq('CELL("nonsense",B3)', "#VALUE!", RF);

/* SHEET / SHEETS */
eq("SHEET()", 1, RF);
eq("SHEET(Data!A1)", 2, RF);
eq('SHEET("Data")', 2, RF);
eq('SHEET("Nope")', "#N/A", RF);
eq("SHEETS()", 2, RF);

/* HYPERLINK and the link hint */
eq('HYPERLINK("https://example.com","Example")', "Example");
report(RF.hint === null || !RF.hint, "no stale hint", RF.hint, null);
eq('HYPERLINK("https://example.com")', "https://example.com");
report(W.hint && W.hint.link === "https://example.com", "HYPERLINK sets the link hint", W.hint, "link");

/* TO_* conversions and their format hints */
eq("TO_PERCENT(0.2)", 0.2);
report(W.hint && W.hint.fmt === "percent", "TO_PERCENT hints percent", W.hint, "percent");
eq("TO_DOLLARS(12.5)", 12.5);
report(W.hint && W.hint.fmt === "currency", "TO_DOLLARS hints currency", W.hint, "currency");
eq('TO_DATE(45413)', 45413);
report(W.hint && W.hint.fmt === "date", "TO_DATE hints date", W.hint, "date");
eq("TO_TEXT(12.5)", "12.5");
eq('TO_TEXT("x")', "x");
eq('TO_PURE_NUMBER("0.5")', 0.5);
eq("DATE(2024,5,1)", 45413);
report(W.hint && W.hint.fmt === "date", "DATE hints date", W.hint, "date");
eq("B2+1", 101, RF);
report(RF.hint === null, "plain arithmetic hints nothing", RF.hint, null);

/* ================= Phase 3: spilling and array functions ================= */

/* the engine: layout, reading spilled cells, blocking, overlaps */
var SP3 = book({
    A1: "=SEQUENCE(3)",
    C1: "=A2", C2: "=SUM(A1:A3)", C3: "=A3*10",
    E1: "=SEQUENCE(2,2)", F2: "blocker",
    H1: "=SEQUENCE(2,1)", G2: "=SEQUENCE(1,2,100)",
    L1: "=B5:B7", B5: "5", B6: "6", B7: "7",
    N1: "=IFERROR(FILTER(B5:B7,B5:B7>9),\"none\")",
    P1: "=TODAY()+SEQUENCE(2)"
}, { Other: { A1: "=Sheet1!A2+1" } });
var spc = SP3.calc;
spc.reset();
report(spc.value(0, 0, 0) === 1 && spc.value(0, 1, 0) === 2 && spc.value(0, 2, 0) === 3, "SEQUENCE(3) spills down", [spc.value(0, 0, 0), spc.value(0, 1, 0), spc.value(0, 2, 0)], [1, 2, 3]);
report(spc.value(0, 3, 0) === null, "the spill stops after 3 rows", spc.value(0, 3, 0), null);
report(spc.value(2, 0, 0) === 2, "a formula can read a spilled cell", spc.value(2, 0, 0), 2);
report(spc.value(2, 1, 0) === 6, "SUM over a spilled range", spc.value(2, 1, 0), 6);
report(spc.value(2, 2, 0) === 30, "arithmetic on a spilled cell", spc.value(2, 2, 0), 30);
report(spc.value(0, 0, 1) === 3, "another sheet reads a spilled cell", spc.value(0, 0, 1), 3);
var blocked = spc.value(4, 0, 0);
report(F.isErr(blocked) && blocked.code === "#SPILL!", "a blocked spill is #SPILL!", blocked, "#SPILL!");
report(spc.value(4, 1, 0) === null, "a blocked spill leaves its area empty", spc.value(4, 1, 0), null);
var sp = spc.spillAt(0, 1, 0);
report(sp && sp.c1 === 0 && sp.r1 === 0 && sp.c2 === 0 && sp.r2 === 2, "spillAt describes the spill", sp, "A1:A3");
report(spc.spillAt(2, 0, 0) === null, "spillAt is null for a plain formula", spc.spillAt(2, 0, 0), null);
var h2 = spc.value(7, 1, 0), g2 = spc.value(6, 1, 0);
report(h2 === 2 && F.isErr(g2) && g2.code === "#SPILL!", "overlapping spills: the later one is #SPILL!", [h2, g2], [2, "#SPILL!"]);
report(spc.value(11, 1, 0) === 6, "=B5:B7 spills the range", spc.value(11, 1, 0), 6);
report(spc.value(13, 0, 0) === "none", "IFERROR around an empty FILTER", spc.value(13, 0, 0), "none");
spc.value(15, 0, 0);
var ph = spc.hintAt(15, 1, 0);
report(ph && ph.fmt === "date", "spilled cells wear the anchor hint", ph, "date");

arrEq("{1,2;3,4}", [[1, 2], [3, 4]]);
arrEq("{1,2}+{10,20}", [[11, 22]]);
arrEq("IFERROR(1/{1,0,2},0)", [[1, 0, 0.5]]);
eq("@{5,6}", 5);
var IMP = book({ B1: "10", B2: "20", B3: "30", C2: "=@B1:B3", D2: "=SINGLE(B1:B3)" });
eq("C2", 20, IMP);
eq("D2", 20, IMP);
eq("SINGLE({7,8})", 7);

/* data for the array functions */
var AR = book({
    A1: "Name", B1: "Dept", C1: "Pay",
    A2: "Ann", B2: "Ops", C2: "300",
    A3: "Bob", B3: "IT", C3: "250",
    A4: "Cid", B4: "Ops", C4: "410",
    A5: "Dee", B5: "HR", C5: "250",
    E1: "3", E2: "1", E3: "2", E4: "1",
    G1: "79", G2: "85", G3: "78", G4: "85", G5: "50", G6: "81", G7: "95", G8: "88", G9: "97",
    H1: "70", H2: "79", H3: "89"
});
arrEq('FILTER(A2:A5,B2:B5="Ops")', [["Ann"], ["Cid"]], AR);
arrEq('FILTER(A2:C5,C2:C5>=300)', [["Ann", "Ops", 300], ["Cid", "Ops", 410]], AR);
arrEq('FILTER(A2:A5,B2:B5="Ops",C2:C5>300)', [["Cid"]], AR);
arrEq('FILTER(A2:A5,B2:B5="None","nobody")', [["nobody"]], AR);
arrEq('FILTER(A2:A5,B2:B5="None")', [["#CALC!"]], AR);
arrEq("SORT(E1:E4)", [[1], [1], [2], [3]], AR);
arrEq("SORT(E1:E4,1,FALSE)", [[3], [2], [1], [1]], AR);
arrEq("SORT(A2:C5,3,TRUE,1,FALSE)", [["Dee", "HR", 250], ["Bob", "IT", 250], ["Ann", "Ops", 300], ["Cid", "Ops", 410]], AR);
arrEq("SORT(A2:C5,3,-1)", [["Cid", "Ops", 410], ["Ann", "Ops", 300], ["Bob", "IT", 250], ["Dee", "HR", 250]], AR);
arrEq("SORT({3,1,2},1,1,TRUE)", [[1, 2, 3]]);
arrEq("SORTN(A2:C5,2,0,3,FALSE)", [["Cid", "Ops", 410], ["Ann", "Ops", 300]], AR);
arrEq("SORTN(C2:C5,1,1,1,TRUE)", [[250], [250]], AR);
arrEq("SORTN(C2:C5,2,2,1,TRUE)", [[250], [300]], AR);
arrEq("SORTN(C2:C5,2,3,1,TRUE)", [[250], [250], [300]], AR);
arrEq("UNIQUE(B2:B5)", [["Ops"], ["IT"], ["HR"]], AR);
arrEq("UNIQUE(B2:B5,FALSE,TRUE)", [["IT"], ["HR"]], AR);
arrEq('UNIQUE({"a";"A";"b"})', [["a"], ["b"]]);
arrEq("UNIQUE({1,2,1},TRUE)", [[1, 2]]);
arrEq("SEQUENCE(2,3)", [[1, 2, 3], [4, 5, 6]]);
arrEq("SEQUENCE(3,1,10,5)", [[10], [15], [20]]);
eq("SEQUENCE(0)", "#VALUE!");
eq("ROWS(RANDARRAY(4,2))", 4);
eq("COLUMNS(RANDARRAY(4,2))", 2);
eq("AND(RANDARRAY(3,3,5,9,TRUE)>=5,RANDARRAY(3,3,5,9,TRUE)<=9)", true);
arrEq('SPLIT("a-b-c","-")', [["a", "b", "c"]]);
arrEq('SPLIT("1,2;;3",",;")', [[1, 2, 3]]);
arrEq('SPLIT("a::b","::",FALSE,FALSE)', [["a", "b"]]);
arrEq('SPLIT("a,,b",",",TRUE,FALSE)', [["a", "", "b"]]);
arrEq('TEXTSPLIT("a,b;c,d",",",";")', [["a", "b"], ["c", "d"]]);
arrEq('TEXTSPLIT("a,b;c",",",";")', [["a", "b"], ["c", "#N/A"]]);
arrEq('TEXTSPLIT("a,b;c",",",";",FALSE,0,"-")', [["a", "b"], ["c", "-"]]);
arrEq("TRANSPOSE({1,2,3})", [[1], [2], [3]]);
arrEq("TRANSPOSE(A1:B2)", [["Name", "Ann"], ["Dept", "Ops"]], AR);
arrEq("FLATTEN({1,2;3,4},{5})", [[1], [2], [3], [4], [5]]);
arrEq("TOCOL({1,2;3,4})", [[1], [2], [3], [4]]);
arrEq("TOCOL({1,2;3,4},0,TRUE)", [[1], [3], [2], [4]]);
arrEq("TOROW({1,2;3,4})", [[1, 2, 3, 4]]);
arrEq("TOCOL(A1:A7,1)", [["Name"], ["Ann"], ["Bob"], ["Cid"], ["Dee"]], AR);
arrEq("HSTACK({1,2},{3,4})", [[1, 2, 3, 4]]);
arrEq("HSTACK({1;2},{3})", [[1, 3], [2, "#N/A"]]);
arrEq("VSTACK({1,2},{3,4})", [[1, 2], [3, 4]]);
arrEq("VSTACK({1,2},{3})", [[1, 2], [3, "#N/A"]]);
arrEq("CHOOSECOLS({1,2,3;4,5,6},1,-1)", [[1, 3], [4, 6]]);
arrEq("CHOOSEROWS({1,2;3,4;5,6},-1,1)", [[5, 6], [1, 2]]);
eq("CHOOSECOLS({1,2},3)", "#VALUE!");
arrEq('WRAPROWS({1,2,3,4,5},2,"x")', [[1, 2], [3, 4], [5, "x"]]);
arrEq("WRAPCOLS({1,2,3,4},2)", [[1, 3], [2, 4]]);
arrEq("ARRAY_CONSTRAIN(SEQUENCE(5,5),2,3)", [[1, 2, 3], [6, 7, 8]]);
arrEq("TAKE({1,2,3;4,5,6;7,8,9},2)", [[1, 2, 3], [4, 5, 6]]);
arrEq("TAKE({1,2,3;4,5,6;7,8,9},-2,-1)", [[6], [9]]);
arrEq("DROP({1,2,3;4,5,6;7,8,9},2)", [[7, 8, 9]]);
arrEq("DROP({1,2,3;4,5,6;7,8,9},,-2)", [[1], [4], [7]]);
arrEq('EXPAND({1,2;3,4},3,3,"-")', [[1, 2, "-"], [3, 4, "-"], ["-", "-", "-"]]);
eq("EXPAND({1,2},1,1)", "#VALUE!");
arrEq("ARRAYFORMULA(A2:A3&\"!\")", [["Ann!"], ["Bob!"]], AR);
arrEq("ARRAYFORMULA(C2:C3*2)", [[600], [500]], AR);

/* matrices */
arrEq("MMULT({1,3;7,2},{2,0;0,2})", [[2, 6], [14, 4]]);
eq("MMULT({1,2},{1,2})", "#VALUE!");
arrEq("MINVERSE({4,-1;2,0})", [[0, 0.5], [-1, 2]]);
arrEq("MINVERSE({-1,0;0,-1})", [[-1, 0], [0, -1]]);
eq("MINVERSE({1,2;2,4})", "#NUM!");
eq("MDETERM({1,3,8,5;1,3,6,1;1,1,1,0;7,3,10,2})", 88);
eq("MDETERM({3,6;1,1})", -3);
arrEq("MUNIT(3)", [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);

/* statistics that return arrays */
arrEq("FREQUENCY(G1:G9,H1:H3)", [[1], [2], [4], [2]], AR);
arrEq("MODE.MULT(1,2,3,4,3,2,1,2,3,5,6,1)", [[1], [2], [3]]);
eq("MODE.MULT(1,2,3)", "#N/A");
var RG = book({
    A1: "1", A2: "9", A3: "5", A4: "7", B1: "0", B2: "4", B3: "2", B4: "3",
    D1: "2.1", D2: "3.9", D3: "6.2", D4: "7.8", D5: "10.1", E1: "1", E2: "2", E3: "3", E4: "4", E5: "5",
    G1: "33100", G2: "47300", G3: "69000", G4: "102000", G5: "150000", G6: "220000",
    H1: "11", H2: "12", H3: "13", H4: "14", H5: "15", H6: "16", H7: "17", H8: "18",
    J1: "133890", J2: "135000", J3: "135790", J4: "137300", J5: "138130", J6: "139100",
    J7: "139900", J8: "141120", J9: "141890", J10: "143230", J11: "144000", J12: "145290",
    K1: "1", K2: "2", K3: "3", K4: "4", K5: "5", K6: "6", K7: "7", K8: "8", K9: "9", K10: "10", K11: "11", K12: "12",
    K13: "13", K14: "14", K15: "15", K16: "16", K17: "17"
});
arrEq("LINEST(A1:A4,B1:B4)", [[2, 1]], RG);
arrEq("LINEST(D1:D5,E1:E5,TRUE,TRUE)", [
    [1.99, 0.05],
    [0.059721576, 0.198074060],
    [0.997305329, 0.188856206],
    [1110.308411, 3],
    [39.601, 0.107]
], RG, 6);
arrEq("LOGEST(G1:G6,H1:H6)", [[1.463275628, 495.304770]], RG, 6);
arrEq("GROWTH(G1:G6,H1:H6,H7:H8)", [[320196.72], [468536.05]], RG, 2);
arrEq("TREND(J1:J12,K1:K12,K13:K17)", [[146171.52], [147189.70], [148207.88], [149226.06], [150244.24]], RG, 2);
near("INDEX(TREND(J1:J12,K1:K12),1)", 133953.3333, 4, RG);
near("INDEX(GROWTH(G1:G6,H1:H6),1)", 32618.20377, 5, RG);

/* ================= the originals, for completeness ================= */
eq("ABS(-2)", 2);
eq("AVERAGE(2,4,\"6\")", 4);
eq('CONCATENATE("a",1,TRUE)', "a1TRUE");
eq('COUNT(1,"2","x",TRUE)', 3);
eq('COUNTA(1,"",FALSE)', 3);
eq('DAY("2024-05-17")', 17);
eq('MONTH("2024-05-17")', 5);
eq('MINUTE("13:45:30")', 45);
eq('SECOND("13:45:30")', 30);
eq('WEEKDAY("2024-05-01")', 4);
eq("HLOOKUP(\"b\",F1:H2,2,FALSE)", 2, LK);
eq('IFERROR(1/0,"x")', "x");
eq('IFNA(NA(),"x")', "x");
eq('LOWER("AbC")', "abc");
eq('UPPER("AbC")', "ABC");
eq('TRIM("  a  b ")', "a b");
eq("MAX(1,5,3)", 5);
eq("MIN(1,5,3)", 1);
eq("MOD(-3,2)", 1);
eq("OR(FALSE,TRUE)", true);
eq("UNARY_PERCENT(5)", 0.05);
eq("TODAY()<=NOW()", true);

/* ================= every registered function has a test ================= */
var untested = F.functionNames().filter(function (n) { return !tested[n]; });
if (untested.length) {
    failures++;
    console.log("UNTESTED functions (" + untested.length + "): " + untested.join(" "));
}

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
