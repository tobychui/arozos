/*
    ArozOS Office Sheets - formula engine unit tests
    Run with: node test_formula.js   (exits 1 on failure)
*/
var F = require("./formula.js");

var failures = 0, passes = 0;
function eq(name, got, want) {
    var g = F.isErr(got) ? got.code : got;
    var ok;
    if (typeof want === "number" && typeof g === "number") {
        ok = Math.abs(g - want) < 1e-9;
    } else {
        ok = g === want;
    }
    if (ok) { passes++; }
    else {
        failures++;
        console.log("FAIL " + name + ": got " + JSON.stringify(g) + ", want " + JSON.stringify(want));
    }
}

/* grid fixture:
   A1=10 B1=20 C1=hello  A2=30 B2=40 C2==A1+B1
   A3==C3 (self cycle)   B3="5" (numeric string)  A4=TRUE */
var grid = {
    "0,0": "10", "1,0": "20", "2,0": "hello",
    "0,1": "30", "1,1": "40", "2,1": "=A1+B1",
    "0,2": "=A3", "1,2": "5", "0,3": "TRUE"
};
var calc = F.createCalculator(function (c, r) { return grid[c + "," + r]; });
function run(f) {
    calc.reset();
    return F.evaluate(F.parse(f), calc.ctx);
}

/* arithmetic & precedence */
eq("add", run("1+2"), 3);
eq("precedence", run("2+3*4"), 14);
eq("parens", run("(2+3)*4"), 20);
eq("power right-assoc", run("2^3^2"), 512);
eq("unary minus", run("-3+5"), 2);
eq("unary vs power (Excel)", run("-2^2"), 4);
eq("percent", run("50%"), 0.5);
eq("concat op", run('"a"&"b"&1'), "ab1");
eq("compare", run("3>2"), true);
eq("compare text ci", run('"ABC"="abc"'), true);
eq("not equal", run("1<>2"), true);

/* references & ranges */
eq("ref", run("A1"), 10);
eq("ref math", run("A1+B1"), 30);
eq("formula chain", run("C2*2"), 60);
eq("SUM range", run("SUM(A1:B2)"), 100);
eq("SUM mixed args", run("SUM(A1:B1,5)"), 35);
eq("SUM skips text in range", run("SUM(A1:C1)"), 30);
eq("AVERAGE", run("AVERAGE(A1:B2)"), 25);
eq("MIN", run("MIN(A1:B2)"), 10);
eq("MAX", run("MAX(A1:B2)"), 40);
eq("COUNT range (numbers only)", run("COUNT(A1:C2)"), 5);
eq("COUNTA", run("COUNTA(A1:C2)"), 6);
eq("numeric string coerced", run("B3+1"), 6);

/* functions */
eq("IF true", run('IF(A1>5,"big","small")'), "big");
eq("IF false", run('IF(A1>50,"big","small")'), "small");
eq("IF no else", run("IF(FALSE,1)"), false);
eq("CONCAT", run('CONCAT("x",A1,"y")'), "x10y");
eq("CONCATENATE alias", run('CONCATENATE(1,2)'), "12");
eq("ROUND", run("ROUND(3.14159,2)"), 3.14);
eq("ROUND neg digits", run("ROUND(1234,-2)"), 1200);
eq("ROUND half up", run("ROUND(2.5,0)"), 3);
eq("ABS", run("ABS(0-7)"), 7);
eq("INT", run("INT(3.9)"), 3);
eq("LEN", run('LEN("hello")'), 5);
eq("UPPER", run('UPPER("aBc")'), "ABC");
eq("TRIM", run('TRIM("  a   b  ")'), "a b");

/* errors */
eq("div by zero", run("1/0"), "#DIV/0!");
eq("bad name", run("NOSUCHFN(1)"), "#NAME?");
eq("text arithmetic", run('"abc"+1'), "#VALUE!");
calc.reset();
eq("cycle detection", calc.value(0, 2), "#CYCLE!");

/* literal parsing */
eq("literal number", F.literalValue("42"), 42);
eq("literal percent", F.literalValue("25%"), 0.25);
eq("literal bool", F.literalValue("true"), true);
eq("forced text", F.literalValue("'123"), "123");
eq("literal text", F.literalValue("hi"), "hi");

/* reference rewriting */
eq("rewrite relative", F.rewriteRelative("=A1+B2", 1, 1), "=B2+C3");
eq("rewrite keeps absolute", F.rewriteRelative("=$A$1+B2", 1, 1), "=$A$1+C3");
eq("rewrite mixed anchor", F.rewriteRelative("=$A1+A$1", 0, 2), "=$A3+A$1");
eq("rewrite off-grid -> #REF!", F.rewriteRelative("=A1", -1, 0), "=#REF!");
eq("rewrite inside function", F.rewriteRelative("=SUM(A1:B2)", 2, 0), "=SUM(C1:D2)");
eq("rewrite ignores strings", F.rewriteRelative('="A1"&B1', 1, 0), '="A1"&C1');

/* moved-range rewriting (drag-to-move semantics) */
var mv = { c1: 0, r1: 0, c2: 1, r2: 1 };   // A1:B2 moved...
eq("move: ref inside follows", F.rewriteMovedRange("=A1+C5", mv, 2, 3), "=C4+C5");
eq("move: absolute inside follows", F.rewriteMovedRange("=$A$1", mv, 2, 3), "=$C$4");
eq("move: outside untouched", F.rewriteMovedRange("=C5*D6", mv, 2, 3), "=C5*D6");
eq("move: range endpoints follow", F.rewriteMovedRange("=SUM(A1:B2)", mv, 1, 1), "=SUM(B2:C3)");
eq("move: off-grid -> #REF!", F.rewriteMovedRange("=A1", mv, -1, 0), "=#REF!");
eq("move: strings untouched", F.rewriteMovedRange('="A1"&A1', mv, 1, 0), '="A1"&B1');

/* insert / delete adjustment */
eq("insert row shifts", F.adjustInsertDelete("=A5", "row", 2, 1), "=A6");
eq("insert row before untouched", F.adjustInsertDelete("=A1", "row", 2, 1), "=A1");
eq("delete row -> #REF!", F.adjustInsertDelete("=A3", "row", 2, -1), "=#REF!");
eq("delete row shifts up", F.adjustInsertDelete("=A5", "row", 2, -1), "=A4");
eq("insert col shifts", F.adjustInsertDelete("=C1", "col", 1, 2), "=E1");

/* helpers */
eq("colToName", F.colToName(0), "A");
eq("colToName AA", F.colToName(26), "AA");
eq("nameToCol", F.nameToCol("AB"), 27);
eq("cellName", F.cellName(2, 4), "C5");

console.log(passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
