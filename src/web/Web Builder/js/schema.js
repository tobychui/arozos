/*
    schema.js

    The element catalogue. Everything the builder knows about an element type
    lives here: its palette entry, the HTML it renders to, its default styles
    and the fields the inspector shows on the Content tab.

    An element definition:
    {
        type:      unique id, also the value stored in node.type
        name:      display name (palette card, layers tree, inspector title)
        icon:      key into WBIconPaths
        group:     palette group ("Basic" | "Media" | "Forms" | "More")
        tag:       default HTML tag
        container: true if it can hold child elements
        text:      true if its text is directly editable on canvas
        hidden:    true to keep it out of the palette (structural types)
        props:     default content properties
        styles:    default base styles (camelCase CSS)
        fields:    inspector Content tab field descriptors
    }

    Field descriptors understood by js/inspector.js:
        { key, label, type, options?, placeholder?, min?, max?, step?, help? }
        type: text | textarea | richtext | select | number | url | color |
              switch | image | file | list | icon | code
*/

var WBFonts = [
    { name: "System UI",       stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    { name: "Inter",           stack: "Inter, 'Segoe UI', sans-serif",              web: "Inter:wght@300;400;500;600;700;800" },
    { name: "Poppins",         stack: "Poppins, 'Segoe UI', sans-serif",            web: "Poppins:wght@300;400;500;600;700;800" },
    { name: "Montserrat",      stack: "Montserrat, 'Segoe UI', sans-serif",         web: "Montserrat:wght@300;400;500;600;700;800" },
    { name: "Playfair Display",stack: "'Playfair Display', Georgia, serif",         web: "Playfair+Display:wght@400;500;600;700" },
    { name: "Merriweather",    stack: "Merriweather, Georgia, serif",               web: "Merriweather:wght@300;400;700" },
    { name: "Roboto Mono",     stack: "'Roboto Mono', Consolas, monospace",         web: "Roboto+Mono:wght@300;400;500;700" },
    { name: "Georgia",         stack: "Georgia, 'Times New Roman', serif" },
    { name: "Helvetica",       stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    { name: "Courier",         stack: "'Courier New', Courier, monospace" }
];

var WBFontWeights = [
    { value: "300", label: "300 - Light" },
    { value: "400", label: "400 - Regular" },
    { value: "500", label: "500 - Medium" },
    { value: "600", label: "600 - Semi Bold" },
    { value: "700", label: "700 - Bold" },
    { value: "800", label: "800 - Extra Bold" }
];

/* Breakpoints. "base" is desktop-first; tablet/mobile are max-width overrides. */
var WBBreakpoints = [
    { key: "base",   name: "Desktop", icon: "desktop", width: 0,    frame: 1280 },
    { key: "tablet", name: "Tablet",  icon: "tablet",  width: 1024, frame: 768 },
    { key: "mobile", name: "Mobile",  icon: "mobile",  width: 640,  frame: 390 }
];

var WBElements = {

    /* ------------------------------------------------ structural ---- */

    body: {
        type: "body", name: "Body", icon: "box", hidden: true,
        tag: "body", container: true,
        props: {},
        styles: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#16181d", backgroundColor: "#ffffff" },
        fields: []
    },

    /* ------------------------------------------------ basic ---- */

    text: {
        type: "text", name: "Text", icon: "text", group: "Basic",
        tag: "p", text: true,
        props: { html: "A modern and intuitive website builder to bring your ideas to life." },
        styles: { fontSize: "16px", lineHeight: "1.65", color: "#4b5563", margin: "0 0 16px 0" },
        fields: [
            { key: "html", label: "Text", type: "richtext" },
            { key: "tag", label: "HTML Tag", type: "select", options: [
                { value: "p", label: "P" }, { value: "div", label: "DIV" },
                { value: "span", label: "SPAN" }, { value: "blockquote", label: "BLOCKQUOTE" }
            ] }
        ]
    },

    heading: {
        type: "heading", name: "Heading", icon: "heading", group: "Basic",
        tag: "h1", text: true,
        props: { html: "Build Your Vision." },
        styles: { fontSize: "48px", fontWeight: "700", lineHeight: "1.15", color: "#111827", margin: "0 0 16px 0", letterSpacing: "-0.02em" },
        fields: [
            { key: "html", label: "Text", type: "richtext" },
            { key: "tag", label: "HTML Tag", type: "select", options: [
                { value: "h1", label: "H1" }, { value: "h2", label: "H2" }, { value: "h3", label: "H3" },
                { value: "h4", label: "H4" }, { value: "h5", label: "H5" }, { value: "h6", label: "H6" }
            ] }
        ]
    },

    image: {
        type: "image", name: "Image", icon: "image", group: "Basic",
        tag: "img", void: true,
        props: { src: "", alt: "", href: "", target: "_self" },
        styles: { display: "block", maxWidth: "100%", height: "auto", borderRadius: "8px" },
        fields: [
            { key: "src", label: "Image", type: "image" },
            { key: "alt", label: "Alternative Text", type: "text", placeholder: "Describes the image" },
            { key: "href", label: "Link To", type: "url", placeholder: "Optional link target" },
            { key: "target", label: "Open In", type: "select", options: [
                { value: "_self", label: "Same tab" }, { value: "_blank", label: "New tab" }
            ] }
        ]
    },

    button: {
        type: "button", name: "Button", icon: "button", group: "Basic",
        tag: "a", text: true,
        props: { html: "Get Started", href: "#", target: "_self" },
        styles: {
            display: "inline-block", padding: "13px 26px", backgroundColor: "#f97316",
            color: "#ffffff", borderRadius: "8px", fontSize: "15px", fontWeight: "600",
            textDecoration: "none", textAlign: "center"
        },
        fields: [
            { key: "html", label: "Label", type: "text" },
            { key: "href", label: "Link To", type: "url", placeholder: "#, /about.html or https://..." },
            { key: "target", label: "Open In", type: "select", options: [
                { value: "_self", label: "Same tab" }, { value: "_blank", label: "New tab" }
            ] }
        ]
    },

    divider: {
        type: "divider", name: "Divider", icon: "divider", group: "Basic",
        tag: "hr", void: true,
        props: {},
        styles: { border: "0", borderTop: "1px solid #e5e7eb", margin: "24px 0", width: "100%" },
        fields: []
    },

    spacer: {
        type: "spacer", name: "Spacer", icon: "spacer", group: "Basic",
        tag: "div", void: true,
        props: {},
        styles: { height: "48px", width: "100%" },
        fields: [
            { key: "_height", label: "Height", type: "style-length", styleKey: "height", min: 0, max: 400 }
        ]
    },

    columns: {
        type: "columns", name: "Columns", icon: "columns", group: "Basic",
        tag: "div", container: true,
        props: { count: 3 },
        styles: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "28px", width: "100%" },
        fields: [
            { key: "count", label: "Columns", type: "number", min: 1, max: 6, step: 1 },
            { key: "_gap", label: "Gap", type: "style-length", styleKey: "gap", min: 0, max: 120 }
        ]
    },

    column: {
        type: "column", name: "Column", icon: "columns", hidden: true,
        tag: "div", container: true,
        props: {},
        styles: { display: "flex", flexDirection: "column", minHeight: "40px" },
        fields: []
    },

    section: {
        type: "section", name: "Section", icon: "section", group: "Basic",
        tag: "section", container: true,
        props: {},
        styles: { paddingTop: "72px", paddingBottom: "72px", paddingLeft: "24px", paddingRight: "24px", width: "100%" },
        fields: []
    },

    container: {
        type: "container", name: "Container", icon: "container", group: "Basic",
        tag: "div", container: true,
        props: {},
        styles: { maxWidth: "1120px", marginLeft: "auto", marginRight: "auto", width: "100%" },
        fields: [
            { key: "_maxw", label: "Max Width", type: "style-length", styleKey: "maxWidth", min: 320, max: 1600 }
        ]
    },

    /* ------------------------------------------------ media ---- */

    gallery: {
        type: "gallery", name: "Gallery", icon: "gallery", group: "Media",
        tag: "div",
        props: { images: [], columns: 3, ratio: "4 / 3" },
        styles: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", width: "100%" },
        fields: [
            { key: "images", label: "Images", type: "list", itemType: "image" },
            { key: "columns", label: "Columns", type: "number", min: 1, max: 6, step: 1 },
            { key: "ratio", label: "Aspect Ratio", type: "select", options: [
                { value: "4 / 3", label: "4:3" }, { value: "1 / 1", label: "1:1" },
                { value: "16 / 9", label: "16:9" }, { value: "3 / 4", label: "3:4" }
            ] }
        ]
    },

    video: {
        type: "video", name: "Video", icon: "video", group: "Media",
        tag: "video",
        props: { src: "", poster: "", controls: true, autoplay: false, loop: false, muted: false },
        styles: { width: "100%", borderRadius: "10px", display: "block" },
        fields: [
            { key: "src", label: "Video File", type: "file", accept: "video" },
            { key: "poster", label: "Poster Image", type: "image" },
            { key: "controls", label: "Show Controls", type: "switch" },
            { key: "autoplay", label: "Autoplay", type: "switch" },
            { key: "loop", label: "Loop", type: "switch" },
            { key: "muted", label: "Muted", type: "switch" }
        ]
    },

    icon: {
        type: "icon", name: "Icon", icon: "icon-shape", group: "Media",
        tag: "span",
        props: { icon: "sparkle", size: 28 },
        styles: { display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#f97316" },
        fields: [
            { key: "icon", label: "Glyph", type: "icon" },
            { key: "size", label: "Size", type: "number", min: 8, max: 200, step: 1 }
        ]
    },

    /* ------------------------------------------------ forms ---- */

    form: {
        type: "form", name: "Form", icon: "form", group: "Forms",
        tag: "form", container: true,
        props: {
            formName: "Contact form",
            mode: "csv",              /* csv = save to a file, url = post elsewhere */
            csvPath: "",              /* blank means the default under user:/Form Submissions */
            /* the page a visitor lands on after submitting; blank colours
               fall back to the site theme */
            successTitle: "Thank you",
            successMessage: "Thank you. Your message has been received.",
            backLabel: "Back to the site",
            replyAccent: "", replyBg: "", replyText: "",
            action: "", method: "post"
        },
        styles: { display: "flex", flexDirection: "column", gap: "14px", width: "100%", maxWidth: "480px" },
        fields: [
            { key: "_submit", label: "When someone submits", type: "form-submit" }
        ]
    },

    input: {
        type: "input", name: "Input", icon: "input", group: "Forms",
        tag: "label",
        props: { label: "Your name", name: "name", inputType: "text", placeholder: "", required: false },
        styles: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", color: "#374151", width: "100%" },
        fields: [
            { key: "label", label: "Label", type: "text" },
            { key: "name", label: "Field Name", type: "text", placeholder: "name attribute" },
            { key: "inputType", label: "Type", type: "select", options: [
                { value: "text", label: "Text" }, { value: "email", label: "Email" },
                { value: "number", label: "Number" }, { value: "tel", label: "Telephone" },
                { value: "password", label: "Password" }, { value: "date", label: "Date" },
                { value: "url", label: "URL" }
            ] },
            { key: "placeholder", label: "Placeholder", type: "text" },
            { key: "required", label: "Required", type: "switch" }
        ]
    },

    textarea: {
        type: "textarea", name: "Textarea", icon: "textarea", group: "Forms",
        tag: "label",
        props: { label: "Message", name: "message", placeholder: "", rows: 4, required: false },
        styles: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", color: "#374151", width: "100%" },
        fields: [
            { key: "label", label: "Label", type: "text" },
            { key: "name", label: "Field Name", type: "text" },
            { key: "placeholder", label: "Placeholder", type: "text" },
            { key: "rows", label: "Rows", type: "number", min: 2, max: 20, step: 1 },
            { key: "required", label: "Required", type: "switch" }
        ]
    },

    checkbox: {
        type: "checkbox", name: "Checkbox", icon: "checkbox", group: "Forms",
        tag: "label",
        props: { label: "Subscribe to updates", name: "subscribe", checked: false },
        styles: { display: "flex", alignItems: "center", gap: "9px", fontSize: "14px", color: "#374151" },
        fields: [
            { key: "label", label: "Label", type: "text" },
            { key: "name", label: "Field Name", type: "text" },
            { key: "checked", label: "Checked By Default", type: "switch" }
        ]
    },

    radio: {
        type: "radio", name: "Radio", icon: "radio", group: "Forms",
        tag: "div",
        props: { label: "Choose one", name: "choice", options: ["Option A", "Option B"] },
        styles: { display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", color: "#374151" },
        fields: [
            { key: "label", label: "Group Label", type: "text" },
            { key: "name", label: "Field Name", type: "text" },
            { key: "options", label: "Options", type: "list", itemType: "text" }
        ]
    },

    submit: {
        type: "submit", name: "Submit", icon: "submit", group: "Forms",
        tag: "button", text: true,
        props: { html: "Send" },
        styles: {
            display: "inline-block", padding: "12px 24px", backgroundColor: "#f97316",
            color: "#ffffff", border: "0", borderRadius: "8px", fontSize: "15px",
            fontWeight: "600", cursor: "pointer", alignSelf: "flex-start"
        },
        fields: [ { key: "html", label: "Label", type: "text" } ]
    },

    /* ------------------------------------------------ more ---- */

    map: {
        type: "map", name: "Map", icon: "map", group: "More",
        tag: "iframe",
        props: { lat: 22.3193, lng: 114.1694, zoom: 13, label: "" },
        styles: { width: "100%", height: "340px", border: "0", borderRadius: "10px", display: "block" },
        fields: [
            { key: "lat", label: "Latitude", type: "number", step: 0.0001 },
            { key: "lng", label: "Longitude", type: "number", step: 0.0001 },
            { key: "zoom", label: "Zoom", type: "number", min: 1, max: 19, step: 1 },
            { key: "label", label: "Marker Label", type: "text" }
        ],
        help: "Uses the OpenStreetMap embed - no API key needed, but the visitor's browser must be able to reach openstreetmap.org."
    },

    html: {
        type: "html", name: "HTML", icon: "code", group: "More",
        tag: "div",
        props: { code: "<!-- your markup here -->" },
        styles: { width: "100%" },
        fields: [ { key: "code", label: "HTML", type: "code" } ],
        help: "Raw markup is written to the page as-is. Scripts inside it do not run on the canvas, only on the published page."
    },

    embed: {
        type: "embed", name: "Embed", icon: "embed", group: "More",
        tag: "iframe",
        props: { url: "", allowFullscreen: true },
        styles: { width: "100%", height: "420px", border: "0", borderRadius: "10px", display: "block" },
        fields: [
            { key: "url", label: "URL", type: "url", placeholder: "https://..." },
            { key: "allowFullscreen", label: "Allow Fullscreen", type: "switch" }
        ]
    }
};

/* Palette groups, in the order they appear in the Add panel. */
var WBPaletteGroups = ["Basic", "Media", "Forms", "More"];

/*
    Default size of each heading level. Changing a heading's level re-sizes it
    to match (see WBModel.setTag) - a H1 that stays 48px after being turned into
    a H3 is never what anyone means.
*/
var WBHeadingSizes = { h1: 48, h2: 36, h3: 28, h4: 22, h5: 18, h6: 16 };

/* Icon glyphs offered by the Icon element. */
var WBIconChoices = [
    "sparkle", "icon-shape", "palette", "globe", "home", "heading", "image", "video",
    "map", "code", "check", "plus", "info", "alert", "clock", "folder", "file",
    "eye", "lock", "link", "search", "download", "upload", "publish", "layers",
    "gear", "help", "quote", "list", "block", "box", "external", "play-circle"
];

function wbDef(type) {
    return WBElements[type] || WBElements.container;
}

function wbIsContainer(type) {
    return wbDef(type).container === true;
}

function wbIsTextEditable(type) {
    return wbDef(type).text === true;
}

/*
    Starter content for a brand new site: a hero, a feature row, a call to
    action and a footer. Mirrors what the builder shows on first launch.
    Returned as plain node trees consumed by wbNodeFromSeed() in model.js.
*/
function WBStarterPage(siteName) {
    siteName = siteName || "BrandName";
    var accent = "#f97316";

    function n(type, props, styles, children, name, responsive) {
        var seed = { type: type, props: props || {}, styles: styles || {}, children: children || [], name: name };
        if (responsive) {
            if (responsive.tablet) { seed.tablet = responsive.tablet; }
            if (responsive.mobile) { seed.mobile = responsive.mobile; }
        }
        return seed;
    }

    /*
        Nav entries are real links, so the published page is navigable. The
        Button element defaults to a filled pill, so the fill and padding are
        explicitly cleared here rather than merely left unset.
    */
    function navLink(label, active) {
        return n("button", { html: label, href: "#" }, {
            display: "inline-block", fontSize: "15px", margin: "0",
            padding: "0", backgroundColor: "transparent", borderRadius: "0",
            color: active ? accent : "#4b5563",
            fontWeight: active ? "500" : "400",
            textDecoration: "none"
        });
    }

    var navbar = n("container", {}, {
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "36px", maxWidth: "1120px",
        marginLeft: "auto", marginRight: "auto", marginBottom: "64px"
    }, [
        n("text", { html: "<strong>" + siteName + "</strong>" }, {
            fontSize: "19px", fontWeight: "700", color: "#111827", margin: "0", marginRight: "auto"
        }),
        navLink("Home", true),
        navLink("About"),
        navLink("Services"),
        navLink("Blog"),
        navLink("Contact"),
        n("button", { html: "Get Started", href: "#" }, {
            display: "inline-block", padding: "11px 22px", backgroundColor: accent, color: "#ffffff",
            borderRadius: "8px", fontSize: "14px", fontWeight: "600", textDecoration: "none"
        })
    ], "Navbar", {
        tablet: { gap: "22px", marginBottom: "44px" },
        mobile: { gap: "14px", marginBottom: "32px", justifyContent: "center" }
    });

    var hero = n("section", {}, {
        paddingTop: "40px", paddingBottom: "88px", paddingLeft: "24px", paddingRight: "24px",
        backgroundColor: "#ffffff", width: "100%"
    }, [
        navbar,
        n("container", {}, { maxWidth: "1120px", marginLeft: "auto", marginRight: "auto" }, [
            n("heading", { html: "Build Your Vision.<br>Create Without Limits.", tag: "h1" }, {
                fontSize: "56px", fontWeight: "700", lineHeight: "1.12", color: "#111827",
                letterSpacing: "-0.025em", margin: "0 0 20px 0"
            }, [], "Heading", {
                tablet: { fontSize: "42px" },
                mobile: { fontSize: "32px", lineHeight: "1.2" }
            }),
            n("text", { html: "A modern and intuitive website builder<br>to bring your ideas to life." }, {
                fontSize: "17px", lineHeight: "1.6", color: "#4b5563", margin: "0 0 32px 0"
            }, [], undefined, { mobile: { fontSize: "15.5px", margin: "0 0 24px 0" } }),
            n("container", {}, { display: "flex", flexWrap: "wrap", gap: "12px", maxWidth: "none", marginLeft: "0", marginRight: "0" }, [
                n("button", { html: "Get Started", href: "#" }, {
                    display: "inline-block", padding: "14px 30px", backgroundColor: accent,
                    color: "#ffffff", borderRadius: "8px", fontSize: "15px", fontWeight: "600", textDecoration: "none"
                }),
                n("button", { html: "Learn More", href: "#" }, {
                    display: "inline-block", padding: "14px 30px", backgroundColor: "#ffffff",
                    color: "#111827", border: "1px solid #d1d5db", borderRadius: "8px",
                    fontSize: "15px", fontWeight: "600", textDecoration: "none"
                })
            ], "Buttons")
        ], "Hero Content")
    ], "Section (Hero)", {
        mobile: { paddingTop: "24px", paddingBottom: "56px", paddingLeft: "18px", paddingRight: "18px" }
    });

    function feature(iconName, title, body, tint) {
        return n("container", {}, {
            maxWidth: "none", marginLeft: "0", marginRight: "0", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center"
        }, [
            n("icon", { icon: iconName, size: 26 }, {
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "56px", height: "56px", borderRadius: "14px",
                backgroundColor: tint, color: accent, marginBottom: "18px"
            }),
            n("heading", { html: title, tag: "h3" }, {
                fontSize: "17px", fontWeight: "700", color: "#111827", margin: "0 0 8px 0"
            }),
            n("text", { html: body }, {
                fontSize: "14.5px", lineHeight: "1.65", color: "#6b7280", margin: "0"
            })
        ], "Feature Item");
    }

    var features = n("section", {}, {
        paddingTop: "72px", paddingBottom: "72px", paddingLeft: "24px", paddingRight: "24px",
        backgroundColor: "#ffffff", width: "100%"
    }, [
        n("container", {}, { maxWidth: "1120px", marginLeft: "auto", marginRight: "auto" }, [
            n("columns", { count: 3 }, {
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "40px", width: "100%"
            }, [
                n("column", {}, { display: "flex", flexDirection: "column" }, [
                    feature("sparkle", "Fast &amp; Lightweight", "Optimized for speed and performance across all devices.", "#fff1e7")
                ]),
                n("column", {}, { display: "flex", flexDirection: "column" }, [
                    feature("palette", "Beautiful Templates", "Choose from a variety of modern, professionally designed templates.", "#fdf2e9")
                ]),
                n("column", {}, { display: "flex", flexDirection: "column" }, [
                    feature("block", "Easy to Customize", "Drag, drop and edit to make it uniquely yours.", "#fff4ec")
                ])
            ], undefined, {
                tablet: { gap: "26px" },
                mobile: { gridTemplateColumns: "repeat(1, 1fr)", gap: "34px" }
            })
        ])
    ], "Section (Features)", {
        mobile: { paddingTop: "48px", paddingBottom: "48px" }
    });

    var cta = n("section", {}, {
        paddingTop: "72px", paddingBottom: "72px", paddingLeft: "24px", paddingRight: "24px",
        backgroundColor: "#fff7ed", width: "100%", textAlign: "center"
    }, [
        n("container", {}, { maxWidth: "720px", marginLeft: "auto", marginRight: "auto" }, [
            n("heading", { html: "Ready to start building?", tag: "h2" }, {
                fontSize: "34px", fontWeight: "700", color: "#111827", margin: "0 0 14px 0", letterSpacing: "-0.02em"
            }, [], undefined, { mobile: { fontSize: "26px" } }),
            n("text", { html: "Publish straight to your ArozOS personal site in one click." }, {
                fontSize: "16px", lineHeight: "1.6", color: "#6b7280", margin: "0 0 26px 0"
            }),
            n("button", { html: "Get Started", href: "#" }, {
                display: "inline-block", padding: "14px 32px", backgroundColor: accent,
                color: "#ffffff", borderRadius: "8px", fontSize: "15px", fontWeight: "600", textDecoration: "none"
            })
        ])
    ], "Section (CTA)", {
        mobile: { paddingTop: "48px", paddingBottom: "48px" }
    });

    var footer = n("section", { tag: "footer" }, {
        paddingTop: "34px", paddingBottom: "34px", paddingLeft: "24px", paddingRight: "24px",
        borderTop: "1px solid #e5e7eb", width: "100%", textAlign: "center"
    }, [
        n("text", { html: "&copy; " + (new Date()).getFullYear() + " " + siteName + ". Built with ArozOS Site Builder." }, {
            fontSize: "13.5px", color: "#9ca3af", margin: "0"
        })
    ], "Footer");

    return [hero, features, cta, footer];
}
