/*
    templates/kit.js

    The construction kit every site template is written with.

    A template describes its pages as plain "seed" objects - the same shape
    WBStarterPage() produces and WBModel.nodeFromSeed() consumes:

        { type, props, styles, children, name, tablet, mobile }

    These helpers exist so a template file reads like a page description rather
    than a wall of CSS, and so all twelve templates share the same responsive
    behaviour without each one reinventing it.

    Templates deliberately ship no image files. Photography is faked with
    gradient "art" blocks (K.art / K.avatar), which look designed rather than
    broken, publish as plain CSS, and keep the app free of binary assets.
*/

var WBTemplateKit = (function () {

    /* ------------------------------------------------------------ core -- */

    function n(type, props, styles, children, name, responsive) {
        var seed = {
            type: type,
            props: props || {},
            styles: styles || {},
            children: children || [],
            name: name
        };
        if (responsive) {
            if (responsive.tablet) { seed.tablet = responsive.tablet; }
            if (responsive.mobile) { seed.mobile = responsive.mobile; }
        }
        return seed;
    }

    function merge() {
        var out = {};
        for (var i = 0; i < arguments.length; i++) {
            var src = arguments[i];
            if (!src) { continue; }
            for (var k in src) { out[k] = src[k]; }
        }
        return out;
    }

    /* Font stacks, matching the names offered in the Design panel. */
    var FONTS = {
        system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        inter: "Inter, 'Segoe UI', sans-serif",
        poppins: "Poppins, 'Segoe UI', sans-serif",
        montserrat: "Montserrat, 'Segoe UI', sans-serif",
        playfair: "'Playfair Display', Georgia, serif",
        merriweather: "Merriweather, Georgia, serif",
        mono: "'Roboto Mono', Consolas, monospace",
        georgia: "Georgia, 'Times New Roman', serif"
    };

    /*
        A theme carries the handful of values every helper reads. Templates
        override what makes them distinctive and inherit the rest.
    */
    function theme(over) {
        return merge({
            accent: "#f97316",
            onAccent: "#ffffff",
            bg: "#ffffff",
            alt: "#f8f9fb",          /* alternating section background */
            surface: "#ffffff",       /* cards */
            text: "#111827",
            muted: "#6b7280",
            border: "#e5e7eb",
            headingFont: FONTS.system,
            bodyFont: FONTS.system,
            radius: "10px",
            pill: "8px",              /* button radius */
            heroSize: "56px",
            h2Size: "36px",
            tracking: "-0.025em",
            navWeight: "500",
            dark: false
        }, over);
    }

    /* ------------------------------------------------------- primitives -- */

    function section(t, opts, children, name) {
        opts = opts || {};
        return n("section", { tag: opts.tag || "section" }, merge({
            width: "100%",
            paddingTop: opts.padY || "84px",
            paddingBottom: opts.padY || "84px",
            paddingLeft: "24px",
            paddingRight: "24px",
            backgroundColor: opts.bg || t.bg
        }, opts.style), children, name, {
            mobile: merge({
                paddingTop: opts.padYMobile || "52px",
                paddingBottom: opts.padYMobile || "52px",
                paddingLeft: "18px",
                paddingRight: "18px"
            }, opts.mobile)
        });
    }

    function container(opts, children, name) {
        opts = opts || {};
        return n("container", {}, merge({
            maxWidth: opts.width || "1120px",
            marginLeft: "auto",
            marginRight: "auto",
            width: "100%"
        }, opts.style), children, name, opts.responsive);
    }

    /* A plain block that groups things without the centring of a container. */
    function box(style, children, name, responsive) {
        return n("container", {}, merge({
            maxWidth: "none", marginLeft: "0", marginRight: "0", width: "100%"
        }, style), children, name, responsive);
    }

    function row(children, opts) {
        opts = opts || {};
        return box(merge({
            display: "flex",
            flexDirection: "row",
            alignItems: opts.align || "center",
            justifyContent: opts.justify || "flex-start",
            gap: opts.gap || "16px",
            flexWrap: opts.wrap === false ? "nowrap" : "wrap"
        }, opts.style), children, opts.name, opts.responsive);
    }

    function stack(children, opts) {
        opts = opts || {};
        return box(merge({
            display: "flex",
            flexDirection: "column",
            alignItems: opts.align || "stretch",
            gap: opts.gap || "16px"
        }, opts.style), children, opts.name, opts.responsive);
    }

    function heading(t, text, opts) {
        opts = opts || {};
        return n("heading", { html: text, tag: opts.tag || "h2" }, merge({
            fontFamily: t.headingFont,
            fontSize: opts.size || t.h2Size,
            fontWeight: opts.weight || "700",
            lineHeight: opts.lineHeight || "1.15",
            letterSpacing: opts.tracking || t.tracking,
            color: opts.color || t.text,
            margin: opts.margin || "0 0 16px 0"
        }, opts.style), [], opts.name, {
            tablet: opts.tablet || (opts.size ? { fontSize: scale(opts.size, 0.82) } : null),
            mobile: opts.mobile || (opts.size ? { fontSize: scale(opts.size, 0.62) } : null)
        });
    }

    function scale(size, factor) {
        var num = parseFloat(size);
        if (!(num > 0)) { return size; }
        var unit = String(size).replace(/^-?[\d.]+/, "") || "px";
        return Math.round(num * factor) + unit;
    }

    function text(t, html, opts) {
        opts = opts || {};
        return n("text", { html: html, tag: opts.tag || "p" }, merge({
            fontFamily: t.bodyFont,
            fontSize: opts.size || "16px",
            lineHeight: opts.lineHeight || "1.7",
            color: opts.color || t.muted,
            margin: opts.margin || "0"
        }, opts.style), [], opts.name);
    }

    function eyebrow(t, label, opts) {
        opts = opts || {};
        return n("text", { html: label }, merge({
            fontFamily: t.bodyFont,
            fontSize: "12.5px",
            fontWeight: "600",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: opts.color || t.accent,
            margin: opts.margin || "0 0 14px 0"
        }, opts.style));
    }

    /*
        variant: "solid" (accent fill) | "outline" | "ghost" (bare link)
    */
    function button(t, label, href, opts) {
        opts = opts || {};
        var v = opts.variant || "solid";
        var base = {
            display: "inline-block",
            fontFamily: t.bodyFont,
            fontSize: opts.size || "15px",
            fontWeight: "600",
            textDecoration: "none",
            textAlign: "center",
            borderRadius: opts.radius || t.pill,
            padding: opts.padding || "14px 28px"
        };
        if (v === "solid") {
            base.backgroundColor = opts.color || t.accent;
            base.color = opts.textColor || t.onAccent;
        } else if (v === "outline") {
            base.backgroundColor = "transparent";
            base.color = opts.textColor || t.text;
            base.border = "1px solid " + (opts.color || t.border);
        } else {
            base.backgroundColor = "transparent";
            base.color = opts.textColor || t.accent;
            base.padding = "0";
            base.borderRadius = "0";
        }
        return n("button", { html: label, href: href || "#" }, merge(base, opts.style));
    }

    /* A nav-style text link: the Button element with its pill styling cleared. */
    function link(t, label, href, opts) {
        opts = opts || {};
        return n("button", { html: label, href: href || "#" }, merge({
            display: "inline-block",
            fontFamily: t.bodyFont,
            fontSize: opts.size || "15px",
            fontWeight: opts.active ? "600" : t.navWeight,
            color: opts.active ? (opts.activeColor || t.accent) : (opts.color || t.muted),
            textDecoration: "none",
            padding: "0",
            backgroundColor: "transparent",
            borderRadius: "0",
            margin: "0"
        }, opts.style));
    }

    function divider(t, opts) {
        opts = opts || {};
        return n("divider", {}, merge({
            border: "0",
            borderTop: "1px solid " + (opts.color || t.border),
            margin: opts.margin || "0",
            width: "100%"
        }, opts.style));
    }

    function spacer(height) {
        return n("spacer", {}, { height: height || "48px", width: "100%" });
    }

    function icon(t, glyph, opts) {
        opts = opts || {};
        return n("icon", { icon: glyph, size: opts.size || 24 }, merge({
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: opts.box || "52px",
            height: opts.box || "52px",
            borderRadius: opts.radius || t.radius,
            backgroundColor: opts.bg || tint(t.accent, 0.12),
            color: opts.color || t.accent
        }, opts.style));
    }

    /* ----------------------------------------------------------- colour -- */

    function rgb(hex) {
        hex = String(hex || "#000000").replace("#", "");
        if (hex.length === 3) { hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]; }
        return [parseInt(hex.substr(0, 2), 16), parseInt(hex.substr(2, 2), 16), parseInt(hex.substr(4, 2), 16)];
    }

    /* Translucent version of a colour, for soft backgrounds. */
    function tint(hex, alpha) {
        var c = rgb(hex);
        return "rgba(" + c[0] + ", " + c[1] + ", " + c[2] + ", " + alpha + ")";
    }

    /* Mix a colour towards white (amount > 0) or black (amount < 0). */
    function shade(hex, amount) {
        var c = rgb(hex);
        var target = amount > 0 ? 255 : 0;
        var f = Math.abs(amount);
        var out = c.map(function (v) { return Math.round(v + (target - v) * f); });
        return "rgb(" + out.join(", ") + ")";
    }

    /* --------------------------------------------------------- art work -- */

    /*
        A gradient panel standing in for a photograph. Templates use these
        instead of shipping images, so a new site looks composed on the very
        first render and still publishes as pure CSS.
    */
    function art(t, opts) {
        opts = opts || {};
        var from = opts.from || t.accent;
        var to = opts.to || shade(t.accent, 0.45);
        var kids = [];
        if (opts.glyph) {
            kids.push(n("icon", { icon: opts.glyph, size: opts.glyphSize || 46 }, {
                display: "inline-flex",
                color: opts.glyphColor || "rgba(255,255,255,0.92)"
            }));
        }
        if (opts.label) {
            kids.push(n("text", { html: opts.label }, {
                fontFamily: t.headingFont,
                fontSize: opts.labelSize || "17px",
                fontWeight: "600",
                color: opts.glyphColor || "rgba(255,255,255,0.94)",
                margin: "0",
                textAlign: "center"
            }));
        }
        return box(merge({
            minHeight: opts.height || "320px",
            borderRadius: opts.radius || t.radius,
            backgroundImage: opts.gradient ||
                ("linear-gradient(" + (opts.angle || "135deg") + ", " + from + " 0%, " + to + " 100%)"),
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            overflow: "hidden"
        }, opts.style), kids, opts.name || "Artwork", opts.responsive);
    }

    function avatar(t, opts) {
        opts = opts || {};
        return box(merge({
            width: opts.size || "56px",
            height: opts.size || "56px",
            borderRadius: "999px",
            backgroundImage: "linear-gradient(135deg, " + (opts.from || t.accent) + ", " +
                             (opts.to || shade(t.accent, 0.5)) + ")",
            flexShrink: "0"
        }, opts.style), [], "Avatar");
    }

    /* ---------------------------------------------------------- regions -- */

    /*
        Site navigation. `links` are built by the page context so every entry
        points at the real published file name of its page.
    */
    function nav(t, opts) {
        opts = opts || {};
        var items = [
            n("text", { html: "<strong>" + opts.brand + "</strong>" }, {
                fontFamily: t.headingFont,
                fontSize: "20px",
                fontWeight: "700",
                letterSpacing: t.tracking,
                color: opts.brandColor || t.text,
                margin: "0",
                marginRight: "auto"
            }, [], "Brand")
        ];
        (opts.links || []).forEach(function (l) {
            items.push(link(t, l.label, l.href, {
                active: l.active,
                color: opts.linkColor || t.muted,
                activeColor: opts.activeColor || t.accent,
                size: "15px"
            }));
        });
        if (opts.cta) {
            items.push(button(t, opts.cta.label, opts.cta.href, {
                size: "14px",
                padding: "11px 22px",
                variant: opts.cta.variant || "solid",
                color: opts.cta.color,
                textColor: opts.cta.textColor
            }));
        }

        return container({
            style: merge({
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: opts.gap || "34px",
                marginBottom: opts.marginBottom || "72px"
            }, opts.style)
        }, items, "Navbar");
    }

    function footer(t, opts) {
        opts = opts || {};
        var kids = [];
        var top = [
            n("text", { html: "<strong>" + opts.brand + "</strong>" }, {
                fontFamily: t.headingFont,
                fontSize: "17px",
                fontWeight: "700",
                color: opts.color || t.text,
                margin: "0",
                marginRight: "auto"
            })
        ];
        (opts.links || []).forEach(function (l) {
            top.push(link(t, l.label, l.href, { color: opts.mutedColor || t.muted, size: "14px" }));
        });
        kids.push(row(top, { gap: "26px", style: { marginBottom: "22px" } }));
        kids.push(divider(t, { color: opts.border || t.border, margin: "0 0 20px 0" }));
        kids.push(text(t, opts.note, {
            size: "13.5px",
            color: opts.mutedColor || t.muted,
            style: { textAlign: opts.align || "center" }
        }));

        return section(t, {
            tag: "footer",
            padY: "42px",
            padYMobile: "34px",
            bg: opts.bg || t.bg
        }, [container({}, kids)], "Footer");
    }

    /* Feature cards: [{ glyph, title, body }] */
    function featureGrid(t, items, opts) {
        opts = opts || {};
        var cols = opts.columns || Math.min(items.length, 3);
        var cells = items.map(function (it) {
            var inner = [];
            if (it.glyph) {
                inner.push(icon(t, it.glyph, {
                    bg: opts.iconBg || tint(t.accent, t.dark ? 0.18 : 0.12),
                    color: opts.iconColor || t.accent,
                    style: { marginBottom: "18px" }
                }));
            }
            inner.push(heading(t, it.title, {
                tag: "h3", size: "18px", margin: "0 0 8px 0", tracking: "-0.01em",
                color: opts.titleColor || t.text
            }));
            inner.push(text(t, it.body, { size: "14.5px", color: opts.bodyColor || t.muted }));

            return n("column", {}, { display: "flex", flexDirection: "column" }, [
                box(merge({
                    display: "flex",
                    flexDirection: "column",
                    alignItems: opts.align === "center" ? "center" : "flex-start",
                    textAlign: opts.align === "center" ? "center" : "left",
                    height: "100%",
                    padding: opts.card ? "28px" : "0",
                    backgroundColor: opts.card ? (opts.cardBg || t.surface) : "transparent",
                    borderRadius: opts.card ? t.radius : "0",
                    border: opts.card ? "1px solid " + (opts.cardBorder || t.border) : "0"
                }, opts.cardStyle), inner, it.title)
            ]);
        });

        return n("columns", { count: cols }, {
            display: "grid",
            gridTemplateColumns: "repeat(" + cols + ", 1fr)",
            gap: opts.gap || "28px",
            width: "100%"
        }, cells, opts.name || "Features", {
            tablet: { gridTemplateColumns: "repeat(" + Math.min(cols, 2) + ", 1fr)", gap: "22px" },
            mobile: { gridTemplateColumns: "repeat(1, 1fr)", gap: "20px" }
        });
    }

    /* Stat strip: [{ value, label }] */
    function stats(t, items, opts) {
        opts = opts || {};
        var cells = items.map(function (it) {
            return n("column", {}, { display: "flex", flexDirection: "column" }, [
                box({ textAlign: opts.align || "left" }, [
                    heading(t, it.value, {
                        tag: "h3",
                        size: opts.size || "40px",
                        margin: "0 0 4px 0",
                        color: opts.valueColor || t.accent
                    }),
                    text(t, it.label, { size: "14px", color: opts.labelColor || t.muted })
                ], it.label)
            ]);
        });
        return n("columns", { count: items.length }, {
            display: "grid",
            gridTemplateColumns: "repeat(" + items.length + ", 1fr)",
            gap: "24px",
            width: "100%"
        }, cells, "Stats", {
            mobile: { gridTemplateColumns: "repeat(2, 1fr)", gap: "26px" }
        });
    }

    /* Two-up split: content on one side, artwork on the other. */
    function split(t, opts) {
        opts = opts || {};
        var content = box({ display: "flex", flexDirection: "column", justifyContent: "center" },
            opts.content, opts.name || "Content");
        var media = opts.media || art(t, { height: "380px" });
        var order = opts.reverse ? [media, content] : [content, media];

        return n("columns", { count: 2 }, {
            display: "grid",
            gridTemplateColumns: opts.ratio || "1fr 1fr",
            gap: opts.gap || "56px",
            width: "100%",
            alignItems: "center"
        }, [
            n("column", {}, { display: "flex", flexDirection: "column" }, [order[0]]),
            n("column", {}, { display: "flex", flexDirection: "column" }, [order[1]])
        ], opts.blockName || "Split", {
            tablet: { gap: "32px" },
            mobile: { gridTemplateColumns: "repeat(1, 1fr)", gap: "28px" }
        });
    }

    /* Closing call to action. */
    function cta(t, opts) {
        opts = opts || {};
        return section(t, { bg: opts.bg || t.alt, padY: opts.padY || "78px" }, [
            container({ width: opts.width || "720px", style: { textAlign: "center" } }, [
                heading(t, opts.title, {
                    size: opts.size || "34px",
                    margin: "0 0 14px 0",
                    color: opts.titleColor || t.text
                }),
                text(t, opts.body, {
                    size: "16px",
                    color: opts.bodyColor || t.muted,
                    style: { margin: "0 0 26px 0" }
                }),
                row([
                    button(t, opts.button || "Get Started", opts.href || "#", {
                        color: opts.buttonColor,
                        textColor: opts.buttonTextColor
                    })
                ], { justify: "center" })
            ])
        ], opts.name || "Section (CTA)");
    }

    /* Simple labelled contact form. */
    function contactForm(t, opts) {
        opts = opts || {};
        return n("form", { action: "", method: "post" }, {
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            width: "100%",
            maxWidth: opts.width || "520px"
        }, [
            n("input", { label: "Name", name: "name", inputType: "text", placeholder: "Your name", required: true },
                { display: "flex", flexDirection: "column", gap: "7px", fontSize: "14px",
                  fontFamily: t.bodyFont, color: t.text, width: "100%" }),
            n("input", { label: "Email", name: "email", inputType: "email", placeholder: "you@example.com", required: true },
                { display: "flex", flexDirection: "column", gap: "7px", fontSize: "14px",
                  fontFamily: t.bodyFont, color: t.text, width: "100%" }),
            n("textarea", { label: "Message", name: "message", rows: 5, placeholder: "How can we help?" },
                { display: "flex", flexDirection: "column", gap: "7px", fontSize: "14px",
                  fontFamily: t.bodyFont, color: t.text, width: "100%" }),
            n("submit", { html: opts.submit || "Send message" }, {
                display: "inline-block",
                padding: "13px 26px",
                backgroundColor: t.accent,
                color: t.onAccent,
                border: "0",
                borderRadius: t.pill,
                fontFamily: t.bodyFont,
                fontSize: "15px",
                fontWeight: "600",
                cursor: "pointer",
                alignSelf: "flex-start"
            })
        ], "Contact Form");
    }

    return {
        n: n,
        merge: merge,
        FONTS: FONTS,
        theme: theme,
        section: section,
        container: container,
        box: box,
        row: row,
        stack: stack,
        heading: heading,
        text: text,
        eyebrow: eyebrow,
        button: button,
        link: link,
        divider: divider,
        spacer: spacer,
        icon: icon,
        art: art,
        avatar: avatar,
        tint: tint,
        shade: shade,
        scale: scale,
        nav: nav,
        footer: footer,
        featureGrid: featureGrid,
        stats: stats,
        split: split,
        cta: cta,
        contactForm: contactForm
    };
})();
