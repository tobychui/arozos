/*
    Ember - startup / product launch.
    Warm orange on white; the house look of the builder itself.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#f97316",
        alt: "#fff7ed",
        text: "#111827",
        muted: "#6b7280",
        border: "#e5e7eb",
        headingFont: K.FONTS.poppins,
        bodyFont: K.FONTS.inter,
        heroSize: "56px"
    });

    function nav(ctx, active) {
        return K.nav(t, {
            brand: ctx.site,
            links: [
                { label: "Home", href: ctx.link("Home"), active: active === "Home" },
                { label: "Features", href: ctx.link("Features"), active: active === "Features" },
                { label: "Pricing", href: ctx.link("Pricing"), active: active === "Pricing" },
                { label: "About", href: ctx.link("About"), active: active === "About" }
            ],
            cta: { label: "Get Started", href: ctx.link("Contact") }
        });
    }

    function foot(ctx) {
        return K.footer(t, {
            brand: ctx.site,
            links: [
                { label: "Features", href: ctx.link("Features") },
                { label: "Pricing", href: ctx.link("Pricing") },
                { label: "About", href: ctx.link("About") },
                { label: "Contact", href: ctx.link("Contact") }
            ],
            note: "&copy; " + (new Date()).getFullYear() + " " + ctx.site + ". All rights reserved.",
            bg: t.bg
        });
    }

    function pageHead(ctx, active, title, sub) {
        return K.section(t, { padY: "40px", style: { paddingBottom: "24px" } }, [
            nav(ctx, active),
            K.container({}, [
                K.heading(t, title, { tag: "h1", size: "44px", margin: "0 0 14px 0" }),
                K.text(t, sub, { size: "17px" })
            ])
        ], "Section (Header)");
    }

    WBTemplates.register({
        id: "ember",
        name: "Ember",
        category: "Startup",
        tagline: "Warm, friendly product launch site with pricing and features.",
        theme: t,

        pages: [
            {
                name: "Home", slug: "", title: "",
                build: function (ctx) {
                    return [
                        K.section(t, { padY: "40px", style: { paddingBottom: "96px" } }, [
                            nav(ctx, "Home"),
                            K.container({}, [
                                K.split(t, {
                                    ratio: "1.05fr 1fr",
                                    content: [
                                        K.eyebrow(t, "Now in public beta"),
                                        K.heading(t, "Build Your Vision.<br>Create Without Limits.", {
                                            tag: "h1", size: t.heroSize, lineHeight: "1.1", margin: "0 0 20px 0"
                                        }, "Heading"),
                                        K.text(t, "A modern and intuitive platform that turns your ideas into a " +
                                            "polished product - without a single line of code.", {
                                            size: "17px", style: { margin: "0 0 32px 0", maxWidth: "460px" }
                                        }),
                                        K.row([
                                            K.button(t, "Start free", ctx.link("Contact")),
                                            K.button(t, "See pricing", ctx.link("Pricing"), { variant: "outline" })
                                        ], { gap: "12px", name: "Buttons" })
                                    ],
                                    media: K.art(t, {
                                        height: "420px", glyph: "sparkle", label: "Your product here",
                                        from: "#fb923c", to: "#ea580c"
                                    })
                                })
                            ], "Hero")
                        ], "Section (Hero)"),

                        K.section(t, { bg: t.alt }, [
                            K.container({}, [
                                K.stats(t, [
                                    { value: "12k+", label: "Sites published" },
                                    { value: "99.9%", label: "Uptime" },
                                    { value: "4.9", label: "Average rating" },
                                    { value: "40+", label: "Integrations" }
                                ], { align: "center" })
                            ])
                        ], "Section (Stats)"),

                        K.section(t, {}, [
                            K.container({ style: { textAlign: "center" } }, [
                                K.heading(t, "Everything you need, nothing you don't", { margin: "0 0 12px 0" }),
                                K.text(t, "Thoughtful defaults, sensible limits and an editor that stays out of your way.", {
                                    style: { margin: "0 auto 44px", maxWidth: "560px" }
                                }),
                                K.featureGrid(t, [
                                    { glyph: "sparkle", title: "Fast &amp; Lightweight",
                                      body: "Optimized for speed and performance across every device." },
                                    { glyph: "palette", title: "Beautiful Templates",
                                      body: "Start from a professionally designed layout and make it yours." },
                                    { glyph: "block", title: "Easy to Customize",
                                      body: "Drag, drop and edit until it looks exactly the way you want." }
                                ], { align: "center" })
                            ])
                        ], "Section (Features)"),

                        K.cta(t, {
                            title: "Ready to start building?",
                            body: "Publish straight to your personal site in one click.",
                            button: "Get Started", href: ctx.link("Contact")
                        }),
                        foot(ctx)
                    ];
                }
            },

            {
                name: "Features", slug: "features",
                build: function (ctx) {
                    return [
                        pageHead(ctx, "Features", "Features",
                            "Everything the platform does, in one place."),
                        K.section(t, { padY: "56px" }, [
                            K.container({}, [
                                K.featureGrid(t, [
                                    { glyph: "layers", title: "Visual editor", body: "Compose pages from blocks and see the result instantly." },
                                    { glyph: "phone-rotate", title: "Responsive by default", body: "Tune each breakpoint without duplicating your work." },
                                    { glyph: "globe", title: "One-click publish", body: "Your site goes live on your own domain in seconds." },
                                    { glyph: "lock", title: "Private by design", body: "Your content stays on hardware you control." },
                                    { glyph: "gear", title: "Custom code", body: "Drop in your own HTML and CSS whenever you need to." },
                                    { glyph: "clock", title: "Version history", body: "Every change is undoable, all the way back." }
                                ], { columns: 3, card: true })
                            ])
                        ], "Section (Feature Grid)"),
                        K.cta(t, { title: "See it in action", body: "Take a look at the pricing and pick a plan.",
                                   button: "View pricing", href: ctx.link("Pricing") }),
                        foot(ctx)
                    ];
                }
            },

            {
                name: "Pricing", slug: "pricing",
                build: function (ctx) {
                    function plan(name, price, note, features, featured) {
                        var kids = [
                            K.heading(t, name, { tag: "h3", size: "18px", margin: "0 0 6px 0",
                                                 color: featured ? "#ffffff" : t.text }),
                            K.heading(t, price, { tag: "h4", size: "38px", margin: "0 0 4px 0",
                                                  color: featured ? "#ffffff" : t.accent }),
                            K.text(t, note, { size: "13.5px", color: featured ? "rgba(255,255,255,0.8)" : t.muted,
                                              style: { margin: "0 0 20px 0" } })
                        ];
                        features.forEach(function (f) {
                            kids.push(K.row([
                                K.n("icon", { icon: "check", size: 15 }, {
                                    display: "inline-flex",
                                    color: featured ? "#ffffff" : t.accent
                                }),
                                K.text(t, f, { size: "14px",
                                    color: featured ? "rgba(255,255,255,0.9)" : t.muted })
                            ], { gap: "9px", wrap: false, style: { marginBottom: "10px" } }));
                        });
                        kids.push(K.button(t, "Choose " + name, ctx.link("Contact"), {
                            style: { marginTop: "18px", width: "100%" },
                            color: featured ? "#ffffff" : t.accent,
                            textColor: featured ? t.accent : t.onAccent
                        }));

                        return K.n("column", {}, { display: "flex", flexDirection: "column" }, [
                            K.box({
                                padding: "30px",
                                borderRadius: t.radius,
                                border: "1px solid " + (featured ? t.accent : t.border),
                                backgroundColor: featured ? t.accent : t.surface,
                                height: "100%",
                                display: "flex",
                                flexDirection: "column"
                            }, kids, name + " Plan")
                        ]);
                    }

                    return [
                        pageHead(ctx, "Pricing", "Simple pricing",
                            "No contracts, no surprises. Change plan whenever you like."),
                        K.section(t, { padY: "56px" }, [
                            K.container({}, [
                                K.n("columns", { count: 3 }, {
                                    display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
                                    gap: "22px", width: "100%", alignItems: "stretch"
                                }, [
                                    plan("Starter", "Free", "For personal projects",
                                        ["1 site", "Community support", "Publish to /www"]),
                                    plan("Pro", "$9", "per month, billed yearly",
                                        ["Unlimited sites", "Custom domain", "Priority support"], true),
                                    plan("Team", "$29", "per month, billed yearly",
                                        ["Everything in Pro", "5 collaborators", "Shared assets"])
                                ], "Plans", {
                                    tablet: { gridTemplateColumns: "repeat(2, 1fr)" },
                                    mobile: { gridTemplateColumns: "repeat(1, 1fr)" }
                                })
                            ])
                        ], "Section (Plans)"),
                        foot(ctx)
                    ];
                }
            },

            {
                name: "About", slug: "about",
                build: function (ctx) {
                    return [
                        pageHead(ctx, "About", "About " + ctx.site,
                            "A small team with a stubborn belief that publishing should be simple."),
                        K.section(t, { padY: "56px" }, [
                            K.container({}, [
                                K.split(t, {
                                    reverse: true,
                                    content: [
                                        K.heading(t, "We started with one frustration", { size: "30px" }),
                                        K.text(t, "Every website tool wanted a subscription, an account and a slice " +
                                            "of your data. We wanted something that runs on your own machine and " +
                                            "gets out of the way.", { style: { marginBottom: "16px" } }),
                                        K.text(t, "Today the same editor powers thousands of personal sites, " +
                                            "portfolios and small business pages.")
                                    ],
                                    media: K.art(t, { height: "340px", glyph: "sparkle", from: "#fdba74", to: "#f97316" })
                                })
                            ])
                        ], "Section (Story)"),
                        K.cta(t, { title: "Want to get in touch?", body: "We answer every message ourselves.",
                                   button: "Contact us", href: ctx.link("Contact") }),
                        foot(ctx)
                    ];
                }
            },

            {
                name: "Contact", slug: "contact",
                build: function (ctx) {
                    return [
                        pageHead(ctx, "Contact", "Get in touch",
                            "Tell us what you are building and we will help you get there."),
                        K.section(t, { padY: "56px" }, [
                            K.container({}, [
                                K.split(t, {
                                    ratio: "1fr 0.85fr",
                                    content: [K.contactForm(t, {})],
                                    media: K.box({
                                        padding: "30px", borderRadius: t.radius,
                                        backgroundColor: t.alt, display: "flex",
                                        flexDirection: "column", gap: "18px"
                                    }, [
                                        K.heading(t, "Other ways to reach us", { tag: "h3", size: "18px", margin: "0" }),
                                        K.text(t, "<strong>Email</strong><br>hello@example.com", { size: "14.5px" }),
                                        K.text(t, "<strong>Office</strong><br>Unit 12, Maker Building<br>Hong Kong", { size: "14.5px" }),
                                        K.text(t, "<strong>Hours</strong><br>Monday to Friday, 9am - 6pm", { size: "14.5px" })
                                    ], "Contact Details")
                                })
                            ])
                        ], "Section (Contact)"),
                        foot(ctx)
                    ];
                }
            }
        ]
    });
})();
