/*
    Keyframed animation: stopwatch toggles in the inspector, keyframes
    written at the playhead, interpolation (linear / ease / hold),
    diamonds on the timeline, splitting, opacity on the preview pixels and
    keyframed volume on the media elements.
*/
describe("Keyframes", function () {
    beforeEach(function () {
        cy.openStudio();
        cy.seedMedia({ audio: [], image: [{ key: "i1", name: "Red.png", color: "#ff0000" }] });
        cy.cs(function (CS, win) {
            var c = CS.addClipToTimeline(win.__media.i1, "V1", 0);
            c.out = 4;
            c.props.crop = "fill";
            CS.commit("seed");
            CS.selectClip(c.id);
            win.__clip = c.id;
        });
    });

    it("animates scale from the inspector and interpolates between keyframes", function () {
        cy.get('[data-kf-toggle="scale"]').click();
        cy.cs(function (CS, win) { return CS.keyframes.list(CS.getClip(win.__clip), "scale"); }).then(function (kfs) {
            expect(kfs).to.have.length(1);
            expect(kfs[0]).to.include({ t: 0, v: 100 });
        });
        cy.cs(function (CS) { CS.player.seek(2); });
        cy.cs(function (CS, win) { CS.keyframes.applyEdit(CS.getClip(win.__clip), "scale", 20); CS.commit("kf"); });
        cy.cs(function (CS, win) {
            var c = CS.getClip(win.__clip);
            return {
                n: CS.keyframes.list(c, "scale").length,
                mid: CS.keyframes.value(c, "scale", 1, 999),
                before: CS.keyframes.value(c, "scale", -1, 999),
                after: CS.keyframes.value(c, "scale", 3, 999)
            };
        }).should("deep.equal", { n: 2, mid: 60, before: 100, after: 20 });
        cy.get(".tl-clip .kf-diamond").should("have.length", 2);
        cy.get('[data-kf-diamond="scale"]').should("have.class", "on");
        //The box on the preview follows the animated scale
        cy.cs(function (CS, win) {
            var c = CS.getClip(win.__clip);
            CS.player.seek(0);
            var w0 = CS.previewctl.clipBox(c).w;
            CS.player.seek(2);
            var w2 = CS.previewctl.clipBox(c).w;
            return w2 / w0;
        }).should("be.closeTo", 0.2, 0.01);
    });

    it("supports ease and hold interpolation and keyframe navigation", function () {
        cy.cs(function (CS, win) {
            var c = CS.getClip(win.__clip);
            CS.keyframes.set(c, "x", 0, 0, "ease");
            CS.keyframes.set(c, "x", 2, 100);
            CS.keyframes.set(c, "y", 0, 0, "hold");
            CS.keyframes.set(c, "y", 2, 100);
            return {
                easeQuarter: CS.keyframes.value(c, "x", 0.5, 0),
                easeMid: CS.keyframes.value(c, "x", 1, 0),
                holdMid: CS.keyframes.value(c, "y", 1, 0),
                holdEnd: CS.keyframes.value(c, "y", 2, 0)
            };
        }).then(function (r) {
            expect(r.easeMid).to.be.closeTo(50, 0.01);
            expect(r.easeQuarter).to.be.lessThan(25); //smoothstep starts slow
            expect(r.holdMid).to.equal(0);
            expect(r.holdEnd).to.equal(100);
        });
        cy.cs(function (CS, win) {
            var c = CS.getClip(win.__clip);
            CS.player.seek(0.7);
            CS.keyframes.nav(c, "x", 1);
            var next = CS.state.playhead;
            CS.keyframes.nav(c, "x", -1);
            return { next: next, prev: CS.state.playhead };
        }).should("deep.equal", { next: 2, prev: 0 });
    });

    it("splits animated clips without changing the motion", function () {
        cy.cs(function (CS, win) {
            var c = CS.getClip(win.__clip);
            CS.keyframes.set(c, "rotation", 0, 0);
            CS.keyframes.set(c, "rotation", 4, 90);
            CS.player.seek(1);
            CS.selectClip(c.id);
            CS.splitAtPlayhead();
            var left = c;
            var right = CS.project.clips.filter(function (x) { return x.id !== c.id; })[0];
            return {
                leftKeys: CS.keyframes.list(left, "rotation").map(function (k) { return [k.t, k.v]; }),
                rightKeys: CS.keyframes.list(right, "rotation").map(function (k) { return [k.t, k.v]; }),
                atCutLeft: CS.keyframes.value(left, "rotation", 1, -1),
                atCutRight: CS.keyframes.value(right, "rotation", 1, -1),
                rightAt3: CS.keyframes.value(right, "rotation", 3, -1)
            };
        }).then(function (r) {
            expect(r.leftKeys).to.deep.equal([[0, 0], [1, 22.5]]);
            expect(r.rightKeys).to.deep.equal([[0, 22.5], [3, 90]]);
            expect(r.atCutLeft).to.be.closeTo(22.5, 0.01);
            expect(r.atCutRight).to.be.closeTo(22.5, 0.01);
            expect(r.rightAt3).to.be.closeTo(67.5, 0.01);
        });
    });

    it("fades the picture with opacity keyframes", function () {
        cy.cs(function (CS, win) {
            var c = CS.getClip(win.__clip);
            CS.keyframes.set(c, "opacity", 0, 100);
            CS.keyframes.set(c, "opacity", 4, 0);
            CS.commit("kf");
            CS.player.seek(0);
        });
        cy.centerPixel().then(function (p0) {
            expect(p0[0]).to.be.greaterThan(200);
            cy.cs(function (CS) { CS.player.seek(3.9); });
            cy.centerPixel().then(function (p1) {
                expect(p1[0]).to.be.lessThan(20);
            });
            cy.cs(function (CS) { CS.player.seek(2); });
            cy.centerPixel().then(function (p2) {
                expect(p2[0]).to.be.within(90, 160);
            });
        });
    });

    it("keyframes the volume and pan of an audio clip", function () {
        cy.seedMedia({ video: [], image: [] });
        cy.cs(function (CS, win) {
            var a = CS.addClipToTimeline(win.__media.a1, "A1", 0);
            CS.commit("audio");
            CS.selectClip(a.id);
            CS.inspector.activeTab = "audio";
            CS.inspector.updateTabs();
            CS.inspector.render();
            win.__audio = a.id;
        });
        cy.get('[data-kf-toggle="volume"]').click();
        cy.cs(function (CS, win) {
            var a = CS.getClip(win.__audio);
            CS.player.seek(2);
            CS.keyframes.applyEdit(a, "volume", 0);
            CS.keyframes.set(a, "pan", 0, -100);
            CS.keyframes.set(a, "pan", 2, 100);
            CS.commit("kf");
            CS.player.seek(1);
            CS.player.syncElements();
            var el = CS.player.pool[a.id];
            return {
                vol1: el.volume,
                pan1: el._csPanner ? el._csPanner.pan.value : 0,
                kf: CS.keyframes.list(a, "volume").length
            };
        }).then(function (r) {
            expect(r.vol1).to.be.closeTo(0.5, 0.02);
            expect(r.kf).to.equal(2);
            expect(r.pan1).to.be.closeTo(0, 0.05);
        });
        cy.cs(function (CS, win) {
            var a = CS.getClip(win.__audio);
            CS.player.seek(2);
            CS.player.syncElements();
            return CS.player.pool[a.id].volume;
        }).should("be.closeTo", 0, 0.02);
    });
});
