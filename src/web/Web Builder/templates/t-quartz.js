/*
    Quartz - personal portfolio / CV.
    Warm paper tones, amber accent, serif headings.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#b45309",
        alt: "#f3ece2",
        bg: "#faf6f0",
        surface: "#ffffff",
        text: "#241d16",
        muted: "#6f6257",
        border: "#e3d8c9",
        headingFont: K.FONTS.playfair,
        bodyFont: K.FONTS.inter,
        radius: "10px",
        pill: "6px",
        heroSize: "50px",
        tracking: "-0.01em"
    });

    WBTemplates.register({
        id: "quartz",
        name: "Quartz",
        category: "Portfolio",
        tagline: "Warm personal site for a designer, writer or freelancer.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navCta: { label: "Hire me" },

            hero: {
                layout: "split",
                ratio: "1fr 0.7fr",
                eyebrow: "Designer &amp; writer",
                title: "Hello - I'm Jordan,<br>and I make things clear.",
                weight: "600",
                lineHeight: "1.12",
                sub: "Fifteen years turning complicated products into interfaces and words " +
                     "that people understand on the first read.",
                primary: { label: "Hire me", to: "Contact" },
                secondary: { label: "See my work", to: "Work" },
                art: { from: "#f5c98a", to: "#b45309", height: "380px", glyph: "pencil" }
            },

            features: {
                title: "What I can help with",
                items: [
                    { glyph: "layers", title: "Product design", body: "End-to-end interface work, from research through to shipped screens." },
                    { glyph: "text", title: "Content design", body: "The words in the product: labels, errors, empty states, onboarding." },
                    { glyph: "help", title: "Design reviews", body: "A fresh, blunt read on what you already have, in a week." }
                ]
            },

            showcase: {
                title: "How I work",
                body: "Small engagements, clearly scoped, with everything handed over at the end.",
                bullets: [
                    "Two-week sprints with a demo at the close of each",
                    "Files, sources and rationale, all yours",
                    "Available for two clients at a time"
                ],
                bg: t.alt,
                art: { from: "#e8c9a0", to: "#7c3d06", glyph: "list" }
            },

            second: {
                name: "Work", slug: "work",
                title: "Selected work",
                sub: "A few projects I am allowed to talk about.",
                layout: "art",
                columns: 2,
                items: [
                    { title: "Ledgerly", body: "Accounting app redesign - 40% fewer support tickets", glyph: "list", from: "#f5c98a", to: "#92400e" },
                    { title: "Kestrel Health", body: "Patient portal and content system", glyph: "help", from: "#fcd9b0", to: "#b45309" },
                    { title: "Northwind Docs", body: "Documentation platform and voice guide", glyph: "text", from: "#e8c9a0", to: "#78350f" },
                    { title: "Maple Transit", body: "Wayfinding and ticketing interface", glyph: "map", from: "#fbbf24", to: "#7c2d12" }
                ]
            },

            about: {
                title: "About me",
                sub: "Designer, occasional writer, permanent pedant about labels.",
                storyTitle: "I started in newsrooms",
                story: [
                    "My first job was laying out a regional paper on deadline, which taught " +
                    "me more about hierarchy than any design course could.",
                    "Since then I have worked in-house at two startups and independently " +
                    "since 2018, mostly with teams who have a good product and a " +
                    "confusing interface."
                ],
                art: { from: "#f5c98a", to: "#78350f" }
            },

            contact: {
                title: "Work with me",
                sub: "Tell me about the project, the timeline and the budget if you have one.",
                submit: "Send enquiry",
                panelTitle: "Details",
                details: [
                    { label: "Email", value: "jordan@example.com" },
                    { label: "Availability", value: "Taking bookings from next month" },
                    { label: "Based in", value: "Hong Kong, working GMT+8" }
                ]
            },

            cta: {
                title: "Have something that needs untangling?",
                body: "I answer every enquiry personally, usually within a day.",
                button: "Get in touch"
            }
        })
    });
})();
