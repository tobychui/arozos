/*
    Text - lightweight, dependency-free syntax highlighter

    A small generic tokenizer used to colour fenced code blocks in the editor
    (```c, ```go, …). It is intentionally compact and self-contained — no remote
    CDN, no heavy library — and keyword-table driven so new languages are a one
    line addition. It is NOT a full parser; it colours comments, strings,
    numbers, keywords, types and call-like identifiers, which covers the vast
    majority of real-world snippets.

    Output is HTML with <span class="hl-*"> wrappers (hl-com / hl-str / hl-num /
    hl-kw / hl-typ / hl-fn); the editor styles those classes per theme.

    Exposed as window.TextHL = { highlight(code, lang), supports(lang) }.
*/
(function (global) {
    "use strict";

    function esc(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function wrap(cls, txt) { return '<span class="' + cls + '">' + esc(txt) + "</span>"; }
    function toSet(arr) { var o = {}; (arr || []).forEach(function (k) { o[k] = 1; }); return o; }
    function words(s) { return s.trim().split(/\s+/); }

    // ── language registry ───────────────────────────────────────────────────
    var LANG = {};
    // cfg: { line, block:[open,close], strings:[…], hash:"pre"|"comment", ci:bool }
    function def(names, cfg, kw, ty) {
        var entry = {
            cfg: cfg,
            kw: toSet(cfg.ci ? words(kw).map(function (w) { return w.toLowerCase(); }) : words(kw)),
            ty: toSet(words(ty || ""))
        };
        names.forEach(function (n) { LANG[n] = entry; });
    }

    var cLike  = { line: "//", block: ["/*", "*/"], strings: ['"', "'"] };
    var cPre   = { line: "//", block: ["/*", "*/"], strings: ['"', "'"], hash: "pre" };
    var jsLike = { line: "//", block: ["/*", "*/"], strings: ['"', "'", "`"] };
    var hashLn = { line: null, block: null, strings: ['"', "'"], hash: "comment" };

    def(["c"], cPre,
        "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while",
        "bool size_t ssize_t int8_t uint8_t int16_t uint16_t int32_t uint32_t int64_t uint64_t FILE wchar_t va_list");
    def(["cpp", "c++", "cc", "hpp", "cxx"], cPre,
        "alignas alignof and auto bool break case catch char class compl const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register return short signed sizeof static static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while",
        "string vector map set unordered_map unordered_set pair size_t int8_t uint8_t int16_t uint16_t int32_t uint32_t int64_t uint64_t shared_ptr unique_ptr");
    def(["go", "golang"], cLike,
        "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota append cap close copy delete len make new panic print println recover",
        "bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any");
    def(["js", "javascript", "jsx", "mjs", "node"], jsLike,
        "async await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return static super switch this throw try typeof var void while with yield true false null undefined NaN Infinity of as from get set",
        "Array Object String Number Boolean Symbol Promise Map Set WeakMap WeakSet JSON Math Date RegExp Error console window document");
    def(["ts", "typescript", "tsx"], jsLike,
        "abstract any as asserts async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace never new null number object of private protected public readonly return set static string super switch symbol this throw try type typeof undefined unique unknown var void while yield true false boolean",
        "Array Object Promise Map Set Record Partial Readonly Pick Omit ReturnType");
    def(["py", "python"], hashLn,
        "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None match case",
        "self int float str bool list dict tuple set bytes object range print len range super Exception");
    def(["java"], cLike,
        "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try var void volatile while true false null record sealed yield",
        "String Integer Long Double Float Boolean Object List Map Set ArrayList HashMap Optional Stream");
    def(["rust", "rs"], cLike,
        "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while box",
        "i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box Rc Arc HashMap HashSet Some None Ok Err");
    def(["json"], { line: null, block: null, strings: ['"'] },
        "true false null", "");
    def(["sql", "mysql", "psql", "postgres"], { line: "--", block: ["/*", "*/"], strings: ["'", '"'], ci: true },
        "select from where insert into values update set delete create table drop alter add column join left right inner outer full on group by order having limit offset union all distinct as and or not null is in like between exists case when then else end primary key foreign references default index unique constraint cascade view trigger procedure function begin commit rollback",
        "int integer bigint smallint varchar char text date datetime timestamp boolean decimal numeric float double serial uuid json jsonb");
    def(["bash", "sh", "shell", "zsh"], hashLn,
        "if then else elif fi case esac for while until do done in function select return break continue local export readonly declare source eval exec trap set unset shift",
        "echo cd ls cat grep sed awk printf read test mkdir rm cp mv touch chmod chown kill pwd");
    def(["php"], { line: "//", block: ["/*", "*/"], strings: ['"', "'"], hash: "comment" },
        "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list namespace new or print private protected public require require_once return static switch throw trait try unset use var while yield true false null",
        "int float string bool array object void mixed self parent");
    def(["cs", "csharp", "c#", "dotnet"], cLike,
        "abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield record",
        "List Dictionary IEnumerable Task Action Func Console String Int32 Object Nullable");
    def(["kotlin", "kt"], cLike,
        "abstract actual annotation as break by catch class companion const constructor continue crossinline data delegate do dynamic else enum expect external false final finally for fun get if import in infix init inline inner interface internal is lateinit lazy noinline null object open operator out override package private protected public reified return sealed set super suspend tailrec this throw true try typealias typeof val var vararg when where while",
        "Int Long Double Float Boolean String Char Any Unit List Map Set Array MutableList Pair");
    def(["swift"], cLike,
        "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil super self Self throw throws true try weak lazy",
        "Int Double Float Bool String Character Array Dictionary Set Optional Any AnyObject Void");
    def(["ruby", "rb"], { line: "#", block: null, strings: ['"', "'"], hash: "comment" },
        "alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer puts print",
        "Integer Float String Symbol Array Hash Object Proc Lambda Struct");

    function supports(lang) { return !!LANG[(lang || "").toLowerCase()]; }

    function highlight(code, lang) {
        var L = LANG[(lang || "").toLowerCase()];
        if (!L) return esc(code);
        var cfg = L.cfg, kw = L.kw, ty = L.ty;
        var i = 0, n = code.length, out = "", lineStart = true;

        while (i < n) {
            var ch = code[i];

            // block comment
            if (cfg.block && code.startsWith(cfg.block[0], i)) {
                var be = code.indexOf(cfg.block[1], i + cfg.block[0].length);
                be = be < 0 ? n : be + cfg.block[1].length;
                out += wrap("hl-com", code.slice(i, be)); i = be; lineStart = false; continue;
            }
            // line comment
            if (cfg.line && code.startsWith(cfg.line, i)) {
                var le = code.indexOf("\n", i); le = le < 0 ? n : le;
                out += wrap("hl-com", code.slice(i, le)); i = le; continue;
            }
            // # is a comment (python/bash/ruby/php) or a C preprocessor directive
            if (ch === "#" && cfg.hash === "comment") {
                var he = code.indexOf("\n", i); he = he < 0 ? n : he;
                out += wrap("hl-com", code.slice(i, he)); i = he; continue;
            }
            if (ch === "#" && cfg.hash === "pre" && lineStart) {
                var pm = /^#\s*[A-Za-z_]+/.exec(code.slice(i));
                if (pm) { out += wrap("hl-kw", pm[0]); i += pm[0].length; lineStart = false; continue; }
            }
            // string
            if (cfg.strings.indexOf(ch) >= 0) {
                var j = i + 1;
                while (j < n) {
                    if (code[j] === "\\") { j += 2; continue; }
                    if (code[j] === ch) { j++; break; }
                    if (code[j] === "\n" && ch !== "`") { break; }   // unterminated on this line
                    j++;
                }
                out += wrap("hl-str", code.slice(i, j)); i = j; lineStart = false; continue;
            }
            // number
            if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(code[i + 1] || ""))) {
                var k = i + 1;
                while (k < n && /[0-9a-fA-FxXoObB._]/.test(code[k])) k++;
                out += wrap("hl-num", code.slice(i, k)); i = k; lineStart = false; continue;
            }
            // identifier / keyword / type / call
            if (/[A-Za-z_$@]/.test(ch)) {
                var w = i + 1;
                while (w < n && /[A-Za-z0-9_$]/.test(code[w])) w++;
                var word = code.slice(i, w);
                var look = cfg.ci ? word.toLowerCase() : word;
                var p = w; while (p < n && (code[p] === " " || code[p] === "\t")) p++;
                if (kw[look]) out += wrap("hl-kw", word);
                else if (ty[word]) out += wrap("hl-typ", word);
                else if (code[p] === "(") out += wrap("hl-fn", word);
                else out += esc(word);
                i = w; lineStart = false; continue;
            }
            // any other character
            out += esc(ch);
            if (ch === "\n") lineStart = true;
            else if (ch !== " " && ch !== "\t") lineStart = false;
            i++;
        }
        return out;
    }

    global.TextHL = { highlight: highlight, supports: supports };
})(window);
