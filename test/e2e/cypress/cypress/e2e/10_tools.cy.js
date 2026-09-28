/*
    Premiere-style editing toolset: tool shortcuts, razor, ripple / rolling
    / slip / slide / rate stretch drags, track select, track lock, in / out
    with lift and extract, gaps, nudging, linked selection, markers, the
    history panel, speed / duration and frame holds.
*/
describe("Editing tools", function () {
    beforeEach(function () {
        cy.openStudio();
    });

    it("switches tools with Premiere's shortcuts and toolbar buttons", function () {
        var keys = { v: "select", a: "trackselect", b: "ripple", n: "rolling", r: "ratestretch", c: "blade", y: "slip", u: "slide" };
        Object.keys(keys).forEach(function (k) {
            cy.get("body").type(k);
            cy.cs(function (CS) { return CS.state.tool; }).should("equal", keys[k]);
            cy.get("#tool-" + keys[k]).should("have.class", "active");
        });
        cy.get("#tool-select").click();
        cy.cs(function (CS) { return CS.state.tool; }).should("equal", "select");
        cy.get("#tl-tracks").should("have.attr", "data-tool", "select");
    });

    it("razor tool splits a clip where it is clicked", function () {
        cy.seedSequence().then(function (ids) {
            cy.get("body").type("c");
            cy.get('.tl-clip[data-clip-id="' + ids.a + '"]').then(function ($el) {
                var r = $el[0].getBoundingClientRect();
                cy.wrap($el).trigger("pointerdown", { button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 });
            });
            cy.cs(function (CS) { return CS.clipsOnTrack("V1").length; }).should("equal", 3);
        });
    });

    it("ripple trim shifts the clips after the edit", function () {
        cy.seedSequence().then(function (ids) {
            cy.get("body").type("b");
            //40 px per second: drag A's tail one second to the left
            cy.dragBy('.tl-clip[data-clip-id="' + ids.a + '"] .trim-handle.right', -40, 0);
            cy.cs(function (CS, win, ids) {
                var a = CS.getClip(ids.a), b = CS.getClip(ids.b);
                return { aDur: CS.clipDuration(a), bStart: b.start, aEnd: CS.clipEnd(a) };
            }, ids).then(function (r) {
                expect(r.aDur).to.be.closeTo(ids.aDur - 1, 0.15);
                expect(r.bStart).to.be.closeTo(r.aEnd, 0.02);
            });
            cy.cs(function (CS) { return CS.history.stack[CS.history.index].label; }).should("equal", "Ripple Trim");
        });
    });

    it("rolling edit moves the cut without changing the sequence length", function () {
        cy.seedSequence().then(function (ids) {
            //Give A some tail to extend into
            cy.cs(function (CS, win, ids) {
                var a = CS.getClip(ids.a), b = CS.getClip(ids.b);
                a.out = a.out - 1;
                b.start = CS.clipEnd(a);
                b.in = 0.5;
                CS.commit("prep");
                return CS.timelineDuration();
            }, ids).then(function (before) {
                cy.get("body").type("n");
                cy.dragBy('.tl-clip[data-clip-id="' + ids.a + '"] .trim-handle.right', 20, 0);
                cy.cs(function (CS, win, ids) {
                    var a = CS.getClip(ids.a), b = CS.getClip(ids.b);
                    return { aEnd: CS.clipEnd(a), bStart: b.start, bIn: b.in, total: CS.timelineDuration() };
                }, ids).then(function (r) {
                    expect(r.aEnd).to.be.closeTo(ids.aDur - 1 + 0.5, 0.1);
                    expect(r.bStart).to.be.closeTo(r.aEnd, 0.02);
                    expect(r.bIn).to.be.closeTo(1.0, 0.1);
                    expect(r.total).to.be.closeTo(before, 0.02);
                });
            });
        });
    });

    it("slip changes the source range but not the position", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS, win, ids) {
                var b = CS.getClip(ids.b);
                b.in = 0.5; b.out = 2.5;
                CS.commit("prep");
            }, ids);
            cy.get("body").type("y");
            cy.dragBy('.tl-clip[data-clip-id="' + ids.b + '"]', -20, 0);
            cy.cs(function (CS, win, ids) {
                var b = CS.getClip(ids.b);
                return { start: b.start, in: b.in, dur: CS.clipDuration(b) };
            }, ids).then(function (r) {
                expect(r.start).to.be.closeTo(ids.aDur, 0.02);
                expect(r.dur).to.be.closeTo(2, 0.02);
                expect(r.in).to.be.closeTo(1.0, 0.1);
            });
        });
    });

    it("slide moves a clip while its neighbours absorb the change", function () {
        cy.seedMedia({ video: [{ key: "v1", name: "A.webm", seconds: 3, hue: 200 }, { key: "v2", name: "B.webm", seconds: 3, hue: 30 }, { key: "v3", name: "C.webm", seconds: 3, hue: 120 }], audio: [] });
        cy.cs(function (CS, win) {
            var m = win.__media;
            var a = CS.addClipToTimeline(m.v1, "V1", 0);
            a.out = 2;
            var b = CS.addClipToTimeline(m.v2, "V1", 2);
            b.out = 2;
            var c = CS.addClipToTimeline(m.v3, "V1", 4);
            c.in = 0.5;
            CS.commit("prep");
            return { a: a.id, b: b.id, c: c.id, total: CS.timelineDuration() };
        }).then(function (ids) {
            cy.get("body").type("u");
            cy.dragBy('.tl-clip[data-clip-id="' + ids.b + '"]', 20, 0);
            cy.cs(function (CS, win, ids) {
                var a = CS.getClip(ids.a), b = CS.getClip(ids.b), c = CS.getClip(ids.c);
                return { aOut: a.out, bStart: b.start, cStart: c.start, cIn: c.in, total: CS.timelineDuration() };
            }, ids).then(function (r) {
                expect(r.bStart).to.be.closeTo(2.5, 0.1);
                expect(r.aOut).to.be.closeTo(2.5, 0.1);
                expect(r.cStart).to.be.closeTo(4.5, 0.1);
                expect(r.cIn).to.be.closeTo(1.0, 0.1);
                expect(r.total).to.be.closeTo(ids.total, 0.02);
            });
        });
    });

    it("rate stretch changes the speed instead of the content", function () {
        cy.seedMedia({ audio: [] });
        cy.cs(function (CS, win) {
            var a = CS.addClipToTimeline(win.__media.v1, "V1", 0);
            CS.commit("prep");
            return { a: a.id, dur: CS.clipDuration(a), src: a.out - a.in };
        }).then(function (ids) {
            cy.get("body").type("r");
            cy.dragBy('.tl-clip[data-clip-id="' + ids.a + '"] .trim-handle.right', 40, 0);
            cy.cs(function (CS, win, ids) {
                var a = CS.getClip(ids.a);
                return { dur: CS.clipDuration(a), speed: CS.clipSpeed(a), src: a.out - a.in };
            }, ids).then(function (r) {
                expect(r.src).to.be.closeTo(ids.src, 0.001);
                expect(r.dur).to.be.closeTo(ids.dur + 1, 0.15);
                expect(r.speed).to.be.lessThan(1);
            });
            cy.get('.tl-clip[data-clip-id="' + ids.a + '"] .clip-speed').should("exist");
        });
    });

    it("track select forward selects everything after the click", function () {
        cy.seedSequence().then(function (ids) {
            cy.get("body").type("a");
            cy.get('.tl-clip[data-clip-id="' + ids.a + '"]').trigger("pointerdown", { button: 0, pointerId: 1 });
            cy.cs(function (CS) { return CS.state.selectedClipIds.length; }).should("equal", 2);
            cy.get(".tl-clip.selected").should("have.length", 2);
        });
    });

    it("locked tracks refuse edits", function () {
        cy.seedSequence().then(function (ids) {
            cy.get('.track-header[data-track-id="V1"] .th-lock').click();
            cy.cs(function (CS) { return CS.getTrack("V1").locked; }).should("equal", true);
            cy.get(".tl-track.locked").should("have.length", 1);
            cy.dragBy('.tl-clip[data-clip-id="' + ids.a + '"]', 80, 0);
            cy.cs(function (CS, win, ids) {
                CS.selectClip(ids.a);
                CS.deleteSelectedClip();
                return { start: CS.getClip(ids.a).start, count: CS.project.clips.length };
            }, ids).should("deep.equal", { start: 0, count: 3 });
            cy.get('.track-header[data-track-id="V1"] .th-lock').click();
            cy.cs(function (CS) { return CS.getTrack("V1").locked; }).should("equal", false);
        });
    });

    it("in / out points drive lift and extract", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS) { CS.player.seek(1); });
            cy.get("body").type("i");
            cy.cs(function (CS) { CS.player.seek(2); });
            cy.get("body").type("o");
            cy.cs(function (CS) { return { i: CS.state.inPoint, o: CS.state.outPoint }; }).should("deep.equal", { i: 1, o: 2 });
            cy.get("#tl-range").should("be.visible");

            cy.get("body").type(";");
            cy.cs(function (CS) {
                return { gap: CS.gapAt("V1", 1.5), gapA: CS.gapAt("A1", 1.5), total: CS.timelineDuration() };
            }).then(function (r) {
                expect(r.gap).to.deep.equal({ start: 1, end: 2 });
                expect(r.gapA).to.deep.equal({ start: 1, end: 2 });
                expect(r.total).to.be.closeTo(ids.aDur + ids.bDur, 0.05);
            });

            cy.cs(function (CS) { CS.undo(); return CS.gapAt("V1", 1.5); }).should("equal", null);
            cy.get("body").type("'");
            cy.cs(function (CS) {
                return { total: CS.timelineDuration(), range: CS.inOutRange(), gap: CS.gapAt("V1", 1.5) };
            }).then(function (r) {
                expect(r.total).to.be.closeTo(ids.aDur + ids.bDur - 1, 0.05);
                expect(r.range).to.equal(null);
                expect(r.gap).to.equal(null);
            });
        });
    });

    it("closes gaps, nudges clips and zooms to the sequence", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS, win, ids) {
                var b = CS.getClip(ids.b);
                b.start += 1.5;
                CS.commit("gap");
                var gap = CS.gapAt("V1", ids.aDur + 0.5);
                CS.closeGap("V1", gap);
                return CS.getClip(ids.b).start;
            }, ids).then(function (start) {
                expect(start).to.be.closeTo(ids.aDur, 0.01);
            });

            cy.cs(function (CS, win, ids) { CS.selectClip(ids.b); }, ids);
            cy.get("body").type("{alt}{rightArrow}");
            cy.cs(function (CS, win, ids) { return CS.getClip(ids.b).start; }, ids).then(function (start) {
                expect(start).to.be.closeTo(ids.aDur + 1 / 30, 0.005);
            });

            cy.get("body").type("\\");
            cy.cs(function (CS, win) {
                var scroll = win.document.getElementById("tl-scroll");
                return { fits: CS.timelineDuration() * CS.state.zoom <= scroll.clientWidth };
            }).should("deep.equal", { fits: true });
        });
    });

    it("keeps detached audio linked to its video", function () {
        cy.seedSequence().then(function (ids) {
            cy.cs(function (CS, win, ids) {
                CS.detachAudio(CS.getClip(ids.a));
                CS.selectClip(ids.a);
                return { selected: CS.state.selectedClipIds.length, linked: !!CS.getClip(ids.a).props.link };
            }, ids).should("deep.equal", { selected: 2, linked: true });
            cy.get(".tl-clip .clip-link").should("have.length", 2);
            cy.cs(function (CS, win, ids) {
                CS.player.seek(1);
                CS.selectClip(ids.a);
                CS.splitAtPlayhead();
                return CS.project.clips.length;
            }, ids).should("equal", 6); //A + A', its audio in 2 halves, B, the seeded audio clip
            cy.get("#btn-linked").click();
            cy.cs(function (CS, win, ids) { CS.selectClip(ids.a); return CS.state.selectedClipIds.length; }, ids).should("equal", 1);
            //Unlinking clears the whole group: both halves of the video and both halves of the audio
            cy.cs(function (CS) { CS.unlinkClips(); return CS.project.clips.filter(function (c) { return c.props.link; }).length; }).should("equal", 0);
        });
    });

    it("names and colours markers and lists history", function () {
        cy.seedSequence();
        cy.cs(function (CS) { CS.player.seek(1.5); });
        cy.get("body").type("m");
        cy.cs(function (CS) {
            var m = CS.markerNear(1.5, 0.01);
            m.name = "Intro";
            m.color = CS.MARKER_COLORS[1];
            m.duration = 1;
            CS.timeline.drawRuler();
            return CS.project.markers.length;
        }).should("equal", 1);
        cy.cs(function (CS) { CS.editMarkerDialog(CS.project.markers[0]); });
        cy.get(".modal-title").should("contain", "Marker");
        cy.get(".modal-row input[type=text]").first().should("have.value", "Intro");
        cy.get(".modal-btn").contains("Save").click();

        cy.cs(function (CS) { CS.historyDialog(); return CS.history.stack.length; }).then(function (n) {
            cy.get(".history-item").should("have.length", n);
            cy.get(".history-item.current").should("have.length", 1);
            cy.get(".history-item").first().click();
            cy.cs(function (CS) { return { idx: CS.history.index, clips: CS.project.clips.length }; }).should("deep.equal", { idx: 0, clips: 0 });
        });
    });

    it("sets speed, reverse and adds a frame hold", function () {
        cy.seedMedia({ audio: [] });
        cy.cs(function (CS, win) {
            var a = CS.addClipToTimeline(win.__media.v1, "V1", 0);
            CS.commit("prep");
            CS.speedDialog(a);
            return a.id;
        }).then(function (id) {
            cy.get(".modal-title").should("contain", "Speed");
            cy.get(".modal-row input[type=text]").first().clear().type("200");
            cy.get(".modal-row input[type=checkbox]").check();
            cy.get(".modal-btn").contains("Apply").click();
            cy.cs(function (CS, win, id) {
                var a = CS.getClip(id);
                return { speed: CS.clipSpeed(a), reverse: a.props.reverse, dur: CS.clipDuration(a) };
            }, id).then(function (r) {
                expect(r.speed).to.equal(2);
                expect(r.reverse).to.equal(true);
                expect(r.dur).to.be.lessThan(2);
            });
            cy.get(".tl-clip .clip-speed").should("contain", "-200%");

            //Frame hold needs a decoded frame in the pool element
            cy.cs(function (CS) { CS.player.seek(0.5); CS.player.syncElements(); });
            cy.wait(800);
            cy.cs(function (CS, win, id) {
                var el = CS.player.pool[id];
                return el ? el.readyState : -1;
            }, id).should("be.gte", 2);
            cy.cs(function (CS, win, id) { CS.addFrameHold(CS.getClip(id)); }, id);
            //The still is captured asynchronously (canvas.toBlob)
            cy.window().should(function (win) {
                var CS = win.CS;
                var stills = CS.project.media.filter(function (m) { return m.type === "image"; });
                expect(stills.length).to.equal(1);
                expect(CS.project.clips.length).to.equal(3);
                var hold = CS.project.clips.filter(function (c) { return c.mediaId === stills[0].id; })[0];
                expect(hold.start).to.be.closeTo(0.5, 0.01);
                expect(CS.clipDuration(hold)).to.equal(2);
            });
        });
    });
});
