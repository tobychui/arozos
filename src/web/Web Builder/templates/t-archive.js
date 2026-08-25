/*
    Archive - blog / magazine.
    Paper white, Merriweather body, an article list instead of feature cards.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#9a3412",
        alt: "#f5f1ea",
        bg: "#fffdf9",
        surface: "#ffffff",
        text: "#1c1917",
        muted: "#6b6157",
        border: "#e7e0d6",
        headingFont: K.FONTS.playfair,
        bodyFont: K.FONTS.merriweather,
        radius: "4px",
        pill: "4px",
        heroSize: "50px",
        tracking: "-0.01em",
        navWeight: "400"
    });

    WBTemplates.register({
        id: "archive",
        name: "Archive",
        category: "Blog",
        tagline: "Editorial blog with a reading-first layout and a dated article index.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navCta: { label: "Subscribe" },

            hero: {
                layout: "center",
                width: "760px",
                eyebrow: "Essays on craft, tools and attention",
                title: "Browse everything.",
                weight: "600",
                lineHeight: "1.1",
                sub: "A slow publication about how things get made, published on the first " +
                     "Tuesday of every month. No tracking, no newsletter pop-up.",
                primary: { label: "Read the archive", to: "Articles" },
                secondary: { label: "About this site", to: "About" },
                art: { from: "#e7d5c0", to: "#9a3412", height: "300px", angle: "150deg",
                       glyph: "quote", glyphColor: "rgba(255,255,255,0.9)" },
                padBottom: "80px"
            },

            features: {
                title: "What you will find here",
                align: "center",
                items: [
                    { glyph: "quote", title: "Long essays", body: "One properly researched piece a month, usually too long." },
                    { glyph: "list", title: "Working notes", body: "Shorter posts on tools, process and things that failed." },
                    { glyph: "clock", title: "The archive", body: "Six years of back issues, all of it free to read." }
                ]
            },

            showcase: {
                title: "Written slowly, on purpose",
                body: "Nothing here is written to a schedule set by an algorithm. Pieces " +
                      "appear when they are finished.",
                bullets: [
                    "No advertising, ever",
                    "No comment section, by design",
                    "Everything readable without an account"
                ],
                bg: t.alt,
                art: { from: "#d6c3a8", to: "#7c2d12", glyph: "text" }
            },

            second: {
                name: "Articles", slug: "articles",
                title: "The archive",
                sub: "Every piece, newest first.",
                layout: "list",
                items: [
                    { title: "The cost of a fast decision", body: "On reversibility and the meetings we skip", meta: "Mar 2026" },
                    { title: "Notes from a slow rewrite", body: "Eight months inside a codebase nobody wanted to touch", meta: "Feb 2026" },
                    { title: "Tools that disappear", body: "Why the best software is the software you stop noticing", meta: "Jan 2026" },
                    { title: "In defence of the index page", body: "Navigation, hierarchy and the death of the sitemap", meta: "Dec 2025" },
                    { title: "What we lost with infinite scroll", body: "On endings, and why a page needs one", meta: "Nov 2025" },
                    { title: "Reading the manual", body: "A short history of documentation nobody reads", meta: "Oct 2025" }
                ]
            },

            about: {
                title: "About",
                sub: "A one-person publication, published since 2019.",
                storyTitle: "Why this exists",
                story: [
                    "I kept writing long replies to short questions and decided they " +
                    "belonged somewhere permanent. Six years later this is where they go.",
                    "Everything is written in plain text, published as static HTML and " +
                    "hosted on a machine in my own home. That is the whole stack."
                ],
                art: { from: "#e7d5c0", to: "#7c2d12" }
            },

            contact: {
                title: "Say hello",
                sub: "Corrections, disagreements and reading suggestions all welcome.",
                submit: "Send message",
                panelTitle: "Elsewhere",
                details: [
                    { label: "Email", value: "post@example.com" },
                    { label: "RSS", value: "/feed.xml" },
                    { label: "Published", value: "First Tuesday, monthly" }
                ]
            },

            cta: {
                title: "New issue, first Tuesday of the month",
                body: "Subscribe by RSS or email. Nothing else will ever be sent to you.",
                button: "Subscribe"
            }
        })
    });
})();
