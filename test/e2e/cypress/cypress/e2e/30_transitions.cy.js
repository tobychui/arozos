/*
    Video and audio transitions, adjustment layers and the chroma key.
*/
describe("Transitions, adjustment layers and keying", function () {
    beforeEach(function () {
        cy.openStudio();
    });

    it("draws every video transition without errors and blends the frames", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS, win, ids) {
                var b = CS.getClip(ids.b);
                var types = CS.transitions.registry.filter(function (r) { return r.type !== "none"; }).map(function (r) { return r.type; });
                var ok = [];
                types.forEach(function (type) {
                    b.props.transition = { type: type, duration: 1 };
                    var win2 = CS.transitions.windowAt(b, b.start + 0.5);
                    CS.player.seek(b.start + 0.5);
                    ok.push(type + ":" + (win2 && Math.abs(win2.k - 0.5) < 0.01 ? "ok" : "bad"));
                });
                return { types: types.length, bad: ok.filter(function (s) { return /bad$/.test(s); }) };
            }, ids).then(function (r) {
                expect(r.types).to.be.greaterThan(15);
                expect(r.bad).to.deep.equal([]);
            });
            //Dissolve half way: pixels are a mix of the warm and the cool clip
            cy.cs(function (CS, win, ids) {
                var b = CS.getClip(ids.b);
                b.props.transition = { type: "dissolve", duration: 1 };
                CS.commit("dissolve");
                CS.player.seek(b.start + 0.5);
                CS.player.syncElements();
            }, ids);
            cy.wait(600);
            cy.cs(function (CS) { CS.player.render(); });
            cy.centerPixel().then(function (px) {
                expect(px[0] + px[1] + px[2]).to.be.greaterThan(30);
            });
            cy.get(".tl-clip .clip-tr").should("have.length", 1);
        });
    });

    it("lists transitions in the gallery and applies them by click", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS, win, ids) { CS.selectClip(ids.b); }, ids);
            cy.get('.nav-item[data-nav="transitions"]').click();
            cy.get('#transitions-grid .fx-card[data-tr-type="pushleft"]').click();
            cy.cs(function (CS, win, ids) { return CS.getClip(ids.b).props.transition.type; }, ids).should("equal", "pushleft");
            cy.get('#transitions-grid .fx-card[data-tr-type="pushleft"]').should("have.class", "applied");
            cy.get('#transitions-grid .fx-card[data-at-type="power"]').click();
            cy.cs(function (CS, win, ids) { return CS.getClip(ids.b).props.audioTransition.type; }, ids).should("equal", "power");
        });
    });

    it("applies a constant power audio crossfade across the cut", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS, win, ids) {
                var a = CS.getClip(ids.a), b = CS.getClip(ids.b);
                b.props.audioTransition = { type: "power", duration: 1 };
                CS.commit("xfade");
                return {
                    bStart: CS.transitions.audioGain(b, b.start),
                    bHalf: CS.transitions.audioGain(b, b.start + 0.5),
                    bDone: CS.transitions.audioGain(b, b.start + 1.5),
                    aEnd: CS.transitions.audioGain(a, CS.clipEnd(a) - 0.001),
                    aHalf: CS.transitions.audioGain(a, CS.clipEnd(a) - 0.5),
                    aEarly: CS.transitions.audioGain(a, 0.5)
                };
            }, ids).then(function (g) {
                expect(g.bStart).to.be.closeTo(0, 0.01);
                expect(g.bHalf).to.be.closeTo(Math.SQRT1_2, 0.02);
                expect(g.bDone).to.equal(1);
                expect(g.aEnd).to.be.closeTo(0, 0.01);
                expect(g.aHalf).to.be.closeTo(Math.SQRT1_2, 0.02);
                expect(g.aEarly).to.equal(1);
            });
            cy.get(".tl-clip .clip-tr.audio").should("have.length", 1);
        });
    });

    it("adjustment layers colour everything below them", function () {
        cy.seedMedia({ video: [], audio: [], image: [{ key: "i1", name: "Red.png", color: "#ff0000" }] });
        cy.cs(function (CS, win) {
            var c = CS.addClipToTimeline(win.__media.i1, "V1", 0);
            c.props.crop = "fill";
            CS.commit("seed");
            CS.player.seek(1);
            CS.titles.insertElement("adjust");
            var adj = CS.selectedClip();
            return { kind: adj.kind, track: adj.trackId };
        }).then(function (r) {
            expect(r.kind).to.equal("adjust");
            expect(r.track).to.equal("V2");
        });
        cy.get(".tl-clip.adjust-clip").should("have.length", 1);
        cy.centerPixel().then(function (before) {
            expect(before[0]).to.be.greaterThan(200);
            expect(before[1]).to.be.lessThan(40);
            cy.cs(function (CS) {
                var adj = CS.selectedClip();
                adj.props.saturation = 0;
                CS.commit("desaturate");
            });
            cy.centerPixel().then(function (after) {
                expect(Math.abs(after[0] - after[1])).to.be.lessThan(20);
                expect(Math.abs(after[1] - after[2])).to.be.lessThan(20);
            });
            cy.cs(function (CS) {
                var adj = CS.selectedClip();
                adj.props.saturation = 1;
                adj.props.opacity = 0;
                CS.commit("off");
            });
            cy.centerPixel().then(function (again) {
                expect(again[0]).to.be.greaterThan(200);
            });
        });
    });

    it("keys out a green screen with Ultra Key", function () {
        //A green frame with a red square in the middle, over a blue board
        cy.cs(function (CS, win) {
            var cv = win.document.createElement("canvas");
            cv.width = 320; cv.height = 180;
            var ctx = cv.getContext("2d");
            ctx.fillStyle = "#00ff00";
            ctx.fillRect(0, 0, 320, 180);
            ctx.fillStyle = "#ff0000";
            ctx.fillRect(120, 60, 80, 60);
            return new Promise(function (resolve) {
                cv.toBlob(function (blob) {
                    win.__green = CS.media.register({ name: "Green.png", blobUrl: win.URL.createObjectURL(blob), type: "image" });
                    resolve();
                }, "image/png");
            });
        });
        cy.window().should(function (win) { expect(win.__green.probed).to.equal(true); });
        cy.cs(function (CS, win) {
            CS.titles.insertElement("blue");
            var board = CS.selectedClip();
            board.trackId = "V1";
            var c = CS.addClipToTimeline(win.__green, "V2", 0);
            if (!c) { CS.createTrack("video"); c = CS.addClipToTimeline(win.__green, "V2", 0); }
            c.props.crop = "fill";
            CS.commit("seed");
            CS.player.seek(1);
            return { tracks: CS.project.tracks.filter(function (t) { return t.kind === "video"; }).length };
        }).then(function (r) { expect(r.tracks).to.be.gte(2); });
        cy.pixelAt(0.1, 0.1).then(function (edge) {
            expect(edge[1]).to.be.greaterThan(200); //green screen still visible
            cy.cs(function (CS, win) {
                var c = CS.project.clips.filter(function (x) { return x.mediaId === win.__green.id; })[0];
                CS.selectClip(c.id);
                CS.effects.applyToClip(c, "chromakey");
                var fx = CS.effects.clipHas(c, "chromakey");
                fx.color = "#00ff00";
                fx.similarity = 30;
                fx.blend = 5;
                CS.commit("key");
                CS.player.seek(1);
            });
            cy.pixelAt(0.1, 0.1).then(function (keyed) {
                //The blue board (#1e63c9) shows through where the green was
                expect(keyed[0]).to.be.lessThan(60);
                expect(keyed[1]).to.be.within(70, 130);
                expect(keyed[2]).to.be.greaterThan(170);
            });
            cy.pixelAt(0.5, 0.5).then(function (centre) {
                expect(centre[0]).to.be.greaterThan(200); //red square survives
            });
        });
        cy.get('.nav-item[data-nav="effects"]').click();
        cy.get('#fx-grid .fx-card[data-fx-type="chromakey"]').should("have.class", "applied");
    });
});
