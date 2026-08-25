/*
    Pulse - fitness studio.
    Charcoal and hot magenta, heavy type, programme cards.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#ec4899",
        alt: "#17161c",
        bg: "#0f0e13",
        surface: "#17161c",
        text: "#f7f5fa",
        muted: "#a29daf",
        border: "#282534",
        headingFont: K.FONTS.montserrat,
        bodyFont: K.FONTS.inter,
        radius: "16px",
        pill: "999px",
        heroSize: "64px",
        tracking: "-0.03em",
        dark: true
    });

    WBTemplates.register({
        id: "pulse",
        name: "Pulse",
        category: "Fitness",
        tagline: "High-energy studio site in charcoal and magenta, with class programmes.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navBrandColor: "#ffffff",
            navLinkColor: t.muted,
            navActiveColor: t.accent,
            navCta: { label: "Book a class" },
            headerBg: t.bg,
            headerText: "#ffffff",
            headerMuted: t.muted,
            pageTitleSize: "50px",
            footerBg: t.bg,
            footerColor: "#ffffff",
            footerMuted: t.muted,
            footerBorder: t.border,
            statsBg: t.alt,
            statsColor: t.accent,
            statsLabelColor: t.muted,

            hero: {
                layout: "split",
                eyebrow: "Studio &amp; strength",
                title: "Every rep<br>counts.",
                titleColor: "#ffffff",
                weight: "800",
                lineHeight: "0.98",
                sub: "Small group training with coaches who know your name, your numbers " +
                     "and exactly how hard to push.",
                subColor: t.muted,
                primary: { label: "Book a class", to: "Contact" },
                secondary: { label: "See programmes", to: "Programmes" },
                secondaryBorder: "#3a3648",
                secondaryText: "#ffffff",
                art: { from: "#ec4899", to: "#4c1d95", height: "440px", angle: "150deg",
                       glyph: "sparkle", label: "6:30am - Strength" }
            },

            stats: [
                { value: "12", label: "Coaches" },
                { value: "60+", label: "Classes weekly" },
                { value: "8", label: "Max per group" },
                { value: "24/7", label: "Member access" }
            ],

            features: {
                title: "TRAIN WITH INTENT",
                sub: "Three ways in, all of them coached.",
                align: "center",
                card: true,
                cardBg: t.alt,
                cardBorder: t.border,
                iconBg: "rgba(236,72,153,0.16)",
                iconColor: t.accent,
                titleColor2: "#ffffff",
                bodyColor: t.muted,
                items: [
                    { glyph: "sparkle", title: "Strength", body: "Barbell fundamentals in groups of eight, three times a week." },
                    { glyph: "clock", title: "Conditioning", body: "Forty-five minutes, scaled to you, never the same twice." },
                    { glyph: "help", title: "One to one", body: "Private coaching for a specific goal or a return from injury." }
                ]
            },

            showcase: {
                title: "COACHING, NOT SHOUTING",
                body: "Every member gets an assessment, a plan and numbers reviewed every " +
                      "six weeks. Progress you can point at.",
                bullets: [
                    "Movement screen before your first session",
                    "Programme written for your week, not the class average",
                    "Cancel any time, no twelve-month contracts"
                ],
                bg: t.alt,
                art: { from: "#f472b6", to: "#3b0764", glyph: "check" }
            },

            second: {
                name: "Programmes", slug: "programmes",
                title: "Programmes",
                sub: "Pick a track. Switch whenever your goals change.",
                card: true,
                columns: 2,
                cardBg: t.alt,
                cardBorder: t.border,
                iconBg: "rgba(236,72,153,0.16)",
                iconColor: t.accent,
                items: [
                    { glyph: "sparkle", title: "Foundations - 6 weeks", body: "For anyone new to lifting. Technique first, load later." },
                    { glyph: "resize", title: "Strength - ongoing", body: "Squat, press, pull, on a cycle that peaks every twelve weeks." },
                    { glyph: "clock", title: "Engine - ongoing", body: "Conditioning built around intervals and honest pacing." },
                    { glyph: "help", title: "Rehab &amp; return", body: "One to one, alongside your physio, back to full training." }
                ]
            },

            about: {
                title: "About the studio",
                sub: "One room, twelve coaches, no mirrors on the lifting floor.",
                storyTitle: "WE BUILT THE GYM WE WANTED TO TRAIN IN",
                story: [
                    "Pulse opened in a converted print works in 2019 with two racks and a " +
                    "whiteboard. We capped every class at eight people and never raised it.",
                    "The coaching team has an average of nine years on the floor, and every " +
                    "one of them trains here too."
                ],
                art: { from: "#ec4899", to: "#1e1b4b" },
                teamTitle: "COACHES",
                team: [
                    { name: "Zoe Adeyemi", role: "Head coach", from: "#ec4899", to: "#831843" },
                    { name: "Marcus Hale", role: "Strength", from: "#f472b6", to: "#4c1d95" },
                    { name: "Ines Duarte", role: "Conditioning", from: "#d946ef", to: "#3b0764" }
                ]
            },

            contact: {
                title: "Book your first class",
                sub: "First session is free, including the movement screen.",
                submit: "Book me in",
                panelBg: t.alt,
                panelTitle: "The studio",
                details: [
                    { label: "Address", value: "Print Works, 8 Ferry Street<br>Kowloon, Hong Kong" },
                    { label: "Staffed hours", value: "Weekdays 6am - 9pm<br>Weekends 8am - 2pm" },
                    { label: "Phone", value: "+852 5555 0188" }
                ]
            },

            cta: {
                title: "FIRST CLASS IS ON US",
                body: "Turn up, get assessed, train. No card needed.",
                button: "Book a class",
                bg: t.accent,
                titleColor: "#ffffff",
                bodyColor: "rgba(255,255,255,0.82)",
                buttonColor: "#0f0e13",
                buttonTextColor: "#ffffff"
            }
        })
    });
})();
