/*
    Cobalt - fintech / banking.
    Deep blue, crisp white cards, numbers front and centre.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#2563eb",
        alt: "#f2f5fb",
        bg: "#ffffff",
        text: "#0d1b33",
        muted: "#5b6b86",
        border: "#dde5f2",
        headingFont: K.FONTS.inter,
        bodyFont: K.FONTS.inter,
        radius: "16px",
        pill: "10px",
        heroSize: "52px"
    });

    WBTemplates.register({
        id: "cobalt",
        name: "Cobalt",
        category: "Finance",
        tagline: "Confident blue fintech site with stat strips and product cards.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navCta: { label: "Open an account" },
            statsBg: "#0d1b33",
            statsColor: "#60a5fa",
            statsLabelColor: "rgba(255,255,255,0.66)",

            hero: {
                layout: "split",
                reverse: true,
                ratio: "1fr 0.9fr",
                eyebrow: "Personal banking",
                title: "Digital banking<br>for smart people",
                sub: "Spend, save and borrow in one account, with the rates published on " +
                     "the same page as the product.",
                primary: { label: "Open an account", to: "Contact" },
                secondary: { label: "Compare accounts", to: "Solutions" },
                art: { from: "#2563eb", to: "#1e1b4b", height: "440px", glyph: "box",
                       label: "Your account, at a glance" }
            },

            stats: [
                { value: "1.2M", label: "Customers" },
                { value: "4.6%", label: "Savings rate" },
                { value: "0", label: "Monthly fees" },
                { value: "A+", label: "Credit rating" }
            ],

            features: {
                title: "Everything in one account",
                sub: "No upsells, no tiers that quietly withdraw features.",
                card: true,
                columns: 3,
                items: [
                    { glyph: "clock", title: "Instant transfers", body: "Money moves in seconds, including at weekends." },
                    { glyph: "lock", title: "Card controls", body: "Freeze, unfreeze and set limits from the app in one tap." },
                    { glyph: "list", title: "Automatic budgets", body: "Spending sorted into categories you can actually rename." },
                    { glyph: "globe", title: "No FX markup", body: "Interbank rates abroad, with the fee shown before you pay." },
                    { glyph: "check", title: "Protected deposits", body: "Covered up to the statutory limit, held with partner banks." },
                    { glyph: "help", title: "Humans on support", body: "Average answer time under two minutes, day or night." }
                ]
            },

            showcase: {
                title: "Made simple with real numbers",
                body: "Every product page shows the rate, the fee and the total cost before " +
                      "you apply. Nothing is buried in a footnote.",
                bullets: [
                    "Representative examples on every credit product",
                    "Rate changes announced 30 days ahead",
                    "Statements you can actually export"
                ],
                bg: t.alt,
                art: { from: "#60a5fa", to: "#1d4ed8", glyph: "list" }
            },

            second: {
                name: "Solutions", slug: "solutions",
                title: "Accounts and products",
                sub: "Pick what you need. Add the rest later without a new application.",
                card: true,
                columns: 2,
                items: [
                    { glyph: "box", title: "Everyday account", body: "Current account, card and instant transfers. No monthly fee." },
                    { glyph: "sparkle", title: "Savings pots", body: "Split savings into goals, each earning the headline rate." },
                    { glyph: "publish", title: "Business banking", body: "Multi-user access, invoicing and bookkeeping exports." },
                    { glyph: "home", title: "Mortgages", body: "Fixed and tracker products with a decision in principle in minutes." }
                ]
            },

            about: {
                title: "About Cobalt",
                sub: "A bank built by people who used to write the complaint responses.",
                storyTitle: "Banking without the small print",
                story: [
                    "We started in 2018 with one rule: if a product needs a footnote to " +
                    "look good, we do not launch it.",
                    "Cobalt is licensed and regulated, deposits are protected, and our " +
                    "pricing has never changed without thirty days notice."
                ],
                art: { from: "#2563eb", to: "#0d1b33", glyph: "lock" },
                teamTitle: "Leadership",
                team: [
                    { name: "Jonas Weber", role: "Chief executive", from: "#2563eb", to: "#1e3a8a" },
                    { name: "Amara Boateng", role: "Risk", from: "#60a5fa", to: "#1d4ed8" },
                    { name: "Kenji Sato", role: "Technology", from: "#3b82f6", to: "#0d1b33" }
                ]
            },

            contact: {
                title: "Talk to us",
                sub: "Account questions, complaints or press - all handled by real people.",
                submit: "Send message",
                panelTitle: "Reach us",
                details: [
                    { label: "Support", value: "Open 24 hours<br>support@example.com" },
                    { label: "Press", value: "press@example.com" },
                    { label: "Registered office", value: "30 Finsbury Circle<br>Hong Kong" }
                ]
            },

            cta: {
                title: "Open an account in ten minutes",
                body: "All you need is photo ID and a phone.",
                button: "Get started",
                bg: "#0d1b33",
                titleColor: "#ffffff",
                bodyColor: "rgba(255,255,255,0.7)",
                buttonColor: "#ffffff",
                buttonTextColor: "#0d1b33"
            }
        })
    });
})();
