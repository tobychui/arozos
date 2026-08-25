/*
    Bloom - restaurant / food.
    Terracotta on cream with a Playfair headline and a priced menu page.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#c2543d",
        alt: "#f6ece2",
        bg: "#fffaf4",
        surface: "#ffffff",
        text: "#2a1a13",
        muted: "#7a6157",
        border: "#e8d9cb",
        headingFont: K.FONTS.playfair,
        bodyFont: K.FONTS.inter,
        radius: "14px",
        pill: "999px",
        heroSize: "56px",
        tracking: "-0.015em"
    });

    WBTemplates.register({
        id: "bloom",
        name: "Bloom",
        category: "Food",
        tagline: "Terracotta and cream for restaurants, cafes and delivery, with a priced menu.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navCta: { label: "Book a table" },

            hero: {
                layout: "split",
                eyebrow: "Neighbourhood kitchen",
                title: "Craving something<br>delicious? We deliver.",
                weight: "600",
                sub: "Seasonal plates cooked to order from a short menu that changes when " +
                     "the market does. Eat in, take away or delivered within three miles.",
                primary: { label: "Book a table", to: "Contact" },
                secondary: { label: "See the menu", to: "Menu" },
                art: { from: "#e8a87c", to: "#c2543d", height: "430px", glyph: "sparkle",
                       label: "Today's plate" }
            },

            features: {
                title: "Why people keep coming back",
                align: "center",
                items: [
                    { glyph: "clock", title: "Cooked to order", body: "Nothing sits under a lamp. Expect fifteen minutes, and it is worth it." },
                    { glyph: "map", title: "Sourced within 40 miles", body: "Vegetables from two farms, bread from the bakery next door." },
                    { glyph: "home", title: "Room for everyone", body: "Forty covers, a counter for solo diners and a courtyard in summer." }
                ]
            },

            showcase: {
                title: "A menu that changes with the market",
                body: "We print it every morning. If something ran out, it ran out - " +
                      "that is the point.",
                bullets: [
                    "Three starters, five mains, two puddings",
                    "Always one vegan main and one for children",
                    "Wine list of twelve, all by the glass"
                ],
                bg: t.alt,
                button: "View today's menu",
                to: "Menu",
                art: { from: "#f0c5a0", to: "#a03d2c", glyph: "list" }
            },

            second: {
                name: "Menu", slug: "menu",
                title: "Today's menu",
                sub: "Printed fresh each morning. Ask us about allergens - we know every dish.",
                layout: "list",
                items: [
                    { title: "Charred leeks, hazelnut, aged sheep's cheese", body: "Starter, vegetarian", meta: "$9" },
                    { title: "Cured trout, cucumber, buttermilk", body: "Starter", meta: "$12" },
                    { title: "Slow lamb shoulder, white beans, salsa verde", body: "Main, for two to share", meta: "$34" },
                    { title: "Hand-rolled pici, tomato, basil", body: "Main, vegan on request", meta: "$18" },
                    { title: "Day boat fish, brown butter, capers", body: "Main, ask for today's catch", meta: "$26" },
                    { title: "Burnt honey tart", body: "Pudding", meta: "$8" },
                    { title: "Chocolate, olive oil, sea salt", body: "Pudding, vegan", meta: "$8" }
                ]
            },

            about: {
                title: "About Bloom",
                sub: "A forty-cover kitchen run by two cooks and a very good pastry chef.",
                storyTitle: "We opened with one oven and a lot of nerve",
                story: [
                    "Bloom began as a Sunday supper club in a flat above the hardware shop. " +
                    "When the room downstairs came up for rent we took it, kept the short " +
                    "menu and never looked back.",
                    "Six years on we still cook everything to order, still change the menu " +
                    "daily, and still do the washing up ourselves on Mondays."
                ],
                art: { from: "#e8a87c", to: "#7a2e20" },
                teamTitle: "In the kitchen",
                team: [
                    { name: "Nadia Farouk", role: "Head chef", from: "#e8a87c", to: "#a03d2c" },
                    { name: "Callum Reid", role: "Sous chef", from: "#f0c5a0", to: "#c2543d" },
                    { name: "Yuki Mori", role: "Pastry", from: "#c2543d", to: "#5c2318" }
                ]
            },

            contact: {
                title: "Book a table",
                sub: "Tables for six or fewer can be booked online. Larger parties, call us.",
                submit: "Request a table",
                panelTitle: "Find us",
                details: [
                    { label: "Address", value: "14 Wellington Row<br>Sheung Wan, Hong Kong" },
                    { label: "Hours", value: "Tuesday to Saturday<br>Lunch 12 - 3, Dinner 6 - 10" },
                    { label: "Phone", value: "+852 5555 0140" }
                ]
            },

            cta: {
                title: "Hungry now?",
                body: "Delivery within three miles, seven days a week.",
                button: "Order delivery"
            }
        })
    });
})();
