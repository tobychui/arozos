/*
    Lumen - photography portfolio.
    Near-white, near-black, no accent colour to speak of; the work carries it.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#111111",
        onAccent: "#ffffff",
        bg: "#fafafa",
        alt: "#f0f0f0",
        surface: "#ffffff",
        text: "#111111",
        muted: "#767676",
        border: "#e2e2e2",
        headingFont: K.FONTS.inter,
        bodyFont: K.FONTS.inter,
        radius: "2px",
        pill: "2px",
        heroSize: "64px",
        tracking: "-0.035em",
        navWeight: "400"
    });

    WBTemplates.register({
        id: "lumen",
        name: "Lumen",
        category: "Portfolio",
        tagline: "Quiet monochrome portfolio that gets out of the way of the pictures.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navGap: "28px",
            navCta: { label: "Commission work" },

            hero: {
                layout: "stack",
                eyebrow: "Photographer, Hong Kong",
                eyebrowColor: t.muted,
                title: "Let's capture<br>your story.",
                weight: "500",
                lineHeight: "1.02",
                sub: "Documentary portraits and quiet interiors. I photograph people the way " +
                     "they are when nobody is asking them to smile.",
                primary: { label: "Commission work", to: "Contact" },
                secondary: { label: "See the gallery", to: "Gallery" },
                art: { from: "#3a3a3a", to: "#111111", height: "460px", angle: "160deg" },
                padBottom: "80px"
            },

            features: {
                title: "What I shoot",
                items: [
                    { glyph: "image", title: "Portraits", body: "Half a day, on location, thirty finished frames." },
                    { glyph: "home", title: "Interiors", body: "Architecture and hospitality, natural light wherever possible." },
                    { glyph: "video", title: "Editorial", body: "Commissions for magazines, brands and long-form features." }
                ],
                iconBg: "#eeeeee",
                iconColor: "#111111"
            },

            showcase: {
                title: "Every frame, developed by hand",
                body: "I shoot digital and film, and I finish every image myself. No presets, " +
                      "no outsourced retouching.",
                bullets: [
                    "Turnaround within two weeks",
                    "Full resolution files, licensed for your use",
                    "Prints available from the archive"
                ],
                bg: t.alt,
                art: { from: "#767676", to: "#111111", angle: "200deg" }
            },

            second: {
                name: "Gallery", slug: "gallery",
                title: "Gallery",
                sub: "Selected work from the last three years.",
                layout: "art",
                columns: 3,
                items: [
                    { title: "Harbour, 5am", body: "Personal work, 2024", from: "#4b5563", to: "#0f172a", height: "300px" },
                    { title: "Marta", body: "Portrait commission", from: "#9ca3af", to: "#374151", height: "300px" },
                    { title: "The Long Room", body: "Interiors, Central", from: "#6b7280", to: "#111111", height: "300px" },
                    { title: "Fishermen", body: "Editorial, Tai O", from: "#374151", to: "#000000", height: "300px" },
                    { title: "Studio No. 4", body: "Architecture", from: "#d1d5db", to: "#4b5563", height: "300px" },
                    { title: "Late shift", body: "Documentary series", from: "#111111", to: "#525252", height: "300px" }
                ]
            },

            about: {
                title: "About",
                sub: "Fifteen years behind a camera, most of them in this city.",
                storyTitle: "I photograph the moment either side of the pose",
                story: [
                    "I trained as a printer before I ever took a commission, which is " +
                    "probably why I still think about how an image will look on paper " +
                    "before I press the shutter.",
                    "Work has appeared in Monocle, Wallpaper and the South China Morning " +
                    "Post. Prints are held in two private collections."
                ],
                art: { from: "#9ca3af", to: "#111111" }
            },

            contact: {
                title: "Commission a shoot",
                sub: "Tell me the date, the place and what the pictures are for.",
                submit: "Send enquiry",
                panelTitle: "Studio",
                details: [
                    { label: "Email", value: "studio@example.com" },
                    { label: "Studio", value: "Unit 9, Blue House<br>Wan Chai, Hong Kong" },
                    { label: "Rates", value: "Half day from $1,200<br>Full day from $2,000" }
                ]
            },

            cta: {
                title: "Available for commissions",
                body: "Booking from March onwards, worldwide.",
                button: "Get in touch",
                bg: "#111111",
                titleColor: "#ffffff",
                bodyColor: "rgba(255,255,255,0.68)",
                buttonColor: "#ffffff",
                buttonTextColor: "#111111"
            }
        })
    });
})();
