/*
    Circuit - AI / developer tooling.
    Near-black surface, cyan glow, monospaced eyebrows.
*/
(function () {
    var K = WBTemplateKit;

    var t = K.theme({
        accent: "#22d3ee",
        onAccent: "#04141a",
        bg: "#080c10",
        alt: "#0f161d",
        surface: "#0f161d",
        text: "#e8f1f5",
        muted: "#8ba1ad",
        border: "#1e2a33",
        headingFont: K.FONTS.inter,
        bodyFont: K.FONTS.inter,
        radius: "12px",
        pill: "8px",
        heroSize: "54px",
        dark: true
    });

    WBTemplates.register({
        id: "circuit",
        name: "Circuit",
        category: "Technology",
        tagline: "Dark developer-tool site with cyan accents and a technical voice.",
        theme: t,

        pages: WBTemplatePreset.build({
            theme: t,
            navBrandColor: "#ffffff",
            navLinkColor: t.muted,
            navActiveColor: t.accent,
            navCta: { label: "Read the docs" },
            headerBg: t.bg,
            headerText: "#ffffff",
            headerMuted: t.muted,
            footerBg: t.bg,
            footerColor: "#ffffff",
            footerMuted: t.muted,
            footerBorder: t.border,
            statsBg: t.alt,
            statsColor: t.accent,
            statsLabelColor: t.muted,

            hero: {
                layout: "split",
                eyebrow: "$ npm i circuit-agents",
                eyebrowColor: t.accent,
                title: "Intelligent automation<br>for modern teams",
                titleColor: "#ffffff",
                sub: "Compose agents, tools and evaluations in one runtime. Run them on your " +
                     "own hardware, with traces you can actually read.",
                subColor: t.muted,
                primary: { label: "Read the docs", to: "Platform" },
                secondary: { label: "Talk to us", to: "Contact" },
                secondaryBorder: "#2a3a45",
                secondaryText: "#ffffff",
                art: { from: "#22d3ee", to: "#0b3a4a", height: "410px", glyph: "code",
                       label: "circuit run --trace" }
            },

            stats: [
                { value: "40ms", label: "Median tool latency" },
                { value: "120+", label: "Built-in adapters" },
                { value: "MIT", label: "Licensed" },
                { value: "0", label: "Data leaves your box" }
            ],

            features: {
                title: "A runtime, not a wrapper",
                sub: "Everything you need to take an agent from prototype to production.",
                card: true,
                cardBg: t.alt,
                cardBorder: t.border,
                iconBg: "rgba(34,211,238,0.12)",
                iconColor: t.accent,
                titleColor: "#ffffff",
                titleColor2: "#ffffff",
                bodyColor: t.muted,
                items: [
                    { glyph: "layers", title: "Composable graphs", body: "Chain tools, models and branches with plain functions." },
                    { glyph: "search", title: "Readable traces", body: "Every step, prompt and token accounted for and diffable." },
                    { glyph: "check", title: "Evaluations", body: "Score changes against fixtures before they reach anyone." },
                    { glyph: "lock", title: "Runs anywhere", body: "Your own hardware, your own models, no phone home." },
                    { glyph: "clock", title: "Durable runs", body: "Resume long jobs after a restart, exactly where they stopped." },
                    { glyph: "gear", title: "Typed tools", body: "Schemas generated from your code, validated at the boundary." }
                ]
            },

            showcase: {
                title: "Built for people who read stack traces",
                body: "No hidden prompt magic. Every call the runtime makes is inspectable, " +
                      "replayable and yours to modify.",
                bullets: [
                    "Single binary, no daemon to babysit",
                    "Deterministic replays from any trace",
                    "Adapters for the models you already run"
                ],
                glyph: "check",
                bg: t.alt,
                art: { from: "#0ea5e9", to: "#052e3b", glyph: "layers" }
            },

            second: {
                name: "Platform", slug: "platform",
                title: "The platform",
                sub: "Four components, one binary. Use the ones you need.",
                card: true,
                columns: 2,
                cardBg: t.alt,
                cardBorder: t.border,
                iconBg: "rgba(34,211,238,0.12)",
                iconColor: t.accent,
                items: [
                    { glyph: "code", title: "Runtime", body: "The scheduler, tool registry and retry semantics." },
                    { glyph: "search", title: "Tracer", body: "A local UI over every run, searchable and exportable." },
                    { glyph: "check", title: "Evals", body: "Fixture-based scoring wired into your test command." },
                    { glyph: "globe", title: "Gateway", body: "One endpoint in front of every model provider you use." }
                ]
            },

            about: {
                title: "About Circuit",
                sub: "Built by four engineers who kept rewriting the same glue code.",
                storyTitle: "We got tired of debugging black boxes",
                story: [
                    "Circuit started as an internal library for a team running agents in " +
                    "production. The wrappers on the market were easy to demo and " +
                    "impossible to operate, so we wrote the boring parts properly.",
                    "It has been open source since the first commit and is used by teams " +
                    "who need their automation to run on their own infrastructure."
                ],
                art: { from: "#22d3ee", to: "#08141b", glyph: "code" },
                teamTitle: "Maintainers",
                team: [
                    { name: "Ivo Delgado", role: "Runtime", from: "#22d3ee", to: "#0e7490" },
                    { name: "Sarah Nkemelu", role: "Tracing", from: "#38bdf8", to: "#075985" },
                    { name: "Ben Halvorsen", role: "Evals", from: "#67e8f9", to: "#164e63" }
                ]
            },

            contact: {
                title: "Talk to the maintainers",
                sub: "Support contracts, security reviews or a question about an adapter.",
                submit: "Send message",
                panelBg: t.alt,
                panelTitle: "Channels",
                details: [
                    { label: "Email", value: "team@example.dev" },
                    { label: "Issues", value: "github.com/example/circuit" },
                    { label: "Security", value: "security@example.dev" }
                ]
            },

            cta: {
                title: "Run your first agent in five minutes",
                body: "One binary, one config file, no account required.",
                button: "Read the docs",
                to: "Platform",
                bg: t.accent,
                titleColor: "#04141a",
                bodyColor: "rgba(4,20,26,0.72)",
                buttonColor: "#04141a",
                buttonTextColor: t.accent
            }
        })
    });
})();
