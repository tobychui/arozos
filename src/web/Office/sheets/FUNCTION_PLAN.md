# Sheets formula functions — gap analysis & implementation plan

Status: **Phases 0, 1A, 1B, 2 and 3 done** (Phase 3: 2026-09-17); Phase 4
(`LET`/`LAMBDA`) is next. Written 2026-09-15. Compares the ArozOS Office Sheets formula
engine ([`formula.js`](formula.js)) with the
[Google Sheets function list](https://support.google.com/docs/table/25273?hl=en).

## Where we are

| | At planning | Now |
|---|---|---|
| Functions in Google's list (unique names) | 515 | 515 |
| Implemented in Sheets | 37 | **368** (+9 Excel-only: `XMATCH` `NUMBERVALUE` `TEXTBEFORE` `TEXTAFTER` `TAKE` `DROP` `EXPAND` `TEXTSPLIT` `SINGLE`) |
| Missing | 478 | **147** (Phases 4-5 and not planned) |

Coverage by Google category now:

| Category | Google | Have | Missing |
|---|---|---|---|
| Statistical | 136 | 68 | 68 |
| Math | 84 | 77 | 7 |
| Financial | 50 | 27 | 23 |
| Engineering | 47 | 19 | 28 |
| Text | 41 | 41 | 0 |
| Array | 29 | 23 | 6 |
| Date | 26 | 26 | 0 |
| Info | 18 | 18 | 0 |
| Lookup | 17 | 16 | 1 |
| Operator | 17 | 17 | 0 |
| Logical | 13 | 11 | 2 |
| Database | 12 | 12 | 0 |
| Web | 8 | 3 | 5 |
| Google | 7 | 1 | 6 |
| Parser | 6 | 6 | 0 |
| Filter | 4 | 4 | 0 |
| AI | 1 | 0 | 1 |

(Google lists `UNIQUE` under both Operator and Filter, hence 516 rows for
515 names.) What remains is `LET`/`LAMBDA` and its helpers (Phase 4), distributions,
bond maths and complex numbers (Phase 5), and the handful that need a server
or Google (not planned).

### How it was built and tested

- The engine ([`formula.js`](formula.js)) dispatches through a registry;
  functions live in `formula_fn_*.js` modules (see the Office README,
  "Sheets formula engine", for the helper API).
- [`test_formula_fns.js`](test_formula_fns.js): 774 checks taken from
  Microsoft's documented examples (arithmetic cross-checked in Python); it
  fails if any registered function lacks a test.
- [`test_golden.js`](test_golden.js) + `TestGoldenDump`
  ([`mod/office/xlsx_golden_test.go`](../../../mod/office/xlsx_golden_test.go)):
  recalculates every formula of real Excel/Google files and compares with
  the values those apps stored. The Helpdesk export: 52,111 formulas, 0
  differences. Add more fixtures from real workbooks as they come up.

### What the numbers hid (at planning time)

Most of the 478 are cheap scalar functions, but a handful of *engine*
features gate the functions people actually use. Those come first:

1. **Excel name prefixes — an existing bug.** Excel stores functions newer
   than the 2007 file format with a prefix: `_xlfn.IFS(...)`,
   `_xlfn.IFNA(...)`, `_xlfn.CONCAT(...)`, `_xlfn.XLOOKUP(...)`,
   `_xlfn._xlws.FILTER(...)`, and LAMBDA parameters as `_xlpm.x`. Nothing in
   `mod/office` or `formula.js` strips or writes these, so `IFS`/`IFNA`/
   `CONCAT` already show `#NAME?` in workbooks Excel saved.
2. **Criteria matching** (`">5"`, `"<>"`, `"a*"`, `"~*"`) — shared by every
   `*IF`/`*IFS` function and the `D*` database family.
3. **Calling-cell context** — `ROW()`, `COLUMN()`, `ISFORMULA`, relative
   `INDIRECT`/`OFFSET` need to know which cell is being evaluated.
4. **References as values** — `INDEX`/`OFFSET`/`INDIRECT` return *references*
   (`SUM(A1:INDEX(...))`), not just values.
5. **Spilling** — `FILTER`, `SORT`, `UNIQUE`, `SEQUENCE`, `SPLIT`… return
   arrays that fill neighbouring cells. Today a range outside an array
   context is `#VALUE!`.
6. **Names** — workbook defined names (`Dept`, `Tech` in the Helpdesk
   reference file), `LET`, `LAMBDA`.
7. **Result formats** — Sheets shows `=DATE(2026,9,15)` as a date and
   `=TO_PERCENT(0.2)` as `20%`; our cells show the serial number unless the
   user formats them.

## Phase 0 — Foundations (engine work, few new functions) — done

Do these before adding functions in bulk; everything after depends on them.

Shipped as planned, with two differences: functions register from
`formula_fn_<area>.js` files next to `formula.js` rather than a
`sheets/formula/` folder, and golden fixtures are not committed (real
workbooks carry private data) — the dump/compare tools take any folder.
Help UI on top of the registry metadata (`syntax`, `cat`) is still to do.

- **Function registry.** Replace the `call()` switch with a table:
  `{name, min, max, category, syntax, lazy?, array?, fn}`. Arity errors,
  aliases (`CONCATENATE`→`CONCAT`, `MODE`→`MODE.SNGL`) and the function list
  shown in help/docs all come from it, and `test_formula.js` can assert that
  every registered function has at least one test. Split functions into
  modules under `sheets/formula/` (`fn_text.js`, `fn_math.js`, …) that
  register into the table; each file must still load both from a `<script>`
  tag and under Node `require` (no build step, like the rest of the webapps).
- **Excel prefixes.** Go reader strips `_xlfn.`, `_xlfn._xlws.`, `_xlws.` and
  `_xlpm.` when importing formulas; the writer adds them back for the
  functions that need them (a fixed list in `mod/office`). The JS tokenizer
  also tolerates the prefixes (pasted formulas). Tests on both sides.
- **Argument coercion helpers.** One place that implements the spreadsheet
  rules we keep re-deriving: numbers from ranges vs. direct arguments, the
  `A`-variants (text counts as 0, TRUE as 1), date-text coercion, and
  "first error wins". `collect()` becomes one of these.
- **Criteria matcher.** `parseCriteria(value) -> (cellValue) => bool`
  covering comparison prefixes, `*`/`?` wildcards with `~` escapes,
  case-insensitive text, numbers-as-text, blanks (`""` vs `"<>"`), and dates.
- **Calling-cell context.** `evaluate(ast, ctx)` gets `ctx.self =
  {sheet, col, row}`; the calculator already knows it.
- **Golden tests against real files.** Commit small xlsx fixtures (saved from
  Excel and exported from Google Sheets so they carry cached values) under
  `sheets/testdata/`, and turn the one-off verification used for the Helpdesk
  workbook into a script: Go dumps the workbook to JSON, Node recalculates
  every formula and compares with the cached values. Each phase adds a
  fixture per function group.

## Phase 1A — Everyday functions (123) — done

The functions that show up in ordinary budgets, trackers and reports. All
scalar (no spilling), so they need only Phase 0.

- **Conditional aggregates (needs criteria matcher)** (10): `COUNTIF`, `COUNTIFS`, `SUMIF`, `SUMIFS`, `AVERAGEIF`, `AVERAGEIFS`, `MAXIFS`, `MINIFS`, `COUNTBLANK`, `COUNTUNIQUE`
- **Lookup & position (needs calling-cell context)** (8): `MATCH`, `INDEX`, `XLOOKUP`, `LOOKUP`, `ROW`, `COLUMN`, `ROWS`, `COLUMNS`
- **Text** (25): `LEFT`, `RIGHT`, `MID`, `FIND`, `SEARCH`, `SUBSTITUTE`, `REPLACE`, `REPT`, `PROPER`, `EXACT`, `VALUE`, `TEXT`, `TEXTJOIN`, `JOIN`, `CHAR`, `CODE`, `UNICHAR`, `UNICODE`, `CLEAN`, `T`, `FIXED`, `DOLLAR`, `REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`
- **Info** (16): `ISBLANK`, `ISNUMBER`, `ISTEXT`, `ISNONTEXT`, `ISLOGICAL`, `ISERROR`, `ISERR`, `ISNA`, `NA`, `N`, `TYPE`, `ERROR.TYPE`, `ISFORMULA`, `ISDATE`, `ISEMAIL`, `ISURL`
- **Logical** (4): `SWITCH`, `XOR`, `TRUE`, `FALSE`
- **Everyday math** (24): `ROUNDUP`, `ROUNDDOWN`, `TRUNC`, `MROUND`, `CEILING`, `FLOOR`, `SQRT`, `POWER`, `PRODUCT`, `QUOTIENT`, `SIGN`, `PI`, `EXP`, `LN`, `LOG`, `LOG10`, `RAND`, `RANDBETWEEN`, `SUBTOTAL`, `SUMSQ`, `EVEN`, `ODD`, `ISEVEN`, `ISODD`
- **Dates** (12): `TIME`, `DATEVALUE`, `TIMEVALUE`, `EDATE`, `EOMONTH`, `DAYS`, `DATEDIF`, `WEEKNUM`, `ISOWEEKNUM`, `NETWORKDAYS`, `WORKDAY`, `YEARFRAC`
- **Basic statistics** (9): `MEDIAN`, `MODE`, `LARGE`, `SMALL`, `RANK`, `STDEV`, `STDEVP`, `VAR`, `VARP`
- **Operator functions (thin wrappers)** (15): `ADD`, `MINUS`, `MULTIPLY`, `DIVIDE`, `POW`, `EQ`, `NE`, `GT`, `GTE`, `LT`, `LTE`, `UMINUS`, `UPLUS`, `UNARY_PERCENT`, `ISBETWEEN`

Notes:

- `SUBTOTAL` with codes 101–111 ignores rows the user hid; 1–11 include them;
  both skip rows a filter hides. `sheet.hiddenRows` and the filter map make
  this straightforward now.
- `XLOOKUP`/`INDEX` return a single value in this phase; returning a whole
  row or column arrives with spilling (Phase 3).
- `TEXT(value, format)` needs a number-format-code formatter (`"0.00"`,
  `"#,##0"`, `"yyyy-mm-dd"`, `"0%"`, sections `;`). Build it as a shared module:
  the grid can use it later for custom cell formats, which today are mapped to
  a few presets on xlsx import.
- `REGEX*` use JavaScript `RegExp`. Google uses RE2, so JS accepts some
  patterns Google rejects (lookbehind, backreferences) — document this rather
  than emulate RE2.
- `RAND`/`RANDBETWEEN` stay stable until the next recalculation (the memo
  already gives that); `NOW`/`TODAY` behave the same today.

## Phase 1B — Numbers, analysis & finance (165) — done

Still scalar and self-contained; this is volume work with a clear test story
(compare against the golden fixtures).

- **Trigonometry & angles** (23): `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN`, `ATAN2`, `SINH`, `COSH`, `TANH`, `ASINH`, `ACOSH`, `ATANH`, `COT`, `COTH`, `ACOT`, `ACOTH`, `CSC`, `CSCH`, `SEC`, `SECH`, `DEGREES`, `RADIANS`
- **Rounding & number theory** (16): `CEILING.MATH`, `CEILING.PRECISE`, `FLOOR.MATH`, `FLOOR.PRECISE`, `ISO.CEILING`, `COMBIN`, `COMBINA`, `FACT`, `FACTDOUBLE`, `GCD`, `LCM`, `MULTINOMIAL`, `SQRTPI`, `SERIESSUM`, `BASE`, `DECIMAL`
- **More dates** (4): `DAYS360`, `NETWORKDAYS.INTL`, `WORKDAY.INTL`, `EPOCHTODATE`
- **Descriptive statistics & regression** (52): `MODE.SNGL`, `RANK.EQ`, `RANK.AVG`, `PERCENTILE`, `PERCENTILE.INC`, `PERCENTILE.EXC`, `QUARTILE`, `QUARTILE.INC`, `QUARTILE.EXC`, `PERCENTRANK`, `PERCENTRANK.INC`, `PERCENTRANK.EXC`, `STDEV.S`, `STDEV.P`, `STDEVA`, `STDEVPA`, `VAR.S`, `VAR.P`, `VARA`, `VARPA`, `AVERAGEA`, `MAXA`, `MINA`, `AVERAGE.WEIGHTED`, `GEOMEAN`, `HARMEAN`, `AVEDEV`, `DEVSQ`, `TRIMMEAN`, `SKEW`, `SKEW.P`, `KURT`, `STANDARDIZE`, `CORREL`, `PEARSON`, `RSQ`, `SLOPE`, `INTERCEPT`, `FORECAST`, `FORECAST.LINEAR`, `STEYX`, `COVAR`, `COVARIANCE.P`, `COVARIANCE.S`, `FISHER`, `FISHERINV`, `PERMUT`, `PERMUTATIONA`, `PROB`, `SUMX2MY2`, `SUMX2PY2`, `SUMXMY2`
- **Personal & business finance** (27): `PMT`, `IPMT`, `PPMT`, `FV`, `PV`, `NPER`, `RATE`, `NPV`, `IRR`, `XNPV`, `XIRR`, `MIRR`, `CUMIPMT`, `CUMPRINC`, `EFFECT`, `NOMINAL`, `RRI`, `PDURATION`, `FVSCHEDULE`, `ISPMT`, `SLN`, `SYD`, `DB`, `DDB`, `VDB`, `DOLLARDE`, `DOLLARFR`
- **Database (criteria-range) functions** (12): `DSUM`, `DAVERAGE`, `DCOUNT`, `DCOUNTA`, `DGET`, `DMAX`, `DMIN`, `DPRODUCT`, `DSTDEV`, `DSTDEVP`, `DVAR`, `DVARP`
- **Number bases & bits** (19): `BIN2DEC`, `BIN2HEX`, `BIN2OCT`, `DEC2BIN`, `DEC2HEX`, `DEC2OCT`, `HEX2BIN`, `HEX2DEC`, `HEX2OCT`, `OCT2BIN`, `OCT2DEC`, `OCT2HEX`, `BITAND`, `BITOR`, `BITXOR`, `BITLSHIFT`, `BITRSHIFT`, `DELTA`, `GESTEP`
- **More text (incl. double-byte variants for CJK)** (12): `ROMAN`, `ARABIC`, `ASC`, `LENB`, `LEFTB`, `RIGHTB`, `MIDB`, `FINDB`, `SEARCHB`, `REPLACEB`, `ENCODEURL`, `CONVERT`

Notes:

- `IRR`, `XIRR`, `RATE` are iterative (Newton with a bisection fallback);
  match Excel's defaults (guess 0.1, 1e-7 tolerance, `#NUM!` when they do not
  converge).
- `LENB`/`LEFTB`/`MIDB`/… count double-byte characters as 2 and `ASC` turns
  full-width characters half-width — worth having for CJK users.
- `CONVERT` is a unit table (length, mass, temperature, …) plus SI prefixes.
- `D*` functions take a criteria *range* (header row + condition rows,
  AND across a row, OR across rows) built on the Phase 0 matcher.

## Phase 2 — References, names & typed results (14) — done

All of it shipped, plus the engine work below. Two notes: `INDEX` now
answers with a reference (so `A1:INDEX(...)` works) and dynamic-array
`XLOOKUP`/`INDEX` results still need Phase 3 to land in a plain cell;
hyperlinks are formula results (`HYPERLINK`), not a stored per-cell property,
so nothing new is needed in the xlsx writer for them.

Engine:

- **Reference values.** A value kind `Ref {sheet, c1, r1, c2, r2}` that
  functions can return; the range operator accepts it (`A1:INDEX(...)`), and
  it becomes a value when used as one. `INDEX` gains its reference form here.
- **Array literals** `{1,2;3,4}` in the parser (usable inside SUMPRODUCT,
  VLOOKUP, CHOOSE even before spilling).
- **Whole-column/row references** `A:A`, `2:2`, `A2:A` (bounded to the used
  range so they stay cheap).
- **Defined names.** Import `<definedName>` from xlsx (and write them back),
  a `names` map on the workbook, a Name Manager dialog, and name tokens in
  the parser. Helps real files such as the Helpdesk export.
- **Dependency tracking for volatile functions.** `OFFSET`/`INDIRECT`/`RAND`/
  `TODAY` and friends now carry `volatile: true` in the registry, which is
  the marker a dependency graph will need. The graph itself is still future
  work: every edit continues to recompute what is on screen.
- **Result formats.** Functions may return a display-format hint (date,
  time, percent, currency) that applies when the cell has no explicit
  format: `DATE`, `TODAY`, `TIME`, `EDATE`, `TO_*`.
- **Hyperlink cells.** `HYPERLINK(url, label)` renders as a link in the grid
  (Ctrl+click to open, http/https only), round-trips to xlsx.

- **Reference-returning & sheet info** (8): `OFFSET`, `INDIRECT`, `ADDRESS`, `ISREF`, `CELL`, `FORMULATEXT`, `SHEET`, `SHEETS`
- **Typed results (value + display format)** (5): `TO_DATE`, `TO_PERCENT`, `TO_DOLLARS`, `TO_TEXT`, `TO_PURE_NUMBER`
- **Links** (1): `HYPERLINK`

## Phase 3 — Dynamic arrays / spilling (29) — done

All 29 shipped, plus Excel's `TAKE`, `DROP`, `EXPAND`, `TEXTSPLIT` and
`SINGLE` (the `@` operator). Differences from the plan below: a blocked
spill is `#SPILL!` (Excel's name, clearer than reusing `#REF!`), and an
empty `FILTER` is Excel's `#CALC!`. How it works is written up in the Office
README ("Spilling"). Not done: the `A1#` spill-range reference.

Engine:

- A formula whose result is an array spills down/right from its cell. The
  calculator keeps a spill map (`anchor -> rows x cols`), spilled cells show
  values but stay empty in the model, and a blocked spill is `#REF!` with the
  message "Array result was not expanded because it would overwrite data"
  (Sheets) — Excel calls it `#SPILL!`; read both.
- The grid shows the spill range outline when the anchor is selected;
  editing a spilled cell edits nothing (as in Sheets).
- `ARRAYFORMULA(...)` switches its argument into array context; import of
  Excel CSE arrays (`<f t="array" ref="...">`) maps onto the same mechanism.
- xlsx: Excel stores dynamic-array formulas with `cm="1"` metadata; write it
  so Excel does not show them as legacy CSE formulas.

- **Filtering & sorting** (4): `FILTER`, `SORT`, `SORTN`, `UNIQUE`
- **Array generation & reshaping** (15): `SEQUENCE`, `RANDARRAY`, `SPLIT`, `TRANSPOSE`, `FLATTEN`, `TOCOL`, `TOROW`, `HSTACK`, `VSTACK`, `CHOOSECOLS`, `CHOOSEROWS`, `WRAPCOLS`, `WRAPROWS`, `ARRAY_CONSTRAIN`, `ARRAYFORMULA`
- **Matrix & array statistics** (10): `MMULT`, `MINVERSE`, `MDETERM`, `MUNIT`, `FREQUENCY`, `MODE.MULT`, `TREND`, `GROWTH`, `LINEST`, `LOGEST`

## Phase 4 — LET & LAMBDA (8)

Engine: lexical scopes for names in `evaluate`, lambda values (closures over
the AST), and invoking them from the helper functions. Depends on Phase 2
names and Phase 3 arrays. Excel writes parameters as `_xlpm.name` (Phase 0
prefix handling).

- **Names & functions** (8): `LET`, `LAMBDA`, `MAP`, `REDUCE`, `SCAN`, `BYROW`, `BYCOL`, `MAKEARRAY`

## Phase 5 — Scientific & specialist long tail (126)

Build a small numerics module first (`erf`, `gammaln`, regularized incomplete
gamma and beta, their inverses via Newton/bisection); the distribution
functions are then thin wrappers. Write it ourselves or vendor an MIT library
such as jStat after checking its licence (repo rule 3 spirit: MIT/BSD/Apache
only); do not add a runtime CDN dependency.

- **Probability distributions & tests** (74): `NORM.DIST`, `NORM.INV`, `NORM.S.DIST`, `NORM.S.INV`, `NORMDIST`, `NORMINV`, `NORMSDIST`, `NORMSINV`, `PHI`, `GAUSS`, `T.DIST`, `T.DIST.2T`, `T.DIST.RT`, `T.INV`, `T.INV.2T`, `T.TEST`, `TDIST`, `TINV`, `TTEST`, `CHISQ.DIST`, `CHISQ.DIST.RT`, `CHISQ.INV`, `CHISQ.INV.RT`, `CHISQ.TEST`, `CHIDIST`, `CHIINV`, `CHITEST`, `F.DIST`, `F.DIST.RT`, `F.INV`, `F.INV.RT`, `F.TEST`, `FDIST`, `FINV`, `FTEST`, `BINOM.DIST`, `BINOM.INV`, `BINOMDIST`, `CRITBINOM`, `NEGBINOM.DIST`, `NEGBINOMDIST`, `HYPGEOM.DIST`, `HYPGEOMDIST`, `POISSON`, `POISSON.DIST`, `EXPON.DIST`, `EXPONDIST`, `GAMMA`, `GAMMA.DIST`, `GAMMA.INV`, `GAMMADIST`, `GAMMAINV`, `GAMMALN`, `GAMMALN.PRECISE`, `BETA.DIST`, `BETA.INV`, `BETADIST`, `BETAINV`, `LOGNORM.DIST`, `LOGNORM.INV`, `LOGNORMDIST`, `LOGINV`, `WEIBULL`, `WEIBULL.DIST`, `CONFIDENCE`, `CONFIDENCE.NORM`, `CONFIDENCE.T`, `MARGINOFERROR`, `Z.TEST`, `ZTEST`, `ERF`, `ERF.PRECISE`, `ERFC`, `ERFC.PRECISE`
- **Complex numbers** (29): `COMPLEX`, `IMREAL`, `IMAGINARY`, `IMABS`, `IMARGUMENT`, `IMCONJUGATE`, `IMSUM`, `IMSUB`, `IMPRODUCT`, `IMDIV`, `IMPOWER`, `IMSQRT`, `IMEXP`, `IMLN`, `IMLOG10`, `IMLOG2`, `IMLOG`, `IMSIN`, `IMCOS`, `IMTAN`, `IMSINH`, `IMCOSH`, `IMTANH`, `IMSEC`, `IMSECH`, `IMCSC`, `IMCSCH`, `IMCOT`, `IMCOTH`
- **Bonds & securities** (23): `ACCRINT`, `ACCRINTM`, `AMORLINC`, `COUPDAYBS`, `COUPDAYS`, `COUPDAYSNC`, `COUPNCD`, `COUPNUM`, `COUPPCD`, `DISC`, `DURATION`, `MDURATION`, `INTRATE`, `PRICE`, `PRICEDISC`, `PRICEMAT`, `RECEIVED`, `TBILLEQ`, `TBILLPRICE`, `TBILLYIELD`, `YIELD`, `YIELDDISC`, `YIELDMAT`

## Not planned (13)

- **Google services & AI** (4): `AI`, `GOOGLEFINANCE`, `GOOGLETRANSLATE`, `DETECTLANGUAGE`
- **Web imports (need a server-side fetcher)** (5): `IMPORTDATA`, `IMPORTFEED`, `IMPORTHTML`, `IMPORTRANGE`, `IMPORTXML`
- **In-cell graphics** (2): `SPARKLINE`, `IMAGE`
- **Query language & pivots** (2): `QUERY`, `GETPIVOTDATA`

Why:

- **Google services & AI** need Google's back end.
- **Web imports** would have to fetch URLs server-side (the browser blocks
  cross-origin reads), which means an AGI endpoint with SSRF protection,
  caching and rate limits, and nothing at all in the standalone web edition.
  If wanted later, an `IMPORTRANGE` that reads another `.xlsx` in the user's
  own storage is the most useful and safest variant.
- **In-cell graphics** (`SPARKLINE`, `IMAGE`) are grid features first; revisit
  with in-cell rendering.
- **`QUERY`** is Google's own query language (a SQL-like parser + planner)
  and much larger than any single function here; reconsider after Phase 3.
  **`GETPIVOTDATA`** needs live pivot tables; ours write static cells.

## Excel functions to add alongside (not in Google's list)

Files come from Excel as often as from Google, and these appear in modern
workbooks: `XMATCH`, `TAKE`, `DROP`, `EXPAND`, `TEXTBEFORE`, `TEXTAFTER`,
`TEXTSPLIT`, `NUMBERVALUE`, `AGGREGATE`. `XMATCH`/`NUMBERVALUE`/
`TEXTBEFORE`/`TEXTAFTER` shipped with Phase 1A; `AGGREGATE` is still to add next to `SUBTOTAL`;
`TAKE`/`DROP`/`EXPAND`/`TEXTSPLIT` shipped with Phase 3.

## Suggested order and size

| Phase | Functions | Engine work | Size |
|---|---|---|---|
| 0 (done) | — | registry, prefixes, coercion, criteria, self context, golden tests | M |
| 1A (done) | 123 | TEXT format codes | L (volume) |
| 1B (done) | 165 | IRR/RATE solvers | L (volume) |
| 2 (done) | 14 | refs, array literals, A:A, names, result formats, links | L |
| 3 (done) | 29 | spill map, grid outline, xlsx array metadata | L |
| 4 | 8 | scopes, closures | M |
| 5 | 126 | numerics module | L (volume) |

Phases 0 → 1A give the largest real-world gain: after them most household
and business workbooks from Excel or Google open without `#NAME?`. Keep
[`README.md`](../README.md) ("Sheets formula engine") and the function list in
`formula.js` in sync as each phase lands.

## Appendix — every missing function

Syntax as listed by Google.

| Function | Google category | Phase | Syntax |
|---|---|---|---|
| `ACCRINT` | Financial | Phase 5 | `ACCRINT(issue, first_payment, settlement, rate, redemption, frequency, [day_count_convention])` |
| `ACCRINTM` | Financial | Phase 5 | `ACCRINTM(issue, maturity, rate, [redemption], [day_count_convention])` |
| `ACOS` | Math | Phase 1B (done) | `ACOS(value)` |
| `ACOSH` | Math | Phase 1B (done) | `ACOSH(value)` |
| `ACOT` | Math | Phase 1B (done) | `ACOT(value)` |
| `ACOTH` | Math | Phase 1B (done) | `ACOTH(value)` |
| `ADD` | Operator | Phase 1A (done) | `ADD(value1, value2)` |
| `ADDRESS` | Lookup | Phase 2 (done) | `ADDRESS(row, column, [absolute_relative_mode], [use_a1_notation], [sheet])` |
| `AI` | AI | Not planned | `AI() or Gemini()` |
| `AMORLINC` | Financial | Phase 5 | `AMORLINC(cost, purchase_date, first_period_end, salvage, period, rate, [basis])` |
| `ARABIC` | Text | Phase 1B (done) | `ARABIC(roman_numeral)` |
| `ARRAYFORMULA` | Google | Phase 3 (done) | `ARRAYFORMULA(array_formula)` |
| `ARRAY_CONSTRAIN` | Array | Phase 3 (done) | `ARRAY_CONSTRAIN(input_range, num_rows, num_cols)` |
| `ASC` | Text | Phase 1B (done) | `ASC(text)` |
| `ASIN` | Math | Phase 1B (done) | `ASIN(value)` |
| `ASINH` | Math | Phase 1B (done) | `ASINH(value)` |
| `ATAN` | Math | Phase 1B (done) | `ATAN(value)` |
| `ATAN2` | Math | Phase 1B (done) | `ATAN2(x, y)` |
| `ATANH` | Math | Phase 1B (done) | `ATANH(value)` |
| `AVEDEV` | Statistical | Phase 1B (done) | `AVEDEV(value1, [value2, ...])` |
| `AVERAGE.WEIGHTED` | Statistical | Phase 1B (done) | `AVERAGE.WEIGHTED(values, weights, [additional values], [additional weights])` |
| `AVERAGEA` | Statistical | Phase 1B (done) | `AVERAGEA(value1, [value2, ...])` |
| `AVERAGEIF` | Statistical | Phase 1A (done) | `AVERAGEIF(criteria_range, criterion, [average_range])` |
| `AVERAGEIFS` | Statistical | Phase 1A (done) | `AVERAGEIFS(average_range, criteria_range1, criterion1, [criteria_range2, criterion2, ...])` |
| `BASE` | Math | Phase 1B (done) | `BASE(value, base, [min_length])` |
| `BETA.DIST` | Statistical | Phase 5 | `BETA.DIST(value, alpha, beta, cumulative, lower_bound, upper_bound)` |
| `BETA.INV` | Statistical | Phase 5 | `BETA.INV(probability, alpha, beta, lower_bound, upper_bound)` |
| `BETADIST` | Statistical | Phase 5 | `BETADIST(value, alpha, beta, lower_bound, upper_bound)` |
| `BETAINV` | Statistical | Phase 5 | `BETAINV(probability, alpha, beta, lower_bound, upper_bound)` |
| `BIN2DEC` | Engineering | Phase 1B (done) | `BIN2DEC(signed_binary_number)` |
| `BIN2HEX` | Engineering | Phase 1B (done) | `BIN2HEX(signed_binary_number, [significant_digits])` |
| `BIN2OCT` | Engineering | Phase 1B (done) | `BIN2OCT(signed_binary_number, [significant_digits])` |
| `BINOM.DIST` | Statistical | Phase 5 | `BINOM.DIST(num_successes, num_trials, prob_success, cumulative)` |
| `BINOM.INV` | Statistical | Phase 5 | `BINOM.INV(num_trials, prob_success, target_prob)` |
| `BINOMDIST` | Statistical | Phase 5 | `BINOMDIST(num_successes, num_trials, prob_success, cumulative)` |
| `BITAND` | Engineering | Phase 1B (done) | `BITAND(value1, value2)` |
| `BITLSHIFT` | Engineering | Phase 1B (done) | `BITLSHIFT(value, shift_amount)` |
| `BITOR` | Engineering | Phase 1B (done) | `BITOR(value1, value2)` |
| `BITRSHIFT` | Engineering | Phase 1B (done) | `BITRSHIFT(value, shift_amount)` |
| `BITXOR` | Engineering | Phase 1B (done) | `BITXOR(value1, value2)` |
| `BYCOL` | Array | Phase 4 | `BYCOL(array_or_range, LAMBDA)` |
| `BYROW` | Array | Phase 4 | `BYROW(array_or_range, LAMBDA)` |
| `CEILING` | Math | Phase 1A (done) | `CEILING(value, [factor])` |
| `CEILING.MATH` | Math | Phase 1B (done) | `CEILING.MATH(number, [significance], [mode])` |
| `CEILING.PRECISE` | Math | Phase 1B (done) | `CEILING.PRECISE(number, [significance])` |
| `CELL` | Info | Phase 2 (done) | `CELL(info_type, reference)` |
| `CHAR` | Text | Phase 1A (done) | `CHAR(table_number)` |
| `CHIDIST` | Statistical | Phase 5 | `CHIDIST(x, degrees_freedom)` |
| `CHIINV` | Statistical | Phase 5 | `CHIINV(probability, degrees_freedom)` |
| `CHISQ.DIST` | Statistical | Phase 5 | `CHISQ.DIST(x, degrees_freedom, cumulative)` |
| `CHISQ.DIST.RT` | Statistical | Phase 5 | `CHISQ.DIST.RT(x, degrees_freedom)` |
| `CHISQ.INV` | Statistical | Phase 5 | `CHISQ.INV(probability, degrees_freedom)` |
| `CHISQ.INV.RT` | Statistical | Phase 5 | `CHISQ.INV.RT(probability, degrees_freedom)` |
| `CHISQ.TEST` | Statistical | Phase 5 | `CHISQ.TEST(observed_range, expected_range)` |
| `CHITEST` | Statistical | Phase 5 | `CHITEST(observed_range, expected_range)` |
| `CHOOSECOLS` | Array | Phase 3 (done) | `CHOOSECOLS(array, col_num1, [col_num2])` |
| `CHOOSEROWS` | Array | Phase 3 (done) | `CHOOSEROWS(array, row_num1, [row_num2])` |
| `CLEAN` | Text | Phase 1A (done) | `CLEAN(text)` |
| `CODE` | Text | Phase 1A (done) | `CODE(string)` |
| `COLUMN` | Lookup | Phase 1A (done) | `COLUMN([cell_reference])` |
| `COLUMNS` | Lookup | Phase 1A (done) | `COLUMNS(range)` |
| `COMBIN` | Math | Phase 1B (done) | `COMBIN(n, k)` |
| `COMBINA` | Math | Phase 1B (done) | `COMBINA(n, k)` |
| `COMPLEX` | Engineering | Phase 5 | `COMPLEX(real_part, imaginary_part, [suffix])` |
| `CONFIDENCE` | Statistical | Phase 5 | `CONFIDENCE(alpha, standard_deviation, pop_size)` |
| `CONFIDENCE.NORM` | Statistical | Phase 5 | `CONFIDENCE.NORM(alpha, standard_deviation, pop_size)` |
| `CONFIDENCE.T` | Statistical | Phase 5 | `CONFIDENCE.T(alpha, standard_deviation, size)` |
| `CONVERT` | Parser | Phase 1B (done) | `CONVERT(value, start_unit, end_unit)` |
| `CORREL` | Statistical | Phase 1B (done) | `CORREL(data_y, data_x)` |
| `COS` | Math | Phase 1B (done) | `COS(angle)` |
| `COSH` | Math | Phase 1B (done) | `COSH(value)` |
| `COT` | Math | Phase 1B (done) | `COT(angle)` |
| `COTH` | Math | Phase 1B (done) | `COTH(value)` |
| `COUNTBLANK` | Math | Phase 1A (done) | `COUNTBLANK(range)` |
| `COUNTIF` | Math | Phase 1A (done) | `COUNTIF(range, criterion)` |
| `COUNTIFS` | Math | Phase 1A (done) | `COUNTIFS(criteria_range1, criterion1, [criteria_range2, criterion2, ...])` |
| `COUNTUNIQUE` | Math | Phase 1A (done) | `COUNTUNIQUE(value1, [value2, ...])` |
| `COUPDAYBS` | Financial | Phase 5 | `COUPDAYBS(settlement, maturity, frequency, [day_count_convention])` |
| `COUPDAYS` | Financial | Phase 5 | `COUPDAYS(settlement, maturity, frequency, [day_count_convention])` |
| `COUPDAYSNC` | Financial | Phase 5 | `COUPDAYSNC(settlement, maturity, frequency, [day_count_convention])` |
| `COUPNCD` | Financial | Phase 5 | `COUPNCD(settlement, maturity, frequency, [day_count_convention])` |
| `COUPNUM` | Financial | Phase 5 | `COUPNUM(settlement, maturity, frequency, [day_count_convention])` |
| `COUPPCD` | Financial | Phase 5 | `COUPPCD(settlement, maturity, frequency, [day_count_convention])` |
| `COVAR` | Statistical | Phase 1B (done) | `COVAR(data_y, data_x)` |
| `COVARIANCE.P` | Statistical | Phase 1B (done) | `COVARIANCE.P(data_y, data_x)` |
| `COVARIANCE.S` | Statistical | Phase 1B (done) | `COVARIANCE.S(data_y, data_x)` |
| `CRITBINOM` | Statistical | Phase 5 | `CRITBINOM(num_trials, prob_success, target_prob)` |
| `CSC` | Math | Phase 1B (done) | `CSC(angle)` |
| `CSCH` | Math | Phase 1B (done) | `CSCH(value)` |
| `CUMIPMT` | Financial | Phase 1B (done) | `CUMIPMT(rate, number_of_periods, present_value, first_period, last_period, end_or_beginning)` |
| `CUMPRINC` | Financial | Phase 1B (done) | `CUMPRINC(rate, number_of_periods, present_value, first_period, last_period, end_or_beginning)` |
| `DATEDIF` | Date | Phase 1A (done) | `DATEDIF(start_date, end_date, unit)` |
| `DATEVALUE` | Date | Phase 1A (done) | `DATEVALUE(date_string)` |
| `DAVERAGE` | Database | Phase 1B (done) | `DAVERAGE(database, field, criteria)` |
| `DAYS` | Date | Phase 1A (done) | `DAYS(end_date, start_date)` |
| `DAYS360` | Date | Phase 1B (done) | `DAYS360(start_date, end_date, [method])` |
| `DB` | Financial | Phase 1B (done) | `DB(cost, salvage, life, period, [month])` |
| `DCOUNT` | Database | Phase 1B (done) | `DCOUNT(database, field, criteria)` |
| `DCOUNTA` | Database | Phase 1B (done) | `DCOUNTA(database, field, criteria)` |
| `DDB` | Financial | Phase 1B (done) | `DDB(cost, salvage, life, period, [factor])` |
| `DEC2BIN` | Engineering | Phase 1B (done) | `DEC2BIN(decimal_number, [significant_digits])` |
| `DEC2HEX` | Engineering | Phase 1B (done) | `DEC2HEX(decimal_number, [significant_digits])` |
| `DEC2OCT` | Engineering | Phase 1B (done) | `DEC2OCT(decimal_number, [significant_digits])` |
| `DECIMAL` | Math | Phase 1B (done) | `DECIMAL(value, base)` |
| `DEGREES` | Math | Phase 1B (done) | `DEGREES(angle)` |
| `DELTA` | Engineering | Phase 1B (done) | `DELTA(number1, [number2])` |
| `DETECTLANGUAGE` | Google | Not planned | `DETECTLANGUAGE(text_or_range)` |
| `DEVSQ` | Statistical | Phase 1B (done) | `DEVSQ(value1, value2)` |
| `DGET` | Database | Phase 1B (done) | `DGET(database, field, criteria)` |
| `DISC` | Financial | Phase 5 | `DISC(settlement, maturity, price, redemption, [day_count_convention])` |
| `DIVIDE` | Operator | Phase 1A (done) | `DIVIDE(dividend, divisor)` |
| `DMAX` | Database | Phase 1B (done) | `DMAX(database, field, criteria)` |
| `DMIN` | Database | Phase 1B (done) | `DMIN(database, field, criteria)` |
| `DOLLAR` | Text | Phase 1A (done) | `DOLLAR(number, [number_of_places])` |
| `DOLLARDE` | Financial | Phase 1B (done) | `DOLLARDE(fractional_price, unit)` |
| `DOLLARFR` | Financial | Phase 1B (done) | `DOLLARFR(decimal_price, unit)` |
| `DPRODUCT` | Database | Phase 1B (done) | `DPRODUCT(database, field, criteria)` |
| `DSTDEV` | Database | Phase 1B (done) | `DSTDEV(database, field, criteria)` |
| `DSTDEVP` | Database | Phase 1B (done) | `DSTDEVP(database, field, criteria)` |
| `DSUM` | Database | Phase 1B (done) | `DSUM(database, field, criteria)` |
| `DURATION` | Financial | Phase 5 | `DURATION(settlement, maturity, rate, yield, frequency, [day_count_convention]) .` |
| `DVAR` | Database | Phase 1B (done) | `DVAR(database, field, criteria)` |
| `DVARP` | Database | Phase 1B (done) | `DVARP(database, field, criteria)` |
| `EDATE` | Date | Phase 1A (done) | `EDATE(start_date, months)` |
| `EFFECT` | Financial | Phase 1B (done) | `EFFECT(nominal_rate, periods_per_year)` |
| `ENCODEURL` | Web | Phase 1B (done) | `ENCODEURL(text)` |
| `EOMONTH` | Date | Phase 1A (done) | `EOMONTH(start_date, months)` |
| `EPOCHTODATE` | Date | Phase 1B (done) | `EPOCHTODATE(timestamp, [unit])` |
| `EQ` | Operator | Phase 1A (done) | `EQ(value1, value2)` |
| `ERF` | Engineering | Phase 5 | `ERF(lower_bound, [upper_bound])` |
| `ERF.PRECISE` | Engineering | Phase 5 | `ERF.PRECISE(lower_bound, [upper_bound])` |
| `ERFC` | Math | Phase 5 | `ERFC(z)` |
| `ERFC.PRECISE` | Math | Phase 5 | `ERFC.PRECISE(z)` |
| `ERROR.TYPE` | Info | Phase 1A (done) | `ERROR.TYPE(reference)` |
| `EVEN` | Math | Phase 1A (done) | `EVEN(value)` |
| `EXACT` | Text | Phase 1A (done) | `EXACT(string1, string2)` |
| `EXP` | Math | Phase 1A (done) | `EXP(exponent)` |
| `EXPON.DIST` | Statistical | Phase 5 | `EXPON.DIST(x, LAMBDA, cumulative)` |
| `EXPONDIST` | Statistical | Phase 5 | `EXPONDIST(x, LAMBDA, cumulative)` |
| `F.DIST` | Statistical | Phase 5 | `F.DIST(x, degrees_freedom1, degrees_freedom2, cumulative)` |
| `F.DIST.RT` | Statistical | Phase 5 | `F.DIST.RT(x, degrees_freedom1, degrees_freedom2)` |
| `F.INV` | Statistical | Phase 5 | `F.INV(probability, degrees_freedom1, degrees_freedom2)` |
| `F.INV.RT` | Statistical | Phase 5 | `F.INV.RT(probability, degrees_freedom1, degrees_freedom2)` |
| `F.TEST` | Statistical | Phase 5 | `F.TEST(range1, range2)` |
| `FACT` | Math | Phase 1B (done) | `FACT(value)` |
| `FACTDOUBLE` | Math | Phase 1B (done) | `FACTDOUBLE(value)` |
| `FALSE` | Logical | Phase 1A (done) | `FALSE()` |
| `FDIST` | Statistical | Phase 5 | `FDIST(x, degrees_freedom1, degrees_freedom2)` |
| `FILTER` | Filter | Phase 3 (done) | `FILTER(range, condition1, [condition2])` |
| `FIND` | Text | Phase 1A (done) | `FIND(search_for, text_to_search, [starting_at])` |
| `FINDB` | Text | Phase 1B (done) | `FINDB(search_for, text_to_search, [starting_at])` |
| `FINV` | Statistical | Phase 5 | `FINV(probability, degrees_freedom1, degrees_freedom2)` |
| `FISHER` | Statistical | Phase 1B (done) | `FISHER(value)` |
| `FISHERINV` | Statistical | Phase 1B (done) | `FISHERINV(value)` |
| `FIXED` | Text | Phase 1A (done) | `FIXED(number, [number_of_places], [suppress_separator])` |
| `FLATTEN` | Array | Phase 3 (done) | `FLATTEN(range1,[range2,...])` |
| `FLOOR` | Math | Phase 1A (done) | `FLOOR(value, [factor])` |
| `FLOOR.MATH` | Math | Phase 1B (done) | `FLOOR.MATH(number, [significance], [mode])` |
| `FLOOR.PRECISE` | Math | Phase 1B (done) | `FLOOR.PRECISE(number, [significance])` |
| `FORECAST` | Statistical | Phase 1B (done) | `FORECAST(x, data_y, data_x)` |
| `FORECAST.LINEAR` | Statistical | Phase 1B (done) | `FORECAST.LINEAR(x, data_y, data_x)` |
| `FORMULATEXT` | Lookup | Phase 2 (done) | `FORMULATEXT(cell)` |
| `FREQUENCY` | Array | Phase 3 (done) | `FREQUENCY(data, classes)` |
| `FTEST` | Statistical | Phase 5 | `FTEST(range1, range2)` |
| `FV` | Financial | Phase 1B (done) | `FV(rate, number_of_periods, payment_amount, [present_value], [end_or_beginning])` |
| `FVSCHEDULE` | Financial | Phase 1B (done) | `FVSCHEDULE(principal, rate_schedule)` |
| `GAMMA` | Statistical | Phase 5 | `GAMMA(number)` |
| `GAMMA.DIST` | Statistical | Phase 5 | `GAMMA.DIST(x, alpha, beta, cumulative)` |
| `GAMMA.INV` | Statistical | Phase 5 | `GAMMA.INV(probability, alpha, beta)` |
| `GAMMADIST` | Statistical | Phase 5 | `GAMMADIST(x, alpha, beta, cumulative)` |
| `GAMMAINV` | Statistical | Phase 5 | `GAMMAINV(probability, alpha, beta)` |
| `GAMMALN` | Math | Phase 5 | `GAMMALN(value)` |
| `GAMMALN.PRECISE` | Math | Phase 5 | `GAMMALN.PRECISE(value)` |
| `GAUSS` | Statistical | Phase 5 | `GAUSS(z)` |
| `GCD` | Math | Phase 1B (done) | `GCD(value1, value2)` |
| `GEOMEAN` | Statistical | Phase 1B (done) | `GEOMEAN(value1, value2)` |
| `GESTEP` | Engineering | Phase 1B (done) | `GESTEP(value, [step])` |
| `GETPIVOTDATA` | Lookup | Not planned | `GETPIVOTDATA(value_name, any_pivot_table_cell, [original_column, ...], [pivot_item, ...]` |
| `GOOGLEFINANCE` | Google | Not planned | `GOOGLEFINANCE(ticker, [attribute], [start_date], [end_date\|num_days], [interval])` |
| `GOOGLETRANSLATE` | Google | Not planned | `GOOGLETRANSLATE(text, [source_language], [target_language])` |
| `GROWTH` | Array | Phase 3 (done) | `GROWTH(known_data_y, [known_data_x], [new_data_x], [b])` |
| `GT` | Operator | Phase 1A (done) | `GT(value1, value2)` |
| `GTE` | Operator | Phase 1A (done) | `GTE(value1, value2)` |
| `HARMEAN` | Statistical | Phase 1B (done) | `HARMEAN(value1, value2)` |
| `HEX2BIN` | Engineering | Phase 1B (done) | `HEX2BIN(signed_hexadecimal_number, [significant_digits])` |
| `HEX2DEC` | Engineering | Phase 1B (done) | `HEX2DEC(signed_hexadecimal_number)` |
| `HEX2OCT` | Engineering | Phase 1B (done) | `HEX2OCT(signed_hexadecimal_number, significant_digits)` |
| `HSTACK` | Array | Phase 3 (done) | `HSTACK(range1; [range2, …])` |
| `HYPERLINK` | Web | Phase 2 (done) | `HYPERLINK(url, [link_label])` |
| `HYPGEOM.DIST` | Statistical | Phase 5 | `HYPGEOM.DIST(num_successes, num_draws, successes_in_pop, pop_size)` |
| `HYPGEOMDIST` | Statistical | Phase 5 | `HYPGEOMDIST(num_successes, num_draws, successes_in_pop, pop_size)` |
| `IMABS` | Engineering | Phase 5 | `IMABS(number)` |
| `IMAGE` | Google | Not planned | `IMAGE(url, [mode], [height], [width])` |
| `IMAGINARY` | Engineering | Phase 5 | `IMAGINARY(complex_number)` |
| `IMARGUMENT` | Engineering | Phase 5 | `IMARGUMENT(number)` |
| `IMCONJUGATE` | Engineering | Phase 5 | `IMCONJUGATE(number)` |
| `IMCOS` | Engineering | Phase 5 | `IMCOS(number)` |
| `IMCOSH` | Engineering | Phase 5 | `IMCOSH(number)` |
| `IMCOT` | Engineering | Phase 5 | `IMCOT(number)` |
| `IMCOTH` | Engineering | Phase 5 | `IMCOTH(number)` |
| `IMCSC` | Engineering | Phase 5 | `IMCSC(number)` |
| `IMCSCH` | Engineering | Phase 5 | `IMCSCH(number)` |
| `IMDIV` | Engineering | Phase 5 | `IMDIV(dividend, divisor)` |
| `IMEXP` | Engineering | Phase 5 | `IMEXP(exponent)` |
| `IMLN` | Math | Phase 5 | `IMLN(complex_value)` |
| `IMLOG` | Engineering | Phase 5 | `IMLOG(value, base)` |
| `IMLOG10` | Engineering | Phase 5 | `IMLOG10(value)` |
| `IMLOG2` | Engineering | Phase 5 | `IMLOG2(value)` |
| `IMPORTDATA` | Web | Not planned | `IMPORTDATA(url)` |
| `IMPORTFEED` | Web | Not planned | `IMPORTFEED(url, [query], [headers], [num_items])` |
| `IMPORTHTML` | Web | Not planned | `IMPORTHTML(url, query, index)` |
| `IMPORTRANGE` | Web | Not planned | `IMPORTRANGE(spreadsheet_url, range_string)` |
| `IMPORTXML` | Web | Not planned | `IMPORTXML(url, xpath_query)` |
| `IMPOWER` | Math | Phase 5 | `IMPOWER(complex_base, exponent)` |
| `IMPRODUCT` | Engineering | Phase 5 | `IMPRODUCT(factor1, [factor2, ...])` |
| `IMREAL` | Engineering | Phase 5 | `IMREAL(complex_number)` |
| `IMSEC` | Engineering | Phase 5 | `IMSEC(number)` |
| `IMSECH` | Engineering | Phase 5 | `IMSECH(number)` |
| `IMSIN` | Engineering | Phase 5 | `IMSIN (number)` |
| `IMSINH` | Engineering | Phase 5 | `IMSINH(number)` |
| `IMSQRT` | Math | Phase 5 | `IMSQRT(complex_number)` |
| `IMSUB` | Engineering | Phase 5 | `IMSUB(first_number, second_number)` |
| `IMSUM` | Engineering | Phase 5 | `IMSUM(value1, [value2, ...])` |
| `IMTAN` | Engineering | Phase 5 | `IMTAN(number)` |
| `IMTANH` | Engineering | Phase 5 | `IMTANH(number)` |
| `INDEX` | Lookup | Phase 1A (done) | `INDEX(reference, [row], [column])` |
| `INDIRECT` | Lookup | Phase 2 (done) | `INDIRECT(cell_reference_as_string, [is_A1_notation])` |
| `INTERCEPT` | Statistical | Phase 1B (done) | `INTERCEPT(data_y, data_x)` |
| `INTRATE` | Financial | Phase 5 | `INTRATE(buy_date, sell_date, buy_price, sell_price, [day_count_convention])` |
| `IPMT` | Financial | Phase 1B (done) | `IPMT(rate, period, number_of_periods, present_value, [future_value], [end_or_beginning])` |
| `IRR` | Financial | Phase 1B (done) | `IRR(cashflow_amounts, [rate_guess])` |
| `ISBETWEEN` | Operator | Phase 1A (done) | `ISBETWEEN(value_to_compare, lower_value, upper_value, lower_value_is_inclusive, upper_value_is_inclusive)` |
| `ISBLANK` | Info | Phase 1A (done) | `ISBLANK(value)` |
| `ISDATE` | Info | Phase 1A (done) | `ISDATE(value)` |
| `ISEMAIL` | Info | Phase 1A (done) | `ISEMAIL(value)` |
| `ISERR` | Info | Phase 1A (done) | `ISERR(value)` |
| `ISERROR` | Info | Phase 1A (done) | `ISERROR(value)` |
| `ISEVEN` | Math | Phase 1A (done) | `ISEVEN(value)` |
| `ISFORMULA` | Info | Phase 1A (done) | `ISFORMULA(cell)` |
| `ISLOGICAL` | Info | Phase 1A (done) | `ISLOGICAL(value)` |
| `ISNA` | Info | Phase 1A (done) | `ISNA(value)` |
| `ISNONTEXT` | Info | Phase 1A (done) | `ISNONTEXT(value)` |
| `ISNUMBER` | Info | Phase 1A (done) | `ISNUMBER(value)` |
| `ISO.CEILING` | Math | Phase 1B (done) | `ISO.CEILING(number, [significance])` |
| `ISODD` | Math | Phase 1A (done) | `ISODD(value)` |
| `ISOWEEKNUM` | Date | Phase 1A (done) | `ISOWEEKNUM(date)` |
| `ISPMT` | Financial | Phase 1B (done) | `ISPMT(rate, period, number_of_periods, present_value)` |
| `ISREF` | Info | Phase 2 (done) | `ISREF(value)` |
| `ISTEXT` | Info | Phase 1A (done) | `ISTEXT(value)` |
| `ISURL` | Web | Phase 1A (done) | `ISURL(value)` |
| `JOIN` | Text | Phase 1A (done) | `JOIN(delimiter, value_or_array1, [value_or_array2, ...])` |
| `KURT` | Statistical | Phase 1B (done) | `KURT(value1, value2)` |
| `LAMBDA` | Logical | Phase 4 | `LAMBDA(name, formula_expression)` |
| `LARGE` | Statistical | Phase 1A (done) | `LARGE(data, n)` |
| `LCM` | Math | Phase 1B (done) | `LCM(value1, value2)` |
| `LEFT` | Text | Phase 1A (done) | `LEFT(string, [number_of_characters])` |
| `LEFTB` | Text | Phase 1B (done) | `LEFTB(string, num_of_bytes)` |
| `LENB` | Text | Phase 1B (done) | `LENB(string)` |
| `LET` | Logical | Phase 4 | `LET(name1, value_expression1, [name2, …], [value_expression2, …], formula_expression )` |
| `LINEST` | Array | Phase 3 (done) | `LINEST(known_data_y, [known_data_x], [calculate_b], [verbose])` |
| `LN` | Math | Phase 1A (done) | `LN(value)` |
| `LOG` | Math | Phase 1A (done) | `LOG(value, base)` |
| `LOG10` | Math | Phase 1A (done) | `LOG10(value)` |
| `LOGEST` | Array | Phase 3 (done) | `LOGEST(known_data_y, [known_data_x], [b], [verbose])` |
| `LOGINV` | Statistical | Phase 5 | `LOGINV(x, mean, standard_deviation)` |
| `LOGNORM.DIST` | Statistical | Phase 5 | `LOGNORM.DIST(x, mean, standard_deviation)` |
| `LOGNORM.INV` | Statistical | Phase 5 | `LOGNORM.INV(x, mean, standard_deviation)` |
| `LOGNORMDIST` | Statistical | Phase 5 | `LOGNORMDIST(x, mean, standard_deviation)` |
| `LOOKUP` | Lookup | Phase 1A (done) | `LOOKUP(search_key, search_range\|search_result_array, [result_range])` |
| `LT` | Operator | Phase 1A (done) | `LT(value1, value2)` |
| `LTE` | Operator | Phase 1A (done) | `LTE(value1, value2)` |
| `MAKEARRAY` | Array | Phase 4 | `MAKEARRAY(rows, columns, LAMBDA)` |
| `MAP` | Array | Phase 4 | `MAP(array1, [array2, ...], LAMBDA)` |
| `MARGINOFERROR` | Statistical | Phase 5 | `MARGINOFERROR(range, confidence)` |
| `MATCH` | Lookup | Phase 1A (done) | `MATCH(search_key, range, [search_type])` |
| `MAXA` | Statistical | Phase 1B (done) | `MAXA(value1, value2)` |
| `MAXIFS` | Statistical | Phase 1A (done) | `MAXIFS(range, criteria_range1, criterion1, [criteria_range2, criterion2], …)` |
| `MDETERM` | Array | Phase 3 (done) | `MDETERM(square_matrix)` |
| `MDURATION` | Financial | Phase 5 | `MDURATION(settlement, maturity, rate, yield, frequency, [day_count_convention])` |
| `MEDIAN` | Statistical | Phase 1A (done) | `MEDIAN(value1, [value2, ...])` |
| `MID` | Text | Phase 1A (done) | `MID(string, starting_at, extract_length)` |
| `MIDB` | Text | Phase 1B (done) | `MIDB(string)` |
| `MINA` | Statistical | Phase 1B (done) | `MINA(value1, value2)` |
| `MINIFS` | Statistical | Phase 1A (done) | `MINIFS(range, criteria_range1, criterion1, [criteria_range2, criterion2], …)` |
| `MINUS` | Operator | Phase 1A (done) | `MINUS(value1, value2)` |
| `MINVERSE` | Array | Phase 3 (done) | `MINVERSE(square_matrix)` |
| `MIRR` | Financial | Phase 1B (done) | `MIRR(cashflow_amounts, financing_rate, reinvestment_return_rate)` |
| `MMULT` | Array | Phase 3 (done) | `MMULT(matrix1, matrix2)` |
| `MODE` | Statistical | Phase 1A (done) | `MODE(value1, [value2, ...])` |
| `MODE.MULT` | Statistical | Phase 3 (done) | `MODE.MULT(value1, value2)` |
| `MODE.SNGL` | Statistical | Phase 1B (done) | `MODE.SNGL(value1, [value2, ...])` |
| `MROUND` | Math | Phase 1A (done) | `MROUND(value, factor)` |
| `MULTINOMIAL` | Math | Phase 1B (done) | `MULTINOMIAL(value1, value2)` |
| `MULTIPLY` | Operator | Phase 1A (done) | `MULTIPLY(factor1, factor2)` |
| `MUNIT` | Math | Phase 3 (done) | `MUNIT(dimension)` |
| `N` | Info | Phase 1A (done) | `N(value)` |
| `NA` | Info | Phase 1A (done) | `NA()` |
| `NE` | Operator | Phase 1A (done) | `NE(value1, value2)` |
| `NEGBINOM.DIST` | Statistical | Phase 5 | `NEGBINOM.DIST(num_failures, num_successes, prob_success)` |
| `NEGBINOMDIST` | Statistical | Phase 5 | `NEGBINOMDIST(num_failures, num_successes, prob_success)` |
| `NETWORKDAYS` | Date | Phase 1A (done) | `NETWORKDAYS(start_date, end_date, [holidays])` |
| `NETWORKDAYS.INTL` | Date | Phase 1B (done) | `NETWORKDAYS.INTL(start_date, end_date, [weekend], [holidays])` |
| `NOMINAL` | Financial | Phase 1B (done) | `NOMINAL(effective_rate, periods_per_year)` |
| `NORM.DIST` | Statistical | Phase 5 | `NORM.DIST(x, mean, standard_deviation, cumulative)` |
| `NORM.INV` | Statistical | Phase 5 | `NORM.INV(x, mean, standard_deviation)` |
| `NORM.S.DIST` | Statistical | Phase 5 | `NORM.S.DIST(x)` |
| `NORM.S.INV` | Statistical | Phase 5 | `NORM.S.INV(x)` |
| `NORMDIST` | Statistical | Phase 5 | `NORMDIST(x, mean, standard_deviation, cumulative)` |
| `NORMINV` | Statistical | Phase 5 | `NORMINV(x, mean, standard_deviation)` |
| `NORMSDIST` | Statistical | Phase 5 | `NORMSDIST(x)` |
| `NORMSINV` | Statistical | Phase 5 | `NORMSINV(x)` |
| `NPER` | Financial | Phase 1B (done) | `NPER(rate, payment_amount, present_value, [future_value], [end_or_beginning])` |
| `NPV` | Financial | Phase 1B (done) | `NPV(discount, cashflow1, [cashflow2, ...])` |
| `OCT2BIN` | Engineering | Phase 1B (done) | `OCT2BIN(signed_octal_number, [significant_digits])` |
| `OCT2DEC` | Engineering | Phase 1B (done) | `OCT2DEC(signed_octal_number)` |
| `OCT2HEX` | Engineering | Phase 1B (done) | `OCT2HEX(signed_octal_number, [significant_digits])` |
| `ODD` | Math | Phase 1A (done) | `ODD(value)` |
| `OFFSET` | Lookup | Phase 2 (done) | `OFFSET(cell_reference, offset_rows, offset_columns, [height], [width])` |
| `PDURATION` | Financial | Phase 1B (done) | `PDURATION(rate, present_value, future_value)` |
| `PEARSON` | Statistical | Phase 1B (done) | `PEARSON(data_y, data_x)` |
| `PERCENTILE` | Statistical | Phase 1B (done) | `PERCENTILE(data, percentile)` |
| `PERCENTILE.EXC` | Statistical | Phase 1B (done) | `PERCENTILE.EXC(data, percentile)` |
| `PERCENTILE.INC` | Statistical | Phase 1B (done) | `PERCENTILE.INC(data, percentile)` |
| `PERCENTRANK` | Statistical | Phase 1B (done) | `PERCENTRANK(data, value, [significant_digits])` |
| `PERCENTRANK.EXC` | Statistical | Phase 1B (done) | `PERCENTRANK.EXC(data, value, [significant_digits])` |
| `PERCENTRANK.INC` | Statistical | Phase 1B (done) | `PERCENTRANK.INC(data, value, [significant_digits])` |
| `PERMUT` | Statistical | Phase 1B (done) | `PERMUT(n, k)` |
| `PERMUTATIONA` | Statistical | Phase 1B (done) | `PERMUTATIONA(number, number_chosen)` |
| `PHI` | Statistical | Phase 5 | `PHI(x)` |
| `PI` | Math | Phase 1A (done) | `PI()` |
| `PMT` | Financial | Phase 1B (done) | `PMT(rate, number_of_periods, present_value, [future_value], [end_or_beginning])` |
| `POISSON` | Statistical | Phase 5 | `POISSON(x, mean, cumulative)` |
| `POISSON.DIST` | Statistical | Phase 5 | `POISSON.DIST(x, mean, [cumulative])` |
| `POW` | Operator | Phase 1A (done) | `POW(base, exponent)` |
| `POWER` | Math | Phase 1A (done) | `POWER(base, exponent)` |
| `PPMT` | Financial | Phase 1B (done) | `PPMT(rate, period, number_of_periods, present_value, [future_value], [end_or_beginning])` |
| `PRICE` | Financial | Phase 5 | `PRICE(settlement, maturity, rate, yield, redemption, frequency, [day_count_convention])` |
| `PRICEDISC` | Financial | Phase 5 | `PRICEDISC(settlement, maturity, discount, redemption, [day_count_convention])` |
| `PRICEMAT` | Financial | Phase 5 | `PRICEMAT(settlement, maturity, issue, rate, yield, [day_count_convention])` |
| `PROB` | Statistical | Phase 1B (done) | `PROB(data, probabilities, low_limit, [high_limit])` |
| `PRODUCT` | Math | Phase 1A (done) | `PRODUCT(factor1, [factor2, ...])` |
| `PROPER` | Text | Phase 1A (done) | `PROPER(text_to_capitalize)` |
| `PV` | Financial | Phase 1B (done) | `PV(rate, number_of_periods, payment_amount, [future_value], [end_or_beginning])` |
| `QUARTILE` | Statistical | Phase 1B (done) | `QUARTILE(data, quartile_number)` |
| `QUARTILE.EXC` | Statistical | Phase 1B (done) | `QUARTILE.EXC(data, quartile_number)` |
| `QUARTILE.INC` | Statistical | Phase 1B (done) | `QUARTILE.INC(data, quartile_number)` |
| `QUERY` | Google | Not planned | `QUERY(data, query, [headers])` |
| `QUOTIENT` | Math | Phase 1A (done) | `QUOTIENT(dividend, divisor)` |
| `RADIANS` | Math | Phase 1B (done) | `RADIANS(angle)` |
| `RAND` | Math | Phase 1A (done) | `RAND()` |
| `RANDARRAY` | Math | Phase 3 (done) | `RANDARRAY(rows, columns)` |
| `RANDBETWEEN` | Math | Phase 1A (done) | `RANDBETWEEN(low, high)` |
| `RANK` | Statistical | Phase 1A (done) | `RANK(value, data, [is_ascending])` |
| `RANK.AVG` | Statistical | Phase 1B (done) | `RANK.AVG(value, data, [is_ascending])` |
| `RANK.EQ` | Statistical | Phase 1B (done) | `RANK.EQ(value, data, [is_ascending])` |
| `RATE` | Financial | Phase 1B (done) | `RATE(number_of_periods, payment_per_period, present_value, [future_value], [end_or_beginning], [rate_guess])` |
| `RECEIVED` | Financial | Phase 5 | `RECEIVED(settlement, maturity, investment, discount, [day_count_convention])` |
| `REDUCE` | Array | Phase 4 | `REDUCE(initial_value, array_or_range, LAMBDA)` |
| `REGEXEXTRACT` | Text | Phase 1A (done) | `REGEXEXTRACT(text, regular_expression)` |
| `REGEXMATCH` | Text | Phase 1A (done) | `REGEXMATCH(text, regular_expression)` |
| `REGEXREPLACE` | Text | Phase 1A (done) | `REGEXREPLACE(text, regular_expression, replacement)` |
| `REPLACE` | Text | Phase 1A (done) | `REPLACE(text, position, length, new_text)` |
| `REPLACEB` | Text | Phase 1B (done) | `REPLACEB(text, position, num_bytes, new_text)` |
| `REPT` | Text | Phase 1A (done) | `REPT(text_to_repeat, number_of_repetitions)` |
| `RIGHT` | Text | Phase 1A (done) | `RIGHT(string, [number_of_characters])` |
| `RIGHTB` | Text | Phase 1B (done) | `RIGHTB(string, num_of_bytes)` |
| `ROMAN` | Text | Phase 1B (done) | `ROMAN(number, [rule_relaxation])` |
| `ROUNDDOWN` | Math | Phase 1A (done) | `ROUNDDOWN(value, [places])` |
| `ROUNDUP` | Math | Phase 1A (done) | `ROUNDUP(value, [places])` |
| `ROW` | Lookup | Phase 1A (done) | `ROW([cell_reference])` |
| `ROWS` | Lookup | Phase 1A (done) | `ROWS(range)` |
| `RRI` | Financial | Phase 1B (done) | `RRI(number_of_periods, present_value, future_value)` |
| `RSQ` | Statistical | Phase 1B (done) | `RSQ(data_y, data_x)` |
| `SCAN` | Array | Phase 4 | `SCAN(initial_value, array_or_range, LAMBDA)` |
| `SEARCH` | Text | Phase 1A (done) | `SEARCH(search_for, text_to_search, [starting_at])` |
| `SEARCHB` | Text | Phase 1B (done) | `SEARCHB(search_for, text_to_search, [starting_at])` |
| `SEC` | Math | Phase 1B (done) | `SEC(angle)` |
| `SECH` | Math | Phase 1B (done) | `SECH(value)` |
| `SEQUENCE` | Math | Phase 3 (done) | `SEQUENCE(rows, columns, start, step)` |
| `SERIESSUM` | Math | Phase 1B (done) | `SERIESSUM(x, n, m, a)` |
| `SHEET` | Lookup | Phase 2 (done) | `SHEET(value)` |
| `SHEETS` | Info | Phase 2 (done) | `SHEETS(reference)` |
| `SIGN` | Math | Phase 1A (done) | `SIGN(value)` |
| `SIN` | Math | Phase 1B (done) | `SIN(angle)` |
| `SINH` | Math | Phase 1B (done) | `SINH(value)` |
| `SKEW` | Statistical | Phase 1B (done) | `SKEW(value1, value2)` |
| `SKEW.P` | Statistical | Phase 1B (done) | `SKEW.P(value1, value2)` |
| `SLN` | Financial | Phase 1B (done) | `SLN(cost, salvage, life)` |
| `SLOPE` | Statistical | Phase 1B (done) | `SLOPE(data_y, data_x)` |
| `SMALL` | Statistical | Phase 1A (done) | `SMALL(data, n)` |
| `SORT` | Filter | Phase 3 (done) | `SORT(range, sort_column, is_ascending, [sort_column2], [is_ascending2])` |
| `SORTN` | Filter | Phase 3 (done) | `SORTN(range, [n], [display_ties_mode], [sort_column1, is_ascending1], ...)` |
| `SPARKLINE` | Google | Not planned | `SPARKLINE(data, [options])` |
| `SPLIT` | Text | Phase 3 (done) | `SPLIT(text, delimiter, [split_by_each], [remove_empty_text])` |
| `SQRT` | Math | Phase 1A (done) | `SQRT(value)` |
| `SQRTPI` | Math | Phase 1B (done) | `SQRTPI(value)` |
| `STANDARDIZE` | Statistical | Phase 1B (done) | `STANDARDIZE(value, mean, standard_deviation)` |
| `STDEV` | Statistical | Phase 1A (done) | `STDEV(value1, [value2, ...])` |
| `STDEV.P` | Statistical | Phase 1B (done) | `STDEV.P(value1, [value2, ...])` |
| `STDEV.S` | Statistical | Phase 1B (done) | `STDEV.S(value1, [value2, ...])` |
| `STDEVA` | Statistical | Phase 1B (done) | `STDEVA(value1, value2)` |
| `STDEVP` | Statistical | Phase 1A (done) | `STDEVP(value1, value2)` |
| `STDEVPA` | Statistical | Phase 1B (done) | `STDEVPA(value1, value2)` |
| `STEYX` | Statistical | Phase 1B (done) | `STEYX(data_y, data_x)` |
| `SUBSTITUTE` | Text | Phase 1A (done) | `SUBSTITUTE(text_to_search, search_for, replace_with, [occurrence_number])` |
| `SUBTOTAL` | Math | Phase 1A (done) | `SUBTOTAL(function_code, range1, [range2, ...])` |
| `SUMIF` | Math | Phase 1A (done) | `SUMIF(range, criterion, [sum_range])` |
| `SUMIFS` | Math | Phase 1A (done) | `SUMIFS(sum_range, criteria_range1, criterion1, [criteria_range2, criterion2, ...])` |
| `SUMSQ` | Math | Phase 1A (done) | `SUMSQ(value1, [value2, ...])` |
| `SUMX2MY2` | Array | Phase 1B (done) | `SUMX2MY2(array_x, array_y)` |
| `SUMX2PY2` | Array | Phase 1B (done) | `SUMX2PY2(array_x, array_y)` |
| `SUMXMY2` | Array | Phase 1B (done) | `SUMXMY2(array_x, array_y)` |
| `SWITCH` | Logical | Phase 1A (done) | `SWITCH(expression, case1, value1, [default or case2, value2], …)` |
| `SYD` | Financial | Phase 1B (done) | `SYD(cost, salvage, life, period)` |
| `T` | Text | Phase 1A (done) | `T(value)` |
| `T.DIST` | Statistical | Phase 5 | `T.DIST(x, degrees_freedom, cumulative)` |
| `T.DIST.2T` | Statistical | Phase 5 | `T.DIST.2T(x, degrees_freedom)` |
| `T.DIST.RT` | Statistical | Phase 5 | `T.DIST.RT(x, degrees_freedom)` |
| `T.INV` | Statistical | Phase 5 | `T.INV(probability, degrees_freedom)` |
| `T.INV.2T` | Statistical | Phase 5 | `T.INV.2T(probability, degrees_freedom)` |
| `T.TEST` | Statistical | Phase 5 | `T.TEST(range1, range2, tails, type)` |
| `TAN` | Math | Phase 1B (done) | `TAN(angle)` |
| `TANH` | Math | Phase 1B (done) | `TANH(value)` |
| `TBILLEQ` | Financial | Phase 5 | `TBILLEQ(settlement, maturity, discount)` |
| `TBILLPRICE` | Financial | Phase 5 | `TBILLPRICE(settlement, maturity, discount)` |
| `TBILLYIELD` | Financial | Phase 5 | `TBILLYIELD(settlement, maturity, price)` |
| `TDIST` | Statistical | Phase 5 | `TDIST(x, degrees_freedom, tails)` |
| `TEXT` | Text | Phase 1A (done) | `TEXT(number, format)` |
| `TEXTJOIN` | Text | Phase 1A (done) | `TEXTJOIN(delimiter, ignore_empty, text1, [text2], …)` |
| `TIME` | Date | Phase 1A (done) | `TIME(hour, minute, second)` |
| `TIMEVALUE` | Date | Phase 1A (done) | `TIMEVALUE(time_string)` |
| `TINV` | Statistical | Phase 5 | `TINV(probability, degrees_freedom)` |
| `TOCOL` | Array | Phase 3 (done) | `TOCOL(array_or_range, [ignore], [scan_by_column])` |
| `TOROW` | Array | Phase 3 (done) | `TOROW(array_or_range, [ignore], [scan_by_column])` |
| `TO_DATE` | Parser | Phase 2 (done) | `TO_DATE(value)` |
| `TO_DOLLARS` | Parser | Phase 2 (done) | `TO_DOLLARS(value)` |
| `TO_PERCENT` | Parser | Phase 2 (done) | `TO_PERCENT(value)` |
| `TO_PURE_NUMBER` | Parser | Phase 2 (done) | `TO_PURE_NUMBER(value)` |
| `TO_TEXT` | Parser | Phase 2 (done) | `TO_TEXT(value)` |
| `TRANSPOSE` | Array | Phase 3 (done) | `TRANSPOSE(array_or_range)` |
| `TREND` | Array | Phase 3 (done) | `TREND(known_data_y, [known_data_x], [new_data_x], [b])` |
| `TRIMMEAN` | Statistical | Phase 1B (done) | `TRIMMEAN(data, exclude_proportion)` |
| `TRUE` | Logical | Phase 1A (done) | `TRUE()` |
| `TRUNC` | Math | Phase 1A (done) | `TRUNC(value, [places])` |
| `TTEST` | Statistical | Phase 5 | `TTEST(range1, range2, tails, type)` |
| `TYPE` | Info | Phase 1A (done) | `TYPE(value)` |
| `UMINUS` | Operator | Phase 1A (done) | `UMINUS(value)` |
| `UNARY_PERCENT` | Operator | Phase 1A (done) | `UNARY_PERCENT(percentage)` |
| `UNICHAR` | Text | Phase 1A (done) | `UNICHAR(number)` |
| `UNICODE` | Text | Phase 1A (done) | `UNICODE(text)` |
| `UNIQUE` | Filter / Operator | Phase 3 (done) | `UNIQUE(range)` |
| `UPLUS` | Operator | Phase 1A (done) | `UPLUS(value)` |
| `VALUE` | Text | Phase 1A (done) | `VALUE(text)` |
| `VAR` | Statistical | Phase 1A (done) | `VAR(value1, [value2, ...])` |
| `VAR.P` | Statistical | Phase 1B (done) | `VAR.P(value1, [value2, ...])` |
| `VAR.S` | Statistical | Phase 1B (done) | `VAR.S(value1, [value2, ...])` |
| `VARA` | Statistical | Phase 1B (done) | `VARA(value1, value2)` |
| `VARP` | Statistical | Phase 1A (done) | `VARP(value1, value2)` |
| `VARPA` | Statistical | Phase 1B (done) | `VARPA(value1, value2,...)` |
| `VDB` | Financial | Phase 1B (done) | `VDB(cost, salvage, life, start_period, end_period, [factor], [no_switch])` |
| `VSTACK` | Array | Phase 3 (done) | `VSTACK(range1; [range2, …])` |
| `WEEKNUM` | Date | Phase 1A (done) | `WEEKNUM(date, [type])` |
| `WEIBULL` | Statistical | Phase 5 | `WEIBULL(x, shape, scale, cumulative)` |
| `WEIBULL.DIST` | Statistical | Phase 5 | `WEIBULL.DIST(x, shape, scale, cumulative)` |
| `WORKDAY` | Date | Phase 1A (done) | `WORKDAY(start_date, num_days, [holidays])` |
| `WORKDAY.INTL` | Date | Phase 1B (done) | `WORKDAY.INTL(start_date, num_days, [weekend], [holidays])` |
| `WRAPCOLS` | Array | Phase 3 (done) | `WRAPCOLS(range, wrap_count, [pad_with])` |
| `WRAPROWS` | Array | Phase 3 (done) | `WRAPROWS(range, wrap_count, [pad_with])` |
| `XIRR` | Financial | Phase 1B (done) | `XIRR(cashflow_amounts, cashflow_dates, [rate_guess])` |
| `XLOOKUP` | Lookup | Phase 1A (done) | `XLOOKUP(search_key, lookup_range, result_range, missing_value, [match_mode], [search_mode])` |
| `XNPV` | Financial | Phase 1B (done) | `XNPV(discount, cashflow_amounts, cashflow_dates)` |
| `XOR` | Logical | Phase 1A (done) | `XOR(logical_expression1, [logical_expression2, ...])` |
| `YEARFRAC` | Date | Phase 1A (done) | `YEARFRAC(start_date, end_date, [day_count_convention])` |
| `YIELD` | Financial | Phase 5 | `YIELD(settlement, maturity, rate, price, redemption, frequency, [day_count_convention])` |
| `YIELDDISC` | Financial | Phase 5 | `YIELDDISC(settlement, maturity, price, redemption, [day_count_convention])` |
| `YIELDMAT` | Financial | Phase 5 | `YIELDMAT(settlement, maturity, issue, rate, price, [day_count_convention])` |
| `Z.TEST` | Statistical | Phase 5 | `Z.TEST(data, value, [standard_deviation])` |
| `ZTEST` | Statistical | Phase 5 | `ZTEST(data, value, [standard_deviation])` |
