/*
    Noir - creative agency.
    Near-black page, acid lime accent, oversized uppercase headlines.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#d7ff3e",
        onAccent: "#0a0a0a",
        bg: "#0a0a0a",
        alt: "#141414",
        surface: "#141414",
        text: "#f5f5f5",
        muted: "#9a9a9a",
        border: "#262626",
        headingFont: K.FONTS.montserrat,
        bodyFont: K.FONTS.inter,
        radius: "4px",
        pill: "999px",
        heroSize: "82px",
        tracking: "-0.04em",
        dark: true
    });

    WBTemplates.register({
        id: "noir",
        name: "Noir",
        category: "Agency",
        tagline: "Black canvas, acid lime accent and oversized editorial type.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navBrandColor: "#ffffff",
            navLinkColor: "#9a9a9a",
            navActiveColor: "#d7ff3e",
            navCta: { label: "Start a project" },
            headerBg: t.bg,
            headerText: "#ffffff",
            headerMuted: t.muted,
            pageTitleSize: "56px",
            footerBg: t.bg,
            footerColor: "#ffffff",
            footerMuted: t.muted,
            footerBorder: t.border,
            statsBg: t.alt,

            hero: {
                layout: "stack",
                eyebrow: "Independent creative studio",
                title: "WE BUILD<br>BRANDS WITH<br>TEETH.",
                size: "82px",
                weight: "800",
                lineHeight: "0.94",
                tracking: "-0.04em",
                titleColor: "#ffffff",
                sub: "Strategy, identity and digital work for companies that would rather " +
                     "be talked about than blend in.",
                primary: { label: "Start a project", to: "Contact" },
                secondary: { label: "See the work", to: "Work" },
                secondaryBorder: "#3a3a3a",
                secondaryText: "#ffffff",
                art: { from: "#d7ff3e", to: "#1f2a00", angle: "120deg", height: "460px",
                       glyph: "sparkle", glyphColor: "rgba(10,10,10,0.55)" },
                padBottom: "88px"
            },

            stats: [
                { value: "60+", label: "Brands launched" },
                { value: "18", label: "Awards" },
                { value: "12yr", label: "In practice" },
                { value: "4", label: "Continents" }
            ],
            statsColor: "#d7ff3e",
            statsLabelColor: "#9a9a9a",

            features: {
                title: "WHAT WE DO",
                sub: "Three disciplines, one team, no handoffs between agencies.",
                bg: t.bg,
                items: [
                    { glyph: "palette", title: "Brand identity", body: "Naming, marks, type systems and the rules that keep them honest." },
                    { glyph: "layers", title: "Digital product", body: "Sites and apps designed to be used, not just screenshotted." },
                    { glyph: "video", title: "Motion &amp; film", body: "Launch films, product motion and social cuts made in house." }
                ],
                iconBg: "rgba(215,255,62,0.14)",
                iconColor: "#d7ff3e",
                titleColor2: "#ffffff",
                bodyColor: t.muted
            },

            showcase: {
                title: "NO DECKS. JUST WORK.",
                body: "We start with the thing itself - a prototype, a poster, a first cut - and " +
                      "argue from there.",
                bullets: [
                    "Two-week discovery, then we build",
                    "One senior team, start to finish",
                    "Everything handed over, source included"
                ],
                glyph: "check",
                button: "See the work",
                to: "Work",
                bg: t.alt,
                art: { from: "#d7ff3e", to: "#0a0a0a", angle: "160deg", glyph: "grip",
                       glyphColor: "rgba(10,10,10,0.5)" }
            },

            second: {
                name: "Work", slug: "work",
                title: "Selected work",
                sub: "A slice of what we have shipped recently.",
                layout: "art",
                columns: 2,
                items: [
                    { title: "Halcyon Coffee", body: "Identity, packaging and retail rollout", glyph: "sparkle", from: "#d7ff3e", to: "#3f4a00" },
                    { title: "Vector Athletics", body: "Campaign film and digital launch", glyph: "video", from: "#f5f5f5", to: "#2a2a2a" },
                    { title: "Northbank", body: "Brand system for a challenger bank", glyph: "box", from: "#d7ff3e", to: "#141414" },
                    { title: "Studio Mira", body: "Portfolio site and art direction", glyph: "palette", from: "#9a9a9a", to: "#0a0a0a" }
                ]
            },

            about: {
                title: "About the studio",
                sub: "Sixteen people, one floor, a lot of opinions.",
                storyTitle: "WE ARE NOT A FULL SERVICE AGENCY",
                story: [
                    "We are deliberately small. Everyone who pitches your work also makes it, " +
                    "which keeps the promises and the output in the same room.",
                    "We take on eight projects a year. That is the number that lets us stay " +
                    "involved from the first sketch to the last handover."
                ],
                art: { from: "#d7ff3e", to: "#0a0a0a", angle: "200deg" },
                teamTitle: "PARTNERS",
                team: [
                    { name: "Lena Marsh", role: "Creative director", from: "#d7ff3e", to: "#5a6b00" },
                    { name: "Otto Reyes", role: "Design lead", from: "#f5f5f5", to: "#3a3a3a" },
                    { name: "Priya Nair", role: "Strategy", from: "#d7ff3e", to: "#141414" }
                ]
            },

            contact: {
                title: "Start a project",
                sub: "Tell us what you are making. We reply within two working days.",
                submit: "Send brief",
                panelBg: t.alt,
                panelTitle: "The studio",
                details: [
                    { label: "New business", value: "hello@example.com" },
                    { label: "Studio", value: "Floor 4, Ironworks<br>Kowloon, Hong Kong" },
                    { label: "Social", value: "@studio.noir" }
                ]
            },

            cta: {
                title: "GOT SOMETHING TO LAUNCH?",
                body: "We have room for two more projects this quarter.",
                button: "Start a project",
                bg: t.accent,
                titleColor: "#0a0a0a",
                bodyColor: "rgba(10,10,10,0.7)",
                buttonColor: "#0a0a0a",
                buttonTextColor: "#d7ff3e"
            }
        })
    });
})();
