/*
    templates/preset.js

    A four-page site generator (Home / feature page / About / Contact) that the
    templates share.

    Without this, eleven template files would each repeat the same navigation,
    header, story and contact plumbing, and they would drift apart the first
    time one of them was fixed. Templates supply a theme, their copy and a few
    layout switches; everything structural lives here.

    Layout switches that actually change the shape of the page:
        hero.layout    "split" | "center" | "stack"
        features.card  cards on a tinted surface, or bare columns
        second.layout  "cards" | "art" | "list"
*/

var WBTemplatePreset = (function () {

    var K = WBTemplateKit;

    function build(cfg) {
        var t = cfg.theme;
        var secondName = cfg.second.name;

        function navFor(ctx, active) {
            return K.nav(t, {
                brand: ctx.site,
                brandColor: cfg.navBrandColor || t.text,
                linkColor: cfg.navLinkColor || t.muted,
                activeColor: cfg.navActiveColor || t.accent,
                gap: cfg.navGap || "34px",
                marginBottom: cfg.navMargin || "72px",
                links: [
                    { label: "Home", href: ctx.link("Home"), active: active === "Home" },
                    { label: secondName, href: ctx.link(secondName), active: active === secondName },
                    { label: "About", href: ctx.link("About"), active: active === "About" },
                    { label: "Contact", href: ctx.link("Contact"), active: active === "Contact" }
                ],
                cta: cfg.navCta === false ? null : {
                    label: (cfg.navCta && cfg.navCta.label) || "Get in touch",
                    href: ctx.link("Contact"),
                    variant: (cfg.navCta && cfg.navCta.variant) || "solid",
                    color: cfg.navCta && cfg.navCta.color,
                    textColor: cfg.navCta && cfg.navCta.textColor
                }
            });
        }

        function footFor(ctx) {
            return K.footer(t, {
                brand: ctx.site,
                bg: cfg.footerBg || t.bg,
                color: cfg.footerColor || t.text,
                mutedColor: cfg.footerMuted || t.muted,
                border: cfg.footerBorder || t.border,
                links: [
                    { label: secondName, href: ctx.link(secondName) },
                    { label: "About", href: ctx.link("About") },
                    { label: "Contact", href: ctx.link("Contact") }
                ],
                note: "&copy; " + (new Date()).getFullYear() + " " + ctx.site + ". " +
                      (cfg.footerNote || "All rights reserved.")
            });
        }

        /* Inner page banner: nav plus a title block on the same background. */
        function header(ctx, active, title, sub) {
            return K.section(t, {
                padY: "40px",
                bg: cfg.headerBg || t.bg,
                style: { paddingBottom: "26px" }
            }, [
                navFor(ctx, active),
                K.container({}, [
                    K.heading(t, title, {
                        tag: "h1", size: cfg.pageTitleSize || "44px", margin: "0 0 14px 0",
                        color: cfg.headerText || t.text
                    }),
                    K.text(t, sub, { size: "17px", color: cfg.headerMuted || t.muted,
                                     style: { maxWidth: "640px" } })
                ])
            ], "Section (Header)");
        }

        /* ---------------------------------------------------------- hero -- */

        function hero(ctx) {
            var h = cfg.hero;
            var layout = h.layout || "split";
            var buttons = [K.button(t, h.primary.label, ctx.link(h.primary.to || "Contact"), {
                color: h.primaryColor, textColor: h.primaryTextColor
            })];
            if (h.secondary) {
                buttons.push(K.button(t, h.secondary.label, ctx.link(h.secondary.to || secondName), {
                    variant: "outline",
                    color: h.secondaryBorder || t.border,
                    textColor: h.secondaryText || t.text
                }));
            }

            var copy = [];
            if (h.eyebrow) { copy.push(K.eyebrow(t, h.eyebrow, { color: h.eyebrowColor || t.accent })); }
            copy.push(K.heading(t, h.title, {
                tag: "h1",
                size: h.size || t.heroSize,
                lineHeight: h.lineHeight || "1.08",
                weight: h.weight || "700",
                tracking: h.tracking,
                color: h.titleColor || t.text,
                margin: "0 0 20px 0",
                style: h.titleStyle
            }, "Heading"));
            copy.push(K.text(t, h.sub, {
                size: "17px",
                color: h.subColor || t.muted,
                style: { margin: "0 0 32px 0", maxWidth: layout === "center" ? "620px" : "480px" }
            }));
            copy.push(K.row(buttons, {
                gap: "12px", name: "Buttons",
                justify: layout === "center" ? "center" : "flex-start"
            }));

            var artNode = K.art(t, K.merge({ height: "420px" }, h.art));

            var inner;
            if (layout === "center") {
                var extras = (h.art === false) ? [] : [
                    K.box({ marginTop: "52px" }, [K.art(t, K.merge({ height: "380px" }, h.art))], "Showcase")
                ];
                inner = K.container({ width: h.width || "820px", style: { textAlign: "center" } },
                    copy.concat(extras), "Hero");
            } else if (layout === "stack") {
                inner = K.container({}, [
                    K.box({}, copy, "Hero Content"),
                    K.box({ marginTop: "56px" }, [K.art(t, K.merge({ height: "440px" }, h.art))], "Showcase")
                ], "Hero");
            } else {
                inner = K.container({}, [
                    K.split(t, {
                        ratio: h.ratio || "1.05fr 1fr",
                        reverse: h.reverse,
                        content: copy,
                        media: artNode
                    })
                ], "Hero");
            }

            return K.section(t, {
                padY: "40px",
                bg: h.bg || t.bg,
                style: K.merge({ paddingBottom: h.padBottom || "96px" }, h.style)
            }, [navFor(ctx, "Home"), inner], "Section (Hero)");
        }

        /* ------------------------------------------------------- sections -- */

        function featureSection(ctx) {
            var f = cfg.features;
            var head = [];
            if (f.title) {
                head.push(K.heading(t, f.title, {
                    margin: "0 0 12px 0", color: f.titleColor || t.text
                }));
            }
            if (f.sub) {
                head.push(K.text(t, f.sub, {
                    color: f.subColor || t.muted,
                    style: { margin: f.align === "center" ? "0 auto 44px" : "0 0 44px",
                             maxWidth: "580px" }
                }));
            }
            head.push(K.featureGrid(t, f.items, {
                align: f.align || "left",
                card: !!f.card,
                columns: f.columns,
                cardBg: f.cardBg,
                cardBorder: f.cardBorder,
                iconBg: f.iconBg,
                iconColor: f.iconColor,
                titleColor: f.titleColor2 || t.text,
                bodyColor: f.bodyColor || t.muted
            }));

            return K.section(t, { bg: f.bg || t.bg }, [
                K.container({ style: f.align === "center" ? { textAlign: "center" } : {} }, head)
            ], "Section (Features)");
        }

        function statsSection() {
            if (!cfg.stats) { return null; }
            return K.section(t, { bg: cfg.statsBg || t.alt, padY: "56px" }, [
                K.container({}, [
                    K.stats(t, cfg.stats, {
                        align: cfg.statsAlign || "center",
                        valueColor: cfg.statsColor || t.accent,
                        labelColor: cfg.statsLabelColor || t.muted
                    })
                ])
            ], "Section (Stats)");
        }

        function showcaseSection(ctx) {
            var s = cfg.showcase;
            if (!s) { return null; }
            var content = [
                K.heading(t, s.title, { size: s.size || "32px", color: s.titleColor || t.text }),
                K.text(t, s.body, { color: s.bodyColor || t.muted, style: { marginBottom: "20px" } })
            ];
            (s.bullets || []).forEach(function (b) {
                content.push(K.row([
                    K.n("icon", { icon: s.glyph || "check", size: 15 }, {
                        display: "inline-flex", color: s.accent || t.accent, marginTop: "3px"
                    }),
                    K.text(t, b, { size: "15px", color: s.bodyColor || t.muted })
                ], { gap: "10px", align: "flex-start", wrap: false, style: { marginBottom: "12px" } }));
            });
            if (s.button) {
                content.push(K.button(t, s.button, ctx.link(s.to || secondName), {
                    style: { marginTop: "14px" }
                }));
            }

            return K.section(t, { bg: s.bg || t.bg }, [
                K.container({}, [
                    K.split(t, {
                        reverse: s.reverse !== false,
                        content: content,
                        media: K.art(t, K.merge({ height: "400px" }, s.art))
                    })
                ])
            ], "Section (Showcase)");
        }

        function ctaSection(ctx) {
            return K.cta(t, {
                title: cfg.cta.title,
                body: cfg.cta.body,
                button: cfg.cta.button || "Get in touch",
                href: ctx.link(cfg.cta.to || "Contact"),
                bg: cfg.cta.bg || t.alt,
                titleColor: cfg.cta.titleColor,
                bodyColor: cfg.cta.bodyColor,
                buttonColor: cfg.cta.buttonColor,
                buttonTextColor: cfg.cta.buttonTextColor
            });
        }

        /* ------------------------------------------------- second page -- */

        function secondPageBody(ctx) {
            var s = cfg.second;
            var layout = s.layout || "cards";

            if (layout === "art") {
                /* portfolio style: a grid of artwork tiles with captions */
                var tiles = s.items.map(function (it, i) {
                    return K.n("column", {}, { display: "flex", flexDirection: "column" }, [
                        K.box({ display: "flex", flexDirection: "column", gap: "14px" }, [
                            K.art(t, K.merge({
                                height: it.height || (i % 3 === 0 ? "320px" : "260px"),
                                glyph: it.glyph,
                                from: it.from, to: it.to,
                                angle: it.angle
                            }, s.art)),
                            K.box({}, [
                                K.heading(t, it.title, { tag: "h3", size: "18px", margin: "0 0 4px 0" }),
                                K.text(t, it.body, { size: "14px" })
                            ])
                        ], it.title)
                    ]);
                });
                return K.n("columns", { count: s.columns || 2 }, {
                    display: "grid",
                    gridTemplateColumns: "repeat(" + (s.columns || 2) + ", 1fr)",
                    gap: "34px", width: "100%"
                }, tiles, "Work Grid", {
                    mobile: { gridTemplateColumns: "repeat(1, 1fr)", gap: "28px" }
                });
            }

            if (layout === "list") {
                /* menu / price list style: rows with a trailing value */
                var rows = s.items.map(function (it) {
                    return K.box({
                        display: "flex", alignItems: "baseline", gap: "16px",
                        paddingTop: "18px", paddingBottom: "18px",
                        borderBottom: "1px solid " + t.border
                    }, [
                        K.box({ flex: "1", minWidth: "0" }, [
                            K.heading(t, it.title, { tag: "h3", size: "18px", margin: "0 0 4px 0" }),
                            K.text(t, it.body, { size: "14px" })
                        ]),
                        K.text(t, it.meta || "", {
                            size: "17px",
                            color: t.accent,
                            style: { fontWeight: "600", whiteSpace: "nowrap" }
                        })
                    ], it.title);
                });
                return K.box({ display: "flex", flexDirection: "column" }, rows, "List");
            }

            return K.featureGrid(t, s.items, {
                card: s.card !== false,
                columns: s.columns || 3,
                align: s.align || "left",
                cardBg: s.cardBg,
                cardBorder: s.cardBorder,
                iconBg: s.iconBg,
                iconColor: s.iconColor,
                bodyColor: cfg.features.bodyColor
            });
        }

        /* ------------------------------------------------------- pages -- */

        var pages = [];

        pages.push({
            name: "Home", slug: "", title: "",
            description: cfg.description || "",
            build: function (ctx) {
                var out = [hero(ctx)];
                var st = statsSection();
                if (st) { out.push(st); }
                out.push(featureSection(ctx));
                var sc = showcaseSection(ctx);
                if (sc) { out.push(sc); }
                out.push(ctaSection(ctx));
                out.push(footFor(ctx));
                return out;
            }
        });

        pages.push({
            name: cfg.second.name,
            slug: cfg.second.slug || WBModel.slugify(cfg.second.name),
            build: function (ctx) {
                return [
                    header(ctx, secondName, cfg.second.title, cfg.second.sub),
                    K.section(t, { padY: "56px", bg: cfg.second.bg || t.bg }, [
                        K.container({}, [secondPageBody(ctx)])
                    ], "Section (" + secondName + ")"),
                    ctaSection(ctx),
                    footFor(ctx)
                ];
            }
        });

        pages.push({
            name: "About", slug: "about",
            build: function (ctx) {
                var story = [K.heading(t, cfg.about.storyTitle, { size: "30px" })];
                (cfg.about.story || []).forEach(function (p, i) {
                    story.push(K.text(t, p, { style: { marginBottom: i === 0 ? "16px" : "0" } }));
                });

                var blocks = [
                    header(ctx, "About", cfg.about.title, cfg.about.sub),
                    K.section(t, { padY: "56px" }, [
                        K.container({}, [
                            K.split(t, {
                                reverse: true,
                                content: story,
                                media: K.art(t, K.merge({ height: "360px" }, cfg.about.art))
                            })
                        ])
                    ], "Section (Story)")
                ];

                if (cfg.about.team && cfg.about.team.length) {
                    var members = cfg.about.team.map(function (m) {
                        return K.n("column", {}, { display: "flex", flexDirection: "column" }, [
                            K.box({ display: "flex", flexDirection: "column", alignItems: "center",
                                    textAlign: "center", gap: "12px" }, [
                                K.avatar(t, { size: "84px", from: m.from, to: m.to }),
                                K.box({}, [
                                    K.heading(t, m.name, { tag: "h3", size: "16px", margin: "0 0 2px 0" }),
                                    K.text(t, m.role, { size: "13.5px" })
                                ])
                            ], m.name)
                        ]);
                    });
                    blocks.push(K.section(t, { bg: t.alt, padY: "62px" }, [
                        K.container({ style: { textAlign: "center" } }, [
                            K.heading(t, cfg.about.teamTitle || "The team", { margin: "0 0 36px 0" }),
                            K.n("columns", { count: members.length }, {
                                display: "grid",
                                gridTemplateColumns: "repeat(" + members.length + ", 1fr)",
                                gap: "28px", width: "100%"
                            }, members, "Team", {
                                mobile: { gridTemplateColumns: "repeat(2, 1fr)", gap: "26px" }
                            })
                        ])
                    ], "Section (Team)"));
                }

                blocks.push(ctaSection(ctx));
                blocks.push(footFor(ctx));
                return blocks;
            }
        });

        pages.push({
            name: "Contact", slug: "contact",
            build: function (ctx) {
                var details = (cfg.contact.details || []).map(function (d) {
                    return K.text(t, "<strong>" + d.label + "</strong><br>" + d.value, { size: "14.5px" });
                });
                return [
                    header(ctx, "Contact", cfg.contact.title, cfg.contact.sub),
                    K.section(t, { padY: "56px" }, [
                        K.container({}, [
                            K.split(t, {
                                ratio: "1fr 0.8fr",
                                content: [K.contactForm(t, { submit: cfg.contact.submit })],
                                media: K.box({
                                    padding: "30px",
                                    borderRadius: t.radius,
                                    backgroundColor: cfg.contact.panelBg || t.alt,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "18px"
                                }, [
                                    K.heading(t, cfg.contact.panelTitle || "Find us", {
                                        tag: "h3", size: "18px", margin: "0"
                                    })
                                ].concat(details), "Contact Details")
                            })
                        ])
                    ], "Section (Contact)"),
                    footFor(ctx)
                ];
            }
        });

        return pages;
    }

    return { build: build };
})();
