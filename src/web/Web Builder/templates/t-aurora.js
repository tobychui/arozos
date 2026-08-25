/*
    Aurora - SaaS product site.
    Indigo and violet, dark hero panel over a light page.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#6366f1",
        alt: "#f5f5ff",
        text: "#12142b",
        muted: "#5b6079",
        border: "#e4e4f2",
        headingFont: K.FONTS.inter,
        bodyFont: K.FONTS.inter,
        radius: "14px",
        pill: "10px",
        heroSize: "54px"
    });

    WBTemplates.register({
        id: "aurora",
        name: "Aurora",
        category: "SaaS",
        tagline: "Indigo SaaS landing page with a dark hero, stats and pricing-style cards.",
        theme: t,

        navBrandColor: "#ffffff",
        navLinkColor: "rgba(255,255,255,0.72)",
        navActiveColor: "#ffffff",

        pages: WBTemplatePreset.build({
            theme: t,
            navBrandColor: "#ffffff",
            navLinkColor: "rgba(255,255,255,0.72)",
            navActiveColor: "#a5b4fc",
            navCta: { label: "Start free", color: "#ffffff", textColor: "#12142b" },
            headerBg: "#12142b",
            headerText: "#ffffff",
            headerMuted: "rgba(255,255,255,0.7)",

            hero: {
                layout: "split",
                bg: "#12142b",
                eyebrow: "Ship faster",
                eyebrowColor: "#a5b4fc",
                title: "Let AI take your<br>workflow to the next level",
                titleColor: "#ffffff",
                sub: "One workspace for your docs, tasks and automations - so your team " +
                     "stops switching tabs and starts shipping.",
                subColor: "rgba(255,255,255,0.72)",
                primary: { label: "Start free", to: "Contact" },
                primaryColor: "#ffffff",
                primaryTextColor: "#12142b",
                secondary: { label: "See features", to: "Product" },
                secondaryBorder: "rgba(255,255,255,0.28)",
                secondaryText: "#ffffff",
                art: { glyph: "sparkle", from: "#6366f1", to: "#a855f7", height: "400px",
                       label: "Product tour" },
                padBottom: "104px"
            },

            stats: [
                { value: "8,400+", label: "Teams onboarded" },
                { value: "2.4M", label: "Tasks automated" },
                { value: "99.99%", label: "Uptime" },
                { value: "24/7", label: "Support" }
            ],

            features: {
                title: "Built for the way teams actually work",
                sub: "Every feature earns its place. Nothing here is a checkbox on a comparison table.",
                align: "center",
                card: true,
                items: [
                    { glyph: "sparkle", title: "Smart automations", body: "Describe the outcome and let the workspace wire up the steps." },
                    { glyph: "layers", title: "Unified workspace", body: "Docs, tasks and discussions share one searchable home." },
                    { glyph: "globe", title: "Works anywhere", body: "Fast on desktop, complete on mobile, offline when you need it." },
                    { glyph: "lock", title: "Enterprise ready", body: "SSO, audit trails and granular permissions from day one." },
                    { glyph: "clock", title: "Real-time sync", body: "Changes land instantly for everyone, with full history." },
                    { glyph: "gear", title: "Open API", body: "Automate anything the interface can do, and a bit more." }
                ]
            },

            showcase: {
                title: "From idea to launch without the handoffs",
                body: "Plan, build and ship in one place. No more copying context between five tools.",
                bullets: [
                    "Templates for every stage of delivery",
                    "Roadmaps that update themselves",
                    "Reports your stakeholders will actually read"
                ],
                button: "Explore the product",
                to: "Product",
                art: { from: "#818cf8", to: "#c084fc", glyph: "layers" }
            },

            second: {
                name: "Product", slug: "product",
                title: "The product",
                sub: "A closer look at what you get on every plan.",
                card: true,
                columns: 2,
                items: [
                    { glyph: "block", title: "Boards and timelines", body: "Switch view without losing your place, at any project size." },
                    { glyph: "text", title: "Collaborative docs", body: "Live editing with comments, mentions and version history." },
                    { glyph: "search", title: "Search that works", body: "Full text across everything, filtered by the things you care about." },
                    { glyph: "publish", title: "One-click deploys", body: "Ship updates to your team the moment they are approved." }
                ]
            },

            about: {
                title: "About Aurora",
                sub: "We build the workspace we wanted when we were the ones shipping.",
                storyTitle: "Software should feel calm",
                story: [
                    "Aurora started as an internal tool at a studio that was drowning in " +
                    "notifications. We rebuilt the way work moved through the team, then " +
                    "realised everyone else had the same problem.",
                    "We are a remote team of twelve, funded by our customers rather than " +
                    "by growth targets, and we intend to keep it that way."
                ],
                art: { from: "#6366f1", to: "#a855f7", glyph: "sparkle" },
                teamTitle: "The people behind it",
                team: [
                    { name: "Ana Petrova", role: "Product", from: "#818cf8", to: "#c084fc" },
                    { name: "Mikael Ohlsson", role: "Engineering", from: "#6366f1", to: "#38bdf8" },
                    { name: "Rina Takahashi", role: "Design", from: "#a855f7", to: "#f472b6" }
                ]
            },

            contact: {
                title: "Talk to us",
                sub: "Questions about a migration, a plan or a security review? Ask away.",
                submit: "Send message",
                panelTitle: "Direct lines",
                details: [
                    { label: "Sales", value: "sales@example.com" },
                    { label: "Support", value: "support@example.com" },
                    { label: "Office", value: "5F, Harbour Works<br>Hong Kong" }
                ]
            },

            cta: {
                title: "Start building with Aurora",
                body: "Free for your first workspace. No card, no sales call.",
                button: "Create a workspace",
                bg: "#12142b",
                titleColor: "#ffffff",
                bodyColor: "rgba(255,255,255,0.72)",
                buttonColor: "#ffffff",
                buttonTextColor: "#12142b"
            }
        })
    });
})();
