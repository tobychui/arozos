/*
    ArozOS Office Sheets - golden-file check against real spreadsheet apps
    Run with: node test_golden.js <dir>   (exits 1 on any mismatch)

    <dir> holds *.golden.json files made by the Go dump test (see
    mod/office/xlsx_golden_test.go) from .xlsx files saved by Excel or Google
    Sheets. Every formula is recalculated here and compared with the value
    the app stored. Formulas using volatile functions (TODAY, NOW, RAND,
    RANDBETWEEN) are skipped.
*/
var fs = require("fs");
var path = require("path");
var F = require("./formula_node.js");

var dir = process.argv[2];
if (!dir) {
    console.log("usage: node test_golden.js <dir with *.golden.json>");
    process.exit(2);
}
var files = fs.readdirSync(dir).filter(function (f) { return /\.golden\.json$/.test(f); });
if (!files.length) {
    console.log("no .golden.json files in " + dir);
    process.exit(2);
}
var VOLATILE = /\b(TODAY|NOW|RAND|RANDBETWEEN)\s*\(/i;
var totalBad = 0;

files.forEach(function (file) {
    var g = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    var sheets = g.workbook.sheets;
    var calc = F.createCalculator(function (c, r, s) {
        var cell = sheets[s].cells[F.cellName(c, r)];
        return cell ? cell.v : "";
    }, {
        activeSheet: function () { return 0; },
        sheetIndex: function (name) {
            for (var i = 0; i < sheets.length; i++) if (sheets[i].name.toLowerCase() === String(name).toLowerCase()) return i;
            return -1;
        },
        rowState: function (s, r) { return (sheets[s].hiddenRows || []).indexOf(r) >= 0 ? 1 : 0; },
        cellFormat: function (s, c, r) {
            var cell = sheets[s].cells[F.cellName(c, r)];
            return cell && cell.s ? cell.s.fmt : undefined;
        }
    });
    var checked = 0, skipped = 0, bad = [];
    sheets.forEach(function (sh, si) {
        var cached = g.cached[sh.name] || {};
        Object.keys(cached).forEach(function (ref) {
            var cell = sh.cells[ref];
            if (!cell || String(cell.v).charAt(0) !== "=") return;
            if (VOLATILE.test(cell.v)) { skipped++; return; }
            var want = cached[ref], p = F.parseCellKey(ref);
            var got = calc.value(p.col, p.row, si);
            var ok;
            switch (want[0]) {
                case "n":
                    ok = want[1] === "" ? (got === null || got === "") :
                        typeof got === "number" && Math.abs(got - parseFloat(want[1])) <= 1e-9 * Math.max(1, Math.abs(got));
                    break;
                case "b": ok = got === (want[1] === "1" || want[1] === "TRUE"); break;
                case "e": ok = F.isErr(got) && got.code === want[1]; break;
                default: ok = (got === null ? "" : F.isErr(got) ? got.code : String(got)) === want[1];
            }
            checked++;
            if (!ok) bad.push(sh.name + "!" + ref + "  " + cell.v + "  got " +
                JSON.stringify(F.isErr(got) ? got.code + " (" + got.message + ")" : got) + "  want " + JSON.stringify(want));
        });
    });
    console.log(file + ": " + checked + " formulas checked, " + skipped + " volatile skipped, " + bad.length + " mismatches");
    bad.slice(0, 40).forEach(function (b) { console.log("  " + b); });
    if (bad.length > 40) console.log("  ... " + (bad.length - 40) + " more");
    totalBad += bad.length;
});
process.exit(totalBad ? 1 : 0);
