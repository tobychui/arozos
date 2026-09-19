const { defineConfig } = require("cypress");

/*
    Cypress configuration for the Cine Studio suite.

    The app is served statically from src/web (node serve.js, or any static
    server pointed at that folder) and runs in standalone mode, i.e. without
    an ArozOS backend: media is generated in the page and imported as blob
    URLs, projects round-trip through JSON, exports download. Everything that
    needs the Go backend (server renders, proxies) is covered by Go tests in
    src/mod/media/render instead.

    Override the base URL with `--config baseUrl=http://host:port`.
*/
module.exports = defineConfig({
    e2e: {
        baseUrl: process.env.CS_BASE_URL || "http://127.0.0.1:8123",
        specPattern: "cypress/e2e/**/*.cy.js",
        supportFile: "cypress/support/e2e.js",
        viewportWidth: 1400,
        viewportHeight: 900,
        defaultCommandTimeout: 10000,
        video: false,
        screenshotOnRunFailure: true,
        chromeWebSecurity: false,
        setupNodeEvents(on, config) {
            on("task", {
                log(message) {
                    console.log(message);
                    return null;
                }
            });
            on("before:browser:launch", (browser, launchOptions) => {
                // Media elements must play without a user gesture: the specs
                // drive playback programmatically
                if (browser.family === "chromium") {
                    launchOptions.args.push("--autoplay-policy=no-user-gesture-required");
                    launchOptions.preferences = launchOptions.preferences || {};
                }
                return launchOptions;
            });
            return config;
        }
    }
});
