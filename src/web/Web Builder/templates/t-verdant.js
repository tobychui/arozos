/*
    Verdant - sustainability / non-profit.
    Deep green on cream, generous rounding, friendly tone.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#15803d",
        alt: "#eef3e8",
        bg: "#fbfdf8",
        surface: "#ffffff",
        text: "#14261a",
        muted: "#55665b",
        border: "#dbe5d6",
        headingFont: K.FONTS.poppins,
        bodyFont: K.FONTS.inter,
        radius: "20px",
        pill: "999px",
        heroSize: "52px"
    });

    WBTemplates.register({
        id: "verdant",
        name: "Verdant",
        category: "Non-profit",
        tagline: "Warm green and cream, built for causes, co-ops and community projects.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navCta: { label: "Support us" },
            statsBg: t.alt,

            hero: {
                layout: "split",
                eyebrow: "Community owned since 2014",
                title: "Small actions,<br>rooted locally",
                sub: "We restore neglected land into growing spaces that neighbourhoods run " +
                     "themselves - forty sites and counting.",
                primary: { label: "Support us", to: "Contact" },
                secondary: { label: "Our projects", to: "Projects" },
                art: { from: "#4ade80", to: "#15803d", height: "420px", glyph: "sparkle",
                       label: "Meadow Lane, year three" }
            },

            stats: [
                { value: "41", label: "Sites restored" },
                { value: "2,100", label: "Volunteers" },
                { value: "17t", label: "Produce grown" },
                { value: "100%", label: "Locally run" }
            ],

            features: {
                title: "How it works",
                sub: "Land, tools and training. The neighbourhood supplies the rest.",
                align: "center",
                card: true,
                items: [
                    { glyph: "map", title: "We find the land", body: "Disused plots, rooftops and verges, leased on long terms." },
                    { glyph: "sparkle", title: "We set it up", body: "Soil, water, beds and a season of hands-on training." },
                    { glyph: "home", title: "You run it", body: "Every site is handed to the people who tend it, for good." }
                ]
            },

            showcase: {
                title: "A model that keeps giving back",
                body: "Ninety pence of every pound goes into ground, tools and training. " +
                      "The rest keeps the lights on.",
                bullets: [
                    "Open books, published every quarter",
                    "No site is ever sold on",
                    "Surplus produce goes to local kitchens"
                ],
                bg: t.alt,
                art: { from: "#86efac", to: "#166534", glyph: "globe" }
            },

            second: {
                name: "Projects", slug: "projects",
                title: "Our projects",
                sub: "Every site is run by the people who live beside it.",
                layout: "art",
                columns: 2,
                items: [
                    { title: "Meadow Lane", body: "A car park turned into twenty growing beds", glyph: "sparkle", from: "#4ade80", to: "#15803d" },
                    { title: "Riverside Orchard", body: "Ninety fruit trees on reclaimed flood land", glyph: "globe", from: "#a3e635", to: "#3f6212" },
                    { title: "Rooftop Commons", body: "Community greenhouse above a library", glyph: "home", from: "#34d399", to: "#065f46" },
                    { title: "The Verge Project", body: "Wildflower corridors along four kilometres of road", glyph: "map", from: "#bef264", to: "#166534" }
                ]
            },

            about: {
                title: "About us",
                sub: "A small charity with a stubborn idea about who land belongs to.",
                storyTitle: "It started with one abandoned car park",
                story: [
                    "In 2014 a group of neighbours cleared a disused lot without asking " +
                    "anyone. Three years later the council asked us to do the same on " +
                    "eleven more sites.",
                    "We are now nine staff and two thousand volunteers, and every site we " +
                    "start is handed over within eighteen months."
                ],
                art: { from: "#4ade80", to: "#14532d" },
                teamTitle: "Who runs this",
                team: [
                    { name: "Rosa Okonjo", role: "Director", from: "#4ade80", to: "#166534" },
                    { name: "Tom Whitaker", role: "Sites lead", from: "#a3e635", to: "#3f6212" },
                    { name: "Sana Iqbal", role: "Volunteering", from: "#34d399", to: "#065f46" }
                ]
            },

            contact: {
                title: "Get involved",
                sub: "Volunteer a Saturday, offer a plot of land, or fund a season.",
                submit: "Send message",
                panelTitle: "Come and find us",
                details: [
                    { label: "General", value: "hello@example.org" },
                    { label: "Volunteering", value: "Saturdays, 9am - 1pm<br>Meadow Lane site" },
                    { label: "Registered charity", value: "No. 1163402" }
                ]
            },

            cta: {
                title: "Give a season, grow a neighbourhood",
                body: "Twelve pounds a month keeps one bed planted all year.",
                button: "Support us"
            }
        })
    });
})();
