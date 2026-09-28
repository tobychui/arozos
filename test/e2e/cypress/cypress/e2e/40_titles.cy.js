/*
    Titles: typography controls, and caption import / export.
*/
describe("Titles and captions", function () {
    beforeEach(function () {
        cy.openStudio();
    });

    it("styles a title with font, outline, spacing and shadow", function () {
        cy.cs(function (CS) {
            CS.titles.insertPreset("title");
            var c = CS.selectedClip();
            c.props.text.content = "HELLO";
            c.props.text.size = 200;
            CS.titles.invalidate(c);
            CS.player.seek(1);
            return c.kind;
        }).should("equal", "title");
        cy.get("#inspector-body").should("contain", "Font").and("contain", "Outline").and("contain", "Spacing");
        //White glyphs somewhere in the frame (the exact centre may fall
        //between two letters)
        cy.cs(function (CS) {
            var cv = CS.player.canvas;
            var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
            var white = 0;
            for (var i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { white++; } }
            return white;
        }).then(function (white) {
            expect(white).to.be.greaterThan(500);
            cy.cs(function (CS) {
                var c = CS.selectedClip();
                c.props.text.color = "#ff0000";
                c.props.text.outline = 12;
                c.props.text.outlineColor = "#0000ff";
                c.props.text.font = "serif";
                c.props.text.italic = true;
                c.props.text.spacing = 20;
                c.props.text.shadow = false;
                CS.titles.invalidate(c);
                CS.commit("style");
                //Count coloured pixels across the whole frame
                var cv = CS.player.canvas;
                var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
                var red = 0, blue = 0;
                for (var i = 0; i < d.length; i += 4) {
                    if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { red++; }
                    if (d[i + 2] > 200 && d[i] < 60 && d[i + 1] < 60) { blue++; }
                }
                return { red: red, blue: blue };
            }).then(function (r) {
                expect(r.red).to.be.greaterThan(500);  //fill
                expect(r.blue).to.be.greaterThan(500); //outline
            });
        });
        cy.cs(function (CS) {
            var c = CS.selectedClip();
            var before = CS.titles.renderSource(c, 1920, 1080);
            c.props.text.spacing = 0;
            CS.titles.invalidate(c);
            return before !== CS.titles.renderSource(c, 1920, 1080);
        }).should("equal", true);
    });

    it("imports SRT captions onto a caption track and exports them back", function () {
        var srt = "1\n00:00:01,000 --> 00:00:02,500\nHello there\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond <i>line</i>\nwith two rows\n";
        cy.cs(function (CS, win, srt) {
            var n = CS.captions.importText(srt, "test.srt");
            var track = CS.project.tracks.filter(function (t) { return t.caption; })[0];
            var clips = CS.clipsOnTrack(track.id);
            return {
                n: n,
                trackName: track.name,
                starts: clips.map(function (c) { return c.start; }),
                ends: clips.map(function (c) { return CS.clipEnd(c); }),
                text: clips.map(function (c) { return c.props.text.content; }),
                style: clips[0].props.text.style
            };
        }, srt).then(function (r) {
            expect(r.n).to.equal(2);
            expect(r.trackName).to.equal("Captions");
            expect(r.starts).to.deep.equal([1, 3]);
            expect(r.ends).to.deep.equal([2.5, 4]);
            expect(r.text).to.deep.equal(["Hello there", "Second line\nwith two rows"]);
            expect(r.style).to.equal("box");
        });
        cy.cs(function (CS) { return CS.captions.toSRT(); }).then(function (out) {
            expect(out).to.contain("00:00:01,000 --> 00:00:02,500");
            expect(out).to.contain("Hello there");
            expect(out).to.contain("00:00:03,000 --> 00:00:04,000");
        });
        //VTT with hours and a header parses too
        cy.cs(function (CS) {
            var cues = CS.captions.parse("WEBVTT\n\nNOTE x\n\n01:02:03.250 --> 01:02:04.000 line:90%\nLate\n");
            return cues;
        }).should("deep.equal", [{ start: 3723.25, end: 3724, text: "Late" }]);
        //The caption text is painted in the lower part of the frame at 1.5 s
        //and nowhere at 2.75 s (between the two cues)
        cy.cs(function (CS) {
            function bright() {
                var cv = CS.player.canvas;
                var y0 = Math.floor(cv.height * 0.8);
                var d = cv.getContext("2d").getImageData(0, y0, cv.width, cv.height - y0).data;
                var n = 0;
                for (var i = 0; i < d.length; i += 4) { if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) { n++; } }
                return n;
            }
            CS.player.seek(1.5);
            var shown = bright();
            CS.player.seek(2.75);
            return { shown: shown, hidden: bright() };
        }).then(function (r) {
            expect(r.shown).to.be.greaterThan(200);
            expect(r.hidden).to.equal(0);
        });
    });
});
