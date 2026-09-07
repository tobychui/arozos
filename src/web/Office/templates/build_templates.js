/*
    ArozOS Office - getting-started template builder
    ===============================================

    Writes the template files listed in manifest.json from the document
    bodies defined below.

        node build_templates.js        # rewrites *.doca / *.xlsa / *.ppta here

    Why a builder rather than checked-in blobs: a template is an envelope
    wrapped around a body in the app's own schema (see src/web/Office/README.md),
    and hand-maintaining that JSON - two nested wrappers, escaped HTML,
    A1-keyed cells - is how templates drift out of shape. Here each template
    is a readable literal and the envelope is generated.

    The files are written as **plain JSON**, not zip containers. Both the Go
    unpacker (office.UnpackEnvelope) and the browser one
    (OfficeContainer.unpack) pass a non-"PK" payload straight through as a
    legacy plain-JSON document, so a template needs no packing - and none of
    these carry binary media, which is the only thing the container is for.

    Adding a template: add it to TEMPLATES, add a matching entry to
    manifest.json (id, file, label, preview, blurb), and re-run this file.
*/
var fs = require("fs");
var path = require("path");

function envelope(app, title, body) {
    var now = Date.now();
    return JSON.stringify({
        type: "arozos/office",
        app: app,
        version: 1,
        meta: {
            title: title,
            createdAt: now,
            modifiedAt: now,
            revision: 1,
            generator: "ArozOS Office/1.0"
        },
        body: body
    }, null, 1);
}

/* ---------- shared page setup for the Docs templates ---------- */
function page(opts) {
    opts = opts || {};
    return {
        size: opts.size || "A4",
        orientation: opts.orientation || "portrait",
        margins: opts.margins || { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
        columns: 1,
        colGap: 10
    };
}
function doc(html, opts) {
    opts = opts || {};
    return {
        html: html,
        page: page(opts),
        header: opts.header || "",
        footer: opts.footer || "",
        hfMode: opts.hfMode || "all",
        pageNumbers: !!opts.pageNumbers,
        comments: [],
        trackChanges: false
    };
}

/* ---------- Sheets helpers ---------- */
// cells are A1-keyed; v is the raw input ("=" prefix = formula), s the style
function cell(v, s) {
    var c = { v: String(v) };
    if (s) c.s = s;
    return c;
}
var HEAD = { b: true, bg: "#f1f3f4", bd: 1 };
var MONEY = { fmt: "currency", dec: 2 };
var TOTAL = { b: true, bd: 1, fmt: "currency", dec: 2 };

function sheet(name, cells, opts) {
    opts = opts || {};
    return {
        name: name,
        cells: cells,
        colW: opts.colW || {},
        rowH: opts.rowH || {},
        merges: opts.merges || [],
        freeze: opts.freeze || { r: 0, c: 0 },
        charts: [],
        filter: null
    };
}
function book(sheets) { return { sheets: sheets, active: 0 }; }

/* ---------- Slides helpers ---------- */
var SLIDE_W = 960, SLIDE_H = 540;
var sid = 0;
function text(html, geo) {
    return { type: "text", x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: 0, z: geo.z || 1,
             props: { html: html } };
}
function shape(kind, geo, props) {
    var p = { kind: kind, fill: (props && props.fill) || "#1a73e8",
              stroke: (props && props.stroke) || "", sw: (props && props.sw) || 0 };
    if (props && props.html) p.html = props.html;
    return { type: "shape", x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: 0, z: geo.z || 1, props: p };
}
function slide(objects, opts) {
    opts = opts || {};
    sid++;
    return {
        id: "t" + sid,
        bg: opts.bg || "#ffffff",
        notes: opts.notes || "",
        objects: objects,
        transition: "none"
    };
}
function deck(slides, theme) {
    return { size: [SLIDE_W, SLIDE_H], theme: theme || "light", slides: slides };
}
function title(t, sub) {
    return [
        text('<div style="font-size:54px;"><b>' + t + "</b></div>", { x: 90, y: 190, w: 780, h: 90, z: 1 }),
        text('<div style="font-size:24px;color:#5f6368;">' + sub + "</div>", { x: 90, y: 292, w: 780, h: 50, z: 2 })
    ];
}
function heading(t) {
    return text('<div style="font-size:36px;"><b>' + t + "</b></div>", { x: 70, y: 60, w: 820, h: 60, z: 1 });
}
function bullets(items, y) {
    var lis = items.map(function (i) { return "<li>" + i + "</li>"; }).join("");
    return text('<div style="font-size:22px;"><ul>' + lis + "</ul></div>",
        { x: 90, y: y || 160, w: 780, h: 300, z: 2 });
}

/* ================= the templates ================= */
var TEMPLATES = {};

/* ---------- Docs ---------- */
TEMPLATES["blank-document.doca"] = envelope("document", "Blank Document",
    doc("<p><br></p>"));

TEMPLATES["report.doca"] = envelope("document", "Report", doc(
    '<h1 class="doc-title">Quarterly Report</h1>' +
    '<p style="color:#5f6368;">Prepared by Your Name &nbsp;&middot;&nbsp; Month Year</p>' +
    "<h2>Summary</h2>" +
    "<p>One short paragraph on what this report covers and the single most " +
    "important thing the reader should take away from it.</p>" +
    "<h2>Highlights</h2>" +
    "<ul><li>The first result worth calling out.</li>" +
    "<li>The second, with a number attached to it.</li>" +
    "<li>Something that did not go to plan, and why.</li></ul>" +
    "<h2>Detail</h2>" +
    "<p>Expand on each highlight here. Keep one idea per paragraph.</p>" +
    "<table><tbody>" +
    "<tr><td><b>Metric</b></td><td><b>Target</b></td><td><b>Actual</b></td></tr>" +
    "<tr><td>Revenue</td><td>100,000</td><td>112,400</td></tr>" +
    "<tr><td>New customers</td><td>250</td><td>238</td></tr>" +
    "<tr><td>Churn</td><td>2.0%</td><td>1.6%</td></tr>" +
    "</tbody></table>" +
    "<h2>Next steps</h2>" +
    "<ol><li>What happens next, and who owns it.</li>" +
    "<li>The decision you need from the reader.</li></ol>",
    { header: "Quarterly Report", footer: "Confidential", pageNumbers: true }));

TEMPLATES["resume.doca"] = envelope("document", "Resume", doc(
    '<h1 class="doc-title">Your Name</h1>' +
    '<p style="color:#5f6368;">City, Country &nbsp;&middot;&nbsp; you@example.com ' +
    "&nbsp;&middot;&nbsp; +00 000 000 000</p>" +
    "<h2>Profile</h2>" +
    "<p>Two sentences on what you do and what you are looking for. Lead with " +
    "the thing you want to be hired for.</p>" +
    "<h2>Experience</h2>" +
    "<h3>Job Title &mdash; Company</h3>" +
    '<p style="color:#5f6368;">Month Year &ndash; Present</p>' +
    "<ul><li>An achievement, with the number that makes it real.</li>" +
    "<li>Something you built or changed, and the effect it had.</li>" +
    "<li>Scope: team size, budget, systems owned.</li></ul>" +
    "<h3>Job Title &mdash; Earlier Company</h3>" +
    '<p style="color:#5f6368;">Month Year &ndash; Month Year</p>' +
    "<ul><li>Keep older roles shorter than recent ones.</li></ul>" +
    "<h2>Education</h2>" +
    "<p><b>Degree</b>, Institution &mdash; Year</p>" +
    "<h2>Skills</h2>" +
    "<p>The tools and languages you would be comfortable being tested on.</p>"));

TEMPLATES["letter.doca"] = envelope("document", "Letter", doc(
    '<p style="color:#5f6368;">Your Name<br>Street Address<br>City, Postcode</p>' +
    "<p><br></p>" +
    "<p>Recipient Name<br>Company<br>Street Address<br>City, Postcode</p>" +
    "<p><br></p>" +
    "<p>Date</p>" +
    "<p><br></p>" +
    "<p>Dear Recipient,</p>" +
    "<p>Open with why you are writing, in one sentence.</p>" +
    "<p>Use the middle paragraphs for the detail: what you are asking for, " +
    "what you are offering, and anything the reader needs in order to act.</p>" +
    "<p>Close by saying what should happen next and by when.</p>" +
    "<p><br></p>" +
    "<p>Yours sincerely,</p>" +
    "<p><br></p><p><br></p>" +
    "<p>Your Name</p>"));

TEMPLATES["meeting-notes.doca"] = envelope("document", "Meeting Notes", doc(
    '<h1 class="doc-title">Meeting Notes</h1>' +
    "<table><tbody>" +
    "<tr><td><b>Date</b></td><td>&nbsp;</td></tr>" +
    "<tr><td><b>Attendees</b></td><td>&nbsp;</td></tr>" +
    "<tr><td><b>Apologies</b></td><td>&nbsp;</td></tr>" +
    "</tbody></table>" +
    "<h2>Agenda</h2>" +
    "<ol><li>First item</li><li>Second item</li><li>Any other business</li></ol>" +
    "<h2>Discussion</h2>" +
    "<p>What was said, grouped by agenda item. Record decisions, not " +
    "transcripts.</p>" +
    "<h2>Decisions</h2>" +
    "<ul><li>What was decided, and by whom.</li></ul>" +
    "<h2>Actions</h2>" +
    "<table><tbody>" +
    "<tr><td><b>Action</b></td><td><b>Owner</b></td><td><b>Due</b></td></tr>" +
    "<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>" +
    "</tbody></table>",
    { footer: "Meeting notes", pageNumbers: true }));

/* ---------- Sheets ---------- */
TEMPLATES["blank-spreadsheet.xlsa"] = envelope("spreadsheet", "Blank Spreadsheet",
    book([sheet("Sheet1", {})]));

TEMPLATES["budget-sheet.xlsa"] = envelope("spreadsheet", "Budget Sheet", book([
    sheet("Budget", {
        A1: cell("Monthly Budget", { b: true, fs: 18 }),
        A3: cell("Category", HEAD), B3: cell("Planned", HEAD),
        C3: cell("Actual", HEAD), D3: cell("Difference", HEAD),

        A4: cell("Rent / mortgage"), B4: cell("1200", MONEY), C4: cell("1200", MONEY),
        D4: cell("=B4-C4", MONEY),
        A5: cell("Utilities"), B5: cell("180", MONEY), C5: cell("164.20", MONEY),
        D5: cell("=B5-C5", MONEY),
        A6: cell("Groceries"), B6: cell("420", MONEY), C6: cell("468.75", MONEY),
        D6: cell("=B6-C6", MONEY),
        A7: cell("Transport"), B7: cell("120", MONEY), C7: cell("98.40", MONEY),
        D7: cell("=B7-C7", MONEY),
        A8: cell("Insurance"), B8: cell("95", MONEY), C8: cell("95", MONEY),
        D8: cell("=B8-C8", MONEY),
        A9: cell("Savings"), B9: cell("300", MONEY), C9: cell("300", MONEY),
        D9: cell("=B9-C9", MONEY),
        A10: cell("Other"), B10: cell("150", MONEY), C10: cell("212.10", MONEY),
        D10: cell("=B10-C10", MONEY),

        A12: cell("Total", TOTAL), B12: cell("=SUM(B4:B10)", TOTAL),
        C12: cell("=SUM(C4:C10)", TOTAL), D12: cell("=B12-C12", TOTAL),

        A14: cell("Income", { b: true }), B14: cell("2800", MONEY),
        A15: cell("Left over", { b: true }), B15: cell("=B14-C12", TOTAL)
    }, { freeze: { r: 3, c: 1 }, colW: { "0": 160, "1": 110, "2": 110, "3": 110 } })
]));

TEMPLATES["invoice.xlsa"] = envelope("spreadsheet", "Invoice", book([
    sheet("Invoice", {
        A1: cell("INVOICE", { b: true, fs: 24, fc: "#e8710a" }),
        A3: cell("From", { b: true }), A4: cell("Your Name / Company"),
        A5: cell("Street Address"), A6: cell("City, Postcode"),
        A7: cell("you@example.com"),

        C3: cell("Invoice no.", { b: true }), D3: cell("2026-001"),
        C4: cell("Date", { b: true }), D4: cell("=TODAY()", { fmt: "date" }),
        C5: cell("Due", { b: true }), D5: cell("Net 30"),

        A9: cell("Bill to", { b: true }), A10: cell("Client Name"),
        A11: cell("Client Address"),

        A13: cell("Description", HEAD), B13: cell("Qty", HEAD),
        C13: cell("Unit price", HEAD), D13: cell("Amount", HEAD),

        A14: cell("Design work"), B14: cell("12"), C14: cell("85", MONEY),
        D14: cell("=B14*C14", MONEY),
        A15: cell("Development"), B15: cell("30"), C15: cell("95", MONEY),
        D15: cell("=B15*C15", MONEY),
        A16: cell("Project management"), B16: cell("6"), C16: cell("75", MONEY),
        D16: cell("=B16*C16", MONEY),

        C18: cell("Subtotal", { b: true }), D18: cell("=SUM(D14:D16)", MONEY),
        C19: cell("Tax (10%)"), D19: cell("=D18*0.1", MONEY),
        C20: cell("Total due", TOTAL), D20: cell("=D18+D19", TOTAL),

        A22: cell("Payment within 30 days. Thank you.", { i: true, fc: "#5f6368" })
    }, { colW: { "0": 220, "1": 70, "2": 110, "3": 120 } })
]));

TEMPLATES["task-tracker.xlsa"] = envelope("spreadsheet", "Task Tracker", book([
    sheet("Tasks", {
        A1: cell("Task Tracker", { b: true, fs: 18 }),
        A3: cell("Task", HEAD), B3: cell("Owner", HEAD), C3: cell("Status", HEAD),
        D3: cell("Due", HEAD), E3: cell("Notes", HEAD),

        A4: cell("Write the project brief"), B4: cell("Ana"), C4: cell("Done"),
        D4: cell("2026-01-12", { fmt: "date" }), E4: cell("Signed off"),
        A5: cell("Draft the schedule"), B5: cell("Ben"), C5: cell("In progress"),
        D5: cell("2026-01-19", { fmt: "date" }), E5: cell(""),
        A6: cell("Book the venue"), B6: cell("Chi"), C6: cell("Blocked"),
        D6: cell("2026-01-22", { fmt: "date" }), E6: cell("Waiting on budget"),
        A7: cell("Send invitations"), B7: cell("Ana"), C7: cell("Not started"),
        D7: cell("2026-02-02", { fmt: "date" }), E7: cell(""),
        A8: cell(""), B8: cell(""), C8: cell(""), D8: cell(""), E8: cell(""),

        A10: cell("Done", { b: true }), B10: cell('=COUNTA(A4:A8)'),
        A11: cell("Total", { b: true }), B11: cell("=COUNTA(A4:A8)")
    }, { freeze: { r: 3, c: 0 }, colW: { "0": 230, "1": 90, "2": 110, "3": 110, "4": 200 } })
]));

/* ---------- Slides ---------- */
TEMPLATES["blank-presentation.ppta"] = envelope("presentation", "Blank Presentation",
    deck([slide([])]));

TEMPLATES["presentation.ppta"] = envelope("presentation", "Presentation", deck([
    slide(title("Presentation Title", "Your name &middot; Date"),
        { notes: "Open with why the audience should care." }),
    slide([
        heading("The problem"),
        bullets([
            "Who has this problem, and how often.",
            "What they do about it today.",
            "Why that is not good enough."
        ])
    ], { notes: "One slide, one idea." }),
    slide([
        heading("What we are proposing"),
        bullets([
            "The change, in one sentence.",
            "What it costs.",
            "What it gets us."
        ])
    ]),
    slide([
        heading("How it works"),
        shape("round", { x: 90, y: 200, w: 220, h: 120, z: 2 }, { fill: "#e8f0fe" }),
        text('<div style="font-size:20px;text-align:center;">Step one</div>',
            { x: 100, y: 245, w: 200, h: 40, z: 3 }),
        shape("round", { x: 370, y: 200, w: 220, h: 120, z: 4 }, { fill: "#e6f4ea" }),
        text('<div style="font-size:20px;text-align:center;">Step two</div>',
            { x: 380, y: 245, w: 200, h: 40, z: 5 }),
        shape("round", { x: 650, y: 200, w: 220, h: 120, z: 6 }, { fill: "#fef0e3" }),
        text('<div style="font-size:20px;text-align:center;">Step three</div>',
            { x: 660, y: 245, w: 200, h: 40, z: 7 })
    ]),
    slide([
        heading("What we need from you"),
        bullets([
            "The decision you are asking for.",
            "By when.",
            "What happens if the answer is no."
        ])
    ], { notes: "Do not end on a thank-you slide - end on the ask." })
]));

TEMPLATES["lesson.ppta"] = envelope("presentation", "Lesson", deck([
    slide(title("Lesson Title", "Subject &middot; Year group")),
    slide([
        heading("Learning objectives"),
        bullets([
            "By the end of this lesson you will be able to&hellip;",
            "&hellip;and to&hellip;",
            "&hellip;and to explain why it matters."
        ])
    ]),
    slide([
        heading("Starter"),
        text('<div style="font-size:26px;">A question to answer in the first five minutes.</div>',
            { x: 90, y: 200, w: 780, h: 120, z: 2 })
    ], { notes: "Give them two minutes on their own before taking answers." }),
    slide([
        heading("Main activity"),
        bullets([
            "What the class does.",
            "In pairs or alone.",
            "How long it should take."
        ])
    ]),
    slide([
        heading("Plenary"),
        text('<div style="font-size:26px;">What did we learn? Who can explain it back?</div>',
            { x: 90, y: 200, w: 780, h: 120, z: 2 })
    ])
]));

/* ================= write ================= */
var here = __dirname;
var written = 0;
Object.keys(TEMPLATES).forEach(function (name) {
    fs.writeFileSync(path.join(here, name), TEMPLATES[name]);
    written++;
});

// keep the manifest honest: every file it lists must exist, and vice versa
var manifest = JSON.parse(fs.readFileSync(path.join(here, "manifest.json"), "utf8"));
var listed = manifest.templates.map(function (t) { return t.file; });
var built = Object.keys(TEMPLATES);
var missing = listed.filter(function (f) { return built.indexOf(f) < 0; });
var extra = built.filter(function (f) { return listed.indexOf(f) < 0; });
if (missing.length) {
    console.error("manifest.json lists templates this file does not build: " + missing.join(", "));
    process.exit(1);
}
if (extra.length) {
    console.error("built templates missing from manifest.json: " + extra.join(", "));
    process.exit(1);
}
console.log("wrote " + written + " templates, all listed in manifest.json");
