/*
    Slate - consulting / professional services.
    Navy and warm grey with a Playfair headline face.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#1e3a5f",
        alt: "#f4f6f8",
        text: "#16202b",
        muted: "#5a6b7c",
        border: "#dde3e9",
        headingFont: K.FONTS.playfair,
        bodyFont: K.FONTS.inter,
        radius: "6px",
        pill: "4px",
        heroSize: "52px",
        tracking: "-0.01em"
    });

    WBTemplates.register({
        id: "slate",
        name: "Slate",
        category: "Business",
        tagline: "Measured, editorial consulting site with a serif headline face.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navCta: { label: "Book a call" },
            statsBg: t.alt,

            hero: {
                layout: "split",
                ratio: "1fr 0.85fr",
                eyebrow: "Strategy &amp; operations",
                title: "Strategic insight,<br>customised solutions",
                weight: "600",
                lineHeight: "1.14",
                sub: "For over a decade we have helped ambitious organisations turn complex " +
                     "operating problems into decisions they can act on.",
                primary: { label: "Book a call", to: "Contact" },
                secondary: { label: "Our services", to: "Services" },
                art: { from: "#1e3a5f", to: "#4d7ea8", height: "400px", glyph: "box" }
            },

            stats: [
                { value: "240", label: "Engagements delivered" },
                { value: "18", label: "Industries served" },
                { value: "92%", label: "Clients return" }
            ],

            features: {
                title: "How we work",
                sub: "Small senior teams, embedded with yours, for as long as the problem takes.",
                items: [
                    { glyph: "search", title: "Diagnose", body: "Two weeks in your business, talking to the people doing the work." },
                    { glyph: "layers", title: "Design", body: "Options with real numbers attached, not a deck of possibilities." },
                    { glyph: "check", title: "Deliver", body: "We stay through implementation and hand over something that runs." }
                ],
                card: true,
                cardBg: "#ffffff"
            },

            showcase: {
                title: "Advice you can act on Monday morning",
                body: "Every engagement ends with an operating plan, an owner for each action " +
                      "and a measure that tells you whether it worked.",
                bullets: [
                    "Fixed scope and fixed fee",
                    "Weekly written updates to the board",
                    "Your team keeps the models and the method"
                ],
                bg: t.alt,
                art: { from: "#4d7ea8", to: "#1e3a5f", glyph: "list" }
            },

            second: {
                name: "Services", slug: "services",
                title: "Our services",
                sub: "Four practices, one team. Most clients start with the first.",
                card: true,
                columns: 2,
                cardBg: "#ffffff",
                items: [
                    { glyph: "box", title: "Operating model design", body: "Structure, decision rights and the meetings that hold them together." },
                    { glyph: "list", title: "Cost and margin review", body: "Where the money goes, what it buys, and what to stop funding." },
                    { glyph: "globe", title: "Market entry", body: "Sizing, sequencing and the partnerships that make it viable." },
                    { glyph: "gear", title: "Transformation delivery", body: "Programme leadership when the plan has to survive contact with reality." }
                ]
            },

            about: {
                title: "About the firm",
                sub: "Founded in 2011 by three operators who were tired of advice that stopped at the recommendation.",
                storyTitle: "Practitioners, not presenters",
                story: [
                    "Every consultant here has run something - a factory, a P&amp;L, a " +
                    "turnaround. That shows up in the work: fewer frameworks, more decisions.",
                    "We keep the firm small on purpose. Partners are on every engagement, " +
                    "and the person who sold the work is the person who does it."
                ],
                art: { from: "#1e3a5f", to: "#7fa8c9" },
                teamTitle: "Partners",
                team: [
                    { name: "Helen Ashcroft", role: "Managing partner", from: "#1e3a5f", to: "#4d7ea8" },
                    { name: "Daniel Osei", role: "Operations", from: "#4d7ea8", to: "#9dbdd6" },
                    { name: "Mei Lin Chow", role: "Strategy", from: "#16202b", to: "#4d7ea8" }
                ]
            },

            contact: {
                title: "Start a conversation",
                sub: "Tell us the decision you are facing. First call is 45 minutes, no charge.",
                submit: "Request a call",
                panelTitle: "Offices",
                details: [
                    { label: "Enquiries", value: "advisory@example.com" },
                    { label: "Hong Kong", value: "22F, Exchange Tower<br>Central" },
                    { label: "Singapore", value: "8 Marina View<br>Asia Square" }
                ]
            },

            cta: {
                title: "Facing a decision worth getting right?",
                body: "We will tell you honestly whether we are the right firm for it.",
                button: "Book a call"
            }
        })
    });
})();
