/*
    Source monitor and three-point editing: open a bin item, mark in / out,
    insert and overwrite at the sequence playhead on the targeted track.
*/
describe("Source monitor", function () {
    beforeEach(function () {
        cy.openStudio();
        cy.seedMedia({ video: [{ key: "v1", name: "A.webm", seconds: 3, hue: 200 }, { key: "v2", name: "B.webm", seconds: 3, hue: 30 }], audio: [] });
    });

    it("opens media on double-click, shows its own timecode and marks in / out", function () {
        cy.get("#bin-grid .bin-item").eq(1).dblclick();
        cy.cs(function (CS, win) { return { active: CS.source.active, name: CS.source.media.name }; })
            .should("deep.equal", { active: true, name: "B.webm" });
        cy.get('#monitor-tabs button[data-monitor="source"]').should("have.class", "active");
        cy.get("#source-name").should("contain", "B.webm");
        cy.get("#source-bar").should("be.visible");
        cy.cs(function (CS) { CS.source.seek(0.5); });
        cy.get("body").type("i");
        cy.cs(function (CS) { CS.source.seek(2); });
        cy.get("body").type("o");
        cy.cs(function (CS) { return CS.source.range(); }).should("deep.equal", { start: 0.5, end: 2 });
        cy.get("#source-range").should("contain", "00:00:00:15");
        cy.get("#tc-total").invoke("text").then(function (t) { expect(t).to.not.equal("00:00:00:00"); });
        cy.centerPixel().then(function (px) { expect(px[0] + px[1] + px[2]).to.be.greaterThan(20); });
        cy.get('#monitor-tabs button[data-monitor="program"]').click();
        cy.cs(function (CS) { return CS.source.active; }).should("equal", false);
    });

    it("inserts the marked range at the playhead and pushes clips along", function () {
        cy.cs(function (CS, win) {
            var a = CS.addClipToTimeline(win.__media.v1, "V1", 0);
            CS.commit("seed");
            CS.player.seek(1);
            win.__a = a.id;
            CS.source.open(win.__media.v2);
            CS.source.seek(0.5);
            CS.source.markIn();
            CS.source.seek(2);
            CS.source.markOut();
            CS.source.insert();
            var clips = CS.clipsOnTrack("V1");
            return {
                count: clips.length,
                starts: clips.map(function (c) { return +c.start.toFixed(2); }),
                inserted: clips[1].in,
                insertedOut: clips[1].out,
                tailIn: +clips[2].in.toFixed(2),
                playhead: CS.state.playhead,
                active: CS.source.active
            };
        }).then(function (r) {
            expect(r.count).to.equal(3);
            expect(r.starts).to.deep.equal([0, 1, 2.5]);
            expect(r.inserted).to.equal(0.5);
            expect(r.insertedOut).to.equal(2);
            expect(r.tailIn).to.equal(1);
            expect(r.playhead).to.equal(2.5);
            expect(r.active).to.equal(false);
        });
        cy.cs(function (CS) { return CS.history.stack[CS.history.index].label; }).should("equal", "Insert");
    });

    it("overwrites the range on the target track and respects track targeting", function () {
        cy.cs(function (CS, win) {
            var a = CS.addClipToTimeline(win.__media.v1, "V1", 0);
            CS.commit("seed");
            CS.player.seek(1);
            CS.source.open(win.__media.v2);
            CS.source.seek(0);
            CS.source.markIn();
            CS.source.seek(1);
            CS.source.markOut();
            CS.source.overwrite();
            var clips = CS.clipsOnTrack("V1");
            return {
                count: clips.length,
                total: +CS.timelineDuration().toFixed(2),
                aDur: +CS.clipDuration(clips[0]).toFixed(2),
                mid: clips[1].mediaId === win.__media.v2.id,
                tailStart: +clips[2].start.toFixed(2)
            };
        }).then(function (r) {
            expect(r.count).to.equal(3);
            expect(r.aDur).to.equal(1);
            expect(r.mid).to.equal(true);
            expect(r.tailStart).to.equal(2);
        });
        //Untarget V1: the next edit goes to another video track
        cy.get('.track-header[data-track-id="V1"] .th-target').click();
        cy.cs(function (CS, win) {
            CS.createTrack("video");
            CS.timeline.render();
            CS.player.seek(0);
            CS.source.open(win.__media.v2);
            CS.source.seek(0);
            CS.source.markIn();
            CS.source.seek(0.5);
            CS.source.markOut();
            CS.source.overwrite();
            return CS.selectedClip().trackId;
        }).should("equal", "V2");
    });
});
