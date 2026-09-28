/*
    Smoke: the app boots in standalone mode, real media generated in the
    page imports and probes, clips land on the timeline, playback runs and
    the compositor paints the preview.
*/
describe("Cine Studio smoke", function () {
    beforeEach(function () {
        cy.openStudio();
    });

    it("boots with an empty project and the full chrome", function () {
        cy.get("#topbar").should("be.visible");
        cy.get("#project-name").should("contain", "My Project");
        cy.get("#tl-track-headers .track-header").should("have.length", 3);
        cy.get("#preview-empty").should("be.visible");
        cy.cs(function (CS) { return { clips: CS.project.clips.length, aroz: CS.inArozOS() }; })
            .should("deep.equal", { clips: 0, aroz: false });
    });

    it("imports generated video, audio and image media and probes them", function () {
        cy.seedMedia({ image: [{ key: "i1", name: "Still.png", color: "#00ff00" }] }).then(function (m) {
            expect(m.v1.duration).to.be.within(2, 4.5);
            expect(m.a1.duration).to.be.within(3.5, 4.5);
            expect(m.v1.thumbs.length).to.be.greaterThan(0);
            expect((m.a1.peaks || []).length).to.be.greaterThan(100);
            expect(m.i1.width).to.equal(200);
            expect(m.v1.offline || m.a1.offline || m.i1.offline).to.equal(false);
        });
        cy.get("#bin-grid .bin-item").should("have.length", 3);
        cy.get("#bin-count").should("contain", "3 items");
    });

    it("places clips, plays back and paints the preview", function () {
        cy.seedMedia();
        cy.cs(function (CS, win) {
            var media = win.__media;
            var c1 = CS.addClipToTimeline(media.v1, "V1", 0);
            CS.addClipToTimeline(media.a1, "A1", 0);
            CS.commit("seed");
            return { clips: CS.project.clips.length, dur: CS.clipDuration(c1) };
        }).then(function (r) {
            expect(r.clips).to.equal(2);
            expect(r.dur).to.be.greaterThan(2);
        });
        cy.get(".tl-clip").should("have.length", 2);
        cy.get("#preview-empty").should("not.be.visible");

        cy.get("#btn-play").click();
        cy.wait(1500);
        cy.cs(function (CS) { return { playing: CS.state.playing, ph: CS.state.playhead }; }).then(function (s) {
            expect(s.playing).to.equal(true);
            expect(s.ph).to.be.greaterThan(0.8);
        });
        cy.centerPixel().then(function (px) {
            expect(px[0] + px[1] + px[2]).to.be.greaterThan(20);
        });
        cy.get("#btn-play").click();
        cy.cs(function (CS) { return CS.state.playing; }).should("equal", false);
    });

    it("splits at the playhead and undoes / redoes", function () {
        cy.seedMedia({ audio: [] });
        cy.cs(function (CS, win) {
            CS.addClipToTimeline(win.__media.v1, "V1", 0);
            CS.commit("seed");
            CS.player.seek(1.2);
            CS.selectClip(CS.project.clips[0].id);
            var before = CS.project.clips.length;
            CS.splitAtPlayhead();
            var after = CS.project.clips.length;
            CS.undo();
            var undone = CS.project.clips.length;
            CS.redo();
            return { before: before, after: after, undone: undone, redone: CS.project.clips.length };
        }).should("deep.equal", { before: 1, after: 2, undone: 1, redone: 2 });
    });
});
