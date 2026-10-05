/*
    ag-psd 31.0.2 (MIT, https://github.com/Agamnentzar/ag-psd), browserify
    standalone bundle exposing the global agPsd. Vendored for Pixel Studio.

    Local patch (search for "[arozos patch]"): additional layer info blocks the
    library does not understand, or fails to parse, are kept as raw bytes in
    target.unknownAdditionalInfo and written back unchanged, so a PSD
    file survives a load / save round trip without losing data ag-psd cannot
    model.
*/
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.agPsd = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAbr = readAbr;
const descriptor_1 = require("./descriptor");
const psdReader_1 = require("./psdReader");
const dynamicsControl = ['off', 'fade', 'pen pressure', 'pen tilt', 'stylus wheel', 'initial direction', 'direction', 'initial rotation', 'rotation'];
const dynamicBrushShapeShapes = ['round point', 'round blunt', 'round curve', 'round angle', 'round fan', 'flat point', 'flat blunt', 'flat curve', 'flat angle', 'flat fan'];
const tipsBrushShapeShapes = ['erodible point', 'erodible flat', 'erodible round', 'erodible square', 'erodible triangle', 'custom'];
const toBrushType = {
    _: 'brush',
    MixB: 'mixer brush',
    SmTl: 'smudge brush',
    // PbTl
    // ErTl
};
function parseDynamics(desc) {
    return {
        control: dynamicsControl[desc.bVTy],
        steps: desc.fStp,
        jitter: (0, descriptor_1.parsePercent)(desc.jitter),
        minimum: (0, descriptor_1.parsePercent)(desc['Mnm ']),
    };
}
function parseBrushShape(desc) {
    switch (desc._classID) {
        case 'computedBrush': {
            return {
                type: 'computed',
                size: (0, descriptor_1.parseUnitsToNumber)(desc.Dmtr, 'Pixels'),
                angle: (0, descriptor_1.parseAngle)(desc.Angl),
                roundness: (0, descriptor_1.parsePercent)(desc.Rndn),
                spacingOn: desc.Intr,
                spacing: (0, descriptor_1.parsePercent)(desc.Spcn),
                flipX: desc.flipX,
                flipY: desc.flipY,
                hardness: (0, descriptor_1.parsePercent)(desc.Hrdn),
            };
        }
        case 'sampledBrush': {
            return {
                type: 'sampled',
                size: (0, descriptor_1.parseUnitsToNumber)(desc.Dmtr, 'Pixels'),
                angle: (0, descriptor_1.parseAngle)(desc.Angl),
                roundness: (0, descriptor_1.parsePercent)(desc.Rndn),
                spacingOn: desc.Intr,
                spacing: (0, descriptor_1.parsePercent)(desc.Spcn),
                flipX: desc.flipX,
                flipY: desc.flipY,
                name: desc['Nm  '],
                sampledData: desc.sampledData,
            };
        }
        case 'dBrush':
            return {
                type: 'dynamic',
                shape: dynamicBrushShapeShapes[desc['Shp ']],
                angle: (0, descriptor_1.parseAngle)(desc.Angl),
                size: (0, descriptor_1.parseUnitsToNumber)(desc.Dmtr, 'Pixels'),
                density: (0, descriptor_1.parsePercent)(desc.Dnst),
                length: (0, descriptor_1.parsePercent)(desc.Lngt),
                clumping: (0, descriptor_1.parsePercent)(desc.clumping),
                thickness: (0, descriptor_1.parsePercent)(desc.thickness),
                stiffness: (0, descriptor_1.parsePercent)(desc.stiffness),
                physics: desc.physics,
                spacing: (0, descriptor_1.parsePercent)(desc.Spcn),
                spacingOn: desc.Intr,
                flipX: desc.flipX,
                flipY: desc.flipY,
            };
        case 'dTips': {
            return Object.assign(Object.assign({ type: 'tips', angle: (0, descriptor_1.parseAngle)(desc.Angl), size: (0, descriptor_1.parseUnitsToNumber)(desc.Dmtr, 'Pixels'), shape: dynamicBrushShapeShapes[desc['Shp ']], physics: desc.physics, spacing: (0, descriptor_1.parsePercent)(desc.Spcn), spacingOn: desc.Intr, flipX: desc.flipX, flipY: desc.flipY, 
                // tips:
                tipsType: tipsBrushShapeShapes[desc.dtipsType], tipsLengthRatio: (0, descriptor_1.parsePercent)(desc.dtipsLengthRatio), tipsHardness: (0, descriptor_1.parsePercent)(desc.dtipsHardness) }, ((desc.dtipsGridSize && desc.dtipsErodibleTipHeightMap) ? {
                tipsGridSize: desc.dtipsGridSize,
                tipsErodibleTipHeightMap: parseHeightmap(desc.dtipsErodibleTipHeightMap),
            } : {})), { 
                // airbrush
                tipsAirbrushCutoffAngle: desc.dtipsAirbrushCutoffAngle, tipsAirbrushGranularity: (0, descriptor_1.parsePercent)(desc.dtipsAirbrushGranularity), tipsAirbrushStreakiness: (0, descriptor_1.parsePercent)(desc.dtipsAirbrushStreakiness), tipsAirbrushSplatSize: (0, descriptor_1.parsePercent)(desc.dtipsAirbrushSplatSize), tipsAirbrushSplatCount: desc.dtipsAirbrushSplatCount });
        }
        default:
            // console.log(require('util').inspect(desc, false, 99, true));
            throw new Error(`Unknown brush classId: ${desc._classID}`);
    }
}
function parseHeightmap(array) {
    const result = [];
    for (let i = 0; i < array.byteLength; i++) {
        result.push(array[i]);
    }
    return result;
    // const view = new DataView(array.buffer, array.byteOffset, array.byteLength);
    // const result: number[] = [];
    // for (let i = 0, len = (array.byteLength / 4) | 0; i < len; i++) {
    // 	result.push(view.getInt32(i * 4)); ????
    // }
    // return result;
}
function readAbr(buffer, options = {}) {
    var _a, _b, _c, _d;
    const reader = (0, psdReader_1.createReader)(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const version = (0, psdReader_1.readInt16)(reader);
    const samples = [];
    const brushes = [];
    const patterns = [];
    if (version === 1 || version === 2) {
        throw new Error(`Unsupported ABR version (${version})`); // TODO: ...
    }
    else if (version === 6 || version === 7 || version === 9 || version === 10) {
        const minorVersion = (0, psdReader_1.readInt16)(reader);
        if (minorVersion !== 1 && minorVersion !== 2)
            throw new Error('Unsupported ABR minor version');
        while (reader.offset < reader.view.byteLength) {
            (0, psdReader_1.checkSignature)(reader, '8BIM');
            const type = (0, psdReader_1.readSignature)(reader);
            let size = (0, psdReader_1.readUint32)(reader);
            const end = reader.offset + size;
            switch (type) {
                case 'samp': {
                    while (reader.offset < end) {
                        let brushLength = (0, psdReader_1.readUint32)(reader);
                        while (brushLength & 0b11)
                            brushLength++; // pad to 4 byte alignment
                        const brushEnd = reader.offset + brushLength;
                        const id = (0, psdReader_1.readPascalString)(reader, 1);
                        // v1 - Skip the Int16 bounds rectangle and the unknown Int16.
                        // v2 - Skip the unknown bytes.
                        (0, psdReader_1.skipBytes)(reader, minorVersion === 1 ? 10 : 264);
                        const y = (0, psdReader_1.readInt32)(reader);
                        const x = (0, psdReader_1.readInt32)(reader);
                        const h = (0, psdReader_1.readInt32)(reader) - y;
                        const w = (0, psdReader_1.readInt32)(reader) - x;
                        if (w <= 0 || h <= 0)
                            throw new Error('Invalid bounds');
                        const bithDepth = (0, psdReader_1.readInt16)(reader);
                        const compression = (0, psdReader_1.readUint8)(reader); // 0 - raw, 1 - RLE
                        const alpha = new Uint8Array(w * h);
                        if (bithDepth === 8) {
                            if (compression === 0) {
                                alpha.set((0, psdReader_1.readBytes)(reader, alpha.byteLength));
                            }
                            else if (compression === 1) {
                                (0, psdReader_1.readDataRLE)(reader, { width: w, height: h, data: alpha }, w, h, bithDepth, 1, [0], false);
                            }
                            else {
                                throw new Error('Invalid compression');
                            }
                        }
                        else if (bithDepth === 16) {
                            if (compression === 0) {
                                for (let i = 0; i < alpha.byteLength; i++) {
                                    alpha[i] = (0, psdReader_1.readUint16)(reader) >> 8; // convert to 8bit values
                                }
                            }
                            else if (compression === 1) {
                                throw new Error('not implemented (16bit RLE)'); // TODO: ...
                            }
                            else {
                                throw new Error('Invalid compression');
                            }
                        }
                        else {
                            throw new Error('Invalid depth');
                        }
                        samples.push({ id, bounds: { x, y, w, h }, alpha });
                        reader.offset = brushEnd;
                    }
                    break;
                }
                case 'desc': {
                    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader, true);
                    // console.log(require('util').inspect(desc, false, 99, true));
                    // require('fs').writeFileSync('test.log', require('util').inspect(desc, false, 99, false), 'utf8');
                    for (const brush of desc.Brsh) {
                        const b = {
                            name: brush['Nm  '],
                            shape: parseBrushShape(brush.Brsh),
                            spacing: (0, descriptor_1.parsePercent)(brush.Spcn),
                            // TODO: brushGroup ???
                            wetEdges: brush.Wtdg,
                            noise: brush.Nose,
                            // TODO: TxtC ??? smoothing / build-up ?
                            // TODO: 'Rpt ' ???
                            useBrushSize: brush.useBrushSize, // ???
                        };
                        if (brush.interpretation != null)
                            b.interpretation = brush.interpretation;
                        if (brush.protectTexture != null)
                            b.protectTexture = brush.protectTexture;
                        if (brush.useTipDynamics) {
                            b.shapeDynamics = {
                                tiltScale: (0, descriptor_1.parsePercent)(brush.tiltScale),
                                sizeDynamics: parseDynamics(brush.szVr),
                                angleDynamics: parseDynamics(brush.angleDynamics),
                                roundnessDynamics: parseDynamics(brush.roundnessDynamics),
                                flipX: brush.flipX,
                                flipY: brush.flipY,
                                brushProjection: brush.brushProjection,
                                minimumDiameter: (0, descriptor_1.parsePercent)(brush.minimumDiameter),
                                minimumRoundness: (0, descriptor_1.parsePercent)(brush.minimumRoundness),
                            };
                        }
                        if (brush.useScatter) {
                            b.scatter = {
                                count: brush['Cnt '],
                                bothAxes: brush.bothAxes,
                                countDynamics: parseDynamics(brush.countDynamics),
                                scatterDynamics: parseDynamics(brush.scatterDynamics),
                            };
                        }
                        if (brush.useTexture && brush.Txtr) {
                            b.texture = {
                                id: brush.Txtr.Idnt,
                                name: brush.Txtr['Nm  '],
                                blendMode: descriptor_1.BlnM.decode(brush.textureBlendMode),
                                depth: (0, descriptor_1.parsePercent)(brush.textureDepth),
                                depthMinimum: (0, descriptor_1.parsePercent)(brush.minimumDepth),
                                depthDynamics: parseDynamics(brush.textureDepthDynamics),
                                scale: (0, descriptor_1.parsePercent)(brush.textureScale),
                                invert: brush.InvT,
                                brightness: brush.textureBrightness,
                                contrast: brush.textureContrast,
                                textureEachTip: !!brush.TxtC,
                            };
                        }
                        const db = brush.dualBrush;
                        if (db && db.useDualBrush) {
                            b.dualBrush = {
                                flip: db.Flip,
                                shape: parseBrushShape(db.Brsh),
                                blendMode: descriptor_1.BlnM.decode(db.BlnM),
                                useScatter: db.useScatter,
                                spacing: (0, descriptor_1.parsePercent)(db.Spcn),
                                count: db['Cnt '],
                                bothAxes: db.bothAxes,
                                countDynamics: parseDynamics(db.countDynamics),
                                scatterDynamics: parseDynamics(db.scatterDynamics),
                            };
                        }
                        if (brush.useColorDynamics) {
                            b.colorDynamics = {
                                foregroundBackground: parseDynamics(brush.clVr),
                                hue: (0, descriptor_1.parsePercent)(brush['H   ']),
                                saturation: (0, descriptor_1.parsePercent)(brush.Strt),
                                brightness: (0, descriptor_1.parsePercent)(brush.Brgh),
                                purity: (0, descriptor_1.parsePercent)(brush.purity),
                                perTip: brush.colorDynamicsPerTip,
                            };
                        }
                        if (brush.usePaintDynamics) {
                            b.transfer = {
                                flowDynamics: parseDynamics(brush.prVr),
                                opacityDynamics: parseDynamics(brush.opVr),
                                wetnessDynamics: parseDynamics(brush.wtVr),
                                mixDynamics: parseDynamics(brush.mxVr),
                            };
                        }
                        if (brush.useBrushPose) {
                            b.brushPose = {
                                overrideAngle: brush.overridePoseAngle,
                                overrideTiltX: brush.overridePoseTiltX,
                                overrideTiltY: brush.overridePoseTiltY,
                                overridePressure: brush.overridePosePressure,
                                pressure: (0, descriptor_1.parsePercent)(brush.brushPosePressure),
                                tiltX: brush.brushPoseTiltX,
                                tiltY: brush.brushPoseTiltY,
                                angle: brush.brushPoseAngle,
                            };
                        }
                        const to = brush.toolOptions;
                        if (to) {
                            b.toolOptions = {
                                type: toBrushType[to._classID] || 'brush',
                                brushPreset: to.brushPreset,
                                flow: (_a = to.flow) !== null && _a !== void 0 ? _a : 100,
                                smooth: (_b = to.Smoo) !== null && _b !== void 0 ? _b : 0,
                                mode: descriptor_1.BlnM.decode(to['Md  '] || 'BlnM.Nrml'), // sometimes mode is missing
                                opacity: (_c = to.Opct) !== null && _c !== void 0 ? _c : 100,
                                smoothing: !!to.smoothing,
                                smoothingValue: to.smoothingValue || 0,
                                smoothingRadiusMode: !!to.smoothingRadiusMode,
                                smoothingCatchup: !!to.smoothingCatchup,
                                smoothingCatchupAtEnd: !!to.smoothingCatchupAtEnd,
                                smoothingZoomCompensation: !!to.smoothingZoomCompensation,
                                pressureSmoothing: !!to.pressureSmoothing,
                                usePressureOverridesSize: !!to.usePressureOverridesSize,
                                usePressureOverridesOpacity: !!to.usePressureOverridesOpacity,
                                useLegacy: !!to.useLegacy,
                            };
                            if (to.prVr)
                                b.toolOptions.flowDynamics = parseDynamics(to.prVr);
                            if (to.opVr)
                                b.toolOptions.opacityDynamics = parseDynamics(to.opVr);
                            if (to.szVr)
                                b.toolOptions.sizeDynamics = parseDynamics(to.szVr);
                            if ('wetness' in to)
                                b.toolOptions.wetness = to.wetness;
                            if ('dryness' in to)
                                b.toolOptions.dryness = to.dryness;
                            if ('mix' in to)
                                b.toolOptions.mix = to.mix;
                            if ('autoFill' in to)
                                b.toolOptions.autoFill = to.autoFill;
                            if ('autoClean' in to)
                                b.toolOptions.autoClean = to.autoClean;
                            if ('loadSolidColorOnly' in to)
                                b.toolOptions.loadSolidColorOnly = to.loadSolidColorOnly;
                            if ('sampleAllLayers' in to)
                                b.toolOptions.sampleAllLayers = to.sampleAllLayers;
                            if ('SmdF' in to)
                                b.toolOptions.smudgeFingerPainting = to.SmdF;
                            if ('SmdS' in to)
                                b.toolOptions.smudgeSampleAllLayers = to.SmdS;
                            if ('Prs ' in to)
                                b.toolOptions.strength = to['Prs '];
                        }
                        brushes.push(b);
                    }
                    break;
                }
                case 'patt': {
                    while (reader.offset < end) {
                        patterns.push((0, psdReader_1.readPattern)(reader));
                    }
                    reader.offset = end;
                    break;
                }
                case 'phry': {
                    // TODO: what is this ?
                    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                    // example:
                    // hierarchy: [
                    // 	{
                    // 		'Nm  ': 'PRE_EXPORT ',
                    // 		zuid: '965209f2-6f35-9a40-aa43-485684382172'
                    // 	},
                    // 	{},
                    //  ...
                    // ]
                    if (options.logMissingFeatures) {
                        if ((_d = desc.hierarchy) === null || _d === void 0 ? void 0 : _d.length) {
                            // console.log('unhandled phry section', desc);
                        }
                    }
                    break;
                }
                default:
                    throw new Error(`Invalid brush type: ${type}`);
            }
            // align to 4 bytes
            while (size % 4) {
                reader.offset++;
                size++;
            }
        }
    }
    else {
        throw new Error(`Unsupported ABR version (${version})`);
    }
    return { samples, patterns, brushes };
}

},{"./descriptor":4,"./psdReader":13}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.booleanOperations = exports.infoHandlersMap = exports.infoHandlers = void 0;
exports.readBezierKnot = readBezierKnot;
exports.readVectorMask = readVectorMask;
exports.hasMultiEffects = hasMultiEffects;
const base64_js_1 = require("base64-js");
const effectsHelpers_1 = require("./effectsHelpers");
const helpers_1 = require("./helpers");
const psdReader_1 = require("./psdReader");
const psdWriter_1 = require("./psdWriter");
const descriptor_1 = require("./descriptor");
const engineData_1 = require("./engineData");
const text_1 = require("./text");
const engineData2_1 = require("./engineData2");
const fromAtoZ = 'abcdefghijklmnopqrstuvwxyz';
exports.infoHandlers = [];
exports.infoHandlersMap = {};
function addHandler(key, has, read, write) {
    const handler = { key, has, read, write };
    exports.infoHandlers.push(handler);
    exports.infoHandlersMap[handler.key] = handler;
}
function addHandlerAlias(key, target) {
    exports.infoHandlersMap[key] = exports.infoHandlersMap[target];
}
function hasKey(key) {
    return (target) => target[key] !== undefined;
}
function readLength64(reader) {
    if ((0, psdReader_1.readUint32)(reader))
        throw new Error(`Resource size above 4 GB limit at ${reader.offset.toString(16)}`);
    return (0, psdReader_1.readUint32)(reader);
}
function writeLength64(writer, length) {
    (0, psdWriter_1.writeUint32)(writer, 0);
    (0, psdWriter_1.writeUint32)(writer, length);
}
addHandler('TySh', hasKey('text'), (reader, target, leftBytes) => {
    if ((0, psdReader_1.readInt16)(reader) !== 1)
        throw new Error(`Invalid TySh version`);
    const transform = [];
    for (let i = 0; i < 6; i++)
        transform.push((0, psdReader_1.readFloat64)(reader));
    if ((0, psdReader_1.readInt16)(reader) !== 50)
        throw new Error(`Invalid TySh text version`);
    const text = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log(require('util').inspect(text, false, 99, false), 'utf8');
    if ((0, psdReader_1.readInt16)(reader) !== 1)
        throw new Error(`Invalid TySh warp version`);
    const warp = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log(require('util').inspect(warp, false, 99, false), 'utf8');
    target.text = {
        transform,
        left: (0, psdReader_1.readFloat32)(reader),
        top: (0, psdReader_1.readFloat32)(reader),
        right: (0, psdReader_1.readFloat32)(reader),
        bottom: (0, psdReader_1.readFloat32)(reader),
        text: text['Txt '].replace(/\r/g, '\n'),
        index: text.TextIndex || 0,
        gridding: descriptor_1.textGridding.decode(text.textGridding),
        antiAlias: descriptor_1.Annt.decode(text.AntA),
        orientation: descriptor_1.Ornt.decode(text.Ornt),
        warp: {
            style: descriptor_1.warpStyle.decode(warp.warpStyle),
            value: warp.warpValue || 0,
            perspective: warp.warpPerspective || 0,
            perspectiveOther: warp.warpPerspectiveOther || 0,
            rotate: descriptor_1.Ornt.decode(warp.warpRotate),
        },
    };
    if (text.bounds)
        target.text.bounds = (0, descriptor_1.descBoundsToBounds)(text.bounds);
    if (text.boundingBox)
        target.text.boundingBox = (0, descriptor_1.descBoundsToBounds)(text.boundingBox);
    if (text.EngineData) {
        const engineData = (0, engineData_1.parseEngineData)(text.EngineData);
        const textData = (0, text_1.decodeEngineData)(engineData);
        // console.log(require('util').inspect(engineData, false, 99, false), 'utf8');
        // require('fs').writeFileSync(`layer-${target.name}.txt`, require('util').inspect(engineData, false, 99, false), 'utf8');
        // const before = parseEngineData(text.EngineData);
        // const after = encodeEngineData(engineData);
        // require('fs').writeFileSync('before.txt', require('util').inspect(before, false, 99, false), 'utf8');
        // require('fs').writeFileSync('after.txt', require('util').inspect(after, false, 99, false), 'utf8');
        // console.log(require('util').inspect(parseEngineData(text.EngineData), false, 99, true));
        target.text = Object.assign(Object.assign({}, target.text), textData);
        // console.log(require('util').inspect(target.text, false, 99, true));
    }
    (0, psdReader_1.skipBytes)(reader, leftBytes());
}, (writer, target) => {
    const text = target.text;
    const warp = text.warp || {};
    const transform = text.transform || [1, 0, 0, 1, 0, 0];
    const textDescriptor = Object.assign(Object.assign(Object.assign({ 'Txt ': (text.text || '').replace(/\r?\n/g, '\r'), textGridding: descriptor_1.textGridding.encode(text.gridding), Ornt: descriptor_1.Ornt.encode(text.orientation), AntA: descriptor_1.Annt.encode(text.antiAlias) }, (text.bounds ? { bounds: (0, descriptor_1.boundsToDescBounds)(text.bounds) } : {})), (text.boundingBox ? { boundingBox: (0, descriptor_1.boundsToDescBounds)(text.boundingBox) } : {})), { TextIndex: text.index || 0, EngineData: (0, engineData_1.serializeEngineData)((0, text_1.encodeEngineData)(text)) });
    (0, psdWriter_1.writeInt16)(writer, 1); // version
    for (let i = 0; i < 6; i++) {
        (0, psdWriter_1.writeFloat64)(writer, transform[i]);
    }
    (0, psdWriter_1.writeInt16)(writer, 50); // text version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'TxLr', textDescriptor, 'text');
    (0, psdWriter_1.writeInt16)(writer, 1); // warp version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'warp', encodeWarp(warp));
    (0, psdWriter_1.writeFloat32)(writer, text.left);
    (0, psdWriter_1.writeFloat32)(writer, text.top);
    (0, psdWriter_1.writeFloat32)(writer, text.right);
    (0, psdWriter_1.writeFloat32)(writer, text.bottom);
    // writeZeros(writer, 2);
});
// vector fills
addHandler('SoCo', target => target.vectorFill !== undefined && target.vectorStroke === undefined &&
    target.vectorFill.type === 'color', (reader, target) => {
    const descriptor = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.vectorFill = (0, descriptor_1.parseVectorContent)(descriptor);
}, (writer, target) => {
    const { descriptor } = (0, descriptor_1.serializeVectorContent)(target.vectorFill);
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', descriptor);
});
addHandler('GdFl', target => target.vectorFill !== undefined && target.vectorStroke === undefined &&
    (target.vectorFill.type === 'solid' || target.vectorFill.type === 'noise'), (reader, target, left) => {
    const descriptor = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.vectorFill = (0, descriptor_1.parseVectorContent)(descriptor);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const { descriptor } = (0, descriptor_1.serializeVectorContent)(target.vectorFill);
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', descriptor);
});
addHandler('PtFl', target => target.vectorFill !== undefined && target.vectorStroke === undefined &&
    target.vectorFill.type === 'pattern', (reader, target) => {
    const descriptor = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.vectorFill = (0, descriptor_1.parseVectorContent)(descriptor);
}, (writer, target) => {
    const { descriptor } = (0, descriptor_1.serializeVectorContent)(target.vectorFill);
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', descriptor);
});
addHandler('vscg', target => target.vectorFill !== undefined && target.vectorStroke !== undefined, (reader, target, left) => {
    (0, psdReader_1.readSignature)(reader); // key
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.vectorFill = (0, descriptor_1.parseVectorContent)(desc);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const { descriptor, key } = (0, descriptor_1.serializeVectorContent)(target.vectorFill);
    (0, psdWriter_1.writeSignature)(writer, key);
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', descriptor);
});
function readBezierKnot(reader, width, height) {
    const y0 = (0, psdReader_1.readFixedPointPath32)(reader) * height;
    const x0 = (0, psdReader_1.readFixedPointPath32)(reader) * width;
    const y1 = (0, psdReader_1.readFixedPointPath32)(reader) * height;
    const x1 = (0, psdReader_1.readFixedPointPath32)(reader) * width;
    const y2 = (0, psdReader_1.readFixedPointPath32)(reader) * height;
    const x2 = (0, psdReader_1.readFixedPointPath32)(reader) * width;
    return [x0, y0, x1, y1, x2, y2];
}
function writeBezierKnot(writer, points, width, height) {
    (0, psdWriter_1.writeFixedPointPath32)(writer, points[1] / height); // y0
    (0, psdWriter_1.writeFixedPointPath32)(writer, points[0] / width); // x0
    (0, psdWriter_1.writeFixedPointPath32)(writer, points[3] / height); // y1
    (0, psdWriter_1.writeFixedPointPath32)(writer, points[2] / width); // x1
    (0, psdWriter_1.writeFixedPointPath32)(writer, points[5] / height); // y2
    (0, psdWriter_1.writeFixedPointPath32)(writer, points[4] / width); // x2
}
exports.booleanOperations = ['exclude', 'combine', 'subtract', 'intersect'];
function readVectorMask(reader, vectorMask, width, height, size) {
    const end = reader.offset + size;
    const paths = vectorMask.paths;
    let path = undefined;
    while ((end - reader.offset) >= 26) {
        const selector = (0, psdReader_1.readUint16)(reader);
        switch (selector) {
            case 0: // Closed subpath length record
            case 3: { // Open subpath length record
                (0, psdReader_1.readUint16)(reader); // count
                const boolOp = (0, psdReader_1.readInt16)(reader);
                const flags = (0, psdReader_1.readUint16)(reader); // bit 1 always 1 ?
                (0, psdReader_1.skipBytes)(reader, 18);
                path = {
                    open: selector === 3,
                    knots: [],
                    fillRule: flags === 2 ? 'non-zero' : 'even-odd',
                };
                if (boolOp !== -1)
                    path.operation = exports.booleanOperations[boolOp];
                paths.push(path);
                break;
            }
            case 1: // Closed subpath Bezier knot, linked
            case 2: // Closed subpath Bezier knot, unlinked
            case 4: // Open subpath Bezier knot, linked
            case 5: // Open subpath Bezier knot, unlinked
                path.knots.push({ linked: (selector === 1 || selector === 4), points: readBezierKnot(reader, width, height) });
                break;
            case 6: // Path fill rule record
                (0, psdReader_1.skipBytes)(reader, 24);
                break;
            case 7: { // Clipboard record
                // TODO: check if these need to be multiplied by document size
                const top = (0, psdReader_1.readFixedPointPath32)(reader);
                const left = (0, psdReader_1.readFixedPointPath32)(reader);
                const bottom = (0, psdReader_1.readFixedPointPath32)(reader);
                const right = (0, psdReader_1.readFixedPointPath32)(reader);
                const resolution = (0, psdReader_1.readFixedPointPath32)(reader);
                (0, psdReader_1.skipBytes)(reader, 4);
                vectorMask.clipboard = { top, left, bottom, right, resolution };
                break;
            }
            case 8: // Initial fill rule record
                vectorMask.fillStartsWithAllPixels = !!(0, psdReader_1.readUint16)(reader);
                (0, psdReader_1.skipBytes)(reader, 22);
                break;
            default: throw new Error('Invalid vmsk section');
        }
    }
    return paths;
}
addHandler('vmsk', hasKey('vectorMask'), (reader, target, left, { width, height }) => {
    if ((0, psdReader_1.readUint32)(reader) !== 3)
        throw new Error('Invalid vmsk version');
    target.vectorMask = { paths: [] };
    const vectorMask = target.vectorMask;
    const flags = (0, psdReader_1.readUint32)(reader);
    vectorMask.invert = (flags & 1) !== 0;
    vectorMask.notLink = (flags & 2) !== 0;
    vectorMask.disable = (flags & 4) !== 0;
    readVectorMask(reader, vectorMask, width, height, left());
    // drawBezierPaths(vectorMask.paths, width, height, 'out.png');
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target, { width, height }) => {
    const vectorMask = target.vectorMask;
    const flags = (vectorMask.invert ? 1 : 0) |
        (vectorMask.notLink ? 2 : 0) |
        (vectorMask.disable ? 4 : 0);
    (0, psdWriter_1.writeUint32)(writer, 3); // version
    (0, psdWriter_1.writeUint32)(writer, flags);
    // initial entry
    (0, psdWriter_1.writeUint16)(writer, 6);
    (0, psdWriter_1.writeZeros)(writer, 24);
    const clipboard = vectorMask.clipboard;
    if (clipboard) {
        (0, psdWriter_1.writeUint16)(writer, 7);
        (0, psdWriter_1.writeFixedPointPath32)(writer, clipboard.top);
        (0, psdWriter_1.writeFixedPointPath32)(writer, clipboard.left);
        (0, psdWriter_1.writeFixedPointPath32)(writer, clipboard.bottom);
        (0, psdWriter_1.writeFixedPointPath32)(writer, clipboard.right);
        (0, psdWriter_1.writeFixedPointPath32)(writer, clipboard.resolution);
        (0, psdWriter_1.writeZeros)(writer, 4);
    }
    (0, psdWriter_1.writeUint16)(writer, 8);
    (0, psdWriter_1.writeUint16)(writer, vectorMask.fillStartsWithAllPixels ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 22);
    for (const path of vectorMask.paths) {
        (0, psdWriter_1.writeUint16)(writer, path.open ? 3 : 0);
        (0, psdWriter_1.writeUint16)(writer, path.knots.length);
        (0, psdWriter_1.writeUint16)(writer, path.operation ? exports.booleanOperations.indexOf(path.operation) : -1); // -1 for undefined
        (0, psdWriter_1.writeUint16)(writer, path.fillRule === 'non-zero' ? 2 : 1);
        (0, psdWriter_1.writeZeros)(writer, 18); // TODO: these are sometimes non-zero
        const linkedKnot = path.open ? 4 : 1;
        const unlinkedKnot = path.open ? 5 : 2;
        for (const { linked, points } of path.knots) {
            (0, psdWriter_1.writeUint16)(writer, linked ? linkedKnot : unlinkedKnot);
            writeBezierKnot(writer, points, width, height);
        }
    }
});
// TODO: need to write vmsk if has outline ?
addHandlerAlias('vsms', 'vmsk');
// addHandlerAlias('vmsk', 'vsms');
addHandler('vowv', // something with vectors?
hasKey('vowv'), (reader, target) => {
    target.vowv = (0, psdReader_1.readUint32)(reader); // always 2 ????
}, (writer, target) => {
    (0, psdWriter_1.writeUint32)(writer, target.vowv);
});
addHandler('vogk', hasKey('vectorOrigination'), (reader, target, left) => {
    if ((0, psdReader_1.readInt32)(reader) !== 1)
        throw new Error(`Invalid vogk version`);
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log(require('util').inspect(desc, false, 99, true));
    target.vectorOrigination = { keyDescriptorList: [] };
    for (const i of desc.keyDescriptorList) {
        const item = {};
        if (i.keyShapeInvalidated != null)
            item.keyShapeInvalidated = i.keyShapeInvalidated;
        if (i.keyOriginType != null)
            item.keyOriginType = i.keyOriginType;
        if (i.keyOriginResolution != null)
            item.keyOriginResolution = i.keyOriginResolution;
        if (i.keyOriginShapeBBox) {
            item.keyOriginShapeBoundingBox = {
                top: (0, descriptor_1.parseUnitsOrNumber)(i.keyOriginShapeBBox['Top ']),
                left: (0, descriptor_1.parseUnitsOrNumber)(i.keyOriginShapeBBox.Left),
                bottom: (0, descriptor_1.parseUnitsOrNumber)(i.keyOriginShapeBBox.Btom),
                right: (0, descriptor_1.parseUnitsOrNumber)(i.keyOriginShapeBBox.Rght),
            };
        }
        const rectRadii = i.keyOriginRRectRadii;
        if (rectRadii) {
            item.keyOriginRRectRadii = {
                topRight: (0, descriptor_1.parseUnits)(rectRadii.topRight),
                topLeft: (0, descriptor_1.parseUnits)(rectRadii.topLeft),
                bottomLeft: (0, descriptor_1.parseUnits)(rectRadii.bottomLeft),
                bottomRight: (0, descriptor_1.parseUnits)(rectRadii.bottomRight),
            };
        }
        const corners = i.keyOriginBoxCorners;
        if (corners) {
            item.keyOriginBoxCorners = [
                { x: corners.rectangleCornerA.Hrzn, y: corners.rectangleCornerA.Vrtc },
                { x: corners.rectangleCornerB.Hrzn, y: corners.rectangleCornerB.Vrtc },
                { x: corners.rectangleCornerC.Hrzn, y: corners.rectangleCornerC.Vrtc },
                { x: corners.rectangleCornerD.Hrzn, y: corners.rectangleCornerD.Vrtc },
            ];
        }
        const trnf = i.Trnf;
        if (trnf) {
            item.transform = [trnf.xx, trnf.xy, trnf.yx, trnf.yy, trnf.tx, trnf.ty];
        }
        target.vectorOrigination.keyDescriptorList.push(item);
    }
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    target;
    const orig = target.vectorOrigination;
    const desc = { keyDescriptorList: [] };
    for (let i = 0; i < orig.keyDescriptorList.length; i++) {
        const item = orig.keyDescriptorList[i];
        desc.keyDescriptorList.push({}); // we're adding keyOriginIndex at the end
        const out = desc.keyDescriptorList[desc.keyDescriptorList.length - 1];
        if (item.keyOriginType != null)
            out.keyOriginType = item.keyOriginType;
        if (item.keyOriginResolution != null)
            out.keyOriginResolution = item.keyOriginResolution;
        const radii = item.keyOriginRRectRadii;
        if (radii) {
            out.keyOriginRRectRadii = {
                unitValueQuadVersion: 1,
                topRight: (0, descriptor_1.unitsValue)(radii.topRight, 'topRight'),
                topLeft: (0, descriptor_1.unitsValue)(radii.topLeft, 'topLeft'),
                bottomLeft: (0, descriptor_1.unitsValue)(radii.bottomLeft, 'bottomLeft'),
                bottomRight: (0, descriptor_1.unitsValue)(radii.bottomRight, 'bottomRight'),
            };
        }
        const box = item.keyOriginShapeBoundingBox;
        if (box) {
            out.keyOriginShapeBBox = {
                unitValueQuadVersion: 1,
                'Top ': (0, descriptor_1.unitsValue)(box.top, 'top'),
                Left: (0, descriptor_1.unitsValue)(box.left, 'left'),
                Btom: (0, descriptor_1.unitsValue)(box.bottom, 'bottom'),
                Rght: (0, descriptor_1.unitsValue)(box.right, 'right'),
            };
        }
        const corners = item.keyOriginBoxCorners;
        if (corners && corners.length === 4) {
            out.keyOriginBoxCorners = {
                rectangleCornerA: { Hrzn: corners[0].x, Vrtc: corners[0].y },
                rectangleCornerB: { Hrzn: corners[1].x, Vrtc: corners[1].y },
                rectangleCornerC: { Hrzn: corners[2].x, Vrtc: corners[2].y },
                rectangleCornerD: { Hrzn: corners[3].x, Vrtc: corners[3].y },
            };
        }
        const transform = item.transform;
        if (transform && transform.length === 6) {
            out.Trnf = {
                xx: transform[0],
                xy: transform[1],
                yx: transform[2],
                yy: transform[3],
                tx: transform[4],
                ty: transform[5],
            };
        }
        if (item.keyShapeInvalidated != null)
            out.keyShapeInvalidated = item.keyShapeInvalidated;
        out.keyOriginIndex = i;
    }
    (0, psdWriter_1.writeInt32)(writer, 1); // version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler('lmfx', target => target.effects !== undefined && hasMultiEffects(target.effects), (reader, target, left) => {
    const version = (0, psdReader_1.readUint32)(reader);
    if (version !== 0)
        throw new Error('Invalid lmfx version');
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log('READ', require('util').inspect(desc, false, 99, true));
    // discard if read in 'lrFX' or 'lfx2' section
    target.effects = (0, descriptor_1.parseEffects)(desc, !!reader.logMissingFeatures);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target, _, options) => {
    const desc = (0, descriptor_1.serializeEffects)(target.effects, !!options.logMissingFeatures, true);
    // console.log('WRITE', require('util').inspect(desc, false, 99, true));
    (0, psdWriter_1.writeUint32)(writer, 0); // version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler('lrFX', hasKey('effects'), (reader, target, left) => {
    if (!target.effects)
        target.effects = (0, effectsHelpers_1.readEffects)(reader);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    (0, effectsHelpers_1.writeEffects)(writer, target.effects);
});
addHandler('luni', hasKey('name'), (reader, target, left) => {
    if (left() > 4) {
        const length = (0, psdReader_1.readUint32)(reader);
        if (left() >= (length * 2)) {
            target.name = (0, psdReader_1.readUnicodeStringWithLength)(reader, length);
        }
        else {
            if (reader.logDevFeatures)
                reader.log('name in luni section is too long');
        }
    }
    else {
        if (reader.logDevFeatures)
            reader.log('empty luni section');
    }
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeUnicodeString)(writer, target.name);
    // writeUint16(writer, 0); // padding (but not extending string length)
});
addHandler('lnsr', hasKey('nameSource'), (reader, target) => target.nameSource = (0, psdReader_1.readSignature)(reader), (writer, target) => (0, psdWriter_1.writeSignature)(writer, target.nameSource));
addHandler('lyid', hasKey('id'), (reader, target) => {
    target.id = (0, psdReader_1.readUint32)(reader);
}, (writer, target, _psd, options) => {
    let id = target.id;
    while (options.layerIds.has(id))
        id += 100; // make sure we don't have duplicate layer ids
    (0, psdWriter_1.writeUint32)(writer, id);
    options.layerIds.add(id);
    options.layerToId.set(target, id);
});
addHandler('lsct', hasKey('sectionDivider'), (reader, target, left) => {
    target.sectionDivider = { type: (0, psdReader_1.readUint32)(reader) };
    if (left()) {
        (0, psdReader_1.checkSignature)(reader, '8BIM');
        target.sectionDivider.key = (0, psdReader_1.readSignature)(reader);
    }
    if (left()) {
        target.sectionDivider.subType = (0, psdReader_1.readUint32)(reader);
    }
}, (writer, target) => {
    (0, psdWriter_1.writeUint32)(writer, target.sectionDivider.type);
    if (target.sectionDivider.key) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, target.sectionDivider.key);
        if (target.sectionDivider.subType !== undefined) {
            (0, psdWriter_1.writeUint32)(writer, target.sectionDivider.subType);
        }
    }
});
// it seems lsdk is used when there's a layer is nested more than 6 levels, but I don't know why?
// maybe some limitation of old version of PS?
addHandlerAlias('lsdk', 'lsct');
addHandler('clbl', hasKey('blendClippendElements'), (reader, target) => {
    target.blendClippendElements = !!(0, psdReader_1.readUint8)(reader);
    (0, psdReader_1.skipBytes)(reader, 3);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.blendClippendElements ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 3);
});
addHandler('infx', hasKey('blendInteriorElements'), (reader, target) => {
    target.blendInteriorElements = !!(0, psdReader_1.readUint8)(reader);
    (0, psdReader_1.skipBytes)(reader, 3);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.blendInteriorElements ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 3);
});
addHandler('knko', hasKey('knockout'), (reader, target) => {
    target.knockout = !!(0, psdReader_1.readUint8)(reader);
    (0, psdReader_1.skipBytes)(reader, 3);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.knockout ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 3);
});
addHandler('lmgm', hasKey('layerMaskAsGlobalMask'), (reader, target) => {
    target.layerMaskAsGlobalMask = !!(0, psdReader_1.readUint8)(reader);
    (0, psdReader_1.skipBytes)(reader, 3);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.layerMaskAsGlobalMask ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 3);
});
addHandler('lspf', hasKey('protected'), (reader, target) => {
    const flags = (0, psdReader_1.readUint32)(reader);
    target.protected = {
        transparency: (flags & 0x01) !== 0,
        composite: (flags & 0x02) !== 0,
        position: (flags & 0x04) !== 0,
    };
    if (flags & 0x08)
        target.protected.artboards = true;
}, (writer, target) => {
    const flags = (target.protected.transparency ? 0x01 : 0) |
        (target.protected.composite ? 0x02 : 0) |
        (target.protected.position ? 0x04 : 0) |
        (target.protected.artboards ? 0x08 : 0);
    (0, psdWriter_1.writeUint32)(writer, flags);
});
addHandler('lclr', hasKey('layerColor'), (reader, target) => {
    const color = (0, psdReader_1.readUint16)(reader);
    (0, psdReader_1.skipBytes)(reader, 6);
    target.layerColor = helpers_1.layerColors[color];
}, (writer, target) => {
    const index = helpers_1.layerColors.indexOf(target.layerColor);
    (0, psdWriter_1.writeUint16)(writer, index === -1 ? 0 : index);
    (0, psdWriter_1.writeZeros)(writer, 6);
});
addHandler('shmd', // Metadata setting
// Metadata setting
target => target.timestamp !== undefined || target.animationFrames !== undefined || target.animationFrameFlags !== undefined || target.timeline !== undefined || target.comps !== undefined, (reader, target, left) => {
    const count = (0, psdReader_1.readUint32)(reader);
    for (let i = 0; i < count; i++) {
        (0, psdReader_1.checkSignature)(reader, '8BIM');
        const key = (0, psdReader_1.readSignature)(reader);
        (0, psdReader_1.readUint8)(reader); // copy
        (0, psdReader_1.skipBytes)(reader, 3);
        (0, psdReader_1.readSection)(reader, 1, left => {
            if (key === 'cust') {
                const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                // console.log('cust', target.name, require('util').inspect(desc, false, 99, true));
                if (desc.layerTime !== undefined)
                    target.timestamp = desc.layerTime;
            }
            else if (key === 'mlst') {
                const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                // console.log('mlst', target.name, require('util').inspect(desc, false, 99, true));
                target.animationFrames = [];
                for (let i = 0; i < desc.LaSt.length; i++) {
                    const f = desc.LaSt[i];
                    const frame = { frames: f.FrLs };
                    if (f.enab !== undefined)
                        frame.enable = f.enab;
                    if (f.Ofst)
                        frame.offset = (0, descriptor_1.horzVrtcToXY)(f.Ofst);
                    if (f.FXRf)
                        frame.referencePoint = (0, descriptor_1.horzVrtcToXY)(f.FXRf);
                    if (f.Lefx)
                        frame.effects = (0, descriptor_1.parseEffects)(f.Lefx, !!reader.logMissingFeatures);
                    if (f.blendOptions && f.blendOptions.Opct)
                        frame.opacity = (0, descriptor_1.parsePercent)(f.blendOptions.Opct);
                    target.animationFrames.push(frame);
                }
            }
            else if (key === 'mdyn') {
                // frame flags
                (0, psdReader_1.readUint16)(reader); // unknown
                const propagate = (0, psdReader_1.readUint8)(reader);
                const flags = (0, psdReader_1.readUint8)(reader);
                target.animationFrameFlags = {
                    propagateFrameOne: !propagate,
                    unifyLayerPosition: (flags & 1) !== 0,
                    unifyLayerStyle: (flags & 2) !== 0,
                    unifyLayerVisibility: (flags & 4) !== 0,
                };
            }
            else if (key === 'tmln') {
                const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                const timeScope = desc.timeScope;
                // console.log('tmln', target.name, target.id, require('util').inspect(desc, false, 99, true));
                const timeline = {
                    start: (0, descriptor_1.frac)(timeScope.Strt),
                    duration: (0, descriptor_1.frac)(timeScope.duration),
                    inTime: (0, descriptor_1.frac)(timeScope.inTime),
                    outTime: (0, descriptor_1.frac)(timeScope.outTime),
                    autoScope: desc.autoScope,
                    audioLevel: desc.audioLevel,
                };
                if (desc.trackList) {
                    timeline.tracks = (0, descriptor_1.parseTrackList)(desc.trackList, !!reader.logMissingFeatures);
                }
                target.timeline = timeline;
                // console.log('tmln:result', target.name, target.id, require('util').inspect(timeline, false, 99, true));
            }
            else if (key === 'cmls') {
                const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                // console.log('cmls', require('util').inspect(desc, false, 99, true));
                target.comps = {
                    settings: [],
                };
                if (desc.origFXRefPoint)
                    target.comps.originalEffectsReferencePoint = { x: desc.origFXRefPoint.Hrzn, y: desc.origFXRefPoint.Vrtc };
                for (const item of desc.layerSettings) {
                    target.comps.settings.push({ compList: item.compList });
                    const t = target.comps.settings[target.comps.settings.length - 1];
                    if ('enab' in item)
                        t.enabled = item.enab;
                    if (item.Ofst)
                        t.offset = { x: item.Ofst.Hrzn, y: item.Ofst.Vrtc };
                    if (item.FXRefPoint)
                        t.effectsReferencePoint = { x: item.FXRefPoint.Hrzn, y: item.FXRefPoint.Vrtc };
                }
            }
            else if (key === 'extn') {
                const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                // console.log(require('util').inspect(desc, false, 99, true));
                desc; // TODO: save this
                reader.logMissingFeatures && reader.log('Unhandled "shmd" section key', key);
            }
            else {
                reader.logMissingFeatures && reader.log('Unhandled "shmd" section key', key);
            }
            (0, psdReader_1.skipBytes)(reader, left());
        });
    }
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target, _, options) => {
    const { animationFrames, animationFrameFlags, timestamp, timeline, comps } = target;
    let count = 0;
    if (animationFrames)
        count++;
    if (animationFrameFlags)
        count++;
    if (timeline)
        count++;
    if (timestamp !== undefined)
        count++;
    if (comps)
        count++;
    (0, psdWriter_1.writeUint32)(writer, count);
    if (animationFrames) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'mlst');
        (0, psdWriter_1.writeUint8)(writer, 0); // copy (always false)
        (0, psdWriter_1.writeZeros)(writer, 3);
        (0, psdWriter_1.writeSection)(writer, 2, () => {
            var _a;
            const desc = {
                LaID: (_a = target.id) !== null && _a !== void 0 ? _a : 0,
                LaSt: [],
            };
            for (let i = 0; i < animationFrames.length; i++) {
                const f = animationFrames[i];
                const frame = {};
                if (f.enable !== undefined)
                    frame.enab = f.enable;
                frame.FrLs = f.frames;
                if (f.offset)
                    frame.Ofst = (0, descriptor_1.xyToHorzVrtc)(f.offset);
                if (f.referencePoint)
                    frame.FXRf = (0, descriptor_1.xyToHorzVrtc)(f.referencePoint);
                if (f.effects)
                    frame.Lefx = (0, descriptor_1.serializeEffects)(f.effects, false, false);
                if (f.opacity !== undefined)
                    frame.blendOptions = { Opct: (0, descriptor_1.unitsPercent)(f.opacity) };
                desc.LaSt.push(frame);
            }
            (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
        }, true);
    }
    if (animationFrameFlags) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'mdyn');
        (0, psdWriter_1.writeUint8)(writer, 0); // copy (always false)
        (0, psdWriter_1.writeZeros)(writer, 3);
        (0, psdWriter_1.writeSection)(writer, 2, () => {
            (0, psdWriter_1.writeUint16)(writer, 0); // unknown
            (0, psdWriter_1.writeUint8)(writer, animationFrameFlags.propagateFrameOne ? 0x0 : 0xf);
            (0, psdWriter_1.writeUint8)(writer, (animationFrameFlags.unifyLayerPosition ? 1 : 0) |
                (animationFrameFlags.unifyLayerStyle ? 2 : 0) |
                (animationFrameFlags.unifyLayerVisibility ? 4 : 0));
        });
    }
    if (timeline) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'tmln');
        (0, psdWriter_1.writeUint8)(writer, 0); // copy (always false)
        (0, psdWriter_1.writeZeros)(writer, 3);
        (0, psdWriter_1.writeSection)(writer, 2, () => {
            const desc = {
                Vrsn: 1,
                timeScope: {
                    Vrsn: 1,
                    Strt: timeline.start,
                    duration: timeline.duration,
                    inTime: timeline.inTime,
                    outTime: timeline.outTime,
                },
                autoScope: timeline.autoScope,
                audioLevel: timeline.audioLevel,
            };
            if (timeline.tracks) {
                desc.trackList = (0, descriptor_1.serializeTrackList)(timeline.tracks);
            }
            const id = options.layerToId.get(target) || target.id;
            if (!id)
                throw new Error('You need to provide layer.id value whan writing document with animations');
            desc.LyrI = id;
            // console.log('WRITE:tmln', target.name, target.id, require('util').inspect(desc, false, 99, true));
            (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc, 'anim');
        }, true);
    }
    if (timestamp !== undefined) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'cust');
        (0, psdWriter_1.writeUint8)(writer, 0); // copy (always false)
        (0, psdWriter_1.writeZeros)(writer, 3);
        (0, psdWriter_1.writeSection)(writer, 2, () => {
            const desc = {
                layerTime: timestamp,
            };
            (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'metadata', desc);
        }, true);
    }
    if (comps) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'cmls');
        (0, psdWriter_1.writeUint8)(writer, 0); // copy (always false)
        (0, psdWriter_1.writeZeros)(writer, 3);
        (0, psdWriter_1.writeSection)(writer, 2, () => {
            const id = options.layerToId.get(target) || target.id;
            if (!id)
                throw new Error('You need to provide layer.id value whan writing document with layer comps');
            const desc = {};
            if (comps.originalEffectsReferencePoint) {
                desc.origFXRefPoint = { Hrzn: comps.originalEffectsReferencePoint.x, Vrtc: comps.originalEffectsReferencePoint.y };
            }
            desc.LyrI = id;
            desc.layerSettings = [];
            for (const item of comps.settings) {
                const t = {};
                if (item.enabled !== undefined)
                    t.enab = item.enabled;
                if (item.offset)
                    t.Ofst = { Hrzn: item.offset.x, Vrtc: item.offset.y };
                if (item.effectsReferencePoint)
                    t.FXRefPoint = { Hrzn: item.effectsReferencePoint.x, Vrtc: item.effectsReferencePoint.y };
                t.compList = item.compList;
                desc.layerSettings.push(t);
            }
            // console.log('cmls', require('util').inspect(desc, false, 99, true));
            (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
        }, true);
    }
});
addHandler('PxSc', () => false, (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader, true);
    // console.log('PxSc', require('util').inspect(desc, false, 99, true));
    if (desc.pixelSourceType === 1986285651) {
        target.pixelSource = {
            type: 'vdPS',
            origin: { x: desc.origin.Hrzn, y: desc.origin.Vrtc },
            interpretation: {
                interpretAlpha: desc.interpretation.interpretAlpha.split('.')[1],
                profile: desc.interpretation.profile,
            },
            frameReader: {
                type: 'QTFR',
                link: {
                    name: desc.frameReader['Lnk ']['Nm  '],
                    fullPath: desc.frameReader['Lnk '].fullPath,
                    originalPath: desc.frameReader['Lnk '].originalPath,
                    relativePath: desc.frameReader['Lnk '].relPath,
                    alias: desc.frameReader['Lnk '].alis,
                },
                mediaDescriptor: desc.frameReader.mediaDescriptor,
            },
            showAlteredVideo: desc.showAlteredVideo,
        };
    }
    else {
        reader.log(`Unknown pixelSourceType`);
    }
}, (writer, target) => {
    const source = target.pixelSource;
    const desc = {
        _name: '',
        _classID: 'PixelSource',
        pixelSourceType: 1986285651, // vdP
        descVersion: 1,
        origin: { Hrzn: source.origin.x, Vrtc: source.origin.y },
        interpretation: {
            _name: '',
            _classID: 'footageInterpretation',
            Vrsn: 1,
            interpretAlpha: `alphaInterpretation.${source.interpretation.interpretAlpha}`,
            profile: source.interpretation.profile,
        },
        frameReader: {
            _name: '',
            _classID: 'FrameReader',
            frameReaderType: 1364477522, // QTF
            descVersion: 1,
            'Lnk ': {
                _name: '',
                _classID: 'ExternalFileLink',
                descVersion: 2,
                'Nm  ': source.frameReader.link.name,
                fullPath: source.frameReader.link.fullPath,
                originalPath: source.frameReader.link.originalPath,
                alis: source.frameReader.link.alias,
                relPath: source.frameReader.link.relativePath,
            },
            mediaDescriptor: source.frameReader.mediaDescriptor,
        },
        showAlteredVideo: source.showAlteredVideo,
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'PixelSource', desc);
});
addHandler('vstk', hasKey('vectorStroke'), (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log(require('util').inspect(desc, false, 99, true));
    target.vectorStroke = {
        strokeEnabled: desc.strokeEnabled,
        fillEnabled: desc.fillEnabled,
        lineWidth: (0, descriptor_1.parseUnits)(desc.strokeStyleLineWidth),
        lineDashOffset: (0, descriptor_1.parseUnits)(desc.strokeStyleLineDashOffset),
        miterLimit: desc.strokeStyleMiterLimit,
        lineCapType: descriptor_1.strokeStyleLineCapType.decode(desc.strokeStyleLineCapType),
        lineJoinType: descriptor_1.strokeStyleLineJoinType.decode(desc.strokeStyleLineJoinType),
        lineAlignment: descriptor_1.strokeStyleLineAlignment.decode(desc.strokeStyleLineAlignment),
        scaleLock: desc.strokeStyleScaleLock,
        strokeAdjust: desc.strokeStyleStrokeAdjust,
        lineDashSet: desc.strokeStyleLineDashSet.map(descriptor_1.parseUnits),
        blendMode: descriptor_1.BlnM.decode(desc.strokeStyleBlendMode),
        opacity: (0, descriptor_1.parsePercent)(desc.strokeStyleOpacity),
        content: (0, descriptor_1.parseVectorContent)(desc.strokeStyleContent),
        resolution: desc.strokeStyleResolution,
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a, _b, _c;
    const stroke = target.vectorStroke;
    const desc = {
        strokeStyleVersion: 2,
        strokeEnabled: !!stroke.strokeEnabled,
        fillEnabled: !!stroke.fillEnabled,
        strokeStyleLineWidth: stroke.lineWidth || { value: 3, units: 'Points' },
        strokeStyleLineDashOffset: stroke.lineDashOffset || { value: 0, units: 'Points' },
        strokeStyleMiterLimit: (_a = stroke.miterLimit) !== null && _a !== void 0 ? _a : 100,
        strokeStyleLineCapType: descriptor_1.strokeStyleLineCapType.encode(stroke.lineCapType),
        strokeStyleLineJoinType: descriptor_1.strokeStyleLineJoinType.encode(stroke.lineJoinType),
        strokeStyleLineAlignment: descriptor_1.strokeStyleLineAlignment.encode(stroke.lineAlignment),
        strokeStyleScaleLock: !!stroke.scaleLock,
        strokeStyleStrokeAdjust: !!stroke.strokeAdjust,
        strokeStyleLineDashSet: stroke.lineDashSet || [],
        strokeStyleBlendMode: descriptor_1.BlnM.encode(stroke.blendMode),
        strokeStyleOpacity: (0, descriptor_1.unitsPercent)((_b = stroke.opacity) !== null && _b !== void 0 ? _b : 1),
        strokeStyleContent: (0, descriptor_1.serializeVectorContent)(stroke.content || { type: 'color', color: { r: 0, g: 0, b: 0 } }).descriptor,
        strokeStyleResolution: (_c = stroke.resolution) !== null && _c !== void 0 ? _c : 72,
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'strokeStyle', desc);
});
addHandler('artb', // per-layer arboard info
hasKey('artboard'), (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    const rect = desc.artboardRect;
    target.artboard = {
        rect: { top: rect['Top '], left: rect.Left, bottom: rect.Btom, right: rect.Rght },
        guideIndices: desc.guideIndeces,
        presetName: desc.artboardPresetName,
        color: (0, descriptor_1.parseColor)(desc['Clr ']),
        backgroundType: desc.artboardBackgroundType,
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a;
    const artboard = target.artboard;
    const rect = artboard.rect;
    const desc = {
        artboardRect: { 'Top ': rect.top, Left: rect.left, Btom: rect.bottom, Rght: rect.right },
        guideIndeces: artboard.guideIndices || [],
        artboardPresetName: artboard.presetName || '',
        'Clr ': (0, descriptor_1.serializeColor)(artboard.color),
        artboardBackgroundType: (_a = artboard.backgroundType) !== null && _a !== void 0 ? _a : 1,
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'artboard', desc);
});
addHandler('sn2P', hasKey('usingAlignedRendering'), (reader, target) => target.usingAlignedRendering = !!(0, psdReader_1.readUint32)(reader), (writer, target) => (0, psdWriter_1.writeUint32)(writer, target.usingAlignedRendering ? 1 : 0));
const placedLayerTypes = ['unknown', 'vector', 'raster', 'image stack'];
function parseWarp(warp) {
    var _a, _b, _c, _d, _e, _f;
    const result = Object.assign(Object.assign({ style: descriptor_1.warpStyle.decode(warp.warpStyle) }, (warp.warpValues ? { values: warp.warpValues } : { value: warp.warpValue || 0 })), { perspective: warp.warpPerspective || 0, perspectiveOther: warp.warpPerspectiveOther || 0, rotate: descriptor_1.Ornt.decode(warp.warpRotate), bounds: warp.bounds && {
            top: (0, descriptor_1.parseUnitsOrNumber)(warp.bounds['Top ']),
            left: (0, descriptor_1.parseUnitsOrNumber)(warp.bounds.Left),
            bottom: (0, descriptor_1.parseUnitsOrNumber)(warp.bounds.Btom),
            right: (0, descriptor_1.parseUnitsOrNumber)(warp.bounds.Rght),
        }, uOrder: warp.uOrder, vOrder: warp.vOrder });
    if (warp.deformNumRows != null || warp.deformNumCols != null) {
        result.deformNumRows = warp.deformNumRows;
        result.deformNumCols = warp.deformNumCols;
    }
    const envelopeWarp = warp.customEnvelopeWarp;
    if (envelopeWarp) {
        result.customEnvelopeWarp = {
            meshPoints: [],
        };
        const xs = ((_a = envelopeWarp.meshPoints.find(i => i.type === 'Hrzn')) === null || _a === void 0 ? void 0 : _a.values) || [];
        const ys = ((_b = envelopeWarp.meshPoints.find(i => i.type === 'Vrtc')) === null || _b === void 0 ? void 0 : _b.values) || [];
        for (let i = 0; i < xs.length; i++) {
            result.customEnvelopeWarp.meshPoints.push({ x: xs[i], y: ys[i] });
        }
        if (envelopeWarp.quiltSliceX || envelopeWarp.quiltSliceY) {
            result.customEnvelopeWarp.quiltSliceX = ((_d = (_c = envelopeWarp.quiltSliceX) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.values) || [];
            result.customEnvelopeWarp.quiltSliceY = ((_f = (_e = envelopeWarp.quiltSliceY) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.values) || [];
        }
    }
    return result;
}
function isQuiltWarp(warp) {
    var _a, _b;
    return warp.deformNumCols != null || warp.deformNumRows != null ||
        ((_a = warp.customEnvelopeWarp) === null || _a === void 0 ? void 0 : _a.quiltSliceX) || ((_b = warp.customEnvelopeWarp) === null || _b === void 0 ? void 0 : _b.quiltSliceY);
}
function encodeWarp(warp) {
    const bounds = warp.bounds;
    const desc = Object.assign(Object.assign({ warpStyle: descriptor_1.warpStyle.encode(warp.style) }, (warp.values ? { warpValues: warp.values } : { warpValue: warp.value || 0 })), { warpPerspective: warp.perspective || 0, warpPerspectiveOther: warp.perspectiveOther || 0, warpRotate: descriptor_1.Ornt.encode(warp.rotate), bounds: /*1 ? { // testing
            _classID: 'classFloatRect',
            'Top ': bounds && bounds.top && bounds.top.value || 0,
            Left: bounds && bounds.left && bounds.left.value || 0,
            Btom: bounds && bounds.bottom && bounds.bottom.value || 0,
            Rght: bounds && bounds.right && bounds.right.value || 0,
        } :*/ {
            'Top ': (0, descriptor_1.unitsValue)(bounds && bounds.top || { units: 'Pixels', value: 0 }, 'bounds.top'),
            Left: (0, descriptor_1.unitsValue)(bounds && bounds.left || { units: 'Pixels', value: 0 }, 'bounds.left'),
            Btom: (0, descriptor_1.unitsValue)(bounds && bounds.bottom || { units: 'Pixels', value: 0 }, 'bounds.bottom'),
            Rght: (0, descriptor_1.unitsValue)(bounds && bounds.right || { units: 'Pixels', value: 0 }, 'bounds.right'),
        }, uOrder: warp.uOrder || 0, vOrder: warp.vOrder || 0 });
    const isQuilt = isQuiltWarp(warp);
    if (isQuilt) {
        const desc2 = desc;
        desc2.deformNumRows = warp.deformNumRows || 0;
        desc2.deformNumCols = warp.deformNumCols || 0;
    }
    const customEnvelopeWarp = warp.customEnvelopeWarp;
    if (customEnvelopeWarp) {
        const meshPoints = customEnvelopeWarp.meshPoints || [];
        if (isQuilt) {
            const desc2 = desc;
            desc2.customEnvelopeWarp = {
                _name: '',
                _classID: 'customEnvelopeWarp',
                quiltSliceX: [{
                        type: 'quiltSliceX',
                        values: customEnvelopeWarp.quiltSliceX || [],
                    }],
                quiltSliceY: [{
                        type: 'quiltSliceY',
                        values: customEnvelopeWarp.quiltSliceY || [],
                    }],
                meshPoints: [
                    { type: 'Hrzn', values: meshPoints.map(p => p.x) },
                    { type: 'Vrtc', values: meshPoints.map(p => p.y) },
                ],
            };
        }
        else {
            desc.customEnvelopeWarp = {
                _name: '',
                _classID: 'customEnvelopeWarp',
                meshPoints: [
                    { type: 'Hrzn', values: meshPoints.map(p => p.x) },
                    { type: 'Vrtc', values: meshPoints.map(p => p.y) },
                ],
            };
        }
    }
    return desc;
}
addHandler('PlLd', hasKey('placedLayer'), (reader, target, left) => {
    if ((0, psdReader_1.readSignature)(reader) !== 'plcL')
        throw new Error(`Invalid PlLd signature`);
    if ((0, psdReader_1.readInt32)(reader) !== 3)
        throw new Error(`Invalid PlLd version`);
    const id = (0, psdReader_1.readPascalString)(reader, 1);
    const pageNumber = (0, psdReader_1.readInt32)(reader);
    const totalPages = (0, psdReader_1.readInt32)(reader); // TODO: check how this works ?
    (0, psdReader_1.readInt32)(reader); // anitAliasPolicy 16
    const placedLayerType = (0, psdReader_1.readInt32)(reader); // 0 = unknown, 1 = vector, 2 = raster, 3 = image stack
    if (!placedLayerTypes[placedLayerType])
        throw new Error('Invalid PlLd type');
    const transform = [];
    for (let i = 0; i < 8; i++)
        transform.push((0, psdReader_1.readFloat64)(reader)); // x, y of 4 corners of the transform
    const warpVersion = (0, psdReader_1.readInt32)(reader);
    if (warpVersion !== 0)
        throw new Error(`Invalid Warp version ${warpVersion}`);
    const warp = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.placedLayer = target.placedLayer || {
        id,
        type: placedLayerTypes[placedLayerType],
        pageNumber,
        totalPages,
        transform,
        warp: parseWarp(warp),
    };
    // console.log('PlLd warp', require('util').inspect(warp, false, 99, true));
    // console.log('PlLd', require('util').inspect(target.placedLayer, false, 99, true));
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const placed = target.placedLayer;
    (0, psdWriter_1.writeSignature)(writer, 'plcL');
    (0, psdWriter_1.writeInt32)(writer, 3); // version
    if (!placed.id || typeof placed.id !== 'string' || !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(placed.id)) {
        throw new Error('Placed layer ID must be in a GUID format (example: 20953ddb-9391-11ec-b4f1-c15674f50bc4)');
    }
    (0, psdWriter_1.writePascalString)(writer, placed.id, 1);
    (0, psdWriter_1.writeInt32)(writer, placed.pageNumber || 1);
    (0, psdWriter_1.writeInt32)(writer, placed.totalPages || 1);
    (0, psdWriter_1.writeInt32)(writer, 16); // anitAliasPolicy
    if (placedLayerTypes.indexOf(placed.type) === -1)
        throw new Error('Invalid placedLayer type');
    (0, psdWriter_1.writeInt32)(writer, placedLayerTypes.indexOf(placed.type));
    for (let i = 0; i < 8; i++)
        (0, psdWriter_1.writeFloat64)(writer, placed.transform[i]);
    (0, psdWriter_1.writeInt32)(writer, 0); // warp version
    const warp = getWarpFromPlacedLayer(placed);
    const isQuilt = isQuiltWarp(warp);
    const type = isQuilt ? 'quiltWarp' : 'warp';
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', type, encodeWarp(warp), type);
});
function uint8ToFloat32(array) {
    return new Float32Array(array.buffer.slice(array.byteOffset), 0, array.byteLength / 4);
}
function uint8ToUint32(array) {
    return new Uint32Array(array.buffer.slice(array.byteOffset), 0, array.byteLength / 4);
}
function toUint8(array) {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}
function arrayToPoints(array) {
    const points = [];
    for (let i = 0; i < array.length; i += 2) {
        points.push({ x: array[i], y: array[i + 1] });
    }
    return points;
}
function pointsToArray(points) {
    const array = [];
    for (let i = 0; i < points.length; i++) {
        array.push(points[i].x, points[i].y);
    }
    return array;
}
function uint8ToPoints(array) {
    return arrayToPoints(uint8ToFloat32(array));
}
function hrznVrtcToPoint(desc) {
    return {
        x: (0, descriptor_1.parseUnits)(desc.Hrzn),
        y: (0, descriptor_1.parseUnits)(desc.Vrtc),
    };
}
function pointToHrznVrtc(point) {
    return {
        _name: '',
        _classID: 'Pnt ',
        Hrzn: (0, descriptor_1.unitsValue)(point.x, 'x'),
        Vrtc: (0, descriptor_1.unitsValue)(point.y, 'y'),
    };
}
function parseFilterFXItem(f, options) {
    const base = {
        name: f['Nm  '],
        opacity: (0, descriptor_1.parsePercent)(f.blendOptions.Opct),
        blendMode: descriptor_1.BlnM.decode(f.blendOptions['Md  ']),
        enabled: f.enab,
        hasOptions: f.hasoptions,
        foregroundColor: (0, descriptor_1.parseColor)(f.FrgC),
        backgroundColor: (0, descriptor_1.parseColor)(f.BckC),
    };
    if ('Fltr' in f) {
        switch (f.Fltr._classID) {
            case 'boxblur': return Object.assign(Object.assign({}, base), { type: 'box blur', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                } });
            case 'GsnB': return Object.assign(Object.assign({}, base), { type: 'gaussian blur', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                } });
            case 'MtnB': return Object.assign(Object.assign({}, base), { type: 'motion blur', filter: {
                    angle: f.Fltr.Angl,
                    distance: (0, descriptor_1.parseUnits)(f.Fltr.Dstn),
                } });
            case 'RdlB': return Object.assign(Object.assign({}, base), { type: 'radial blur', filter: {
                    amount: f.Fltr.Amnt,
                    method: descriptor_1.BlrM.decode(f.Fltr.BlrM),
                    quality: descriptor_1.BlrQ.decode(f.Fltr.BlrQ),
                } });
            case 'shapeBlur': return Object.assign(Object.assign({}, base), { type: 'shape blur', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                    customShape: { name: f.Fltr.customShape['Nm  '], id: f.Fltr.customShape.Idnt },
                } });
            case 'SmrB': return Object.assign(Object.assign({}, base), { type: 'smart blur', filter: {
                    radius: f.Fltr['Rds '],
                    threshold: f.Fltr.Thsh,
                    quality: descriptor_1.SmBQ.decode(f.Fltr.SmBQ),
                    mode: descriptor_1.SmBM.decode(f.Fltr.SmBM),
                } });
            case 'surfaceBlur': return Object.assign(Object.assign({}, base), { type: 'surface blur', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                    threshold: f.Fltr.Thsh,
                } });
            case 'Dspl': return Object.assign(Object.assign({}, base), { type: 'displace', filter: {
                    horizontalScale: f.Fltr.HrzS,
                    verticalScale: f.Fltr.VrtS,
                    displacementMap: descriptor_1.DspM.decode(f.Fltr.DspM),
                    undefinedAreas: descriptor_1.UndA.decode(f.Fltr.UndA),
                    displacementFile: {
                        signature: f.Fltr.DspF.sig,
                        path: f.Fltr.DspF.path, // TODO: this is decoded incorrectly ???
                    },
                } });
            case 'Pnch': return Object.assign(Object.assign({}, base), { type: 'pinch', filter: {
                    amount: f.Fltr.Amnt,
                } });
            case 'Plr ': return Object.assign(Object.assign({}, base), { type: 'polar coordinates', filter: {
                    conversion: descriptor_1.Cnvr.decode(f.Fltr.Cnvr),
                } });
            case 'Rple': return Object.assign(Object.assign({}, base), { type: 'ripple', filter: {
                    amount: f.Fltr.Amnt,
                    size: descriptor_1.RplS.decode(f.Fltr.RplS),
                } });
            case 'Shr ': return Object.assign(Object.assign({}, base), { type: 'shear', filter: {
                    shearPoints: f.Fltr.ShrP.map(p => ({ x: p.Hrzn, y: p.Vrtc })),
                    shearStart: f.Fltr.ShrS,
                    shearEnd: f.Fltr.ShrE,
                    undefinedAreas: descriptor_1.UndA.decode(f.Fltr.UndA),
                } });
            case 'Sphr': return Object.assign(Object.assign({}, base), { type: 'spherize', filter: {
                    amount: f.Fltr.Amnt,
                    mode: descriptor_1.SphM.decode(f.Fltr.SphM),
                } });
            case 'Twrl': return Object.assign(Object.assign({}, base), { type: 'twirl', filter: {
                    angle: f.Fltr.Angl,
                } });
            case 'Wave': return Object.assign(Object.assign({}, base), { type: 'wave', filter: {
                    numberOfGenerators: f.Fltr.NmbG,
                    type: descriptor_1.Wvtp.decode(f.Fltr.Wvtp),
                    wavelength: { min: f.Fltr.WLMn, max: f.Fltr.WLMx },
                    amplitude: { min: f.Fltr.AmMn, max: f.Fltr.AmMx },
                    scale: { x: f.Fltr.SclH, y: f.Fltr.SclV },
                    randomSeed: f.Fltr.RndS,
                    undefinedAreas: descriptor_1.UndA.decode(f.Fltr.UndA),
                } });
            case 'ZgZg': return Object.assign(Object.assign({}, base), { type: 'zigzag', filter: {
                    amount: f.Fltr.Amnt,
                    ridges: f.Fltr.NmbR,
                    style: descriptor_1.ZZTy.decode(f.Fltr.ZZTy),
                } });
            case 'AdNs': return Object.assign(Object.assign({}, base), { type: 'add noise', filter: {
                    amount: (0, descriptor_1.parsePercent)(f.Fltr.Nose),
                    distribution: descriptor_1.Dstr.decode(f.Fltr.Dstr),
                    monochromatic: f.Fltr.Mnch,
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'DstS': return Object.assign(Object.assign({}, base), { type: 'dust and scratches', filter: {
                    radius: f.Fltr['Rds '],
                    threshold: f.Fltr.Thsh,
                } });
            case 'Mdn ': return Object.assign(Object.assign({}, base), { type: 'median', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                } });
            case 'denoise': return Object.assign(Object.assign({}, base), { type: 'reduce noise', filter: {
                    preset: f.Fltr.preset,
                    removeJpegArtifact: f.Fltr.removeJPEGArtifact,
                    reduceColorNoise: (0, descriptor_1.parsePercent)(f.Fltr.ClNs),
                    sharpenDetails: (0, descriptor_1.parsePercent)(f.Fltr.Shrp),
                    channelDenoise: f.Fltr.channelDenoise.map(c => (Object.assign({ channels: c.Chnl.map(descriptor_1.Chnl.decode), amount: c.Amnt }, (c.EdgF ? { preserveDetails: c.EdgF } : {})))),
                } });
            case 'ClrH': return Object.assign(Object.assign({}, base), { type: 'color halftone', filter: {
                    radius: f.Fltr['Rds '],
                    angle1: f.Fltr.Ang1,
                    angle2: f.Fltr.Ang2,
                    angle3: f.Fltr.Ang3,
                    angle4: f.Fltr.Ang4,
                } });
            case 'Crst': return Object.assign(Object.assign({}, base), { type: 'crystallize', filter: {
                    cellSize: f.Fltr.ClSz,
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'Mztn': return Object.assign(Object.assign({}, base), { type: 'mezzotint', filter: {
                    type: descriptor_1.MztT.decode(f.Fltr.MztT),
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'Msc ': return Object.assign(Object.assign({}, base), { type: 'mosaic', filter: {
                    cellSize: (0, descriptor_1.parseUnits)(f.Fltr.ClSz),
                } });
            case 'Pntl': return Object.assign(Object.assign({}, base), { type: 'pointillize', filter: {
                    cellSize: f.Fltr.ClSz,
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'Clds': return Object.assign(Object.assign({}, base), { type: 'clouds', filter: {
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'DfrC': return Object.assign(Object.assign({}, base), { type: 'difference clouds', filter: {
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'Fbrs': return Object.assign(Object.assign({}, base), { type: 'fibers', filter: {
                    variance: f.Fltr.Vrnc,
                    strength: f.Fltr.Strg,
                    randomSeed: f.Fltr.RndS,
                } });
            case 'LnsF': return Object.assign(Object.assign({}, base), { type: 'lens flare', filter: {
                    brightness: f.Fltr.Brgh,
                    position: { x: f.Fltr.FlrC.Hrzn, y: f.Fltr.FlrC.Vrtc },
                    lensType: descriptor_1.Lns.decode(f.Fltr['Lns ']),
                } });
            case 'smartSharpen': return Object.assign(Object.assign({}, base), { type: 'smart sharpen', filter: {
                    amount: (0, descriptor_1.parsePercent)(f.Fltr.Amnt),
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                    threshold: f.Fltr.Thsh,
                    angle: f.Fltr.Angl,
                    moreAccurate: f.Fltr.moreAccurate,
                    blur: descriptor_1.blurType.decode(f.Fltr.blur),
                    preset: f.Fltr.preset,
                    shadow: {
                        fadeAmount: (0, descriptor_1.parsePercent)(f.Fltr.sdwM.Amnt),
                        tonalWidth: (0, descriptor_1.parsePercent)(f.Fltr.sdwM.Wdth),
                        radius: f.Fltr.sdwM['Rds '],
                    },
                    highlight: {
                        fadeAmount: (0, descriptor_1.parsePercent)(f.Fltr.hglM.Amnt),
                        tonalWidth: (0, descriptor_1.parsePercent)(f.Fltr.hglM.Wdth),
                        radius: f.Fltr.hglM['Rds '],
                    },
                } });
            case 'UnsM': return Object.assign(Object.assign({}, base), { type: 'unsharp mask', filter: {
                    amount: (0, descriptor_1.parsePercent)(f.Fltr.Amnt),
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                    threshold: f.Fltr.Thsh,
                } });
            case 'Dfs ': return Object.assign(Object.assign({}, base), { type: 'diffuse', filter: {
                    mode: descriptor_1.DfsM.decode(f.Fltr['Md  ']),
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'Embs': return Object.assign(Object.assign({}, base), { type: 'emboss', filter: {
                    angle: f.Fltr.Angl,
                    height: f.Fltr.Hght,
                    amount: f.Fltr.Amnt,
                } });
            case 'Extr': return Object.assign(Object.assign({}, base), { type: 'extrude', filter: {
                    type: descriptor_1.ExtT.decode(f.Fltr.ExtT),
                    size: f.Fltr.ExtS,
                    depth: f.Fltr.ExtD,
                    depthMode: descriptor_1.ExtR.decode(f.Fltr.ExtR),
                    randomSeed: f.Fltr.FlRs,
                    solidFrontFaces: f.Fltr.ExtF,
                    maskIncompleteBlocks: f.Fltr.ExtM,
                } });
            case 'Tls ': return Object.assign(Object.assign({}, base), { type: 'tiles', filter: {
                    numberOfTiles: f.Fltr.TlNm,
                    maximumOffset: f.Fltr.TlOf,
                    fillEmptyAreaWith: descriptor_1.FlCl.decode(f.Fltr.FlCl),
                    randomSeed: f.Fltr.FlRs,
                } });
            case 'TrcC': return Object.assign(Object.assign({}, base), { type: 'trace contour', filter: {
                    level: f.Fltr['Lvl '],
                    edge: descriptor_1.CntE.decode(f.Fltr['Edg ']),
                } });
            case 'Wnd ': return Object.assign(Object.assign({}, base), { type: 'wind', filter: {
                    method: descriptor_1.WndM.decode(f.Fltr.WndM),
                    direction: descriptor_1.Drct.decode(f.Fltr.Drct),
                } });
            case 'Dntr': return Object.assign(Object.assign({}, base), { type: 'de-interlace', filter: {
                    eliminate: descriptor_1.IntE.decode(f.Fltr.IntE),
                    newFieldsBy: descriptor_1.IntC.decode(f.Fltr.IntC),
                } });
            case 'Cstm': return Object.assign(Object.assign({}, base), { type: 'custom', filter: {
                    scale: f.Fltr['Scl '],
                    offset: f.Fltr.Ofst,
                    matrix: f.Fltr.Mtrx,
                } });
            case 'HghP': return Object.assign(Object.assign({}, base), { type: 'high pass', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                } });
            case 'Mxm ': return Object.assign(Object.assign({}, base), { type: 'maximum', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                } });
            case 'Mnm ': return Object.assign(Object.assign({}, base), { type: 'minimum', filter: {
                    radius: (0, descriptor_1.parseUnits)(f.Fltr['Rds ']),
                } });
            case 'Ofst': return Object.assign(Object.assign({}, base), { type: 'offset', filter: {
                    horizontal: f.Fltr.Hrzn,
                    vertical: f.Fltr.Vrtc,
                    undefinedAreas: descriptor_1.FlMd.decode(f.Fltr['Fl  ']),
                } });
            case 'rigidTransform': return Object.assign(Object.assign({}, base), { type: 'puppet', filter: {
                    rigidType: f.Fltr.rigidType,
                    bounds: [
                        { x: f.Fltr.PuX0, y: f.Fltr.PuY0, },
                        { x: f.Fltr.PuX1, y: f.Fltr.PuY1, },
                        { x: f.Fltr.PuX2, y: f.Fltr.PuY2, },
                        { x: f.Fltr.PuX3, y: f.Fltr.PuY3, },
                    ],
                    puppetShapeList: f.Fltr.puppetShapeList.map(p => ({
                        rigidType: p.rigidType,
                        // TODO: VrsM
                        // TODO: VrsN
                        originalVertexArray: uint8ToPoints(p.originalVertexArray),
                        deformedVertexArray: uint8ToPoints(p.deformedVertexArray),
                        indexArray: Array.from(uint8ToUint32(p.indexArray)),
                        pinOffsets: arrayToPoints(p.pinOffsets),
                        posFinalPins: arrayToPoints(p.posFinalPins),
                        pinVertexIndices: p.pinVertexIndices,
                        selectedPin: p.selectedPin,
                        pinPosition: arrayToPoints(p.PinP),
                        pinRotation: p.PnRt,
                        pinOverlay: p.PnOv,
                        pinDepth: p.PnDp,
                        meshQuality: p.meshQuality,
                        meshExpansion: p.meshExpansion,
                        meshRigidity: p.meshRigidity,
                        imageResolution: p.imageResolution,
                        meshBoundaryPath: {
                            pathComponents: p.meshBoundaryPath.pathComponents.map(c => ({
                                shapeOperation: c.shapeOperation.split('.')[1],
                                paths: c.SbpL.map(t => ({
                                    closed: t.Clsp,
                                    points: t['Pts '].map(pt => ({
                                        anchor: hrznVrtcToPoint(pt.Anch),
                                        forward: hrznVrtcToPoint(pt['Fwd ']),
                                        backward: hrznVrtcToPoint(pt['Bwd ']),
                                        smooth: pt.Smoo,
                                    })),
                                })),
                            })),
                        },
                    })),
                } });
            case 'PbPl': {
                const parameters = [];
                const Flrt = f.Fltr;
                for (let i = 0; i < fromAtoZ.length; i++) {
                    if (!Flrt[`PN${fromAtoZ[i]}a`])
                        break;
                    for (let j = 0; j < fromAtoZ.length; j++) {
                        if (!Flrt[`PN${fromAtoZ[i]}${fromAtoZ[j]}`])
                            break;
                        parameters.push({
                            name: Flrt[`PN${fromAtoZ[i]}${fromAtoZ[j]}`],
                            value: Flrt[`PF${fromAtoZ[i]}${fromAtoZ[j]}`]
                        });
                    }
                }
                return Object.assign(Object.assign({}, base), { type: 'oil paint plugin', filter: {
                        name: f.Fltr.KnNm,
                        gpu: f.Fltr.GpuY,
                        lighting: f.Fltr.LIWy,
                        parameters,
                    } });
            }
            // case 2089: return {
            // 	...base,
            // 	type: 'adaptive wide angle',
            // 	params: {
            // 		correction: prjM.decode(f.Fltr.prjM),
            // 		focalLength: f.Fltr.focL,
            // 		cropFactor: f.Fltr.CrpF,
            // 		imageScale: f.Fltr.imgS,
            // 		imageX: f.Fltr.imgX,
            // 		imageY: f.Fltr.imgY,
            // 	},
            // };
            case 'HsbP': return Object.assign(Object.assign({}, base), { type: 'hsb/hsl', filter: {
                    inputMode: descriptor_1.ClrS.decode(f.Fltr.Inpt),
                    rowOrder: descriptor_1.ClrS.decode(f.Fltr.Otpt),
                } });
            case 'oilPaint': return Object.assign(Object.assign({}, base), { type: 'oil paint', filter: {
                    lightingOn: f.Fltr.lightingOn,
                    stylization: f.Fltr.stylization,
                    cleanliness: f.Fltr.cleanliness,
                    brushScale: f.Fltr.brushScale,
                    microBrush: f.Fltr.microBrush,
                    lightDirection: f.Fltr.LghD,
                    specularity: f.Fltr.specularity,
                } });
            case 'LqFy':
                {
                    return Object.assign(Object.assign({}, base), { type: 'liquify', filter: {
                            liquifyMesh: f.Fltr.LqMe,
                        } });
                }
                ;
            case 'perspectiveWarpTransform':
                {
                    return Object.assign(Object.assign({}, base), { type: 'perspective warp', filter: {
                            vertices: f.Fltr.vertices.map(hrznVrtcToPoint),
                            warpedVertices: f.Fltr.warpedVertices.map(hrznVrtcToPoint),
                            quads: f.Fltr.quads.map(q => q.indices),
                        } });
                }
                ;
            case 'Crvs':
                {
                    return Object.assign(Object.assign({}, base), { type: 'curves', filter: Object.assign({ presetKind: descriptor_1.presetKindType.decode(f.Fltr.presetKind) }, (f.Fltr.Adjs ? {
                            adjustments: f.Fltr.Adjs.map(a => {
                                const channels = a.Chnl.map(descriptor_1.Chnl.decode);
                                if (a['Crv ']) {
                                    return {
                                        channels,
                                        curve: a['Crv '].map(c => {
                                            const point = { x: c.Hrzn, y: c.Vrtc };
                                            if (c.Cnty)
                                                point.curved = true;
                                            return point;
                                        }),
                                    };
                                }
                                else if (a.Mpng) {
                                    return { channels, values: a.Mpng };
                                }
                                else {
                                    throw new Error(`Unknown curve adjustment`);
                                }
                            })
                        } : {})) });
                }
                ;
            case 'BrgC':
                {
                    return Object.assign(Object.assign({}, base), { type: 'brightness/contrast', filter: {
                            brightness: f.Fltr.Brgh,
                            contrast: f.Fltr.Cntr,
                            useLegacy: !!f.Fltr.useLegacy,
                        } });
                }
                ;
            default:
                if (options.throwForMissingFeatures) {
                    // console.log('FILTER', require('util').inspect(f, false, 99, true));
                    throw new Error(`Unknown filter classId: ${f.Fltr._classID}`);
                }
                return undefined;
        }
    }
    else {
        switch (f.filterID) {
            case 1098281575: return Object.assign(Object.assign({}, base), { type: 'average' });
            case 1114403360: return Object.assign(Object.assign({}, base), { type: 'blur' });
            case 1114403405: return Object.assign(Object.assign({}, base), { type: 'blur more' });
            case 1148416099: return Object.assign(Object.assign({}, base), { type: 'despeckle' });
            case 1180922912: return Object.assign(Object.assign({}, base), { type: 'facet' });
            case 1181902701: return Object.assign(Object.assign({}, base), { type: 'fragment' });
            case 1399353968: return Object.assign(Object.assign({}, base), { type: 'sharpen' });
            case 1399353925: return Object.assign(Object.assign({}, base), { type: 'sharpen edges' });
            case 1399353933: return Object.assign(Object.assign({}, base), { type: 'sharpen more' });
            case 1181639749: return Object.assign(Object.assign({}, base), { type: 'find edges' });
            case 1399616122: return Object.assign(Object.assign({}, base), { type: 'solarize' });
            case 1314149187: return Object.assign(Object.assign({}, base), { type: 'ntsc colors' });
            case 1231976050: return Object.assign(Object.assign({}, base), { type: 'invert' });
            default:
                if (options.throwForMissingFeatures) {
                    // console.log('FILTER', require('util').inspect(f, false, 99, true));
                    throw new Error(`Unknown filterID: ${f.filterID}`);
                }
        }
    }
}
function parseFilterFX(desc, options) {
    return {
        enabled: desc.enab,
        validAtPosition: desc.validAtPosition,
        maskEnabled: desc.filterMaskEnable,
        maskLinked: desc.filterMaskLinked,
        maskExtendWithWhite: desc.filterMaskExtendWithWhite,
        list: desc.filterFXList.map(x => parseFilterFXItem(x, options)).filter((x) => !!x),
    };
}
function uvRadius(t) {
    return (0, descriptor_1.unitsValue)(t.radius, 'radius');
}
function serializeFilterFXItem(f) {
    const base = {
        _name: '',
        _classID: 'filterFX',
        'Nm  ': f.name,
        blendOptions: {
            _name: '',
            _classID: 'blendOptions',
            Opct: (0, descriptor_1.unitsPercentF)(f.opacity),
            'Md  ': descriptor_1.BlnM.encode(f.blendMode),
        },
        enab: f.enabled,
        hasoptions: f.hasOptions,
        FrgC: (0, descriptor_1.serializeColor)(f.foregroundColor),
        BckC: (0, descriptor_1.serializeColor)(f.backgroundColor),
    };
    switch (f.type) {
        case 'average': return Object.assign(Object.assign({}, base), { filterID: 1098281575 });
        case 'blur': return Object.assign(Object.assign({}, base), { filterID: 1114403360 });
        case 'blur more': return Object.assign(Object.assign({}, base), { filterID: 1114403405 });
        case 'box blur': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Box Blur',
                _classID: 'boxblur',
                'Rds ': uvRadius(f.filter),
            }, filterID: 697 });
        case 'gaussian blur': return Object.assign(Object.assign({}, base), { Fltr: {
                // _name: '高斯模糊', // Testing
                _name: 'Gaussian Blur',
                _classID: 'GsnB',
                'Rds ': uvRadius(f.filter),
            }, filterID: 1198747202 });
        case 'motion blur': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Motion Blur',
                _classID: 'MtnB',
                Angl: f.filter.angle,
                Dstn: (0, descriptor_1.unitsValue)(f.filter.distance, 'distance'),
            }, filterID: 1299476034 });
        case 'radial blur': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Radial Blur',
                _classID: 'RdlB',
                Amnt: f.filter.amount,
                BlrM: descriptor_1.BlrM.encode(f.filter.method),
                BlrQ: descriptor_1.BlrQ.encode(f.filter.quality),
            }, filterID: 1382313026 });
        case 'shape blur': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Shape Blur',
                _classID: 'shapeBlur',
                'Rds ': uvRadius(f.filter),
                customShape: {
                    _name: '',
                    _classID: 'customShape',
                    'Nm  ': f.filter.customShape.name,
                    Idnt: f.filter.customShape.id,
                }
            }, filterID: 702 });
        case 'smart blur': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Smart Blur',
                _classID: 'SmrB',
                'Rds ': f.filter.radius,
                Thsh: f.filter.threshold,
                SmBQ: descriptor_1.SmBQ.encode(f.filter.quality),
                SmBM: descriptor_1.SmBM.encode(f.filter.mode),
            }, filterID: 1399681602 });
        case 'surface blur': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Surface Blur',
                _classID: 'surfaceBlur',
                'Rds ': uvRadius(f.filter),
                Thsh: f.filter.threshold,
            }, filterID: 701 });
        case 'displace': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Displace',
                _classID: 'Dspl',
                HrzS: f.filter.horizontalScale,
                VrtS: f.filter.verticalScale,
                DspM: descriptor_1.DspM.encode(f.filter.displacementMap),
                UndA: descriptor_1.UndA.encode(f.filter.undefinedAreas),
                DspF: {
                    sig: f.filter.displacementFile.signature,
                    path: f.filter.displacementFile.path,
                },
            }, filterID: 1148416108 });
        case 'pinch': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Pinch',
                _classID: 'Pnch',
                Amnt: f.filter.amount,
            }, filterID: 1349411688 });
        case 'polar coordinates': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Polar Coordinates',
                _classID: 'Plr ',
                Cnvr: descriptor_1.Cnvr.encode(f.filter.conversion),
            }, filterID: 1349284384 });
        case 'ripple': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Ripple',
                _classID: 'Rple',
                Amnt: f.filter.amount,
                RplS: descriptor_1.RplS.encode(f.filter.size),
            }, filterID: 1383099493 });
        case 'shear': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Shear',
                _classID: 'Shr ',
                ShrP: f.filter.shearPoints.map(p => ({ _name: '', _classID: 'Pnt ', Hrzn: p.x, Vrtc: p.y })),
                UndA: descriptor_1.UndA.encode(f.filter.undefinedAreas),
                ShrS: f.filter.shearStart,
                ShrE: f.filter.shearEnd,
            }, filterID: 1399353888 });
        case 'spherize': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Spherize',
                _classID: 'Sphr',
                Amnt: f.filter.amount,
                SphM: descriptor_1.SphM.encode(f.filter.mode),
            }, filterID: 1399875698 });
        case 'twirl': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Twirl',
                _classID: 'Twrl',
                Angl: f.filter.angle,
            }, filterID: 1417114220 });
        case 'wave': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Wave',
                _classID: 'Wave',
                Wvtp: descriptor_1.Wvtp.encode(f.filter.type),
                NmbG: f.filter.numberOfGenerators,
                WLMn: f.filter.wavelength.min,
                WLMx: f.filter.wavelength.max,
                AmMn: f.filter.amplitude.min,
                AmMx: f.filter.amplitude.max,
                SclH: f.filter.scale.x,
                SclV: f.filter.scale.y,
                UndA: descriptor_1.UndA.encode(f.filter.undefinedAreas),
                RndS: f.filter.randomSeed,
            }, filterID: 1466005093 });
        case 'zigzag': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'ZigZag',
                _classID: 'ZgZg',
                Amnt: f.filter.amount,
                NmbR: f.filter.ridges,
                ZZTy: descriptor_1.ZZTy.encode(f.filter.style),
            }, filterID: 1516722791 });
        case 'add noise': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Add Noise',
                _classID: 'AdNs',
                Dstr: descriptor_1.Dstr.encode(f.filter.distribution),
                Nose: (0, descriptor_1.unitsPercentF)(f.filter.amount),
                Mnch: f.filter.monochromatic,
                FlRs: f.filter.randomSeed,
            }, filterID: 1097092723 });
        case 'despeckle': return Object.assign(Object.assign({}, base), { filterID: 1148416099 });
        case 'dust and scratches': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Dust & Scratches',
                _classID: 'DstS',
                'Rds ': f.filter.radius,
                Thsh: f.filter.threshold,
            }, filterID: 1148417107 });
        case 'median': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Median',
                _classID: 'Mdn ',
                'Rds ': uvRadius(f.filter),
            }, filterID: 1298427424 });
        case 'reduce noise': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Reduce Noise',
                _classID: 'denoise',
                ClNs: (0, descriptor_1.unitsPercentF)(f.filter.reduceColorNoise),
                Shrp: (0, descriptor_1.unitsPercentF)(f.filter.sharpenDetails),
                removeJPEGArtifact: f.filter.removeJpegArtifact,
                channelDenoise: f.filter.channelDenoise.map(c => (Object.assign({ _name: '', _classID: 'channelDenoiseParams', Chnl: c.channels.map(i => descriptor_1.Chnl.encode(i)), Amnt: c.amount }, (c.preserveDetails ? { EdgF: c.preserveDetails } : {})))),
                preset: f.filter.preset,
            }, filterID: 633 });
        case 'color halftone': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Color Halftone',
                _classID: 'ClrH',
                'Rds ': f.filter.radius,
                Ang1: f.filter.angle1,
                Ang2: f.filter.angle2,
                Ang3: f.filter.angle3,
                Ang4: f.filter.angle4,
            }, filterID: 1131180616 });
        case 'crystallize': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Crystallize',
                _classID: 'Crst',
                ClSz: f.filter.cellSize,
                FlRs: f.filter.randomSeed,
            }, filterID: 1131574132 });
        case 'facet': return Object.assign(Object.assign({}, base), { filterID: 1180922912 });
        case 'fragment': return Object.assign(Object.assign({}, base), { filterID: 1181902701 });
        case 'mezzotint': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Mezzotint',
                _classID: 'Mztn',
                MztT: descriptor_1.MztT.encode(f.filter.type),
                FlRs: f.filter.randomSeed,
            }, filterID: 1299870830 });
        case 'mosaic': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Mosaic',
                _classID: 'Msc ',
                ClSz: (0, descriptor_1.unitsValue)(f.filter.cellSize, 'cellSize'),
            }, filterID: 1299407648 });
        case 'pointillize': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Pointillize',
                _classID: 'Pntl',
                ClSz: f.filter.cellSize,
                FlRs: f.filter.randomSeed,
            }, filterID: 1349416044 });
        case 'clouds': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Clouds',
                _classID: 'Clds',
                FlRs: f.filter.randomSeed,
            }, filterID: 1131177075 });
        case 'difference clouds': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Difference Clouds',
                _classID: 'DfrC',
                FlRs: f.filter.randomSeed,
            }, filterID: 1147564611 });
        case 'fibers': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Fibers',
                _classID: 'Fbrs',
                Vrnc: f.filter.variance,
                Strg: f.filter.strength,
                RndS: f.filter.randomSeed,
            }, filterID: 1180856947 });
        case 'lens flare': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Lens Flare',
                _classID: 'LnsF',
                Brgh: f.filter.brightness,
                FlrC: {
                    _name: '',
                    _classID: 'Pnt ',
                    Hrzn: f.filter.position.x,
                    Vrtc: f.filter.position.y,
                },
                'Lns ': descriptor_1.Lns.encode(f.filter.lensType),
            }, filterID: 1282306886 });
        case 'sharpen': return Object.assign(Object.assign({}, base), { filterID: 1399353968 });
        case 'sharpen edges': return Object.assign(Object.assign({}, base), { filterID: 1399353925 });
        case 'sharpen more': return Object.assign(Object.assign({}, base), { filterID: 1399353933 });
        case 'smart sharpen': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Smart Sharpen',
                _classID: 'smartSharpen',
                Amnt: (0, descriptor_1.unitsPercentF)(f.filter.amount),
                'Rds ': uvRadius(f.filter),
                Thsh: f.filter.threshold,
                Angl: f.filter.angle,
                moreAccurate: f.filter.moreAccurate,
                blur: descriptor_1.blurType.encode(f.filter.blur),
                preset: f.filter.preset,
                sdwM: {
                    _name: 'Parameters',
                    _classID: 'adaptCorrectTones',
                    Amnt: (0, descriptor_1.unitsPercentF)(f.filter.shadow.fadeAmount),
                    Wdth: (0, descriptor_1.unitsPercentF)(f.filter.shadow.tonalWidth),
                    'Rds ': f.filter.shadow.radius,
                },
                hglM: {
                    _name: 'Parameters',
                    _classID: 'adaptCorrectTones',
                    Amnt: (0, descriptor_1.unitsPercentF)(f.filter.highlight.fadeAmount),
                    Wdth: (0, descriptor_1.unitsPercentF)(f.filter.highlight.tonalWidth),
                    'Rds ': f.filter.highlight.radius,
                },
            }, filterID: 698 });
        case 'unsharp mask': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Unsharp Mask',
                _classID: 'UnsM',
                Amnt: (0, descriptor_1.unitsPercentF)(f.filter.amount),
                'Rds ': uvRadius(f.filter),
                Thsh: f.filter.threshold,
            }, filterID: 1433301837 });
        case 'diffuse': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Diffuse',
                _classID: 'Dfs ',
                'Md  ': descriptor_1.DfsM.encode(f.filter.mode),
                FlRs: f.filter.randomSeed,
            }, filterID: 1147564832 });
        case 'emboss': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Emboss',
                _classID: 'Embs',
                Angl: f.filter.angle,
                Hght: f.filter.height,
                Amnt: f.filter.amount,
            }, filterID: 1164796531 });
        case 'extrude': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Extrude',
                _classID: 'Extr',
                ExtS: f.filter.size,
                ExtD: f.filter.depth,
                ExtF: f.filter.solidFrontFaces,
                ExtM: f.filter.maskIncompleteBlocks,
                ExtT: descriptor_1.ExtT.encode(f.filter.type),
                ExtR: descriptor_1.ExtR.encode(f.filter.depthMode),
                FlRs: f.filter.randomSeed,
            }, filterID: 1165522034 });
        case 'find edges': return Object.assign(Object.assign({}, base), { filterID: 1181639749 });
        case 'solarize': return Object.assign(Object.assign({}, base), { filterID: 1399616122 });
        case 'tiles': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Tiles',
                _classID: 'Tls ',
                TlNm: f.filter.numberOfTiles,
                TlOf: f.filter.maximumOffset,
                FlCl: descriptor_1.FlCl.encode(f.filter.fillEmptyAreaWith),
                FlRs: f.filter.randomSeed,
            }, filterID: 1416393504 });
        case 'trace contour': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Trace Contour',
                _classID: 'TrcC',
                'Lvl ': f.filter.level,
                'Edg ': descriptor_1.CntE.encode(f.filter.edge),
            }, filterID: 1416782659 });
        case 'wind': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Wind',
                _classID: 'Wnd ',
                WndM: descriptor_1.WndM.encode(f.filter.method),
                Drct: descriptor_1.Drct.encode(f.filter.direction),
            }, filterID: 1466852384 });
        case 'de-interlace': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'De-Interlace',
                _classID: 'Dntr',
                IntE: descriptor_1.IntE.encode(f.filter.eliminate),
                IntC: descriptor_1.IntC.encode(f.filter.newFieldsBy),
            }, filterID: 1148089458 });
        case 'ntsc colors': return Object.assign(Object.assign({}, base), { filterID: 1314149187 });
        case 'invert': return Object.assign(Object.assign({}, base), { filterID: 1231976050 });
        case 'custom': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Custom',
                _classID: 'Cstm',
                'Scl ': f.filter.scale,
                Ofst: f.filter.offset,
                Mtrx: f.filter.matrix,
            }, filterID: 1131639917 });
        case 'high pass': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'High Pass',
                _classID: 'HghP',
                'Rds ': uvRadius(f.filter),
            }, filterID: 1214736464 });
        case 'maximum': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Maximum',
                _classID: 'Mxm ',
                'Rds ': uvRadius(f.filter),
            }, filterID: 1299737888 });
        case 'minimum': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Minimum',
                _classID: 'Mnm ',
                'Rds ': uvRadius(f.filter),
            }, filterID: 1299082528 });
        case 'offset': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Offset',
                _classID: 'Ofst',
                Hrzn: f.filter.horizontal,
                Vrtc: f.filter.vertical,
                'Fl  ': descriptor_1.FlMd.encode(f.filter.undefinedAreas),
            }, filterID: 1332114292 });
        case 'puppet': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Rigid Transform',
                _classID: 'rigidTransform',
                'null': ['Ordn.Trgt'], // TODO: ???
                rigidType: f.filter.rigidType,
                puppetShapeList: f.filter.puppetShapeList.map(p => ({
                    _name: '',
                    _classID: 'puppetShape',
                    rigidType: p.rigidType,
                    VrsM: 1, // TODO: ???
                    VrsN: 0, // TODO: ???
                    originalVertexArray: toUint8(new Float32Array(pointsToArray(p.originalVertexArray))),
                    deformedVertexArray: toUint8(new Float32Array(pointsToArray(p.deformedVertexArray))),
                    indexArray: toUint8(new Uint32Array(p.indexArray)),
                    pinOffsets: pointsToArray(p.pinOffsets),
                    posFinalPins: pointsToArray(p.posFinalPins),
                    pinVertexIndices: p.pinVertexIndices,
                    PinP: pointsToArray(p.pinPosition),
                    PnRt: p.pinRotation,
                    PnOv: p.pinOverlay,
                    PnDp: p.pinDepth,
                    meshQuality: p.meshQuality,
                    meshExpansion: p.meshExpansion,
                    meshRigidity: p.meshRigidity,
                    imageResolution: p.imageResolution,
                    meshBoundaryPath: {
                        _name: '',
                        _classID: 'pathClass',
                        pathComponents: p.meshBoundaryPath.pathComponents.map(c => ({
                            _name: '',
                            _classID: 'PaCm',
                            shapeOperation: `shapeOperation.${c.shapeOperation}`,
                            SbpL: c.paths.map(path => ({
                                _name: '',
                                _classID: 'Sbpl',
                                Clsp: path.closed,
                                'Pts ': path.points.map(pt => ({
                                    _name: '',
                                    _classID: 'Pthp',
                                    Anch: pointToHrznVrtc(pt.anchor),
                                    'Fwd ': pointToHrznVrtc(pt.forward),
                                    'Bwd ': pointToHrznVrtc(pt.backward),
                                    Smoo: pt.smooth,
                                })),
                            })),
                        })),
                    },
                    selectedPin: p.selectedPin,
                })),
                PuX0: f.filter.bounds[0].x,
                PuX1: f.filter.bounds[1].x,
                PuX2: f.filter.bounds[2].x,
                PuX3: f.filter.bounds[3].x,
                PuY0: f.filter.bounds[0].y,
                PuY1: f.filter.bounds[1].y,
                PuY2: f.filter.bounds[2].y,
                PuY3: f.filter.bounds[3].y,
            }, filterID: 991 });
        case 'oil paint plugin': {
            const params = {};
            for (let i = 0; i < f.filter.parameters.length; i++) {
                const { name, value } = f.filter.parameters[i];
                const suffix = `${fromAtoZ[Math.floor(i / fromAtoZ.length)]}${fromAtoZ[i % fromAtoZ.length]}`;
                params[`PN${suffix}`] = name;
                params[`PT${suffix}`] = 0;
                params[`PF${suffix}`] = value;
            }
            return Object.assign(Object.assign({}, base), { Fltr: Object.assign({ _name: 'Oil Paint Plugin', _classID: 'PbPl', KnNm: f.filter.name, GpuY: f.filter.gpu, LIWy: f.filter.lighting, FPth: '1' }, params), filterID: 1348620396 });
        }
        case 'oil paint': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Oil Paint',
                _classID: 'oilPaint',
                lightingOn: f.filter.lightingOn,
                stylization: f.filter.stylization,
                cleanliness: f.filter.cleanliness,
                brushScale: f.filter.brushScale,
                microBrush: f.filter.microBrush,
                LghD: f.filter.lightDirection,
                specularity: f.filter.specularity,
            }, filterID: 1122 });
        case 'liquify': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Liquify',
                _classID: 'LqFy',
                LqMe: f.filter.liquifyMesh,
            }, filterID: 1282492025 });
        case 'perspective warp': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Perspective Warp',
                _classID: 'perspectiveWarpTransform',
                vertices: f.filter.vertices.map(pointToHrznVrtc),
                warpedVertices: f.filter.warpedVertices.map(pointToHrznVrtc),
                quads: f.filter.quads.map(indices => ({ indices })),
            }, filterID: 442 });
        case 'curves': return Object.assign(Object.assign({}, base), { Fltr: Object.assign({ _name: 'Curves', _classID: 'Crvs', presetKind: descriptor_1.presetKindType.encode(f.filter.presetKind) }, (f.filter.adjustments ? {
                Adjs: f.filter.adjustments.map(a => 'curve' in a ? {
                    _name: '',
                    _classID: 'CrvA',
                    Chnl: a.channels.map(descriptor_1.Chnl.encode),
                    'Crv ': a.curve.map(c => (Object.assign({ _name: '', _classID: 'Pnt ', Hrzn: c.x, Vrtc: c.y }, (c.curved ? { Cnty: true } : {})))),
                } : {
                    _name: '',
                    _classID: 'CrvA',
                    Chnl: a.channels.map(descriptor_1.Chnl.encode),
                    Mpng: a.values,
                })
            } : {})), filterID: 1131574899 });
        case 'brightness/contrast': return Object.assign(Object.assign({}, base), { Fltr: {
                _name: 'Brightness/Contrast',
                _classID: 'BrgC',
                Brgh: f.filter.brightness,
                Cntr: f.filter.contrast,
                useLegacy: !!f.filter.useLegacy,
            }, filterID: 1114793795 });
        // case 'hsb/hsl': return {
        // TODO: ...
        // };
        default: throw new Error(`Unknow filter type: ${f.type}`);
    }
}
// let t: any;
function getWarpFromPlacedLayer(placed) {
    if (placed.warp)
        return placed.warp;
    if (!placed.width || !placed.height)
        throw new Error('You must provide width and height of the linked image in placedLayer');
    const w = placed.width;
    const h = placed.height;
    const x0 = 0, x1 = w / 3, x2 = w * 2 / 3, x3 = w;
    const y0 = 0, y1 = h / 3, y2 = h * 2 / 3, y3 = h;
    return {
        style: 'custom',
        value: 0,
        perspective: 0,
        perspectiveOther: 0,
        rotate: 'horizontal',
        bounds: {
            top: { value: 0, units: 'Pixels' },
            left: { value: 0, units: 'Pixels' },
            bottom: { value: h, units: 'Pixels' },
            right: { value: w, units: 'Pixels' },
        },
        uOrder: 4,
        vOrder: 4,
        customEnvelopeWarp: {
            meshPoints: [
                { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x2, y: y0 }, { x: x3, y: y0 },
                { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x3, y: y1 },
                { x: x0, y: y2 }, { x: x1, y: y2 }, { x: x2, y: y2 }, { x: x3, y: y2 },
                { x: x0, y: y3 }, { x: x1, y: y3 }, { x: x2, y: y3 }, { x: x3, y: y3 },
            ],
        },
    };
}
addHandler('SoLd', hasKey('placedLayer'), (reader, target, left) => {
    if ((0, psdReader_1.readSignature)(reader) !== 'soLD')
        throw new Error(`Invalid SoLd type`);
    const version = (0, psdReader_1.readInt32)(reader);
    if (version !== 4 && version !== 5)
        throw new Error(`Invalid SoLd version`);
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader, true);
    // console.log('SoLd', require('util').inspect(desc, false, 99, true));
    // console.log('SoLd.warp', require('util').inspect(desc.warp, false, 99, true));
    // console.log('SoLd.quiltWarp', require('util').inspect(desc.quiltWarp, false, 99, true));
    // desc.filterFX!.filterFXList[0].Fltr.puppetShapeList[0].meshBoundaryPath.pathComponents[0].SbpL[0]['Pts '] = [];
    // console.log('read', require('util').inspect(desc.filterFX, false, 99, true));
    // console.log('filterFXList[0]', require('util').inspect((desc as any).filterFX.filterFXList[0], false, 99, true));
    // t = desc;
    target.placedLayer = {
        id: desc.Idnt,
        placed: desc.placed,
        type: placedLayerTypes[desc.Type],
        pageNumber: desc.PgNm,
        totalPages: desc.totalPages,
        frameStep: (0, descriptor_1.frac)(desc.frameStep),
        duration: (0, descriptor_1.frac)(desc.duration),
        frameCount: desc.frameCount,
        transform: desc.Trnf,
        width: desc['Sz  '].Wdth,
        height: desc['Sz  '].Hght,
        resolution: (0, descriptor_1.parseUnits)(desc.Rslt),
        warp: parseWarp((desc.quiltWarp || desc.warp)),
    };
    if (desc.nonAffineTransform && desc.nonAffineTransform.some((x, i) => x !== desc.Trnf[i])) {
        target.placedLayer.nonAffineTransform = desc.nonAffineTransform;
    }
    if (desc.Crop)
        target.placedLayer.crop = desc.Crop;
    if (desc.comp)
        target.placedLayer.comp = desc.comp;
    if (desc.compInfo) {
        target.placedLayer.compInfo = {
            compID: desc.compInfo.compID,
            originalCompID: desc.compInfo.originalCompID,
        };
    }
    if (desc.filterFX)
        target.placedLayer.filter = parseFilterFX(desc.filterFX, reader);
    // console.log('filter', require('util').inspect(target.placedLayer.filter, false, 99, true));
    (0, psdReader_1.skipBytes)(reader, left()); // HACK
}, (writer, target) => {
    var _a, _b;
    (0, psdWriter_1.writeSignature)(writer, 'soLD');
    (0, psdWriter_1.writeInt32)(writer, 4); // version
    const placed = target.placedLayer;
    if (!placed.id || typeof placed.id !== 'string' || !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(placed.id)) {
        throw new Error('Placed layer ID must be in a GUID format (example: 20953ddb-9391-11ec-b4f1-c15674f50bc4)');
    }
    const desc = Object.assign(Object.assign({ Idnt: placed.id, placed: (_a = placed.placed) !== null && _a !== void 0 ? _a : placed.id, PgNm: placed.pageNumber || 1, totalPages: placed.totalPages || 1 }, (placed.crop ? { Crop: placed.crop } : {})), { frameStep: placed.frameStep || { numerator: 0, denominator: 600 }, duration: placed.duration || { numerator: 0, denominator: 600 }, frameCount: placed.frameCount || 0, Annt: 16, Type: placedLayerTypes.indexOf(placed.type), Trnf: placed.transform, nonAffineTransform: (_b = placed.nonAffineTransform) !== null && _b !== void 0 ? _b : placed.transform, 
        // quiltWarp: {} as any,
        warp: encodeWarp(getWarpFromPlacedLayer(placed)), 'Sz  ': {
            _name: '',
            _classID: 'Pnt ',
            Wdth: placed.width || 0, // TODO: find size ?
            Hght: placed.height || 0, // TODO: find size ?
        }, Rslt: placed.resolution ? (0, descriptor_1.unitsValue)(placed.resolution, 'resolution') : { units: 'Density', value: 72 } });
    if (placed.filter) {
        desc.filterFX = {
            _name: '',
            _classID: 'filterFXStyle',
            enab: placed.filter.enabled,
            validAtPosition: placed.filter.validAtPosition,
            filterMaskEnable: placed.filter.maskEnabled,
            filterMaskLinked: placed.filter.maskLinked,
            filterMaskExtendWithWhite: placed.filter.maskExtendWithWhite,
            filterFXList: placed.filter.list.map(f => serializeFilterFXItem(f)),
        };
    }
    // TODO:
    // desc.comp = -1;
    // desc.compInfo = { _name: '', _classID: 'null', compID: -1, originalCompID: -1 } as any;
    // desc.ClMg = {
    // 	_name: '',
    // 	_classID: 'ClMg',
    // 	placedLayerOCIOConversion: 'placedLayerOCIOConversion.placedLayerOCIOConvertEmbedded'
    // } as any;
    // if (JSON.stringify(t) !== JSON.stringify(desc)) {
    // 	console.log('read', require('util').inspect(t, false, 99, true));
    // 	console.log('write', require('util').inspect(desc, false, 99, true));
    // 	console.error('DIFFERENT');
    // 	// throw new Error('DIFFERENT');
    // }
    if (placed.warp && isQuiltWarp(placed.warp)) {
        const quiltWarp = encodeWarp(placed.warp);
        desc.quiltWarp = quiltWarp;
        desc.warp = {
            warpStyle: 'warpStyle.warpNone',
            warpValue: quiltWarp.warpValue,
            warpPerspective: quiltWarp.warpPerspective,
            warpPerspectiveOther: quiltWarp.warpPerspectiveOther,
            warpRotate: quiltWarp.warpRotate,
            bounds: quiltWarp.bounds,
            uOrder: quiltWarp.uOrder,
            vOrder: quiltWarp.vOrder,
        };
    }
    else {
        delete desc.quiltWarp;
    }
    if (placed.comp)
        desc.comp = placed.comp;
    if (placed.compInfo)
        desc.compInfo = placed.compInfo;
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc, desc.quiltWarp ? 'quiltWarp' : 'warp');
});
addHandlerAlias('SoLE', 'SoLd');
addHandler('fxrp', hasKey('referencePoint'), (reader, target) => {
    target.referencePoint = {
        x: (0, psdReader_1.readFloat64)(reader),
        y: (0, psdReader_1.readFloat64)(reader),
    };
}, (writer, target) => {
    (0, psdWriter_1.writeFloat64)(writer, target.referencePoint.x);
    (0, psdWriter_1.writeFloat64)(writer, target.referencePoint.y);
});
addHandler('Lr16', () => false, (reader, _target, _left, psd, imageResources) => {
    (0, psdReader_1.readLayerInfo)(reader, psd, imageResources);
}, (_writer, _target) => {
});
addHandler('Lr32', () => false, (reader, _target, _left, psd, imageResources) => {
    (0, psdReader_1.readLayerInfo)(reader, psd, imageResources);
}, (_writer, _target) => {
});
addHandler('LMsk', hasKey('userMask'), (reader, target) => {
    target.userMask = {
        colorSpace: (0, psdReader_1.readColor)(reader),
        opacity: (0, psdReader_1.readUint16)(reader) / 0xff,
    };
    const flag = (0, psdReader_1.readUint8)(reader);
    if (flag !== 128)
        throw new Error('Invalid flag value');
    (0, psdReader_1.skipBytes)(reader, 1);
}, (writer, target) => {
    const userMask = target.userMask;
    (0, psdWriter_1.writeColor)(writer, userMask.colorSpace);
    (0, psdWriter_1.writeUint16)(writer, (0, helpers_1.clamp)(userMask.opacity, 0, 1) * 0xff);
    (0, psdWriter_1.writeUint8)(writer, 128);
    (0, psdWriter_1.writeZeros)(writer, 1);
});
if (helpers_1.MOCK_HANDLERS) {
    addHandler('Patt', target => target._Patt !== undefined, (reader, target, left) => {
        // console.log('additional info: Patt');
        target._Patt = (0, psdReader_1.readBytes)(reader, left());
    }, (writer, target) => false && (0, psdWriter_1.writeBytes)(writer, target._Patt));
}
else {
    addHandler('Patt', // TODO: handle also Pat2 & Pat3
    // TODO: handle also Pat2 & Pat3
    target => !!(target.patterns && target.patterns.length > 0), (reader, target, left) => {
        while (left() > 0) {
            const pattern = (0, psdReader_1.readPattern)(reader);
            if (target.patterns === undefined)
                target.patterns = [];
            target.patterns.push(pattern);
        }
    }, (writer, target, _, _options) => {
        const patterns = target.patterns || [];
        for (const pattern of patterns) {
            (0, psdWriter_1.writePattern)(writer, pattern);
        }
    });
}
addHandlerAlias('Pat2', 'Patt');
addHandlerAlias('Pat3', 'Patt');
/*
interface CAIDesc {
    _name: '';
    _classID: 'null';
    enab: boolean;
    generationalGuid: string;
}

addHandler(
    'CAI ', // content credentials ? something to do with generative tech
    () => false,
    (reader, _target, left) => {
        const version = readUint32(reader); // 3
        const desc = readVersionAndDescriptor(reader, true) as CAIDesc;
        console.log('CAI version', version);
        console.log('CAI', require('util').inspect(desc, false, 99, true));
        console.log('CAI left', readBytes(reader, left())); // 8 bytes left, all zeroes
    },
    (_writer, _target) => {
    },
);
// */
if (helpers_1.MOCK_HANDLERS) {
    addHandler('CAI ', target => target._CAI_ !== undefined, (reader, target, left) => {
        target._CAI_ = (0, psdReader_1.readBytes)(reader, left());
    }, (writer, target) => {
        (0, psdWriter_1.writeBytes)(writer, target._CAI_);
    });
}
// interface OCIODescriptor {
// 	_name: '';
// 	_classID: 'documentColorManagementInfo';
// 	'Knd ': 'icc';
// 	ocio_display_view: {
// 		_name: '';
// 		_classID: 'viewColorManagementInfo';
// 		display: string;
// 		view: string;
// 	};
// }
if (helpers_1.MOCK_HANDLERS) {
    addHandler('OCIO', // document color management info
    // document color management info
    target => target._OCIO !== undefined, (reader, target, left) => {
        // const desc = readVersionAndDescriptor(reader, true) as OCIODescriptor;
        // console.log('OCIO', require('util').inspect(desc, false, 99, true));
        target._OCIO = (0, psdReader_1.readBytes)(reader, left());
    }, (writer, target) => {
        (0, psdWriter_1.writeBytes)(writer, target._OCIO);
    });
}
// interface GenIDescriptor {
//  _name: '';
//  _classID: 'genTechInfo';
// 	isUsingGenTech: number;
//  externalModelList?: [];
// }
if (helpers_1.MOCK_HANDLERS) {
    addHandler('GenI', // generative tech
    // generative tech
    target => target._GenI !== undefined, (reader, target, left) => {
        // const desc = readVersionAndDescriptor(reader, true); // as GenIDescriptor;
        // console.log('GenI', require('util').inspect(desc, false, 99, true));
        target._GenI = (0, psdReader_1.readBytes)(reader, left());
    }, (writer, target) => {
        (0, psdWriter_1.writeBytes)(writer, target._GenI);
    });
}
function readRect(reader) {
    const top = (0, psdReader_1.readInt32)(reader);
    const left = (0, psdReader_1.readInt32)(reader);
    const bottom = (0, psdReader_1.readInt32)(reader);
    const right = (0, psdReader_1.readInt32)(reader);
    return { top, left, bottom, right };
}
function writeRect(writer, rect) {
    (0, psdWriter_1.writeInt32)(writer, rect.top);
    (0, psdWriter_1.writeInt32)(writer, rect.left);
    (0, psdWriter_1.writeInt32)(writer, rect.bottom);
    (0, psdWriter_1.writeInt32)(writer, rect.right);
}
addHandler('Anno', target => target.annotations !== undefined, (reader, target, left) => {
    const major = (0, psdReader_1.readUint16)(reader);
    const minor = (0, psdReader_1.readUint16)(reader);
    if (major !== 2 || minor !== 1)
        throw new Error('Invalid Anno version');
    const count = (0, psdReader_1.readUint32)(reader);
    const annotations = [];
    for (let i = 0; i < count; i++) {
        /*const length =*/ (0, psdReader_1.readUint32)(reader);
        const type = (0, psdReader_1.readSignature)(reader);
        const open = !!(0, psdReader_1.readUint8)(reader);
        /*const flags =*/ (0, psdReader_1.readUint8)(reader); // always 28
        /*const optionalBlocks =*/ (0, psdReader_1.readUint16)(reader);
        const iconLocation = readRect(reader);
        const popupLocation = readRect(reader);
        const color = (0, psdReader_1.readColor)(reader);
        const author = (0, psdReader_1.readPascalString)(reader, 2);
        const name = (0, psdReader_1.readPascalString)(reader, 2);
        const date = (0, psdReader_1.readPascalString)(reader, 2);
        /*const contentLength =*/ (0, psdReader_1.readUint32)(reader);
        /*const dataType =*/ (0, psdReader_1.readSignature)(reader);
        const dataLength = (0, psdReader_1.readUint32)(reader);
        let data;
        if (type === 'txtA') {
            if (dataLength >= 2 && (0, psdReader_1.readUint16)(reader) === 0xfeff) {
                data = (0, psdReader_1.readUnicodeStringWithLength)(reader, (dataLength - 2) / 2);
            }
            else {
                reader.offset -= 2;
                data = (0, psdReader_1.readAsciiString)(reader, dataLength);
            }
            data = data.replace(/\r/g, '\n');
        }
        else if (type === 'sndA') {
            data = (0, psdReader_1.readBytes)(reader, dataLength);
        }
        else {
            throw new Error('Unknown annotation type');
        }
        annotations.push({
            type: type === 'txtA' ? 'text' : 'sound', open, iconLocation, popupLocation, color, author, name, date, data,
        });
    }
    target.annotations = annotations;
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const annotations = target.annotations;
    (0, psdWriter_1.writeUint16)(writer, 2);
    (0, psdWriter_1.writeUint16)(writer, 1);
    (0, psdWriter_1.writeUint32)(writer, annotations.length);
    for (const annotation of annotations) {
        const sound = annotation.type === 'sound';
        if (sound && !(annotation.data instanceof Uint8Array))
            throw new Error('Sound annotation data should be Uint8Array');
        if (!sound && typeof annotation.data !== 'string')
            throw new Error('Text annotation data should be string');
        const lengthOffset = writer.offset;
        (0, psdWriter_1.writeUint32)(writer, 0); // length
        (0, psdWriter_1.writeSignature)(writer, sound ? 'sndA' : 'txtA');
        (0, psdWriter_1.writeUint8)(writer, annotation.open ? 1 : 0);
        (0, psdWriter_1.writeUint8)(writer, 28);
        (0, psdWriter_1.writeUint16)(writer, 1);
        writeRect(writer, annotation.iconLocation);
        writeRect(writer, annotation.popupLocation);
        (0, psdWriter_1.writeColor)(writer, annotation.color);
        (0, psdWriter_1.writePascalString)(writer, annotation.author || '', 2);
        (0, psdWriter_1.writePascalString)(writer, annotation.name || '', 2);
        (0, psdWriter_1.writePascalString)(writer, annotation.date || '', 2);
        const contentOffset = writer.offset;
        (0, psdWriter_1.writeUint32)(writer, 0); // content length
        (0, psdWriter_1.writeSignature)(writer, sound ? 'sndM' : 'txtC');
        (0, psdWriter_1.writeUint32)(writer, 0); // data length
        const dataOffset = writer.offset;
        if (sound) {
            (0, psdWriter_1.writeBytes)(writer, annotation.data);
        }
        else {
            (0, psdWriter_1.writeUint16)(writer, 0xfeff); // unicode string indicator
            const text = annotation.data.replace(/\n/g, '\r');
            for (let i = 0; i < text.length; i++)
                (0, psdWriter_1.writeUint16)(writer, text.charCodeAt(i));
        }
        writer.view.setUint32(lengthOffset, writer.offset - lengthOffset, false);
        writer.view.setUint32(contentOffset, writer.offset - contentOffset, false);
        writer.view.setUint32(dataOffset - 4, writer.offset - dataOffset, false);
    }
});
function createLnkHandler(tag) {
    addHandler(tag, (target) => {
        const psd = target;
        if (!psd.linkedFiles || !psd.linkedFiles.length)
            return false;
        if (tag === 'lnkE' && !psd.linkedFiles.some(f => f.linkedFile))
            return false;
        return true;
    }, (reader, target, left, _psd) => {
        const psd = target;
        psd.linkedFiles = psd.linkedFiles || [];
        while (left() > 8) {
            let size = readLength64(reader);
            const startOffset = reader.offset;
            const type = (0, psdReader_1.readSignature)(reader);
            // liFD - linked file data
            // liFE - linked file external
            // liFA - linked file alias
            const version = (0, psdReader_1.readInt32)(reader);
            const id = (0, psdReader_1.readPascalString)(reader, 1);
            const name = (0, psdReader_1.readUnicodeString)(reader);
            const fileType = (0, psdReader_1.readSignature)(reader).trim(); // '    ' if empty
            const fileCreator = (0, psdReader_1.readSignature)(reader).trim(); // '    ' or '\0\0\0\0' if empty
            const dataSize = readLength64(reader);
            const hasFileOpenDescriptor = (0, psdReader_1.readUint8)(reader);
            const fileOpenDescriptor = hasFileOpenDescriptor ? (0, descriptor_1.readVersionAndDescriptor)(reader) : undefined;
            const linkedFileDescriptor = type === 'liFE' ? (0, descriptor_1.readVersionAndDescriptor)(reader) : undefined;
            const file = { id, name };
            if (fileType)
                file.type = fileType;
            if (fileCreator)
                file.creator = fileCreator;
            if (fileOpenDescriptor) {
                file.descriptor = {
                    compInfo: {
                        compID: fileOpenDescriptor.compInfo.compID,
                        originalCompID: fileOpenDescriptor.compInfo.originalCompID,
                    }
                };
            }
            if (type === 'liFE' && version > 3) {
                const year = (0, psdReader_1.readInt32)(reader);
                const month = (0, psdReader_1.readUint8)(reader);
                const day = (0, psdReader_1.readUint8)(reader);
                const hour = (0, psdReader_1.readUint8)(reader);
                const minute = (0, psdReader_1.readUint8)(reader);
                const seconds = (0, psdReader_1.readFloat64)(reader);
                const wholeSeconds = Math.floor(seconds);
                const ms = (seconds - wholeSeconds) * 1000;
                file.time = (new Date(Date.UTC(year, month, day, hour, minute, wholeSeconds, ms))).toISOString();
            }
            const fileSize = type === 'liFE' ? readLength64(reader) : 0;
            if (type === 'liFA')
                (0, psdReader_1.skipBytes)(reader, 8);
            if (type === 'liFD')
                file.data = (0, psdReader_1.readBytes)(reader, dataSize); // seems to be a typo in docs
            if (version >= 5)
                file.childDocumentID = (0, psdReader_1.readUnicodeString)(reader);
            if (version >= 6)
                file.assetModTime = (0, psdReader_1.readFloat64)(reader);
            if (version >= 7)
                file.assetLockedState = (0, psdReader_1.readUint8)(reader);
            if (type === 'liFE' && version === 2)
                file.data = (0, psdReader_1.readBytes)(reader, fileSize);
            if (reader.skipLinkedFilesData)
                file.data = undefined;
            if (tag === 'lnkE') {
                file.linkedFile = {
                    fileSize,
                    name: (linkedFileDescriptor === null || linkedFileDescriptor === void 0 ? void 0 : linkedFileDescriptor['Nm  ']) || '',
                    fullPath: (linkedFileDescriptor === null || linkedFileDescriptor === void 0 ? void 0 : linkedFileDescriptor.fullPath) || '',
                    originalPath: (linkedFileDescriptor === null || linkedFileDescriptor === void 0 ? void 0 : linkedFileDescriptor.originalPath) || '',
                    relativePath: (linkedFileDescriptor === null || linkedFileDescriptor === void 0 ? void 0 : linkedFileDescriptor.relPath) || '',
                };
            }
            psd.linkedFiles.push(file);
            while (size % 4)
                size++;
            reader.offset = startOffset + size;
        }
        (0, psdReader_1.skipBytes)(reader, left()); // ?
    }, (writer, target) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const psd = target;
        for (const file of psd.linkedFiles) {
            if ((tag === 'lnkE') !== !!file.linkedFile)
                continue;
            let version = 2;
            if (file.assetLockedState != null)
                version = 7;
            else if (file.assetModTime != null)
                version = 6;
            else if (file.childDocumentID != null)
                version = 5;
            else if (tag === 'lnkE')
                version = 3;
            writeLength64(writer, 0);
            const sizeOffset = writer.offset;
            (0, psdWriter_1.writeSignature)(writer, (tag === 'lnkE') ? 'liFE' : (file.data ? 'liFD' : 'liFA'));
            (0, psdWriter_1.writeInt32)(writer, version);
            if (!file.id || typeof file.id !== 'string' || !/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(file.id)) {
                throw new Error('Linked file ID must be in a GUID format (example: 20953ddb-9391-11ec-b4f1-c15674f50bc4)');
            }
            (0, psdWriter_1.writePascalString)(writer, file.id, 1);
            (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, file.name || '');
            (0, psdWriter_1.writeSignature)(writer, file.type ? `${file.type}    `.substring(0, 4) : '    ');
            (0, psdWriter_1.writeSignature)(writer, file.creator ? `${file.creator}    `.substring(0, 4) : '\0\0\0\0');
            writeLength64(writer, file.data ? file.data.byteLength : 0);
            if (file.descriptor && file.descriptor.compInfo) {
                const desc = {
                    compInfo: {
                        compID: file.descriptor.compInfo.compID,
                        originalCompID: file.descriptor.compInfo.originalCompID,
                    },
                };
                (0, psdWriter_1.writeUint8)(writer, 1);
                (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
            }
            else {
                (0, psdWriter_1.writeUint8)(writer, 0);
            }
            if (tag === 'lnkE') {
                const desc = {
                    descVersion: 2,
                    'Nm  ': (_b = (_a = file.linkedFile) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '',
                    fullPath: (_d = (_c = file.linkedFile) === null || _c === void 0 ? void 0 : _c.fullPath) !== null && _d !== void 0 ? _d : '',
                    originalPath: (_f = (_e = file.linkedFile) === null || _e === void 0 ? void 0 : _e.originalPath) !== null && _f !== void 0 ? _f : '',
                    relPath: (_h = (_g = file.linkedFile) === null || _g === void 0 ? void 0 : _g.relativePath) !== null && _h !== void 0 ? _h : '',
                };
                (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'ExternalFileLink', desc);
                const time = file.time ? new Date(file.time) : new Date();
                (0, psdWriter_1.writeInt32)(writer, time.getUTCFullYear());
                (0, psdWriter_1.writeUint8)(writer, time.getUTCMonth());
                (0, psdWriter_1.writeUint8)(writer, time.getUTCDate());
                (0, psdWriter_1.writeUint8)(writer, time.getUTCHours());
                (0, psdWriter_1.writeUint8)(writer, time.getUTCMinutes());
                (0, psdWriter_1.writeFloat64)(writer, time.getUTCSeconds() + time.getUTCMilliseconds() / 1000);
            }
            if (file.data) {
                (0, psdWriter_1.writeBytes)(writer, file.data);
            }
            else {
                writeLength64(writer, ((_j = file.linkedFile) === null || _j === void 0 ? void 0 : _j.fileSize) || 0);
            }
            if (version >= 5)
                (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, file.childDocumentID || '');
            if (version >= 6)
                (0, psdWriter_1.writeFloat64)(writer, file.assetModTime || 0);
            if (version >= 7)
                (0, psdWriter_1.writeUint8)(writer, file.assetLockedState || 0);
            let size = writer.offset - sizeOffset;
            writer.view.setUint32(sizeOffset - 4, size, false); // write size
            while (size % 4) {
                size++;
                (0, psdWriter_1.writeUint8)(writer, 0);
            }
        }
    });
}
createLnkHandler('lnk2');
createLnkHandler('lnkE');
addHandlerAlias('lnkD', 'lnk2');
addHandlerAlias('lnk3', 'lnk2');
addHandler('pths', hasKey('pathList'), (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader, true);
    // console.log(require('util').inspect(desc, false, 99, true));
    // if (options.throwForMissingFeatures && desc?.pathList?.length) throw new Error('non-empty pathList in `pths`');
    desc;
    target.pathList = []; // TODO: read paths
}, (writer, _target) => {
    const desc = {
        pathList: [], // TODO: write paths
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'pathsDataClass', desc);
});
addHandler('lyvr', hasKey('version'), (reader, target) => target.version = (0, psdReader_1.readUint32)(reader), (writer, target) => (0, psdWriter_1.writeUint32)(writer, target.version));
addHandler('lfxs', () => false, // TODO: not sure when we actually need to write this section
// NOTE: this might be insufficient
// target => target.effects !== undefined && (
// 	!!target.effects.dropShadow?.some(e => e.choke) ||
// 	!!target.effects.innerShadow?.some(e => e.choke) ||
// 	!!target.effects.outerGlow?.choke ||
// 	!!target.effects.innerGlow?.choke
// ),
(reader, target, left) => {
    const version = (0, psdReader_1.readUint32)(reader);
    if (version !== 0)
        throw new Error(`Invalid lfxs version`);
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.effects = (0, descriptor_1.parseEffects)(desc, !!reader.logMissingFeatures);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target, _, options) => {
    const desc = (0, descriptor_1.serializeEffects)(target.effects, !!options.logMissingFeatures, true);
    (0, psdWriter_1.writeUint32)(writer, 0); // version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
function adjustmentType(type) {
    return (target) => !!target.adjustment && target.adjustment.type === type;
}
addHandler('brit', adjustmentType('brightness/contrast'), (reader, target, left) => {
    if (!target.adjustment) { // ignore if got one from CgEd block
        target.adjustment = {
            type: 'brightness/contrast',
            brightness: (0, psdReader_1.readInt16)(reader),
            contrast: (0, psdReader_1.readInt16)(reader),
            meanValue: (0, psdReader_1.readInt16)(reader),
            labColorOnly: !!(0, psdReader_1.readUint8)(reader),
            useLegacy: true,
        };
    }
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a;
    const info = target.adjustment;
    (0, psdWriter_1.writeInt16)(writer, info.brightness || 0);
    (0, psdWriter_1.writeInt16)(writer, info.contrast || 0);
    (0, psdWriter_1.writeInt16)(writer, (_a = info.meanValue) !== null && _a !== void 0 ? _a : 127);
    (0, psdWriter_1.writeUint8)(writer, info.labColorOnly ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 1);
});
function readLevelsChannel(reader) {
    const shadowInput = (0, psdReader_1.readInt16)(reader);
    const highlightInput = (0, psdReader_1.readInt16)(reader);
    const shadowOutput = (0, psdReader_1.readInt16)(reader);
    const highlightOutput = (0, psdReader_1.readInt16)(reader);
    const midtoneInput = (0, psdReader_1.readInt16)(reader) / 100;
    return { shadowInput, highlightInput, shadowOutput, highlightOutput, midtoneInput };
}
function writeLevelsChannel(writer, channel) {
    (0, psdWriter_1.writeInt16)(writer, channel.shadowInput);
    (0, psdWriter_1.writeInt16)(writer, channel.highlightInput);
    (0, psdWriter_1.writeInt16)(writer, channel.shadowOutput);
    (0, psdWriter_1.writeInt16)(writer, channel.highlightOutput);
    (0, psdWriter_1.writeInt16)(writer, Math.round(channel.midtoneInput * 100));
}
addHandler('levl', adjustmentType('levels'), (reader, target, left) => {
    if ((0, psdReader_1.readUint16)(reader) !== 2)
        throw new Error('Invalid levl version');
    target.adjustment = Object.assign(Object.assign({}, target.adjustment), { type: 'levels', rgb: readLevelsChannel(reader), red: readLevelsChannel(reader), green: readLevelsChannel(reader), blue: readLevelsChannel(reader) });
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    const defaultChannel = {
        shadowInput: 0,
        highlightInput: 255,
        shadowOutput: 0,
        highlightOutput: 255,
        midtoneInput: 1,
    };
    (0, psdWriter_1.writeUint16)(writer, 2); // version
    writeLevelsChannel(writer, info.rgb || defaultChannel);
    writeLevelsChannel(writer, info.red || defaultChannel);
    writeLevelsChannel(writer, info.green || defaultChannel);
    writeLevelsChannel(writer, info.blue || defaultChannel);
    for (let i = 0; i < 59; i++)
        writeLevelsChannel(writer, defaultChannel);
});
function readCurveChannel(reader) {
    const nodes = (0, psdReader_1.readUint16)(reader);
    const channel = [];
    for (let j = 0; j < nodes; j++) {
        const output = (0, psdReader_1.readInt16)(reader);
        const input = (0, psdReader_1.readInt16)(reader);
        channel.push({ input, output });
    }
    return channel;
}
function writeCurveChannel(writer, channel) {
    (0, psdWriter_1.writeUint16)(writer, channel.length);
    for (const n of channel) {
        (0, psdWriter_1.writeUint16)(writer, n.output);
        (0, psdWriter_1.writeUint16)(writer, n.input);
    }
}
addHandler('curv', adjustmentType('curves'), (reader, target, left) => {
    (0, psdReader_1.readUint8)(reader);
    if ((0, psdReader_1.readUint16)(reader) !== 1)
        throw new Error('Invalid curv version');
    (0, psdReader_1.readUint16)(reader);
    const channels = (0, psdReader_1.readUint16)(reader);
    const info = { type: 'curves' };
    if (channels & 1)
        info.rgb = readCurveChannel(reader);
    if (channels & 2)
        info.red = readCurveChannel(reader);
    if (channels & 4)
        info.green = readCurveChannel(reader);
    if (channels & 8)
        info.blue = readCurveChannel(reader);
    target.adjustment = Object.assign(Object.assign({}, target.adjustment), info);
    // ignoring, duplicate information
    // checkSignature(reader, 'Crv ');
    // const cVersion = readUint16(reader);
    // readUint16(reader);
    // const channelCount = readUint16(reader);
    // for (let i = 0; i < channelCount; i++) {
    // 	const index = readUint16(reader);
    // 	const nodes = readUint16(reader);
    // 	for (let j = 0; j < nodes; j++) {
    // 		const output = readInt16(reader);
    // 		const input = readInt16(reader);
    // 	}
    // }
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    const { rgb, red, green, blue } = info;
    let channels = 0;
    let channelCount = 0;
    if (rgb && rgb.length) {
        channels |= 1;
        channelCount++;
    }
    if (red && red.length) {
        channels |= 2;
        channelCount++;
    }
    if (green && green.length) {
        channels |= 4;
        channelCount++;
    }
    if (blue && blue.length) {
        channels |= 8;
        channelCount++;
    }
    (0, psdWriter_1.writeUint8)(writer, 0);
    (0, psdWriter_1.writeUint16)(writer, 1); // version
    (0, psdWriter_1.writeUint16)(writer, 0);
    (0, psdWriter_1.writeUint16)(writer, channels);
    if (rgb && rgb.length)
        writeCurveChannel(writer, rgb);
    if (red && red.length)
        writeCurveChannel(writer, red);
    if (green && green.length)
        writeCurveChannel(writer, green);
    if (blue && blue.length)
        writeCurveChannel(writer, blue);
    (0, psdWriter_1.writeSignature)(writer, 'Crv ');
    (0, psdWriter_1.writeUint16)(writer, 4); // version
    (0, psdWriter_1.writeUint16)(writer, 0);
    (0, psdWriter_1.writeUint16)(writer, channelCount);
    if (rgb && rgb.length) {
        (0, psdWriter_1.writeUint16)(writer, 0);
        writeCurveChannel(writer, rgb);
    }
    if (red && red.length) {
        (0, psdWriter_1.writeUint16)(writer, 1);
        writeCurveChannel(writer, red);
    }
    if (green && green.length) {
        (0, psdWriter_1.writeUint16)(writer, 2);
        writeCurveChannel(writer, green);
    }
    if (blue && blue.length) {
        (0, psdWriter_1.writeUint16)(writer, 3);
        writeCurveChannel(writer, blue);
    }
});
addHandler('expA', adjustmentType('exposure'), (reader, target, left) => {
    if ((0, psdReader_1.readUint16)(reader) !== 1)
        throw new Error('Invalid expA version');
    target.adjustment = Object.assign(Object.assign({}, target.adjustment), { type: 'exposure', exposure: (0, psdReader_1.readFloat32)(reader), offset: (0, psdReader_1.readFloat32)(reader), gamma: (0, psdReader_1.readFloat32)(reader) });
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, 1); // version
    (0, psdWriter_1.writeFloat32)(writer, info.exposure);
    (0, psdWriter_1.writeFloat32)(writer, info.offset);
    (0, psdWriter_1.writeFloat32)(writer, info.gamma);
    (0, psdWriter_1.writeZeros)(writer, 2);
});
addHandler('vibA', adjustmentType('vibrance'), (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.adjustment = { type: 'vibrance' };
    if (desc.vibrance !== undefined)
        target.adjustment.vibrance = desc.vibrance;
    if (desc.Strt !== undefined)
        target.adjustment.saturation = desc.Strt;
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    const desc = {};
    if (info.vibrance !== undefined)
        desc.vibrance = info.vibrance;
    if (info.saturation !== undefined)
        desc.Strt = info.saturation;
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
function readHueChannel(reader) {
    return {
        a: (0, psdReader_1.readInt16)(reader),
        b: (0, psdReader_1.readInt16)(reader),
        c: (0, psdReader_1.readInt16)(reader),
        d: (0, psdReader_1.readInt16)(reader),
        hue: (0, psdReader_1.readInt16)(reader),
        saturation: (0, psdReader_1.readInt16)(reader),
        lightness: (0, psdReader_1.readInt16)(reader),
    };
}
function writeHueChannel(writer, channel) {
    const c = channel || {};
    (0, psdWriter_1.writeInt16)(writer, c.a || 0);
    (0, psdWriter_1.writeInt16)(writer, c.b || 0);
    (0, psdWriter_1.writeInt16)(writer, c.c || 0);
    (0, psdWriter_1.writeInt16)(writer, c.d || 0);
    (0, psdWriter_1.writeInt16)(writer, c.hue || 0);
    (0, psdWriter_1.writeInt16)(writer, c.saturation || 0);
    (0, psdWriter_1.writeInt16)(writer, c.lightness || 0);
}
addHandler('hue2', adjustmentType('hue/saturation'), (reader, target, left) => {
    if ((0, psdReader_1.readUint16)(reader) !== 2)
        throw new Error('Invalid hue2 version');
    target.adjustment = Object.assign(Object.assign({}, target.adjustment), { type: 'hue/saturation', master: readHueChannel(reader), reds: readHueChannel(reader), yellows: readHueChannel(reader), greens: readHueChannel(reader), cyans: readHueChannel(reader), blues: readHueChannel(reader), magentas: readHueChannel(reader) });
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, 2); // version
    writeHueChannel(writer, info.master);
    writeHueChannel(writer, info.reds);
    writeHueChannel(writer, info.yellows);
    writeHueChannel(writer, info.greens);
    writeHueChannel(writer, info.cyans);
    writeHueChannel(writer, info.blues);
    writeHueChannel(writer, info.magentas);
});
function readColorBalance(reader) {
    return {
        cyanRed: (0, psdReader_1.readInt16)(reader),
        magentaGreen: (0, psdReader_1.readInt16)(reader),
        yellowBlue: (0, psdReader_1.readInt16)(reader),
    };
}
function writeColorBalance(writer, value) {
    (0, psdWriter_1.writeInt16)(writer, value.cyanRed || 0);
    (0, psdWriter_1.writeInt16)(writer, value.magentaGreen || 0);
    (0, psdWriter_1.writeInt16)(writer, value.yellowBlue || 0);
}
addHandler('blnc', adjustmentType('color balance'), (reader, target, left) => {
    target.adjustment = {
        type: 'color balance',
        shadows: readColorBalance(reader),
        midtones: readColorBalance(reader),
        highlights: readColorBalance(reader),
        preserveLuminosity: !!(0, psdReader_1.readUint8)(reader),
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    writeColorBalance(writer, info.shadows || {});
    writeColorBalance(writer, info.midtones || {});
    writeColorBalance(writer, info.highlights || {});
    (0, psdWriter_1.writeUint8)(writer, info.preserveLuminosity ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 1);
});
addHandler('blwh', adjustmentType('black & white'), (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.adjustment = {
        type: 'black & white',
        reds: desc['Rd  '],
        yellows: desc.Yllw,
        greens: desc['Grn '],
        cyans: desc['Cyn '],
        blues: desc['Bl  '],
        magentas: desc.Mgnt,
        useTint: !!desc.useTint,
        presetKind: desc.bwPresetKind,
        presetFileName: desc.blackAndWhitePresetFileName,
    };
    if (desc.tintColor !== undefined)
        target.adjustment.tintColor = (0, descriptor_1.parseColor)(desc.tintColor);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    const desc = {
        'Rd  ': info.reds || 0,
        Yllw: info.yellows || 0,
        'Grn ': info.greens || 0,
        'Cyn ': info.cyans || 0,
        'Bl  ': info.blues || 0,
        Mgnt: info.magentas || 0,
        useTint: !!info.useTint,
        tintColor: (0, descriptor_1.serializeColor)(info.tintColor),
        bwPresetKind: info.presetKind || 0,
        blackAndWhitePresetFileName: info.presetFileName || '',
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler('phfl', adjustmentType('photo filter'), (reader, target, left) => {
    const version = (0, psdReader_1.readUint16)(reader);
    if (version !== 2 && version !== 3)
        throw new Error('Invalid phfl version');
    let color;
    if (version === 2) {
        color = (0, psdReader_1.readColor)(reader);
    }
    else { // version 3
        // TODO: test this, this is probably wrong
        color = {
            l: (0, psdReader_1.readInt32)(reader) / 100,
            a: (0, psdReader_1.readInt32)(reader) / 100,
            b: (0, psdReader_1.readInt32)(reader) / 100,
        };
    }
    target.adjustment = {
        type: 'photo filter',
        color,
        density: (0, psdReader_1.readUint32)(reader) / 100,
        preserveLuminosity: !!(0, psdReader_1.readUint8)(reader),
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, 2); // version
    (0, psdWriter_1.writeColor)(writer, info.color || { l: 0, a: 0, b: 0 });
    (0, psdWriter_1.writeUint32)(writer, (info.density || 0) * 100);
    (0, psdWriter_1.writeUint8)(writer, info.preserveLuminosity ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 3);
});
function readMixrChannel(reader) {
    const red = (0, psdReader_1.readInt16)(reader);
    const green = (0, psdReader_1.readInt16)(reader);
    const blue = (0, psdReader_1.readInt16)(reader);
    (0, psdReader_1.skipBytes)(reader, 2);
    const constant = (0, psdReader_1.readInt16)(reader);
    return { red, green, blue, constant };
}
function writeMixrChannel(writer, channel) {
    const c = channel || {};
    (0, psdWriter_1.writeInt16)(writer, c.red);
    (0, psdWriter_1.writeInt16)(writer, c.green);
    (0, psdWriter_1.writeInt16)(writer, c.blue);
    (0, psdWriter_1.writeZeros)(writer, 2);
    (0, psdWriter_1.writeInt16)(writer, c.constant);
}
addHandler('mixr', adjustmentType('channel mixer'), (reader, target, left) => {
    if ((0, psdReader_1.readUint16)(reader) !== 1)
        throw new Error('Invalid mixr version');
    const adjustment = target.adjustment = Object.assign(Object.assign({}, target.adjustment), { type: 'channel mixer', monochrome: !!(0, psdReader_1.readUint16)(reader) });
    if (!adjustment.monochrome) {
        adjustment.red = readMixrChannel(reader);
        adjustment.green = readMixrChannel(reader);
        adjustment.blue = readMixrChannel(reader);
    }
    adjustment.gray = readMixrChannel(reader);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, 1); // version
    (0, psdWriter_1.writeUint16)(writer, info.monochrome ? 1 : 0);
    if (info.monochrome) {
        writeMixrChannel(writer, info.gray);
        (0, psdWriter_1.writeZeros)(writer, 3 * 5 * 2);
    }
    else {
        writeMixrChannel(writer, info.red);
        writeMixrChannel(writer, info.green);
        writeMixrChannel(writer, info.blue);
        writeMixrChannel(writer, info.gray);
    }
});
const colorLookupType = (0, helpers_1.createEnum)('colorLookupType', '3dlut', {
    '3dlut': '3DLUT',
    abstractProfile: 'abstractProfile',
    deviceLinkProfile: 'deviceLinkProfile',
});
const LUTFormatType = (0, helpers_1.createEnum)('LUTFormatType', 'look', {
    look: 'LUTFormatLOOK',
    cube: 'LUTFormatCUBE',
    '3dl': 'LUTFormat3DL',
});
const colorLookupOrder = (0, helpers_1.createEnum)('colorLookupOrder', 'rgb', {
    rgb: 'rgbOrder',
    bgr: 'bgrOrder',
});
addHandler('clrL', adjustmentType('color lookup'), (reader, target, left) => {
    if ((0, psdReader_1.readUint16)(reader) !== 1)
        throw new Error('Invalid clrL version');
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.adjustment = { type: 'color lookup' };
    const info = target.adjustment;
    if (desc.lookupType !== undefined)
        info.lookupType = colorLookupType.decode(desc.lookupType);
    if (desc['Nm  '] !== undefined)
        info.name = desc['Nm  '];
    if (desc.Dthr !== undefined)
        info.dither = desc.Dthr;
    if (desc.profile !== undefined)
        info.profile = desc.profile;
    if (desc.LUTFormat !== undefined)
        info.lutFormat = LUTFormatType.decode(desc.LUTFormat);
    if (desc.dataOrder !== undefined)
        info.dataOrder = colorLookupOrder.decode(desc.dataOrder);
    if (desc.tableOrder !== undefined)
        info.tableOrder = colorLookupOrder.decode(desc.tableOrder);
    if (desc.LUT3DFileData !== undefined)
        info.lut3DFileData = desc.LUT3DFileData;
    if (desc.LUT3DFileName !== undefined)
        info.lut3DFileName = desc.LUT3DFileName;
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const info = target.adjustment;
    const desc = {};
    if (info.lookupType !== undefined)
        desc.lookupType = colorLookupType.encode(info.lookupType);
    if (info.name !== undefined)
        desc['Nm  '] = info.name;
    if (info.dither !== undefined)
        desc.Dthr = info.dither;
    if (info.profile !== undefined)
        desc.profile = info.profile;
    if (info.lutFormat !== undefined)
        desc.LUTFormat = LUTFormatType.encode(info.lutFormat);
    if (info.dataOrder !== undefined)
        desc.dataOrder = colorLookupOrder.encode(info.dataOrder);
    if (info.tableOrder !== undefined)
        desc.tableOrder = colorLookupOrder.encode(info.tableOrder);
    if (info.lut3DFileData !== undefined)
        desc.LUT3DFileData = info.lut3DFileData;
    if (info.lut3DFileName !== undefined)
        desc.LUT3DFileName = info.lut3DFileName;
    (0, psdWriter_1.writeUint16)(writer, 1); // version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler('nvrt', adjustmentType('invert'), (reader, target, left) => {
    target.adjustment = { type: 'invert' };
    (0, psdReader_1.skipBytes)(reader, left());
}, () => {
    // nothing to write here
});
addHandler('post', adjustmentType('posterize'), (reader, target, left) => {
    target.adjustment = {
        type: 'posterize',
        levels: (0, psdReader_1.readUint16)(reader),
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a;
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, (_a = info.levels) !== null && _a !== void 0 ? _a : 4);
    (0, psdWriter_1.writeZeros)(writer, 2);
});
addHandler('thrs', adjustmentType('threshold'), (reader, target, left) => {
    target.adjustment = {
        type: 'threshold',
        level: (0, psdReader_1.readUint16)(reader),
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a;
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, (_a = info.level) !== null && _a !== void 0 ? _a : 128);
    (0, psdWriter_1.writeZeros)(writer, 2);
});
const grdmColorModels = ['', '', '', 'rgb', 'hsb', '', 'lab'];
addHandler('grdm', adjustmentType('gradient map'), (reader, target, left) => {
    const version = (0, psdReader_1.readUint16)(reader);
    if (version !== 1 && version !== 3)
        throw new Error('Invalid grdm version');
    const info = {
        type: 'gradient map',
        gradientType: 'solid',
    };
    info.reverse = !!(0, psdReader_1.readUint8)(reader);
    info.dither = !!(0, psdReader_1.readUint8)(reader);
    const hasMethod = !!(0, psdReader_1.readUint8)(reader);
    reader.offset--;
    if (hasMethod) {
        const method = (0, psdReader_1.readSignature)(reader);
        info.method = descriptor_1.gradientInterpolationMethodType.decode(method);
    }
    info.name = (0, psdReader_1.readUnicodeString)(reader);
    info.colorStops = [];
    info.opacityStops = [];
    const stopsCount = (0, psdReader_1.readUint16)(reader);
    for (let i = 0; i < stopsCount; i++) {
        info.colorStops.push({
            location: (0, psdReader_1.readUint32)(reader),
            midpoint: (0, psdReader_1.readUint32)(reader) / 100,
            color: (0, psdReader_1.readColor)(reader),
        });
        (0, psdReader_1.skipBytes)(reader, 2);
    }
    const opacityStopsCount = (0, psdReader_1.readUint16)(reader);
    for (let i = 0; i < opacityStopsCount; i++) {
        info.opacityStops.push({
            location: (0, psdReader_1.readUint32)(reader),
            midpoint: (0, psdReader_1.readUint32)(reader) / 100,
            opacity: (0, psdReader_1.readUint16)(reader) / 0xff,
        });
    }
    const expansionCount = (0, psdReader_1.readUint16)(reader);
    if (expansionCount !== 2)
        throw new Error('Invalid grdm expansion count');
    const interpolation = (0, psdReader_1.readUint16)(reader);
    info.smoothness = interpolation / 4096;
    const length = (0, psdReader_1.readUint16)(reader);
    if (length !== 32)
        throw new Error('Invalid grdm length');
    info.gradientType = (0, psdReader_1.readUint16)(reader) ? 'noise' : 'solid';
    info.randomSeed = (0, psdReader_1.readUint32)(reader);
    info.addTransparency = !!(0, psdReader_1.readUint16)(reader);
    info.restrictColors = !!(0, psdReader_1.readUint16)(reader);
    info.roughness = (0, psdReader_1.readUint32)(reader) / 4096;
    info.colorModel = (grdmColorModels[(0, psdReader_1.readUint16)(reader)] || 'rgb');
    info.min = [
        (0, psdReader_1.readUint16)(reader) / 0x8000,
        (0, psdReader_1.readUint16)(reader) / 0x8000,
        (0, psdReader_1.readUint16)(reader) / 0x8000,
        (0, psdReader_1.readUint16)(reader) / 0x8000,
    ];
    info.max = [
        (0, psdReader_1.readUint16)(reader) / 0x8000,
        (0, psdReader_1.readUint16)(reader) / 0x8000,
        (0, psdReader_1.readUint16)(reader) / 0x8000,
        (0, psdReader_1.readUint16)(reader) / 0x8000,
    ];
    (0, psdReader_1.skipBytes)(reader, left());
    for (const s of info.colorStops)
        s.location /= interpolation;
    for (const s of info.opacityStops)
        s.location /= interpolation;
    target.adjustment = info;
}, (writer, target) => {
    var _a, _b, _c;
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, info.method !== undefined ? 3 : 1); // version
    (0, psdWriter_1.writeUint8)(writer, info.reverse ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, info.dither ? 1 : 0);
    if (info.method !== undefined) {
        (0, psdWriter_1.writeSignature)(writer, descriptor_1.gradientInterpolationMethodType.encode(info.method));
    }
    (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, info.name || '');
    (0, psdWriter_1.writeUint16)(writer, info.colorStops && info.colorStops.length || 0);
    const interpolation = Math.round(((_a = info.smoothness) !== null && _a !== void 0 ? _a : 1) * 4096);
    for (const s of info.colorStops || []) {
        (0, psdWriter_1.writeUint32)(writer, Math.round(s.location * interpolation));
        (0, psdWriter_1.writeUint32)(writer, Math.round(s.midpoint * 100));
        (0, psdWriter_1.writeColor)(writer, s.color);
        (0, psdWriter_1.writeZeros)(writer, 2);
    }
    (0, psdWriter_1.writeUint16)(writer, info.opacityStops && info.opacityStops.length || 0);
    for (const s of info.opacityStops || []) {
        (0, psdWriter_1.writeUint32)(writer, Math.round(s.location * interpolation));
        (0, psdWriter_1.writeUint32)(writer, Math.round(s.midpoint * 100));
        (0, psdWriter_1.writeUint16)(writer, Math.round(s.opacity * 0xff));
    }
    (0, psdWriter_1.writeUint16)(writer, 2); // expansion count
    (0, psdWriter_1.writeUint16)(writer, interpolation);
    (0, psdWriter_1.writeUint16)(writer, 32); // length
    (0, psdWriter_1.writeUint16)(writer, info.gradientType === 'noise' ? 1 : 0);
    (0, psdWriter_1.writeUint32)(writer, info.randomSeed || 0);
    (0, psdWriter_1.writeUint16)(writer, info.addTransparency ? 1 : 0);
    (0, psdWriter_1.writeUint16)(writer, info.restrictColors ? 1 : 0);
    (0, psdWriter_1.writeUint32)(writer, Math.round(((_b = info.roughness) !== null && _b !== void 0 ? _b : 1) * 4096));
    const colorModel = grdmColorModels.indexOf((_c = info.colorModel) !== null && _c !== void 0 ? _c : 'rgb');
    (0, psdWriter_1.writeUint16)(writer, colorModel === -1 ? 3 : colorModel);
    for (let i = 0; i < 4; i++)
        (0, psdWriter_1.writeUint16)(writer, Math.round((info.min && info.min[i] || 0) * 0x8000));
    for (let i = 0; i < 4; i++)
        (0, psdWriter_1.writeUint16)(writer, Math.round((info.max && info.max[i] || 0) * 0x8000));
    (0, psdWriter_1.writeZeros)(writer, 4);
});
function readSelectiveColors(reader) {
    return {
        c: (0, psdReader_1.readInt16)(reader),
        m: (0, psdReader_1.readInt16)(reader),
        y: (0, psdReader_1.readInt16)(reader),
        k: (0, psdReader_1.readInt16)(reader),
    };
}
function writeSelectiveColors(writer, cmyk) {
    const c = cmyk || {};
    (0, psdWriter_1.writeInt16)(writer, c.c);
    (0, psdWriter_1.writeInt16)(writer, c.m);
    (0, psdWriter_1.writeInt16)(writer, c.y);
    (0, psdWriter_1.writeInt16)(writer, c.k);
}
addHandler('selc', adjustmentType('selective color'), (reader, target) => {
    if ((0, psdReader_1.readUint16)(reader) !== 1)
        throw new Error('Invalid selc version');
    const mode = (0, psdReader_1.readUint16)(reader) ? 'absolute' : 'relative';
    (0, psdReader_1.skipBytes)(reader, 8);
    target.adjustment = {
        type: 'selective color',
        mode,
        reds: readSelectiveColors(reader),
        yellows: readSelectiveColors(reader),
        greens: readSelectiveColors(reader),
        cyans: readSelectiveColors(reader),
        blues: readSelectiveColors(reader),
        magentas: readSelectiveColors(reader),
        whites: readSelectiveColors(reader),
        neutrals: readSelectiveColors(reader),
        blacks: readSelectiveColors(reader),
    };
}, (writer, target) => {
    const info = target.adjustment;
    (0, psdWriter_1.writeUint16)(writer, 1); // version
    (0, psdWriter_1.writeUint16)(writer, info.mode === 'absolute' ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 8);
    writeSelectiveColors(writer, info.reds);
    writeSelectiveColors(writer, info.yellows);
    writeSelectiveColors(writer, info.greens);
    writeSelectiveColors(writer, info.cyans);
    writeSelectiveColors(writer, info.blues);
    writeSelectiveColors(writer, info.magentas);
    writeSelectiveColors(writer, info.whites);
    writeSelectiveColors(writer, info.neutrals);
    writeSelectiveColors(writer, info.blacks);
});
addHandler('CgEd', target => {
    const a = target.adjustment;
    if (!a)
        return false;
    return (a.type === 'brightness/contrast' && !a.useLegacy) ||
        ((a.type === 'levels' || a.type === 'curves' || a.type === 'exposure' || a.type === 'channel mixer' ||
            a.type === 'hue/saturation') && a.presetFileName !== undefined);
}, (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    if (desc.Vrsn !== 1)
        throw new Error('Invalid CgEd version');
    // this section can specify preset file name for other adjustment types
    if ('presetFileName' in desc) {
        target.adjustment = Object.assign(Object.assign({}, target.adjustment), { presetKind: desc.presetKind, presetFileName: desc.presetFileName });
    }
    else if ('curvesPresetFileName' in desc) {
        target.adjustment = Object.assign(Object.assign({}, target.adjustment), { presetKind: desc.curvesPresetKind, presetFileName: desc.curvesPresetFileName });
    }
    else if ('mixerPresetFileName' in desc) {
        target.adjustment = Object.assign(Object.assign({}, target.adjustment), { presetKind: desc.mixerPresetKind, presetFileName: desc.mixerPresetFileName });
    }
    else {
        target.adjustment = {
            type: 'brightness/contrast',
            brightness: desc.Brgh,
            contrast: desc.Cntr,
            meanValue: desc.means,
            useLegacy: !!desc.useLegacy,
            labColorOnly: !!desc['Lab '],
            auto: !!desc.Auto,
        };
    }
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a, _b, _c, _d;
    const info = target.adjustment;
    if (info.type === 'levels' || info.type === 'exposure' || info.type === 'hue/saturation') {
        const desc = {
            Vrsn: 1,
            presetKind: (_a = info.presetKind) !== null && _a !== void 0 ? _a : 1,
            presetFileName: info.presetFileName || '',
        };
        (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
    }
    else if (info.type === 'curves') {
        const desc = {
            Vrsn: 1,
            curvesPresetKind: (_b = info.presetKind) !== null && _b !== void 0 ? _b : 1,
            curvesPresetFileName: info.presetFileName || '',
        };
        (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
    }
    else if (info.type === 'channel mixer') {
        const desc = {
            Vrsn: 1,
            mixerPresetKind: (_c = info.presetKind) !== null && _c !== void 0 ? _c : 1,
            mixerPresetFileName: info.presetFileName || '',
        };
        (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
    }
    else if (info.type === 'brightness/contrast') {
        const desc = {
            Vrsn: 1,
            Brgh: info.brightness || 0,
            Cntr: info.contrast || 0,
            means: (_d = info.meanValue) !== null && _d !== void 0 ? _d : 127,
            'Lab ': !!info.labColorOnly,
            useLegacy: !!info.useLegacy,
            Auto: !!info.auto,
        };
        (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
    }
    else {
        throw new Error('Unhandled CgEd case');
    }
});
function getTextLayersSortedByIndex(psd) {
    const layers = [];
    function collect(layer) {
        var _a;
        if (layer.children) {
            for (const child of layer.children) {
                if (((_a = child.text) === null || _a === void 0 ? void 0 : _a.index) !== undefined) {
                    layers[child.text.index] = child;
                }
                collect(child);
            }
        }
    }
    collect(psd);
    return layers;
}
addHandler('Txt2', hasKey('engineData'), (reader, target, left, psd) => {
    const data = (0, psdReader_1.readBytes)(reader, left());
    target.engineData = (0, base64_js_1.fromByteArray)(data);
    const layersByIndex = getTextLayersSortedByIndex(psd);
    const engineData = (0, engineData_1.parseEngineData)(data);
    const engineData2 = (0, engineData2_1.decodeEngineData2)(engineData);
    const TextFrameSet = engineData2.ResourceDict.TextFrameSet;
    if (TextFrameSet) {
        for (let i = 0; i < TextFrameSet.length; i++) {
            const layer = layersByIndex[i];
            if (TextFrameSet[i].path && (layer === null || layer === void 0 ? void 0 : layer.text)) {
                layer.text.textPath = TextFrameSet[i].path;
            }
        }
    }
    // console.log(require('util').inspect(engineData, false, 99, true));
    // require('fs').writeFileSync('test_data.bin', data);
    // require('fs').writeFileSync('test_data.txt', require('util').inspect(engineData, false, 99, false), 'utf8');
    // require('fs').writeFileSync('test_data.json', JSON.stringify(engineData2, null, 2), 'utf8');
}, (writer, target) => {
    const buffer = (0, base64_js_1.toByteArray)(target.engineData);
    (0, psdWriter_1.writeBytes)(writer, buffer);
});
addHandler('FEid', hasKey('filterEffectsMasks'), (reader, target, leftBytes) => {
    const version = (0, psdReader_1.readInt32)(reader);
    if (version < 1 || version > 3)
        throw new Error(`Invalid filterEffects version ${version}`);
    target.filterEffectsMasks = [];
    while (leftBytes() > 8) {
        if ((0, psdReader_1.readUint32)(reader))
            throw new Error('filterEffects: 64 bit length is not supported');
        const length = (0, psdReader_1.readUint32)(reader);
        const end = reader.offset + length;
        const id = (0, psdReader_1.readPascalString)(reader, 1);
        const effectVersion = (0, psdReader_1.readInt32)(reader);
        if (effectVersion !== 1)
            throw new Error(`Invalid filterEffect version ${effectVersion}`);
        if ((0, psdReader_1.readUint32)(reader))
            throw new Error('filterEffect: 64 bit length is not supported');
        /*const effectLength =*/ (0, psdReader_1.readUint32)(reader);
        // const endOfEffect = reader.offset + effectLength;
        const top = (0, psdReader_1.readInt32)(reader);
        const left = (0, psdReader_1.readInt32)(reader);
        const bottom = (0, psdReader_1.readInt32)(reader);
        const right = (0, psdReader_1.readInt32)(reader);
        const depth = (0, psdReader_1.readInt32)(reader);
        const maxChannels = (0, psdReader_1.readInt32)(reader);
        const channels = [];
        // 0 -> R, 1 -> G, 2 -> B, 25 -> A
        for (let i = 0; i < (maxChannels + 2); i++) { // channels + user mask + sheet mask
            const exists = (0, psdReader_1.readInt32)(reader);
            if (exists) {
                if ((0, psdReader_1.readUint32)(reader))
                    throw new Error('filterEffect: 64 bit length is not supported');
                const channelLength = (0, psdReader_1.readUint32)(reader);
                if (!channelLength)
                    throw new Error('filterEffect: Empty channel');
                const compressionMode = (0, psdReader_1.readUint16)(reader);
                const data = (0, psdReader_1.readBytes)(reader, channelLength - 2);
                channels.push({ compressionMode, data });
            }
            else {
                channels.push(undefined);
            }
        }
        target.filterEffectsMasks.push({ id, top, left, bottom, right, depth, channels });
        if (reader.offset < end && (0, psdReader_1.readUint8)(reader)) {
            const top = (0, psdReader_1.readInt32)(reader);
            const left = (0, psdReader_1.readInt32)(reader);
            const bottom = (0, psdReader_1.readInt32)(reader);
            const right = (0, psdReader_1.readInt32)(reader);
            if ((0, psdReader_1.readUint32)(reader))
                throw new Error('filterEffect: 64 bit length is not supported');
            const extraLength = (0, psdReader_1.readUint32)(reader);
            const compressionMode = (0, psdReader_1.readUint16)(reader);
            const data = (0, psdReader_1.readBytes)(reader, extraLength - 2);
            target.filterEffectsMasks[target.filterEffectsMasks.length - 1].extra = { top, left, bottom, right, compressionMode, data };
        }
        reader.offset = end;
        let len = length;
        while (len % 4) {
            reader.offset++;
            len++;
        }
    }
}, (writer, target) => {
    var _a;
    (0, psdWriter_1.writeInt32)(writer, 3); // version
    for (const mask of target.filterEffectsMasks) {
        (0, psdWriter_1.writeUint32)(writer, 0);
        (0, psdWriter_1.writeUint32)(writer, 0);
        const lengthOffset = writer.offset;
        (0, psdWriter_1.writePascalString)(writer, mask.id, 1);
        (0, psdWriter_1.writeInt32)(writer, 1); // version
        (0, psdWriter_1.writeUint32)(writer, 0);
        (0, psdWriter_1.writeUint32)(writer, 0);
        const length2Offset = writer.offset;
        (0, psdWriter_1.writeInt32)(writer, mask.top);
        (0, psdWriter_1.writeInt32)(writer, mask.left);
        (0, psdWriter_1.writeInt32)(writer, mask.bottom);
        (0, psdWriter_1.writeInt32)(writer, mask.right);
        (0, psdWriter_1.writeInt32)(writer, mask.depth);
        const maxChannels = Math.max(0, mask.channels.length - 2);
        (0, psdWriter_1.writeInt32)(writer, maxChannels);
        for (let i = 0; i < (maxChannels + 2); i++) {
            const channel = mask.channels[i];
            (0, psdWriter_1.writeInt32)(writer, channel ? 1 : 0);
            if (channel) {
                (0, psdWriter_1.writeUint32)(writer, 0);
                (0, psdWriter_1.writeUint32)(writer, channel.data.length + 2);
                (0, psdWriter_1.writeUint16)(writer, channel.compressionMode);
                (0, psdWriter_1.writeBytes)(writer, channel.data);
            }
        }
        writer.view.setUint32(length2Offset - 4, writer.offset - length2Offset, false);
        const extra = (_a = target.filterEffectsMasks[target.filterEffectsMasks.length - 1]) === null || _a === void 0 ? void 0 : _a.extra;
        if (extra) {
            (0, psdWriter_1.writeUint8)(writer, 1);
            (0, psdWriter_1.writeInt32)(writer, extra.top);
            (0, psdWriter_1.writeInt32)(writer, extra.left);
            (0, psdWriter_1.writeInt32)(writer, extra.bottom);
            (0, psdWriter_1.writeInt32)(writer, extra.right);
            (0, psdWriter_1.writeUint32)(writer, 0);
            (0, psdWriter_1.writeUint32)(writer, extra.data.byteLength + 2);
            (0, psdWriter_1.writeUint16)(writer, extra.compressionMode);
            (0, psdWriter_1.writeBytes)(writer, extra.data);
        }
        let length = writer.offset - lengthOffset;
        writer.view.setUint32(lengthOffset - 4, length, false);
        while (length % 4) {
            (0, psdWriter_1.writeZeros)(writer, 1);
            length++;
        }
    }
});
addHandlerAlias('FXid', 'FEid');
addHandler('FMsk', hasKey('filterMask'), (reader, target) => {
    target.filterMask = {
        colorSpace: (0, psdReader_1.readColor)(reader),
        opacity: (0, psdReader_1.readUint16)(reader) / 0xff,
    };
}, (writer, target) => {
    var _a;
    (0, psdWriter_1.writeColor)(writer, target.filterMask.colorSpace);
    (0, psdWriter_1.writeUint16)(writer, (0, helpers_1.clamp)((_a = target.filterMask.opacity) !== null && _a !== void 0 ? _a : 1, 0, 1) * 0xff);
});
addHandler('artd', // document-wide artboard info
// document-wide artboard info
target => target.artboards !== undefined, (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.artboards = {
        count: desc['Cnt '],
        autoExpandOffset: { horizontal: desc.autoExpandOffset.Hrzn, vertical: desc.autoExpandOffset.Vrtc },
        origin: { horizontal: desc.origin.Hrzn, vertical: desc.origin.Vrtc },
        autoExpandEnabled: desc.autoExpandEnabled,
        autoNestEnabled: desc.autoNestEnabled,
        autoPositionEnabled: desc.autoPositionEnabled,
        shrinkwrapOnSaveEnabled: !!desc.shrinkwrapOnSaveEnabled,
        docDefaultNewArtboardBackgroundColor: (0, descriptor_1.parseColor)(desc.docDefaultNewArtboardBackgroundColor),
        docDefaultNewArtboardBackgroundType: desc.docDefaultNewArtboardBackgroundType,
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    var _a, _b, _c, _d, _e;
    const artb = target.artboards;
    const desc = {
        'Cnt ': artb.count,
        autoExpandOffset: artb.autoExpandOffset ? { Hrzn: artb.autoExpandOffset.horizontal, Vrtc: artb.autoExpandOffset.vertical } : { Hrzn: 0, Vrtc: 0 },
        origin: artb.origin ? { Hrzn: artb.origin.horizontal, Vrtc: artb.origin.vertical } : { Hrzn: 0, Vrtc: 0 },
        autoExpandEnabled: (_a = artb.autoExpandEnabled) !== null && _a !== void 0 ? _a : true,
        autoNestEnabled: (_b = artb.autoNestEnabled) !== null && _b !== void 0 ? _b : true,
        autoPositionEnabled: (_c = artb.autoPositionEnabled) !== null && _c !== void 0 ? _c : true,
        shrinkwrapOnSaveEnabled: (_d = artb.shrinkwrapOnSaveEnabled) !== null && _d !== void 0 ? _d : true,
        docDefaultNewArtboardBackgroundColor: (0, descriptor_1.serializeColor)(artb.docDefaultNewArtboardBackgroundColor),
        docDefaultNewArtboardBackgroundType: (_e = artb.docDefaultNewArtboardBackgroundType) !== null && _e !== void 0 ? _e : 1,
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc, 'artd');
});
function hasMultiEffects(effects) {
    return Object.keys(effects).map(key => effects[key]).some(v => Array.isArray(v) && v.length > 1);
}
addHandler('lfx2', target => target.effects !== undefined && !hasMultiEffects(target.effects), (reader, target, left) => {
    const version = (0, psdReader_1.readUint32)(reader);
    if (version !== 0)
        throw new Error(`Invalid lfx2 version`);
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log('READ', require('util').inspect(desc, false, 99, true));
    // TODO: don't discard if we got it from lmfx
    // discard if read in 'lrFX' section
    target.effects = (0, descriptor_1.parseEffects)(desc, !!reader.logMissingFeatures);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target, _, options) => {
    const desc = (0, descriptor_1.serializeEffects)(target.effects, !!options.logMissingFeatures, true);
    // console.log('WRITE', require('util').inspect(desc, false, 99, true));
    (0, psdWriter_1.writeUint32)(writer, 0); // version
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler('cinf', hasKey('compositorUsed'), (reader, target, left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log(require('util').inspect(desc, false, 99, true));
    function enumValue(desc) {
        return desc.split('.')[1];
    }
    target.compositorUsed = {
        description: desc.description,
        reason: desc.reason,
        engine: enumValue(desc.Engn),
    };
    if (desc.Vrsn)
        target.compositorUsed.version = desc.Vrsn;
    if (desc.psVersion)
        target.compositorUsed.photoshopVersion = desc.psVersion;
    if (desc.enableCompCore)
        target.compositorUsed.enableCompCore = enumValue(desc.enableCompCore);
    if (desc.enableCompCoreGPU)
        target.compositorUsed.enableCompCoreGPU = enumValue(desc.enableCompCoreGPU);
    if (desc.enableCompCoreThreads)
        target.compositorUsed.enableCompCoreThreads = enumValue(desc.enableCompCoreThreads);
    if (desc.compCoreSupport)
        target.compositorUsed.compCoreSupport = enumValue(desc.compCoreSupport);
    if (desc.compCoreGPUSupport)
        target.compositorUsed.compCoreGPUSupport = enumValue(desc.compCoreGPUSupport);
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const cinf = target.compositorUsed;
    const desc = {
        Vrsn: cinf.version || { major: 1, minor: 0, fix: 0 },
    };
    if (cinf.photoshopVersion)
        desc.psVersion = cinf.photoshopVersion;
    desc.description = cinf.description;
    desc.reason = cinf.reason;
    desc.Engn = `Engn.${cinf.engine}`;
    if (cinf.enableCompCore)
        desc.enableCompCore = `enable.${cinf.enableCompCore}`;
    if (cinf.enableCompCoreGPU)
        desc.enableCompCoreGPU = `enable.${cinf.enableCompCoreGPU}`;
    if (cinf.enableCompCoreThreads)
        desc.enableCompCoreThreads = `enable.${cinf.enableCompCoreThreads}`;
    if (cinf.compCoreSupport)
        desc.compCoreSupport = `reason.${cinf.compCoreSupport}`;
    if (cinf.compCoreGPUSupport)
        desc.compCoreGPUSupport = `reason.${cinf.compCoreGPUSupport}`;
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
// extension settings ?, ignore it
addHandler('extn', target => target._extn !== undefined, (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log(require('util').inspect(desc, false, 99, true));
    if (helpers_1.MOCK_HANDLERS)
        target._extn = desc;
}, (writer, target) => {
    // TODO: need to add correct types for desc fields (resources/src.psd)
    if (helpers_1.MOCK_HANDLERS)
        (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', target._extn);
});
addHandler('iOpa', hasKey('fillOpacity'), (reader, target) => {
    target.fillOpacity = (0, psdReader_1.readUint8)(reader) / 0xff;
    (0, psdReader_1.skipBytes)(reader, 3);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.fillOpacity * 0xff);
    (0, psdWriter_1.writeZeros)(writer, 3);
});
addHandler('brst', hasKey('channelBlendingRestrictions'), (reader, target, left) => {
    target.channelBlendingRestrictions = [];
    while (left() > 4) {
        target.channelBlendingRestrictions.push((0, psdReader_1.readInt32)(reader));
    }
}, (writer, target) => {
    for (const channel of target.channelBlendingRestrictions) {
        (0, psdWriter_1.writeInt32)(writer, channel);
    }
});
addHandler('tsly', hasKey('transparencyShapesLayer'), (reader, target) => {
    target.transparencyShapesLayer = !!(0, psdReader_1.readUint8)(reader);
    (0, psdReader_1.skipBytes)(reader, 3);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.transparencyShapesLayer ? 1 : 0);
    (0, psdWriter_1.writeZeros)(writer, 3);
});

},{"./descriptor":4,"./effectsHelpers":5,"./engineData":6,"./engineData2":7,"./helpers":8,"./psdReader":13,"./psdWriter":14,"./text":15,"base64-js":17}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCsh = readCsh;
const additionalInfo_1 = require("./additionalInfo");
const psdReader_1 = require("./psdReader");
function readCsh(buffer) {
    const reader = (0, psdReader_1.createReader)(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const csh = { shapes: [] };
    (0, psdReader_1.checkSignature)(reader, 'cush');
    if ((0, psdReader_1.readUint32)(reader) !== 2)
        throw new Error('Invalid version');
    const count = (0, psdReader_1.readUint32)(reader);
    for (let i = 0; i < count; i++) {
        const name = (0, psdReader_1.readUnicodeString)(reader);
        while (reader.offset % 4)
            reader.offset++; // pad to 4byte bounds
        if ((0, psdReader_1.readUint32)(reader) !== 1)
            throw new Error('Invalid shape version');
        const size = (0, psdReader_1.readUint32)(reader);
        const end = reader.offset + size;
        const id = (0, psdReader_1.readPascalString)(reader, 1);
        // this might not be correct ???
        const y1 = (0, psdReader_1.readUint32)(reader);
        const x1 = (0, psdReader_1.readUint32)(reader);
        const y2 = (0, psdReader_1.readUint32)(reader);
        const x2 = (0, psdReader_1.readUint32)(reader);
        const width = x2 - x1;
        const height = y2 - y1;
        const mask = { paths: [] };
        (0, additionalInfo_1.readVectorMask)(reader, mask, width, height, end - reader.offset);
        csh.shapes.push(Object.assign({ name, id, width, height }, mask));
        reader.offset = end;
    }
    return csh;
}

},{"./additionalInfo":2,"./psdReader":13}],4:[function(require,module,exports){
"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntC = exports.IntE = exports.Drct = exports.WndM = exports.CntE = exports.FlCl = exports.ExtR = exports.ExtT = exports.DfsM = exports.blurType = exports.Lns = exports.MztT = exports.Chnl = exports.Dstr = exports.ZZTy = exports.Wvtp = exports.SphM = exports.RplS = exports.Cnvr = exports.UndA = exports.DspM = exports.SmBQ = exports.SmBM = exports.BlrQ = exports.BlrM = exports.strokeStyleLineAlignment = exports.strokeStyleLineJoinType = exports.strokeStyleLineCapType = exports.ESliceBGColorType = exports.ESliceOrigin = exports.ESliceVertAlign = exports.ESliceHorzAlign = exports.ESliceType = exports.FrFl = exports.FStl = exports.ClrS = exports.gradientInterpolationMethodType = exports.stdTrackID = exports.animInterpStyleEnum = exports.GrdT = exports.IGSr = exports.BETE = exports.BESs = exports.bvlT = exports.BESl = exports.BlnM = exports.warpStyle = exports.Annt = exports.Ornt = exports.textGridding = void 0;
exports.presetKindType = exports.prjM = exports.FlMd = void 0;
exports.setLogErrors = setLogErrors;
exports.readAsciiStringOrClassId = readAsciiStringOrClassId;
exports.readDescriptorStructure = readDescriptorStructure;
exports.writeDescriptorStructure = writeDescriptorStructure;
exports.readVersionAndDescriptor = readVersionAndDescriptor;
exports.writeVersionAndDescriptor = writeVersionAndDescriptor;
exports.horzVrtcToXY = horzVrtcToXY;
exports.xyToHorzVrtc = xyToHorzVrtc;
exports.descBoundsToBounds = descBoundsToBounds;
exports.boundsToDescBounds = boundsToDescBounds;
exports.serializeEffects = serializeEffects;
exports.parseEffects = parseEffects;
exports.parseTrackList = parseTrackList;
exports.serializeTrackList = serializeTrackList;
exports.parseVectorContent = parseVectorContent;
exports.serializeVectorContent = serializeVectorContent;
exports.parseColor = parseColor;
exports.serializeColor = serializeColor;
exports.parseAngle = parseAngle;
exports.parsePercent = parsePercent;
exports.parsePercentOrAngle = parsePercentOrAngle;
exports.parseUnits = parseUnits;
exports.parseUnitsOrNumber = parseUnitsOrNumber;
exports.parseUnitsToNumber = parseUnitsToNumber;
exports.unitsAngle = unitsAngle;
exports.unitsPercent = unitsPercent;
exports.unitsPercentF = unitsPercentF;
exports.unitsValue = unitsValue;
exports.frac = frac;
const helpers_1 = require("./helpers");
const psdReader_1 = require("./psdReader");
const psdWriter_1 = require("./psdWriter");
function revMap(map) {
    const result = {};
    Object.keys(map).forEach(key => result[map[key]] = key);
    return result;
}
const unitsMap = {
    '#Ang': 'Angle',
    '#Rsl': 'Density',
    '#Rlt': 'Distance',
    '#Nne': 'None',
    '#Prc': 'Percent',
    '#Pxl': 'Pixels',
    '#Mlm': 'Millimeters',
    '#Pnt': 'Points',
    'RrPi': 'Picas',
    'RrIn': 'Inches',
    'RrCm': 'Centimeters',
};
const unitsMapRev = revMap(unitsMap);
let logErrors = false;
function setLogErrors(value) {
    logErrors = value;
}
function makeType(name, classID) {
    return { name, classID };
}
const nullType = makeType('', 'null');
const USE_CHINESE = false; // Testing
const fieldToExtType = {
    strokeStyleContent: makeType('', 'solidColorLayer'),
    printProofSetup: makeType(USE_CHINESE ? '校样设置' : 'Proof Setup', 'proofSetup'),
    Grad: makeType(USE_CHINESE ? '渐变' : 'Gradient', 'Grdn'),
    Trnf: makeType(USE_CHINESE ? '变换' : 'Transform', 'Trnf'),
    patternFill: makeType('', 'patternFill'),
    ebbl: makeType('', 'ebbl'),
    SoFi: makeType('', 'SoFi'),
    GrFl: makeType('', 'GrFl'),
    sdwC: makeType('', 'RGBC'),
    hglC: makeType('', 'RGBC'),
    'Clr ': makeType('', 'RGBC'),
    'tintColor': makeType('', 'RGBC'),
    Ofst: makeType('', 'Pnt '),
    ChFX: makeType('', 'ChFX'),
    MpgS: makeType('', 'ShpC'),
    DrSh: makeType('', 'DrSh'),
    IrSh: makeType('', 'IrSh'),
    OrGl: makeType('', 'OrGl'),
    IrGl: makeType('', 'IrGl'),
    TrnS: makeType('', 'ShpC'),
    Ptrn: makeType('', 'Ptrn'),
    FrFX: makeType('', 'FrFX'),
    phase: makeType('', 'Pnt '),
    frameStep: nullType,
    duration: nullType,
    workInTime: nullType,
    workOutTime: nullType,
    audioClipGroupList: nullType,
    bounds: makeType('', 'Rctn'),
    customEnvelopeWarp: makeType('', 'customEnvelopeWarp'),
    warp: makeType('', 'warp'),
    'Sz  ': makeType('', 'Pnt '),
    origin: makeType('', 'Pnt '),
    autoExpandOffset: makeType('', 'Pnt '),
    keyOriginShapeBBox: makeType('', 'unitRect'),
    Vrsn: nullType,
    psVersion: nullType,
    docDefaultNewArtboardBackgroundColor: makeType('', 'RGBC'),
    artboardRect: makeType('', 'classFloatRect'),
    keyOriginRRectRadii: makeType('', 'radii'),
    keyOriginBoxCorners: nullType,
    rectangleCornerA: makeType('', 'Pnt '),
    rectangleCornerB: makeType('', 'Pnt '),
    rectangleCornerC: makeType('', 'Pnt '),
    rectangleCornerD: makeType('', 'Pnt '),
    compInfo: nullType,
    quiltWarp: makeType('', 'quiltWarp'),
    generatorSettings: nullType,
    crema: nullType,
    FrIn: nullType,
    blendOptions: nullType,
    FXRf: nullType,
    Lefx: nullType,
    time: nullType,
    animKey: nullType,
    timeScope: nullType,
    inTime: nullType,
    outTime: nullType,
    sheetStyle: nullType,
    translation: nullType,
    Skew: nullType,
    boundingBox: makeType('', 'boundingBox'),
    'Lnk ': makeType('', 'ExternalFileLink'),
    frameReader: makeType('', 'FrameReader'),
    effectParams: makeType('', 'motionTrackEffectParams'),
    Impr: makeType('None', 'none'),
    Anch: makeType('', 'Pnt '),
    'Fwd ': makeType('', 'Pnt '),
    'Bwd ': makeType('', 'Pnt '),
    FlrC: makeType('', 'Pnt '),
    meshBoundaryPath: makeType('', 'pathClass'),
    filterFX: makeType('', 'filterFXStyle'),
    Fltr: makeType('', 'rigidTransform'),
    FrgC: makeType('', 'RGBC'),
    BckC: makeType('', 'RGBC'),
    sdwM: makeType('Parameters', 'adaptCorrectTones'),
    hglM: makeType('Parameters', 'adaptCorrectTones'),
    customShape: makeType('', 'customShape'),
    origFXRefPoint: nullType,
    FXRefPoint: nullType,
    ClMg: makeType('', 'ClMg'),
};
const fieldToArrayExtType = {
    'Crv ': makeType('', 'CrPt'),
    Clrs: makeType('', 'Clrt'),
    Trns: makeType('', 'TrnS'),
    keyDescriptorList: nullType,
    solidFillMulti: makeType('', 'SoFi'),
    gradientFillMulti: makeType('', 'GrFl'),
    dropShadowMulti: makeType('', 'DrSh'),
    innerShadowMulti: makeType('', 'IrSh'),
    frameFXMulti: makeType('', 'FrFX'),
    FrIn: nullType,
    FSts: nullType,
    LaSt: nullType,
    sheetTimelineOptions: nullType,
    trackList: makeType('', 'animationTrack'),
    globalTrackList: makeType('', 'animationTrack'),
    keyList: nullType,
    audioClipGroupList: nullType,
    audioClipList: nullType,
    countObjectList: makeType('', 'countObject'),
    countGroupList: makeType('', 'countGroup'),
    slices: makeType('', 'slice'),
    'Pts ': makeType('', 'Pthp'),
    SbpL: makeType('', 'SbpL'),
    pathComponents: makeType('', 'PaCm'),
    filterFXList: makeType('', 'filterFX'),
    puppetShapeList: makeType('', 'puppetShape'),
    channelDenoise: makeType('', 'channelDenoiseParams'),
    ShrP: makeType('', 'Pnt '),
    layerSettings: nullType,
    list: nullType,
    Adjs: makeType('', 'CrvA'),
};
const typeToField = {
    'TEXT': [
        'Txt ', 'printerName', 'Nm  ', 'Idnt', 'blackAndWhitePresetFileName', 'LUT3DFileName',
        'presetFileName', 'curvesPresetFileName', 'mixerPresetFileName', 'placed', 'description', 'reason',
        'artboardPresetName', 'json', 'clipID', 'relPath', 'fullPath', 'mediaDescriptor', 'Msge',
        'altTag', 'url', 'cellText', 'preset', 'KnNm', 'FPth', 'comment', 'originalPath',
    ],
    'tdta': [
        'EngineData', 'LUT3DFileData', 'indexArray', 'originalVertexArray', 'deformedVertexArray',
        'LqMe',
    ],
    'long': [
        'TextIndex', 'RndS', 'Mdpn', 'Smth', 'Lctn', 'strokeStyleVersion', 'LaID', 'Vrsn', 'Cnt ',
        'Brgh', 'Cntr', 'means', 'vibrance', 'Strt', 'bwPresetKind', 'comp', 'compID', 'originalCompID',
        'curvesPresetKind', 'mixerPresetKind', 'uOrder', 'vOrder', 'PgNm', 'totalPages', 'Crop',
        'numerator', 'denominator', 'frameCount', 'Annt', 'keyOriginType', 'unitValueQuadVersion',
        'keyOriginIndex', 'major', 'minor', 'fix', 'docDefaultNewArtboardBackgroundType', 'artboardBackgroundType',
        'numModifyingFX', 'deformNumRows', 'deformNumCols', 'FrID', 'FrDl', 'FsID', 'LCnt', 'AFrm', 'AFSt',
        'numBefore', 'numAfter', 'Spcn', 'minOpacity', 'maxOpacity', 'BlnM', 'sheetID', 'gblA', 'globalAltitude',
        'descVersion', 'frameReaderType', 'LyrI', 'zoomOrigin', 'fontSize', 'Rds ', 'sliceID',
        'topOutset', 'leftOutset', 'bottomOutset', 'rightOutset', 'filterID', 'meshQuality',
        'meshExpansion', 'meshRigidity', 'VrsM', 'VrsN', 'NmbG', 'WLMn', 'WLMx', 'AmMn', 'AmMx', 'SclH', 'SclV',
        'Lvl ', 'TlNm', 'TlOf', 'FlRs', 'Thsh', 'ShrS', 'ShrE', 'FlRs', 'Vrnc', 'Strg', 'ExtS', 'ExtD',
        'HrzS', 'VrtS', 'NmbR', 'EdgF', 'Ang1', 'Ang2', 'Ang3', 'Ang4', 'lastAppliedComp', 'capturedInfo',
    ],
    'enum': [
        'textGridding', 'Ornt', 'warpStyle', 'warpRotate', 'Inte', 'Bltn', 'ClrS', 'BlrQ',
        'bvlT', 'bvlS', 'bvlD', 'Md  ', 'glwS', 'GrdF', 'GlwT', 'RplS', 'BlrM', 'SmBM',
        'strokeStyleLineCapType', 'strokeStyleLineJoinType', 'strokeStyleLineAlignment',
        'strokeStyleBlendMode', 'PntT', 'Styl', 'lookupType', 'LUTFormat', 'dataOrder',
        'tableOrder', 'enableCompCore', 'enableCompCoreGPU', 'compCoreSupport', 'compCoreGPUSupport', 'Engn',
        'enableCompCoreThreads', 'gs99', 'FrDs', 'trackID', 'animInterpStyle', 'horzAlign',
        'vertAlign', 'bgColorType', 'shapeOperation', 'UndA', 'Wvtp', 'Drct', 'WndM', 'Edg ', 'FlCl', 'IntE',
        'IntC', 'Cnvr', 'Fl  ', 'Dstr', 'MztT', 'Lns ', 'ExtT', 'DspM', 'ExtR', 'ZZTy', 'SphM', 'SmBQ', 'placedLayerOCIOConversion', 'gradientsInterpolationMethod',
    ],
    'bool': [
        'PstS', 'printSixteenBit', 'masterFXSwitch', 'enab', 'uglg', 'antialiasGloss',
        'useShape', 'useTexture', 'uglg', 'antialiasGloss', 'useShape', 'Vsbl',
        'useTexture', 'Algn', 'Rvrs', 'Dthr', 'Invr', 'VctC', 'ShTr', 'layerConceals',
        'strokeEnabled', 'fillEnabled', 'strokeStyleScaleLock', 'strokeStyleStrokeAdjust',
        'hardProof', 'MpBl', 'paperWhite', 'useLegacy', 'Auto', 'Lab ', 'useTint', 'keyShapeInvalidated',
        'autoExpandEnabled', 'autoNestEnabled', 'autoPositionEnabled', 'shrinkwrapOnSaveEnabled',
        'present', 'showInDialog', 'overprint', 'sheetDisclosed', 'lightsDisclosed', 'meshesDisclosed',
        'materialsDisclosed', 'hasMotion', 'muted', 'Effc', 'selected', 'autoScope', 'fillCanvas',
        'cellTextIsHTML', 'Smoo', 'Clsp', 'validAtPosition', 'rigidType', 'hasoptions', 'filterMaskEnable',
        'filterMaskLinked', 'filterMaskExtendWithWhite', 'removeJPEGArtifact', 'Mnch', 'ExtF', 'ExtM',
        'moreAccurate', 'GpuY', 'LIWy', 'Cnty',
    ],
    'doub': [
        'warpValue', 'warpPerspective', 'warpPerspectiveOther', 'Intr', 'Wdth', 'Hght',
        'strokeStyleMiterLimit', 'strokeStyleResolution', 'layerTime', 'keyOriginResolution',
        'xx', 'xy', 'yx', 'yy', 'tx', 'ty', 'FrGA', 'frameRate', 'audioLevel', 'rotation',
        'X   ', 'Y   ', 'redFloat', 'greenFloat', 'blueFloat', 'imageResolution',
        'PuX0', 'PuX1', 'PuX2', 'PuX3', 'PuY0', 'PuY1', 'PuY2', 'PuY3'
    ],
    'UntF': [
        'sdwO', 'hglO', 'lagl', 'Lald', 'srgR', 'blur', 'Sftn', 'Opct', 'Dstn', 'Angl',
        'Ckmt', 'Nose', 'Inpr', 'ShdN', 'strokeStyleLineWidth', 'strokeStyleLineDashOffset',
        'strokeStyleOpacity', 'H   ', 'Top ', 'Left', 'Btom', 'Rght', 'Rslt',
        'topRight', 'topLeft', 'bottomLeft', 'bottomRight', 'ClNs', 'Shrp',
    ],
    'VlLs': [
        'Crv ', 'Clrs', 'Mnm ', 'Mxm ', 'Trns', 'pathList', 'strokeStyleLineDashSet', 'FrLs', 'slices',
        'LaSt', 'Trnf', 'nonAffineTransform', 'keyDescriptorList', 'guideIndeces', 'gradientFillMulti',
        'solidFillMulti', 'frameFXMulti', 'innerShadowMulti', 'dropShadowMulti', 'FrIn', 'FSts', 'FsFr',
        'sheetTimelineOptions', 'audioClipList', 'trackList', 'globalTrackList', 'keyList', 'audioClipList',
        'warpValues', 'selectedPin', 'Pts ', 'SbpL', 'pathComponents', 'pinOffsets', 'posFinalPins',
        'pinVertexIndices', 'PinP', 'PnRt', 'PnOv', 'PnDp', 'filterFXList', 'puppetShapeList', 'ShrP',
        'channelDenoise', 'Mtrx', 'layerSettings', 'list', 'compList', 'Adjs',
    ],
    'ObAr': ['meshPoints', 'quiltSliceX', 'quiltSliceY'],
    'obj ': ['null', 'Chnl'],
    'Pth ': ['DspF'],
};
const channels = [
    'Rd  ', 'Grn ', 'Bl  ', 'Yllw', 'Ylw ', 'Cyn ', 'Mgnt', 'Blck', 'Gry ', 'Lmnc', 'A   ', 'B   ',
];
const fieldToArrayType = {
    'Mnm ': 'long',
    'Mxm ': 'long',
    FrLs: 'long',
    strokeStyleLineDashSet: 'UntF',
    Trnf: 'doub',
    nonAffineTransform: 'doub',
    keyDescriptorList: 'Objc',
    gradientFillMulti: 'Objc',
    solidFillMulti: 'Objc',
    frameFXMulti: 'Objc',
    innerShadowMulti: 'Objc',
    dropShadowMulti: 'Objc',
    LaSt: 'Objc',
    FrIn: 'Objc',
    FSts: 'Objc',
    FsFr: 'long',
    blendOptions: 'Objc',
    sheetTimelineOptions: 'Objc',
    keyList: 'Objc',
    warpValues: 'doub',
    selectedPin: 'long',
    'Pts ': 'Objc',
    SbpL: 'Objc',
    pathComponents: 'Objc',
    pinOffsets: 'doub',
    posFinalPins: 'doub',
    pinVertexIndices: 'long',
    PinP: 'doub',
    PnRt: 'long',
    PnOv: 'bool',
    PnDp: 'doub',
    filterFXList: 'Objc',
    puppetShapeList: 'Objc',
    ShrP: 'Objc',
    channelDenoise: 'Objc',
    Mtrx: 'long',
    compList: 'long',
    Chnl: 'enum',
};
const fieldToType = {};
for (const type of Object.keys(typeToField)) {
    for (const field of typeToField[type]) {
        fieldToType[field] = type;
    }
}
for (const field of Object.keys(fieldToExtType)) {
    if (!fieldToType[field])
        fieldToType[field] = 'Objc';
}
for (const field of Object.keys(fieldToArrayExtType)) {
    fieldToArrayType[field] = 'Objc';
}
function getTypeByKey(key, value, root, parent) {
    if (key === 'presetKind') {
        return typeof value === 'string' ? 'enum' : 'long';
    }
    if (key === 'null' && root === 'slices') {
        return 'TEXT';
    }
    else if (key === 'groupID') {
        return root === 'slices' ? 'long' : 'TEXT';
    }
    else if (key === 'Sz  ') {
        return ('Wdth' in value) ? 'Objc' : (('units' in value) ? 'UntF' : 'doub');
    }
    else if (key === 'Type') {
        return typeof value === 'string' ? 'enum' : 'long';
    }
    else if (key === 'AntA') {
        return typeof value === 'string' ? 'enum' : 'bool';
    }
    else if ((key === 'Hrzn' || key === 'Vrtc') && (parent.Type === 'keyType.Pstn' || parent._classID === 'Ofst')) {
        return 'long';
    }
    else if (key === 'Hrzn' || key === 'Vrtc' || key === 'Top ' || key === 'Left' || key === 'Btom' || key === 'Rght') {
        if (root === 'slices')
            return 'long';
        return typeof value === 'number' ? 'doub' : 'UntF';
    }
    else if (key === 'Vrsn') {
        return typeof value === 'number' ? 'long' : 'Objc';
    }
    else if (key === 'Rd  ' || key === 'Grn ' || key === 'Bl  ') {
        return root === 'artd' ? 'long' : 'doub';
    }
    else if (key === 'Trnf') {
        return Array.isArray(value) ? 'VlLs' : 'Objc';
    }
    else {
        return fieldToType[key];
    }
}
function readAsciiStringOrClassId(reader) {
    const length = (0, psdReader_1.readInt32)(reader);
    return (0, psdReader_1.readAsciiString)(reader, length || 4);
}
function writeAsciiStringOrClassId(writer, value) {
    if (value.length === 4 && value !== 'warp' && value !== 'time' && value !== 'hold' && value !== 'list') {
        // write classId
        (0, psdWriter_1.writeInt32)(writer, 0);
        (0, psdWriter_1.writeSignature)(writer, value);
    }
    else {
        // write ascii string
        (0, psdWriter_1.writeInt32)(writer, value.length);
        for (let i = 0; i < value.length; i++) {
            (0, psdWriter_1.writeUint8)(writer, value.charCodeAt(i));
        }
    }
}
function readDescriptorStructure(reader, includeClass) {
    const struct = readClassStructure(reader);
    const object = includeClass ? { _name: struct.name, _classID: struct.classID } : {};
    // console.log('>> ', struct);
    const itemsCount = (0, psdReader_1.readUint32)(reader);
    for (let i = 0; i < itemsCount; i++) {
        const key = readAsciiStringOrClassId(reader);
        const type = (0, psdReader_1.readSignature)(reader);
        // console.log(`> '${key}' '${type}'`);
        const data = readOSType(reader, type, includeClass);
        // if (!getTypeByKey(key, data)) console.log(`> '${key}' '${type}'`, data);
        object[key] = data;
    }
    return object;
}
function writeDescriptorStructure(writer, name, classId, value, root) {
    if (logErrors && !classId)
        console.log('Missing classId for: ', name, classId, value);
    // write class structure
    (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, name);
    writeAsciiStringOrClassId(writer, classId);
    const keys = Object.keys(value);
    let keyCount = keys.length;
    if ('_name' in value)
        keyCount--;
    if ('_classID' in value)
        keyCount--;
    (0, psdWriter_1.writeUint32)(writer, keyCount);
    for (const key of keys) {
        if (key === '_name' || key === '_classID')
            continue;
        let type = getTypeByKey(key, value[key], root, value);
        let extType = fieldToExtType[key];
        if (key === 'bounds' && root === 'text') {
            extType = makeType('', 'bounds');
        }
        else if (key === 'origin') {
            type = root === 'slices' ? 'enum' : 'Objc';
        }
        else if ((key === 'Cyn ' || key === 'Mgnt' || key === 'Ylw ' || key === 'Blck') && value._classID === 'CMYC') {
            type = 'doub';
        }
        else if (/^PN[a-z][a-z]$/.test(key)) {
            type = 'TEXT';
        }
        else if (/^PT[a-z][a-z]$/.test(key)) {
            type = 'long';
        }
        else if (/^PF[a-z][a-z]$/.test(key)) {
            type = 'doub';
        }
        else if ((key === 'Rds ' || key === 'Thsh') && typeof value[key] === 'number' && value._classID === 'SmrB') {
            type = 'doub';
        }
        else if (key === 'ClSz' || key === 'Rds ' || key === 'Amnt') {
            type = typeof value[key] === 'number' ? 'long' : 'UntF';
        }
        else if ((key === 'sdwM' || key === 'hglM') && typeof value[key] === 'string') {
            type = 'enum';
        }
        else if (key === 'blur' && typeof value[key] === 'string') {
            type = 'enum';
        }
        else if (key === 'Hght' && typeof value[key] === 'number' && value._classID === 'Embs') {
            type = 'long';
        }
        else if (key === 'Angl' && typeof value[key] === 'number' && (value._classID === 'Embs' || value._classID === 'smartSharpen' || value._classID === 'Twrl' || value._classID === 'MtnB')) {
            type = 'long';
        }
        else if (key === 'Angl' && typeof value[key] === 'number') {
            type = 'doub'; // ???
        }
        else if (key === 'bounds' && root === 'slices') {
            type = 'Objc';
            extType = makeType('', 'Rct1');
        }
        else if (key === 'Scl ') {
            if (typeof value[key] === 'object' && 'Hrzn' in value[key]) {
                type = 'Objc';
                extType = nullType;
            }
            else if (typeof value[key] === 'number') {
                type = 'long';
            }
            else {
                type = 'UntF';
            }
        }
        else if (key === 'audioClipGroupList' && keys.length === 1) {
            type = 'VlLs';
        }
        else if ((key === 'Strt' || key === 'Brgh') && 'H   ' in value) {
            type = 'doub';
        }
        else if (key === 'Wdth' && typeof value[key] === 'object') {
            type = 'UntF';
        }
        else if (key === 'Ofst' && typeof value[key] === 'number') {
            type = 'long';
        }
        else if (key === 'Strt' && typeof value[key] === 'object') {
            type = 'Objc';
            extType = nullType;
        }
        else if (channels.indexOf(key) !== -1) {
            type = (classId === 'RGBC' && root !== 'artd') ? 'doub' : 'long';
        }
        else if (key === 'profile') {
            type = classId === 'printOutput' ? 'TEXT' : 'tdta';
        }
        else if (key === 'strokeStyleContent') {
            if (value[key]['Clr ']) {
                extType = makeType('', 'solidColorLayer');
            }
            else if (value[key].Grad) {
                extType = makeType('', 'gradientLayer');
            }
            else if (value[key].Ptrn) {
                extType = makeType('', 'patternLayer');
            }
            else {
                logErrors && console.log('Invalid strokeStyleContent value', value[key]);
            }
        }
        else if (key === 'bounds' && root === 'quiltWarp') {
            extType = makeType('', 'classFloatRect');
        }
        if (extType && extType.classID === 'RGBC') {
            if ('H   ' in value[key])
                extType = { classID: 'HSBC', name: '' };
            // TODO: other color spaces
        }
        writeAsciiStringOrClassId(writer, key);
        (0, psdWriter_1.writeSignature)(writer, type || 'long');
        writeOSType(writer, type || 'long', value[key], key, extType, root);
        if (logErrors && !type)
            console.log(`Missing descriptor field type for: '${key}' in`, value);
    }
}
function readOSType(reader, type, includeClass) {
    switch (type) {
        case 'obj ': // Reference
            return readReferenceStructure(reader);
        case 'Objc': // Descriptor
        case 'GlbO': // GlobalObject same as Descriptor
            return readDescriptorStructure(reader, includeClass);
        case 'VlLs': { // List
            const length = (0, psdReader_1.readInt32)(reader);
            const items = [];
            for (let i = 0; i < length; i++) {
                const itemType = (0, psdReader_1.readSignature)(reader);
                // console.log('  >', itemType);
                items.push(readOSType(reader, itemType, includeClass));
            }
            return items;
        }
        case 'doub': // Double
            return (0, psdReader_1.readFloat64)(reader);
        case 'UntF': { // Unit double
            const units = (0, psdReader_1.readSignature)(reader);
            const value = (0, psdReader_1.readFloat64)(reader);
            if (!unitsMap[units])
                throw new Error(`Invalid units: ${units}`);
            return { units: unitsMap[units], value };
        }
        case 'UnFl': { // Unit float
            const units = (0, psdReader_1.readSignature)(reader);
            const value = (0, psdReader_1.readFloat32)(reader);
            if (!unitsMap[units])
                throw new Error(`Invalid units: ${units}`);
            return { units: unitsMap[units], value };
        }
        case 'TEXT': // String
            return (0, psdReader_1.readUnicodeString)(reader);
        case 'enum': { // Enumerated
            const enumType = readAsciiStringOrClassId(reader);
            const value = readAsciiStringOrClassId(reader);
            return `${enumType}.${value}`;
        }
        case 'long': // Integer
            return (0, psdReader_1.readInt32)(reader);
        case 'comp': { // Large Integer
            const low = (0, psdReader_1.readUint32)(reader);
            const high = (0, psdReader_1.readUint32)(reader);
            return { low, high };
        }
        case 'bool': // Boolean
            return !!(0, psdReader_1.readUint8)(reader);
        case 'type': // Class
        case 'GlbC': // Class
            return readClassStructure(reader);
        case 'alis': { // Alias
            const length = (0, psdReader_1.readInt32)(reader);
            return (0, psdReader_1.readAsciiString)(reader, length);
        }
        case 'tdta': { // Raw Data
            const length = (0, psdReader_1.readInt32)(reader);
            return (0, psdReader_1.readBytes)(reader, length);
        }
        case 'ObAr': { // Object array
            (0, psdReader_1.readInt32)(reader); // version: 16
            (0, psdReader_1.readUnicodeString)(reader); // name: ''
            readAsciiStringOrClassId(reader); // 'rationalPoint'
            const length = (0, psdReader_1.readInt32)(reader);
            const items = [];
            for (let i = 0; i < length; i++) {
                const type1 = readAsciiStringOrClassId(reader); // type Hrzn | Vrtc
                (0, psdReader_1.readSignature)(reader); // UnFl
                (0, psdReader_1.readSignature)(reader); // units ? '#Pxl'
                const valuesCount = (0, psdReader_1.readInt32)(reader);
                const values = [];
                for (let j = 0; j < valuesCount; j++) {
                    values.push((0, psdReader_1.readFloat64)(reader));
                }
                items.push({ type: type1, values });
            }
            return items;
        }
        case 'Pth ': { // File path
            /*const length =*/ (0, psdReader_1.readInt32)(reader); // total size of all fields below
            const sig = (0, psdReader_1.readSignature)(reader);
            /*const pathSize =*/ (0, psdReader_1.readInt32LE)(reader); // the same as length
            const charsCount = (0, psdReader_1.readInt32LE)(reader);
            const path = (0, psdReader_1.readUnicodeStringWithLengthLE)(reader, charsCount);
            return { sig, path };
        }
        default:
            throw new Error(`Invalid TySh descriptor OSType: ${type} at ${reader.offset.toString(16)}`);
    }
}
const ObArTypes = {
    meshPoints: 'rationalPoint',
    quiltSliceX: 'UntF',
    quiltSliceY: 'UntF',
};
function writeOSType(writer, type, value, key, extType, root) {
    switch (type) {
        case 'obj ': // Reference
            writeReferenceStructure(writer, key, value);
            break;
        case 'Objc': // Descriptor
        case 'GlbO': { // GlobalObject same as Descriptor
            if (typeof value !== 'object')
                throw new Error(`Invalid struct value: ${JSON.stringify(value)}, key: ${key}`);
            if (!extType)
                throw new Error(`Missing ext type for: '${key}' (${JSON.stringify(value)})`);
            const name = value._name || extType.name;
            const classID = value._classID || extType.classID;
            writeDescriptorStructure(writer, name, classID, value, root);
            break;
        }
        case 'VlLs': // List
            if (!Array.isArray(value))
                throw new Error(`Invalid list value: ${JSON.stringify(value)}, key: ${key}`);
            (0, psdWriter_1.writeInt32)(writer, value.length);
            for (let i = 0; i < value.length; i++) {
                const type = fieldToArrayType[key];
                (0, psdWriter_1.writeSignature)(writer, type || 'long');
                writeOSType(writer, type || 'long', value[i], `${key}[]`, fieldToArrayExtType[key], root);
                if (logErrors && !type)
                    console.log(`Missing descriptor array type for: '${key}' in`, value);
            }
            break;
        case 'doub': // Double
            if (typeof value !== 'number')
                throw new Error(`Invalid number value: ${JSON.stringify(value)}, key: ${key}`);
            (0, psdWriter_1.writeFloat64)(writer, value);
            break;
        case 'UntF': // Unit double
            if (!unitsMapRev[value.units])
                throw new Error(`Invalid units: ${value.units} in ${key}`);
            (0, psdWriter_1.writeSignature)(writer, unitsMapRev[value.units]);
            (0, psdWriter_1.writeFloat64)(writer, value.value);
            break;
        case 'UnFl': // Unit float
            if (!unitsMapRev[value.units])
                throw new Error(`Invalid units: ${value.units} in ${key}`);
            (0, psdWriter_1.writeSignature)(writer, unitsMapRev[value.units]);
            (0, psdWriter_1.writeFloat32)(writer, value.value);
            break;
        case 'TEXT': // String
            (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, value);
            break;
        case 'enum': { // Enumerated
            if (typeof value !== 'string')
                throw new Error(`Invalid enum value: ${JSON.stringify(value)}, key: ${key}`);
            const [_type, val] = value.split('.');
            writeAsciiStringOrClassId(writer, _type);
            writeAsciiStringOrClassId(writer, val);
            break;
        }
        case 'long': // Integer
            if (typeof value !== 'number')
                throw new Error(`Invalid integer value: ${JSON.stringify(value)}, key: ${key}`);
            (0, psdWriter_1.writeInt32)(writer, value);
            break;
        // case 'comp': // Large Integer
        // 	writeLargeInteger(reader);
        case 'bool': // Boolean
            if (typeof value !== 'boolean')
                throw new Error(`Invalid boolean value: ${JSON.stringify(value)}, key: ${key}`);
            (0, psdWriter_1.writeUint8)(writer, value ? 1 : 0);
            break;
        // case 'type': // Class
        // case 'GlbC': // Class
        // 	writeClassStructure(reader);
        // case 'alis': // Alias
        // 	writeAliasStructure(reader);
        case 'tdta': // Raw Data
            (0, psdWriter_1.writeInt32)(writer, value.byteLength);
            (0, psdWriter_1.writeBytes)(writer, value);
            break;
        case 'ObAr': { // Object array
            (0, psdWriter_1.writeInt32)(writer, 16); // version
            (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, ''); // name
            const type = ObArTypes[key];
            if (!type)
                throw new Error(`Not implemented ObArType for: ${key}`);
            writeAsciiStringOrClassId(writer, type);
            (0, psdWriter_1.writeInt32)(writer, value.length);
            for (let i = 0; i < value.length; i++) {
                writeAsciiStringOrClassId(writer, value[i].type); // Hrzn | Vrtc
                (0, psdWriter_1.writeSignature)(writer, 'UnFl');
                (0, psdWriter_1.writeSignature)(writer, '#Pxl');
                (0, psdWriter_1.writeInt32)(writer, value[i].values.length);
                for (let j = 0; j < value[i].values.length; j++) {
                    (0, psdWriter_1.writeFloat64)(writer, value[i].values[j]);
                }
            }
            break;
        }
        case 'Pth ': { // File path
            const length = 4 + 4 + 4 + value.path.length * 2;
            (0, psdWriter_1.writeInt32)(writer, length);
            (0, psdWriter_1.writeSignature)(writer, value.sig);
            (0, psdWriter_1.writeInt32LE)(writer, length);
            (0, psdWriter_1.writeInt32LE)(writer, value.path.length);
            (0, psdWriter_1.writeUnicodeStringWithoutLengthLE)(writer, value.path);
            break;
        }
        default:
            throw new Error(`Not implemented descriptor OSType: ${type}`);
    }
}
function readReferenceStructure(reader) {
    const itemsCount = (0, psdReader_1.readInt32)(reader);
    const items = [];
    for (let i = 0; i < itemsCount; i++) {
        const type = (0, psdReader_1.readSignature)(reader);
        switch (type) {
            case 'prop': { // Property
                readClassStructure(reader);
                const keyID = readAsciiStringOrClassId(reader);
                items.push(keyID);
                break;
            }
            case 'Clss': // Class
                items.push(readClassStructure(reader));
                break;
            case 'Enmr': { // Enumerated Reference
                readClassStructure(reader);
                const typeID = readAsciiStringOrClassId(reader);
                const value = readAsciiStringOrClassId(reader);
                items.push(`${typeID}.${value}`);
                break;
            }
            case 'rele': { // Offset
                // const { name, classID } =
                readClassStructure(reader);
                items.push((0, psdReader_1.readUint32)(reader));
                break;
            }
            case 'Idnt': // Identifier
                items.push((0, psdReader_1.readInt32)(reader));
                break;
            case 'indx': // Index
                items.push((0, psdReader_1.readInt32)(reader));
                break;
            case 'name': { // Name
                readClassStructure(reader);
                items.push((0, psdReader_1.readUnicodeString)(reader));
                break;
            }
            default:
                throw new Error(`Invalid descriptor reference type: ${type}`);
        }
    }
    return items;
}
function writeReferenceStructure(writer, _key, items) {
    (0, psdWriter_1.writeInt32)(writer, items.length);
    for (let i = 0; i < items.length; i++) {
        const value = items[i];
        let type = 'unknown';
        if (typeof value === 'string') {
            if (/^[a-z ]+\.[a-z ]+$/i.test(value)) {
                type = 'Enmr';
            }
            else {
                type = 'name';
            }
        }
        (0, psdWriter_1.writeSignature)(writer, type);
        switch (type) {
            // case 'prop': // Property
            // case 'Clss': // Class
            case 'Enmr': { // Enumerated Reference
                const [typeID, enumValue] = value.split('.');
                writeClassStructure(writer, '\0', typeID);
                writeAsciiStringOrClassId(writer, typeID);
                writeAsciiStringOrClassId(writer, enumValue);
                break;
            }
            // case 'rele': // Offset
            // case 'Idnt': // Identifier
            // case 'indx': // Index
            case 'name': { // Name
                writeClassStructure(writer, '\0', 'Lyr ');
                (0, psdWriter_1.writeUnicodeString)(writer, value + '\0');
                break;
            }
            default:
                throw new Error(`Invalid descriptor reference type: ${type}`);
        }
    }
    return items;
}
function readClassStructure(reader) {
    const name = (0, psdReader_1.readUnicodeString)(reader);
    const classID = readAsciiStringOrClassId(reader);
    return { name, classID };
}
function writeClassStructure(writer, name, classID) {
    (0, psdWriter_1.writeUnicodeString)(writer, name);
    writeAsciiStringOrClassId(writer, classID);
}
function readVersionAndDescriptor(reader, includeClass = false) {
    const version = (0, psdReader_1.readUint32)(reader);
    if (version !== 16)
        throw new Error(`Invalid descriptor version: ${version}`);
    const desc = readDescriptorStructure(reader, includeClass);
    // console.log(require('util').inspect(desc, false, 99, true));
    return desc;
}
function writeVersionAndDescriptor(writer, name, classID, descriptor, root = '') {
    (0, psdWriter_1.writeUint32)(writer, 16); // version
    writeDescriptorStructure(writer, name, classID, descriptor, root);
}
function horzVrtcToXY(hv) {
    return { x: hv.Hrzn, y: hv.Vrtc };
}
function xyToHorzVrtc(xy) {
    return { Hrzn: xy.x, Vrtc: xy.y };
}
function descBoundsToBounds(desc) {
    return {
        top: parseUnits(desc['Top ']),
        left: parseUnits(desc.Left),
        right: parseUnits(desc.Rght),
        bottom: parseUnits(desc.Btom),
    };
}
function boundsToDescBounds(bounds) {
    return {
        Left: unitsValue(bounds.left, 'bounds.left'),
        ['Top ']: unitsValue(bounds.top, 'bounds.top'),
        Rght: unitsValue(bounds.right, 'bounds.right'),
        Btom: unitsValue(bounds.bottom, 'bounds.bottom'),
    };
}
function parseFxObject(fx) {
    const stroke = {
        enabled: !!fx.enab,
        position: exports.FStl.decode(fx.Styl),
        fillType: exports.FrFl.decode(fx.PntT),
        blendMode: exports.BlnM.decode(fx['Md  ']),
        opacity: parsePercent(fx.Opct),
        size: parseUnits(fx['Sz  ']),
    };
    if (fx.present !== undefined)
        stroke.present = fx.present;
    if (fx.showInDialog !== undefined)
        stroke.showInDialog = fx.showInDialog;
    if (fx.overprint !== undefined)
        stroke.overprint = fx.overprint;
    if (fx['Clr '])
        stroke.color = parseColor(fx['Clr ']);
    if (fx.Grad)
        stroke.gradient = parseGradientContent(fx);
    if (fx.Ptrn)
        stroke.pattern = parsePatternContent(fx);
    return stroke;
}
function serializeFxObject(stroke) {
    let FrFX = {};
    FrFX.enab = !!stroke.enabled;
    if (stroke.present !== undefined)
        FrFX.present = !!stroke.present;
    if (stroke.showInDialog !== undefined)
        FrFX.showInDialog = !!stroke.showInDialog;
    FrFX.Styl = exports.FStl.encode(stroke.position);
    FrFX.PntT = exports.FrFl.encode(stroke.fillType);
    FrFX['Md  '] = exports.BlnM.encode(stroke.blendMode);
    FrFX.Opct = unitsPercent(stroke.opacity);
    FrFX['Sz  '] = unitsValue(stroke.size, 'size');
    if (stroke.color)
        FrFX['Clr '] = serializeColor(stroke.color);
    if (stroke.gradient)
        FrFX = Object.assign(Object.assign({}, FrFX), serializeGradientContent(stroke.gradient));
    if (stroke.pattern)
        FrFX = Object.assign(Object.assign({}, FrFX), serializePatternContent(stroke.pattern));
    if (stroke.overprint !== undefined)
        FrFX.overprint = !!stroke.overprint;
    return FrFX;
}
function serializeEffects(e, log, multi) {
    var _a, _b, _c;
    const info = multi ? {
        'Scl ': unitsPercentF((_a = e.scale) !== null && _a !== void 0 ? _a : 1),
        masterFXSwitch: !e.disabled,
    } : {
        masterFXSwitch: !e.disabled,
        'Scl ': unitsPercentF((_b = e.scale) !== null && _b !== void 0 ? _b : 1),
    };
    const arrayKeys = ['dropShadow', 'innerShadow', 'solidFill', 'gradientOverlay', 'stroke'];
    for (const key of arrayKeys) {
        if (e[key] && !Array.isArray(e[key]))
            throw new Error(`${key} should be an array`);
    }
    const useMulti = (arr) => !!arr && arr.length > 1 && multi;
    const useSingle = (arr) => !!arr && arr.length >= 1 && (!multi || arr.length === 1);
    if (useSingle(e.dropShadow))
        info.DrSh = serializeEffectObject(e.dropShadow[0], 'dropShadow', log);
    if (useMulti(e.dropShadow))
        info.dropShadowMulti = e.dropShadow.map(i => serializeEffectObject(i, 'dropShadow', log));
    if (useSingle(e.innerShadow))
        info.IrSh = serializeEffectObject(e.innerShadow[0], 'innerShadow', log);
    if (useMulti(e.innerShadow))
        info.innerShadowMulti = e.innerShadow.map(i => serializeEffectObject(i, 'innerShadow', log));
    if (e.outerGlow)
        info.OrGl = serializeEffectObject(e.outerGlow, 'outerGlow', log);
    if (useMulti(e.solidFill))
        info.solidFillMulti = e.solidFill.map(i => serializeEffectObject(i, 'solidFill', log));
    if (useMulti(e.gradientOverlay))
        info.gradientFillMulti = e.gradientOverlay.map(i => serializeEffectObject(i, 'gradientOverlay', log));
    if (useMulti(e.stroke))
        info.frameFXMulti = e.stroke.map(i => serializeFxObject(i));
    if (e.innerGlow)
        info.IrGl = serializeEffectObject(e.innerGlow, 'innerGlow', log);
    if (e.bevel)
        info.ebbl = serializeEffectObject(e.bevel, 'bevel', log);
    if (useSingle(e.solidFill))
        info.SoFi = serializeEffectObject(e.solidFill[0], 'solidFill', log);
    if (e.patternOverlay)
        info.patternFill = serializeEffectObject(e.patternOverlay, 'patternOverlay', log);
    if (useSingle(e.gradientOverlay))
        info.GrFl = serializeEffectObject(e.gradientOverlay[0], 'gradientOverlay', log);
    if (e.satin)
        info.ChFX = serializeEffectObject(e.satin, 'satin', log);
    if (useSingle(e.stroke))
        info.FrFX = serializeFxObject((_c = e.stroke) === null || _c === void 0 ? void 0 : _c[0]);
    if (multi) {
        info.numModifyingFX = 0;
        for (const key of Object.keys(e)) {
            const value = e[key];
            if (Array.isArray(value)) {
                for (const effect of value) {
                    if (effect.enabled)
                        info.numModifyingFX++;
                }
            }
            else if (value.enabled) {
                info.numModifyingFX++;
            }
        }
    }
    return info;
}
function parseEffects(info, log) {
    const effects = {};
    const { masterFXSwitch, DrSh, dropShadowMulti, IrSh, innerShadowMulti, OrGl, IrGl, ebbl, SoFi, solidFillMulti, patternFill, GrFl, gradientFillMulti, ChFX, FrFX, frameFXMulti, numModifyingFX } = info, rest = __rest(info, ["masterFXSwitch", "DrSh", "dropShadowMulti", "IrSh", "innerShadowMulti", "OrGl", "IrGl", "ebbl", "SoFi", "solidFillMulti", "patternFill", "GrFl", "gradientFillMulti", "ChFX", "FrFX", "frameFXMulti", "numModifyingFX"]);
    if (!masterFXSwitch)
        effects.disabled = true;
    if (info['Scl '])
        effects.scale = parsePercent(info['Scl ']);
    if (DrSh)
        effects.dropShadow = [parseEffectObject(DrSh, log)];
    if (dropShadowMulti)
        effects.dropShadow = dropShadowMulti.map(i => parseEffectObject(i, log));
    if (IrSh)
        effects.innerShadow = [parseEffectObject(IrSh, log)];
    if (innerShadowMulti)
        effects.innerShadow = innerShadowMulti.map(i => parseEffectObject(i, log));
    if (OrGl)
        effects.outerGlow = parseEffectObject(OrGl, log);
    if (IrGl)
        effects.innerGlow = parseEffectObject(IrGl, log);
    if (ebbl)
        effects.bevel = parseEffectObject(ebbl, log);
    if (SoFi)
        effects.solidFill = [parseEffectObject(SoFi, log)];
    if (solidFillMulti)
        effects.solidFill = solidFillMulti.map(i => parseEffectObject(i, log));
    if (patternFill)
        effects.patternOverlay = parseEffectObject(patternFill, log);
    if (GrFl)
        effects.gradientOverlay = [parseEffectObject(GrFl, log)];
    if (gradientFillMulti)
        effects.gradientOverlay = gradientFillMulti.map(i => parseEffectObject(i, log));
    if (ChFX)
        effects.satin = parseEffectObject(ChFX, log);
    if (FrFX)
        effects.stroke = [parseFxObject(FrFX)];
    if (frameFXMulti)
        effects.stroke = frameFXMulti.map(i => parseFxObject(i));
    if (log && Object.keys(rest).length > 1)
        console.log('Unhandled effect keys:', rest);
    return effects;
}
function parseKeyList(keyList, logMissingFeatures) {
    const keys = [];
    for (let j = 0; j < keyList.length; j++) {
        const key = keyList[j];
        const { time: { denominator, numerator }, selected, animKey } = key;
        const time = { numerator, denominator };
        const interpolation = exports.animInterpStyleEnum.decode(key.animInterpStyle);
        switch (animKey.Type) {
            case 'keyType.Opct':
                keys.push({ interpolation, time, selected, type: 'opacity', value: parsePercent(animKey.Opct) });
                break;
            case 'keyType.Pstn':
                keys.push({ interpolation, time, selected, type: 'position', x: animKey.Hrzn, y: animKey.Vrtc });
                break;
            case 'keyType.Trnf':
                keys.push({
                    interpolation, time, selected, type: 'transform',
                    scale: horzVrtcToXY(animKey['Scl ']), skew: horzVrtcToXY(animKey.Skew), rotation: animKey.rotation, translation: horzVrtcToXY(animKey.translation)
                });
                break;
            case 'keyType.sheetStyle': {
                const key = { interpolation, time, selected, type: 'style' };
                if (animKey.sheetStyle.Lefx)
                    key.style = parseEffects(animKey.sheetStyle.Lefx, logMissingFeatures);
                keys.push(key);
                break;
            }
            case 'keyType.globalLighting': {
                keys.push({
                    interpolation, time, selected, type: 'globalLighting',
                    globalAngle: animKey.gblA, globalAltitude: animKey.globalAltitude
                });
                break;
            }
            default: throw new Error(`Unsupported keyType value`);
        }
    }
    return keys;
}
function serializeKeyList(keys) {
    const keyList = [];
    for (let j = 0; j < keys.length; j++) {
        const key = keys[j];
        const { time, selected = false, interpolation } = key;
        const animInterpStyle = exports.animInterpStyleEnum.encode(interpolation);
        let animKey;
        switch (key.type) {
            case 'opacity':
                animKey = { Type: 'keyType.Opct', Opct: unitsPercent(key.value) };
                break;
            case 'position':
                animKey = { Type: 'keyType.Pstn', Hrzn: key.x, Vrtc: key.y };
                break;
            case 'transform':
                animKey = { Type: 'keyType.Trnf', 'Scl ': xyToHorzVrtc(key.scale), Skew: xyToHorzVrtc(key.skew), rotation: key.rotation, translation: xyToHorzVrtc(key.translation) };
                break;
            case 'style':
                animKey = { Type: 'keyType.sheetStyle', sheetStyle: { Vrsn: 1, blendOptions: {} } };
                if (key.style)
                    animKey.sheetStyle = { Vrsn: 1, Lefx: serializeEffects(key.style, false, false), blendOptions: {} };
                break;
            case 'globalLighting': {
                animKey = { Type: 'keyType.globalLighting', gblA: key.globalAngle, globalAltitude: key.globalAltitude };
                break;
            }
            default: throw new Error(`Unsupported keyType value`);
        }
        keyList.push({ Vrsn: 1, animInterpStyle, time, animKey, selected });
    }
    return keyList;
}
function parseTrackList(trackList, logMissingFeatures) {
    const tracks = [];
    for (let i = 0; i < trackList.length; i++) {
        const tr = trackList[i];
        const track = {
            type: exports.stdTrackID.decode(tr.trackID),
            enabled: tr.enab,
            keys: parseKeyList(tr.keyList, logMissingFeatures),
        };
        if (tr.effectParams) {
            track.effectParams = {
                fillCanvas: tr.effectParams.fillCanvas,
                zoomOrigin: tr.effectParams.zoomOrigin,
                keys: parseKeyList(tr.effectParams.keyList, logMissingFeatures),
            };
        }
        tracks.push(track);
    }
    return tracks;
}
function serializeTrackList(tracks) {
    const trackList = [];
    for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        trackList.push(Object.assign(Object.assign({ trackID: exports.stdTrackID.encode(t.type), Vrsn: 1, enab: !!t.enabled, Effc: !!t.effectParams }, (t.effectParams ? {
            effectParams: {
                keyList: serializeKeyList(t.keys),
                fillCanvas: t.effectParams.fillCanvas,
                zoomOrigin: t.effectParams.zoomOrigin,
            }
        } : {})), { keyList: serializeKeyList(t.keys) }));
    }
    return trackList;
}
function parseEffectObject(obj, reportErrors) {
    const result = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        switch (key) {
            case 'enab':
                result.enabled = !!val;
                break;
            case 'uglg':
                result.useGlobalLight = !!val;
                break;
            case 'AntA':
                result.antialiased = !!val;
                break;
            case 'Algn':
                result.align = !!val;
                break;
            case 'Dthr':
                result.dither = !!val;
                break;
            case 'Invr':
                result.invert = !!val;
                break;
            case 'Rvrs':
                result.reverse = !!val;
                break;
            case 'Clr ':
                result.color = parseColor(val);
                break;
            case 'hglC':
                result.highlightColor = parseColor(val);
                break;
            case 'sdwC':
                result.shadowColor = parseColor(val);
                break;
            case 'Styl':
                result.position = exports.FStl.decode(val);
                break;
            case 'Md  ':
                result.blendMode = exports.BlnM.decode(val);
                break;
            case 'hglM':
                result.highlightBlendMode = exports.BlnM.decode(val);
                break;
            case 'sdwM':
                result.shadowBlendMode = exports.BlnM.decode(val);
                break;
            case 'bvlS':
                result.style = exports.BESl.decode(val);
                break;
            case 'bvlD':
                result.direction = exports.BESs.decode(val);
                break;
            case 'bvlT':
                result.technique = exports.bvlT.decode(val);
                break;
            case 'GlwT':
                result.technique = exports.BETE.decode(val);
                break;
            case 'glwS':
                result.source = exports.IGSr.decode(val);
                break;
            case 'Type':
                result.type = exports.GrdT.decode(val);
                break;
            case 'gs99':
                result.interpolationMethod = exports.gradientInterpolationMethodType.decode(val);
                break;
            case 'Opct':
                result.opacity = parsePercent(val);
                break;
            case 'hglO':
                result.highlightOpacity = parsePercent(val);
                break;
            case 'sdwO':
                result.shadowOpacity = parsePercent(val);
                break;
            case 'lagl':
                result.angle = parseAngle(val);
                break;
            case 'Angl':
                result.angle = parseAngle(val);
                break;
            case 'Lald':
                result.altitude = parseAngle(val);
                break;
            case 'Sftn':
                result.soften = parseUnits(val);
                break;
            case 'srgR':
                result.strength = parsePercent(val);
                break;
            case 'blur':
                result.size = parseUnits(val);
                break;
            case 'Nose':
                result.noise = parsePercent(val);
                break;
            case 'Inpr':
                result.range = parsePercent(val);
                break;
            case 'Ckmt':
                result.choke = parseUnits(val);
                break;
            case 'ShdN':
                result.jitter = parsePercent(val);
                break;
            case 'Dstn':
                result.distance = parseUnits(val);
                break;
            case 'Scl ':
                result.scale = parsePercent(val);
                break;
            case 'Ptrn':
                result.pattern = { name: val['Nm  '], id: val.Idnt };
                break;
            case 'phase':
                result.phase = { x: val.Hrzn, y: val.Vrtc };
                break;
            case 'Ofst':
                result.offset = { x: parsePercent(val.Hrzn), y: parsePercent(val.Vrtc) };
                break;
            case 'MpgS':
            case 'TrnS':
                result.contour = {
                    name: val['Nm  '],
                    curve: val['Crv '].map(p => ({ x: p.Hrzn, y: p.Vrtc })),
                };
                break;
            case 'Grad':
                result.gradient = parseGradient(val);
                break;
            case 'useTexture':
            case 'useShape':
            case 'layerConceals':
            case 'present':
            case 'showInDialog':
            case 'antialiasGloss':
                result[key] = val;
                break;
            case '_name':
            case '_classID':
                break;
            default:
                reportErrors && console.log(`Invalid effect key: '${key}', value:`, val);
        }
    }
    return result;
}
function serializeEffectObject(obj, objName, reportErrors) {
    const result = {
        enab: false,
    };
    if (objName === 'dropShadow') {
        result.TrnS = { 'Nm  ': '', 'Crv ': [] };
    }
    for (const objKey of Object.keys(obj)) {
        const key = objKey;
        const val = obj[key];
        switch (key) {
            case 'enabled':
                result.enab = !!val;
                break;
            case 'useGlobalLight':
                result.uglg = !!val;
                break;
            case 'antialiased':
                result.AntA = !!val;
                break;
            case 'align':
                result.Algn = !!val;
                break;
            case 'dither':
                result.Dthr = !!val;
                break;
            case 'invert':
                result.Invr = !!val;
                break;
            case 'reverse':
                result.Rvrs = !!val;
                break;
            case 'color':
                result['Clr '] = serializeColor(val);
                break;
            case 'highlightColor':
                result.hglC = serializeColor(val);
                break;
            case 'shadowColor':
                result.sdwC = serializeColor(val);
                break;
            case 'position':
                result.Styl = exports.FStl.encode(val);
                break;
            case 'blendMode':
                result['Md  '] = exports.BlnM.encode(val);
                break;
            case 'highlightBlendMode':
                result.hglM = exports.BlnM.encode(val);
                break;
            case 'shadowBlendMode':
                result.sdwM = exports.BlnM.encode(val);
                break;
            case 'style':
                result.bvlS = exports.BESl.encode(val);
                break;
            case 'direction':
                result.bvlD = exports.BESs.encode(val);
                break;
            case 'technique':
                if (objName === 'bevel') {
                    result.bvlT = exports.bvlT.encode(val);
                }
                else {
                    result.GlwT = exports.BETE.encode(val);
                }
                break;
            case 'source':
                result.glwS = exports.IGSr.encode(val);
                break;
            case 'type':
                result.Type = exports.GrdT.encode(val);
                break;
            case 'interpolationMethod':
                result.gs99 = exports.gradientInterpolationMethodType.encode(val);
                break;
            case 'opacity':
                result.Opct = unitsPercent(val);
                break;
            case 'highlightOpacity':
                result.hglO = unitsPercent(val);
                break;
            case 'shadowOpacity':
                result.sdwO = unitsPercent(val);
                break;
            case 'angle':
                if (objName === 'gradientOverlay' || objName === 'patternFill') {
                    result.Angl = unitsAngle(val);
                }
                else {
                    result.lagl = unitsAngle(val);
                }
                break;
            case 'altitude':
                result.Lald = unitsAngle(val);
                break;
            case 'soften':
                result.Sftn = unitsValue(val, key);
                break;
            case 'strength':
                result.srgR = unitsPercent(val);
                break;
            case 'size':
                result.blur = unitsValue(val, key);
                break;
            case 'noise':
                result.Nose = unitsPercent(val);
                break;
            case 'range':
                result.Inpr = unitsPercent(val);
                break;
            case 'choke':
                result.Ckmt = unitsValue(val, key);
                break;
            case 'jitter':
                result.ShdN = unitsPercent(val);
                break;
            case 'distance':
                result.Dstn = unitsValue(val, key);
                break;
            case 'scale':
                result['Scl '] = unitsPercent(val);
                break;
            case 'pattern':
                result.Ptrn = { 'Nm  ': val.name, Idnt: val.id };
                break;
            case 'phase':
                result.phase = { Hrzn: val.x, Vrtc: val.y };
                break;
            case 'offset':
                result.Ofst = { Hrzn: unitsPercent(val.x), Vrtc: unitsPercent(val.y) };
                break;
            case 'contour': {
                result[objName === 'satin' ? 'MpgS' : 'TrnS'] = {
                    'Nm  ': val.name,
                    'Crv ': val.curve.map(p => ({ Hrzn: p.x, Vrtc: p.y })),
                };
                break;
            }
            case 'gradient':
                result.Grad = serializeGradient(val);
                break;
            case 'useTexture':
            case 'useShape':
            case 'layerConceals':
            case 'present':
            case 'showInDialog':
            case 'antialiasGloss':
                result[key] = val;
                break;
            default:
                reportErrors && console.log(`Invalid effect key: '${key}', value:`, val);
        }
    }
    return result;
}
function parseGradient(grad) {
    if (grad.GrdF === 'GrdF.CstS') {
        const samples = grad.Intr || 4096;
        return {
            type: 'solid',
            name: grad['Nm  '],
            smoothness: grad.Intr / 4096,
            colorStops: grad.Clrs.map(s => ({
                color: parseColor(s['Clr ']),
                location: s.Lctn / samples,
                midpoint: s.Mdpn / 100,
            })),
            opacityStops: grad.Trns.map(s => ({
                opacity: parsePercent(s.Opct),
                location: s.Lctn / samples,
                midpoint: s.Mdpn / 100,
            })),
        };
    }
    else {
        return {
            type: 'noise',
            name: grad['Nm  '],
            roughness: grad.Smth / 4096,
            colorModel: exports.ClrS.decode(grad.ClrS),
            randomSeed: grad.RndS,
            restrictColors: !!grad.VctC,
            addTransparency: !!grad.ShTr,
            min: grad['Mnm '].map(x => x / 100),
            max: grad['Mxm '].map(x => x / 100),
        };
    }
}
function serializeGradient(grad) {
    var _a, _b;
    if (grad.type === 'solid') {
        const samples = Math.round(((_a = grad.smoothness) !== null && _a !== void 0 ? _a : 1) * 4096);
        return {
            'Nm  ': grad.name || '',
            GrdF: 'GrdF.CstS',
            Intr: samples,
            Clrs: grad.colorStops.map(s => {
                var _a;
                return ({
                    'Clr ': serializeColor(s.color),
                    Type: 'Clry.UsrS',
                    Lctn: Math.round(s.location * samples),
                    Mdpn: Math.round(((_a = s.midpoint) !== null && _a !== void 0 ? _a : 0.5) * 100),
                });
            }),
            Trns: grad.opacityStops.map(s => {
                var _a;
                return ({
                    Opct: unitsPercent(s.opacity),
                    Lctn: Math.round(s.location * samples),
                    Mdpn: Math.round(((_a = s.midpoint) !== null && _a !== void 0 ? _a : 0.5) * 100),
                });
            }),
        };
    }
    else {
        return {
            GrdF: 'GrdF.ClNs',
            'Nm  ': grad.name || '',
            ShTr: !!grad.addTransparency,
            VctC: !!grad.restrictColors,
            ClrS: exports.ClrS.encode(grad.colorModel),
            RndS: grad.randomSeed || 0,
            Smth: Math.round(((_b = grad.roughness) !== null && _b !== void 0 ? _b : 1) * 4096),
            'Mnm ': (grad.min || [0, 0, 0, 0]).map(x => x * 100),
            'Mxm ': (grad.max || [1, 1, 1, 1]).map(x => x * 100),
        };
    }
}
function parseGradientContent(descriptor) {
    const result = parseGradient(descriptor.Grad);
    result.style = exports.GrdT.decode(descriptor.Type);
    if (descriptor.Dthr !== undefined)
        result.dither = descriptor.Dthr;
    if (descriptor.gradientsInterpolationMethod !== undefined)
        result.interpolationMethod = exports.gradientInterpolationMethodType.decode(descriptor.gradientsInterpolationMethod);
    if (descriptor.Rvrs !== undefined)
        result.reverse = descriptor.Rvrs;
    if (descriptor.Angl !== undefined)
        result.angle = parseAngle(descriptor.Angl);
    if (descriptor['Scl '] !== undefined)
        result.scale = parsePercent(descriptor['Scl ']);
    if (descriptor.Algn !== undefined)
        result.align = descriptor.Algn;
    if (descriptor.Ofst !== undefined) {
        result.offset = {
            x: parsePercent(descriptor.Ofst.Hrzn),
            y: parsePercent(descriptor.Ofst.Vrtc)
        };
    }
    return result;
}
function parsePatternContent(descriptor) {
    const result = {
        name: descriptor.Ptrn['Nm  '],
        id: descriptor.Ptrn.Idnt,
    };
    if (descriptor.Lnkd !== undefined)
        result.linked = descriptor.Lnkd;
    if (descriptor.phase !== undefined)
        result.phase = { x: descriptor.phase.Hrzn, y: descriptor.phase.Vrtc };
    return result;
}
function parseVectorContent(descriptor) {
    if ('Grad' in descriptor) {
        return parseGradientContent(descriptor);
    }
    else if ('Ptrn' in descriptor) {
        return Object.assign({ type: 'pattern' }, parsePatternContent(descriptor));
    }
    else if ('Clr ' in descriptor) {
        return { type: 'color', color: parseColor(descriptor['Clr ']) };
    }
    else {
        throw new Error('Invalid vector content');
    }
}
function serializeGradientContent(content) {
    const result = {};
    if (content.dither !== undefined)
        result.Dthr = content.dither;
    if (content.interpolationMethod !== undefined)
        result.gradientsInterpolationMethod = exports.gradientInterpolationMethodType.encode(content.interpolationMethod);
    if (content.reverse !== undefined)
        result.Rvrs = content.reverse;
    if (content.angle !== undefined)
        result.Angl = unitsAngle(content.angle);
    result.Type = exports.GrdT.encode(content.style);
    if (content.align !== undefined)
        result.Algn = content.align;
    if (content.scale !== undefined)
        result['Scl '] = unitsPercent(content.scale);
    if (content.offset) {
        result.Ofst = {
            Hrzn: unitsPercent(content.offset.x),
            Vrtc: unitsPercent(content.offset.y),
        };
    }
    result.Grad = serializeGradient(content);
    return result;
}
function serializePatternContent(content) {
    const result = {
        Ptrn: {
            'Nm  ': content.name || '',
            Idnt: content.id || '',
        }
    };
    if (content.linked !== undefined)
        result.Lnkd = !!content.linked;
    if (content.phase !== undefined)
        result.phase = { Hrzn: content.phase.x, Vrtc: content.phase.y };
    return result;
}
function serializeVectorContent(content) {
    if (content.type === 'color') {
        return { key: 'SoCo', descriptor: { 'Clr ': serializeColor(content.color) } };
    }
    else if (content.type === 'pattern') {
        return { key: 'PtFl', descriptor: serializePatternContent(content) };
    }
    else {
        return { key: 'GdFl', descriptor: serializeGradientContent(content) };
    }
}
function parseColor(color) {
    if ('H   ' in color) {
        return { h: parsePercentOrAngle(color['H   ']), s: color.Strt, b: color.Brgh };
    }
    else if ('Rd  ' in color) {
        return { r: color['Rd  '], g: color['Grn '], b: color['Bl  '] };
    }
    else if ('Cyn ' in color) {
        return { c: color['Cyn '], m: color.Mgnt, y: color['Ylw '], k: color.Blck };
    }
    else if ('Gry ' in color) {
        return { k: color['Gry '] };
    }
    else if ('Lmnc' in color) {
        return { l: color.Lmnc, a: color['A   '], b: color['B   '] };
    }
    else if ('redFloat' in color) {
        return { fr: color.redFloat, fg: color.greenFloat, fb: color.blueFloat };
    }
    else {
        throw new Error('Unsupported color descriptor');
    }
}
function serializeColor(color) {
    if (!color) {
        return { _name: '', _classID: 'RGBC', 'Rd  ': 0, 'Grn ': 0, 'Bl  ': 0 };
    }
    else if ('r' in color) {
        return { _name: '', _classID: 'RGBC', 'Rd  ': color.r || 0, 'Grn ': color.g || 0, 'Bl  ': color.b || 0 };
    }
    else if ('fr' in color) {
        return { _name: '', _classID: 'RGBC', redFloat: color.fr, greenFloat: color.fg, blueFloat: color.fb };
    }
    else if ('h' in color) {
        return { _name: '', _classID: 'HSBC', 'H   ': unitsAngle(color.h * 360), Strt: color.s || 0, Brgh: color.b || 0 };
    }
    else if ('c' in color) {
        return { _name: '', _classID: 'CMYC', 'Cyn ': color.c || 0, Mgnt: color.m || 0, 'Ylw ': color.y || 0, Blck: color.k || 0 };
    }
    else if ('l' in color) {
        return { _name: '', _classID: 'LABC', Lmnc: color.l || 0, 'A   ': color.a || 0, 'B   ': color.b || 0 };
    }
    else if ('k' in color) {
        return { _name: '', _classID: 'GRYC', 'Gry ': color.k };
    }
    else {
        throw new Error('Invalid color value');
    }
}
function parseAngle(x) {
    if (x === undefined)
        return 0;
    if (x.units !== 'Angle')
        throw new Error(`Invalid units: ${x.units}`);
    return x.value;
}
function parsePercent(x) {
    if (x === undefined)
        return 1;
    if (x.units !== 'Percent')
        throw new Error(`Invalid units: ${x.units}`);
    return x.value / 100;
}
function parsePercentOrAngle(x) {
    if (x === undefined)
        return 1;
    if (x.units === 'Percent')
        return x.value / 100;
    if (x.units === 'Angle')
        return x.value / 360;
    throw new Error(`Invalid units: ${x.units}`);
}
function parseUnits({ units, value }) {
    if (units !== 'Pixels' && units !== 'Millimeters' && units !== 'Points' && units !== 'None' &&
        units !== 'Picas' && units !== 'Inches' && units !== 'Centimeters' && units !== 'Density') {
        throw new Error(`Invalid units: ${JSON.stringify({ units, value })}`);
    }
    return { value, units };
}
function parseUnitsOrNumber(value, units = 'Pixels') {
    if (typeof value === 'number')
        return { value, units };
    return parseUnits(value);
}
function parseUnitsToNumber({ units, value }, expectedUnits) {
    if (units !== expectedUnits)
        throw new Error(`Invalid units: ${JSON.stringify({ units, value })}`);
    return value;
}
function unitsAngle(value) {
    return { units: 'Angle', value: value || 0 };
}
function unitsPercent(value) {
    return { units: 'Percent', value: Math.round((value || 0) * 100) };
}
function unitsPercentF(value) {
    return { units: 'Percent', value: (value || 0) * 100 };
}
function unitsValue(x, key) {
    if (x == null)
        return { units: 'Pixels', value: 0 };
    if (typeof x !== 'object')
        throw new Error(`Invalid value: ${JSON.stringify(x)} (key: ${key}) (should have value and units)`);
    const { units, value } = x;
    if (typeof value !== 'number')
        throw new Error(`Invalid value in ${JSON.stringify(x)} (key: ${key})`);
    if (units !== 'Pixels' && units !== 'Millimeters' && units !== 'Points' && units !== 'None' &&
        units !== 'Picas' && units !== 'Inches' && units !== 'Centimeters' && units !== 'Density') {
        throw new Error(`Invalid units in ${JSON.stringify(x)} (key: ${key})`);
    }
    return { units, value };
}
function frac({ numerator, denominator }) {
    return { numerator, denominator };
}
exports.textGridding = (0, helpers_1.createEnum)('textGridding', 'none', {
    none: 'None',
    round: 'Rnd ',
});
exports.Ornt = (0, helpers_1.createEnum)('Ornt', 'horizontal', {
    horizontal: 'Hrzn',
    vertical: 'Vrtc',
});
exports.Annt = (0, helpers_1.createEnum)('Annt', 'sharp', {
    none: 'Anno',
    sharp: 'antiAliasSharp',
    crisp: 'AnCr',
    strong: 'AnSt',
    smooth: 'AnSm',
    platform: 'antiAliasPlatformGray',
    platformLCD: 'antiAliasPlatformLCD',
});
exports.warpStyle = (0, helpers_1.createEnum)('warpStyle', 'none', {
    none: 'warpNone',
    arc: 'warpArc',
    arcLower: 'warpArcLower',
    arcUpper: 'warpArcUpper',
    arch: 'warpArch',
    bulge: 'warpBulge',
    shellLower: 'warpShellLower',
    shellUpper: 'warpShellUpper',
    flag: 'warpFlag',
    wave: 'warpWave',
    fish: 'warpFish',
    rise: 'warpRise',
    fisheye: 'warpFisheye',
    inflate: 'warpInflate',
    squeeze: 'warpSqueeze',
    twist: 'warpTwist',
    cylinder: 'warpCylinder',
    custom: 'warpCustom',
});
exports.BlnM = (0, helpers_1.createEnum)('BlnM', 'normal', {
    'normal': 'Nrml',
    'dissolve': 'Dslv',
    'darken': 'Drkn',
    'multiply': 'Mltp',
    'color burn': 'CBrn',
    'linear burn': 'linearBurn',
    'darker color': 'darkerColor',
    'lighten': 'Lghn',
    'screen': 'Scrn',
    'color dodge': 'CDdg',
    'linear dodge': 'linearDodge',
    'lighter color': 'lighterColor',
    'overlay': 'Ovrl',
    'soft light': 'SftL',
    'hard light': 'HrdL',
    'vivid light': 'vividLight',
    'linear light': 'linearLight',
    'pin light': 'pinLight',
    'hard mix': 'hardMix',
    'difference': 'Dfrn',
    'exclusion': 'Xclu',
    'subtract': 'blendSubtraction',
    'divide': 'blendDivide',
    'hue': 'H   ',
    'saturation': 'Strt',
    'color': 'Clr ',
    'luminosity': 'Lmns',
    // used in ABR
    'linear height': 'linearHeight',
    'height': 'Hght',
    'subtraction': 'Sbtr', // 2nd version of subtract ?
    'pass through': '????', // added for compilation to work, not used in actual files
});
exports.BESl = (0, helpers_1.createEnum)('BESl', 'inner bevel', {
    'inner bevel': 'InrB',
    'outer bevel': 'OtrB',
    'emboss': 'Embs',
    'pillow emboss': 'PlEb',
    'stroke emboss': 'strokeEmboss',
});
exports.bvlT = (0, helpers_1.createEnum)('bvlT', 'smooth', {
    'smooth': 'SfBL',
    'chisel hard': 'PrBL',
    'chisel soft': 'Slmt',
});
exports.BESs = (0, helpers_1.createEnum)('BESs', 'up', {
    up: 'In  ',
    down: 'Out ',
});
exports.BETE = (0, helpers_1.createEnum)('BETE', 'softer', {
    softer: 'SfBL',
    precise: 'PrBL',
});
exports.IGSr = (0, helpers_1.createEnum)('IGSr', 'edge', {
    edge: 'SrcE',
    center: 'SrcC',
});
exports.GrdT = (0, helpers_1.createEnum)('GrdT', 'linear', {
    linear: 'Lnr ',
    radial: 'Rdl ',
    angle: 'Angl',
    reflected: 'Rflc',
    diamond: 'Dmnd',
});
exports.animInterpStyleEnum = (0, helpers_1.createEnum)('animInterpStyle', 'linear', {
    linear: 'Lnr ',
    hold: 'hold',
});
exports.stdTrackID = (0, helpers_1.createEnum)('stdTrackID', 'opacity', {
    opacity: 'opacityTrack',
    style: 'styleTrack',
    sheetTransform: 'sheetTransformTrack',
    sheetPosition: 'sheetPositionTrack',
    globalLighting: 'globalLightingTrack',
});
exports.gradientInterpolationMethodType = (0, helpers_1.createEnum)('gradientInterpolationMethodType', 'perceptual', {
    perceptual: 'Perc',
    linear: 'Lnr ',
    classic: 'Gcls',
    smooth: 'Smoo',
    // TODO: stripes
});
exports.ClrS = (0, helpers_1.createEnum)('ClrS', 'rgb', {
    rgb: 'RGBC',
    hsb: 'HSBl',
    lab: 'LbCl',
    hsl: 'HSLC',
});
exports.FStl = (0, helpers_1.createEnum)('FStl', 'outside', {
    outside: 'OutF',
    center: 'CtrF',
    inside: 'InsF'
});
exports.FrFl = (0, helpers_1.createEnum)('FrFl', 'color', {
    color: 'SClr',
    gradient: 'GrFl',
    pattern: 'Ptrn',
});
exports.ESliceType = (0, helpers_1.createEnum)('ESliceType', 'image', {
    image: 'Img ',
    noImage: 'noImage',
});
exports.ESliceHorzAlign = (0, helpers_1.createEnum)('ESliceHorzAlign', 'default', {
    default: 'default',
});
exports.ESliceVertAlign = (0, helpers_1.createEnum)('ESliceVertAlign', 'default', {
    default: 'default',
});
exports.ESliceOrigin = (0, helpers_1.createEnum)('ESliceOrigin', 'userGenerated', {
    userGenerated: 'userGenerated',
    autoGenerated: 'autoGenerated',
    layer: 'layer',
});
exports.ESliceBGColorType = (0, helpers_1.createEnum)('ESliceBGColorType', 'none', {
    none: 'None',
    matte: 'matte',
    color: 'Clr ',
});
exports.strokeStyleLineCapType = (0, helpers_1.createEnum)('strokeStyleLineCapType', 'butt', {
    butt: 'strokeStyleButtCap',
    round: 'strokeStyleRoundCap',
    square: 'strokeStyleSquareCap',
});
exports.strokeStyleLineJoinType = (0, helpers_1.createEnum)('strokeStyleLineJoinType', 'miter', {
    miter: 'strokeStyleMiterJoin',
    round: 'strokeStyleRoundJoin',
    bevel: 'strokeStyleBevelJoin',
});
exports.strokeStyleLineAlignment = (0, helpers_1.createEnum)('strokeStyleLineAlignment', 'inside', {
    inside: 'strokeStyleAlignInside',
    center: 'strokeStyleAlignCenter',
    outside: 'strokeStyleAlignOutside',
});
exports.BlrM = (0, helpers_1.createEnum)('BlrM', 'spin', {
    spin: 'Spn ',
    zoom: 'Zm  ',
});
exports.BlrQ = (0, helpers_1.createEnum)('BlrQ', 'good', {
    draft: 'Drft',
    good: 'Gd  ',
    best: 'Bst ',
});
exports.SmBM = (0, helpers_1.createEnum)('SmBM', 'normal', {
    normal: 'SBMN',
    'edge only': 'SBME',
    'overlay edge': 'SBMO',
});
exports.SmBQ = (0, helpers_1.createEnum)('SmBQ', 'medium', {
    low: 'SBQL',
    medium: 'SBQM',
    high: 'SBQH',
});
exports.DspM = (0, helpers_1.createEnum)('DspM', 'stretch to fit', {
    'stretch to fit': 'StrF',
    'tile': 'Tile',
});
exports.UndA = (0, helpers_1.createEnum)('UndA', 'repeat edge pixels', {
    'wrap around': 'WrpA',
    'repeat edge pixels': 'RptE',
});
exports.Cnvr = (0, helpers_1.createEnum)('Cnvr', 'rectangular to polar', {
    'rectangular to polar': 'RctP',
    'polar to rectangular': 'PlrR',
});
exports.RplS = (0, helpers_1.createEnum)('RplS', 'medium', {
    small: 'Sml ',
    medium: 'Mdm ',
    large: 'Lrg ',
});
exports.SphM = (0, helpers_1.createEnum)('SphM', 'normal', {
    'normal': 'Nrml',
    'horizontal only': 'HrzO',
    'vertical only': 'VrtO',
});
exports.Wvtp = (0, helpers_1.createEnum)('Wvtp', 'sine', {
    sine: 'WvSn',
    triangle: 'WvTr',
    square: 'WvSq',
});
exports.ZZTy = (0, helpers_1.createEnum)('ZZTy', 'pond ripples', {
    'around center': 'ArnC',
    'out from center': 'OtFr',
    'pond ripples': 'PndR',
});
exports.Dstr = (0, helpers_1.createEnum)('Dstr', 'uniform', {
    uniform: 'Unfr',
    gaussian: 'Gsn ',
});
exports.Chnl = (0, helpers_1.createEnum)('Chnl', 'composite', {
    red: 'Rd  ',
    green: 'Grn ',
    blue: 'Bl  ',
    composite: 'Cmps',
});
exports.MztT = (0, helpers_1.createEnum)('MztT', 'fine dots', {
    'fine dots': 'FnDt',
    'medium dots': 'MdmD',
    'grainy dots': 'GrnD',
    'coarse dots': 'CrsD',
    'short lines': 'ShrL',
    'medium lines': 'MdmL',
    'long lines': 'LngL',
    'short strokes': 'ShSt',
    'medium strokes': 'MdmS',
    'long strokes': 'LngS',
});
exports.Lns = (0, helpers_1.createEnum)('Lns ', '50-300mm zoom', {
    '50-300mm zoom': 'Zm  ',
    '32mm prime': 'Nkn ',
    '105mm prime': 'Nkn1',
    'movie prime': 'PnVs',
});
exports.blurType = (0, helpers_1.createEnum)('blurType', 'gaussian blur', {
    'gaussian blur': 'GsnB',
    'lens blur': 'lensBlur',
    'motion blur': 'MtnB',
});
exports.DfsM = (0, helpers_1.createEnum)('DfsM', 'normal', {
    'normal': 'Nrml',
    'darken only': 'DrkO',
    'lighten only': 'LghO',
    'anisotropic': 'anisotropic',
});
exports.ExtT = (0, helpers_1.createEnum)('ExtT', 'blocks', {
    blocks: 'Blks',
    pyramids: 'Pyrm',
});
exports.ExtR = (0, helpers_1.createEnum)('ExtR', 'random', {
    random: 'Rndm',
    'level-based': 'LvlB',
});
exports.FlCl = (0, helpers_1.createEnum)('FlCl', 'background color', {
    'background color': 'FlBc',
    'foreground color': 'FlFr',
    'inverse image': 'FlIn',
    'unaltered image': 'FlSm',
});
exports.CntE = (0, helpers_1.createEnum)('CntE', 'upper', {
    lower: 'Lwr ',
    upper: 'Upr ',
});
exports.WndM = (0, helpers_1.createEnum)('WndM', 'wind', {
    wind: 'Wnd ',
    blast: 'Blst',
    stagger: 'Stgr',
});
exports.Drct = (0, helpers_1.createEnum)('Drct', 'right', {
    left: 'Left',
    right: 'Rght',
});
exports.IntE = (0, helpers_1.createEnum)('IntE', 'odd lines', {
    'odd lines': 'ElmO',
    'even lines': 'ElmE',
});
exports.IntC = (0, helpers_1.createEnum)('IntC', 'interpolation', {
    duplication: 'CrtD',
    interpolation: 'CrtI',
});
exports.FlMd = (0, helpers_1.createEnum)('FlMd', 'wrap around', {
    'set to transparent': 'Bckg',
    'repeat edge pixels': 'Rpt ',
    'wrap around': 'Wrp ',
});
exports.prjM = (0, helpers_1.createEnum)('prjM', 'fisheye', {
    'fisheye': 'fisP',
    'perspective': 'perP',
    'auto': 'auto',
    'full spherical': 'fusP',
});
exports.presetKindType = (0, helpers_1.createEnum)('presetKindType', 'custom', {
    custom: 'presetKindCustom',
    default: 'presetKindDefault',
});

},{"./helpers":8,"./psdReader":13,"./psdWriter":14}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEffects = readEffects;
exports.writeEffects = writeEffects;
const helpers_1 = require("./helpers");
const psdReader_1 = require("./psdReader");
const psdWriter_1 = require("./psdWriter");
const bevelStyles = [
    undefined, 'outer bevel', 'inner bevel', 'emboss', 'pillow emboss', 'stroke emboss'
];
function readBlendMode(reader) {
    (0, psdReader_1.checkSignature)(reader, '8BIM');
    return helpers_1.toBlendMode[(0, psdReader_1.readSignature)(reader)] || 'normal';
}
function writeBlendMode(writer, mode) {
    (0, psdWriter_1.writeSignature)(writer, '8BIM');
    (0, psdWriter_1.writeSignature)(writer, helpers_1.fromBlendMode[mode] || 'norm');
}
function readFixedPoint8(reader) {
    return (0, psdReader_1.readUint8)(reader) / 0xff;
}
function writeFixedPoint8(writer, value) {
    (0, psdWriter_1.writeUint8)(writer, Math.round(value * 0xff) | 0);
}
function readEffects(reader) {
    const version = (0, psdReader_1.readUint16)(reader);
    if (version !== 0)
        throw new Error(`Invalid effects layer version: ${version}`);
    const effectsCount = (0, psdReader_1.readUint16)(reader);
    const effects = {};
    for (let i = 0; i < effectsCount; i++) {
        (0, psdReader_1.checkSignature)(reader, '8BIM');
        const type = (0, psdReader_1.readSignature)(reader);
        switch (type) {
            case 'cmnS': { // common state (see See Effects layer, common state info)
                const size = (0, psdReader_1.readUint32)(reader);
                const version = (0, psdReader_1.readUint32)(reader);
                const visible = !!(0, psdReader_1.readUint8)(reader);
                (0, psdReader_1.skipBytes)(reader, 2);
                if (size !== 7 || version !== 0 || !visible)
                    throw new Error(`Invalid effects common state`);
                break;
            }
            case 'dsdw': // drop shadow (see See Effects layer, drop shadow and inner shadow info)
            case 'isdw': { // inner shadow (see See Effects layer, drop shadow and inner shadow info)
                const blockSize = (0, psdReader_1.readUint32)(reader);
                const version = (0, psdReader_1.readUint32)(reader);
                if (blockSize !== 41 && blockSize !== 51)
                    throw new Error(`Invalid shadow size: ${blockSize}`);
                if (version !== 0 && version !== 2)
                    throw new Error(`Invalid shadow version: ${version}`);
                const size = (0, psdReader_1.readFixedPoint32)(reader);
                (0, psdReader_1.readFixedPoint32)(reader); // intensity
                const angle = (0, psdReader_1.readFixedPoint32)(reader);
                const distance = (0, psdReader_1.readFixedPoint32)(reader);
                const color = (0, psdReader_1.readColor)(reader);
                const blendMode = readBlendMode(reader);
                const enabled = !!(0, psdReader_1.readUint8)(reader);
                const useGlobalLight = !!(0, psdReader_1.readUint8)(reader);
                const opacity = readFixedPoint8(reader);
                if (blockSize >= 51)
                    (0, psdReader_1.readColor)(reader); // native color
                const shadowInfo = {
                    size: { units: 'Pixels', value: size },
                    distance: { units: 'Pixels', value: distance },
                    angle, color, blendMode, enabled, useGlobalLight, opacity
                };
                if (type === 'dsdw') {
                    effects.dropShadow = [shadowInfo];
                }
                else {
                    effects.innerShadow = [shadowInfo];
                }
                break;
            }
            case 'oglw': { // outer glow (see See Effects layer, outer glow info)
                const blockSize = (0, psdReader_1.readUint32)(reader);
                const version = (0, psdReader_1.readUint32)(reader);
                if (blockSize !== 32 && blockSize !== 42)
                    throw new Error(`Invalid outer glow size: ${blockSize}`);
                if (version !== 0 && version !== 2)
                    throw new Error(`Invalid outer glow version: ${version}`);
                const size = (0, psdReader_1.readFixedPoint32)(reader);
                (0, psdReader_1.readFixedPoint32)(reader); // intensity
                const color = (0, psdReader_1.readColor)(reader);
                const blendMode = readBlendMode(reader);
                const enabled = !!(0, psdReader_1.readUint8)(reader);
                const opacity = readFixedPoint8(reader);
                if (blockSize >= 42)
                    (0, psdReader_1.readColor)(reader); // native color
                effects.outerGlow = {
                    size: { units: 'Pixels', value: size },
                    color, blendMode, enabled, opacity
                };
                break;
            }
            case 'iglw': { // inner glow (see See Effects layer, inner glow info)
                const blockSize = (0, psdReader_1.readUint32)(reader);
                const version = (0, psdReader_1.readUint32)(reader);
                if (blockSize !== 32 && blockSize !== 43)
                    throw new Error(`Invalid inner glow size: ${blockSize}`);
                if (version !== 0 && version !== 2)
                    throw new Error(`Invalid inner glow version: ${version}`);
                const size = (0, psdReader_1.readFixedPoint32)(reader);
                (0, psdReader_1.readFixedPoint32)(reader); // intensity
                const color = (0, psdReader_1.readColor)(reader);
                const blendMode = readBlendMode(reader);
                const enabled = !!(0, psdReader_1.readUint8)(reader);
                const opacity = readFixedPoint8(reader);
                if (blockSize >= 43) {
                    (0, psdReader_1.readUint8)(reader); // inverted
                    (0, psdReader_1.readColor)(reader); // native color
                }
                effects.innerGlow = {
                    size: { units: 'Pixels', value: size },
                    color, blendMode, enabled, opacity
                };
                break;
            }
            case 'bevl': { // bevel (see See Effects layer, bevel info)
                const blockSize = (0, psdReader_1.readUint32)(reader);
                const version = (0, psdReader_1.readUint32)(reader);
                if (blockSize !== 58 && blockSize !== 78)
                    throw new Error(`Invalid bevel size: ${blockSize}`);
                if (version !== 0 && version !== 2)
                    throw new Error(`Invalid bevel version: ${version}`);
                const angle = (0, psdReader_1.readFixedPoint32)(reader);
                const strength = (0, psdReader_1.readFixedPoint32)(reader);
                const size = (0, psdReader_1.readFixedPoint32)(reader);
                const highlightBlendMode = readBlendMode(reader);
                const shadowBlendMode = readBlendMode(reader);
                const highlightColor = (0, psdReader_1.readColor)(reader);
                const shadowColor = (0, psdReader_1.readColor)(reader);
                const style = bevelStyles[(0, psdReader_1.readUint8)(reader)] || 'inner bevel';
                const highlightOpacity = readFixedPoint8(reader);
                const shadowOpacity = readFixedPoint8(reader);
                const enabled = !!(0, psdReader_1.readUint8)(reader);
                const useGlobalLight = !!(0, psdReader_1.readUint8)(reader);
                const direction = (0, psdReader_1.readUint8)(reader) ? 'down' : 'up';
                if (blockSize >= 78) {
                    (0, psdReader_1.readColor)(reader); // real highlight color
                    (0, psdReader_1.readColor)(reader); // real shadow color
                }
                effects.bevel = {
                    size: { units: 'Pixels', value: size },
                    angle, strength, highlightBlendMode, shadowBlendMode, highlightColor, shadowColor,
                    style, highlightOpacity, shadowOpacity, enabled, useGlobalLight, direction,
                };
                break;
            }
            case 'sofi': { // solid fill (Photoshop 7.0) (see See Effects layer, solid fill (added in Photoshop 7.0))
                const size = (0, psdReader_1.readUint32)(reader);
                const version = (0, psdReader_1.readUint32)(reader);
                if (size !== 34)
                    throw new Error(`Invalid effects solid fill info size: ${size}`);
                if (version !== 2)
                    throw new Error(`Invalid effects solid fill info version: ${version}`);
                const blendMode = readBlendMode(reader);
                const color = (0, psdReader_1.readColor)(reader);
                const opacity = readFixedPoint8(reader);
                const enabled = !!(0, psdReader_1.readUint8)(reader);
                (0, psdReader_1.readColor)(reader); // native color
                effects.solidFill = [{ blendMode, color, opacity, enabled }];
                break;
            }
            default:
                throw new Error(`Invalid effect type: '${type}'`);
        }
    }
    return effects;
}
function writeShadowInfo(writer, shadow) {
    var _a;
    (0, psdWriter_1.writeUint32)(writer, 51);
    (0, psdWriter_1.writeUint32)(writer, 2);
    (0, psdWriter_1.writeFixedPoint32)(writer, shadow.size && shadow.size.value || 0);
    (0, psdWriter_1.writeFixedPoint32)(writer, 0); // intensity
    (0, psdWriter_1.writeFixedPoint32)(writer, shadow.angle || 0);
    (0, psdWriter_1.writeFixedPoint32)(writer, shadow.distance && shadow.distance.value || 0);
    (0, psdWriter_1.writeColor)(writer, shadow.color);
    writeBlendMode(writer, shadow.blendMode);
    (0, psdWriter_1.writeUint8)(writer, shadow.enabled ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, shadow.useGlobalLight ? 1 : 0);
    writeFixedPoint8(writer, (_a = shadow.opacity) !== null && _a !== void 0 ? _a : 1);
    (0, psdWriter_1.writeColor)(writer, shadow.color); // native color
}
function writeEffects(writer, effects) {
    var _a, _b, _c, _d, _e, _f;
    const dropShadow = (_a = effects.dropShadow) === null || _a === void 0 ? void 0 : _a[0];
    const innerShadow = (_b = effects.innerShadow) === null || _b === void 0 ? void 0 : _b[0];
    const outerGlow = effects.outerGlow;
    const innerGlow = effects.innerGlow;
    const bevel = effects.bevel;
    const solidFill = (_c = effects.solidFill) === null || _c === void 0 ? void 0 : _c[0];
    let count = 1;
    if (dropShadow)
        count++;
    if (innerShadow)
        count++;
    if (outerGlow)
        count++;
    if (innerGlow)
        count++;
    if (bevel)
        count++;
    if (solidFill)
        count++;
    (0, psdWriter_1.writeUint16)(writer, 0);
    (0, psdWriter_1.writeUint16)(writer, count);
    (0, psdWriter_1.writeSignature)(writer, '8BIM');
    (0, psdWriter_1.writeSignature)(writer, 'cmnS');
    (0, psdWriter_1.writeUint32)(writer, 7); // size
    (0, psdWriter_1.writeUint32)(writer, 0); // version
    (0, psdWriter_1.writeUint8)(writer, 1); // visible
    (0, psdWriter_1.writeZeros)(writer, 2);
    if (dropShadow) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'dsdw');
        writeShadowInfo(writer, dropShadow);
    }
    if (innerShadow) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'isdw');
        writeShadowInfo(writer, innerShadow);
    }
    if (outerGlow) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'oglw');
        (0, psdWriter_1.writeUint32)(writer, 42);
        (0, psdWriter_1.writeUint32)(writer, 2);
        (0, psdWriter_1.writeFixedPoint32)(writer, ((_d = outerGlow.size) === null || _d === void 0 ? void 0 : _d.value) || 0);
        (0, psdWriter_1.writeFixedPoint32)(writer, 0); // intensity
        (0, psdWriter_1.writeColor)(writer, outerGlow.color);
        writeBlendMode(writer, outerGlow.blendMode);
        (0, psdWriter_1.writeUint8)(writer, outerGlow.enabled ? 1 : 0);
        writeFixedPoint8(writer, outerGlow.opacity || 0);
        (0, psdWriter_1.writeColor)(writer, outerGlow.color);
    }
    if (innerGlow) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'iglw');
        (0, psdWriter_1.writeUint32)(writer, 43);
        (0, psdWriter_1.writeUint32)(writer, 2);
        (0, psdWriter_1.writeFixedPoint32)(writer, ((_e = innerGlow.size) === null || _e === void 0 ? void 0 : _e.value) || 0);
        (0, psdWriter_1.writeFixedPoint32)(writer, 0); // intensity
        (0, psdWriter_1.writeColor)(writer, innerGlow.color);
        writeBlendMode(writer, innerGlow.blendMode);
        (0, psdWriter_1.writeUint8)(writer, innerGlow.enabled ? 1 : 0);
        writeFixedPoint8(writer, innerGlow.opacity || 0);
        (0, psdWriter_1.writeUint8)(writer, 0); // inverted
        (0, psdWriter_1.writeColor)(writer, innerGlow.color);
    }
    if (bevel) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'bevl');
        (0, psdWriter_1.writeUint32)(writer, 78);
        (0, psdWriter_1.writeUint32)(writer, 2);
        (0, psdWriter_1.writeFixedPoint32)(writer, bevel.angle || 0);
        (0, psdWriter_1.writeFixedPoint32)(writer, bevel.strength || 0);
        (0, psdWriter_1.writeFixedPoint32)(writer, ((_f = bevel.size) === null || _f === void 0 ? void 0 : _f.value) || 0);
        writeBlendMode(writer, bevel.highlightBlendMode);
        writeBlendMode(writer, bevel.shadowBlendMode);
        (0, psdWriter_1.writeColor)(writer, bevel.highlightColor);
        (0, psdWriter_1.writeColor)(writer, bevel.shadowColor);
        const style = bevelStyles.indexOf(bevel.style);
        (0, psdWriter_1.writeUint8)(writer, style <= 0 ? 1 : style);
        writeFixedPoint8(writer, bevel.highlightOpacity || 0);
        writeFixedPoint8(writer, bevel.shadowOpacity || 0);
        (0, psdWriter_1.writeUint8)(writer, bevel.enabled ? 1 : 0);
        (0, psdWriter_1.writeUint8)(writer, bevel.useGlobalLight ? 1 : 0);
        (0, psdWriter_1.writeUint8)(writer, bevel.direction === 'down' ? 1 : 0);
        (0, psdWriter_1.writeColor)(writer, bevel.highlightColor);
        (0, psdWriter_1.writeColor)(writer, bevel.shadowColor);
    }
    if (solidFill) {
        (0, psdWriter_1.writeSignature)(writer, '8BIM');
        (0, psdWriter_1.writeSignature)(writer, 'sofi');
        (0, psdWriter_1.writeUint32)(writer, 34);
        (0, psdWriter_1.writeUint32)(writer, 2);
        writeBlendMode(writer, solidFill.blendMode);
        (0, psdWriter_1.writeColor)(writer, solidFill.color);
        writeFixedPoint8(writer, solidFill.opacity || 0);
        (0, psdWriter_1.writeUint8)(writer, solidFill.enabled ? 1 : 0);
        (0, psdWriter_1.writeColor)(writer, solidFill.color);
    }
}

},{"./helpers":8,"./psdReader":13,"./psdWriter":14}],6:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEngineData = parseEngineData;
exports.serializeEngineData = serializeEngineData;
function isWhitespace(char) {
    // ' ', '\n', '\r', '\t'
    return char === 32 || char === 10 || char === 13 || char === 9;
}
function isNumber(char) {
    // 0123456789.-
    return (char >= 48 && char <= 57) || char === 46 || char === 45;
}
function parseEngineData(data) {
    let index = 0;
    function skipWhitespace() {
        while (index < data.length && isWhitespace(data[index])) {
            index++;
        }
    }
    function getTextByte() {
        let byte = data[index];
        index++;
        if (byte === 92) { // \
            byte = data[index];
            index++;
        }
        return byte;
    }
    function getText() {
        let result = '';
        if (data[index] === 41) { // )
            index++;
            return result;
        }
        // Strings start with utf-16 BOM
        if (data[index] !== 0xFE || data[index + 1] !== 0xFF) {
            throw new Error('Invalid utf-16 BOM');
        }
        index += 2;
        // ), ( and \ characters are escaped in ascii manner, remove the escapes before interpreting
        // the bytes as utf-16
        while (index < data.length && data[index] !== 41) { // )
            const high = getTextByte();
            const low = getTextByte();
            const char = (high << 8) | low;
            result += String.fromCharCode(char);
        }
        index++;
        return result;
    }
    let root = null;
    const stack = [];
    function pushContainer(value) {
        if (!stack.length) {
            stack.push(value);
            root = value;
        }
        else {
            pushValue(value);
            stack.push(value);
        }
    }
    function pushValue(value) {
        if (!stack.length)
            throw new Error('Invalid data');
        const top = stack[stack.length - 1];
        if (typeof top === 'string') {
            stack[stack.length - 2][top] = value;
            pop();
        }
        else if (Array.isArray(top)) {
            top.push(value);
        }
        else {
            throw new Error('Invalid data');
        }
    }
    function pushProperty(name) {
        if (!stack.length)
            pushContainer({});
        const top = stack[stack.length - 1];
        if (top && typeof top === 'string') {
            if (name === 'nil') {
                pushValue(null);
            }
            else {
                pushValue(`/${name}`);
            }
        }
        else if (top && typeof top === 'object') {
            stack.push(name);
        }
        else {
            throw new Error('Invalid data');
        }
    }
    function pop() {
        if (!stack.length)
            throw new Error('Invalid data');
        stack.pop();
    }
    skipWhitespace();
    let dataLength = data.length;
    while (dataLength > 0 && data[dataLength - 1] === 0)
        dataLength--; // trim 0 bytes from end
    while (index < dataLength) {
        const i = index;
        const char = data[i];
        if (char === 60 && data[i + 1] === 60) { // <<
            index += 2;
            pushContainer({});
        }
        else if (char === 62 && data[i + 1] === 62) { // >>
            index += 2;
            pop();
        }
        else if (char === 47) { // /
            index += 1;
            const start = index;
            while (index < data.length && !isWhitespace(data[index])) {
                index++;
            }
            let name = '';
            for (let i = start; i < index; i++) {
                name += String.fromCharCode(data[i]);
            }
            pushProperty(name);
        }
        else if (char === 40) { // (
            index += 1;
            pushValue(getText());
        }
        else if (char === 91) { // [
            index += 1;
            pushContainer([]);
        }
        else if (char === 93) { // ]
            index += 1;
            pop();
        }
        else if (char === 110 && data[i + 1] === 117 && data[i + 2] === 108 && data[i + 3] === 108) { // null
            index += 4;
            pushValue(null);
        }
        else if (char === 116 && data[i + 1] === 114 && data[i + 2] === 117 && data[i + 3] === 101) { // true
            index += 4;
            pushValue(true);
        }
        else if (char === 102 && data[i + 1] === 97 && data[i + 2] === 108 && data[i + 3] === 115 && data[i + 4] === 101) { // false
            index += 5;
            pushValue(false);
        }
        else if (isNumber(char)) {
            let value = '';
            while (index < data.length && isNumber(data[index])) {
                value += String.fromCharCode(data[index]);
                index++;
            }
            pushValue(parseFloat(value));
        }
        else {
            index += 1;
            console.log(`Invalid token '${String.fromCharCode(char)}' (${char}) at ${index}`
            // + ` near '${String.fromCharCode.apply(null, data.slice(index - 10, index + 20) as any)}'`
            // + ` data [${Array.from(data.slice(index - 10, index + 20)).join(', ')}]`
            );
            // throw new Error(`Invalid token ${String.fromCharCode(char)} at ${index}`);
        }
        skipWhitespace();
    }
    return root;
}
const floatKeys = [
    'Axis', 'XY', 'Zone', 'WordSpacing', 'FirstLineIndent', 'GlyphSpacing', 'StartIndent', 'EndIndent', 'SpaceBefore',
    'SpaceAfter', 'LetterSpacing', 'Values', 'GridSize', 'GridLeading', 'PointBase', 'BoxBounds', 'TransformPoint0', 'TransformPoint1',
    'TransformPoint2', 'FontSize', 'Leading', 'HorizontalScale', 'VerticalScale', 'BaselineShift', 'Tsume',
    'OutlineWidth', 'AutoLeading',
];
const intArrays = ['RunLengthArray'];
// TODO: handle /nil
function serializeEngineData(data, condensed = false) {
    let buffer = new Uint8Array(1024);
    let offset = 0;
    let indent = 0;
    function write(value) {
        if (offset >= buffer.length) {
            const newBuffer = new Uint8Array(buffer.length * 2);
            newBuffer.set(buffer);
            buffer = newBuffer;
        }
        buffer[offset] = value;
        offset++;
    }
    function writeString(value) {
        for (let i = 0; i < value.length; i++) {
            write(value.charCodeAt(i));
        }
    }
    function writeIndent() {
        if (condensed) {
            writeString(' ');
        }
        else {
            for (let i = 0; i < indent; i++) {
                writeString('\t');
            }
        }
    }
    function writeProperty(key, value) {
        writeIndent();
        writeString(`/${key}`);
        writeValue(value, key, true);
        if (!condensed)
            writeString('\n');
    }
    function serializeInt(value) {
        return value.toString();
    }
    function serializeFloat(value) {
        return value.toFixed(5)
            .replace(/(\d)0+$/g, '$1')
            .replace(/^0+\.([1-9])/g, '.$1')
            .replace(/^-0+\.0(\d)/g, '-.0$1');
    }
    function serializeNumber(value, key) {
        const isFloat = (key && floatKeys.indexOf(key) !== -1) || (value | 0) !== value;
        return isFloat ? serializeFloat(value) : serializeInt(value);
    }
    function getKeys(value) {
        const keys = Object.keys(value);
        if (keys.indexOf('98') !== -1)
            keys.unshift(...keys.splice(keys.indexOf('98'), 1));
        if (keys.indexOf('99') !== -1)
            keys.unshift(...keys.splice(keys.indexOf('99'), 1));
        return keys;
    }
    function writeStringByte(value) {
        if (value === 40 || value === 41 || value === 92) { // ( ) \
            write(92); // \
        }
        write(value);
    }
    function writeValue(value, key, inProperty = false) {
        function writePrefix() {
            if (inProperty) {
                writeString(' ');
            }
            else {
                writeIndent();
            }
        }
        if (value === null) {
            writePrefix();
            writeString(condensed ? '/nil' : 'null');
        }
        else if (typeof value === 'number') {
            writePrefix();
            writeString(serializeNumber(value, key));
        }
        else if (typeof value === 'boolean') {
            writePrefix();
            writeString(value ? 'true' : 'false');
        }
        else if (typeof value === 'string') {
            writePrefix();
            if ((key === '99' || key === '98') && value.charAt(0) === '/') {
                writeString(value);
            }
            else {
                writeString('(');
                write(0xfe);
                write(0xff);
                for (let i = 0; i < value.length; i++) {
                    const code = value.charCodeAt(i);
                    writeStringByte((code >> 8) & 0xff);
                    writeStringByte(code & 0xff);
                }
                writeString(')');
            }
        }
        else if (Array.isArray(value)) {
            writePrefix();
            if (value.every(x => typeof x === 'number')) {
                writeString('[');
                const intArray = intArrays.indexOf(key) !== -1;
                for (const x of value) {
                    writeString(' ');
                    writeString(intArray ? serializeNumber(x) : serializeFloat(x));
                }
                writeString(' ]');
            }
            else {
                writeString('[');
                if (!condensed)
                    writeString('\n');
                for (const x of value) {
                    writeValue(x, key);
                    if (!condensed)
                        writeString('\n');
                }
                writeIndent();
                writeString(']');
            }
        }
        else if (typeof value === 'object') {
            if (inProperty && !condensed)
                writeString('\n');
            writeIndent();
            writeString('<<');
            if (!condensed)
                writeString('\n');
            indent++;
            for (const key of getKeys(value)) {
                writeProperty(key, value[key]);
            }
            indent--;
            writeIndent();
            writeString('>>');
        }
        return undefined;
    }
    if (condensed) {
        if (typeof data === 'object') {
            for (const key of getKeys(data)) {
                writeProperty(key, data[key]);
            }
        }
    }
    else {
        writeString('\n\n');
        writeValue(data);
    }
    return buffer.slice(0, offset);
}

},{}],7:[function(require,module,exports){
"use strict";
/// Engine data 2 experiments
// /test/engineData2.json:1109 is character codes
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEngineData2 = decodeEngineData2;
const keysColor = {
    '0': {
        uproot: true,
        children: {
            '0': { name: 'Type' },
            '1': { name: 'Values' },
        },
    },
};
const keysStyleSheet = {
    '0': { name: 'Font' },
    '1': { name: 'FontSize' },
    '2': { name: 'FauxBold' },
    '3': { name: 'FauxItalic' },
    '4': { name: 'AutoLeading' },
    '5': { name: 'Leading' },
    '6': { name: 'HorizontalScale' },
    '7': { name: 'VerticalScale' },
    '8': { name: 'Tracking' },
    '9': { name: 'BaselineShift' },
    // '10': ???
    '11': { name: 'Kerning?' }, // different value than EngineData (0 - numerical value, 1 - metric, 2 - optical)
    '12': { name: 'FontCaps' },
    '13': { name: 'FontBaseline' },
    '15': { name: 'Strikethrough?' }, // number instead of bool
    '16': { name: 'Underline?' }, // number instead of bool
    '18': { name: 'Ligatures' },
    '19': { name: 'DLigatures' },
    // '20': ???
    // '21': ???
    // '22': ???
    '23': { name: 'Fractions' }, // not present in EngineData
    '24': { name: 'Ordinals' }, // not present in EngineData
    // '25': ???
    // '26': ???
    // '27': ???
    '28': { name: 'StylisticAlternates' }, // not present in EngineData
    // '29': ???
    '30': { name: 'OldStyle?' }, // OpenType > OldStyle, number instead of bool, not present in EngineData
    '35': { name: 'BaselineDirection' },
    '38': { name: 'Language' },
    '52': { name: 'NoBreak' },
    '53': { name: 'FillColor', children: keysColor },
    '54': { name: 'StrokeColor', children: keysColor },
    '55': { children: { '99': { uproot: true } } },
    // '68': ???
    // '70': ???
    // '71': ???
    // '72': ???
    // '73': ???
    '79': { children: keysColor },
    // '85': ???
    // '87': ???
    // '88': ???
};
const keysParagraph = {
    '0': { name: 'Justification' },
    '1': { name: 'FirstLineIndent' },
    '2': { name: 'StartIndent' },
    '3': { name: 'EndIndent' },
    '4': { name: 'SpaceBefore' },
    '5': { name: 'SpaceAfter' },
    '7': { name: 'AutoLeading' },
    '9': { name: 'AutoHyphenate' },
    '10': { name: 'HyphenatedWordSize' },
    '11': { name: 'PreHyphen' },
    '12': { name: 'PostHyphen' },
    '13': { name: 'ConsecutiveHyphens?' }, // different value than EngineData
    '14': { name: 'Zone' },
    '15': { name: 'HypenateCapitalizedWords' }, // not present in EngineData
    '17': { name: 'WordSpacing' },
    '18': { name: 'LetterSpacing' },
    '19': { name: 'GlyphSpacing' },
    '32': { name: 'StyleSheet', children: keysStyleSheet },
};
const keysStyleSheetData = {
    name: 'StyleSheetData',
    children: keysStyleSheet,
};
const keysRoot = {
    '0': {
        name: 'ResourceDict',
        children: {
            '1': {
                name: 'FontSet',
                children: {
                    '0': {
                        uproot: true,
                        children: {
                            '0': {
                                uproot: true,
                                children: {
                                    '0': {
                                        uproot: true,
                                        children: {
                                            '0': { name: 'Name' },
                                            '2': { name: 'FontType' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '2': {
                name: '2',
                children: {},
            },
            '3': {
                name: 'MojiKumiSet',
                children: {
                    '0': {
                        uproot: true,
                        children: {
                            '0': {
                                uproot: true,
                                children: {
                                    '0': { name: 'InternalName' },
                                },
                            },
                        },
                    },
                },
            },
            '4': {
                name: 'KinsokuSet',
                children: {
                    '0': {
                        uproot: true,
                        children: {
                            '0': {
                                uproot: true,
                                children: {
                                    '0': { name: 'Name' },
                                    '5': {
                                        uproot: true,
                                        children: {
                                            '0': { name: 'NoStart' },
                                            '1': { name: 'NoEnd' },
                                            '2': { name: 'Keep' },
                                            '3': { name: 'Hanging' },
                                            '4': { name: 'Name' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '5': {
                name: 'StyleSheetSet',
                children: {
                    '0': {
                        uproot: true,
                        children: {
                            '0': {
                                uproot: true,
                                children: {
                                    '0': { name: 'Name' },
                                    '6': keysStyleSheetData,
                                },
                            },
                        },
                    },
                },
            },
            '6': {
                name: 'ParagraphSheetSet',
                children: {
                    '0': {
                        uproot: true,
                        children: {
                            '0': {
                                uproot: true,
                                children: {
                                    '0': { name: 'Name' },
                                    '5': {
                                        name: 'Properties',
                                        children: keysParagraph,
                                    },
                                    '6': { name: 'DefaultStyleSheet' },
                                },
                            },
                        },
                    },
                },
            },
            '8': {
                name: 'TextFrameSet',
                children: {
                    '0': {
                        uproot: true,
                        children: {
                            '0': {
                                name: 'path',
                                children: {
                                    '0': { name: 'name' },
                                    '1': {
                                        name: 'bezierCurve',
                                        children: {
                                            '0': { name: 'controlPoints' },
                                        },
                                    },
                                    '2': {
                                        name: 'data',
                                        children: {
                                            '0': { name: 'type' },
                                            '1': { name: 'orientation' },
                                            '2': { name: 'frameMatrix' },
                                            '4': { name: '4' },
                                            '6': { name: 'textRange' },
                                            '7': { name: 'rowGutter' },
                                            '8': { name: 'columnGutter' },
                                            '9': { name: '9' },
                                            '10': {
                                                name: 'baselineAlignment',
                                                children: {
                                                    '0': { name: 'flag' },
                                                    '1': { name: 'min' },
                                                },
                                            },
                                            '11': {
                                                name: 'pathData',
                                                children: {
                                                    '1': { name: '1' },
                                                    '0': { name: 'reversed' },
                                                    '2': { name: '2' },
                                                    '3': { name: '3' },
                                                    '4': { name: 'spacing' },
                                                    '5': { name: '5' },
                                                    '6': { name: '6' },
                                                    '7': { name: '7' },
                                                    '18': { name: '18' },
                                                },
                                            },
                                            '12': { name: '12' },
                                            '13': { name: '13' },
                                        },
                                    },
                                    '3': { name: '3' },
                                    '97': { name: 'uuid' },
                                },
                            },
                        },
                    },
                },
            },
            '9': {
                name: 'Predefined',
                children: {
                    '0': {
                        children: { '0': { uproot: true } },
                    },
                    '1': {
                        children: { '0': { uproot: true } },
                    },
                },
            },
        },
    },
    '1': {
        name: 'EngineDict',
        children: {
            '0': {
                name: '0',
                children: {
                    // 0: ???
                    // 1: ???
                    // 2: ???
                    '3': { name: 'SuperscriptSize' },
                    '4': { name: 'SuperscriptPosition' },
                    '5': { name: 'SubscriptSize' },
                    '6': { name: 'SubscriptPosition' },
                    '7': { name: 'SmallCapSize' },
                    '8': { name: 'UseFractionalGlyphWidths' }, // ???
                    '15': { children: { '0': { uproot: true } } },
                    // 16: ???
                    // 17: ???
                },
            },
            '1': {
                name: 'Editors?', // layer.text.index is specifying the index of the editor related to the layer
                children: {
                    '0': {
                        name: 'Editor',
                        children: {
                            '0': { name: 'Text' },
                            '5': {
                                name: 'ParagraphRun',
                                children: {
                                    '0': {
                                        name: 'RunArray',
                                        children: {
                                            '0': {
                                                name: 'ParagraphSheet',
                                                children: {
                                                    '0': {
                                                        uproot: true,
                                                        children: {
                                                            '0': { name: '0' },
                                                            '5': {
                                                                name: '5',
                                                                children: keysParagraph,
                                                            },
                                                            '6': { name: '6' },
                                                        },
                                                    },
                                                },
                                            },
                                            '1': { name: 'RunLength' },
                                        },
                                    },
                                },
                            },
                            '6': {
                                name: 'StyleRun',
                                children: {
                                    '0': {
                                        name: 'RunArray',
                                        children: {
                                            '0': {
                                                name: 'StyleSheet',
                                                children: {
                                                    '0': {
                                                        uproot: true,
                                                        children: {
                                                            '6': keysStyleSheetData,
                                                        },
                                                    },
                                                },
                                            },
                                            '1': { name: 'RunLength' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    '1': {
                        name: 'FontVectorData ???',
                        // children: {
                        // 	'0': {},
                        // 	'2': {
                        // 		// '5'
                        // 		// '6'
                        // 	},
                        // }
                        //     "1": [ // this is probably bounding box? there seem to be many of them nested
                        //       0,
                        //       0,
                        //       999,
                        //       176.30014
                        //     ],
                        // various types: /PC, /F, /R, /L, /S, /G
                    },
                },
            },
            '2': {
                name: 'StyleSheet',
                children: keysStyleSheet,
            },
            '3': {
                name: 'ParagraphSheet',
                children: keysParagraph,
            },
        },
    },
};
function decodeObj(obj, keys) {
    var _a, _b;
    if (obj === null)
        return obj;
    if (Array.isArray(obj))
        return obj.map(x => decodeObj(x, keys));
    if (typeof obj !== 'object')
        return obj;
    let result = {};
    for (const key of Object.keys(obj)) {
        if (keys[key]) {
            if (keys[key].uproot) {
                if (key !== '99')
                    result = decodeObj(obj[key], (_a = keys[key].children) !== null && _a !== void 0 ? _a : {});
                if (obj['99'])
                    result._type = obj['99'];
                break;
            }
            else {
                result[keys[key].name || key] = decodeObj(obj[key], (_b = keys[key].children) !== null && _b !== void 0 ? _b : {});
            }
        }
        else if (key === '99') {
            result._type = obj[key];
        }
        else {
            result[key] = decodeObj(obj[key], {});
        }
    }
    return result;
}
function decodeEngineData2(data) {
    return decodeObj(data, keysRoot);
}

},{}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createImageData = exports.createCanvas = exports.MaskParams = exports.LayerMaskFlags = exports.ColorSpace = exports.largeAdditionalInfoKeys = exports.layerColors = exports.toBlendMode = exports.fromBlendMode = exports.RAW_IMAGE_DATA = exports.MOCK_HANDLERS = void 0;
exports.revMap = revMap;
exports.createEnum = createEnum;
exports.offsetForChannel = offsetForChannel;
exports.clamp = clamp;
exports.hasAlpha = hasAlpha;
exports.resetImageData = resetImageData;
exports.imageDataToCanvas = imageDataToCanvas;
exports.decodeBitmap = decodeBitmap;
exports.writeDataRaw = writeDataRaw;
exports.writeDataRLE = writeDataRLE;
exports.writeDataZipWithoutPrediction = writeDataZipWithoutPrediction;
exports.createCanvasFromData = createCanvasFromData;
exports.initializeCanvas = initializeCanvas;
const pako_1 = require("pako");
const jpeg_1 = require("./jpeg");
exports.MOCK_HANDLERS = false;
exports.RAW_IMAGE_DATA = false;
exports.fromBlendMode = {};
exports.toBlendMode = {
    'pass': 'pass through',
    'norm': 'normal',
    'diss': 'dissolve',
    'dark': 'darken',
    'mul ': 'multiply',
    'idiv': 'color burn',
    'lbrn': 'linear burn',
    'dkCl': 'darker color',
    'lite': 'lighten',
    'scrn': 'screen',
    'div ': 'color dodge',
    'lddg': 'linear dodge',
    'lgCl': 'lighter color',
    'over': 'overlay',
    'sLit': 'soft light',
    'hLit': 'hard light',
    'vLit': 'vivid light',
    'lLit': 'linear light',
    'pLit': 'pin light',
    'hMix': 'hard mix',
    'diff': 'difference',
    'smud': 'exclusion',
    'fsub': 'subtract',
    'fdiv': 'divide',
    'hue ': 'hue',
    'sat ': 'saturation',
    'colr': 'color',
    'lum ': 'luminosity',
};
Object.keys(exports.toBlendMode).forEach(key => exports.fromBlendMode[exports.toBlendMode[key]] = key);
exports.layerColors = [
    'none', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray'
];
exports.largeAdditionalInfoKeys = [
    // from documentation
    'LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD',
    // from guessing
    'cinf',
];
function revMap(map) {
    const result = {};
    Object.keys(map).forEach(key => result[map[key]] = key);
    return result;
}
function createEnum(prefix, def, map) {
    const rev = revMap(map);
    const decode = (val) => {
        const value = val.split('.')[1];
        if (value && !rev[value]) {
            // Photoshop 2026 writes the long-form enum value instead of the historical 4-char code
            // (the map VALUE, e.g. 'BlnM.Nrml'). Two long-form shapes occur:
            //  - single-word modes use the map KEY verbatim:        'BlnM.normal'
            //  - multi-word modes use a camelCase id whose map key is space-separated:
            //    'BlnM.colorBurn' -> 'color burn'; normalize camelCase before giving up.
            if (Object.prototype.hasOwnProperty.call(map, value))
                return value;
            const spaced = value.replace(/([A-Z])/g, ' $1').toLowerCase();
            if (Object.prototype.hasOwnProperty.call(map, spaced))
                return spaced;
            throw new Error(`Unrecognized value for enum: '${val}'`);
        }
        return rev[value] || def;
    };
    const encode = (val) => {
        if (val && !map[val])
            throw new Error(`Invalid value for enum: '${val}'`);
        return `${prefix}.${val ? map[val] : map[def]}`;
    };
    return { decode, encode };
}
var ColorSpace;
(function (ColorSpace) {
    ColorSpace[ColorSpace["RGB"] = 0] = "RGB";
    ColorSpace[ColorSpace["HSB"] = 1] = "HSB";
    ColorSpace[ColorSpace["CMYK"] = 2] = "CMYK";
    ColorSpace[ColorSpace["Lab"] = 7] = "Lab";
    ColorSpace[ColorSpace["Grayscale"] = 8] = "Grayscale";
})(ColorSpace || (exports.ColorSpace = ColorSpace = {}));
var LayerMaskFlags;
(function (LayerMaskFlags) {
    LayerMaskFlags[LayerMaskFlags["PositionRelativeToLayer"] = 1] = "PositionRelativeToLayer";
    LayerMaskFlags[LayerMaskFlags["LayerMaskDisabled"] = 2] = "LayerMaskDisabled";
    LayerMaskFlags[LayerMaskFlags["InvertLayerMaskWhenBlending"] = 4] = "InvertLayerMaskWhenBlending";
    LayerMaskFlags[LayerMaskFlags["LayerMaskFromRenderingOtherData"] = 8] = "LayerMaskFromRenderingOtherData";
    LayerMaskFlags[LayerMaskFlags["MaskHasParametersAppliedToIt"] = 16] = "MaskHasParametersAppliedToIt";
})(LayerMaskFlags || (exports.LayerMaskFlags = LayerMaskFlags = {}));
var MaskParams;
(function (MaskParams) {
    MaskParams[MaskParams["UserMaskDensity"] = 1] = "UserMaskDensity";
    MaskParams[MaskParams["UserMaskFeather"] = 2] = "UserMaskFeather";
    MaskParams[MaskParams["VectorMaskDensity"] = 4] = "VectorMaskDensity";
    MaskParams[MaskParams["VectorMaskFeather"] = 8] = "VectorMaskFeather";
})(MaskParams || (exports.MaskParams = MaskParams = {}));
function offsetForChannel(channelId, cmyk) {
    switch (channelId) {
        case 0 /* ChannelID.Color0 */: return 0;
        case 1 /* ChannelID.Color1 */: return 1;
        case 2 /* ChannelID.Color2 */: return 2;
        case 3 /* ChannelID.Color3 */: return cmyk ? 3 : channelId + 1;
        case -1 /* ChannelID.Transparency */: return cmyk ? 4 : 3;
        default: return channelId + 1;
    }
}
function clamp(value, min, max) {
    return value < min ? min : (value > max ? max : value);
}
function hasAlpha(data) {
    const size = data.width * data.height * 4;
    for (let i = 3; i < size; i += 4) {
        if (data.data[i] !== 255) {
            return true;
        }
    }
    return false;
}
function resetImageData({ data }) {
    const alpha = (data instanceof Float32Array) ? 1.0 : ((data instanceof Uint16Array) ? 0xffff : 0xff);
    for (let p = 0, size = data.length | 0; p < size; p = (p + 4) | 0) {
        data[p + 0] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = alpha;
    }
}
function imageDataToCanvas(pixelData) {
    const canvas = (0, exports.createCanvas)(pixelData.width, pixelData.height);
    let imageData;
    if (pixelData.data instanceof Uint8ClampedArray) {
        imageData = pixelData;
    }
    else {
        imageData = (0, exports.createImageData)(pixelData.width, pixelData.height);
        const src = pixelData.data;
        const dst = imageData.data;
        if (src instanceof Float32Array) {
            for (let i = 0, size = src.length; i < size; i += 4) {
                dst[i + 0] = Math.round(Math.pow(src[i + 0], 1.0 / 2.2) * 255);
                dst[i + 1] = Math.round(Math.pow(src[i + 1], 1.0 / 2.2) * 255);
                dst[i + 2] = Math.round(Math.pow(src[i + 2], 1.0 / 2.2) * 255);
                dst[i + 3] = Math.round(src[i + 3] * 255);
            }
        }
        else {
            const shift = (src instanceof Uint16Array) ? 8 : 0;
            for (let i = 0, size = src.length; i < size; i++) {
                dst[i] = src[i] >>> shift;
            }
        }
    }
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas;
}
function decodeBitmap(input, output, width, height) {
    if (!(input instanceof Uint8Array || input instanceof Uint8ClampedArray))
        throw new Error('Invalid bit depth');
    for (let y = 0, p = 0, o = 0; y < height; y++) {
        for (let x = 0; x < width;) {
            let b = input[o++];
            for (let i = 0; i < 8 && x < width; i++, x++, p += 4) {
                const v = b & 0x80 ? 0 : 255;
                b = b << 1;
                output[p + 0] = v;
                output[p + 1] = v;
                output[p + 2] = v;
                output[p + 3] = 255;
            }
        }
    }
}
function writeDataRaw(data, offset, width, height) {
    if (!width || !height)
        return undefined;
    const array = new Uint8Array(width * height);
    for (let i = 0; i < array.length; i++) {
        array[i] = data.data[i * 4 + offset];
    }
    return array;
}
function writeDataRLE(buffer, { data, width, height }, offsets, large) {
    if (!width || !height)
        return undefined;
    const stride = (4 * width) | 0;
    let ol = 0;
    let o = (offsets.length * (large ? 4 : 2) * height) | 0;
    for (const offset of offsets) {
        for (let y = 0, p = offset | 0; y < height; y++) {
            const strideStart = (y * stride) | 0;
            const strideEnd = (strideStart + stride) | 0;
            const lastIndex = (strideEnd + offset - 4) | 0;
            const lastIndex2 = (lastIndex - 4) | 0;
            const startOffset = o;
            for (p = (strideStart + offset) | 0; p < strideEnd; p = (p + 4) | 0) {
                if (p < lastIndex2) {
                    let value1 = data[p];
                    p = (p + 4) | 0;
                    let value2 = data[p];
                    p = (p + 4) | 0;
                    let value3 = data[p];
                    if (value1 === value2 && value1 === value3) {
                        let count = 3;
                        while (count < 128 && p < lastIndex && data[(p + 4) | 0] === value1) {
                            count = (count + 1) | 0;
                            p = (p + 4) | 0;
                        }
                        buffer[o++] = 1 - count;
                        buffer[o++] = value1;
                    }
                    else {
                        const countIndex = o;
                        let writeLast = true;
                        let count = 1;
                        buffer[o++] = 0;
                        buffer[o++] = value1;
                        while (p < lastIndex && count < 128) {
                            p = (p + 4) | 0;
                            value1 = value2;
                            value2 = value3;
                            value3 = data[p];
                            if (value1 === value2 && value1 === value3) {
                                p = (p - 12) | 0;
                                writeLast = false;
                                break;
                            }
                            else {
                                count++;
                                buffer[o++] = value1;
                            }
                        }
                        if (writeLast) {
                            if (count < 127) {
                                buffer[o++] = value2;
                                buffer[o++] = value3;
                                count += 2;
                            }
                            else if (count < 128) {
                                buffer[o++] = value2;
                                count++;
                                p = (p - 4) | 0;
                            }
                            else {
                                p = (p - 8) | 0;
                            }
                        }
                        buffer[countIndex] = count - 1;
                    }
                }
                else if (p === lastIndex) {
                    buffer[o++] = 0;
                    buffer[o++] = data[p];
                }
                else { // p === lastIndex2
                    buffer[o++] = 1;
                    buffer[o++] = data[p];
                    p = (p + 4) | 0;
                    buffer[o++] = data[p];
                }
            }
            const length = o - startOffset;
            if (large) {
                buffer[ol++] = (length >> 24) & 0xff;
                buffer[ol++] = (length >> 16) & 0xff;
            }
            buffer[ol++] = (length >> 8) & 0xff;
            buffer[ol++] = length & 0xff;
        }
    }
    return buffer.slice(0, o);
}
function writeDataZipWithoutPrediction({ data, width, height }, offsets) {
    const size = width * height;
    const channel = new Uint8Array(size);
    const buffers = [];
    let totalLength = 0;
    for (const offset of offsets) {
        for (let i = 0, o = offset; i < size; i++, o += 4) {
            channel[i] = data[o];
        }
        const buffer = (0, pako_1.deflate)(channel);
        buffers.push(buffer);
        totalLength += buffer.byteLength;
    }
    if (buffers.length > 0) {
        const buffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const b of buffers) {
            buffer.set(b, offset);
            offset += b.byteLength;
        }
        return buffer;
    }
    else {
        return buffers[0];
    }
}
function createCanvasFromData(data) {
    const canvas = (0, exports.createCanvas)(100, 100);
    try {
        const context = canvas.getContext('2d');
        const imageData = (0, jpeg_1.decodeJpeg)(data, (w, h) => context.createImageData(w, h));
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        context.putImageData(imageData, 0, 0);
    }
    catch (e) {
        console.error('JPEG decompression error', e.message);
    }
    return canvas;
}
let createCanvas = () => {
    throw new Error('Canvas not initialized, use initializeCanvas method to set up createCanvas method');
};
exports.createCanvas = createCanvas;
let tempCanvas = undefined;
let createImageData = (width, height) => {
    if (!tempCanvas)
        tempCanvas = (0, exports.createCanvas)(1, 1);
    return tempCanvas.getContext('2d').createImageData(width, height);
};
exports.createImageData = createImageData;
if (typeof document !== 'undefined') {
    exports.createCanvas = (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    };
}
function initializeCanvas(createCanvasMethod, createImageDataMethod) {
    exports.createCanvas = createCanvasMethod;
    exports.createImageData = createImageDataMethod || exports.createImageData;
}

},{"./jpeg":11,"pako":20}],9:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resourceHandlersMap = exports.resourceHandlers = void 0;
const base64_js_1 = require("base64-js");
const psdReader_1 = require("./psdReader");
const psdWriter_1 = require("./psdWriter");
const helpers_1 = require("./helpers");
const utf8_1 = require("./utf8");
const descriptor_1 = require("./descriptor");
exports.resourceHandlers = [];
exports.resourceHandlersMap = {};
function addHandler(key, has, read, write) {
    const handler = { key, has, read, write };
    exports.resourceHandlers.push(handler);
    exports.resourceHandlersMap[handler.key] = handler;
}
const LOG_MOCK_HANDLERS = false;
const RESOLUTION_UNITS = [undefined, 'PPI', 'PPCM'];
const MEASUREMENT_UNITS = [undefined, 'Inches', 'Centimeters', 'Points', 'Picas', 'Columns'];
const hex = '0123456789abcdef';
function charToNibble(code) {
    if (code <= 57)
        return code - 48; // '0'-'9'
    if (code >= 97)
        return code - 87; // 'a'-'f'
    return code - 55; // 'A'-'F'
}
function byteAt(value, index) {
    return (charToNibble(value.charCodeAt(index)) << 4) | charToNibble(value.charCodeAt(index + 1));
}
function readUtf8String(reader, length) {
    const buffer = (0, psdReader_1.readBytes)(reader, length);
    return (0, utf8_1.decodeString)(buffer);
}
function writeUtf8String(writer, value) {
    const buffer = (0, utf8_1.encodeString)(value);
    (0, psdWriter_1.writeBytes)(writer, buffer);
}
function readEncodedString(reader) {
    const length = (0, psdReader_1.readUint8)(reader);
    const buffer = (0, psdReader_1.readBytes)(reader, length);
    let notAscii = false;
    for (let i = 0; i < buffer.byteLength; i++) {
        if (buffer[i] & 0x80) {
            notAscii = true;
            break;
        }
    }
    if (notAscii) {
        try {
            const decoder = new TextDecoder('gbk');
            return decoder.decode(buffer);
        }
        catch (_a) { }
    }
    return (0, utf8_1.decodeString)(buffer);
}
function writeEncodedString(writer, value) {
    let ascii = '';
    for (let i = 0, code = value.codePointAt(i++); code !== undefined; code = value.codePointAt(i++)) {
        ascii += code > 0x7f ? '?' : String.fromCodePoint(code);
    }
    const buffer = (0, utf8_1.encodeString)(ascii);
    (0, psdWriter_1.writeUint8)(writer, buffer.byteLength);
    (0, psdWriter_1.writeBytes)(writer, buffer);
}
helpers_1.MOCK_HANDLERS && addHandler(1028, // IPTC-NAA record
// IPTC-NAA record
target => target._ir1028 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1028', left());
    target._ir1028 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1028);
});
addHandler(1061, target => target.captionDigest !== undefined, (reader, target) => {
    let captionDigest = '';
    for (let i = 0; i < 16; i++) {
        const byte = (0, psdReader_1.readUint8)(reader);
        captionDigest += hex[byte >> 4];
        captionDigest += hex[byte & 0xf];
    }
    target.captionDigest = captionDigest;
}, (writer, target) => {
    for (let i = 0; i < 16; i++) {
        (0, psdWriter_1.writeUint8)(writer, byteAt(target.captionDigest, i * 2));
    }
});
addHandler(1060, target => target.xmpMetadata !== undefined, (reader, target, left) => {
    target.xmpMetadata = readUtf8String(reader, left());
}, (writer, target) => {
    writeUtf8String(writer, target.xmpMetadata);
});
const Inte = (0, helpers_1.createEnum)('Inte', 'perceptual', {
    'perceptual': 'Img ',
    'saturation': 'Grp ',
    'relative colorimetric': 'Clrm',
    'absolute colorimetric': 'AClr',
});
helpers_1.MOCK_HANDLERS && addHandler(1085, // Windows DEVMODE. Variable OS specific info for Windows.
// Windows DEVMODE. Variable OS specific info for Windows.
target => target._ir1085 !== undefined, (reader, target, left) => {
    target._ir1085 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1085);
});
addHandler(1082, target => target.printInformation !== undefined, (reader, target) => {
    var _a, _b;
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.printInformation = {
        printerName: desc.printerName || '',
        renderingIntent: Inte.decode((_a = desc.Inte) !== null && _a !== void 0 ? _a : 'Inte.Img '),
    };
    const info = target.printInformation;
    if (desc.PstS !== undefined)
        info.printerManagesColors = desc.PstS;
    if (desc['Nm  '] !== undefined)
        info.printerProfile = desc['Nm  '];
    if (desc.MpBl !== undefined)
        info.blackPointCompensation = desc.MpBl;
    if (desc.printSixteenBit !== undefined)
        info.printSixteenBit = desc.printSixteenBit;
    if (desc.hardProof !== undefined)
        info.hardProof = desc.hardProof;
    if (desc.printProofSetup) {
        if ('Bltn' in desc.printProofSetup) {
            info.proofSetup = { builtin: desc.printProofSetup.Bltn.split('.')[1] };
        }
        else {
            info.proofSetup = {
                profile: desc.printProofSetup.profile,
                renderingIntent: Inte.decode((_b = desc.printProofSetup.Inte) !== null && _b !== void 0 ? _b : 'Inte.Img '),
                blackPointCompensation: !!desc.printProofSetup.MpBl,
                paperWhite: !!desc.printProofSetup.paperWhite,
            };
        }
    }
}, (writer, target) => {
    var _a, _b;
    const info = target.printInformation;
    const desc = {};
    if (info.printerManagesColors) {
        desc.PstS = true;
    }
    else {
        if (info.hardProof !== undefined)
            desc.hardProof = !!info.hardProof;
        desc.ClrS = 'ClrS.RGBC'; // TODO: ???
        desc['Nm  '] = (_a = info.printerProfile) !== null && _a !== void 0 ? _a : 'CIE RGB';
    }
    desc.Inte = Inte.encode(info.renderingIntent);
    if (!info.printerManagesColors)
        desc.MpBl = !!info.blackPointCompensation;
    desc.printSixteenBit = !!info.printSixteenBit;
    desc.printerName = info.printerName || '';
    if (info.proofSetup && 'profile' in info.proofSetup) {
        desc.printProofSetup = {
            profile: info.proofSetup.profile || '',
            Inte: Inte.encode(info.proofSetup.renderingIntent),
            MpBl: !!info.proofSetup.blackPointCompensation,
            paperWhite: !!info.proofSetup.paperWhite,
        };
    }
    else {
        desc.printProofSetup = {
            Bltn: ((_b = info.proofSetup) === null || _b === void 0 ? void 0 : _b.builtin) ? `builtinProof.${info.proofSetup.builtin}` : 'builtinProof.proofCMYK',
        };
    }
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'printOutput', desc);
});
helpers_1.MOCK_HANDLERS && addHandler(1083, // Print style
// Print style
target => target._ir1083 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1083', left());
    target._ir1083 = (0, psdReader_1.readBytes)(reader, left());
    // TODO:
    // const desc = readVersionAndDescriptor(reader);
    // console.log('1083', require('util').inspect(desc, false, 99, true));
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1083);
});
addHandler(1005, target => target.resolutionInfo !== undefined, (reader, target) => {
    const horizontalResolution = (0, psdReader_1.readFixedPoint32)(reader);
    const horizontalResolutionUnit = (0, psdReader_1.readUint16)(reader);
    const widthUnit = (0, psdReader_1.readUint16)(reader);
    const verticalResolution = (0, psdReader_1.readFixedPoint32)(reader);
    const verticalResolutionUnit = (0, psdReader_1.readUint16)(reader);
    const heightUnit = (0, psdReader_1.readUint16)(reader);
    target.resolutionInfo = {
        horizontalResolution,
        horizontalResolutionUnit: RESOLUTION_UNITS[horizontalResolutionUnit] || 'PPI',
        widthUnit: MEASUREMENT_UNITS[widthUnit] || 'Inches',
        verticalResolution,
        verticalResolutionUnit: RESOLUTION_UNITS[verticalResolutionUnit] || 'PPI',
        heightUnit: MEASUREMENT_UNITS[heightUnit] || 'Inches',
    };
}, (writer, target) => {
    const info = target.resolutionInfo;
    (0, psdWriter_1.writeFixedPoint32)(writer, info.horizontalResolution || 0);
    (0, psdWriter_1.writeUint16)(writer, Math.max(1, RESOLUTION_UNITS.indexOf(info.horizontalResolutionUnit)));
    (0, psdWriter_1.writeUint16)(writer, Math.max(1, MEASUREMENT_UNITS.indexOf(info.widthUnit)));
    (0, psdWriter_1.writeFixedPoint32)(writer, info.verticalResolution || 0);
    (0, psdWriter_1.writeUint16)(writer, Math.max(1, RESOLUTION_UNITS.indexOf(info.verticalResolutionUnit)));
    (0, psdWriter_1.writeUint16)(writer, Math.max(1, MEASUREMENT_UNITS.indexOf(info.heightUnit)));
});
const printScaleStyles = ['centered', 'size to fit', 'user defined'];
addHandler(1062, target => target.printScale !== undefined, (reader, target) => {
    target.printScale = {
        style: printScaleStyles[(0, psdReader_1.readInt16)(reader)],
        x: (0, psdReader_1.readFloat32)(reader),
        y: (0, psdReader_1.readFloat32)(reader),
        scale: (0, psdReader_1.readFloat32)(reader),
    };
}, (writer, target) => {
    const { style, x, y, scale } = target.printScale;
    (0, psdWriter_1.writeInt16)(writer, Math.max(0, printScaleStyles.indexOf(style)));
    (0, psdWriter_1.writeFloat32)(writer, x || 0);
    (0, psdWriter_1.writeFloat32)(writer, y || 0);
    (0, psdWriter_1.writeFloat32)(writer, scale || 0);
});
addHandler(1006, target => target.alphaChannelNames !== undefined, (reader, target, left) => {
    if (!target.alphaChannelNames) { // skip if the unicode versions are already read
        target.alphaChannelNames = [];
        while (left() > 0) {
            const value = readEncodedString(reader);
            // const value = readPascalString(reader, 1);
            target.alphaChannelNames.push(value);
        }
    }
    else {
        (0, psdReader_1.skipBytes)(reader, left());
    }
}, (writer, target) => {
    for (const name of target.alphaChannelNames) {
        writeEncodedString(writer, name);
        // writePascalString(writer, name, 1);
    }
});
addHandler(1045, target => target.alphaChannelNames !== undefined, (reader, target, left) => {
    target.alphaChannelNames = [];
    while (left() > 0) {
        target.alphaChannelNames.push((0, psdReader_1.readUnicodeString)(reader));
    }
}, (writer, target) => {
    for (const name of target.alphaChannelNames) {
        (0, psdWriter_1.writeUnicodeStringWithPadding)(writer, name);
    }
});
helpers_1.MOCK_HANDLERS && addHandler(1077, target => target._ir1077 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1077', left());
    target._ir1077 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1077);
});
addHandler(1053, target => target.alphaIdentifiers !== undefined, (reader, target, left) => {
    target.alphaIdentifiers = [];
    while (left() >= 4) {
        target.alphaIdentifiers.push((0, psdReader_1.readUint32)(reader));
    }
}, (writer, target) => {
    for (const id of target.alphaIdentifiers) {
        (0, psdWriter_1.writeUint32)(writer, id);
    }
});
addHandler(1010, target => target.backgroundColor !== undefined, (reader, target) => target.backgroundColor = (0, psdReader_1.readColor)(reader), (writer, target) => (0, psdWriter_1.writeColor)(writer, target.backgroundColor));
addHandler(1037, target => target.globalAngle !== undefined, (reader, target) => target.globalAngle = (0, psdReader_1.readInt32)(reader), (writer, target) => (0, psdWriter_1.writeInt32)(writer, target.globalAngle));
addHandler(1049, target => target.globalAltitude !== undefined, (reader, target) => target.globalAltitude = (0, psdReader_1.readUint32)(reader), (writer, target) => (0, psdWriter_1.writeUint32)(writer, target.globalAltitude));
addHandler(1011, target => target.printFlags !== undefined, (reader, target) => {
    target.printFlags = {
        labels: !!(0, psdReader_1.readUint8)(reader),
        cropMarks: !!(0, psdReader_1.readUint8)(reader),
        colorBars: !!(0, psdReader_1.readUint8)(reader),
        registrationMarks: !!(0, psdReader_1.readUint8)(reader),
        negative: !!(0, psdReader_1.readUint8)(reader),
        flip: !!(0, psdReader_1.readUint8)(reader),
        interpolate: !!(0, psdReader_1.readUint8)(reader),
        caption: !!(0, psdReader_1.readUint8)(reader),
        printFlags: !!(0, psdReader_1.readUint8)(reader),
    };
}, (writer, target) => {
    const flags = target.printFlags;
    (0, psdWriter_1.writeUint8)(writer, flags.labels ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.cropMarks ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.colorBars ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.registrationMarks ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.negative ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.flip ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.interpolate ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.caption ? 1 : 0);
    (0, psdWriter_1.writeUint8)(writer, flags.printFlags ? 1 : 0);
});
addHandler(1034, // Copyright flag
// Copyright flag
target => target.copyrighted !== undefined, (reader, target) => {
    target.copyrighted = !!(0, psdReader_1.readUint8)(reader);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.copyrighted ? 1 : 0);
});
addHandler(1035, // URL
// URL
target => target.url !== undefined, (reader, target, left) => {
    target.url = (0, psdReader_1.readAsciiString)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeAsciiString)(writer, target.url);
});
helpers_1.MOCK_HANDLERS && addHandler(10000, // Print flags
// Print flags
target => target._ir10000 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 10000', left());
    target._ir10000 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir10000);
});
helpers_1.MOCK_HANDLERS && addHandler(1013, // Color halftoning
// Color halftoning
target => target._ir1013 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1013', left());
    target._ir1013 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1013);
});
helpers_1.MOCK_HANDLERS && addHandler(1016, // Color transfer functions
// Color transfer functions
target => target._ir1016 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1016', left());
    target._ir1016 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1016);
});
addHandler(1080, // Count Information
// Count Information
target => target.countInformation !== undefined, (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.countInformation = desc.countGroupList.map(g => ({
        color: { r: g['Rd  '], g: g['Grn '], b: g['Bl  '] },
        name: g['Nm  '],
        size: g['Rds '],
        fontSize: g.fontSize,
        visible: g.Vsbl,
        points: g.countObjectList.map(p => ({ x: p['X   '], y: p['Y   '] })),
    }));
}, (writer, target) => {
    const desc = {
        Vrsn: 1,
        countGroupList: target.countInformation.map(g => ({
            'Rd  ': g.color.r,
            'Grn ': g.color.g,
            'Bl  ': g.color.b,
            'Nm  ': g.name,
            'Rds ': g.size,
            fontSize: g.fontSize,
            Vsbl: g.visible,
            countObjectList: g.points.map(p => ({ 'X   ': p.x, 'Y   ': p.y })),
        })),
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'Cnt ', desc);
});
addHandler(1024, target => target.layerState !== undefined, (reader, target) => target.layerState = (0, psdReader_1.readUint16)(reader), (writer, target) => (0, psdWriter_1.writeUint16)(writer, target.layerState));
addHandler(1026, target => target.layersGroup !== undefined, (reader, target, left) => {
    target.layersGroup = [];
    while (left() > 0) {
        target.layersGroup.push((0, psdReader_1.readUint16)(reader));
    }
}, (writer, target) => {
    for (const g of target.layersGroup) {
        (0, psdWriter_1.writeUint16)(writer, g);
    }
});
addHandler(1072, target => target.layerGroupsEnabledId !== undefined, (reader, target, left) => {
    target.layerGroupsEnabledId = [];
    while (left() > 0) {
        target.layerGroupsEnabledId.push((0, psdReader_1.readUint8)(reader));
    }
}, (writer, target) => {
    for (const id of target.layerGroupsEnabledId) {
        (0, psdWriter_1.writeUint8)(writer, id);
    }
});
addHandler(1069, target => target.layerSelectionIds !== undefined, (reader, target) => {
    let count = (0, psdReader_1.readUint16)(reader);
    target.layerSelectionIds = [];
    while (count--) {
        target.layerSelectionIds.push((0, psdReader_1.readUint32)(reader));
    }
}, (writer, target) => {
    (0, psdWriter_1.writeUint16)(writer, target.layerSelectionIds.length);
    for (const id of target.layerSelectionIds) {
        (0, psdWriter_1.writeUint32)(writer, id);
    }
});
addHandler(1032, target => target.gridAndGuidesInformation !== undefined, (reader, target) => {
    const version = (0, psdReader_1.readUint32)(reader);
    const horizontal = (0, psdReader_1.readUint32)(reader);
    const vertical = (0, psdReader_1.readUint32)(reader);
    const count = (0, psdReader_1.readUint32)(reader);
    if (version !== 1)
        throw new Error(`Invalid 1032 resource version: ${version}`);
    target.gridAndGuidesInformation = {
        grid: { horizontal, vertical },
        guides: [],
    };
    for (let i = 0; i < count; i++) {
        target.gridAndGuidesInformation.guides.push({
            location: (0, psdReader_1.readUint32)(reader) / 32,
            direction: (0, psdReader_1.readUint8)(reader) ? 'horizontal' : 'vertical'
        });
    }
}, (writer, target) => {
    const info = target.gridAndGuidesInformation;
    const grid = info.grid || { horizontal: 18 * 32, vertical: 18 * 32 };
    const guides = info.guides || [];
    (0, psdWriter_1.writeUint32)(writer, 1);
    (0, psdWriter_1.writeUint32)(writer, grid.horizontal);
    (0, psdWriter_1.writeUint32)(writer, grid.vertical);
    (0, psdWriter_1.writeUint32)(writer, guides.length);
    for (const g of guides) {
        (0, psdWriter_1.writeUint32)(writer, g.location * 32);
        (0, psdWriter_1.writeUint8)(writer, g.direction === 'horizontal' ? 1 : 0);
    }
});
addHandler(1065, // Layer Comps
// Layer Comps
target => target.layerComps !== undefined, (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader, true);
    // console.log('CompList', require('util').inspect(desc, false, 99, true));
    target.layerComps = { list: [] };
    for (const item of desc.list) {
        target.layerComps.list.push({
            id: item.compID,
            name: item['Nm  '],
            capturedInfo: item.capturedInfo,
        });
        if ('comment' in item)
            target.layerComps.list[target.layerComps.list.length - 1].comment = item.comment;
    }
    if ('lastAppliedComp' in desc)
        target.layerComps.lastApplied = desc.lastAppliedComp;
}, (writer, target) => {
    const layerComps = target.layerComps;
    const desc = { list: [] };
    for (const item of layerComps.list) {
        const t = {};
        t._classID = 'Comp';
        t['Nm  '] = item.name;
        if ('comment' in item)
            t.comment = item.comment;
        t.compID = item.id;
        t.capturedInfo = item.capturedInfo;
        desc.list.push(t);
    }
    if ('lastApplied' in layerComps)
        desc.lastAppliedComp = layerComps.lastApplied;
    // console.log('CompList', require('util').inspect(desc, false, 99, true));
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'CompList', desc);
});
helpers_1.MOCK_HANDLERS && addHandler(1092, // ???
// ???
target => target._ir1092 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1092', left());
    // 16 bytes, seems to be 4 integers
    target._ir1092 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1092);
});
// 0 - normal, 7 - multiply, 8 - screen, 23 - difference
const onionSkinsBlendModes = [
    'normal', undefined, undefined, undefined, undefined, undefined, undefined, 'multiply',
    'screen', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'difference',
];
addHandler(1078, // Onion Skins
// Onion Skins
target => target.onionSkins !== undefined, (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    // console.log('1078', require('util').inspect(desc, false, 99, true));
    target.onionSkins = {
        enabled: desc.enab,
        framesBefore: desc.numBefore,
        framesAfter: desc.numAfter,
        frameSpacing: desc.Spcn,
        minOpacity: desc.minOpacity / 100,
        maxOpacity: desc.maxOpacity / 100,
        blendMode: onionSkinsBlendModes[desc.BlnM] || 'normal',
    };
}, (writer, target) => {
    const onionSkins = target.onionSkins;
    const desc = {
        Vrsn: 1,
        enab: onionSkins.enabled,
        numBefore: onionSkins.framesBefore,
        numAfter: onionSkins.framesAfter,
        Spcn: onionSkins.frameSpacing,
        minOpacity: (onionSkins.minOpacity * 100) | 0,
        maxOpacity: (onionSkins.maxOpacity * 100) | 0,
        BlnM: Math.max(0, onionSkinsBlendModes.indexOf(onionSkins.blendMode)),
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler(1075, // Timeline Information
// Timeline Information
target => target.timelineInformation !== undefined, (reader, target) => {
    var _a, _b;
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.timelineInformation = {
        enabled: desc.enab,
        frameStep: (0, descriptor_1.frac)(desc.frameStep),
        frameRate: desc.frameRate,
        time: (0, descriptor_1.frac)(desc.time),
        duration: (0, descriptor_1.frac)(desc.duration),
        workInTime: (0, descriptor_1.frac)(desc.workInTime),
        workOutTime: (0, descriptor_1.frac)(desc.workOutTime),
        repeats: desc.LCnt,
        hasMotion: desc.hasMotion,
        globalTracks: (0, descriptor_1.parseTrackList)(desc.globalTrackList, !!reader.logMissingFeatures),
    };
    if ((_b = (_a = desc.audioClipGroupList) === null || _a === void 0 ? void 0 : _a.audioClipGroupList) === null || _b === void 0 ? void 0 : _b.length) {
        target.timelineInformation.audioClipGroups = desc.audioClipGroupList.audioClipGroupList.map(g => ({
            id: g.groupID,
            muted: g.muted,
            audioClips: g.audioClipList.map(({ clipID, timeScope, muted, audioLevel, frameReader }) => ({
                id: clipID,
                start: (0, descriptor_1.frac)(timeScope.Strt),
                duration: (0, descriptor_1.frac)(timeScope.duration),
                inTime: (0, descriptor_1.frac)(timeScope.inTime),
                outTime: (0, descriptor_1.frac)(timeScope.outTime),
                muted: muted,
                audioLevel: audioLevel,
                frameReader: {
                    type: frameReader.frameReaderType,
                    mediaDescriptor: frameReader.mediaDescriptor,
                    link: {
                        name: frameReader['Lnk ']['Nm  '],
                        fullPath: frameReader['Lnk '].fullPath,
                        relativePath: frameReader['Lnk '].relPath,
                    },
                },
            })),
        }));
    }
}, (writer, target) => {
    var _a;
    const timeline = target.timelineInformation;
    const desc = {
        Vrsn: 1,
        enab: timeline.enabled,
        frameStep: timeline.frameStep,
        frameRate: timeline.frameRate,
        time: timeline.time,
        duration: timeline.duration,
        workInTime: timeline.workInTime,
        workOutTime: timeline.workOutTime,
        LCnt: timeline.repeats,
        globalTrackList: (0, descriptor_1.serializeTrackList)(timeline.globalTracks),
        audioClipGroupList: {
            audioClipGroupList: (_a = timeline.audioClipGroups) === null || _a === void 0 ? void 0 : _a.map(a => ({
                groupID: a.id,
                muted: a.muted,
                audioClipList: a.audioClips.map(c => ({
                    clipID: c.id,
                    timeScope: {
                        Vrsn: 1,
                        Strt: c.start,
                        duration: c.duration,
                        inTime: c.inTime,
                        outTime: c.outTime,
                    },
                    frameReader: {
                        frameReaderType: c.frameReader.type,
                        descVersion: 1,
                        'Lnk ': {
                            descVersion: 1,
                            'Nm  ': c.frameReader.link.name,
                            fullPath: c.frameReader.link.fullPath,
                            relPath: c.frameReader.link.relativePath,
                        },
                        mediaDescriptor: c.frameReader.mediaDescriptor,
                    },
                    muted: c.muted,
                    audioLevel: c.audioLevel,
                })),
            })),
        },
        hasMotion: timeline.hasMotion,
    };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc, 'anim');
});
addHandler(1076, // Sheet Disclosure
// Sheet Disclosure
target => target.sheetDisclosure !== undefined, (reader, target) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.sheetDisclosure = {};
    if (desc.sheetTimelineOptions) {
        target.sheetDisclosure.sheetTimelineOptions = desc.sheetTimelineOptions.map(o => ({
            sheetID: o.sheetID,
            sheetDisclosed: o.sheetDisclosed,
            lightsDisclosed: o.lightsDisclosed,
            meshesDisclosed: o.meshesDisclosed,
            materialsDisclosed: o.materialsDisclosed,
        }));
    }
}, (writer, target) => {
    const disclosure = target.sheetDisclosure;
    const desc = { Vrsn: 1 };
    if (disclosure.sheetTimelineOptions) {
        desc.sheetTimelineOptions = disclosure.sheetTimelineOptions.map(d => ({
            Vrsn: 2,
            sheetID: d.sheetID,
            sheetDisclosed: d.sheetDisclosed,
            lightsDisclosed: d.lightsDisclosed,
            meshesDisclosed: d.meshesDisclosed,
            materialsDisclosed: d.materialsDisclosed,
        }));
    }
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
addHandler(1054, // URL List
// URL List
target => target.urlsList !== undefined, (reader, target) => {
    const count = (0, psdReader_1.readUint32)(reader);
    target.urlsList = [];
    for (let i = 0; i < count; i++) {
        const long = (0, psdReader_1.readSignature)(reader);
        if (long !== 'slic' && reader.throwForMissingFeatures)
            throw new Error('Unknown long');
        const id = (0, psdReader_1.readUint32)(reader);
        const url = (0, psdReader_1.readUnicodeString)(reader);
        target.urlsList.push({ id, url, ref: 'slice' });
    }
}, (writer, target) => {
    const list = target.urlsList;
    (0, psdWriter_1.writeUint32)(writer, list.length);
    for (let i = 0; i < list.length; i++) {
        (0, psdWriter_1.writeSignature)(writer, 'slic');
        (0, psdWriter_1.writeUint32)(writer, list[i].id);
        (0, psdWriter_1.writeUnicodeString)(writer, list[i].url);
    }
});
function boundsToBounds(bounds) {
    return { 'Top ': bounds.top, Left: bounds.left, Btom: bounds.bottom, Rght: bounds.right };
}
function boundsFromBounds(bounds) {
    return { top: bounds['Top '], left: bounds.Left, bottom: bounds.Btom, right: bounds.Rght };
}
function clamped(array, index) {
    return array[Math.max(0, Math.min(array.length - 1, index))];
}
const sliceOrigins = ['autoGenerated', 'layer', 'userGenerated'];
const sliceTypes = ['noImage', 'image'];
const sliceAlignments = ['default'];
addHandler(1050, // Slices
// Slices
target => target.slices ? target.slices.length : 0, (reader, target) => {
    const version = (0, psdReader_1.readUint32)(reader);
    if (version === 6) {
        if (!target.slices)
            target.slices = [];
        const top = (0, psdReader_1.readInt32)(reader);
        const left = (0, psdReader_1.readInt32)(reader);
        const bottom = (0, psdReader_1.readInt32)(reader);
        const right = (0, psdReader_1.readInt32)(reader);
        const groupName = (0, psdReader_1.readUnicodeString)(reader);
        const count = (0, psdReader_1.readUint32)(reader);
        target.slices.push({ bounds: { top, left, bottom, right }, groupName, slices: [] });
        const slices = target.slices[target.slices.length - 1].slices;
        for (let i = 0; i < count; i++) {
            const id = (0, psdReader_1.readUint32)(reader);
            const groupId = (0, psdReader_1.readUint32)(reader);
            const origin = clamped(sliceOrigins, (0, psdReader_1.readUint32)(reader));
            const associatedLayerId = origin == 'layer' ? (0, psdReader_1.readUint32)(reader) : 0;
            const name = (0, psdReader_1.readUnicodeString)(reader);
            const type = clamped(sliceTypes, (0, psdReader_1.readUint32)(reader));
            const left = (0, psdReader_1.readInt32)(reader);
            const top = (0, psdReader_1.readInt32)(reader);
            const right = (0, psdReader_1.readInt32)(reader);
            const bottom = (0, psdReader_1.readInt32)(reader);
            const url = (0, psdReader_1.readUnicodeString)(reader);
            const target = (0, psdReader_1.readUnicodeString)(reader);
            const message = (0, psdReader_1.readUnicodeString)(reader);
            const altTag = (0, psdReader_1.readUnicodeString)(reader);
            const cellTextIsHTML = !!(0, psdReader_1.readUint8)(reader);
            const cellText = (0, psdReader_1.readUnicodeString)(reader);
            const horizontalAlignment = clamped(sliceAlignments, (0, psdReader_1.readUint32)(reader));
            const verticalAlignment = clamped(sliceAlignments, (0, psdReader_1.readUint32)(reader));
            const a = (0, psdReader_1.readUint8)(reader);
            const r = (0, psdReader_1.readUint8)(reader);
            const g = (0, psdReader_1.readUint8)(reader);
            const b = (0, psdReader_1.readUint8)(reader);
            const backgroundColorType = ((a + r + g + b) === 0) ? 'none' : (a === 0 ? 'matte' : 'color');
            slices.push({
                id, groupId, origin, associatedLayerId, name, target, message, altTag, cellTextIsHTML, cellText,
                horizontalAlignment, verticalAlignment, type, url,
                bounds: { top, left, bottom, right },
                backgroundColorType, backgroundColor: { r, g, b, a },
            });
        }
        const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
        desc.slices.forEach(d => {
            const slice = slices.find(s => d.sliceID == s.id);
            if (slice) {
                slice.topOutset = d.topOutset;
                slice.leftOutset = d.leftOutset;
                slice.bottomOutset = d.bottomOutset;
                slice.rightOutset = d.rightOutset;
            }
        });
    }
    else if (version === 7 || version === 8) {
        const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
        if (!target.slices)
            target.slices = [];
        target.slices.push({
            groupName: desc.baseName,
            bounds: boundsFromBounds(desc.bounds),
            slices: desc.slices.map(s => (Object.assign(Object.assign({}, (s['Nm  '] ? { name: s['Nm  '] } : {})), { id: s.sliceID, groupId: s.groupID, associatedLayerId: 0, origin: descriptor_1.ESliceOrigin.decode(s.origin), type: descriptor_1.ESliceType.decode(s.Type), bounds: boundsFromBounds(s.bounds), url: s.url, target: s.null, message: s.Msge, altTag: s.altTag, cellTextIsHTML: s.cellTextIsHTML, cellText: s.cellText, horizontalAlignment: descriptor_1.ESliceHorzAlign.decode(s.horzAlign), verticalAlignment: descriptor_1.ESliceVertAlign.decode(s.vertAlign), backgroundColorType: descriptor_1.ESliceBGColorType.decode(s.bgColorType), backgroundColor: s.bgColor ? { r: s.bgColor['Rd  '], g: s.bgColor['Grn '], b: s.bgColor['Bl  '], a: s.bgColor.alpha } : { r: 0, g: 0, b: 0, a: 0 }, topOutset: s.topOutset || 0, leftOutset: s.leftOutset || 0, bottomOutset: s.bottomOutset || 0, rightOutset: s.rightOutset || 0 }))),
        });
    }
    else {
        throw new Error(`Invalid slices version (${version})`);
    }
}, (writer, target, index) => {
    const { bounds, groupName, slices } = target.slices[index];
    (0, psdWriter_1.writeUint32)(writer, 6); // version
    (0, psdWriter_1.writeInt32)(writer, bounds.top);
    (0, psdWriter_1.writeInt32)(writer, bounds.left);
    (0, psdWriter_1.writeInt32)(writer, bounds.bottom);
    (0, psdWriter_1.writeInt32)(writer, bounds.right);
    (0, psdWriter_1.writeUnicodeString)(writer, groupName);
    (0, psdWriter_1.writeUint32)(writer, slices.length);
    for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        let { a, r, g, b } = slice.backgroundColor;
        if (slice.backgroundColorType === 'none') {
            a = r = g = b = 0;
        }
        else if (slice.backgroundColorType === 'matte') {
            a = 0;
            r = g = b = 255;
        }
        (0, psdWriter_1.writeUint32)(writer, slice.id);
        (0, psdWriter_1.writeUint32)(writer, slice.groupId);
        (0, psdWriter_1.writeUint32)(writer, sliceOrigins.indexOf(slice.origin));
        if (slice.origin === 'layer')
            (0, psdWriter_1.writeUint32)(writer, slice.associatedLayerId);
        (0, psdWriter_1.writeUnicodeString)(writer, slice.name || '');
        (0, psdWriter_1.writeUint32)(writer, sliceTypes.indexOf(slice.type));
        (0, psdWriter_1.writeInt32)(writer, slice.bounds.left);
        (0, psdWriter_1.writeInt32)(writer, slice.bounds.top);
        (0, psdWriter_1.writeInt32)(writer, slice.bounds.right);
        (0, psdWriter_1.writeInt32)(writer, slice.bounds.bottom);
        (0, psdWriter_1.writeUnicodeString)(writer, slice.url);
        (0, psdWriter_1.writeUnicodeString)(writer, slice.target);
        (0, psdWriter_1.writeUnicodeString)(writer, slice.message);
        (0, psdWriter_1.writeUnicodeString)(writer, slice.altTag);
        (0, psdWriter_1.writeUint8)(writer, slice.cellTextIsHTML ? 1 : 0);
        (0, psdWriter_1.writeUnicodeString)(writer, slice.cellText);
        (0, psdWriter_1.writeUint32)(writer, sliceAlignments.indexOf(slice.horizontalAlignment));
        (0, psdWriter_1.writeUint32)(writer, sliceAlignments.indexOf(slice.verticalAlignment));
        (0, psdWriter_1.writeUint8)(writer, a);
        (0, psdWriter_1.writeUint8)(writer, r);
        (0, psdWriter_1.writeUint8)(writer, g);
        (0, psdWriter_1.writeUint8)(writer, b);
    }
    const desc = {
        bounds: boundsToBounds(bounds),
        slices: [],
    };
    slices.forEach(s => {
        const slice = Object.assign(Object.assign({ sliceID: s.id, groupID: s.groupId, origin: descriptor_1.ESliceOrigin.encode(s.origin), Type: descriptor_1.ESliceType.encode(s.type), bounds: boundsToBounds(s.bounds) }, (s.name ? { 'Nm  ': s.name } : {})), { url: s.url, null: s.target, Msge: s.message, altTag: s.altTag, cellTextIsHTML: s.cellTextIsHTML, cellText: s.cellText, horzAlign: descriptor_1.ESliceHorzAlign.encode(s.horizontalAlignment), vertAlign: descriptor_1.ESliceVertAlign.encode(s.verticalAlignment), bgColorType: descriptor_1.ESliceBGColorType.encode(s.backgroundColorType) });
        if (s.backgroundColorType === 'color') {
            const { r, g, b, a } = s.backgroundColor;
            slice.bgColor = { 'Rd  ': r, 'Grn ': g, 'Bl  ': b, alpha: a };
        }
        slice.topOutset = s.topOutset || 0;
        slice.leftOutset = s.leftOutset || 0;
        slice.bottomOutset = s.bottomOutset || 0;
        slice.rightOutset = s.rightOutset || 0;
        desc.slices.push(slice);
    });
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc, 'slices');
});
addHandler(1064, target => target.pixelAspectRatio !== undefined, (reader, target) => {
    if ((0, psdReader_1.readUint32)(reader) > 2)
        throw new Error('Invalid pixelAspectRatio version');
    target.pixelAspectRatio = { aspect: (0, psdReader_1.readFloat64)(reader) };
}, (writer, target) => {
    (0, psdWriter_1.writeUint32)(writer, 2); // version
    (0, psdWriter_1.writeFloat64)(writer, target.pixelAspectRatio.aspect);
});
addHandler(1041, target => target.iccUntaggedProfile !== undefined, (reader, target) => {
    target.iccUntaggedProfile = !!(0, psdReader_1.readUint8)(reader);
}, (writer, target) => {
    (0, psdWriter_1.writeUint8)(writer, target.iccUntaggedProfile ? 1 : 0);
});
helpers_1.MOCK_HANDLERS && addHandler(1039, // ICC Profile
// ICC Profile
target => target._ir1039 !== undefined, (reader, target, left) => {
    // TODO: this is raw bytes, just return as a byte array
    LOG_MOCK_HANDLERS && console.log('image resource 1039', left());
    target._ir1039 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1039);
});
addHandler(1044, target => target.idsSeedNumber !== undefined, (reader, target) => target.idsSeedNumber = (0, psdReader_1.readUint32)(reader), (writer, target) => (0, psdWriter_1.writeUint32)(writer, target.idsSeedNumber));
addHandler(1036, target => target.thumbnail !== undefined || target.thumbnailRaw !== undefined, (reader, target, left) => {
    const format = (0, psdReader_1.readUint32)(reader); // 1 = kJpegRGB, 0 = kRawRGB
    const width = (0, psdReader_1.readUint32)(reader);
    const height = (0, psdReader_1.readUint32)(reader);
    (0, psdReader_1.readUint32)(reader); // widthBytes = (width * bits_per_pixel + 31) / 32 * 4.
    (0, psdReader_1.readUint32)(reader); // totalSize = widthBytes * height * planes
    (0, psdReader_1.readUint32)(reader); // sizeAfterCompression
    const bitsPerPixel = (0, psdReader_1.readUint16)(reader); // 24
    const planes = (0, psdReader_1.readUint16)(reader); // 1
    if (format !== 1 || bitsPerPixel !== 24 || planes !== 1) {
        reader.logMissingFeatures && reader.log(`Invalid thumbnail data (format: ${format}, bitsPerPixel: ${bitsPerPixel}, planes: ${planes})`);
        (0, psdReader_1.skipBytes)(reader, left());
        return;
    }
    const size = left();
    const data = (0, psdReader_1.readBytes)(reader, size);
    if (reader.useRawThumbnail) {
        target.thumbnailRaw = { width, height, data };
    }
    else if (data.byteLength) {
        target.thumbnail = (0, helpers_1.createCanvasFromData)(data);
    }
}, (writer, target) => {
    var _a;
    let width = 0;
    let height = 0;
    let data = new Uint8Array(0);
    if (target.thumbnailRaw) {
        width = target.thumbnailRaw.width;
        height = target.thumbnailRaw.height;
        data = target.thumbnailRaw.data;
    }
    else {
        try {
            const dataUrl = (_a = target.thumbnail.toDataURL('image/jpeg', 1)) === null || _a === void 0 ? void 0 : _a.substring('data:image/jpeg;base64,'.length);
            if (dataUrl) {
                data = (0, base64_js_1.toByteArray)(dataUrl); // this sometimes fails for some reason, maybe some browser bugs
                width = target.thumbnail.width;
                height = target.thumbnail.height;
            }
        }
        catch (_b) { }
    }
    const bitsPerPixel = 24;
    const widthBytes = Math.floor((width * bitsPerPixel + 31) / 32) * 4;
    const planes = 1;
    const totalSize = widthBytes * height * planes;
    const sizeAfterCompression = data.length;
    (0, psdWriter_1.writeUint32)(writer, 1); // 1 = kJpegRGB
    (0, psdWriter_1.writeUint32)(writer, width);
    (0, psdWriter_1.writeUint32)(writer, height);
    (0, psdWriter_1.writeUint32)(writer, widthBytes);
    (0, psdWriter_1.writeUint32)(writer, totalSize);
    (0, psdWriter_1.writeUint32)(writer, sizeAfterCompression);
    (0, psdWriter_1.writeUint16)(writer, bitsPerPixel);
    (0, psdWriter_1.writeUint16)(writer, planes);
    (0, psdWriter_1.writeBytes)(writer, data);
});
addHandler(1057, target => target.versionInfo !== undefined, (reader, target, left) => {
    const version = (0, psdReader_1.readUint32)(reader);
    if (version !== 1)
        throw new Error('Invalid versionInfo version');
    target.versionInfo = {
        hasRealMergedData: !!(0, psdReader_1.readUint8)(reader),
        writerName: (0, psdReader_1.readUnicodeString)(reader),
        readerName: (0, psdReader_1.readUnicodeString)(reader),
        fileVersion: (0, psdReader_1.readUint32)(reader),
    };
    (0, psdReader_1.skipBytes)(reader, left());
}, (writer, target) => {
    const versionInfo = target.versionInfo;
    (0, psdWriter_1.writeUint32)(writer, 1); // version
    (0, psdWriter_1.writeUint8)(writer, versionInfo.hasRealMergedData ? 1 : 0);
    (0, psdWriter_1.writeUnicodeString)(writer, versionInfo.writerName);
    (0, psdWriter_1.writeUnicodeString)(writer, versionInfo.readerName);
    (0, psdWriter_1.writeUint32)(writer, versionInfo.fileVersion);
});
helpers_1.MOCK_HANDLERS && addHandler(1058, // EXIF data 1.
// EXIF data 1.
target => target._ir1058 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1058', left());
    target._ir1058 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1058);
});
addHandler(7000, target => target.imageReadyVariables !== undefined, (reader, target, left) => {
    target.imageReadyVariables = readUtf8String(reader, left());
}, (writer, target) => {
    writeUtf8String(writer, target.imageReadyVariables);
});
addHandler(7001, target => target.imageReadyDataSets !== undefined, (reader, target, left) => {
    target.imageReadyDataSets = readUtf8String(reader, left());
}, (writer, target) => {
    writeUtf8String(writer, target.imageReadyDataSets);
});
addHandler(1088, target => target.pathSelectionState !== undefined, (reader, target, _left) => {
    const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
    target.pathSelectionState = desc['null'];
}, (writer, target) => {
    const desc = { 'null': target.pathSelectionState };
    (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
});
helpers_1.MOCK_HANDLERS && addHandler(1025, target => target._ir1025 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 1025', left());
    target._ir1025 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir1025);
});
const FrmD = (0, helpers_1.createEnum)('FrmD', 'auto', {
    auto: 'Auto',
    none: 'None',
    dispose: 'Disp',
});
addHandler(4000, // Plug-In resource(s)
// Plug-In resource(s)
target => target.animations !== undefined, (reader, target, left) => {
    const key = (0, psdReader_1.readSignature)(reader);
    if (key === 'mani') {
        (0, psdReader_1.checkSignature)(reader, 'IRFR');
        (0, psdReader_1.readSection)(reader, 1, left => {
            while (left() > 0) {
                (0, psdReader_1.checkSignature)(reader, '8BIM');
                const key = (0, psdReader_1.readSignature)(reader);
                (0, psdReader_1.readSection)(reader, 1, left => {
                    if (key === 'AnDs') {
                        const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
                        target.animations = {
                            // desc.AFSt ???
                            frames: desc.FrIn.map(x => ({
                                id: x.FrID,
                                delay: (x.FrDl || 0) / 100,
                                dispose: x.FrDs ? FrmD.decode(x.FrDs) : 'auto', // missing == auto
                                // x.FrGA ???
                            })),
                            animations: desc.FSts.map(x => ({
                                id: x.FsID,
                                frames: x.FsFr,
                                repeats: x.LCnt,
                                activeFrame: x.AFrm || 0,
                            })),
                        };
                        // console.log('#4000 AnDs', require('util').inspect(desc, false, 99, true));
                        // console.log('#4000 AnDs:result', require('util').inspect(target.animations, false, 99, true));
                    }
                    else if (key === 'Roll') {
                        const bytes = (0, psdReader_1.readBytes)(reader, left());
                        reader.logDevFeatures && reader.log('#4000 Roll', bytes);
                    }
                    else {
                        reader.logMissingFeatures && reader.log('Unhandled subsection in #4000', key);
                    }
                });
            }
        });
    }
    else if (key === 'mopt') {
        const bytes = (0, psdReader_1.readBytes)(reader, left());
        reader.logDevFeatures && reader.log('#4000 mopt', bytes);
    }
    else {
        reader.logMissingFeatures && reader.log('Unhandled key in #4000:', key);
    }
}, (writer, target) => {
    if (target.animations) {
        (0, psdWriter_1.writeSignature)(writer, 'mani');
        (0, psdWriter_1.writeSignature)(writer, 'IRFR');
        (0, psdWriter_1.writeSection)(writer, 1, () => {
            (0, psdWriter_1.writeSignature)(writer, '8BIM');
            (0, psdWriter_1.writeSignature)(writer, 'AnDs');
            (0, psdWriter_1.writeSection)(writer, 1, () => {
                const desc = {
                    // AFSt: 0, // ???
                    FrIn: [],
                    FSts: [],
                };
                for (let i = 0; i < target.animations.frames.length; i++) {
                    const f = target.animations.frames[i];
                    const frame = {
                        FrID: f.id,
                    };
                    if (f.delay)
                        frame.FrDl = (f.delay * 100) | 0;
                    frame.FrDs = FrmD.encode(f.dispose);
                    // if (i === 0) frame.FrGA = 30; // ???
                    desc.FrIn.push(frame);
                }
                for (let i = 0; i < target.animations.animations.length; i++) {
                    const a = target.animations.animations[i];
                    const anim = {
                        FsID: a.id,
                        AFrm: a.activeFrame | 0,
                        FsFr: a.frames,
                        LCnt: a.repeats | 0,
                    };
                    desc.FSts.push(anim);
                }
                (0, descriptor_1.writeVersionAndDescriptor)(writer, '', 'null', desc);
            });
            // writeSignature(writer, '8BIM');
            // writeSignature(writer, 'Roll');
            // writeSection(writer, 1, () => {
            // 	writeZeros(writer, 8);
            // });
        });
    }
});
// TODO: Unfinished
helpers_1.MOCK_HANDLERS && addHandler(4001, // Plug-In resource(s)
// Plug-In resource(s)
target => target._ir4001 !== undefined, (reader, target, left) => {
    if (helpers_1.MOCK_HANDLERS) {
        LOG_MOCK_HANDLERS && console.log('image resource 4001', left());
        target._ir4001 = (0, psdReader_1.readBytes)(reader, left());
        return;
    }
    const key = (0, psdReader_1.readSignature)(reader);
    if (key === 'mfri') {
        const version = (0, psdReader_1.readUint32)(reader);
        if (version !== 2)
            throw new Error('Invalid mfri version');
        const length = (0, psdReader_1.readUint32)(reader);
        const bytes = (0, psdReader_1.readBytes)(reader, length);
        reader.logDevFeatures && reader.log('mfri', bytes);
    }
    else if (key === 'mset') {
        const desc = (0, descriptor_1.readVersionAndDescriptor)(reader);
        reader.logDevFeatures && reader.log('mset', desc);
    }
    else {
        reader.logMissingFeatures && reader.log('Unhandled key in #4001', key);
    }
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir4001);
});
// TODO: Unfinished
helpers_1.MOCK_HANDLERS && addHandler(4002, // Plug-In resource(s)
// Plug-In resource(s)
target => target._ir4002 !== undefined, (reader, target, left) => {
    LOG_MOCK_HANDLERS && console.log('image resource 4002', left());
    target._ir4002 = (0, psdReader_1.readBytes)(reader, left());
}, (writer, target) => {
    (0, psdWriter_1.writeBytes)(writer, target._ir4002);
});

},{"./descriptor":4,"./helpers":8,"./psdReader":13,"./psdWriter":14,"./utf8":16,"base64-js":17}],10:[function(require,module,exports){
(function (Buffer){(function (){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCompositeCanvas = exports.getCompositeImageData = exports.getLayerRealMaskCanvas = exports.getLayerMaskCanvas = exports.getLayerCanvas = exports.getLayerRealMaskImageData = exports.getLayerMaskImageData = exports.getLayerImageData = exports.decodeLayerPixels = exports.byteArrayToBase64 = exports.initializeCanvas = void 0;
exports.readPsd = readPsd;
exports.writePsd = writePsd;
exports.writePsdUint8Array = writePsdUint8Array;
exports.writePsdBuffer = writePsdBuffer;
const psdWriter_1 = require("./psdWriter");
const psdReader_1 = require("./psdReader");
Object.defineProperty(exports, "decodeLayerPixels", { enumerable: true, get: function () { return psdReader_1.decodeLayerPixels; } });
Object.defineProperty(exports, "getLayerImageData", { enumerable: true, get: function () { return psdReader_1.getLayerImageData; } });
Object.defineProperty(exports, "getLayerMaskImageData", { enumerable: true, get: function () { return psdReader_1.getLayerMaskImageData; } });
Object.defineProperty(exports, "getLayerRealMaskImageData", { enumerable: true, get: function () { return psdReader_1.getLayerRealMaskImageData; } });
Object.defineProperty(exports, "getLayerCanvas", { enumerable: true, get: function () { return psdReader_1.getLayerCanvas; } });
Object.defineProperty(exports, "getLayerMaskCanvas", { enumerable: true, get: function () { return psdReader_1.getLayerMaskCanvas; } });
Object.defineProperty(exports, "getLayerRealMaskCanvas", { enumerable: true, get: function () { return psdReader_1.getLayerRealMaskCanvas; } });
Object.defineProperty(exports, "getCompositeImageData", { enumerable: true, get: function () { return psdReader_1.getCompositeImageData; } });
Object.defineProperty(exports, "getCompositeCanvas", { enumerable: true, get: function () { return psdReader_1.getCompositeCanvas; } });
const base64_js_1 = require("base64-js");
__exportStar(require("./abr"), exports);
__exportStar(require("./csh"), exports);
var helpers_1 = require("./helpers");
Object.defineProperty(exports, "initializeCanvas", { enumerable: true, get: function () { return helpers_1.initializeCanvas; } });
__exportStar(require("./psd"), exports);
exports.byteArrayToBase64 = base64_js_1.fromByteArray;
function readPsd(buffer, options) {
    const reader = 'buffer' in buffer ?
        (0, psdReader_1.createReader)(buffer.buffer, buffer.byteOffset, buffer.byteLength) :
        (0, psdReader_1.createReader)(buffer);
    return (0, psdReader_1.readPsd)(reader, options);
}
function writePsd(psd, options) {
    const writer = (0, psdWriter_1.createWriter)();
    (0, psdWriter_1.writePsd)(writer, psd, options);
    return (0, psdWriter_1.getWriterBuffer)(writer);
}
function writePsdUint8Array(psd, options) {
    const writer = (0, psdWriter_1.createWriter)();
    (0, psdWriter_1.writePsd)(writer, psd, options);
    return (0, psdWriter_1.getWriterBufferNoCopy)(writer);
}
function writePsdBuffer(psd, options) {
    if (typeof Buffer === 'undefined') {
        throw new Error('Buffer not supported on this platform');
    }
    return Buffer.from(writePsdUint8Array(psd, options));
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"./abr":1,"./csh":3,"./helpers":8,"./psd":12,"./psdReader":13,"./psdWriter":14,"base64-js":17,"buffer":18}],11:[function(require,module,exports){
"use strict";
// based on https://github.com/jpeg-js/jpeg-js
/*
   Copyright 2011 notmasteryet

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeJpeg = decodeJpeg;
const dctZigZag = new Int32Array([
    0,
    1, 8,
    16, 9, 2,
    3, 10, 17, 24,
    32, 25, 18, 11, 4,
    5, 12, 19, 26, 33, 40,
    48, 41, 34, 27, 20, 13, 6,
    7, 14, 21, 28, 35, 42, 49, 56,
    57, 50, 43, 36, 29, 22, 15,
    23, 30, 37, 44, 51, 58,
    59, 52, 45, 38, 31,
    39, 46, 53, 60,
    61, 54, 47,
    55, 62,
    63
]);
const dctCos1 = 4017; // cos(pi/16)
const dctSin1 = 799; // sin(pi/16)
const dctCos3 = 3406; // cos(3*pi/16)
const dctSin3 = 2276; // sin(3*pi/16)
const dctCos6 = 1567; // cos(6*pi/16)
const dctSin6 = 3784; // sin(6*pi/16)
const dctSqrt2 = 5793; // sqrt(2)
const dctSqrt1d2 = 2896; // sqrt(2) / 2
const maxResolutionInMP = 100; // Don't decode more than 100 megapixels
const maxMemoryUsageBytes = 64 * 1024 * 1024; // Don't decode if memory footprint is more than 64MB
let totalBytesAllocated = 0; // avoid unexpected OOMs from untrusted content.
function requestMemoryAllocation(increaseAmount) {
    const totalMemoryImpactBytes = totalBytesAllocated + increaseAmount;
    if (totalMemoryImpactBytes > maxMemoryUsageBytes) {
        const exceededAmount = Math.ceil((totalMemoryImpactBytes - maxMemoryUsageBytes) / 1024 / 1024);
        throw new Error(`Max memory limit exceeded by at least ${exceededAmount}MB`);
    }
    totalBytesAllocated = totalMemoryImpactBytes;
}
function buildHuffmanTable(codeLengths, values) {
    let length = 16;
    while (length > 0 && !codeLengths[length - 1])
        length--;
    const code = [{ children: [], index: 0 }];
    let k = 0;
    let p = code[0];
    for (let i = 0; i < length; i++) {
        for (let j = 0; j < codeLengths[i]; j++) {
            p = code.pop();
            p.children[p.index] = values[k];
            while (p.index > 0) {
                if (code.length === 0)
                    throw new Error('Could not recreate Huffman Table');
                p = code.pop();
            }
            p.index++;
            code.push(p);
            while (code.length <= i) {
                const q = { children: [], index: 0 };
                code.push(q);
                p.children[p.index] = q.children;
                p = q;
            }
            k++;
        }
        if (i + 1 < length) {
            // p here points to last code
            const q = { children: [], index: 0 };
            code.push(q);
            p.children[p.index] = q.children;
            p = q;
        }
    }
    return code[0].children;
}
function decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive) {
    const mcusPerLine = frame.mcusPerLine;
    const progressive = frame.progressive;
    const startOffset = offset;
    let bitsData = 0;
    let bitsCount = 0;
    function readBit() {
        if (bitsCount > 0) {
            bitsCount--;
            return (bitsData >> bitsCount) & 1;
        }
        bitsData = data[offset++];
        if (bitsData == 0xFF) {
            const nextByte = data[offset++];
            if (nextByte)
                throw new Error(`unexpected marker: ${((bitsData << 8) | nextByte).toString(16)}`);
            // unstuff 0
        }
        bitsCount = 7;
        return bitsData >>> 7;
    }
    function decodeHuffman(tree) {
        let node = tree;
        while (true) {
            node = node[readBit()];
            if (typeof node === 'number')
                return node;
            if (node === undefined)
                throw new Error('invalid huffman sequence');
        }
    }
    function receive(length) {
        let n = 0;
        while (length > 0) {
            n = (n << 1) | readBit();
            length--;
        }
        return n;
    }
    function receiveAndExtend(length) {
        let n = receive(length);
        if (n >= 1 << (length - 1))
            return n;
        return n + (-1 << length) + 1;
    }
    function decodeBaseline(component, zz) {
        const t = decodeHuffman(component.huffmanTableDC);
        const diff = t === 0 ? 0 : receiveAndExtend(t);
        zz[0] = (component.pred += diff);
        let k = 1;
        while (k < 64) {
            const rs = decodeHuffman(component.huffmanTableAC);
            const s = rs & 15;
            const r = rs >> 4;
            if (s === 0) {
                if (r < 15)
                    break;
                k += 16;
                continue;
            }
            k += r;
            const z = dctZigZag[k];
            zz[z] = receiveAndExtend(s);
            k++;
        }
    }
    function decodeDCFirst(component, zz) {
        const t = decodeHuffman(component.huffmanTableDC);
        const diff = t === 0 ? 0 : (receiveAndExtend(t) << successive);
        zz[0] = (component.pred += diff);
    }
    function decodeDCSuccessive(_component, zz) {
        zz[0] |= readBit() << successive;
    }
    let eobrun = 0;
    function decodeACFirst(component, zz) {
        if (eobrun > 0) {
            eobrun--;
            return;
        }
        let k = spectralStart, e = spectralEnd;
        while (k <= e) {
            const rs = decodeHuffman(component.huffmanTableAC);
            const s = rs & 15;
            const r = rs >> 4;
            if (s === 0) {
                if (r < 15) {
                    eobrun = receive(r) + (1 << r) - 1;
                    break;
                }
                k += 16;
                continue;
            }
            k += r;
            const z = dctZigZag[k];
            zz[z] = receiveAndExtend(s) * (1 << successive);
            k++;
        }
    }
    let successiveACState = 0;
    let successiveACNextValue = 0;
    function decodeACSuccessive(component, zz) {
        let k = spectralStart;
        let e = spectralEnd;
        let r = 0;
        while (k <= e) {
            const z = dctZigZag[k];
            const direction = zz[z] < 0 ? -1 : 1;
            switch (successiveACState) {
                case 0: // initial state
                    const rs = decodeHuffman(component.huffmanTableAC);
                    const s = rs & 15;
                    r = rs >> 4; // this was new variable in old code
                    if (s === 0) {
                        if (r < 15) {
                            eobrun = receive(r) + (1 << r);
                            successiveACState = 4;
                        }
                        else {
                            r = 16;
                            successiveACState = 1;
                        }
                    }
                    else {
                        if (s !== 1)
                            throw new Error('invalid ACn encoding');
                        successiveACNextValue = receiveAndExtend(s);
                        successiveACState = r ? 2 : 3;
                    }
                    continue;
                case 1: // skipping r zero items
                case 2:
                    if (zz[z]) {
                        zz[z] += (readBit() << successive) * direction;
                    }
                    else {
                        r--;
                        if (r === 0)
                            successiveACState = successiveACState == 2 ? 3 : 0;
                    }
                    break;
                case 3: // set value for a zero item
                    if (zz[z]) {
                        zz[z] += (readBit() << successive) * direction;
                    }
                    else {
                        zz[z] = successiveACNextValue << successive;
                        successiveACState = 0;
                    }
                    break;
                case 4: // eob
                    if (zz[z]) {
                        zz[z] += (readBit() << successive) * direction;
                    }
                    break;
            }
            k++;
        }
        if (successiveACState === 4) {
            eobrun--;
            if (eobrun === 0)
                successiveACState = 0;
        }
    }
    function decodeMcu(component, decode, mcu, row, col) {
        const mcuRow = (mcu / mcusPerLine) | 0;
        const mcuCol = mcu % mcusPerLine;
        const blockRow = mcuRow * component.v + row;
        const blockCol = mcuCol * component.h + col;
        // If the block is missing, just skip it.
        if (component.blocks[blockRow] === undefined)
            return;
        decode(component, component.blocks[blockRow][blockCol]);
    }
    function decodeBlock(component, decode, mcu) {
        const blockRow = (mcu / component.blocksPerLine) | 0;
        const blockCol = mcu % component.blocksPerLine;
        // If the block is missing, just skip it.
        if (component.blocks[blockRow] === undefined)
            return;
        decode(component, component.blocks[blockRow][blockCol]);
    }
    const componentsLength = components.length;
    let component;
    let decodeFn;
    if (progressive) {
        if (spectralStart === 0) {
            decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
        }
        else {
            decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
        }
    }
    else {
        decodeFn = decodeBaseline;
    }
    let mcu = 0;
    let mcuExpected;
    if (componentsLength == 1) {
        mcuExpected = components[0].blocksPerLine * components[0].blocksPerColumn;
    }
    else {
        mcuExpected = mcusPerLine * frame.mcusPerColumn;
    }
    if (!resetInterval)
        resetInterval = mcuExpected;
    let h;
    let v;
    let marker;
    while (mcu < mcuExpected) {
        // reset interval stuff
        for (let i = 0; i < componentsLength; i++)
            components[i].pred = 0;
        eobrun = 0;
        if (componentsLength == 1) {
            component = components[0];
            for (let n = 0; n < resetInterval; n++) {
                decodeBlock(component, decodeFn, mcu);
                mcu++;
            }
        }
        else {
            for (let n = 0; n < resetInterval; n++) {
                for (let i = 0; i < componentsLength; i++) {
                    component = components[i];
                    h = component.h;
                    v = component.v;
                    for (let j = 0; j < v; j++) {
                        for (let k = 0; k < h; k++) {
                            decodeMcu(component, decodeFn, mcu, j, k);
                        }
                    }
                }
                mcu++;
                // If we've reached our expected MCU's, stop decoding
                if (mcu === mcuExpected)
                    break;
            }
        }
        if (mcu === mcuExpected) {
            // Skip trailing bytes at the end of the scan - until we reach the next marker
            do {
                if (data[offset] === 0xFF) {
                    if (data[offset + 1] !== 0x00) {
                        break;
                    }
                }
                offset += 1;
            } while (offset < data.length - 2);
        }
        // find marker
        bitsCount = 0;
        marker = (data[offset] << 8) | data[offset + 1];
        if (marker < 0xFF00)
            throw new Error('marker was not found');
        if (marker >= 0xFFD0 && marker <= 0xFFD7) { // RSTx
            offset += 2;
        }
        else {
            break;
        }
    }
    return offset - startOffset;
}
function buildComponentData(component) {
    const lines = [];
    const blocksPerLine = component.blocksPerLine;
    const blocksPerColumn = component.blocksPerColumn;
    const samplesPerLine = blocksPerLine << 3;
    // Only 1 used per invocation of this function and garbage collected after invocation, so no need to account for its memory footprint.
    const R = new Int32Array(64);
    const r = new Uint8Array(64);
    // A port of poppler's IDCT method which in turn is taken from:
    //   Christoph Loeffler, Adriaan Ligtenberg, George S. Moschytz,
    //   "Practical Fast 1-D DCT Algorithms with 11 Multiplications",
    //   IEEE Intl. Conf. on Acoustics, Speech & Signal Processing, 1989,
    //   988-991.
    function quantizeAndInverse(zz, dataOut, dataIn) {
        const qt = component.quantizationTable;
        const p = dataIn;
        // dequant
        for (let i = 0; i < 64; i++) {
            p[i] = zz[i] * qt[i];
        }
        // inverse DCT on rows
        for (let i = 0; i < 8; ++i) {
            const row = 8 * i;
            // check for all-zero AC coefficients
            if (p[1 + row] == 0 && p[2 + row] == 0 && p[3 + row] == 0 &&
                p[4 + row] == 0 && p[5 + row] == 0 && p[6 + row] == 0 &&
                p[7 + row] == 0) {
                const t = (dctSqrt2 * p[0 + row] + 512) >> 10;
                p[0 + row] = t;
                p[1 + row] = t;
                p[2 + row] = t;
                p[3 + row] = t;
                p[4 + row] = t;
                p[5 + row] = t;
                p[6 + row] = t;
                p[7 + row] = t;
                continue;
            }
            // stage 4
            let v0 = (dctSqrt2 * p[0 + row] + 128) >> 8;
            let v1 = (dctSqrt2 * p[4 + row] + 128) >> 8;
            let v2 = p[2 + row];
            let v3 = p[6 + row];
            let v4 = (dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
            let v7 = (dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
            let v5 = p[3 + row] << 4;
            let v6 = p[5 + row] << 4;
            // stage 3
            let t = (v0 - v1 + 1) >> 1;
            v0 = (v0 + v1 + 1) >> 1;
            v1 = t;
            t = (v2 * dctSin6 + v3 * dctCos6 + 128) >> 8;
            v2 = (v2 * dctCos6 - v3 * dctSin6 + 128) >> 8;
            v3 = t;
            t = (v4 - v6 + 1) >> 1;
            v4 = (v4 + v6 + 1) >> 1;
            v6 = t;
            t = (v7 + v5 + 1) >> 1;
            v5 = (v7 - v5 + 1) >> 1;
            v7 = t;
            // stage 2
            t = (v0 - v3 + 1) >> 1;
            v0 = (v0 + v3 + 1) >> 1;
            v3 = t;
            t = (v1 - v2 + 1) >> 1;
            v1 = (v1 + v2 + 1) >> 1;
            v2 = t;
            t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
            v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
            v7 = t;
            t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
            v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
            v6 = t;
            // stage 1
            p[0 + row] = v0 + v7;
            p[7 + row] = v0 - v7;
            p[1 + row] = v1 + v6;
            p[6 + row] = v1 - v6;
            p[2 + row] = v2 + v5;
            p[5 + row] = v2 - v5;
            p[3 + row] = v3 + v4;
            p[4 + row] = v3 - v4;
        }
        // inverse DCT on columns
        for (let i = 0; i < 8; ++i) {
            const col = i;
            // check for all-zero AC coefficients
            if (p[1 * 8 + col] == 0 && p[2 * 8 + col] == 0 && p[3 * 8 + col] == 0 &&
                p[4 * 8 + col] == 0 && p[5 * 8 + col] == 0 && p[6 * 8 + col] == 0 &&
                p[7 * 8 + col] == 0) {
                const t = (dctSqrt2 * dataIn[i + 0] + 8192) >> 14;
                p[0 * 8 + col] = t;
                p[1 * 8 + col] = t;
                p[2 * 8 + col] = t;
                p[3 * 8 + col] = t;
                p[4 * 8 + col] = t;
                p[5 * 8 + col] = t;
                p[6 * 8 + col] = t;
                p[7 * 8 + col] = t;
                continue;
            }
            // stage 4
            let v0 = (dctSqrt2 * p[0 * 8 + col] + 2048) >> 12;
            let v1 = (dctSqrt2 * p[4 * 8 + col] + 2048) >> 12;
            let v2 = p[2 * 8 + col];
            let v3 = p[6 * 8 + col];
            let v4 = (dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048) >> 12;
            let v7 = (dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048) >> 12;
            let v5 = p[3 * 8 + col];
            let v6 = p[5 * 8 + col];
            // stage 3
            let t = (v0 - v1 + 1) >> 1;
            v0 = (v0 + v1 + 1) >> 1;
            v1 = t;
            t = (v2 * dctSin6 + v3 * dctCos6 + 2048) >> 12;
            v2 = (v2 * dctCos6 - v3 * dctSin6 + 2048) >> 12;
            v3 = t;
            t = (v4 - v6 + 1) >> 1;
            v4 = (v4 + v6 + 1) >> 1;
            v6 = t;
            t = (v7 + v5 + 1) >> 1;
            v5 = (v7 - v5 + 1) >> 1;
            v7 = t;
            // stage 2
            t = (v0 - v3 + 1) >> 1;
            v0 = (v0 + v3 + 1) >> 1;
            v3 = t;
            t = (v1 - v2 + 1) >> 1;
            v1 = (v1 + v2 + 1) >> 1;
            v2 = t;
            t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
            v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
            v7 = t;
            t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
            v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
            v6 = t;
            // stage 1
            p[0 * 8 + col] = v0 + v7;
            p[7 * 8 + col] = v0 - v7;
            p[1 * 8 + col] = v1 + v6;
            p[6 * 8 + col] = v1 - v6;
            p[2 * 8 + col] = v2 + v5;
            p[5 * 8 + col] = v2 - v5;
            p[3 * 8 + col] = v3 + v4;
            p[4 * 8 + col] = v3 - v4;
        }
        // convert to 8-bit integers
        for (let i = 0; i < 64; ++i) {
            const sample = 128 + ((p[i] + 8) >> 4);
            dataOut[i] = sample < 0 ? 0 : sample > 0xFF ? 0xFF : sample;
        }
    }
    requestMemoryAllocation(samplesPerLine * blocksPerColumn * 8);
    for (let blockRow = 0; blockRow < blocksPerColumn; blockRow++) {
        const scanLine = blockRow << 3;
        for (let i = 0; i < 8; i++)
            lines.push(new Uint8Array(samplesPerLine));
        for (let blockCol = 0; blockCol < blocksPerLine; blockCol++) {
            quantizeAndInverse(component.blocks[blockRow][blockCol], r, R);
            let offset = 0;
            const sample = blockCol << 3;
            for (let j = 0; j < 8; j++) {
                const line = lines[scanLine + j];
                for (let i = 0; i < 8; i++)
                    line[sample + i] = r[offset++];
            }
        }
    }
    return lines;
}
function clampTo8bit(a) {
    return a < 0 ? 0 : a > 255 ? 255 : a;
}
function parse(data) {
    const self = {
        width: 0,
        height: 0,
        adobe: undefined,
        components: [],
        exifBuffer: undefined,
        jfif: undefined,
    };
    const maxResolutionInPixels = maxResolutionInMP * 1000 * 1000;
    let offset = 0;
    function readUint16() {
        const value = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        return value;
    }
    function readDataBlock() {
        const length = readUint16();
        const array = data.subarray(offset, offset + length - 2);
        offset += array.length;
        return array;
    }
    function prepareComponents(frame) {
        let maxH = 0, maxV = 0;
        for (let componentId in frame.components) {
            if (frame.components.hasOwnProperty(componentId)) {
                const component = frame.components[componentId];
                if (maxH < component.h)
                    maxH = component.h;
                if (maxV < component.v)
                    maxV = component.v;
            }
        }
        const mcusPerLine = Math.ceil(frame.samplesPerLine / 8 / maxH);
        const mcusPerColumn = Math.ceil(frame.scanLines / 8 / maxV);
        for (let componentId in frame.components) {
            if (frame.components.hasOwnProperty(componentId)) {
                const component = frame.components[componentId];
                const blocksPerLine = Math.ceil(Math.ceil(frame.samplesPerLine / 8) * component.h / maxH);
                const blocksPerColumn = Math.ceil(Math.ceil(frame.scanLines / 8) * component.v / maxV);
                const blocksPerLineForMcu = mcusPerLine * component.h;
                const blocksPerColumnForMcu = mcusPerColumn * component.v;
                const blocksToAllocate = blocksPerColumnForMcu * blocksPerLineForMcu;
                const blocks = [];
                // Each block is a Int32Array of length 64 (4 x 64 = 256 bytes)
                requestMemoryAllocation(blocksToAllocate * 256);
                for (let i = 0; i < blocksPerColumnForMcu; i++) {
                    const row = [];
                    for (let j = 0; j < blocksPerLineForMcu; j++) {
                        row.push(new Int32Array(64));
                    }
                    blocks.push(row);
                }
                component.blocksPerLine = blocksPerLine;
                component.blocksPerColumn = blocksPerColumn;
                component.blocks = blocks;
            }
        }
        frame.maxH = maxH;
        frame.maxV = maxV;
        frame.mcusPerLine = mcusPerLine;
        frame.mcusPerColumn = mcusPerColumn;
    }
    let jfif = null;
    let adobe = null;
    let frame = undefined;
    let resetInterval = 0;
    let quantizationTables = [];
    let frames = [];
    let huffmanTablesAC = [];
    let huffmanTablesDC = [];
    let fileMarker = readUint16();
    let malformedDataOffset = -1;
    if (fileMarker != 0xFFD8) { // SOI (Start of Image)
        throw new Error('SOI not found');
    }
    fileMarker = readUint16();
    while (fileMarker != 0xFFD9) { // EOI (End of image)
        switch (fileMarker) {
            case 0xFF00: break;
            case 0xFFE0: // APP0 (Application Specific)
            case 0xFFE1: // APP1
            case 0xFFE2: // APP2
            case 0xFFE3: // APP3
            case 0xFFE4: // APP4
            case 0xFFE5: // APP5
            case 0xFFE6: // APP6
            case 0xFFE7: // APP7
            case 0xFFE8: // APP8
            case 0xFFE9: // APP9
            case 0xFFEA: // APP10
            case 0xFFEB: // APP11
            case 0xFFEC: // APP12
            case 0xFFED: // APP13
            case 0xFFEE: // APP14
            case 0xFFEF: // APP15
            case 0xFFFE: { // COM (Comment)
                const appData = readDataBlock();
                if (fileMarker === 0xFFFE) {
                    // ignore comments
                    // let comment = '';
                    // for (let ii = 0; ii < appData.byteLength; ii++) {
                    //   comment += String.fromCharCode(appData[ii]);
                    // }
                    // self.comments.push(comment);
                }
                if (fileMarker === 0xFFE0) {
                    if (appData[0] === 0x4A && appData[1] === 0x46 && appData[2] === 0x49 &&
                        appData[3] === 0x46 && appData[4] === 0) { // 'JFIF\x00'
                        jfif = {
                            version: { major: appData[5], minor: appData[6] },
                            densityUnits: appData[7],
                            xDensity: (appData[8] << 8) | appData[9],
                            yDensity: (appData[10] << 8) | appData[11],
                            thumbWidth: appData[12],
                            thumbHeight: appData[13],
                            thumbData: appData.subarray(14, 14 + 3 * appData[12] * appData[13])
                        };
                    }
                }
                // TODO APP1 - Exif
                if (fileMarker === 0xFFE1) {
                    if (appData[0] === 0x45 &&
                        appData[1] === 0x78 &&
                        appData[2] === 0x69 &&
                        appData[3] === 0x66 &&
                        appData[4] === 0) { // 'EXIF\x00'
                        self.exifBuffer = appData.subarray(5, appData.length);
                    }
                }
                if (fileMarker === 0xFFEE) {
                    if (appData[0] === 0x41 && appData[1] === 0x64 && appData[2] === 0x6F &&
                        appData[3] === 0x62 && appData[4] === 0x65 && appData[5] === 0) { // 'Adobe\x00'
                        adobe = {
                            version: appData[6],
                            flags0: (appData[7] << 8) | appData[8],
                            flags1: (appData[9] << 8) | appData[10],
                            transformCode: appData[11]
                        };
                    }
                }
                break;
            }
            case 0xFFDB: { // DQT (Define Quantization Tables)
                const quantizationTablesLength = readUint16();
                const quantizationTablesEnd = quantizationTablesLength + offset - 2;
                while (offset < quantizationTablesEnd) {
                    const quantizationTableSpec = data[offset++];
                    requestMemoryAllocation(64 * 4);
                    const tableData = new Int32Array(64);
                    if ((quantizationTableSpec >> 4) === 0) { // 8 bit values
                        for (let j = 0; j < 64; j++) {
                            const z = dctZigZag[j];
                            tableData[z] = data[offset++];
                        }
                    }
                    else if ((quantizationTableSpec >> 4) === 1) { //16 bit
                        for (let j = 0; j < 64; j++) {
                            const z = dctZigZag[j];
                            tableData[z] = readUint16();
                        }
                    }
                    else
                        throw new Error('DQT: invalid table spec');
                    quantizationTables[quantizationTableSpec & 15] = tableData;
                }
                break;
            }
            case 0xFFC0: // SOF0 (Start of Frame, Baseline DCT)
            case 0xFFC1: // SOF1 (Start of Frame, Extended DCT)
            case 0xFFC2: { // SOF2 (Start of Frame, Progressive DCT)
                readUint16(); // skip data length
                frame = {
                    extended: (fileMarker === 0xFFC1),
                    progressive: (fileMarker === 0xFFC2),
                    precision: data[offset++],
                    scanLines: readUint16(),
                    samplesPerLine: readUint16(),
                    components: {},
                    componentsOrder: [],
                    maxH: 0,
                    maxV: 0,
                    mcusPerLine: 0,
                    mcusPerColumn: 0,
                };
                const pixelsInFrame = frame.scanLines * frame.samplesPerLine;
                if (pixelsInFrame > maxResolutionInPixels) {
                    const exceededAmount = Math.ceil((pixelsInFrame - maxResolutionInPixels) / 1e6);
                    throw new Error(`maxResolutionInMP limit exceeded by ${exceededAmount}MP`);
                }
                const componentsCount = data[offset++];
                for (let i = 0; i < componentsCount; i++) {
                    const componentId = data[offset];
                    const h = data[offset + 1] >> 4;
                    const v = data[offset + 1] & 15;
                    const qId = data[offset + 2];
                    frame.componentsOrder.push(componentId);
                    frame.components[componentId] = {
                        h: h,
                        v: v,
                        quantizationIdx: qId,
                        blocksPerColumn: 0,
                        blocksPerLine: 0,
                        blocks: [],
                        pred: 0,
                    };
                    offset += 3;
                }
                prepareComponents(frame);
                frames.push(frame);
                break;
            }
            case 0xFFC4: { // DHT (Define Huffman Tables)
                const huffmanLength = readUint16();
                for (let i = 2; i < huffmanLength;) {
                    const huffmanTableSpec = data[offset++];
                    const codeLengths = new Uint8Array(16);
                    let codeLengthSum = 0;
                    for (let j = 0; j < 16; j++, offset++) {
                        codeLengthSum += (codeLengths[j] = data[offset]);
                    }
                    requestMemoryAllocation(16 + codeLengthSum);
                    const huffmanValues = new Uint8Array(codeLengthSum);
                    for (let j = 0; j < codeLengthSum; j++, offset++) {
                        huffmanValues[j] = data[offset];
                    }
                    i += 17 + codeLengthSum;
                    const index = huffmanTableSpec & 15;
                    const table = (huffmanTableSpec >> 4) === 0 ? huffmanTablesDC : huffmanTablesAC;
                    table[index] = buildHuffmanTable(codeLengths, huffmanValues);
                }
                break;
            }
            case 0xFFDD: // DRI (Define Restart Interval)
                readUint16(); // skip data length
                resetInterval = readUint16();
                break;
            case 0xFFDC: // Number of Lines marker
                readUint16(); // skip data length
                readUint16(); // Ignore this data since it represents the image height
                break;
            case 0xFFDA: { // SOS (Start of Scan)
                readUint16(); // skip data length
                const selectorsCount = data[offset++];
                const components = [];
                for (let i = 0; i < selectorsCount; i++) {
                    const component = frame.components[data[offset++]];
                    const tableSpec = data[offset++];
                    component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
                    component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
                    components.push(component);
                }
                const spectralStart = data[offset++];
                const spectralEnd = data[offset++];
                const successiveApproximation = data[offset++];
                const processed = decodeScan(data, offset, frame, components, resetInterval, spectralStart, spectralEnd, successiveApproximation >> 4, successiveApproximation & 15);
                offset += processed;
                break;
            }
            case 0xFFFF: // Fill bytes
                if (data[offset] !== 0xFF) { // Avoid skipping a valid marker.
                    offset--;
                }
                break;
            default: {
                if (data[offset - 3] == 0xFF && data[offset - 2] >= 0xC0 && data[offset - 2] <= 0xFE) {
                    // could be incorrect encoding -- last 0xFF byte of the previous
                    // block was eaten by the encoder
                    offset -= 3;
                    break;
                }
                else if (fileMarker === 0xE0 || fileMarker == 0xE1) {
                    // Recover from malformed APP1 markers popular in some phone models.
                    // See https://github.com/eugeneware/jpeg-js/issues/82
                    if (malformedDataOffset !== -1) {
                        throw new Error(`first unknown JPEG marker at offset ${malformedDataOffset.toString(16)}, second unknown JPEG marker ${fileMarker.toString(16)} at offset ${(offset - 1).toString(16)}`);
                    }
                    malformedDataOffset = offset - 1;
                    const nextOffset = readUint16();
                    if (data[offset + nextOffset - 2] === 0xFF) {
                        offset += nextOffset - 2;
                        break;
                    }
                }
                throw new Error('unknown JPEG marker ' + fileMarker.toString(16));
            }
        }
        fileMarker = readUint16();
    }
    if (frames.length != 1)
        throw new Error('only single frame JPEGs supported');
    // set each frame's components quantization table
    for (let i = 0; i < frames.length; i++) {
        const cp = frames[i].components;
        for (let j in cp) { // TODO: don't use `in`
            cp[j].quantizationTable = quantizationTables[cp[j].quantizationIdx];
            delete cp[j].quantizationIdx; // TODO: why ???
        }
    }
    self.width = frame.samplesPerLine;
    self.height = frame.scanLines;
    self.jfif = jfif;
    self.adobe = adobe;
    self.components = [];
    for (let i = 0; i < frame.componentsOrder.length; i++) {
        const component = frame.components[frame.componentsOrder[i]];
        self.components.push({
            lines: buildComponentData(component),
            scaleX: component.h / frame.maxH,
            scaleY: component.v / frame.maxV
        });
    }
    return self;
}
function getData(decoded) {
    let offset = 0;
    let colorTransform = false;
    const width = decoded.width;
    const height = decoded.height;
    const dataLength = width * height * decoded.components.length;
    requestMemoryAllocation(dataLength);
    const data = new Uint8Array(dataLength);
    switch (decoded.components.length) {
        case 1: {
            const component1 = decoded.components[0];
            for (let y = 0; y < height; y++) {
                const component1Line = component1.lines[0 | (y * component1.scaleY)];
                for (let x = 0; x < width; x++) {
                    const Y = component1Line[0 | (x * component1.scaleX)];
                    data[offset++] = Y;
                }
            }
            break;
        }
        case 2: {
            // PDF might compress two component data in custom colorspace
            const component1 = decoded.components[0];
            const component2 = decoded.components[1];
            for (let y = 0; y < height; y++) {
                const component1Line = component1.lines[0 | (y * component1.scaleY)];
                const component2Line = component2.lines[0 | (y * component2.scaleY)];
                for (let x = 0; x < width; x++) {
                    const Y1 = component1Line[0 | (x * component1.scaleX)];
                    data[offset++] = Y1;
                    const Y2 = component2Line[0 | (x * component2.scaleX)];
                    data[offset++] = Y2;
                }
            }
            break;
        }
        case 3: {
            // The default transform for three components is true
            colorTransform = true;
            // The adobe transform marker overrides any previous setting
            if (decoded.adobe && decoded.adobe.transformCode)
                colorTransform = true;
            const component1 = decoded.components[0];
            const component2 = decoded.components[1];
            const component3 = decoded.components[2];
            for (let y = 0; y < height; y++) {
                const component1Line = component1.lines[0 | (y * component1.scaleY)];
                const component2Line = component2.lines[0 | (y * component2.scaleY)];
                const component3Line = component3.lines[0 | (y * component3.scaleY)];
                for (let x = 0; x < width; x++) {
                    let Y, Cb, Cr, R, G, B;
                    if (!colorTransform) {
                        R = component1Line[0 | (x * component1.scaleX)];
                        G = component2Line[0 | (x * component2.scaleX)];
                        B = component3Line[0 | (x * component3.scaleX)];
                    }
                    else {
                        Y = component1Line[0 | (x * component1.scaleX)];
                        Cb = component2Line[0 | (x * component2.scaleX)];
                        Cr = component3Line[0 | (x * component3.scaleX)];
                        R = clampTo8bit(Y + 1.402 * (Cr - 128));
                        G = clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                        B = clampTo8bit(Y + 1.772 * (Cb - 128));
                    }
                    data[offset++] = R;
                    data[offset++] = G;
                    data[offset++] = B;
                }
            }
            break;
        }
        case 4: {
            if (!decoded.adobe)
                throw new Error('Unsupported color mode (4 components)');
            // The default transform for four components is false
            colorTransform = false;
            // The adobe transform marker overrides any previous setting
            if (decoded.adobe && decoded.adobe.transformCode)
                colorTransform = true;
            const component1 = decoded.components[0];
            const component2 = decoded.components[1];
            const component3 = decoded.components[2];
            const component4 = decoded.components[3];
            for (let y = 0; y < height; y++) {
                const component1Line = component1.lines[0 | (y * component1.scaleY)];
                const component2Line = component2.lines[0 | (y * component2.scaleY)];
                const component3Line = component3.lines[0 | (y * component3.scaleY)];
                const component4Line = component4.lines[0 | (y * component4.scaleY)];
                for (let x = 0; x < width; x++) {
                    let Y, Cb, Cr, K, C, M, Ye;
                    if (!colorTransform) {
                        C = component1Line[0 | (x * component1.scaleX)];
                        M = component2Line[0 | (x * component2.scaleX)];
                        Ye = component3Line[0 | (x * component3.scaleX)];
                        K = component4Line[0 | (x * component4.scaleX)];
                    }
                    else {
                        Y = component1Line[0 | (x * component1.scaleX)];
                        Cb = component2Line[0 | (x * component2.scaleX)];
                        Cr = component3Line[0 | (x * component3.scaleX)];
                        K = component4Line[0 | (x * component4.scaleX)];
                        C = 255 - clampTo8bit(Y + 1.402 * (Cr - 128));
                        M = 255 - clampTo8bit(Y - 0.3441363 * (Cb - 128) - 0.71413636 * (Cr - 128));
                        Ye = 255 - clampTo8bit(Y + 1.772 * (Cb - 128));
                    }
                    data[offset++] = 255 - C;
                    data[offset++] = 255 - M;
                    data[offset++] = 255 - Ye;
                    data[offset++] = 255 - K;
                }
            }
            break;
        }
        default:
            throw new Error('Unsupported color mode');
    }
    return data;
}
function decodeJpeg(encoded, createImageData) {
    totalBytesAllocated = 0;
    if (encoded.length === 0)
        throw new Error('Empty jpeg buffer');
    const decoded = parse(encoded);
    requestMemoryAllocation(decoded.width * decoded.height * 4);
    const data = getData(decoded);
    const imageData = createImageData(decoded.width, decoded.height);
    const width = imageData.width;
    const height = imageData.height;
    const imageDataArray = imageData.data;
    let i = 0;
    let j = 0;
    switch (decoded.components.length) {
        case 1:
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const Y = data[i++];
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = 255;
                }
            }
            break;
        case 2:
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const Y = data[i++];
                    const A = data[i++];
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = Y;
                    imageDataArray[j++] = A;
                }
            }
            break;
        case 3:
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const R = data[i++];
                    const G = data[i++];
                    const B = data[i++];
                    imageDataArray[j++] = R;
                    imageDataArray[j++] = G;
                    imageDataArray[j++] = B;
                    imageDataArray[j++] = 255;
                }
            }
            break;
        case 4:
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const C = data[i++];
                    const M = data[i++];
                    const Y = data[i++];
                    const K = data[i++];
                    const R = 255 - clampTo8bit(C * (1 - K / 255) + K);
                    const G = 255 - clampTo8bit(M * (1 - K / 255) + K);
                    const B = 255 - clampTo8bit(Y * (1 - K / 255) + K);
                    imageDataArray[j++] = R;
                    imageDataArray[j++] = G;
                    imageDataArray[j++] = B;
                    imageDataArray[j++] = 255;
                }
            }
            break;
        default:
            throw new Error('Unsupported color mode');
    }
    return imageData;
}

},{}],12:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Compression = exports.ChannelID = exports.LayerCompCapturedInfo = exports.SectionDividerType = exports.ColorMode = void 0;
var ColorMode;
(function (ColorMode) {
    ColorMode[ColorMode["Bitmap"] = 0] = "Bitmap";
    ColorMode[ColorMode["Grayscale"] = 1] = "Grayscale";
    ColorMode[ColorMode["Indexed"] = 2] = "Indexed";
    ColorMode[ColorMode["RGB"] = 3] = "RGB";
    ColorMode[ColorMode["CMYK"] = 4] = "CMYK";
    // 5
    // 6
    ColorMode[ColorMode["Multichannel"] = 7] = "Multichannel";
    ColorMode[ColorMode["Duotone"] = 8] = "Duotone";
    ColorMode[ColorMode["Lab"] = 9] = "Lab";
})(ColorMode || (exports.ColorMode = ColorMode = {}));
var SectionDividerType;
(function (SectionDividerType) {
    SectionDividerType[SectionDividerType["Other"] = 0] = "Other";
    SectionDividerType[SectionDividerType["OpenFolder"] = 1] = "OpenFolder";
    SectionDividerType[SectionDividerType["ClosedFolder"] = 2] = "ClosedFolder";
    SectionDividerType[SectionDividerType["BoundingSectionDivider"] = 3] = "BoundingSectionDivider";
})(SectionDividerType || (exports.SectionDividerType = SectionDividerType = {}));
var LayerCompCapturedInfo;
(function (LayerCompCapturedInfo) {
    LayerCompCapturedInfo[LayerCompCapturedInfo["None"] = 0] = "None";
    LayerCompCapturedInfo[LayerCompCapturedInfo["Visibility"] = 1] = "Visibility";
    LayerCompCapturedInfo[LayerCompCapturedInfo["Position"] = 2] = "Position";
    LayerCompCapturedInfo[LayerCompCapturedInfo["Appearance"] = 4] = "Appearance";
})(LayerCompCapturedInfo || (exports.LayerCompCapturedInfo = LayerCompCapturedInfo = {}));
var ChannelID;
(function (ChannelID) {
    ChannelID[ChannelID["Color0"] = 0] = "Color0";
    ChannelID[ChannelID["Color1"] = 1] = "Color1";
    ChannelID[ChannelID["Color2"] = 2] = "Color2";
    ChannelID[ChannelID["Color3"] = 3] = "Color3";
    ChannelID[ChannelID["Transparency"] = -1] = "Transparency";
    ChannelID[ChannelID["UserMask"] = -2] = "UserMask";
    ChannelID[ChannelID["RealUserMask"] = -3] = "RealUserMask";
})(ChannelID || (exports.ChannelID = ChannelID = {}));
var Compression;
(function (Compression) {
    Compression[Compression["RawData"] = 0] = "RawData";
    Compression[Compression["RleCompressed"] = 1] = "RleCompressed";
    Compression[Compression["ZipWithoutPrediction"] = 2] = "ZipWithoutPrediction";
    Compression[Compression["ZipWithPrediction"] = 3] = "ZipWithPrediction";
})(Compression || (exports.Compression = Compression = {}));

},{}],13:[function(require,module,exports){
"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportedColorModes = void 0;
exports.createReader = createReader;
exports.warnOrThrow = warnOrThrow;
exports.readUint8 = readUint8;
exports.peekUint8 = peekUint8;
exports.readInt16 = readInt16;
exports.readUint16 = readUint16;
exports.readUint16LE = readUint16LE;
exports.readInt32 = readInt32;
exports.readInt32LE = readInt32LE;
exports.readUint32 = readUint32;
exports.readFloat32 = readFloat32;
exports.readFloat64 = readFloat64;
exports.readFixedPoint32 = readFixedPoint32;
exports.readFixedPointPath32 = readFixedPointPath32;
exports.readBytes = readBytes;
exports.readSignature = readSignature;
exports.validSignatureAt = validSignatureAt;
exports.readPascalString = readPascalString;
exports.readUnicodeString = readUnicodeString;
exports.readUnicodeStringWithLength = readUnicodeStringWithLength;
exports.readUnicodeStringWithLengthLE = readUnicodeStringWithLengthLE;
exports.readAsciiString = readAsciiString;
exports.skipBytes = skipBytes;
exports.checkSignature = checkSignature;
exports.readPsd = readPsd;
exports.readLayerInfo = readLayerInfo;
exports.getCompositeImageData = getCompositeImageData;
exports.getCompositeCanvas = getCompositeCanvas;
exports.getLayerImageData = getLayerImageData;
exports.getLayerMaskImageData = getLayerMaskImageData;
exports.getLayerRealMaskImageData = getLayerRealMaskImageData;
exports.getLayerCanvas = getLayerCanvas;
exports.getLayerMaskCanvas = getLayerMaskCanvas;
exports.getLayerRealMaskCanvas = getLayerRealMaskCanvas;
exports.decodeLayerPixels = decodeLayerPixels;
exports.readGlobalLayerMaskInfo = readGlobalLayerMaskInfo;
exports.readAdditionalLayerInfo = readAdditionalLayerInfo;
exports.readDataZip = readDataZip;
exports.readDataRLE = readDataRLE;
exports.readSection = readSection;
exports.readColor = readColor;
exports.readPattern = readPattern;
const pako_1 = require("pako");
const helpers_1 = require("./helpers");
const additionalInfo_1 = require("./additionalInfo");
const imageResources_1 = require("./imageResources");
exports.supportedColorModes = [0 /* ColorMode.Bitmap */, 1 /* ColorMode.Grayscale */, 3 /* ColorMode.RGB */, 2 /* ColorMode.Indexed */];
const colorModes = ['bitmap', 'grayscale', 'indexed', 'RGB', 'CMYK', '', '', 'multichannel', 'duotone', 'lab'];
function setupGrayscale(data) {
    const size = data.width * data.height * 4;
    for (let i = 0; i < size; i += 4) {
        const c = data.data[i];
        data.data[i + 1] = c;
        data.data[i + 2] = c;
    }
}
function createReader(buffer, offset, length) {
    const view = new DataView(buffer, offset, length);
    return { view, offset: 0, strict: false, debug: false, large: false, globalAlpha: false, log: console.log };
}
function warnOrThrow(reader, message) {
    if (reader.strict)
        throw new Error(message);
    if (reader.debug)
        reader.log(message);
}
function readUint8(reader) {
    reader.offset += 1;
    return reader.view.getUint8(reader.offset - 1);
}
function peekUint8(reader) {
    return reader.view.getUint8(reader.offset);
}
function readInt16(reader) {
    reader.offset += 2;
    return reader.view.getInt16(reader.offset - 2, false);
}
function readUint16(reader) {
    reader.offset += 2;
    return reader.view.getUint16(reader.offset - 2, false);
}
function readUint16LE(reader) {
    reader.offset += 2;
    return reader.view.getUint16(reader.offset - 2, true);
}
function readInt32(reader) {
    reader.offset += 4;
    return reader.view.getInt32(reader.offset - 4, false);
}
function readInt32LE(reader) {
    reader.offset += 4;
    return reader.view.getInt32(reader.offset - 4, true);
}
function readUint32(reader) {
    reader.offset += 4;
    return reader.view.getUint32(reader.offset - 4, false);
}
function readFloat32(reader) {
    reader.offset += 4;
    return reader.view.getFloat32(reader.offset - 4, false);
}
function readFloat64(reader) {
    reader.offset += 8;
    return reader.view.getFloat64(reader.offset - 8, false);
}
// 32-bit fixed-point number 16.16
function readFixedPoint32(reader) {
    return readInt32(reader) / (1 << 16);
}
// 32-bit fixed-point number 8.24
function readFixedPointPath32(reader) {
    return readInt32(reader) / (1 << 24);
}
function readBytes(reader, length) {
    const start = reader.view.byteOffset + reader.offset;
    reader.offset += length;
    if ((start + length) > reader.view.buffer.byteLength) {
        // fix for broken PSD files that are missing part of file at the end
        warnOrThrow(reader, 'Reading bytes exceeding buffer length');
        if (length > (100 * 1024 * 1024))
            throw new Error('Reading past end of file'); // limit to 100MB
        const result = new Uint8Array(length);
        const len = Math.min(length, reader.view.byteLength - start);
        if (len > 0)
            result.set(new Uint8Array(reader.view.buffer, start, len));
        return result;
    }
    else {
        return new Uint8Array(reader.view.buffer, start, length);
    }
}
function readSignature(reader) {
    return readShortString(reader, 4);
}
function validSignatureAt(reader, offset) {
    const sig = String.fromCharCode(reader.view.getUint8(offset))
        + String.fromCharCode(reader.view.getUint8(offset + 1))
        + String.fromCharCode(reader.view.getUint8(offset + 2))
        + String.fromCharCode(reader.view.getUint8(offset + 3));
    return sig == '8BIM' || sig == '8B64';
}
function readPascalString(reader, padTo) {
    let length = readUint8(reader);
    const text = length ? readShortString(reader, length) : '';
    while (++length % padTo) { // starts with length + 1 so we count the size byte too
        reader.offset++;
    }
    return text;
}
function readUnicodeString(reader) {
    const length = readUint32(reader);
    return readUnicodeStringWithLength(reader, length);
}
function readUnicodeStringWithLength(reader, length) {
    let text = '';
    while (length--) {
        const value = readUint16(reader);
        if (value || length > 0) { // remove trailing \0
            text += String.fromCharCode(value);
        }
    }
    return text;
}
function readUnicodeStringWithLengthLE(reader, length) {
    let text = '';
    while (length--) {
        const value = readUint16LE(reader);
        if (value || length > 0) { // remove trailing \0
            text += String.fromCharCode(value);
        }
    }
    return text;
}
function readAsciiString(reader, length) {
    let text = '';
    while (length--) {
        text += String.fromCharCode(readUint8(reader));
    }
    return text;
}
function skipBytes(reader, count) {
    reader.offset += count;
}
function checkSignature(reader, a, b) {
    const offset = reader.offset;
    const signature = readSignature(reader);
    if (signature !== a && signature !== b) {
        throw new Error(`Invalid signature: '${signature}' at 0x${offset.toString(16)}`);
    }
}
function readShortString(reader, length) {
    const buffer = readBytes(reader, length);
    let result = '';
    for (let i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}
function isValidSignature(sig) {
    return sig === '8BIM' || sig === 'MeSa' || sig === 'AgHg' || sig === 'PHUT' || sig === 'DCSR';
}
function readPsd(reader, readOptions = {}) {
    var _a;
    // header
    checkSignature(reader, '8BPS');
    const version = readUint16(reader);
    if (version !== 1 && version !== 2)
        throw new Error(`Invalid PSD file version: ${version}`);
    skipBytes(reader, 6);
    const channels = readUint16(reader);
    const height = readUint32(reader);
    const width = readUint32(reader);
    const bitsPerChannel = readUint16(reader);
    const colorMode = readUint16(reader);
    const maxSize = version === 1 ? 30000 : 300000;
    if (width > maxSize || height > maxSize)
        throw new Error(`Invalid size: ${width}x${height}`);
    if (channels > 16)
        throw new Error(`Invalid channel count: ${channels}`);
    if (![1, 8, 16, 32].includes(bitsPerChannel))
        throw new Error(`Invalid bitsPerChannel: ${bitsPerChannel}`);
    if (exports.supportedColorModes.indexOf(colorMode) === -1)
        throw new Error(`Color mode not supported: ${(_a = colorModes[colorMode]) !== null && _a !== void 0 ? _a : colorMode}`);
    const psd = { width, height, channels, bitsPerChannel, colorMode };
    Object.assign(reader, readOptions);
    reader.large = version === 2;
    reader.globalAlpha = false;
    if (!('totalMemoryLimit' in reader)) { // setting totalMemoryLimit to undefined explicitly disables memory limit
        reader.totalMemoryLimit = 2 * 1024 * 1024 * 1024; // default 2GB memory limit
    }
    // color mode data
    readSection(reader, 1, left => {
        if (!left())
            return;
        if (colorMode === 2 /* ColorMode.Indexed */) {
            // should have 256 colors here saved as 8bit channels RGB
            if (left() != 768)
                throw new Error('Invalid color palette size');
            psd.palette = [];
            for (let i = 0; i < 256; i++)
                psd.palette.push({ r: readUint8(reader), g: 0, b: 0 });
            for (let i = 0; i < 256; i++)
                psd.palette[i].g = readUint8(reader);
            for (let i = 0; i < 256; i++)
                psd.palette[i].b = readUint8(reader);
        }
        else {
            // TODO: unknown format for duotone, also seems to have some data here for 32bit colors
            // if (options.throwForMissingFeatures) throw new Error('Color mode data not supported');
        }
        skipBytes(reader, left());
    });
    // image resources
    const imageResources = {};
    readSection(reader, 1, left => {
        while (left() > 0) {
            realignWithSignature(reader, isValidSignature);
            const id = readUint16(reader);
            readPascalString(reader, 2); // name
            readSection(reader, 2, left => {
                const handler = imageResources_1.resourceHandlersMap[id];
                const skip = id === 1036 && !!reader.skipThumbnail;
                if (handler && !skip) {
                    try {
                        handler.read(reader, imageResources, left);
                    }
                    catch (e) {
                        if (reader.throwForMissingFeatures)
                            throw e;
                        skipBytes(reader, left());
                    }
                }
                else {
                    // options.logMissingFeatures && console.log(`Unhandled image resource: ${id} (${left()})`);
                    skipBytes(reader, left());
                }
            });
        }
    });
    const { layersGroup, layerGroupsEnabledId } = imageResources, rest = __rest(imageResources, ["layersGroup", "layerGroupsEnabledId"]);
    if (Object.keys(rest).length) {
        psd.imageResources = rest;
    }
    // layer and mask info
    readSection(reader, 1, left => {
        readSection(reader, 2, left => {
            readLayerInfo(reader, psd, imageResources);
            skipBytes(reader, left());
        }, undefined, reader.large);
        // SAI does not include this section
        if (left() > 0) {
            const globalLayerMaskInfo = readGlobalLayerMaskInfo(reader);
            if (globalLayerMaskInfo)
                psd.globalLayerMaskInfo = globalLayerMaskInfo;
        }
        else {
            // revert back to end of section if exceeded section limits
            // opt.logMissingFeatures && console.log('reverting to end of section');
            skipBytes(reader, left());
        }
        while (left() > 0) {
            // sometimes there are empty bytes here
            while (left() && peekUint8(reader) === 0) {
                // opt.logMissingFeatures && console.log('skipping 0 byte');
                skipBytes(reader, 1);
            }
            if (left() >= 12) {
                readAdditionalLayerInfo(reader, psd, psd, imageResources);
            }
            else {
                // opt.logMissingFeatures && console.log('skipping leftover bytes', left());
                skipBytes(reader, left());
            }
        }
    }, undefined, reader.large);
    const hasChildren = psd.children && psd.children.length;
    const skipComposite = reader.skipCompositeImageData && (reader.skipLayerImageData || hasChildren);
    if (!skipComposite) {
        if (reader.useRawData) {
            psd.rawCompositeData = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset);
        }
        else {
            const imageData = readImageData(reader, psd);
            if (reader.useImageData) {
                psd.imageData = imageData;
            }
            else {
                psd.canvas = (0, helpers_1.imageDataToCanvas)(imageData);
            }
        }
    }
    // TODO: show converted color mode instead of original PSD file color mode
    //       but add option to preserve file color mode (need to return image data instead of canvas in that case)
    // psd.colorMode = ColorMode.RGB; // we convert all color modes to RGB
    return psd;
}
function readLayerInfo(reader, psd, imageResources) {
    var _a, _b;
    const { layersGroup = [], layerGroupsEnabledId = [] } = imageResources;
    let layerCount = readInt16(reader);
    if (layerCount < 0) {
        reader.globalAlpha = true;
        layerCount = -layerCount;
    }
    const layers = [];
    const layerChannels = [];
    for (let i = 0; i < layerCount; i++) {
        const { layer, channels } = readLayerRecord(reader, psd, imageResources);
        if (layersGroup[i] !== undefined)
            layer.linkGroup = layersGroup[i];
        if (layerGroupsEnabledId[i] !== undefined)
            layer.linkGroupEnabled = !!layerGroupsEnabledId[i];
        layers.push(layer);
        layerChannels.push(channels);
    }
    for (let i = 0; i < layerCount; i++) {
        readLayerChannelImageData(reader, psd, layers[i], layerChannels[i]);
    }
    if (!psd.children)
        psd.children = [];
    const stack = [psd];
    for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        const type = l.sectionDivider ? l.sectionDivider.type : 0 /* SectionDividerType.Other */;
        if (type === 1 /* SectionDividerType.OpenFolder */ || type === 2 /* SectionDividerType.ClosedFolder */) {
            l.opened = type === 1 /* SectionDividerType.OpenFolder */;
            l.children = [];
            if ((_a = l.sectionDivider) === null || _a === void 0 ? void 0 : _a.key) {
                l.blendMode = (_b = helpers_1.toBlendMode[l.sectionDivider.key]) !== null && _b !== void 0 ? _b : l.blendMode;
            }
            stack[stack.length - 1].children.unshift(l);
            stack.push(l);
        }
        else if (type === 3 /* SectionDividerType.BoundingSectionDivider */) {
            stack.pop();
            // this was workaround because I didn't know what `lsdk` section was, now it's probably not needed anymore
            // } else if (l.name === '</Layer group>' && !l.sectionDivider && !l.top && !l.left && !l.bottom && !l.right) {
            // 	// sometimes layer group terminator doesn't have sectionDivider, so we just guess here (PS bug ?)
            // 	stack.pop();
        }
        else {
            stack[stack.length - 1].children.unshift(l);
        }
    }
}
function readLayerRecord(reader, psd, imageResources) {
    const layer = {};
    layer.top = readInt32(reader);
    layer.left = readInt32(reader);
    layer.bottom = readInt32(reader);
    layer.right = readInt32(reader);
    if (!isValidBoxSize(layer, reader))
        throw new Error('Invalid layer size');
    const channelCount = readUint16(reader);
    const channels = [];
    for (let i = 0; i < channelCount; i++) {
        let id = readInt16(reader);
        let length = readUint32(reader);
        if (reader.large) {
            if (length !== 0)
                throw new Error('Sizes larger than 4GB are not supported');
            length = readUint32(reader);
        }
        channels.push({ id, length });
    }
    checkSignature(reader, '8BIM');
    const blendMode = readSignature(reader);
    if (!helpers_1.toBlendMode[blendMode])
        throw new Error(`Invalid blend mode: '${blendMode}'`);
    layer.blendMode = helpers_1.toBlendMode[blendMode];
    layer.opacity = readUint8(reader) / 0xff;
    layer.clipping = readUint8(reader) === 1;
    const flags = readUint8(reader);
    layer.transparencyProtected = (flags & 0x01) !== 0;
    layer.hidden = (flags & 0x02) !== 0;
    if (flags & 0x20)
        layer.effectsOpen = true;
    // 0x04 - obsolete
    // 0x08 - 1 for Photoshop 5.0 and later, tells if bit 4 has useful information
    // 0x10 - pixel data irrelevant to appearance of document
    // 0x20 - effects/filters panel is expanded
    skipBytes(reader, 1);
    readSection(reader, 1, left => {
        readLayerMaskData(reader, layer);
        const blendingRanges = readLayerBlendingRanges(reader);
        if (blendingRanges)
            layer.blendingRanges = blendingRanges;
        layer.name = readPascalString(reader, 1); // should be padded to 4, but is not sometimes
        // HACK: fix for sometimes layer.name string not being padded correctly, just skip until we get valid signature
        while (left() > 4 && !validSignatureAt(reader, reader.offset))
            reader.offset++;
        while (left() >= 12)
            readAdditionalLayerInfo(reader, layer, psd, imageResources);
        skipBytes(reader, left());
    });
    return { layer, channels };
}
function isValidBoxSize(box, reader) {
    const width = (box.right || 0) - (box.left || 0);
    const height = (box.bottom || 0) - (box.top || 0);
    const maxSize = reader.large ? 300000 : 30000;
    return width >= 0 && height >= 0 && width <= maxSize && height <= maxSize;
}
function readLayerMaskData(reader, layer) {
    return readSection(reader, 1, left => {
        if (!left())
            return undefined;
        const mask = {};
        layer.mask = mask;
        mask.top = readInt32(reader);
        mask.left = readInt32(reader);
        mask.bottom = readInt32(reader);
        mask.right = readInt32(reader);
        if (!isValidBoxSize(mask, reader))
            throw new Error('Invalid mask size');
        mask.defaultColor = readUint8(reader);
        const flags = readUint8(reader);
        mask.positionRelativeToLayer = (flags & 1 /* LayerMaskFlags.PositionRelativeToLayer */) !== 0;
        mask.disabled = (flags & 2 /* LayerMaskFlags.LayerMaskDisabled */) !== 0;
        mask.fromVectorData = (flags & 8 /* LayerMaskFlags.LayerMaskFromRenderingOtherData */) !== 0;
        if (left() >= 18) {
            const realMask = {};
            layer.realMask = realMask;
            const realFlags = readUint8(reader);
            realMask.positionRelativeToLayer = (realFlags & 1 /* LayerMaskFlags.PositionRelativeToLayer */) !== 0;
            realMask.disabled = (realFlags & 2 /* LayerMaskFlags.LayerMaskDisabled */) !== 0;
            realMask.fromVectorData = (realFlags & 8 /* LayerMaskFlags.LayerMaskFromRenderingOtherData */) !== 0;
            realMask.defaultColor = readUint8(reader); // Real user mask background. 0 or 255.
            realMask.top = readInt32(reader);
            realMask.left = readInt32(reader);
            realMask.bottom = readInt32(reader);
            realMask.right = readInt32(reader);
            if (!isValidBoxSize(realMask, reader))
                throw new Error('Invalid realMask size');
        }
        if (flags & 16 /* LayerMaskFlags.MaskHasParametersAppliedToIt */) {
            const params = readUint8(reader);
            if (params & 1 /* MaskParams.UserMaskDensity */)
                mask.userMaskDensity = readUint8(reader) / 0xff;
            if (params & 2 /* MaskParams.UserMaskFeather */)
                mask.userMaskFeather = readFloat64(reader);
            if (params & 4 /* MaskParams.VectorMaskDensity */)
                mask.vectorMaskDensity = readUint8(reader) / 0xff;
            if (params & 8 /* MaskParams.VectorMaskFeather */)
                mask.vectorMaskFeather = readFloat64(reader);
        }
        skipBytes(reader, left());
    });
}
function readBlendingRange(reader) {
    return [readUint8(reader), readUint8(reader), readUint8(reader), readUint8(reader)];
}
function readLayerBlendingRanges(reader) {
    return readSection(reader, 1, left => {
        const compositeGrayBlendSource = readBlendingRange(reader);
        const compositeGraphBlendDestinationRange = readBlendingRange(reader);
        const ranges = [];
        while (left() > 0) {
            const sourceRange = readBlendingRange(reader);
            const destRange = readBlendingRange(reader);
            ranges.push({ sourceRange, destRange });
        }
        return { compositeGrayBlendSource, compositeGraphBlendDestinationRange, ranges };
    });
}
function readLayerChannelImageData(reader, psd, layer, channels) {
    if (reader.skipLayerImageData)
        return;
    const { colorMode = 3 /* ColorMode.RGB */, bitsPerChannel = 8 } = psd;
    layer.rawData = { colorMode, bitsPerChannel, channels: [], large: reader.large };
    for (const channel of channels) {
        const start = reader.offset;
        let compression = 0 /* Compression.RawData */;
        let data = undefined;
        if (channel.length === 1)
            throw new Error('Invalid channel length');
        if (channel.length) {
            compression = readUint16(reader);
            // try to fix broken files where there's 1 byte shift of channel
            if (compression > 3) {
                reader.offset -= 1;
                compression = readUint16(reader);
            }
            // try to fix broken files where there's 1 byte shift of channel
            if (compression > 3) {
                reader.offset -= 3;
                compression = readUint16(reader);
            }
            if (compression > 3)
                throw new Error(`Invalid compression: ${compression}`);
            if (channel.length > 2) {
                data = readBytes(reader, channel.length - 2);
            }
        }
        reader.offset = start + channel.length;
        layer.rawData.channels.push({ id: channel.id, compression, data });
    }
    if (!reader.useRawData) {
        decodeLayerImageData(layer, reader);
    }
}
function resetAlpha({ data }, cmyk) {
    const alpha = (data instanceof Float32Array) ? 1.0 : ((data instanceof Uint16Array) ? 0xffff : 0xff);
    const offset = (cmyk ? 4 : 3) | 0;
    const length = data.length | 0;
    const step = (cmyk ? 5 : 4) | 0;
    for (let p = offset; p < length; p = (p + step) | 0) {
        data[p] = alpha;
    }
}
function getCompositeImageData(psd) {
    const data = psd.rawCompositeData;
    if (!data)
        return undefined;
    const reader = createReader(data.buffer, data.byteOffset, data.byteLength);
    const imageData = readImageData(reader, psd);
    return imageData;
}
function getCompositeCanvas(psd) {
    return imageDataToCanvasSafe(getCompositeImageData(psd));
}
function getLayerImageData(layer) {
    return getDataFromLayer(layer, LayerDataType.Layer, false, undefined);
}
function getLayerMaskImageData(layer) {
    return getDataFromLayer(layer, LayerDataType.Mask, false, undefined);
}
function getLayerRealMaskImageData(layer) {
    return getDataFromLayer(layer, LayerDataType.RealMask, false, undefined);
}
function getLayerCanvas(layer) {
    return imageDataToCanvasSafe(getLayerImageData(layer));
}
function getLayerMaskCanvas(layer) {
    return imageDataToCanvasSafe(getLayerMaskImageData(layer));
}
function getLayerRealMaskCanvas(layer) {
    return imageDataToCanvasSafe(getLayerRealMaskImageData(layer));
}
function imageDataToCanvasSafe(imageData) {
    return imageData && (0, helpers_1.imageDataToCanvas)(imageData);
}
function setImageDataOrCanvas(obj, imageData, useImageData) {
    if (!imageData)
        return;
    if (useImageData) {
        obj.imageData = imageData;
    }
    else {
        obj.canvas = (0, helpers_1.imageDataToCanvas)(imageData);
    }
}
function decodeLayerPixels(layer, useImageData) {
    decodeLayerImageData(layer, { useImageData });
}
function decodeLayerImageData(layer, options) {
    var _a, _b, _c;
    let { throwForMissingFeatures, useImageData } = options;
    const imageData = getDataFromLayer(layer, LayerDataType.Layer, throwForMissingFeatures, options.totalMemoryLimit);
    setImageDataOrCanvas(layer, imageData, useImageData);
    if (options.totalMemoryLimit !== undefined)
        options.totalMemoryLimit -= (_a = imageData === null || imageData === void 0 ? void 0 : imageData.data.byteLength) !== null && _a !== void 0 ? _a : 0;
    if (layer.mask) {
        const maskData = getDataFromLayer(layer, LayerDataType.Mask, throwForMissingFeatures, options.totalMemoryLimit);
        setImageDataOrCanvas(layer.mask, maskData, useImageData);
        if (options.totalMemoryLimit !== undefined)
            options.totalMemoryLimit -= (_b = maskData === null || maskData === void 0 ? void 0 : maskData.data.byteLength) !== null && _b !== void 0 ? _b : 0;
    }
    if (layer.realMask) {
        const maskData = getDataFromLayer(layer, LayerDataType.RealMask, throwForMissingFeatures, options.totalMemoryLimit);
        setImageDataOrCanvas(layer.realMask, maskData, useImageData);
        if (options.totalMemoryLimit !== undefined)
            options.totalMemoryLimit -= (_c = maskData === null || maskData === void 0 ? void 0 : maskData.data.byteLength) !== null && _c !== void 0 ? _c : 0;
    }
    delete layer.rawData;
}
var LayerDataType;
(function (LayerDataType) {
    LayerDataType[LayerDataType["Layer"] = 0] = "Layer";
    LayerDataType[LayerDataType["Mask"] = 1] = "Mask";
    LayerDataType[LayerDataType["RealMask"] = 2] = "RealMask";
})(LayerDataType || (LayerDataType = {}));
function getDataFromLayer(layer, read, throwForMissingFeatures, memoryLimit) {
    if (!layer.rawData)
        return undefined;
    const { colorMode, bitsPerChannel, channels, large } = layer.rawData;
    const layerWidth = Math.max(0, (layer.right || 0) - (layer.left || 0));
    const layerHeight = Math.max(0, (layer.bottom || 0) - (layer.top || 0));
    const cmyk = colorMode === 4 /* ColorMode.CMYK */;
    let imageData;
    let maskData;
    let initializedAlpha = false;
    if (layerWidth && layerHeight && read === LayerDataType.Layer) {
        if (cmyk) {
            if (bitsPerChannel !== 8)
                throw new Error('bitsPerChannel Not supproted');
            imageData = { width: layerWidth, height: layerHeight, data: new Uint8ClampedArray(layerWidth * layerHeight * 5) };
        }
        else {
            imageData = createImageDataBitDepth(layerWidth, layerHeight, bitsPerChannel, 4, memoryLimit);
        }
    }
    if (helpers_1.RAW_IMAGE_DATA) { // TODO: use layer.rawData instead
        layer.imageDataRaw = [];
        layer.imageDataRawCompression = [];
    }
    for (const { id, compression, data } of channels) {
        if (!data)
            continue;
        const dataReader = createReader(data.buffer, data.byteOffset, data.byteLength);
        if (id === -2 /* ChannelID.UserMask */ || id === -3 /* ChannelID.RealUserMask */) {
            if (id === -2 /* ChannelID.UserMask */ && read !== LayerDataType.Mask)
                continue;
            if (id === -3 /* ChannelID.RealUserMask */ && read !== LayerDataType.RealMask)
                continue;
            const mask = id === -2 /* ChannelID.UserMask */ ? layer.mask : layer.realMask;
            if (!mask)
                throw new Error(`Missing layer ${id === -2 /* ChannelID.UserMask */ ? 'mask' : 'real mask'} data`);
            const maskWidth = Math.max(0, (mask.right || 0) - (mask.left || 0));
            const maskHeight = Math.max(0, (mask.bottom || 0) - (mask.top || 0));
            if (maskWidth && maskHeight) {
                maskData = createImageDataBitDepth(maskWidth, maskHeight, bitsPerChannel, 4, memoryLimit);
                readData(dataReader, data.byteLength, maskData, compression, maskWidth, maskHeight, bitsPerChannel, 0, large, 4);
                if (helpers_1.RAW_IMAGE_DATA) { // TODO: use layer.rawData instead
                    if (id === -2 /* ChannelID.UserMask */) {
                        layer.maskDataRawCompression = compression;
                        layer.maskDataRaw = data;
                    }
                    else {
                        layer.realMaskDataRawCompression = compression;
                        layer.realMaskDataRaw = data;
                    }
                }
                setupGrayscale(maskData);
                resetAlpha(maskData, false);
            }
        }
        else {
            if (read !== LayerDataType.Layer)
                continue;
            const offset = (0, helpers_1.offsetForChannel)(id, cmyk);
            let targetData = imageData;
            if (offset < 0) {
                targetData = undefined;
                if (throwForMissingFeatures) {
                    throw new Error(`Channel not supported: ${id}`);
                }
            }
            readData(dataReader, data.byteLength, targetData, compression, layerWidth, layerHeight, bitsPerChannel, offset, large, cmyk ? 5 : 4);
            if (helpers_1.RAW_IMAGE_DATA) { // TODO: use layer.rawData instead
                layer.imageDataRawCompression[id] = compression;
                layer.imageDataRaw[id] = data;
            }
            if (targetData && colorMode === 1 /* ColorMode.Grayscale */) {
                setupGrayscale(targetData);
            }
        }
        if (id === -1 /* ChannelID.Transparency */) {
            initializedAlpha = true;
        }
    }
    if (imageData) {
        if (!initializedAlpha)
            resetAlpha(imageData, cmyk);
        if (cmyk) {
            const cmykData = imageData;
            imageData = (0, helpers_1.createImageData)(cmykData.width, cmykData.height);
            cmykToRgb(cmykData, imageData, false);
        }
    }
    return read === LayerDataType.Layer ? imageData : maskData;
}
function readData(reader, length, pixels, compression, width, height, bitDepth, offset, large, step) {
    if (!length)
        return;
    if (compression === 0 /* Compression.RawData */) {
        if (length !== (width * height * Math.floor(bitDepth / 8))) {
            reader.log(`Invalid length (${length}, ${width * height * Math.floor(bitDepth / 8)})`);
        }
        const data = readBytes(reader, length);
        readDataRaw(data, pixels, bitDepth, step, offset);
    }
    else if (compression === 1 /* Compression.RleCompressed */) {
        // const reader = createReader(data.buffer, data.byteOffset, data.byteLength);
        readDataRLE(reader, pixels, width, height, bitDepth, step, [offset], large);
    }
    else if (compression === 2 /* Compression.ZipWithoutPrediction */) {
        const data = readBytes(reader, length);
        readDataZip(data, pixels, width, height, bitDepth, step, offset, false);
    }
    else if (compression === 3 /* Compression.ZipWithPrediction */) {
        const data = readBytes(reader, length);
        readDataZip(data, pixels, width, height, bitDepth, step, offset, true);
    }
    else {
        throw new Error(`Invalid Compression type: ${compression}`);
    }
}
function readGlobalLayerMaskInfo(reader) {
    return readSection(reader, 1, left => {
        if (!left())
            return undefined;
        const overlayColorSpace = readUint16(reader);
        const colorSpace1 = readUint16(reader);
        const colorSpace2 = readUint16(reader);
        const colorSpace3 = readUint16(reader);
        const colorSpace4 = readUint16(reader);
        const opacity = readUint16(reader) / 0xff;
        const kind = readUint8(reader);
        skipBytes(reader, left()); // 3 bytes of padding ?
        return { overlayColorSpace, colorSpace1, colorSpace2, colorSpace3, colorSpace4, opacity, kind };
    });
}
const fixOffsets = [0, 1, -1, 2, -2, 3, -3, 4, -4];
function realignWithSignature(reader, isValid) {
    const sigOffset = reader.offset;
    let sig = '';
    // attempt to fix broken document by realigning with the signature
    for (const offset of fixOffsets) {
        try {
            reader.offset = sigOffset + offset;
            sig = readSignature(reader);
        }
        catch (_a) { }
        if (isValid(sig))
            break;
    }
    if (!isValid(sig)) {
        throw new Error(`Invalid signature: '${sig}' at 0x${(sigOffset).toString(16)}`);
    }
    return sig;
}
function isValidAdditionalInfoSignature(sig) {
    return sig === '8BIM' || sig === '8B64';
}
function readAdditionalLayerInfo(reader, target, psd, imageResources) {
    const sig = realignWithSignature(reader, isValidAdditionalInfoSignature);
    const key = readSignature(reader);
    // `largeAdditionalInfoKeys` fallback, because some keys don't have 8B64 signature even when they are 64bit
    const u64 = sig === '8B64' || (reader.large && helpers_1.largeAdditionalInfoKeys.indexOf(key) !== -1);
    readSection(reader, 2, left => {
        const handler = additionalInfo_1.infoHandlersMap[key];
        // [arozos patch] remember where the block starts so an unknown or
        // unparsable block can be kept verbatim for the writer
        const blockStart = reader.offset;
        const keepRaw = () => {
            reader.offset = blockStart;
            const bytes = readBytes(reader, left());
            (target.unknownAdditionalInfo || (target.unknownAdditionalInfo = [])).push({ sig, key, data: new Uint8Array(bytes) });
        };
        if (handler) {
            try {
                handler.read(reader, target, left, psd, imageResources);
            }
            catch (e) {
                if (reader.throwForMissingFeatures)
                    throw e;
                (target.failedAdditionalInfoKeys || (target.failedAdditionalInfoKeys = [])).push(key);
                keepRaw();
            }
        }
        else {
            reader.logMissingFeatures && reader.log(`Unhandled additional info: ${key}`);
            keepRaw();
        }
        if (left()) {
            reader.logMissingFeatures && reader.log(`Unread ${left()} bytes left for additional info: ${key}`);
            skipBytes(reader, left());
        }
    }, false, u64);
}
function createImageDataBitDepth(width, height, bitDepth, channels, memoryLimit) {
    const sizeInBytes = width * height * channels * Math.max(1, bitDepth / 8);
    if (memoryLimit !== undefined && sizeInBytes > memoryLimit)
        throw new Error('Exceeded memory limit');
    if (bitDepth === 1 || bitDepth === 8) {
        if (channels === 4) {
            return (0, helpers_1.createImageData)(width, height);
        }
        else {
            return { width, height, data: new Uint8ClampedArray(width * height * channels) };
        }
    }
    else if (bitDepth === 16) {
        return { width, height, data: new Uint16Array(width * height * channels) };
    }
    else if (bitDepth === 32) {
        return { width, height, data: new Float32Array(width * height * channels) };
    }
    else {
        throw new Error(`Invalid bitDepth (${bitDepth})`);
    }
}
function readImageData(reader, psd) {
    var _a;
    const compression = readUint16(reader);
    const bitsPerChannel = (_a = psd.bitsPerChannel) !== null && _a !== void 0 ? _a : 8;
    if (exports.supportedColorModes.indexOf(psd.colorMode) === -1)
        throw new Error(`Color mode not supported: ${psd.colorMode}`);
    if (compression !== 0 /* Compression.RawData */ && compression !== 1 /* Compression.RleCompressed */)
        throw new Error(`Compression type not supported: ${compression}`);
    const imageData = createImageDataBitDepth(psd.width, psd.height, bitsPerChannel, 4, reader.totalMemoryLimit);
    if (reader.totalMemoryLimit !== undefined)
        reader.totalMemoryLimit -= imageData.data.byteLength;
    (0, helpers_1.resetImageData)(imageData);
    switch (psd.colorMode) {
        case 0 /* ColorMode.Bitmap */: {
            if (bitsPerChannel !== 1)
                throw new Error('Invalid bitsPerChannel for bitmap color mode');
            let bytes;
            if (compression === 0 /* Compression.RawData */) {
                bytes = readBytes(reader, Math.ceil(psd.width / 8) * psd.height);
            }
            else if (compression === 1 /* Compression.RleCompressed */) {
                bytes = new Uint8Array(psd.width * psd.height);
                readDataRLE(reader, { data: bytes, width: psd.width, height: psd.height }, psd.width, psd.height, 8, 1, [0], reader.large);
            }
            else {
                throw new Error(`Compression not supported: ${compression}`);
            }
            (0, helpers_1.decodeBitmap)(bytes, imageData.data, psd.width, psd.height);
            break;
        }
        case 3 /* ColorMode.RGB */:
        case 1 /* ColorMode.Grayscale */: {
            const channels = psd.colorMode === 1 /* ColorMode.Grayscale */ ? [0] : [0, 1, 2];
            if (psd.channels && psd.channels > 3) {
                for (let i = 3; i < psd.channels; i++) {
                    // TODO: store these channels in additional image data
                    channels.push(i);
                }
            }
            else if (reader.globalAlpha) {
                channels.push(3);
            }
            if (compression === 0 /* Compression.RawData */) {
                for (let i = 0; i < channels.length; i++) {
                    const data = readBytes(reader, psd.width * psd.height * Math.floor(bitsPerChannel / 8));
                    readDataRaw(data, imageData, bitsPerChannel, 4, channels[i]);
                }
            }
            else if (compression === 1 /* Compression.RleCompressed */) {
                const start = reader.offset;
                readDataRLE(reader, imageData, psd.width, psd.height, bitsPerChannel, 4, channels, reader.large);
                if (helpers_1.RAW_IMAGE_DATA)
                    psd.imageDataRaw = new Uint8Array(reader.view.buffer, reader.view.byteOffset + start, reader.offset - start);
            }
            else {
                throw new Error(`Compression not supported: ${compression}`);
            }
            if (psd.colorMode === 1 /* ColorMode.Grayscale */) {
                setupGrayscale(imageData);
            }
            break;
        }
        case 2 /* ColorMode.Indexed */: {
            if (bitsPerChannel !== 8)
                throw new Error('bitsPerChannel Not supproted');
            if (psd.channels !== 1)
                throw new Error('Invalid channel count');
            if (!psd.palette)
                throw new Error('Missing color palette');
            if (compression === 0 /* Compression.RawData */) {
                throw new Error(`Compression not supported: ${compression}`);
            }
            else if (compression === 1 /* Compression.RleCompressed */) {
                const indexedImageData = {
                    width: imageData.width,
                    height: imageData.height,
                    data: new Uint8Array(imageData.width * imageData.height),
                };
                readDataRLE(reader, indexedImageData, psd.width, psd.height, bitsPerChannel, 1, [0], reader.large);
                indexedToRgb(indexedImageData, imageData, psd.palette);
            }
            else {
                throw new Error(`Compression not supported: ${compression}`);
            }
            break;
        }
        case 4 /* ColorMode.CMYK */: {
            if (bitsPerChannel !== 8)
                throw new Error('bitsPerChannel Not supproted');
            if (psd.channels !== 4)
                throw new Error(`Invalid channel count`);
            const channels = [0, 1, 2, 3];
            if (reader.globalAlpha)
                channels.push(4);
            if (compression === 0 /* Compression.RawData */) {
                throw new Error(`Compression not supported: ${compression}`);
                // TODO: ...
                // for (let i = 0; i < channels.length; i++) {
                // 	readDataRaw(reader, imageData, channels[i], psd.width, psd.height);
                // }
            }
            else if (compression === 1 /* Compression.RleCompressed */) {
                const cmykImageData = {
                    width: imageData.width,
                    height: imageData.height,
                    data: new Uint8Array(imageData.width * imageData.height * 5),
                };
                const start = reader.offset;
                readDataRLE(reader, cmykImageData, psd.width, psd.height, bitsPerChannel, 5, channels, reader.large);
                cmykToRgb(cmykImageData, imageData, true);
                if (helpers_1.RAW_IMAGE_DATA)
                    psd.imageDataRaw = new Uint8Array(reader.view.buffer, reader.view.byteOffset + start, reader.offset - start);
            }
            else {
                throw new Error(`Compression not supported: ${compression}`);
            }
            break;
        }
        default: throw new Error(`Color mode not supported: ${psd.colorMode}`);
    }
    // remove weird white matte
    if (reader.globalAlpha) {
        if (psd.bitsPerChannel !== 8)
            throw new Error('bitsPerChannel Not supproted');
        const p = imageData.data;
        const size = imageData.width * imageData.height * 4;
        for (let i = 0; i < size; i += 4) {
            const pa = p[i + 3];
            if (pa != 0 && pa != 255) {
                const a = pa / 255;
                const ra = 1 / a;
                const invA = 255 * (1 - ra);
                p[i + 0] = p[i + 0] * ra + invA;
                p[i + 1] = p[i + 1] * ra + invA;
                p[i + 2] = p[i + 2] * ra + invA;
            }
        }
    }
    return imageData;
}
function cmykToRgb(cmyk, rgb, reverseAlpha) {
    const size = rgb.width * rgb.height * 4;
    const srcData = cmyk.data;
    const dstData = rgb.data;
    for (let src = 0, dst = 0; dst < size; src += 5, dst += 4) {
        const c = srcData[src];
        const m = srcData[src + 1];
        const y = srcData[src + 2];
        const k = srcData[src + 3];
        dstData[dst] = ((((c * k) | 0) / 255) | 0);
        dstData[dst + 1] = ((((m * k) | 0) / 255) | 0);
        dstData[dst + 2] = ((((y * k) | 0) / 255) | 0);
        dstData[dst + 3] = reverseAlpha ? 255 - srcData[src + 4] : srcData[src + 4];
    }
    // for (let src = 0, dst = 0; dst < size; src += 5, dst += 4) {
    // 	const c = 1 - (srcData[src + 0] / 255);
    // 	const m = 1 - (srcData[src + 1] / 255);
    // 	const y = 1 - (srcData[src + 2] / 255);
    // 	// const k = srcData[src + 3] / 255;
    // 	dstData[dst + 0] = ((1 - c * 0.8) * 255) | 0;
    // 	dstData[dst + 1] = ((1 - m * 0.8) * 255) | 0;
    // 	dstData[dst + 2] = ((1 - y * 0.8) * 255) | 0;
    // 	dstData[dst + 3] = reverseAlpha ? 255 - srcData[src + 4] : srcData[src + 4];
    // }
}
function indexedToRgb(indexed, rgb, palette) {
    const size = indexed.width * indexed.height;
    const srcData = indexed.data;
    const dstData = rgb.data;
    for (let src = 0, dst = 0; src < size; src++, dst += 4) {
        const c = palette[srcData[src]];
        dstData[dst + 0] = c.r;
        dstData[dst + 1] = c.g;
        dstData[dst + 2] = c.b;
        dstData[dst + 3] = 255;
    }
}
function verifyCompatible(a, b) {
    if ((a.byteLength / a.length) !== (b.byteLength / b.length)) {
        throw new Error('Invalid array types');
    }
}
function bytesToArray(bytes, bitDepth) {
    if (bitDepth === 8) {
        return bytes;
    }
    else if (bitDepth === 16) {
        // PSD files store 16-bit channel data in big-endian byte order.
        // Swap each pair of bytes so that Uint16Array (native-endian) reads the correct values.
        for (let i = 0; i < bytes.byteLength; i += 2) {
            const tmp = bytes[i];
            bytes[i] = bytes[i + 1];
            bytes[i + 1] = tmp;
        }
        if (bytes.byteOffset % 2) {
            const result = new Uint16Array(bytes.byteLength / 2);
            new Uint8Array(result.buffer, result.byteOffset, result.byteLength).set(bytes);
            return result;
        }
        else {
            return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
        }
    }
    else if (bitDepth === 32) {
        if (bytes.byteOffset % 4) {
            const result = new Float32Array(bytes.byteLength / 4);
            new Uint8Array(result.buffer, result.byteOffset, result.byteLength).set(bytes);
            return result;
        }
        else {
            return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        }
    }
    else {
        throw new Error(`Invalid bitDepth (${bitDepth})`);
    }
}
function copyChannelToPixelData(pixelData, channel, offset, step) {
    verifyCompatible(pixelData.data, channel);
    const size = pixelData.width * pixelData.height;
    const data = pixelData.data;
    for (let i = 0, p = offset | 0; i < size; i++, p = (p + step) | 0) {
        data[p] = channel[i];
    }
}
function readDataRaw(buffer, pixelData, bitDepth, step, offset) {
    if (bitDepth == 32) {
        for (let i = 0; i < buffer.byteLength; i += 4) {
            const a = buffer[i + 0];
            const b = buffer[i + 1];
            const c = buffer[i + 2];
            const d = buffer[i + 3];
            buffer[i + 0] = d;
            buffer[i + 1] = c;
            buffer[i + 2] = b;
            buffer[i + 3] = a;
        }
    }
    const array = bytesToArray(buffer, bitDepth);
    if (pixelData && offset < step) {
        copyChannelToPixelData(pixelData, array, offset, step);
    }
}
function decodePredicted(data, width, height, mod) {
    for (let y = 0; y < height; y++) {
        const offset = y * width;
        for (let x = 1, o = offset + 1; x < width; x++, o++) {
            data[o] = (data[o - 1] + data[o]) % mod;
        }
    }
}
function readDataZip(compressed, pixelData, width, height, bitDepth, step, offset, prediction) {
    const decompressed = (0, pako_1.inflate)(compressed);
    if (pixelData && offset < step) {
        const array = bytesToArray(decompressed, bitDepth);
        if (bitDepth === 8) {
            if (prediction)
                decodePredicted(decompressed, width, height, 0x100);
            copyChannelToPixelData(pixelData, decompressed, offset, step);
        }
        else if (bitDepth === 16) {
            if (prediction)
                decodePredicted(array, width, height, 0x10000);
            copyChannelToPixelData(pixelData, array, offset, step);
        }
        else if (bitDepth === 32) {
            if (prediction)
                decodePredicted(decompressed, width * 4, height, 0x100);
            let di = offset;
            const dst = new Uint32Array(pixelData.data.buffer, pixelData.data.byteOffset, pixelData.data.length);
            for (let y = 0; y < height; y++) {
                let a = width * 4 * y;
                for (let x = 0; x < width; x++, a++, di += step) {
                    const b = a + width;
                    const c = b + width;
                    const d = c + width;
                    dst[di] = ((decompressed[a] << 24) | (decompressed[b] << 16) | (decompressed[c] << 8) | decompressed[d]) >>> 0;
                }
            }
        }
        else {
            throw new Error('Invalid bitDepth');
        }
    }
}
function readDataRLE(reader, pixelData, width, height, _bitDepth, step, offsets, large) {
    const data = pixelData && pixelData.data;
    let lengths;
    if (large) {
        consumeMemory(reader, offsets.length * height * 4);
        lengths = new Uint32Array(offsets.length * height);
        for (let o = 0, li = 0; o < offsets.length; o++) {
            for (let y = 0; y < height; y++, li++) {
                lengths[li] = readUint32(reader);
            }
        }
    }
    else {
        consumeMemory(reader, offsets.length * height * 2);
        lengths = new Uint16Array(offsets.length * height);
        for (let o = 0, li = 0; o < offsets.length; o++) {
            for (let y = 0; y < height; y++, li++) {
                lengths[li] = readUint16(reader);
            }
        }
    }
    // if (bitDepth !== 1 && bitDepth !== 8) throw new Error(`Invalid bit depth (${bitDepth})`);
    const extraLimit = (step - 1) | 0; // 3 for rgb, 4 for cmyk
    for (let c = 0, li = 0; c < offsets.length; c++) {
        const offset = offsets[c] | 0;
        const extra = c > extraLimit || offset > extraLimit;
        if (!data || extra) {
            for (let y = 0; y < height; y++, li++) {
                skipBytes(reader, lengths[li]);
            }
        }
        else {
            for (let y = 0, p = offset | 0; y < height; y++, li++) {
                const length = lengths[li];
                const buffer = readBytes(reader, length);
                for (let i = 0, x = 0; i < length; i++) {
                    let header = buffer[i];
                    if (header > 128) {
                        const value = buffer[++i];
                        header = (256 - header) | 0;
                        for (let j = 0; j <= header && x < width; j = (j + 1) | 0, x = (x + 1) | 0) {
                            data[p] = value;
                            p = (p + step) | 0;
                        }
                    }
                    else if (header < 128) {
                        for (let j = 0; j <= header && x < width; j = (j + 1) | 0, x = (x + 1) | 0) {
                            data[p] = buffer[++i];
                            p = (p + step) | 0;
                        }
                    }
                    else {
                        // ignore 128
                    }
                    // This showed up on some images from non-photoshop programs, ignoring it seems to work just fine.
                    // if (i >= length) throw new Error(`Invalid RLE data: exceeded buffer size ${i}/${length}`);
                }
            }
        }
    }
    recoverMemory(reader, lengths.byteLength);
}
function readSection(reader, round, func, skipEmpty = true, eightBytes = false) {
    let length = readUint32(reader);
    if (eightBytes) {
        if (length !== 0)
            throw new Error('Sizes larger than 4GB are not supported');
        length = readUint32(reader);
    }
    if (length <= 0 && skipEmpty)
        return undefined;
    let end = reader.offset + length;
    if (end > reader.view.byteLength)
        throw new Error('Section exceeds file size');
    const result = func(() => end - reader.offset);
    if (reader.offset !== end) {
        if (reader.offset > end) {
            warnOrThrow(reader, 'Exceeded section limits');
        }
        else {
            warnOrThrow(reader, `Unread section data`); // : ${end - reader.offset} bytes at 0x${reader.offset.toString(16)}`);
        }
    }
    while (length % round) {
        length++;
        end++;
    }
    // while (end % round) end++;
    reader.offset = end;
    return result;
}
function readColor(reader) {
    const colorSpace = readUint16(reader);
    switch (colorSpace) {
        case 0 /* ColorSpace.RGB */: {
            const r = readUint16(reader) / 257;
            const g = readUint16(reader) / 257;
            const b = readUint16(reader) / 257;
            skipBytes(reader, 2);
            return { r, g, b };
        }
        case 1 /* ColorSpace.HSB */: {
            const h = readUint16(reader) / 0xffff;
            const s = readUint16(reader) / 0xffff;
            const b = readUint16(reader) / 0xffff;
            skipBytes(reader, 2);
            return { h, s, b };
        }
        case 2 /* ColorSpace.CMYK */: {
            const c = readUint16(reader) / 257;
            const m = readUint16(reader) / 257;
            const y = readUint16(reader) / 257;
            const k = readUint16(reader) / 257;
            return { c, m, y, k };
        }
        case 7 /* ColorSpace.Lab */: {
            const l = readInt16(reader) / 10000;
            const ta = readInt16(reader);
            const tb = readInt16(reader);
            const a = ta < 0 ? (ta / 12800) : (ta / 12700);
            const b = tb < 0 ? (tb / 12800) : (tb / 12700);
            skipBytes(reader, 2);
            return { l, a, b };
        }
        case 8 /* ColorSpace.Grayscale */: {
            const k = readUint16(reader) * 255 / 10000;
            skipBytes(reader, 6);
            return { k };
        }
        default:
            throw new Error('Invalid color space');
    }
}
function readPattern(reader) {
    let length = readUint32(reader);
    while (length % 4)
        length++;
    const end = reader.offset + length;
    const version = readUint32(reader);
    if (version !== 1)
        throw new Error(`Invalid pattern version: ${version}`);
    const colorMode = readUint32(reader);
    const x = readInt16(reader);
    const y = readInt16(reader);
    // we only support RGB and grayscale for now
    if (colorMode !== 3 /* ColorMode.RGB */ && colorMode !== 1 /* ColorMode.Grayscale */ && colorMode !== 2 /* ColorMode.Indexed */) {
        throw new Error(`Unsupported pattern color mode: ${colorMode}`);
    }
    let name = readUnicodeString(reader);
    const id = readPascalString(reader, 1);
    const palette = [];
    if (colorMode === 2 /* ColorMode.Indexed */) {
        for (let i = 0; i < 256; i++) {
            palette.push({
                r: readUint8(reader),
                g: readUint8(reader),
                b: readUint8(reader),
            });
        }
        skipBytes(reader, 4); // no idea what this is
    }
    // virtual memory array list
    const version2 = readUint32(reader);
    if (version2 !== 3)
        throw new Error(`Invalid pattern VMAL version: ${version2}`);
    readUint32(reader); // length
    const top = readUint32(reader);
    const left = readUint32(reader);
    const bottom = readUint32(reader);
    const right = readUint32(reader);
    const channelsCount = readUint32(reader);
    const width = right - left;
    const height = bottom - top;
    const size = width * height * 4;
    consumeMemory(reader, size);
    const data = new Uint8Array(size);
    for (let i = 3; i < data.byteLength; i += 4) {
        data[i] = 255;
    }
    for (let i = 0, ch = 0; i < (channelsCount + 2); i++) {
        const has = readUint32(reader);
        if (!has)
            continue;
        const length = readUint32(reader);
        const pixelDepth = readUint32(reader);
        const ctop = readUint32(reader);
        const cleft = readUint32(reader);
        const cbottom = readUint32(reader);
        const cright = readUint32(reader);
        const pixelDepth2 = readUint16(reader);
        const compressionMode = readUint8(reader); // 0 - raw, 1 - rle
        const dataLength = length - (4 + 16 + 2 + 1);
        const cdata = readBytes(reader, dataLength);
        if (pixelDepth !== 8 || pixelDepth2 !== 8) {
            throw new Error('16bit pixel depth not supported for patterns');
        }
        const w = cright - cleft;
        const h = cbottom - ctop;
        const ox = cleft - left;
        const oy = ctop - top;
        if (compressionMode === 0) {
            if (colorMode === 3 /* ColorMode.RGB */ && ch < 3) {
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const src = x + y * w;
                        const dst = (ox + x + (y + oy) * width) * 4;
                        data[dst + ch] = cdata[src];
                    }
                }
            }
            else if (colorMode === 1 /* ColorMode.Grayscale */ && ch < 1) {
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const src = x + y * w;
                        const dst = (ox + x + (y + oy) * width) * 4;
                        const value = cdata[src];
                        data[dst + 0] = value;
                        data[dst + 1] = value;
                        data[dst + 2] = value;
                    }
                }
            }
            else if (colorMode === 2 /* ColorMode.Indexed */) {
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        const src = x + y * w;
                        const dst = (ox + x + (y + oy) * width) * 4;
                        const index = cdata[src];
                        const color = palette[index];
                        data[dst + 0] = color.r;
                        data[dst + 1] = color.g;
                        data[dst + 2] = color.b;
                    }
                }
            }
            else {
                if (reader.throwForMissingFeatures)
                    throw new Error('Invalid color pattern');
            }
        }
        else if (compressionMode === 1) {
            consumeMemory(reader, w * h);
            const pixelData = { data, width, height };
            const tempData = { data: new Uint8Array(w * h), width: w, height: h };
            const cdataReader = createReader(cdata.buffer, cdata.byteOffset, cdata.byteLength);
            if (colorMode === 3 /* ColorMode.RGB */ && ch < 3) {
                readDataRLE(cdataReader, tempData, w, h, 8, 1, [0], false);
                copyChannelToRGBA(tempData, pixelData, ox, oy, ch);
            }
            if (colorMode === 1 /* ColorMode.Grayscale */ && ch < 1) {
                readDataRLE(cdataReader, tempData, w, h, 8, 1, [0], false);
                copyChannelToRGBA(tempData, pixelData, ox, oy, 0);
                setupGrayscale(pixelData);
            }
            if (colorMode === 2 /* ColorMode.Indexed */) {
                // TODO:
                throw new Error('Indexed pattern color mode not implemented');
            }
            recoverMemory(reader, w * h);
        }
        else {
            throw new Error('Invalid pattern compression mode');
        }
        ch++;
    }
    reader.offset = end;
    return { id, name, x, y, bounds: { x: left, y: top, w: width, h: height }, data };
}
function copyChannelToRGBA(srcData, dstData, ox, oy, offset) {
    const w = srcData.width;
    const h = srcData.height;
    const width = dstData.width;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const src = x + y * w;
            const dst = (ox + x + (y + oy) * width) * 4;
            const value = srcData.data[src];
            dstData.data[dst + offset] = value;
        }
    }
}
function consumeMemory(reader, size) {
    if (reader.totalMemoryLimit !== undefined) {
        if (reader.totalMemoryLimit < size)
            throw new Error('Exceeded memory limit');
        reader.totalMemoryLimit -= size;
    }
}
function recoverMemory(reader, size) {
    if (reader.totalMemoryLimit !== undefined) {
        reader.totalMemoryLimit += size;
    }
}

},{"./additionalInfo":2,"./helpers":8,"./imageResources":9,"pako":20}],14:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWriter = createWriter;
exports.getWriterBuffer = getWriterBuffer;
exports.getWriterBufferNoCopy = getWriterBufferNoCopy;
exports.writeUint8 = writeUint8;
exports.writeInt16 = writeInt16;
exports.writeUint16 = writeUint16;
exports.writeUint16LE = writeUint16LE;
exports.writeInt32 = writeInt32;
exports.writeInt32LE = writeInt32LE;
exports.writeUint32 = writeUint32;
exports.writeFloat32 = writeFloat32;
exports.writeFloat64 = writeFloat64;
exports.writeFixedPoint32 = writeFixedPoint32;
exports.writeFixedPointPath32 = writeFixedPointPath32;
exports.writeBytes = writeBytes;
exports.writeZeros = writeZeros;
exports.writeSignature = writeSignature;
exports.writeAsciiString = writeAsciiString;
exports.writePascalString = writePascalString;
exports.writeUnicodeStringWithoutLength = writeUnicodeStringWithoutLength;
exports.writeUnicodeStringWithoutLengthLE = writeUnicodeStringWithoutLengthLE;
exports.writeUnicodeString = writeUnicodeString;
exports.writeUnicodeStringWithPadding = writeUnicodeStringWithPadding;
exports.writeSection = writeSection;
exports.writePsd = writePsd;
exports.writeColor = writeColor;
exports.writePattern = writePattern;
const helpers_1 = require("./helpers");
const additionalInfo_1 = require("./additionalInfo");
const imageResources_1 = require("./imageResources");
function createWriter(size = 4096) {
    const buffer = new ArrayBuffer(size);
    const view = new DataView(buffer);
    const offset = 0;
    return { buffer, view, offset, tempBuffer: undefined };
}
function getWriterBuffer(writer) {
    return writer.buffer.slice(0, writer.offset);
}
function getWriterBufferNoCopy(writer) {
    return new Uint8Array(writer.buffer, 0, writer.offset);
}
function writeUint8(writer, value) {
    const offset = addSize(writer, 1);
    writer.view.setUint8(offset, value);
}
function writeInt16(writer, value) {
    const offset = addSize(writer, 2);
    writer.view.setInt16(offset, value, false);
}
function writeUint16(writer, value) {
    const offset = addSize(writer, 2);
    writer.view.setUint16(offset, value, false);
}
function writeUint16LE(writer, value) {
    const offset = addSize(writer, 2);
    writer.view.setUint16(offset, value, true);
}
function writeInt32(writer, value) {
    const offset = addSize(writer, 4);
    writer.view.setInt32(offset, value, false);
}
function writeInt32LE(writer, value) {
    const offset = addSize(writer, 4);
    writer.view.setInt32(offset, value, true);
}
function writeUint32(writer, value) {
    const offset = addSize(writer, 4);
    writer.view.setUint32(offset, value, false);
}
function writeFloat32(writer, value) {
    const offset = addSize(writer, 4);
    writer.view.setFloat32(offset, value, false);
}
function writeFloat64(writer, value) {
    const offset = addSize(writer, 8);
    writer.view.setFloat64(offset, value, false);
}
// 32-bit fixed-point number 16.16
function writeFixedPoint32(writer, value) {
    writeInt32(writer, value * (1 << 16));
}
// 32-bit fixed-point number 8.24
function writeFixedPointPath32(writer, value) {
    writeInt32(writer, value * (1 << 24));
}
function writeBytes(writer, buffer) {
    if (buffer) {
        ensureSize(writer, writer.offset + buffer.length);
        const bytes = new Uint8Array(writer.buffer);
        bytes.set(buffer, writer.offset);
        writer.offset += buffer.length;
    }
}
function writeZeros(writer, count) {
    for (let i = 0; i < count; i++) {
        writeUint8(writer, 0);
    }
}
function writeSignature(writer, signature) {
    if (signature.length !== 4)
        throw new Error(`Invalid signature: '${signature}'`);
    for (let i = 0; i < 4; i++) {
        writeUint8(writer, signature.charCodeAt(i));
    }
}
function writeAsciiString(writer, text) {
    for (let i = 0; i < text.length; i++) {
        writeUint8(writer, text.charCodeAt(i));
    }
}
function writePascalString(writer, text, padTo) {
    let length = text.length;
    if (length > 255)
        throw new Error(`String too long`);
    writeUint8(writer, length);
    for (let i = 0; i < length; i++) {
        const code = text.charCodeAt(i);
        // writeUint8(writer, code); // for testing
        writeUint8(writer, code < 128 ? code : '?'.charCodeAt(0));
    }
    while (++length % padTo) {
        writeUint8(writer, 0);
    }
}
function writeUnicodeStringWithoutLength(writer, text) {
    for (let i = 0; i < text.length; i++) {
        writeUint16(writer, text.charCodeAt(i));
    }
}
function writeUnicodeStringWithoutLengthLE(writer, text) {
    for (let i = 0; i < text.length; i++) {
        writeUint16LE(writer, text.charCodeAt(i));
    }
}
function writeUnicodeString(writer, text) {
    writeUint32(writer, text.length);
    writeUnicodeStringWithoutLength(writer, text);
}
function writeUnicodeStringWithPadding(writer, text) {
    writeUint32(writer, text.length + 1);
    for (let i = 0; i < text.length; i++) {
        writeUint16(writer, text.charCodeAt(i));
    }
    writeUint16(writer, 0);
}
function getLargestLayerSize(layers = []) {
    let max = 0;
    for (const layer of layers) {
        const { width, height } = getLayerDimentions(layer);
        max = Math.max(max, 2 * height + 2 * width * height);
        if (layer.mask) {
            const { width, height } = getLayerDimentions(layer.mask);
            max = Math.max(max, 2 * height + 2 * width * height);
        }
        if (layer.realMask) {
            const { width, height } = getLayerDimentions(layer.realMask);
            max = Math.max(max, 2 * height + 2 * width * height);
        }
        if (layer.children) {
            max = Math.max(max, getLargestLayerSize(layer.children));
        }
    }
    return max;
}
function writeSection(writer, round, func, writeTotalLength = false, large = false) {
    if (large)
        writeUint32(writer, 0);
    const offset = writer.offset;
    writeUint32(writer, 0);
    func();
    let length = writer.offset - offset - 4;
    let len = length;
    while (len % round) {
        writeUint8(writer, 0);
        len++;
    }
    // while (writer.offset % round) {
    // 	writeUint8(writer, 0);
    // 	len++;
    // }
    if (writeTotalLength) {
        length = len;
    }
    writer.view.setUint32(offset, length, false);
}
function verifyBitCount(target) {
    var _a;
    (_a = target.children) === null || _a === void 0 ? void 0 : _a.forEach(verifyBitCount);
    const data = target.imageData;
    if (data && (data.data instanceof Uint32Array || data.data instanceof Uint16Array)) {
        throw new Error('imageData has incorrect bitDepth');
    }
    if ('mask' in target && target.mask) {
        const data = target.mask.imageData;
        if (data && (data.data instanceof Uint32Array || data.data instanceof Uint16Array)) {
            throw new Error('mask imageData has incorrect bitDepth');
        }
    }
}
function writePsd(writer, psd, options = {}) {
    var _a;
    if (!(+psd.width > 0 && +psd.height > 0))
        throw new Error('Invalid document size');
    if ((psd.width > 30000 || psd.height > 30000) && !options.psb)
        throw new Error('Document size is too large (max is 30000x30000, use PSB format instead)');
    const bitsPerChannel = (_a = psd.bitsPerChannel) !== null && _a !== void 0 ? _a : 8;
    if (bitsPerChannel !== 8)
        throw new Error('bitsPerChannel other than 8 are not supported for writing');
    verifyBitCount(psd);
    const imageResources = Object.assign({}, psd.imageResources);
    const opt = Object.assign(Object.assign({}, options), { layerIds: new Set(), layerToId: new Map() });
    if (opt.generateThumbnail) {
        imageResources.thumbnail = createThumbnail(psd);
    }
    let imageData = psd.imageData;
    if (!imageData && psd.canvas) {
        imageData = psd.canvas.getContext('2d').getImageData(0, 0, psd.canvas.width, psd.canvas.height);
    }
    if (imageData && (psd.width !== imageData.width || psd.height !== imageData.height))
        throw new Error('Document canvas must have the same size as document');
    const globalAlpha = !!imageData && (0, helpers_1.hasAlpha)(imageData);
    const maxBufferSize = Math.max(getLargestLayerSize(psd.children), 4 * 2 * psd.width * psd.height + 2 * psd.height);
    writer.tempBuffer = new Uint8Array(maxBufferSize);
    // header
    writeSignature(writer, '8BPS');
    writeUint16(writer, options.psb ? 2 : 1); // version
    writeZeros(writer, 6);
    writeUint16(writer, globalAlpha ? 4 : 3); // channels
    writeUint32(writer, psd.height);
    writeUint32(writer, psd.width);
    writeUint16(writer, bitsPerChannel); // bits per channel
    writeUint16(writer, 3 /* ColorMode.RGB */); // we only support saving RGB right now
    // color mode data
    writeSection(writer, 1, () => {
        var _a, _b, _c;
        if (psd.palette) {
            for (let i = 0; i < 256; i++)
                writeUint8(writer, ((_a = psd.palette[i]) === null || _a === void 0 ? void 0 : _a.r) || 0);
            for (let i = 0; i < 256; i++)
                writeUint8(writer, ((_b = psd.palette[i]) === null || _b === void 0 ? void 0 : _b.g) || 0);
            for (let i = 0; i < 256; i++)
                writeUint8(writer, ((_c = psd.palette[i]) === null || _c === void 0 ? void 0 : _c.b) || 0);
        }
        // TODO: other data?
    });
    const layers = [];
    addChildren(layers, psd.children);
    if (!layers.length)
        layers.push({});
    // image resources
    imageResources.layersGroup = layers.map(l => l.linkGroup || 0);
    imageResources.layerGroupsEnabledId = layers.map(l => l.linkGroupEnabled == false ? 0 : 1);
    writeSection(writer, 1, () => {
        for (const handler of imageResources_1.resourceHandlers) {
            const has = handler.has(imageResources);
            const count = has === false ? 0 : (has === true ? 1 : has);
            for (let i = 0; i < count; i++) {
                writeSignature(writer, '8BIM');
                writeUint16(writer, handler.key);
                writePascalString(writer, '', 2);
                writeSection(writer, 2, () => handler.write(writer, imageResources, i));
            }
        }
    });
    // layer and mask info
    writeSection(writer, 2, () => {
        writeLayerInfo(writer, layers, psd, globalAlpha, opt);
        writeGlobalLayerMaskInfo(writer, psd.globalLayerMaskInfo);
        writeAdditionalLayerInfo(writer, psd, psd, opt);
    }, undefined, !!opt.psb);
    // image data
    const channels = globalAlpha ? [0, 1, 2, 3] : [0, 1, 2];
    const width = imageData ? imageData.width : psd.width;
    const height = imageData ? imageData.height : psd.height;
    const data = { data: new Uint8Array(width * height * 4), width, height };
    writeUint16(writer, 1 /* Compression.RleCompressed */); // Photoshop doesn't support zip compression of composite image data
    if (helpers_1.RAW_IMAGE_DATA && psd.imageDataRaw) {
        console.log('writing raw image data');
        writeBytes(writer, psd.imageDataRaw);
    }
    else {
        if (imageData)
            data.data.set(new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength));
        // add weird white matte
        if (globalAlpha) {
            const size = data.width * data.height * 4;
            const p = data.data;
            for (let i = 0; i < size; i += 4) {
                const pa = p[i + 3];
                if (pa != 0 && pa != 255) {
                    const a = pa / 255;
                    const ra = 255 * (1 - a);
                    p[i + 0] = p[i + 0] * a + ra;
                    p[i + 1] = p[i + 1] * a + ra;
                    p[i + 2] = p[i + 2] * a + ra;
                }
            }
        }
        writeBytes(writer, (0, helpers_1.writeDataRLE)(writer.tempBuffer, data, channels, !!options.psb));
    }
}
function writeLayerInfo(writer, layers, psd, globalAlpha, options) {
    writeSection(writer, 4, () => {
        var _a;
        writeInt16(writer, globalAlpha ? -layers.length : layers.length);
        const layersData = layers.map((l, i) => getChannels(writer.tempBuffer, l, i === 0, options));
        // layer records
        for (const layerData of layersData) {
            const { layer, top, left, bottom, right, channels } = layerData;
            writeInt32(writer, top);
            writeInt32(writer, left);
            writeInt32(writer, bottom);
            writeInt32(writer, right);
            writeUint16(writer, channels.length);
            for (const c of channels) {
                writeInt16(writer, c.id);
                if (options.psb)
                    writeUint32(writer, 0);
                writeUint32(writer, c.length);
            }
            writeSignature(writer, '8BIM');
            writeSignature(writer, helpers_1.fromBlendMode[layer.blendMode] || 'norm');
            writeUint8(writer, Math.round((0, helpers_1.clamp)((_a = layer.opacity) !== null && _a !== void 0 ? _a : 1, 0, 1) * 255));
            writeUint8(writer, layer.clipping ? 1 : 0);
            let flags = 0x08; // 1 for Photoshop 5.0 and later, tells if bit 4 has useful information
            if (layer.transparencyProtected)
                flags |= 0x01;
            if (layer.hidden)
                flags |= 0x02;
            if (layer.vectorMask || (layer.sectionDivider && layer.sectionDivider.type !== 0 /* SectionDividerType.Other */) || layer.adjustment) {
                flags |= 0x10; // pixel data irrelevant to appearance of document
            }
            if (layer.effectsOpen)
                flags |= 0x20;
            writeUint8(writer, flags);
            writeUint8(writer, 0); // filler
            writeSection(writer, 1, () => {
                writeLayerMaskData(writer, layer, layerData);
                writeLayerBlendingRanges(writer, layer);
                writePascalString(writer, (layer.name || '').substring(0, 255), 4);
                writeAdditionalLayerInfo(writer, layer, psd, options);
            });
        }
        // layer channel image data
        for (const layerData of layersData) {
            for (const channel of layerData.channels) {
                writeUint16(writer, channel.compression);
                if (channel.data) {
                    writeBytes(writer, channel.data);
                }
            }
        }
    }, true, options.psb);
}
function writeLayerMaskData(writer, { mask, realMask }, layerData) {
    writeSection(writer, 1, () => {
        if (!mask && !realMask)
            return;
        let params = 0, flags = 0, realFlags = 0;
        if (mask) {
            if (mask.userMaskDensity !== undefined)
                params |= 1 /* MaskParams.UserMaskDensity */;
            if (mask.userMaskFeather !== undefined)
                params |= 2 /* MaskParams.UserMaskFeather */;
            if (mask.vectorMaskDensity !== undefined)
                params |= 4 /* MaskParams.VectorMaskDensity */;
            if (mask.vectorMaskFeather !== undefined)
                params |= 8 /* MaskParams.VectorMaskFeather */;
            if (mask.disabled)
                flags |= 2 /* LayerMaskFlags.LayerMaskDisabled */;
            if (mask.positionRelativeToLayer)
                flags |= 1 /* LayerMaskFlags.PositionRelativeToLayer */;
            if (mask.fromVectorData)
                flags |= 8 /* LayerMaskFlags.LayerMaskFromRenderingOtherData */;
            if (params)
                flags |= 16 /* LayerMaskFlags.MaskHasParametersAppliedToIt */;
        }
        const m = layerData.mask || {};
        writeInt32(writer, m.top || 0);
        writeInt32(writer, m.left || 0);
        writeInt32(writer, m.bottom || 0);
        writeInt32(writer, m.right || 0);
        writeUint8(writer, mask && mask.defaultColor || 0);
        writeUint8(writer, flags);
        if (realMask) {
            if (realMask.disabled)
                realFlags |= 2 /* LayerMaskFlags.LayerMaskDisabled */;
            if (realMask.positionRelativeToLayer)
                realFlags |= 1 /* LayerMaskFlags.PositionRelativeToLayer */;
            if (realMask.fromVectorData)
                realFlags |= 8 /* LayerMaskFlags.LayerMaskFromRenderingOtherData */;
            const r = layerData.realMask || {};
            writeUint8(writer, realFlags);
            writeUint8(writer, realMask.defaultColor || 0);
            writeInt32(writer, r.top || 0);
            writeInt32(writer, r.left || 0);
            writeInt32(writer, r.bottom || 0);
            writeInt32(writer, r.right || 0);
        }
        if (params && mask) {
            writeUint8(writer, params);
            if (mask.userMaskDensity !== undefined)
                writeUint8(writer, Math.round(mask.userMaskDensity * 0xff));
            if (mask.userMaskFeather !== undefined)
                writeFloat64(writer, mask.userMaskFeather);
            if (mask.vectorMaskDensity !== undefined)
                writeUint8(writer, Math.round(mask.vectorMaskDensity * 0xff));
            if (mask.vectorMaskFeather !== undefined)
                writeFloat64(writer, mask.vectorMaskFeather);
        }
        writeZeros(writer, 2);
    });
}
function writerBlendingRange(writer, range) {
    writeUint8(writer, range[0]);
    writeUint8(writer, range[1]);
    writeUint8(writer, range[2]);
    writeUint8(writer, range[3]);
}
function writeLayerBlendingRanges(writer, layer) {
    writeSection(writer, 1, () => {
        const ranges = layer.blendingRanges;
        if (ranges) {
            writerBlendingRange(writer, ranges.compositeGrayBlendSource);
            writerBlendingRange(writer, ranges.compositeGraphBlendDestinationRange);
            for (const r of ranges.ranges) {
                writerBlendingRange(writer, r.sourceRange);
                writerBlendingRange(writer, r.destRange);
            }
        }
    });
}
function writeGlobalLayerMaskInfo(writer, info) {
    writeSection(writer, 1, () => {
        if (info) {
            writeUint16(writer, info.overlayColorSpace);
            writeUint16(writer, info.colorSpace1);
            writeUint16(writer, info.colorSpace2);
            writeUint16(writer, info.colorSpace3);
            writeUint16(writer, info.colorSpace4);
            writeUint16(writer, Math.round(info.opacity * 0xff));
            writeUint8(writer, info.kind);
            writeZeros(writer, 3);
        }
    });
}
function writeAdditionalLayerInfo(writer, target, psd, options) {
    const failedKeys = target.failedAdditionalInfoKeys || [];
    for (const handler of additionalInfo_1.infoHandlers) {
        let key = handler.key;
        if (key === 'Txt2' && options.invalidateTextLayers)
            continue;
        // [arozos patch] a block that failed to parse is written back raw below
        if (failedKeys.indexOf(key) !== -1)
            continue;
        if (key === 'vmsk' && options.psb)
            key = 'vsms';
        if (handler.has(target)) {
            const large = options.psb && helpers_1.largeAdditionalInfoKeys.indexOf(key) !== -1;
            const writeTotalLength = key !== 'Txt2' && key !== 'cinf' && key !== 'extn' && key !== 'CAI ' && key !== 'OCIO';
            const fourBytes = key === 'Txt2' || key === 'luni' || key === 'vmsk' || key === 'artb' || key === 'artd' ||
                key === 'vogk' || key === 'SoLd' || key === 'lnk2' || key === 'vscg' || key === 'vsms' || key === 'GdFl' ||
                key === 'lmfx' || key === 'lrFX' || key === 'cinf' || key === 'PlLd' || key === 'Anno' || key === 'CAI ' || key === 'OCIO' || key === 'GenI' || key === 'FEid' || key === 'curv' || key === 'CgEd' || key === 'vibA' || key === 'blwh' || key === 'grdm';
            writeSignature(writer, large ? '8B64' : '8BIM');
            writeSignature(writer, key);
            writeSection(writer, fourBytes ? 4 : 2, () => {
                handler.write(writer, target, psd, options);
            }, writeTotalLength, large);
        }
    }
    // [arozos patch] preserved unknown blocks, written back byte for byte
    for (const raw of (target.unknownAdditionalInfo || [])) {
        if (!raw || !raw.key || !raw.data)
            continue;
        writeSignature(writer, raw.sig === '8B64' && options.psb ? '8B64' : '8BIM');
        writeSignature(writer, raw.key);
        writeSection(writer, 2, () => {
            writeBytes(writer, raw.data);
        }, false, raw.sig === '8B64' && !!options.psb);
    }
}
function addChildren(layers, children) {
    if (!children)
        return;
    // const layerIds: number[] = [2];
    // const timestamps: number[] = [1740120767.0230637];
    for (const c of children) {
        if (c.children && c.canvas)
            throw new Error(`Invalid layer, cannot have both 'canvas' and 'children' properties`);
        if (c.children && c.imageData)
            throw new Error(`Invalid layer, cannot have both 'imageData' and 'children' properties`);
        if (c.children) {
            layers.push({
                name: '</Layer group>',
                sectionDivider: {
                    type: 3 /* SectionDividerType.BoundingSectionDivider */,
                },
                // blendingRanges: children[0].blendingRanges,
                // nameSource: 'lset',
                // id: layerIds.shift(),
                // protected: {
                // 	transparency: false,
                // 	composite: false,
                // 	position: false,
                // },
                // layerColor: 'red',
                // timestamp: timestamps.shift(),
                // referencePoint: { x: 0, y: 0 },
            });
            addChildren(layers, c.children);
            layers.push(Object.assign(Object.assign({}, c), { blendMode: c.blendMode === 'pass through' ? 'normal' : c.blendMode, sectionDivider: {
                    type: c.opened === false ? 2 /* SectionDividerType.ClosedFolder */ : 1 /* SectionDividerType.OpenFolder */,
                    key: helpers_1.fromBlendMode[c.blendMode] || 'pass',
                    subType: 0,
                } }));
        }
        else {
            layers.push(Object.assign({}, c));
        }
    }
}
function resizeBuffer(writer, size) {
    let newLength = writer.buffer.byteLength;
    do {
        newLength *= 2;
    } while (size > newLength);
    const newBuffer = new ArrayBuffer(newLength);
    const newBytes = new Uint8Array(newBuffer);
    const oldBytes = new Uint8Array(writer.buffer);
    newBytes.set(oldBytes);
    writer.buffer = newBuffer;
    writer.view = new DataView(writer.buffer);
}
function ensureSize(writer, size) {
    if (size > writer.buffer.byteLength) {
        resizeBuffer(writer, size);
    }
}
function addSize(writer, size) {
    const offset = writer.offset;
    ensureSize(writer, writer.offset += size);
    return offset;
}
function createThumbnail(psd) {
    const canvas = (0, helpers_1.createCanvas)(10, 10);
    let scale = 1;
    if (psd.width > psd.height) {
        canvas.width = 160;
        canvas.height = Math.floor(psd.height * (canvas.width / psd.width));
        scale = canvas.width / psd.width;
    }
    else {
        canvas.height = 160;
        canvas.width = Math.floor(psd.width * (canvas.height / psd.height));
        scale = canvas.height / psd.height;
    }
    const context = canvas.getContext('2d');
    context.scale(scale, scale);
    if (psd.imageData) {
        context.drawImage((0, helpers_1.imageDataToCanvas)(psd.imageData), 0, 0);
    }
    else if (psd.canvas) {
        context.drawImage(psd.canvas, 0, 0);
    }
    return canvas;
}
function getMaskChannels(tempBuffer, layerData, layer, mask, options, realMask) {
    let top = mask.top | 0;
    let left = mask.left | 0;
    let right = mask.right | 0;
    let bottom = mask.bottom | 0;
    let { width, height } = getLayerDimentions(mask);
    let imageData = mask.imageData;
    if (!imageData && mask.canvas && width && height) {
        imageData = mask.canvas.getContext('2d').getImageData(0, 0, width, height);
    }
    if (imageData && (imageData.width !== width || imageData.height !== height)) {
        throw new Error('Invalid imageData dimentions');
    }
    right = left + width;
    bottom = top + height;
    let buffer;
    let compression;
    if (helpers_1.RAW_IMAGE_DATA && layer[realMask ? 'realMaskDataRaw' : 'maskDataRaw']) {
        buffer = layer[realMask ? 'realMaskDataRaw' : 'maskDataRaw'];
        compression = layer[realMask ? 'realMaskDataRawCompression' : 'maskDataRawCompression'];
    }
    else if (!imageData) {
        buffer = new Uint8Array(0);
        compression = 1 /* Compression.RleCompressed */;
    }
    else if (options.compress) {
        buffer = (0, helpers_1.writeDataZipWithoutPrediction)(imageData, [0]);
        compression = 2 /* Compression.ZipWithoutPrediction */;
    }
    else {
        buffer = (0, helpers_1.writeDataRLE)(tempBuffer, imageData, [0], !!options.psb);
        compression = 1 /* Compression.RleCompressed */;
    }
    layerData.channels.push({ id: realMask ? -3 /* ChannelID.RealUserMask */ : -2 /* ChannelID.UserMask */, compression, data: buffer, length: 2 + buffer.length });
    layerData[realMask ? 'realMask' : 'mask'] = { top, left, right, bottom };
}
function bounds(obj) {
    return obj ? {
        top: obj.top || 0,
        left: obj.left || 0,
        right: obj.right || 0,
        bottom: obj.bottom || 0,
    } : undefined;
}
function getChannels(tempBuffer, layer, background, options) {
    if (layer.rawData) {
        return Object.assign(Object.assign({ layer, channels: layer.rawData.channels.map(c => { var _a, _b; return (Object.assign(Object.assign({}, c), { length: 2 + ((_b = (_a = c.data) === null || _a === void 0 ? void 0 : _a.byteLength) !== null && _b !== void 0 ? _b : 0) })); }) }, bounds(layer)), { mask: bounds(layer.mask), realMask: bounds(layer.realMask) });
    }
    const layerData = getLayerChannels(tempBuffer, layer, background, options);
    if (layer.mask)
        getMaskChannels(tempBuffer, layerData, layer, layer.mask, options, false);
    if (layer.realMask)
        getMaskChannels(tempBuffer, layerData, layer, layer.realMask, options, true);
    return layerData;
}
function getLayerDimentions({ canvas, imageData }) {
    var _a, _b, _c, _d;
    // this way in case canvas/imageData are incorrect objects without width/height properties
    const width = (_b = (_a = imageData === null || imageData === void 0 ? void 0 : imageData.width) !== null && _a !== void 0 ? _a : canvas === null || canvas === void 0 ? void 0 : canvas.width) !== null && _b !== void 0 ? _b : 0;
    const height = (_d = (_c = imageData === null || imageData === void 0 ? void 0 : imageData.height) !== null && _c !== void 0 ? _c : canvas === null || canvas === void 0 ? void 0 : canvas.height) !== null && _d !== void 0 ? _d : 0;
    return { width, height };
}
function cropImageData(data, left, top, width, height) {
    if (data.data instanceof Uint32Array || data.data instanceof Uint16Array) {
        throw new Error('imageData has incorrect bit depth');
    }
    const croppedData = (0, helpers_1.createImageData)(width, height);
    const srcData = data.data;
    const dstData = croppedData.data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let src = ((x + left) + (y + top) * data.width) * 4;
            let dst = (x + y * width) * 4;
            dstData[dst] = srcData[src];
            dstData[dst + 1] = srcData[src + 1];
            dstData[dst + 2] = srcData[src + 2];
            dstData[dst + 3] = srcData[src + 3];
        }
    }
    return croppedData;
}
function getLayerChannels(tempBuffer, layer, background, options) {
    var _a;
    let top = layer.top | 0;
    let left = layer.left | 0;
    let right = layer.right | 0;
    let bottom = layer.bottom | 0;
    let channels = [
        { id: -1 /* ChannelID.Transparency */, compression: 0 /* Compression.RawData */, data: undefined, length: 2 },
        { id: 0 /* ChannelID.Color0 */, compression: 0 /* Compression.RawData */, data: undefined, length: 2 },
        { id: 1 /* ChannelID.Color1 */, compression: 0 /* Compression.RawData */, data: undefined, length: 2 },
        { id: 2 /* ChannelID.Color2 */, compression: 0 /* Compression.RawData */, data: undefined, length: 2 },
    ];
    let { width, height } = getLayerDimentions(layer);
    if (!(layer.canvas || layer.imageData) || !width || !height) {
        right = left;
        bottom = top;
        return { layer, top, left, right, bottom, channels };
    }
    right = left + width;
    bottom = top + height;
    let imageData = layer.imageData || layer.canvas.getContext('2d').getImageData(0, 0, width, height);
    if (options.trimImageData) {
        const trimmed = trimData(imageData);
        if (trimmed.left !== 0 || trimmed.top !== 0 || trimmed.right !== imageData.width || trimmed.bottom !== imageData.height) {
            left += trimmed.left;
            top += trimmed.top;
            right -= (imageData.width - trimmed.right);
            bottom -= (imageData.height - trimmed.bottom);
            width = right - left;
            height = bottom - top;
            if (!width || !height)
                return { layer, top, left, right, bottom, channels };
            imageData = cropImageData(imageData, trimmed.left, trimmed.top, width, height);
        }
    }
    const channelIds = [
        0 /* ChannelID.Color0 */,
        1 /* ChannelID.Color1 */,
        2 /* ChannelID.Color2 */,
    ];
    if (!background || options.noBackground || layer.mask || (0, helpers_1.hasAlpha)(imageData) || (helpers_1.RAW_IMAGE_DATA && ((_a = layer.imageDataRaw) === null || _a === void 0 ? void 0 : _a['-1']))) {
        channelIds.unshift(-1 /* ChannelID.Transparency */);
    }
    channels = channelIds.map(id => {
        const offset = (0, helpers_1.offsetForChannel)(id, false); // TODO: psd.colorMode === ColorMode.CMYK);
        let data;
        let compression;
        if (helpers_1.RAW_IMAGE_DATA && layer.imageDataRaw) {
            // console.log('written raw layer image data');
            data = layer.imageDataRaw[id];
            compression = layer.imageDataRawCompression[id];
        }
        else if (options.compress) {
            data = (0, helpers_1.writeDataZipWithoutPrediction)(imageData, [offset]);
            compression = 2 /* Compression.ZipWithoutPrediction */;
        }
        else {
            data = (0, helpers_1.writeDataRLE)(tempBuffer, imageData, [offset], !!options.psb);
            compression = 1 /* Compression.RleCompressed */;
        }
        return { id, compression, data, length: 2 + data.length };
    });
    return { layer, top, left, right, bottom, channels };
}
function isRowEmpty({ data, width }, y, left, right) {
    const start = ((y * width + left) * 4 + 3) | 0;
    const end = (start + (right - left) * 4) | 0;
    for (let i = start; i < end; i = (i + 4) | 0) {
        if (data[i] !== 0) {
            return false;
        }
    }
    return true;
}
function isColEmpty({ data, width }, x, top, bottom) {
    const stride = (width * 4) | 0;
    const start = (top * stride + x * 4 + 3) | 0;
    for (let y = top, i = start; y < bottom; y++, i = (i + stride) | 0) {
        if (data[i] !== 0) {
            return false;
        }
    }
    return true;
}
function trimData(data) {
    let top = 0;
    let left = 0;
    let right = data.width;
    let bottom = data.height;
    while (top < bottom && isRowEmpty(data, top, left, right))
        top++;
    while (bottom > top && isRowEmpty(data, bottom - 1, left, right))
        bottom--;
    while (left < right && isColEmpty(data, left, top, bottom))
        left++;
    while (right > left && isColEmpty(data, right - 1, top, bottom))
        right--;
    return { top, left, right, bottom };
}
function writeColor(writer, color) {
    if (!color) {
        writeUint16(writer, 0 /* ColorSpace.RGB */);
        writeZeros(writer, 8);
    }
    else if ('r' in color) {
        writeUint16(writer, 0 /* ColorSpace.RGB */);
        writeUint16(writer, Math.round(color.r * 257));
        writeUint16(writer, Math.round(color.g * 257));
        writeUint16(writer, Math.round(color.b * 257));
        writeUint16(writer, 0);
    }
    else if ('fr' in color) {
        writeUint16(writer, 0 /* ColorSpace.RGB */);
        writeUint16(writer, Math.round(color.fr * 255 * 257));
        writeUint16(writer, Math.round(color.fg * 255 * 257));
        writeUint16(writer, Math.round(color.fb * 255 * 257));
        writeUint16(writer, 0);
    }
    else if ('l' in color) {
        writeUint16(writer, 7 /* ColorSpace.Lab */);
        writeInt16(writer, Math.round(color.l * 10000));
        writeInt16(writer, Math.round(color.a < 0 ? (color.a * 12800) : (color.a * 12700)));
        writeInt16(writer, Math.round(color.b < 0 ? (color.b * 12800) : (color.b * 12700)));
        writeUint16(writer, 0);
    }
    else if ('h' in color) {
        writeUint16(writer, 1 /* ColorSpace.HSB */);
        writeUint16(writer, Math.round(color.h * 0xffff));
        writeUint16(writer, Math.round(color.s * 0xffff));
        writeUint16(writer, Math.round(color.b * 0xffff));
        writeUint16(writer, 0);
    }
    else if ('c' in color) {
        writeUint16(writer, 2 /* ColorSpace.CMYK */);
        writeUint16(writer, Math.round(color.c * 257));
        writeUint16(writer, Math.round(color.m * 257));
        writeUint16(writer, Math.round(color.y * 257));
        writeUint16(writer, Math.round(color.k * 257));
    }
    else {
        writeUint16(writer, 8 /* ColorSpace.Grayscale */);
        writeUint16(writer, Math.round(color.k * 10000 / 255));
        writeZeros(writer, 6);
    }
}
// ponytail: only round-trips RGB 8-bit patterns; source colorMode (16-bit/Indexed) is not preserved,
// since readPattern already converted everything to RGBA. Upgrade if pattern colorMode must survive write.
function writePattern(writer, pattern) {
    const width = pattern.bounds.w;
    const height = pattern.bounds.h;
    const pixelData = { width, height, data: pattern.data };
    writeUint32(writer, 0); // length, fixed up below
    const pattsOffset = writer.offset;
    writeUint32(writer, 1); // version
    writeUint32(writer, 3 /* ColorMode.RGB */); // color mode - rgb only
    writeInt16(writer, pattern.x);
    writeInt16(writer, pattern.y);
    writeUnicodeString(writer, pattern.name + '\0'); // name
    writePascalString(writer, pattern.id, 1); // id
    // virtual memory array list
    writeUint32(writer, 3); // version
    writeUint32(writer, 0); // length, fixed up below
    const vlOffset = writer.offset;
    const top = pattern.bounds.y;
    const left = pattern.bounds.x;
    const bottom = top + height;
    const right = left + width;
    writeUint32(writer, top);
    writeUint32(writer, left);
    writeUint32(writer, bottom);
    writeUint32(writer, right);
    writeUint32(writer, 24); // channels count
    // channels: RGB at indices 0,1,2 and alpha at index 25
    for (let i = 0; i < 24 + 2; i++) {
        const offset = i < 3 ? i : (i === 25 ? 3 : -1);
        if (offset < 0) {
            writeUint32(writer, 0); // has
            continue;
        }
        // worst-case RLE size for a single channel: width + 1 per scanline, plus scanline length headers
        const buffer = new Uint8Array(width * height + 2 * height + 2 * width + 16);
        // ponytail: pattern channels always use small (2-byte) RLE scanline headers, matching
        // readPattern which reads them as non-large; `large` here only affects the header width.
        const data = (0, helpers_1.writeDataRLE)(buffer, pixelData, [offset], false);
        writeUint32(writer, 1); // has
        writeUint32(writer, data.length + 4 + 16 + 2 + 1); // length
        writeUint32(writer, 8); // pixelDepth
        writeUint32(writer, top);
        writeUint32(writer, left);
        writeUint32(writer, bottom);
        writeUint32(writer, right);
        writeUint16(writer, 8); // pixelDepth2
        writeUint8(writer, 1); // compressionMode - rle
        writeBytes(writer, data);
    }
    const vlLength = writer.offset - vlOffset;
    let pattsLength = writer.offset - pattsOffset;
    while (pattsLength % 4) {
        writeZeros(writer, 1);
        pattsLength++;
    }
    writer.view.setUint32(vlOffset - 4, vlLength, false);
    writer.view.setUint32(pattsOffset - 4, pattsLength, false);
}

},{"./additionalInfo":2,"./helpers":8,"./imageResources":9}],15:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEngineData = decodeEngineData;
exports.encodeEngineData = encodeEngineData;
const defaultFont = {
    name: 'MyriadPro-Regular',
    script: 0,
    type: 0,
    synthetic: 0,
};
const defaultParagraphStyle = {
    justification: 'left',
    firstLineIndent: 0,
    startIndent: 0,
    endIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    autoHyphenate: true,
    hyphenatedWordSize: 6,
    preHyphen: 2,
    postHyphen: 2,
    consecutiveHyphens: 8,
    zone: 36,
    wordSpacing: [0.8, 1, 1.33],
    letterSpacing: [0, 0, 0],
    glyphSpacing: [1, 1, 1],
    autoLeading: 1.2,
    leadingType: 0,
    hanging: false,
    burasagari: false,
    kinsokuOrder: 0,
    everyLineComposer: false,
};
const defaultStyle = {
    font: defaultFont,
    fontSize: 12,
    fauxBold: false,
    fauxItalic: false,
    autoLeading: true,
    leading: 0,
    horizontalScale: 1,
    verticalScale: 1,
    tracking: 0,
    autoKerning: true,
    kerning: 0,
    baselineShift: 0,
    fontCaps: 0,
    fontBaseline: 0,
    underline: false,
    strikethrough: false,
    ligatures: true,
    dLigatures: false,
    baselineDirection: 2,
    tsume: 0,
    styleRunAlignment: 2,
    language: 0,
    noBreak: false,
    fillColor: { r: 0, g: 0, b: 0 },
    strokeColor: { r: 0, g: 0, b: 0 },
    fillFlag: true,
    strokeFlag: false,
    fillFirst: true,
    yUnderline: 1,
    outlineWidth: 1,
    characterDirection: 0,
    hindiNumbers: false,
    kashida: 1,
    diacriticPos: 2,
};
const defaultGridInfo = {
    isOn: false,
    show: false,
    size: 18,
    leading: 22,
    color: { r: 0, g: 0, b: 255 },
    leadingFillColor: { r: 0, g: 0, b: 255 },
    alignLineHeightToGridFlags: false,
};
const paragraphStyleKeys = [
    'justification', 'firstLineIndent', 'startIndent', 'endIndent', 'spaceBefore', 'spaceAfter',
    'autoHyphenate', 'hyphenatedWordSize', 'preHyphen', 'postHyphen', 'consecutiveHyphens',
    'zone', 'wordSpacing', 'letterSpacing', 'glyphSpacing', 'autoLeading', 'leadingType',
    'hanging', 'burasagari', 'kinsokuOrder', 'everyLineComposer',
];
const styleKeys = [
    'font', 'fontSize', 'fauxBold', 'fauxItalic', 'autoLeading', 'leading', 'horizontalScale',
    'verticalScale', 'tracking', 'autoKerning', 'kerning', 'baselineShift', 'fontCaps', 'fontBaseline',
    'underline', 'strikethrough', 'ligatures', 'dLigatures', 'baselineDirection', 'tsume',
    'styleRunAlignment', 'language', 'noBreak', 'fillColor', 'strokeColor', 'fillFlag',
    'strokeFlag', 'fillFirst', 'yUnderline', 'outlineWidth', 'characterDirection', 'hindiNumbers',
    'kashida', 'diacriticPos',
];
const antialias = ['none', 'crisp', 'strong', 'smooth', 'sharp'];
const justification = [
    'left', // 0
    'right', // 1
    'center', // 2
    'justify-left', // 3
    'justify-right', // 4
    'justify-center', // 5
    'justify-all', // 6
];
function upperFirst(value) {
    return value.substring(0, 1).toUpperCase() + value.substring(1);
}
function decodeColor(color) {
    const c = color.Values;
    switch (color.Type) {
        case 0: return { k: c[1] * 255 }; // grayscale (alpha?)
        case 1: return c[0] === 1 ?
            { r: c[1] * 255, g: c[2] * 255, b: c[3] * 255 } : // rgb
            { r: c[1] * 255, g: c[2] * 255, b: c[3] * 255, a: c[0] * 255 }; // rgba
        case 2: return { c: c[1] * 255, m: c[2] * 255, y: c[3] * 255, k: c[4] * 255 }; // cmyk (alpha?)
        default: throw new Error('Unknown color type in text layer');
    }
}
function encodeColor(color) {
    if (!color) {
        return { Type: 1, Values: [0, 0, 0, 0] };
    }
    else if ('r' in color) {
        return { Type: 1, Values: ['a' in color ? color.a / 255 : 1, color.r / 255, color.g / 255, color.b / 255] };
    }
    else if ('c' in color) {
        return { Type: 2, Values: [1, color.c / 255, color.m / 255, color.y / 255, color.k / 255] };
    }
    else if ('k' in color) {
        return { Type: 0, Values: [1, color.k / 255] };
    }
    else {
        throw new Error('Invalid color type in text layer');
    }
}
function arraysEqual(a, b) {
    if (!a || !b)
        return false;
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}
function objectsEqual(a, b) {
    if (!a || !b)
        return false;
    for (const key of Object.keys(a))
        if (a[key] !== b[key])
            return false;
    for (const key of Object.keys(b))
        if (a[key] !== b[key])
            return false;
    return true;
}
function findOrAddFont(fonts, font) {
    for (let i = 0; i < fonts.length; i++) {
        if (fonts[i].name === font.name)
            return i;
    }
    fonts.push(font);
    return fonts.length - 1;
}
function decodeObject(obj, keys, fonts) {
    const result = {};
    for (const key of keys) {
        const Key = upperFirst(key);
        if (obj[Key] === undefined)
            continue;
        if (key === 'justification') {
            result[key] = justification[obj[Key]];
        }
        else if (key === 'font') {
            result[key] = fonts[obj[Key]];
        }
        else if (key === 'fillColor' || key === 'strokeColor') {
            result[key] = decodeColor(obj[Key]);
        }
        else {
            result[key] = obj[Key];
        }
    }
    return result;
}
function encodeObject(obj, keys, fonts) {
    var _a;
    const result = {};
    for (const key of keys) {
        const Key = upperFirst(key);
        if (obj[key] === undefined)
            continue;
        if (key === 'justification') {
            result[Key] = justification.indexOf((_a = obj[key]) !== null && _a !== void 0 ? _a : 'left');
        }
        else if (key === 'font') {
            result[Key] = findOrAddFont(fonts, obj[key]);
        }
        else if (key === 'fillColor' || key === 'strokeColor') {
            result[Key] = encodeColor(obj[key]);
        }
        else {
            result[Key] = obj[key];
        }
    }
    return result;
}
function decodeParagraphStyle(obj, fonts) {
    return decodeObject(obj, paragraphStyleKeys, fonts);
}
function decodeStyle(obj, fonts) {
    return decodeObject(obj, styleKeys, fonts);
}
function encodeParagraphStyle(obj, fonts) {
    return encodeObject(obj, paragraphStyleKeys, fonts);
}
function encodeStyle(obj, fonts) {
    return encodeObject(obj, styleKeys, fonts);
}
function deduplicateValues(base, runs, keys) {
    if (!runs.length)
        return;
    for (const key of keys) {
        const value = runs[0].style[key];
        if (value !== undefined) {
            let identical = false;
            if (Array.isArray(value)) {
                identical = runs.every(r => arraysEqual(r.style[key], value));
            }
            else if (typeof value === 'object') {
                identical = runs.every(r => objectsEqual(r.style[key], value));
            }
            else {
                identical = runs.every(r => r.style[key] === value);
            }
            if (identical) {
                base[key] = value;
            }
        }
        const styleValue = base[key];
        if (styleValue !== undefined) {
            for (const r of runs) {
                let same = false;
                if (Array.isArray(value)) {
                    same = arraysEqual(r.style[key], value);
                }
                else if (typeof value === 'object') {
                    same = objectsEqual(r.style[key], value);
                }
                else {
                    same = r.style[key] === value;
                }
                if (same)
                    delete r.style[key];
            }
        }
    }
    if (runs.every(x => Object.keys(x.style).length === 0)) {
        runs.length = 0;
    }
}
function decodeEngineData(engineData) {
    var _a, _b, _c, _d, _e, _f;
    // console.log('engineData', require('util').inspect(engineData, false, 99, true));
    const engineDict = engineData.EngineDict;
    const resourceDict = engineData.ResourceDict;
    const fonts = resourceDict.FontSet.map(f => ({
        name: f.Name,
        script: f.Script,
        type: f.FontType,
        synthetic: f.Synthetic,
    }));
    let text = engineDict.Editor.Text.replace(/\r/g, '\n');
    let removedCharacters = 0;
    while (/\n$/.test(text)) {
        text = text.substring(0, text.length - 1);
        removedCharacters++;
    }
    const result = {
        text,
        antiAlias: (_a = antialias[engineDict.AntiAlias]) !== null && _a !== void 0 ? _a : 'smooth',
        useFractionalGlyphWidths: !!engineDict.UseFractionalGlyphWidths,
        superscriptSize: resourceDict.SuperscriptSize,
        superscriptPosition: resourceDict.SuperscriptPosition,
        subscriptSize: resourceDict.SubscriptSize,
        subscriptPosition: resourceDict.SubscriptPosition,
        smallCapSize: resourceDict.SmallCapSize,
    };
    // shape
    const photoshop = (_f = (_e = (_d = (_c = (_b = engineDict.Rendered) === null || _b === void 0 ? void 0 : _b.Shapes) === null || _c === void 0 ? void 0 : _c.Children) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.Cookie) === null || _f === void 0 ? void 0 : _f.Photoshop;
    if (photoshop) {
        result.shapeType = photoshop.ShapeType === 1 ? 'box' : 'point';
        if (photoshop.PointBase)
            result.pointBase = photoshop.PointBase;
        if (photoshop.BoxBounds)
            result.boxBounds = photoshop.BoxBounds;
    }
    // paragraph style
    // const theNormalParagraphSheet = resourceDict.TheNormalParagraphSheet;
    // const paragraphSheetSet = resourceDict.ParagraphSheetSet;
    // const paragraphProperties = paragraphSheetSet[theNormalParagraphSheet].Properties;
    const paragraphRun = engineDict.ParagraphRun;
    result.paragraphStyle = {}; // decodeParagraphStyle(paragraphProperties, fonts);
    result.paragraphStyleRuns = [];
    for (let i = 0; i < paragraphRun.RunArray.length; i++) {
        const run = paragraphRun.RunArray[i];
        const length = paragraphRun.RunLengthArray[i];
        const style = decodeParagraphStyle(run.ParagraphSheet.Properties, fonts);
        // const adjustments = {
        //   axis: run.Adjustments.Axis,
        //   xy: run.Adjustments.XY,
        // };
        result.paragraphStyleRuns.push({ length, style /*, adjustments*/ });
    }
    for (let counter = removedCharacters; result.paragraphStyleRuns.length && counter > 0; counter--) {
        if (--result.paragraphStyleRuns[result.paragraphStyleRuns.length - 1].length === 0) {
            result.paragraphStyleRuns.pop();
        }
    }
    deduplicateValues(result.paragraphStyle, result.paragraphStyleRuns, paragraphStyleKeys);
    if (!result.paragraphStyleRuns.length)
        delete result.paragraphStyleRuns;
    // style
    // const theNormalStyleSheet = resourceDict.TheNormalStyleSheet;
    // const styleSheetSet = resourceDict.StyleSheetSet;
    // const styleSheetData = styleSheetSet[theNormalStyleSheet].StyleSheetData;
    const styleRun = engineDict.StyleRun;
    result.style = {}; // decodeStyle(styleSheetData, fonts);
    result.styleRuns = [];
    for (let i = 0; i < styleRun.RunArray.length; i++) {
        const length = styleRun.RunLengthArray[i];
        const style = decodeStyle(styleRun.RunArray[i].StyleSheet.StyleSheetData, fonts);
        if (!style.font)
            style.font = fonts[0];
        result.styleRuns.push({ length, style });
    }
    for (let counter = removedCharacters; result.styleRuns.length && counter > 0; counter--) {
        if (--result.styleRuns[result.styleRuns.length - 1].length === 0) {
            result.styleRuns.pop();
        }
    }
    deduplicateValues(result.style, result.styleRuns, styleKeys);
    if (!result.styleRuns.length)
        delete result.styleRuns;
    return result;
}
function encodeEngineData(data) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const text = `${(data.text || '').replace(/\r?\n/g, '\r')}\r`;
    const fonts = [
        { name: 'AdobeInvisFont', script: 0, type: 0, synthetic: 0 },
    ];
    const defFont = ((_a = data.style) === null || _a === void 0 ? void 0 : _a.font) || ((_c = (_b = data.styleRuns) === null || _b === void 0 ? void 0 : _b.find(s => s.style.font)) === null || _c === void 0 ? void 0 : _c.style.font) || defaultFont;
    const paragraphRunArray = [];
    const paragraphRunLengthArray = [];
    const paragraphRuns = data.paragraphStyleRuns;
    if (paragraphRuns && paragraphRuns.length) {
        let leftLength = text.length;
        for (const run of paragraphRuns) {
            let runLength = Math.min(run.length, leftLength);
            leftLength -= runLength;
            if (!runLength)
                continue; // ignore 0 size runs
            // extend last run if it's only for trailing \r
            if (leftLength === 1 && run === paragraphRuns[paragraphRuns.length - 1]) {
                runLength++;
                leftLength--;
            }
            paragraphRunLengthArray.push(runLength);
            paragraphRunArray.push({
                ParagraphSheet: {
                    DefaultStyleSheet: 0,
                    Properties: encodeParagraphStyle(Object.assign(Object.assign(Object.assign({}, defaultParagraphStyle), data.paragraphStyle), run.style), fonts),
                },
                Adjustments: { Axis: [1, 0, 1], XY: [0, 0] },
            });
        }
        if (leftLength) {
            paragraphRunLengthArray.push(leftLength);
            paragraphRunArray.push({
                ParagraphSheet: {
                    DefaultStyleSheet: 0,
                    Properties: encodeParagraphStyle(Object.assign(Object.assign({}, defaultParagraphStyle), data.paragraphStyle), fonts),
                },
                Adjustments: { Axis: [1, 0, 1], XY: [0, 0] },
            });
        }
    }
    else {
        for (let i = 0, last = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 13) { // \r
                paragraphRunLengthArray.push(i - last + 1);
                paragraphRunArray.push({
                    ParagraphSheet: {
                        DefaultStyleSheet: 0,
                        Properties: encodeParagraphStyle(Object.assign(Object.assign({}, defaultParagraphStyle), data.paragraphStyle), fonts),
                    },
                    Adjustments: { Axis: [1, 0, 1], XY: [0, 0] },
                });
                last = i + 1;
            }
        }
    }
    const styleSheetData = encodeStyle(Object.assign(Object.assign({}, defaultStyle), { font: defFont }), fonts);
    const styleRuns = data.styleRuns || [{ length: text.length, style: data.style || {} }];
    const styleRunArray = [];
    const styleRunLengthArray = [];
    let leftLength = text.length;
    for (const run of styleRuns) {
        let runLength = Math.min(run.length, leftLength);
        leftLength -= runLength;
        if (!runLength)
            continue; // ignore 0 size runs
        // extend last run if it's only for trailing \r
        if (leftLength === 1 && run === styleRuns[styleRuns.length - 1]) {
            runLength++;
            leftLength--;
        }
        styleRunLengthArray.push(runLength);
        styleRunArray.push({
            StyleSheet: {
                StyleSheetData: encodeStyle(Object.assign(Object.assign({ kerning: 0, autoKerning: true, fillColor: { r: 0, g: 0, b: 0 } }, data.style), run.style), fonts),
            },
        });
    }
    // add extra run to the end if existing ones didn't fill it up
    if (leftLength && styleRuns.length) {
        styleRunLengthArray.push(leftLength);
        styleRunArray.push({
            StyleSheet: {
                StyleSheetData: encodeStyle(Object.assign({ kerning: 0, autoKerning: true, fillColor: { r: 0, g: 0, b: 0 } }, data.style), fonts),
            },
        });
    }
    const gridInfo = Object.assign(Object.assign({}, defaultGridInfo), data.gridInfo);
    const WritingDirection = data.orientation === 'vertical' ? 2 : 0;
    const Procession = data.orientation === 'vertical' ? 1 : 0;
    const ShapeType = data.shapeType === 'box' ? 1 : 0;
    const Photoshop = {
        ShapeType,
    };
    if (ShapeType === 0) {
        Photoshop.PointBase = data.pointBase || [0, 0];
    }
    else {
        Photoshop.BoxBounds = data.boxBounds || [0, 0, 0, 0];
    }
    // needed for correct order of properties
    Photoshop.Base = {
        ShapeType,
        TransformPoint0: [1, 0],
        TransformPoint1: [0, 1],
        TransformPoint2: [0, 0],
    };
    const defaultResources = {
        KinsokuSet: [
            {
                Name: 'PhotoshopKinsokuHard',
                NoStart: '、。，．・：；？！ー―’”）〕］｝〉》」』】ヽヾゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ゛゜?!)]},.:;℃℉¢％‰',
                NoEnd: '‘“（〔［｛〈《「『【([{￥＄£＠§〒＃',
                Keep: '―‥',
                Hanging: '、。.,',
            },
            {
                Name: 'PhotoshopKinsokuSoft',
                NoStart: '、。，．・：；？！’”）〕］｝〉》」』】ヽヾゝゞ々',
                NoEnd: '‘“（〔［｛〈《「『【',
                Keep: '―‥',
                Hanging: '、。.,',
            },
        ],
        MojiKumiSet: [
            { InternalName: 'Photoshop6MojiKumiSet1' },
            { InternalName: 'Photoshop6MojiKumiSet2' },
            { InternalName: 'Photoshop6MojiKumiSet3' },
            { InternalName: 'Photoshop6MojiKumiSet4' },
        ],
        TheNormalStyleSheet: 0,
        TheNormalParagraphSheet: 0,
        ParagraphSheetSet: [
            {
                Name: 'Normal RGB',
                DefaultStyleSheet: 0,
                Properties: encodeParagraphStyle(Object.assign(Object.assign({}, defaultParagraphStyle), data.paragraphStyle), fonts),
            },
        ],
        StyleSheetSet: [
            {
                Name: 'Normal RGB',
                StyleSheetData: styleSheetData,
            },
        ],
        FontSet: fonts.map(f => ({
            Name: f.name,
            Script: f.script || 0,
            FontType: f.type || 0,
            Synthetic: f.synthetic || 0,
        })),
        SuperscriptSize: (_d = data.superscriptSize) !== null && _d !== void 0 ? _d : 0.583,
        SuperscriptPosition: (_e = data.superscriptPosition) !== null && _e !== void 0 ? _e : 0.333,
        SubscriptSize: (_f = data.subscriptSize) !== null && _f !== void 0 ? _f : 0.583,
        SubscriptPosition: (_g = data.subscriptPosition) !== null && _g !== void 0 ? _g : 0.333,
        SmallCapSize: (_h = data.smallCapSize) !== null && _h !== void 0 ? _h : 0.7,
    };
    const engineData = {
        EngineDict: {
            Editor: { Text: text },
            ParagraphRun: {
                DefaultRunData: {
                    ParagraphSheet: { DefaultStyleSheet: 0, Properties: {} },
                    Adjustments: { Axis: [1, 0, 1], XY: [0, 0] },
                },
                RunArray: paragraphRunArray,
                RunLengthArray: paragraphRunLengthArray,
                IsJoinable: 1,
            },
            StyleRun: {
                DefaultRunData: { StyleSheet: { StyleSheetData: {} } },
                RunArray: styleRunArray,
                RunLengthArray: styleRunLengthArray,
                IsJoinable: 2,
            },
            GridInfo: {
                GridIsOn: !!gridInfo.isOn,
                ShowGrid: !!gridInfo.show,
                GridSize: (_j = gridInfo.size) !== null && _j !== void 0 ? _j : 18,
                GridLeading: (_k = gridInfo.leading) !== null && _k !== void 0 ? _k : 22,
                GridColor: encodeColor(gridInfo.color),
                GridLeadingFillColor: encodeColor(gridInfo.color),
                AlignLineHeightToGridFlags: !!gridInfo.alignLineHeightToGridFlags,
            },
            AntiAlias: antialias.indexOf((_l = data.antiAlias) !== null && _l !== void 0 ? _l : 'sharp'),
            UseFractionalGlyphWidths: (_m = data.useFractionalGlyphWidths) !== null && _m !== void 0 ? _m : true,
            Rendered: {
                Version: 1,
                Shapes: {
                    WritingDirection,
                    Children: [
                        {
                            ShapeType,
                            Procession,
                            Lines: { WritingDirection, Children: [] },
                            Cookie: { Photoshop },
                        },
                    ],
                },
            },
        },
        ResourceDict: Object.assign({}, defaultResources),
        DocumentResources: Object.assign({}, defaultResources),
    };
    // console.log('encodeEngineData', require('util').inspect(engineData, false, 99, true));
    return engineData;
}

},{}],16:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stringLengthInBytes = stringLengthInBytes;
exports.encodeStringTo = encodeStringTo;
exports.encodeString = encodeString;
exports.decodeString = decodeString;
function charLengthInBytes(code) {
    if ((code & 0xffffff80) === 0) {
        return 1;
    }
    else if ((code & 0xfffff800) === 0) {
        return 2;
    }
    else if ((code & 0xffff0000) === 0) {
        return 3;
    }
    else {
        return 4;
    }
}
// Reads a scalar value at index `i`, replacing unpaired surrogates with U+FFFD,
// matching how TextEncoder converts a string to a sequence of Unicode scalar values.
function codePointAt(value, i) {
    const code = value.charCodeAt(i);
    // high surrogate
    if (code >= 0xd800 && code <= 0xdbff && (i + 1) < value.length) {
        const extra = value.charCodeAt(i + 1);
        // low surrogate
        if (extra >= 0xdc00 && extra <= 0xdfff) {
            return { code: ((code & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000, size: 2 };
        }
    }
    // unpaired surrogate (lone high or lone low)
    if (code >= 0xd800 && code <= 0xdfff) {
        return { code: 0xfffd, size: 1 };
    }
    return { code, size: 1 };
}
function stringLengthInBytes(value) {
    let result = 0;
    for (let i = 0; i < value.length;) {
        const { code, size } = codePointAt(value, i);
        result += charLengthInBytes(code);
        i += size;
    }
    return result;
}
function writeCharacter(buffer, offset, code) {
    const length = charLengthInBytes(code);
    switch (length) {
        case 1:
            buffer[offset] = code;
            break;
        case 2:
            buffer[offset] = ((code >> 6) & 0x1f) | 0xc0;
            buffer[offset + 1] = (code & 0x3f) | 0x80;
            break;
        case 3:
            buffer[offset] = ((code >> 12) & 0x0f) | 0xe0;
            buffer[offset + 1] = ((code >> 6) & 0x3f) | 0x80;
            buffer[offset + 2] = (code & 0x3f) | 0x80;
            break;
        default:
            buffer[offset] = ((code >> 18) & 0x07) | 0xf0;
            buffer[offset + 1] = ((code >> 12) & 0x3f) | 0x80;
            buffer[offset + 2] = ((code >> 6) & 0x3f) | 0x80;
            buffer[offset + 3] = (code & 0x3f) | 0x80;
            break;
    }
    return length;
}
function encodeStringTo(buffer, offset, value) {
    for (let i = 0; i < value.length;) {
        const { code, size } = codePointAt(value, i);
        offset += writeCharacter(buffer, offset, code);
        i += size;
    }
    return offset;
}
function encodeString(value) {
    if (value.length > 1000 && typeof TextEncoder !== 'undefined') {
        return (new TextEncoder()).encode(value);
    }
    const buffer = new Uint8Array(stringLengthInBytes(value));
    encodeStringTo(buffer, 0, value);
    return buffer;
}
// UTF-8 decoder implementing the WHATWG Encoding Standard's non-fatal error handling,
// so malformed byte sequences are replaced with U+FFFD instead of throwing, matching TextDecoder.
function decodeString(value) {
    if (value.byteLength > 1000 && typeof TextDecoder !== 'undefined') {
        return (new TextDecoder()).decode(value);
    }
    const result = [];
    function pushCodePoint(code) {
        if (code > 0xffff) {
            code -= 0x10000;
            result.push(String.fromCharCode((code >>> 10 & 0x3ff) | 0xd800));
            code = 0xdc00 | (code & 0x3ff);
        }
        result.push(String.fromCharCode(code));
    }
    let codePoint = 0;
    let bytesSeen = 0;
    let bytesNeeded = 0;
    let lowerBoundary = 0x80;
    let upperBoundary = 0xbf;
    for (let i = 0; i < value.length; i++) {
        const byte = value[i];
        if (bytesNeeded === 0) {
            if (byte <= 0x7f) {
                pushCodePoint(byte);
            }
            else if (byte >= 0xc2 && byte <= 0xdf) {
                bytesNeeded = 1;
                codePoint = byte & 0x1f;
            }
            else if (byte >= 0xe0 && byte <= 0xef) {
                if (byte === 0xe0)
                    lowerBoundary = 0xa0;
                if (byte === 0xed)
                    upperBoundary = 0x9f;
                bytesNeeded = 2;
                codePoint = byte & 0x0f;
            }
            else if (byte >= 0xf0 && byte <= 0xf4) {
                if (byte === 0xf0)
                    lowerBoundary = 0x90;
                if (byte === 0xf4)
                    upperBoundary = 0x8f;
                bytesNeeded = 3;
                codePoint = byte & 0x07;
            }
            else {
                // invalid leading byte
                pushCodePoint(0xfffd);
            }
            continue;
        }
        if (byte < lowerBoundary || byte > upperBoundary) {
            // invalid continuation byte: emit replacement and reprocess this byte as a new sequence start
            codePoint = 0;
            bytesNeeded = 0;
            bytesSeen = 0;
            lowerBoundary = 0x80;
            upperBoundary = 0xbf;
            pushCodePoint(0xfffd);
            i--;
            continue;
        }
        lowerBoundary = 0x80;
        upperBoundary = 0xbf;
        codePoint = (codePoint << 6) | (byte & 0x3f);
        bytesSeen++;
        if (bytesSeen !== bytesNeeded)
            continue;
        pushCodePoint(codePoint);
        codePoint = 0;
        bytesNeeded = 0;
        bytesSeen = 0;
    }
    // truncated sequence at end of input
    if (bytesNeeded !== 0) {
        pushCodePoint(0xfffd);
    }
    return result.join('');
}

},{}],17:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}

},{}],18:[function(require,module,exports){
(function (Buffer){(function (){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = { __proto__: Uint8Array.prototype, foo: function () { return 42 } }
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

Object.defineProperty(Buffer.prototype, 'parent', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.buffer
  }
})

Object.defineProperty(Buffer.prototype, 'offset', {
  enumerable: true,
  get: function () {
    if (!Buffer.isBuffer(this)) return undefined
    return this.byteOffset
  }
})

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new TypeError(
        'The "string" argument must be of type string. Received type number'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species != null &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  if (ArrayBuffer.isView(value)) {
    return fromArrayLike(value)
  }

  if (value == null) {
    throw TypeError(
      'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
      'or Array-like Object. Received type ' + (typeof value)
    )
  }

  if (isInstance(value, ArrayBuffer) ||
      (value && isInstance(value.buffer, ArrayBuffer))) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'number') {
    throw new TypeError(
      'The "value" argument must not be of type number. Received type number'
    )
  }

  var valueOf = value.valueOf && value.valueOf()
  if (valueOf != null && valueOf !== value) {
    return Buffer.from(valueOf, encodingOrOffset, length)
  }

  var b = fromObject(value)
  if (b) return b

  if (typeof Symbol !== 'undefined' && Symbol.toPrimitive != null &&
      typeof value[Symbol.toPrimitive] === 'function') {
    return Buffer.from(
      value[Symbol.toPrimitive]('string'), encodingOrOffset, length
    )
  }

  throw new TypeError(
    'The first argument must be one of type string, Buffer, ArrayBuffer, Array, ' +
    'or Array-like Object. Received type ' + (typeof value)
  )
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('Unknown encoding: ' + encoding)
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('"offset" is outside of buffer bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('"length" is outside of buffer bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj.length !== undefined) {
    if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
      return createBuffer(0)
    }
    return fromArrayLike(obj)
  }

  if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return fromArrayLike(obj.data)
  }
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true &&
    b !== Buffer.prototype // so Buffer.isBuffer(Buffer.prototype) will be false
}

Buffer.compare = function compare (a, b) {
  if (isInstance(a, Uint8Array)) a = Buffer.from(a, a.offset, a.byteLength)
  if (isInstance(b, Uint8Array)) b = Buffer.from(b, b.offset, b.byteLength)
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError(
      'The "buf1", "buf2" arguments must be one of type Buffer or Uint8Array'
    )
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (isInstance(buf, Uint8Array)) {
      buf = Buffer.from(buf)
    }
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (ArrayBuffer.isView(string) || isInstance(string, ArrayBuffer)) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    throw new TypeError(
      'The "string" argument must be one of type string, Buffer, or ArrayBuffer. ' +
      'Received type ' + typeof string
    )
  }

  var len = string.length
  var mustMatch = (arguments.length > 2 && arguments[2] === true)
  if (!mustMatch && len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) {
          return mustMatch ? -1 : utf8ToBytes(string).length // assume utf8
        }
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.toLocaleString = Buffer.prototype.toString

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  str = this.toString('hex', 0, max).replace(/(.{2})/g, '$1 ').trim()
  if (this.length > max) str += ' ... '
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (isInstance(target, Uint8Array)) {
    target = Buffer.from(target, target.offset, target.byteLength)
  }
  if (!Buffer.isBuffer(target)) {
    throw new TypeError(
      'The "target" argument must be one of type Buffer or Uint8Array. ' +
      'Received type ' + (typeof target)
    )
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  var strLen = string.length

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
        : (firstByte > 0xBF) ? 2
          : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!Buffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof Uint8Array.prototype.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, end),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if ((encoding === 'utf8' && code < 128) ||
          encoding === 'latin1') {
        // Fast path: If `val` fits into a single byte, use that numeric value.
        val = code
      }
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : Buffer.from(val, encoding)
    var len = bytes.length
    if (len === 0) {
      throw new TypeError('The value "' + val +
        '" is invalid for argument "value"')
    }
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node takes equal signs as end of the Base64 encoding
  str = str.split('=')[0]
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// ArrayBuffer or Uint8Array objects from other contexts (i.e. iframes) do not pass
// the `instanceof` check but they should be treated as of that type.
// See: https://github.com/feross/buffer/issues/166
function isInstance (obj, type) {
  return obj instanceof type ||
    (obj != null && obj.constructor != null && obj.constructor.name != null &&
      obj.constructor.name === type.name)
}
function numberIsNaN (obj) {
  // For IE11 support
  return obj !== obj // eslint-disable-line no-self-compare
}

}).call(this)}).call(this,require("buffer").Buffer)
},{"base64-js":17,"buffer":18,"ieee754":19}],19:[function(require,module,exports){
/*! ieee754. BSD-3-Clause License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = (e * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = (m * 256) + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = (nBytes * 8) - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = ((value * c) - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],20:[function(require,module,exports){
// Top level file is just a mixin of submodules & constants
'use strict';

const { Deflate, deflate, deflateRaw, gzip } = require('./lib/deflate');

const { Inflate, inflate, inflateRaw, ungzip } = require('./lib/inflate');

const constants = require('./lib/zlib/constants');

module.exports.Deflate = Deflate;
module.exports.deflate = deflate;
module.exports.deflateRaw = deflateRaw;
module.exports.gzip = gzip;
module.exports.Inflate = Inflate;
module.exports.inflate = inflate;
module.exports.inflateRaw = inflateRaw;
module.exports.ungzip = ungzip;
module.exports.constants = constants;

},{"./lib/deflate":21,"./lib/inflate":22,"./lib/zlib/constants":26}],21:[function(require,module,exports){
'use strict';


const zlib_deflate = require('./zlib/deflate');
const utils        = require('./utils/common');
const strings      = require('./utils/strings');
const msg          = require('./zlib/messages');
const ZStream      = require('./zlib/zstream');

const toString = Object.prototype.toString;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH,
  Z_OK, Z_STREAM_END,
  Z_DEFAULT_COMPRESSION,
  Z_DEFAULT_STRATEGY,
  Z_DEFLATED
} = require('./zlib/constants');

/* ===========================================================================*/


/**
 * class Deflate
 *
 * Generic JS-style wrapper for zlib calls. If you don't need
 * streaming behaviour - use more simple functions: [[deflate]],
 * [[deflateRaw]] and [[gzip]].
 **/

/* internal
 * Deflate.chunks -> Array
 *
 * Chunks of output data, if [[Deflate#onData]] not overridden.
 **/

/**
 * Deflate.result -> Uint8Array
 *
 * Compressed result, generated by default [[Deflate#onData]]
 * and [[Deflate#onEnd]] handlers. Filled after you push last chunk
 * (call [[Deflate#push]] with `Z_FINISH` / `true` param).
 **/

/**
 * Deflate.err -> Number
 *
 * Error code after deflate finished. 0 (Z_OK) on success.
 * You will not need it in real life, because deflate errors
 * are possible only on wrong options or bad `onData` / `onEnd`
 * custom handlers.
 **/

/**
 * Deflate.msg -> String
 *
 * Error message, if [[Deflate.err]] != 0
 **/


/**
 * new Deflate(options)
 * - options (Object): zlib deflate options.
 *
 * Creates new deflator instance with specified params. Throws exception
 * on bad params. Supported options:
 *
 * - `level`
 * - `windowBits`
 * - `memLevel`
 * - `strategy`
 * - `dictionary`
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Additional options, for internal needs:
 *
 * - `chunkSize` - size of generated data chunks (16K by default)
 * - `raw` (Boolean) - do raw deflate
 * - `gzip` (Boolean) - create gzip wrapper
 * - `header` (Object) - custom header for gzip
 *   - `text` (Boolean) - true if compressed data believed to be text
 *   - `time` (Number) - modification time, unix timestamp
 *   - `os` (Number) - operation system code
 *   - `extra` (Array) - array of bytes with extra data (max 65536)
 *   - `name` (String) - file name (binary string)
 *   - `comment` (String) - comment (binary string)
 *   - `hcrc` (Boolean) - true if header crc should be added
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 *   , chunk1 = new Uint8Array([1,2,3,4,5,6,7,8,9])
 *   , chunk2 = new Uint8Array([10,11,12,13,14,15,16,17,18,19]);
 *
 * const deflate = new pako.Deflate({ level: 3});
 *
 * deflate.push(chunk1, false);
 * deflate.push(chunk2, true);  // true -> last chunk
 *
 * if (deflate.err) { throw new Error(deflate.err); }
 *
 * console.log(deflate.result);
 * ```
 **/
function Deflate(options) {
  this.options = utils.assign({
    level: Z_DEFAULT_COMPRESSION,
    method: Z_DEFLATED,
    chunkSize: 16384,
    windowBits: 15,
    memLevel: 8,
    strategy: Z_DEFAULT_STRATEGY
  }, options || {});

  let opt = this.options;

  if (opt.raw && (opt.windowBits > 0)) {
    opt.windowBits = -opt.windowBits;
  }

  else if (opt.gzip && (opt.windowBits > 0) && (opt.windowBits < 16)) {
    opt.windowBits += 16;
  }

  this.err    = 0;      // error code, if happens (0 = Z_OK)
  this.msg    = '';     // error message
  this.ended  = false;  // used to avoid multiple onEnd() calls
  this.chunks = [];     // chunks of compressed data

  this.strm = new ZStream();
  this.strm.avail_out = 0;

  let status = zlib_deflate.deflateInit2(
    this.strm,
    opt.level,
    opt.method,
    opt.windowBits,
    opt.memLevel,
    opt.strategy
  );

  if (status !== Z_OK) {
    throw new Error(msg[status]);
  }

  if (opt.header) {
    zlib_deflate.deflateSetHeader(this.strm, opt.header);
  }

  if (opt.dictionary) {
    let dict;
    // Convert data if needed
    if (typeof opt.dictionary === 'string') {
      // If we need to compress text, change encoding to utf8.
      dict = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === '[object ArrayBuffer]') {
      dict = new Uint8Array(opt.dictionary);
    } else {
      dict = opt.dictionary;
    }

    status = zlib_deflate.deflateSetDictionary(this.strm, dict);

    if (status !== Z_OK) {
      throw new Error(msg[status]);
    }

    this._dict_set = true;
  }
}

/**
 * Deflate#push(data[, flush_mode]) -> Boolean
 * - data (Uint8Array|ArrayBuffer|String): input data. Strings will be
 *   converted to utf8 byte sequence.
 * - flush_mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE modes.
 *   See constants. Skipped or `false` means Z_NO_FLUSH, `true` means Z_FINISH.
 *
 * Sends input data to deflate pipe, generating [[Deflate#onData]] calls with
 * new compressed chunks. Returns `true` on success. The last data block must
 * have `flush_mode` Z_FINISH (or `true`). That will flush internal pending
 * buffers and call [[Deflate#onEnd]].
 *
 * On fail call [[Deflate#onEnd]] with error code and return false.
 *
 * ##### Example
 *
 * ```javascript
 * push(chunk, false); // push one of data chunks
 * ...
 * push(chunk, true);  // push last chunk
 * ```
 **/
Deflate.prototype.push = function (data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  let status, _flush_mode;

  if (this.ended) { return false; }

  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;

  // Convert data if needed
  if (typeof data === 'string') {
    // If we need to compress text, change encoding to utf8.
    strm.input = strings.string2buf(data);
  } else if (toString.call(data) === '[object ArrayBuffer]') {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }

  strm.next_in = 0;
  strm.avail_in = strm.input.length;

  for (;;) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }

    // Make sure avail_out > 6 to avoid repeating markers
    if ((_flush_mode === Z_SYNC_FLUSH || _flush_mode === Z_FULL_FLUSH) && strm.avail_out <= 6) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }

    status = zlib_deflate.deflate(strm, _flush_mode);

    // Ended => flush and finish
    if (status === Z_STREAM_END) {
      if (strm.next_out > 0) {
        this.onData(strm.output.subarray(0, strm.next_out));
      }
      status = zlib_deflate.deflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return status === Z_OK;
    }

    // Flush if out buffer full
    if (strm.avail_out === 0) {
      this.onData(strm.output);
      continue;
    }

    // Flush if requested and has data
    if (_flush_mode > 0 && strm.next_out > 0) {
      this.onData(strm.output.subarray(0, strm.next_out));
      strm.avail_out = 0;
      continue;
    }

    if (strm.avail_in === 0) break;
  }

  return true;
};


/**
 * Deflate#onData(chunk) -> Void
 * - chunk (Uint8Array): output data.
 *
 * By default, stores data blocks in `chunks[]` property and glue
 * those in `onEnd`. Override this handler, if you need another behaviour.
 **/
Deflate.prototype.onData = function (chunk) {
  this.chunks.push(chunk);
};


/**
 * Deflate#onEnd(status) -> Void
 * - status (Number): deflate status. 0 (Z_OK) on success,
 *   other if not.
 *
 * Called once after you tell deflate that the input stream is
 * complete (Z_FINISH). By default - join collected chunks,
 * free memory and fill `results` / `err` properties.
 **/
Deflate.prototype.onEnd = function (status) {
  // On success - join
  if (status === Z_OK) {
    this.result = utils.flattenChunks(this.chunks);
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};


/**
 * deflate(data[, options]) -> Uint8Array
 * - data (Uint8Array|ArrayBuffer|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * Compress `data` with deflate algorithm and `options`.
 *
 * Supported options are:
 *
 * - level
 * - windowBits
 * - memLevel
 * - strategy
 * - dictionary
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Sugar (options):
 *
 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
 *   negative windowBits implicitly.
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 * const data = new Uint8Array([1,2,3,4,5,6,7,8,9]);
 *
 * console.log(pako.deflate(data));
 * ```
 **/
function deflate(input, options) {
  const deflator = new Deflate(options);

  deflator.push(input, true);

  // That will never happens, if you don't cheat with options :)
  if (deflator.err) { throw deflator.msg || msg[deflator.err]; }

  return deflator.result;
}


/**
 * deflateRaw(data[, options]) -> Uint8Array
 * - data (Uint8Array|ArrayBuffer|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * The same as [[deflate]], but creates raw data, without wrapper
 * (header and adler32 crc).
 **/
function deflateRaw(input, options) {
  options = options || {};
  options.raw = true;
  return deflate(input, options);
}


/**
 * gzip(data[, options]) -> Uint8Array
 * - data (Uint8Array|ArrayBuffer|String): input data to compress.
 * - options (Object): zlib deflate options.
 *
 * The same as [[deflate]], but create gzip wrapper instead of
 * deflate one.
 **/
function gzip(input, options) {
  options = options || {};
  options.gzip = true;
  return deflate(input, options);
}


module.exports.Deflate = Deflate;
module.exports.deflate = deflate;
module.exports.deflateRaw = deflateRaw;
module.exports.gzip = gzip;
module.exports.constants = require('./zlib/constants');

},{"./utils/common":23,"./utils/strings":24,"./zlib/constants":26,"./zlib/deflate":28,"./zlib/messages":33,"./zlib/zstream":35}],22:[function(require,module,exports){
'use strict';


const zlib_inflate = require('./zlib/inflate');
const utils        = require('./utils/common');
const strings      = require('./utils/strings');
const msg          = require('./zlib/messages');
const ZStream      = require('./zlib/zstream');
const GZheader     = require('./zlib/gzheader');

const toString = Object.prototype.toString;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_FINISH,
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR
} = require('./zlib/constants');

/* ===========================================================================*/


/**
 * class Inflate
 *
 * Generic JS-style wrapper for zlib calls. If you don't need
 * streaming behaviour - use more simple functions: [[inflate]]
 * and [[inflateRaw]].
 **/

/* internal
 * inflate.chunks -> Array
 *
 * Chunks of output data, if [[Inflate#onData]] not overridden.
 **/

/**
 * Inflate.result -> Uint8Array|String
 *
 * Uncompressed result, generated by default [[Inflate#onData]]
 * and [[Inflate#onEnd]] handlers. Filled after you push last chunk
 * (call [[Inflate#push]] with `Z_FINISH` / `true` param).
 **/

/**
 * Inflate.err -> Number
 *
 * Error code after inflate finished. 0 (Z_OK) on success.
 * Should be checked if broken data possible.
 **/

/**
 * Inflate.msg -> String
 *
 * Error message, if [[Inflate.err]] != 0
 **/


/**
 * new Inflate(options)
 * - options (Object): zlib inflate options.
 *
 * Creates new inflator instance with specified params. Throws exception
 * on bad params. Supported options:
 *
 * - `windowBits`
 * - `dictionary`
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information on these.
 *
 * Additional options, for internal needs:
 *
 * - `chunkSize` - size of generated data chunks (16K by default)
 * - `raw` (Boolean) - do raw inflate
 * - `to` (String) - if equal to 'string', then result will be converted
 *   from utf8 to utf16 (javascript) string. When string output requested,
 *   chunk length can differ from `chunkSize`, depending on content.
 *
 * By default, when no options set, autodetect deflate/gzip data format via
 * wrapper header.
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako')
 * const chunk1 = new Uint8Array([1,2,3,4,5,6,7,8,9])
 * const chunk2 = new Uint8Array([10,11,12,13,14,15,16,17,18,19]);
 *
 * const inflate = new pako.Inflate({ level: 3});
 *
 * inflate.push(chunk1, false);
 * inflate.push(chunk2, true);  // true -> last chunk
 *
 * if (inflate.err) { throw new Error(inflate.err); }
 *
 * console.log(inflate.result);
 * ```
 **/
function Inflate(options) {
  this.options = utils.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ''
  }, options || {});

  const opt = this.options;

  // Force window size for `raw` data, if not set directly,
  // because we have no header for autodetect.
  if (opt.raw && (opt.windowBits >= 0) && (opt.windowBits < 16)) {
    opt.windowBits = -opt.windowBits;
    if (opt.windowBits === 0) { opt.windowBits = -15; }
  }

  // If `windowBits` not defined (and mode not raw) - set autodetect flag for gzip/deflate
  if ((opt.windowBits >= 0) && (opt.windowBits < 16) &&
      !(options && options.windowBits)) {
    opt.windowBits += 32;
  }

  // Gzip header has no info about windows size, we can do autodetect only
  // for deflate. So, if window size not set, force it to max when gzip possible
  if ((opt.windowBits > 15) && (opt.windowBits < 48)) {
    // bit 3 (16) -> gzipped data
    // bit 4 (32) -> autodetect gzip/deflate
    if ((opt.windowBits & 15) === 0) {
      opt.windowBits |= 15;
    }
  }

  this.err    = 0;      // error code, if happens (0 = Z_OK)
  this.msg    = '';     // error message
  this.ended  = false;  // used to avoid multiple onEnd() calls
  this.chunks = [];     // chunks of compressed data

  this.strm   = new ZStream();
  this.strm.avail_out = 0;

  let status  = zlib_inflate.inflateInit2(
    this.strm,
    opt.windowBits
  );

  if (status !== Z_OK) {
    throw new Error(msg[status]);
  }

  this.header = new GZheader();

  zlib_inflate.inflateGetHeader(this.strm, this.header);

  // Setup dictionary
  if (opt.dictionary) {
    // Convert data if needed
    if (typeof opt.dictionary === 'string') {
      opt.dictionary = strings.string2buf(opt.dictionary);
    } else if (toString.call(opt.dictionary) === '[object ArrayBuffer]') {
      opt.dictionary = new Uint8Array(opt.dictionary);
    }
    if (opt.raw) { //In raw mode we need to set the dictionary early
      status = zlib_inflate.inflateSetDictionary(this.strm, opt.dictionary);
      if (status !== Z_OK) {
        throw new Error(msg[status]);
      }
    }
  }
}

/**
 * Inflate#push(data[, flush_mode]) -> Boolean
 * - data (Uint8Array|ArrayBuffer): input data
 * - flush_mode (Number|Boolean): 0..6 for corresponding Z_NO_FLUSH..Z_TREE
 *   flush modes. See constants. Skipped or `false` means Z_NO_FLUSH,
 *   `true` means Z_FINISH.
 *
 * Sends input data to inflate pipe, generating [[Inflate#onData]] calls with
 * new output chunks. Returns `true` on success. If end of stream detected,
 * [[Inflate#onEnd]] will be called.
 *
 * `flush_mode` is not needed for normal operation, because end of stream
 * detected automatically. You may try to use it for advanced things, but
 * this functionality was not tested.
 *
 * On fail call [[Inflate#onEnd]] with error code and return false.
 *
 * ##### Example
 *
 * ```javascript
 * push(chunk, false); // push one of data chunks
 * ...
 * push(chunk, true);  // push last chunk
 * ```
 **/
Inflate.prototype.push = function (data, flush_mode) {
  const strm = this.strm;
  const chunkSize = this.options.chunkSize;
  const dictionary = this.options.dictionary;
  let status, _flush_mode, last_avail_out;

  if (this.ended) return false;

  if (flush_mode === ~~flush_mode) _flush_mode = flush_mode;
  else _flush_mode = flush_mode === true ? Z_FINISH : Z_NO_FLUSH;

  // Convert data if needed
  if (toString.call(data) === '[object ArrayBuffer]') {
    strm.input = new Uint8Array(data);
  } else {
    strm.input = data;
  }

  strm.next_in = 0;
  strm.avail_in = strm.input.length;

  for (;;) {
    if (strm.avail_out === 0) {
      strm.output = new Uint8Array(chunkSize);
      strm.next_out = 0;
      strm.avail_out = chunkSize;
    }

    status = zlib_inflate.inflate(strm, _flush_mode);

    if (status === Z_NEED_DICT && dictionary) {
      status = zlib_inflate.inflateSetDictionary(strm, dictionary);

      if (status === Z_OK) {
        status = zlib_inflate.inflate(strm, _flush_mode);
      } else if (status === Z_DATA_ERROR) {
        // Replace code with more verbose
        status = Z_NEED_DICT;
      }
    }

    // Skip snyc markers if more data follows and not raw mode
    while (strm.avail_in > 0 &&
           status === Z_STREAM_END &&
           strm.state.wrap > 0 &&
           data[strm.next_in] !== 0)
    {
      zlib_inflate.inflateReset(strm);
      status = zlib_inflate.inflate(strm, _flush_mode);
    }

    switch (status) {
      case Z_STREAM_ERROR:
      case Z_DATA_ERROR:
      case Z_NEED_DICT:
      case Z_MEM_ERROR:
        this.onEnd(status);
        this.ended = true;
        return false;
    }

    // Remember real `avail_out` value, because we may patch out buffer content
    // to align utf8 strings boundaries.
    last_avail_out = strm.avail_out;

    if (strm.next_out) {
      if (strm.avail_out === 0 || status === Z_STREAM_END) {

        if (this.options.to === 'string') {

          let next_out_utf8 = strings.utf8border(strm.output, strm.next_out);

          let tail = strm.next_out - next_out_utf8;
          let utf8str = strings.buf2string(strm.output, next_out_utf8);

          // move tail & realign counters
          strm.next_out = tail;
          strm.avail_out = chunkSize - tail;
          if (tail) strm.output.set(strm.output.subarray(next_out_utf8, next_out_utf8 + tail), 0);

          this.onData(utf8str);

        } else {
          this.onData(strm.output.length === strm.next_out ? strm.output : strm.output.subarray(0, strm.next_out));
        }
      }
    }

    // Must repeat iteration if out buffer is full
    if (status === Z_OK && last_avail_out === 0) continue;

    // Finalize if end of stream reached.
    if (status === Z_STREAM_END) {
      status = zlib_inflate.inflateEnd(this.strm);
      this.onEnd(status);
      this.ended = true;
      return true;
    }

    if (strm.avail_in === 0) break;
  }

  return true;
};


/**
 * Inflate#onData(chunk) -> Void
 * - chunk (Uint8Array|String): output data. When string output requested,
 *   each chunk will be string.
 *
 * By default, stores data blocks in `chunks[]` property and glue
 * those in `onEnd`. Override this handler, if you need another behaviour.
 **/
Inflate.prototype.onData = function (chunk) {
  this.chunks.push(chunk);
};


/**
 * Inflate#onEnd(status) -> Void
 * - status (Number): inflate status. 0 (Z_OK) on success,
 *   other if not.
 *
 * Called either after you tell inflate that the input stream is
 * complete (Z_FINISH). By default - join collected chunks,
 * free memory and fill `results` / `err` properties.
 **/
Inflate.prototype.onEnd = function (status) {
  // On success - join
  if (status === Z_OK) {
    if (this.options.to === 'string') {
      this.result = this.chunks.join('');
    } else {
      this.result = utils.flattenChunks(this.chunks);
    }
  }
  this.chunks = [];
  this.err = status;
  this.msg = this.strm.msg;
};


/**
 * inflate(data[, options]) -> Uint8Array|String
 * - data (Uint8Array|ArrayBuffer): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * Decompress `data` with inflate/ungzip and `options`. Autodetect
 * format via wrapper header by default. That's why we don't provide
 * separate `ungzip` method.
 *
 * Supported options are:
 *
 * - windowBits
 *
 * [http://zlib.net/manual.html#Advanced](http://zlib.net/manual.html#Advanced)
 * for more information.
 *
 * Sugar (options):
 *
 * - `raw` (Boolean) - say that we work with raw stream, if you don't wish to specify
 *   negative windowBits implicitly.
 * - `to` (String) - if equal to 'string', then result will be converted
 *   from utf8 to utf16 (javascript) string. When string output requested,
 *   chunk length can differ from `chunkSize`, depending on content.
 *
 *
 * ##### Example:
 *
 * ```javascript
 * const pako = require('pako');
 * const input = pako.deflate(new Uint8Array([1,2,3,4,5,6,7,8,9]));
 * let output;
 *
 * try {
 *   output = pako.inflate(input);
 * } catch (err) {
 *   console.log(err);
 * }
 * ```
 **/
function inflate(input, options) {
  const inflator = new Inflate(options);

  inflator.push(input);

  // That will never happens, if you don't cheat with options :)
  if (inflator.err) throw inflator.msg || msg[inflator.err];

  return inflator.result;
}


/**
 * inflateRaw(data[, options]) -> Uint8Array|String
 * - data (Uint8Array|ArrayBuffer): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * The same as [[inflate]], but creates raw data, without wrapper
 * (header and adler32 crc).
 **/
function inflateRaw(input, options) {
  options = options || {};
  options.raw = true;
  return inflate(input, options);
}


/**
 * ungzip(data[, options]) -> Uint8Array|String
 * - data (Uint8Array|ArrayBuffer): input data to decompress.
 * - options (Object): zlib inflate options.
 *
 * Just shortcut to [[inflate]], because it autodetects format
 * by header.content. Done for convenience.
 **/


module.exports.Inflate = Inflate;
module.exports.inflate = inflate;
module.exports.inflateRaw = inflateRaw;
module.exports.ungzip = inflate;
module.exports.constants = require('./zlib/constants');

},{"./utils/common":23,"./utils/strings":24,"./zlib/constants":26,"./zlib/gzheader":29,"./zlib/inflate":31,"./zlib/messages":33,"./zlib/zstream":35}],23:[function(require,module,exports){
'use strict';


const _has = (obj, key) => {
  return Object.prototype.hasOwnProperty.call(obj, key);
};

module.exports.assign = function (obj /*from1, from2, from3, ...*/) {
  const sources = Array.prototype.slice.call(arguments, 1);
  while (sources.length) {
    const source = sources.shift();
    if (!source) { continue; }

    if (typeof source !== 'object') {
      throw new TypeError(source + 'must be non-object');
    }

    for (const p in source) {
      if (_has(source, p)) {
        obj[p] = source[p];
      }
    }
  }

  return obj;
};


// Join array of chunks to single array.
module.exports.flattenChunks = (chunks) => {
  // calculate data length
  let len = 0;

  for (let i = 0, l = chunks.length; i < l; i++) {
    len += chunks[i].length;
  }

  // join chunks
  const result = new Uint8Array(len);

  for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
    let chunk = chunks[i];
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
};

},{}],24:[function(require,module,exports){
// String encode/decode helpers
'use strict';


// Quick check if we can use fast array to bin string conversion
//
// - apply(Array) can fail on Android 2.2
// - apply(Uint8Array) can fail on iOS 5.1 Safari
//
let STR_APPLY_UIA_OK = true;

try { String.fromCharCode.apply(null, new Uint8Array(1)); } catch (__) { STR_APPLY_UIA_OK = false; }


// Table with utf8 lengths (calculated by first byte of sequence)
// Note, that 5 & 6-byte values and some 4-byte values can not be represented in JS,
// because max possible codepoint is 0x10ffff
const _utf8len = new Uint8Array(256);
for (let q = 0; q < 256; q++) {
  _utf8len[q] = (q >= 252 ? 6 : q >= 248 ? 5 : q >= 240 ? 4 : q >= 224 ? 3 : q >= 192 ? 2 : 1);
}
_utf8len[254] = _utf8len[254] = 1; // Invalid sequence start


// convert string to array (typed, when possible)
module.exports.string2buf = (str) => {
  if (typeof TextEncoder === 'function' && TextEncoder.prototype.encode) {
    return new TextEncoder().encode(str);
  }

  let buf, c, c2, m_pos, i, str_len = str.length, buf_len = 0;

  // count binary size
  for (m_pos = 0; m_pos < str_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 0xfc00) === 0xd800 && (m_pos + 1 < str_len)) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        m_pos++;
      }
    }
    buf_len += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }

  // allocate buffer
  buf = new Uint8Array(buf_len);

  // convert
  for (i = 0, m_pos = 0; i < buf_len; m_pos++) {
    c = str.charCodeAt(m_pos);
    if ((c & 0xfc00) === 0xd800 && (m_pos + 1 < str_len)) {
      c2 = str.charCodeAt(m_pos + 1);
      if ((c2 & 0xfc00) === 0xdc00) {
        c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        m_pos++;
      }
    }
    if (c < 0x80) {
      /* one byte */
      buf[i++] = c;
    } else if (c < 0x800) {
      /* two bytes */
      buf[i++] = 0xC0 | (c >>> 6);
      buf[i++] = 0x80 | (c & 0x3f);
    } else if (c < 0x10000) {
      /* three bytes */
      buf[i++] = 0xE0 | (c >>> 12);
      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
      buf[i++] = 0x80 | (c & 0x3f);
    } else {
      /* four bytes */
      buf[i++] = 0xf0 | (c >>> 18);
      buf[i++] = 0x80 | (c >>> 12 & 0x3f);
      buf[i++] = 0x80 | (c >>> 6 & 0x3f);
      buf[i++] = 0x80 | (c & 0x3f);
    }
  }

  return buf;
};

// Helper
const buf2binstring = (buf, len) => {
  // On Chrome, the arguments in a function call that are allowed is `65534`.
  // If the length of the buffer is smaller than that, we can use this optimization,
  // otherwise we will take a slower path.
  if (len < 65534) {
    if (buf.subarray && STR_APPLY_UIA_OK) {
      return String.fromCharCode.apply(null, buf.length === len ? buf : buf.subarray(0, len));
    }
  }

  let result = '';
  for (let i = 0; i < len; i++) {
    result += String.fromCharCode(buf[i]);
  }
  return result;
};


// convert array to string
module.exports.buf2string = (buf, max) => {
  const len = max || buf.length;

  if (typeof TextDecoder === 'function' && TextDecoder.prototype.decode) {
    return new TextDecoder().decode(buf.subarray(0, max));
  }

  let i, out;

  // Reserve max possible length (2 words per char)
  // NB: by unknown reasons, Array is significantly faster for
  //     String.fromCharCode.apply than Uint16Array.
  const utf16buf = new Array(len * 2);

  for (out = 0, i = 0; i < len;) {
    let c = buf[i++];
    // quick process ascii
    if (c < 0x80) { utf16buf[out++] = c; continue; }

    let c_len = _utf8len[c];
    // skip 5 & 6 byte codes
    if (c_len > 4) { utf16buf[out++] = 0xfffd; i += c_len - 1; continue; }

    // apply mask on first byte
    c &= c_len === 2 ? 0x1f : c_len === 3 ? 0x0f : 0x07;
    // join the rest
    while (c_len > 1 && i < len) {
      c = (c << 6) | (buf[i++] & 0x3f);
      c_len--;
    }

    // terminated by end of string?
    if (c_len > 1) { utf16buf[out++] = 0xfffd; continue; }

    if (c < 0x10000) {
      utf16buf[out++] = c;
    } else {
      c -= 0x10000;
      utf16buf[out++] = 0xd800 | ((c >> 10) & 0x3ff);
      utf16buf[out++] = 0xdc00 | (c & 0x3ff);
    }
  }

  return buf2binstring(utf16buf, out);
};


// Calculate max possible position in utf8 buffer,
// that will not break sequence. If that's not possible
// - (very small limits) return max size as is.
//
// buf[] - utf8 bytes array
// max   - length limit (mandatory);
module.exports.utf8border = (buf, max) => {

  max = max || buf.length;
  if (max > buf.length) { max = buf.length; }

  // go back from last position, until start of sequence found
  let pos = max - 1;
  while (pos >= 0 && (buf[pos] & 0xC0) === 0x80) { pos--; }

  // Very small and broken sequence,
  // return max, because we should return something anyway.
  if (pos < 0) { return max; }

  // If we came to start of buffer - that means buffer is too small,
  // return max too.
  if (pos === 0) { return max; }

  return (pos + _utf8len[buf[pos]] > max) ? pos : max;
};

},{}],25:[function(require,module,exports){
'use strict';

// Note: adler32 takes 12% for level 0 and 2% for level 6.
// It isn't worth it to make additional optimizations as in original.
// Small size is preferable.

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const adler32 = (adler, buf, len, pos) => {
  let s1 = (adler & 0xffff) |0,
      s2 = ((adler >>> 16) & 0xffff) |0,
      n = 0;

  while (len !== 0) {
    // Set limit ~ twice less than 5552, to keep
    // s2 in 31-bits, because we force signed ints.
    // in other case %= will fail.
    n = len > 2000 ? 2000 : len;
    len -= n;

    do {
      s1 = (s1 + buf[pos++]) |0;
      s2 = (s2 + s1) |0;
    } while (--n);

    s1 %= 65521;
    s2 %= 65521;
  }

  return (s1 | (s2 << 16)) |0;
};


module.exports = adler32;

},{}],26:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

module.exports = {

  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH:         0,
  Z_PARTIAL_FLUSH:    1,
  Z_SYNC_FLUSH:       2,
  Z_FULL_FLUSH:       3,
  Z_FINISH:           4,
  Z_BLOCK:            5,
  Z_TREES:            6,

  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK:               0,
  Z_STREAM_END:       1,
  Z_NEED_DICT:        2,
  Z_ERRNO:           -1,
  Z_STREAM_ERROR:    -2,
  Z_DATA_ERROR:      -3,
  Z_MEM_ERROR:       -4,
  Z_BUF_ERROR:       -5,
  //Z_VERSION_ERROR: -6,

  /* compression levels */
  Z_NO_COMPRESSION:         0,
  Z_BEST_SPEED:             1,
  Z_BEST_COMPRESSION:       9,
  Z_DEFAULT_COMPRESSION:   -1,


  Z_FILTERED:               1,
  Z_HUFFMAN_ONLY:           2,
  Z_RLE:                    3,
  Z_FIXED:                  4,
  Z_DEFAULT_STRATEGY:       0,

  /* Possible values of the data_type field (though see inflate()) */
  Z_BINARY:                 0,
  Z_TEXT:                   1,
  //Z_ASCII:                1, // = Z_TEXT (deprecated)
  Z_UNKNOWN:                2,

  /* The deflate compression method */
  Z_DEFLATED:               8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};

},{}],27:[function(require,module,exports){
'use strict';

// Note: we can't get significant speed boost here.
// So write code to minimize size - no pregenerated tables
// and array tools dependencies.

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

// Use ordinary array, since untyped makes no boost here
const makeTable = () => {
  let c, table = [];

  for (var n = 0; n < 256; n++) {
    c = n;
    for (var k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[n] = c;
  }

  return table;
};

// Create table on load. Just 255 signed longs. Not a problem.
const crcTable = new Uint32Array(makeTable());


const crc32 = (crc, buf, len, pos) => {
  const t = crcTable;
  const end = pos + len;

  crc ^= -1;

  for (let i = pos; i < end; i++) {
    crc = (crc >>> 8) ^ t[(crc ^ buf[i]) & 0xFF];
  }

  return (crc ^ (-1)); // >>> 0;
};


module.exports = crc32;

},{}],28:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const { _tr_init, _tr_stored_block, _tr_flush_block, _tr_tally, _tr_align } = require('./trees');
const adler32 = require('./adler32');
const crc32   = require('./crc32');
const msg     = require('./messages');

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_NO_FLUSH, Z_PARTIAL_FLUSH, Z_FULL_FLUSH, Z_FINISH, Z_BLOCK,
  Z_OK, Z_STREAM_END, Z_STREAM_ERROR, Z_DATA_ERROR, Z_BUF_ERROR,
  Z_DEFAULT_COMPRESSION,
  Z_FILTERED, Z_HUFFMAN_ONLY, Z_RLE, Z_FIXED, Z_DEFAULT_STRATEGY,
  Z_UNKNOWN,
  Z_DEFLATED
} = require('./constants');

/*============================================================================*/


const MAX_MEM_LEVEL = 9;
/* Maximum value for memLevel in deflateInit2 */
const MAX_WBITS = 15;
/* 32K LZ77 window */
const DEF_MEM_LEVEL = 8;


const LENGTH_CODES  = 29;
/* number of length codes, not counting the special END_BLOCK code */
const LITERALS      = 256;
/* number of literal bytes 0..255 */
const L_CODES       = LITERALS + 1 + LENGTH_CODES;
/* number of Literal or Length codes, including the END_BLOCK code */
const D_CODES       = 30;
/* number of distance codes */
const BL_CODES      = 19;
/* number of codes used to transfer the bit lengths */
const HEAP_SIZE     = 2 * L_CODES + 1;
/* maximum heap size */
const MAX_BITS  = 15;
/* All codes must not exceed MAX_BITS bits */

const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MIN_LOOKAHEAD = (MAX_MATCH + MIN_MATCH + 1);

const PRESET_DICT = 0x20;

const INIT_STATE    =  42;    /* zlib header -> BUSY_STATE */
//#ifdef GZIP
const GZIP_STATE    =  57;    /* gzip header -> BUSY_STATE | EXTRA_STATE */
//#endif
const EXTRA_STATE   =  69;    /* gzip extra block -> NAME_STATE */
const NAME_STATE    =  73;    /* gzip file name -> COMMENT_STATE */
const COMMENT_STATE =  91;    /* gzip comment -> HCRC_STATE */
const HCRC_STATE    = 103;    /* gzip header CRC -> BUSY_STATE */
const BUSY_STATE    = 113;    /* deflate -> FINISH_STATE */
const FINISH_STATE  = 666;    /* stream complete */

const BS_NEED_MORE      = 1; /* block not completed, need more input or more output */
const BS_BLOCK_DONE     = 2; /* block flush performed */
const BS_FINISH_STARTED = 3; /* finish started, need only more output at next deflate */
const BS_FINISH_DONE    = 4; /* finish done, accept no more input or output */

const OS_CODE = 0x03; // Unix :) . Don't detect, use this default.

const err = (strm, errorCode) => {
  strm.msg = msg[errorCode];
  return errorCode;
};

const rank = (f) => {
  return ((f) * 2) - ((f) > 4 ? 9 : 0);
};

const zero = (buf) => {
  let len = buf.length; while (--len >= 0) { buf[len] = 0; }
};

/* ===========================================================================
 * Slide the hash table when sliding the window down (could be avoided with 32
 * bit values at the expense of memory usage). We slide even when level == 0 to
 * keep the hash table consistent if we switch back to level > 0 later.
 */
const slide_hash = (s) => {
  let n, m;
  let p;
  let wsize = s.w_size;

  n = s.hash_size;
  p = n;
  do {
    m = s.head[--p];
    s.head[p] = (m >= wsize ? m - wsize : 0);
  } while (--n);
  n = wsize;
//#ifndef FASTEST
  p = n;
  do {
    m = s.prev[--p];
    s.prev[p] = (m >= wsize ? m - wsize : 0);
    /* If n is not on any hash chain, prev[n] is garbage but
     * its value will never be used.
     */
  } while (--n);
//#endif
};

/* eslint-disable new-cap */
let HASH_ZLIB = (s, prev, data) => ((prev << s.hash_shift) ^ data) & s.hash_mask;
// This hash causes less collisions, https://github.com/nodeca/pako/issues/135
// But breaks binary compatibility
//let HASH_FAST = (s, prev, data) => ((prev << 8) + (prev >> 8) + (data << 4)) & s.hash_mask;
let HASH = HASH_ZLIB;


/* =========================================================================
 * Flush as much pending output as possible. All deflate() output, except for
 * some deflate_stored() output, goes through this function so some
 * applications may wish to modify it to avoid allocating a large
 * strm->next_out buffer and copying into it. (See also read_buf()).
 */
const flush_pending = (strm) => {
  const s = strm.state;

  //_tr_flush_bits(s);
  let len = s.pending;
  if (len > strm.avail_out) {
    len = strm.avail_out;
  }
  if (len === 0) { return; }

  strm.output.set(s.pending_buf.subarray(s.pending_out, s.pending_out + len), strm.next_out);
  strm.next_out  += len;
  s.pending_out  += len;
  strm.total_out += len;
  strm.avail_out -= len;
  s.pending      -= len;
  if (s.pending === 0) {
    s.pending_out = 0;
  }
};


const flush_block_only = (s, last) => {
  _tr_flush_block(s, (s.block_start >= 0 ? s.block_start : -1), s.strstart - s.block_start, last);
  s.block_start = s.strstart;
  flush_pending(s.strm);
};


const put_byte = (s, b) => {
  s.pending_buf[s.pending++] = b;
};


/* =========================================================================
 * Put a short in the pending buffer. The 16-bit value is put in MSB order.
 * IN assertion: the stream state is correct and there is enough room in
 * pending_buf.
 */
const putShortMSB = (s, b) => {

  //  put_byte(s, (Byte)(b >> 8));
//  put_byte(s, (Byte)(b & 0xff));
  s.pending_buf[s.pending++] = (b >>> 8) & 0xff;
  s.pending_buf[s.pending++] = b & 0xff;
};


/* ===========================================================================
 * Read a new buffer from the current input stream, update the adler32
 * and total number of bytes read.  All deflate() input goes through
 * this function so some applications may wish to modify it to avoid
 * allocating a large strm->input buffer and copying from it.
 * (See also flush_pending()).
 */
const read_buf = (strm, buf, start, size) => {

  let len = strm.avail_in;

  if (len > size) { len = size; }
  if (len === 0) { return 0; }

  strm.avail_in -= len;

  // zmemcpy(buf, strm->next_in, len);
  buf.set(strm.input.subarray(strm.next_in, strm.next_in + len), start);
  if (strm.state.wrap === 1) {
    strm.adler = adler32(strm.adler, buf, len, start);
  }

  else if (strm.state.wrap === 2) {
    strm.adler = crc32(strm.adler, buf, len, start);
  }

  strm.next_in += len;
  strm.total_in += len;

  return len;
};


/* ===========================================================================
 * Set match_start to the longest match starting at the given string and
 * return its length. Matches shorter or equal to prev_length are discarded,
 * in which case the result is equal to prev_length and match_start is
 * garbage.
 * IN assertions: cur_match is the head of the hash chain for the current
 *   string (strstart) and its distance is <= MAX_DIST, and prev_length >= 1
 * OUT assertion: the match length is not greater than s->lookahead.
 */
const longest_match = (s, cur_match) => {

  let chain_length = s.max_chain_length;      /* max hash chain length */
  let scan = s.strstart; /* current string */
  let match;                       /* matched string */
  let len;                           /* length of current match */
  let best_len = s.prev_length;              /* best match length so far */
  let nice_match = s.nice_match;             /* stop if match long enough */
  const limit = (s.strstart > (s.w_size - MIN_LOOKAHEAD)) ?
      s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0/*NIL*/;

  const _win = s.window; // shortcut

  const wmask = s.w_mask;
  const prev  = s.prev;

  /* Stop when cur_match becomes <= limit. To simplify the code,
   * we prevent matches with the string of window index 0.
   */

  const strend = s.strstart + MAX_MATCH;
  let scan_end1  = _win[scan + best_len - 1];
  let scan_end   = _win[scan + best_len];

  /* The code is optimized for HASH_BITS >= 8 and MAX_MATCH-2 multiple of 16.
   * It is easy to get rid of this optimization if necessary.
   */
  // Assert(s->hash_bits >= 8 && MAX_MATCH == 258, "Code too clever");

  /* Do not waste too much time if we already have a good match: */
  if (s.prev_length >= s.good_match) {
    chain_length >>= 2;
  }
  /* Do not look for matches beyond the end of the input. This is necessary
   * to make deflate deterministic.
   */
  if (nice_match > s.lookahead) { nice_match = s.lookahead; }

  // Assert((ulg)s->strstart <= s->window_size-MIN_LOOKAHEAD, "need lookahead");

  do {
    // Assert(cur_match < s->strstart, "no future");
    match = cur_match;

    /* Skip to next match if the match length cannot increase
     * or if the match length is less than 2.  Note that the checks below
     * for insufficient lookahead only occur occasionally for performance
     * reasons.  Therefore uninitialized memory will be accessed, and
     * conditional jumps will be made that depend on those values.
     * However the length of the match is limited to the lookahead, so
     * the output of deflate is not affected by the uninitialized values.
     */

    if (_win[match + best_len]     !== scan_end  ||
        _win[match + best_len - 1] !== scan_end1 ||
        _win[match]                !== _win[scan] ||
        _win[++match]              !== _win[scan + 1]) {
      continue;
    }

    /* The check at best_len-1 can be removed because it will be made
     * again later. (This heuristic is not always a win.)
     * It is not necessary to compare scan[2] and match[2] since they
     * are always equal when the other bytes match, given that
     * the hash keys are equal and that HASH_BITS >= 8.
     */
    scan += 2;
    match++;
    // Assert(*scan == *match, "match[2]?");

    /* We check for insufficient lookahead only every 8th comparison;
     * the 256th check will be made at strstart+258.
     */
    do {
      /*jshint noempty:false*/
    } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             _win[++scan] === _win[++match] && _win[++scan] === _win[++match] &&
             scan < strend);

    // Assert(scan <= s->window+(unsigned)(s->window_size-1), "wild scan");

    len = MAX_MATCH - (strend - scan);
    scan = strend - MAX_MATCH;

    if (len > best_len) {
      s.match_start = cur_match;
      best_len = len;
      if (len >= nice_match) {
        break;
      }
      scan_end1  = _win[scan + best_len - 1];
      scan_end   = _win[scan + best_len];
    }
  } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);

  if (best_len <= s.lookahead) {
    return best_len;
  }
  return s.lookahead;
};


/* ===========================================================================
 * Fill the window when the lookahead becomes insufficient.
 * Updates strstart and lookahead.
 *
 * IN assertion: lookahead < MIN_LOOKAHEAD
 * OUT assertions: strstart <= window_size-MIN_LOOKAHEAD
 *    At least one byte has been read, or avail_in == 0; reads are
 *    performed for at least two bytes (required for the zip translate_eol
 *    option -- not supported here).
 */
const fill_window = (s) => {

  const _w_size = s.w_size;
  let n, more, str;

  //Assert(s->lookahead < MIN_LOOKAHEAD, "already enough lookahead");

  do {
    more = s.window_size - s.lookahead - s.strstart;

    // JS ints have 32 bit, block below not needed
    /* Deal with !@#$% 64K limit: */
    //if (sizeof(int) <= 2) {
    //    if (more == 0 && s->strstart == 0 && s->lookahead == 0) {
    //        more = wsize;
    //
    //  } else if (more == (unsigned)(-1)) {
    //        /* Very unlikely, but possible on 16 bit machine if
    //         * strstart == 0 && lookahead == 1 (input done a byte at time)
    //         */
    //        more--;
    //    }
    //}


    /* If the window is almost full and there is insufficient lookahead,
     * move the upper half to the lower one to make room in the upper half.
     */
    if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {

      s.window.set(s.window.subarray(_w_size, _w_size + _w_size - more), 0);
      s.match_start -= _w_size;
      s.strstart -= _w_size;
      /* we now have strstart >= MAX_DIST */
      s.block_start -= _w_size;
      if (s.insert > s.strstart) {
        s.insert = s.strstart;
      }
      slide_hash(s);
      more += _w_size;
    }
    if (s.strm.avail_in === 0) {
      break;
    }

    /* If there was no sliding:
     *    strstart <= WSIZE+MAX_DIST-1 && lookahead <= MIN_LOOKAHEAD - 1 &&
     *    more == window_size - lookahead - strstart
     * => more >= window_size - (MIN_LOOKAHEAD-1 + WSIZE + MAX_DIST-1)
     * => more >= window_size - 2*WSIZE + 2
     * In the BIG_MEM or MMAP case (not yet supported),
     *   window_size == input_size + MIN_LOOKAHEAD  &&
     *   strstart + s->lookahead <= input_size => more >= MIN_LOOKAHEAD.
     * Otherwise, window_size == 2*WSIZE so more >= 2.
     * If there was sliding, more >= WSIZE. So in all cases, more >= 2.
     */
    //Assert(more >= 2, "more < 2");
    n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
    s.lookahead += n;

    /* Initialize the hash value now that we have some input: */
    if (s.lookahead + s.insert >= MIN_MATCH) {
      str = s.strstart - s.insert;
      s.ins_h = s.window[str];

      /* UPDATE_HASH(s, s->ins_h, s->window[str + 1]); */
      s.ins_h = HASH(s, s.ins_h, s.window[str + 1]);
//#if MIN_MATCH != 3
//        Call update_hash() MIN_MATCH-3 more times
//#endif
      while (s.insert) {
        /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
        s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);

        s.prev[str & s.w_mask] = s.head[s.ins_h];
        s.head[s.ins_h] = str;
        str++;
        s.insert--;
        if (s.lookahead + s.insert < MIN_MATCH) {
          break;
        }
      }
    }
    /* If the whole input has less than MIN_MATCH bytes, ins_h is garbage,
     * but this is not important since only literal bytes will be emitted.
     */

  } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);

  /* If the WIN_INIT bytes after the end of the current data have never been
   * written, then zero those bytes in order to avoid memory check reports of
   * the use of uninitialized (or uninitialised as Julian writes) bytes by
   * the longest match routines.  Update the high water mark for the next
   * time through here.  WIN_INIT is set to MAX_MATCH since the longest match
   * routines allow scanning to strstart + MAX_MATCH, ignoring lookahead.
   */
//  if (s.high_water < s.window_size) {
//    const curr = s.strstart + s.lookahead;
//    let init = 0;
//
//    if (s.high_water < curr) {
//      /* Previous high water mark below current data -- zero WIN_INIT
//       * bytes or up to end of window, whichever is less.
//       */
//      init = s.window_size - curr;
//      if (init > WIN_INIT)
//        init = WIN_INIT;
//      zmemzero(s->window + curr, (unsigned)init);
//      s->high_water = curr + init;
//    }
//    else if (s->high_water < (ulg)curr + WIN_INIT) {
//      /* High water mark at or above current data, but below current data
//       * plus WIN_INIT -- zero out to current data plus WIN_INIT, or up
//       * to end of window, whichever is less.
//       */
//      init = (ulg)curr + WIN_INIT - s->high_water;
//      if (init > s->window_size - s->high_water)
//        init = s->window_size - s->high_water;
//      zmemzero(s->window + s->high_water, (unsigned)init);
//      s->high_water += init;
//    }
//  }
//
//  Assert((ulg)s->strstart <= s->window_size - MIN_LOOKAHEAD,
//    "not enough room for search");
};

/* ===========================================================================
 * Copy without compression as much as possible from the input stream, return
 * the current block state.
 *
 * In case deflateParams() is used to later switch to a non-zero compression
 * level, s->matches (otherwise unused when storing) keeps track of the number
 * of hash table slides to perform. If s->matches is 1, then one hash table
 * slide will be done when switching. If s->matches is 2, the maximum value
 * allowed here, then the hash table will be cleared, since two or more slides
 * is the same as a clear.
 *
 * deflate_stored() is written to minimize the number of times an input byte is
 * copied. It is most efficient with large input and output buffers, which
 * maximizes the opportunites to have a single copy from next_in to next_out.
 */
const deflate_stored = (s, flush) => {

  /* Smallest worthy block size when not flushing or finishing. By default
   * this is 32K. This can be as small as 507 bytes for memLevel == 1. For
   * large input and output buffers, the stored block size will be larger.
   */
  let min_block = s.pending_buf_size - 5 > s.w_size ? s.w_size : s.pending_buf_size - 5;

  /* Copy as many min_block or larger stored blocks directly to next_out as
   * possible. If flushing, copy the remaining available input to next_out as
   * stored blocks, if there is enough space.
   */
  let len, left, have, last = 0;
  let used = s.strm.avail_in;
  do {
    /* Set len to the maximum size block that we can copy directly with the
     * available input data and output space. Set left to how much of that
     * would be copied from what's left in the window.
     */
    len = 65535/* MAX_STORED */;     /* maximum deflate stored block length */
    have = (s.bi_valid + 42) >> 3;     /* number of header bytes */
    if (s.strm.avail_out < have) {         /* need room for header */
      break;
    }
      /* maximum stored block length that will fit in avail_out: */
    have = s.strm.avail_out - have;
    left = s.strstart - s.block_start;  /* bytes left in window */
    if (len > left + s.strm.avail_in) {
      len = left + s.strm.avail_in;   /* limit len to the input */
    }
    if (len > have) {
      len = have;             /* limit len to the output */
    }

    /* If the stored block would be less than min_block in length, or if
     * unable to copy all of the available input when flushing, then try
     * copying to the window and the pending buffer instead. Also don't
     * write an empty block when flushing -- deflate() does that.
     */
    if (len < min_block && ((len === 0 && flush !== Z_FINISH) ||
                        flush === Z_NO_FLUSH ||
                        len !== left + s.strm.avail_in)) {
      break;
    }

    /* Make a dummy stored block in pending to get the header bytes,
     * including any pending bits. This also updates the debugging counts.
     */
    last = flush === Z_FINISH && len === left + s.strm.avail_in ? 1 : 0;
    _tr_stored_block(s, 0, 0, last);

    /* Replace the lengths in the dummy stored block with len. */
    s.pending_buf[s.pending - 4] = len;
    s.pending_buf[s.pending - 3] = len >> 8;
    s.pending_buf[s.pending - 2] = ~len;
    s.pending_buf[s.pending - 1] = ~len >> 8;

    /* Write the stored block header bytes. */
    flush_pending(s.strm);

//#ifdef ZLIB_DEBUG
//    /* Update debugging counts for the data about to be copied. */
//    s->compressed_len += len << 3;
//    s->bits_sent += len << 3;
//#endif

    /* Copy uncompressed bytes from the window to next_out. */
    if (left) {
      if (left > len) {
        left = len;
      }
      //zmemcpy(s->strm->next_out, s->window + s->block_start, left);
      s.strm.output.set(s.window.subarray(s.block_start, s.block_start + left), s.strm.next_out);
      s.strm.next_out += left;
      s.strm.avail_out -= left;
      s.strm.total_out += left;
      s.block_start += left;
      len -= left;
    }

    /* Copy uncompressed bytes directly from next_in to next_out, updating
     * the check value.
     */
    if (len) {
      read_buf(s.strm, s.strm.output, s.strm.next_out, len);
      s.strm.next_out += len;
      s.strm.avail_out -= len;
      s.strm.total_out += len;
    }
  } while (last === 0);

  /* Update the sliding window with the last s->w_size bytes of the copied
   * data, or append all of the copied data to the existing window if less
   * than s->w_size bytes were copied. Also update the number of bytes to
   * insert in the hash tables, in the event that deflateParams() switches to
   * a non-zero compression level.
   */
  used -= s.strm.avail_in;    /* number of input bytes directly copied */
  if (used) {
    /* If any input was used, then no unused input remains in the window,
     * therefore s->block_start == s->strstart.
     */
    if (used >= s.w_size) {  /* supplant the previous history */
      s.matches = 2;     /* clear hash */
      //zmemcpy(s->window, s->strm->next_in - s->w_size, s->w_size);
      s.window.set(s.strm.input.subarray(s.strm.next_in - s.w_size, s.strm.next_in), 0);
      s.strstart = s.w_size;
      s.insert = s.strstart;
    }
    else {
      if (s.window_size - s.strstart <= used) {
        /* Slide the window down. */
        s.strstart -= s.w_size;
        //zmemcpy(s->window, s->window + s->w_size, s->strstart);
        s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
        if (s.matches < 2) {
          s.matches++;   /* add a pending slide_hash() */
        }
        if (s.insert > s.strstart) {
          s.insert = s.strstart;
        }
      }
      //zmemcpy(s->window + s->strstart, s->strm->next_in - used, used);
      s.window.set(s.strm.input.subarray(s.strm.next_in - used, s.strm.next_in), s.strstart);
      s.strstart += used;
      s.insert += used > s.w_size - s.insert ? s.w_size - s.insert : used;
    }
    s.block_start = s.strstart;
  }
  if (s.high_water < s.strstart) {
    s.high_water = s.strstart;
  }

  /* If the last block was written to next_out, then done. */
  if (last) {
    return BS_FINISH_DONE;
  }

  /* If flushing and all input has been consumed, then done. */
  if (flush !== Z_NO_FLUSH && flush !== Z_FINISH &&
    s.strm.avail_in === 0 && s.strstart === s.block_start) {
    return BS_BLOCK_DONE;
  }

  /* Fill the window with any remaining input. */
  have = s.window_size - s.strstart;
  if (s.strm.avail_in > have && s.block_start >= s.w_size) {
    /* Slide the window down. */
    s.block_start -= s.w_size;
    s.strstart -= s.w_size;
    //zmemcpy(s->window, s->window + s->w_size, s->strstart);
    s.window.set(s.window.subarray(s.w_size, s.w_size + s.strstart), 0);
    if (s.matches < 2) {
      s.matches++;       /* add a pending slide_hash() */
    }
    have += s.w_size;      /* more space now */
    if (s.insert > s.strstart) {
      s.insert = s.strstart;
    }
  }
  if (have > s.strm.avail_in) {
    have = s.strm.avail_in;
  }
  if (have) {
    read_buf(s.strm, s.window, s.strstart, have);
    s.strstart += have;
    s.insert += have > s.w_size - s.insert ? s.w_size - s.insert : have;
  }
  if (s.high_water < s.strstart) {
    s.high_water = s.strstart;
  }

  /* There was not enough avail_out to write a complete worthy or flushed
   * stored block to next_out. Write a stored block to pending instead, if we
   * have enough input for a worthy block, or if flushing and there is enough
   * room for the remaining input as a stored block in the pending buffer.
   */
  have = (s.bi_valid + 42) >> 3;     /* number of header bytes */
    /* maximum stored block length that will fit in pending: */
  have = s.pending_buf_size - have > 65535/* MAX_STORED */ ? 65535/* MAX_STORED */ : s.pending_buf_size - have;
  min_block = have > s.w_size ? s.w_size : have;
  left = s.strstart - s.block_start;
  if (left >= min_block ||
     ((left || flush === Z_FINISH) && flush !== Z_NO_FLUSH &&
     s.strm.avail_in === 0 && left <= have)) {
    len = left > have ? have : left;
    last = flush === Z_FINISH && s.strm.avail_in === 0 &&
         len === left ? 1 : 0;
    _tr_stored_block(s, s.block_start, len, last);
    s.block_start += len;
    flush_pending(s.strm);
  }

  /* We've done all we can with the available input and output. */
  return last ? BS_FINISH_STARTED : BS_NEED_MORE;
};


/* ===========================================================================
 * Compress as much as possible from the input stream, return the current
 * block state.
 * This function does not perform lazy evaluation of matches and inserts
 * new strings in the dictionary only for unmatched strings or for short
 * matches. It is used only for the fast compression options.
 */
const deflate_fast = (s, flush) => {

  let hash_head;        /* head of the hash chain */
  let bflush;           /* set if current block must be flushed */

  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the next match, plus MIN_MATCH bytes to insert the
     * string following the next match.
     */
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) {
        break; /* flush the current block */
      }
    }

    /* Insert the string window[strstart .. strstart+2] in the
     * dictionary, and set hash_head to the head of the hash chain:
     */
    hash_head = 0/*NIL*/;
    if (s.lookahead >= MIN_MATCH) {
      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
      /***/
    }

    /* Find the longest match, discarding those <= prev_length.
     * At this point we have always match_length < MIN_MATCH
     */
    if (hash_head !== 0/*NIL*/ && ((s.strstart - hash_head) <= (s.w_size - MIN_LOOKAHEAD))) {
      /* To simplify the code, we prevent matches with the string
       * of window index 0 (in particular we have to avoid a match
       * of the string with itself at the start of the input file).
       */
      s.match_length = longest_match(s, hash_head);
      /* longest_match() sets match_start */
    }
    if (s.match_length >= MIN_MATCH) {
      // check_match(s, s.strstart, s.match_start, s.match_length); // for debug only

      /*** _tr_tally_dist(s, s.strstart - s.match_start,
                     s.match_length - MIN_MATCH, bflush); ***/
      bflush = _tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);

      s.lookahead -= s.match_length;

      /* Insert new strings in the hash table only if the match length
       * is not too large. This saves time but degrades compression.
       */
      if (s.match_length <= s.max_lazy_match/*max_insert_length*/ && s.lookahead >= MIN_MATCH) {
        s.match_length--; /* string at strstart already in table */
        do {
          s.strstart++;
          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
          /***/
          /* strstart never exceeds WSIZE-MAX_MATCH, so there are
           * always MIN_MATCH bytes ahead.
           */
        } while (--s.match_length !== 0);
        s.strstart++;
      } else
      {
        s.strstart += s.match_length;
        s.match_length = 0;
        s.ins_h = s.window[s.strstart];
        /* UPDATE_HASH(s, s.ins_h, s.window[s.strstart+1]); */
        s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + 1]);

//#if MIN_MATCH != 3
//                Call UPDATE_HASH() MIN_MATCH-3 more times
//#endif
        /* If lookahead < MIN_MATCH, ins_h is garbage, but it does not
         * matter since it will be recomputed at next deflate call.
         */
      }
    } else {
      /* No match, output a literal byte */
      //Tracevv((stderr,"%c", s.window[s.strstart]));
      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart]);

      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = ((s.strstart < (MIN_MATCH - 1)) ? s.strstart : MIN_MATCH - 1);
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* ===========================================================================
 * Same as above, but achieves better compression. We use a lazy
 * evaluation for matches: a match is finally adopted only if there is
 * no better match at the next window position.
 */
const deflate_slow = (s, flush) => {

  let hash_head;          /* head of hash chain */
  let bflush;              /* set if current block must be flushed */

  let max_insert;

  /* Process the input block. */
  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the next match, plus MIN_MATCH bytes to insert the
     * string following the next match.
     */
    if (s.lookahead < MIN_LOOKAHEAD) {
      fill_window(s);
      if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) { break; } /* flush the current block */
    }

    /* Insert the string window[strstart .. strstart+2] in the
     * dictionary, and set hash_head to the head of the hash chain:
     */
    hash_head = 0/*NIL*/;
    if (s.lookahead >= MIN_MATCH) {
      /*** INSERT_STRING(s, s.strstart, hash_head); ***/
      s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
      hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
      s.head[s.ins_h] = s.strstart;
      /***/
    }

    /* Find the longest match, discarding those <= prev_length.
     */
    s.prev_length = s.match_length;
    s.prev_match = s.match_start;
    s.match_length = MIN_MATCH - 1;

    if (hash_head !== 0/*NIL*/ && s.prev_length < s.max_lazy_match &&
        s.strstart - hash_head <= (s.w_size - MIN_LOOKAHEAD)/*MAX_DIST(s)*/) {
      /* To simplify the code, we prevent matches with the string
       * of window index 0 (in particular we have to avoid a match
       * of the string with itself at the start of the input file).
       */
      s.match_length = longest_match(s, hash_head);
      /* longest_match() sets match_start */

      if (s.match_length <= 5 &&
         (s.strategy === Z_FILTERED || (s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096/*TOO_FAR*/))) {

        /* If prev_match is also MIN_MATCH, match_start is garbage
         * but we will ignore the current match anyway.
         */
        s.match_length = MIN_MATCH - 1;
      }
    }
    /* If there was a match at the previous step and the current
     * match is not better, output the previous match:
     */
    if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
      max_insert = s.strstart + s.lookahead - MIN_MATCH;
      /* Do not insert strings in hash table beyond this. */

      //check_match(s, s.strstart-1, s.prev_match, s.prev_length);

      /***_tr_tally_dist(s, s.strstart - 1 - s.prev_match,
                     s.prev_length - MIN_MATCH, bflush);***/
      bflush = _tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
      /* Insert in hash table all strings up to the end of the match.
       * strstart-1 and strstart are already inserted. If there is not
       * enough lookahead, the last two strings are not inserted in
       * the hash table.
       */
      s.lookahead -= s.prev_length - 1;
      s.prev_length -= 2;
      do {
        if (++s.strstart <= max_insert) {
          /*** INSERT_STRING(s, s.strstart, hash_head); ***/
          s.ins_h = HASH(s, s.ins_h, s.window[s.strstart + MIN_MATCH - 1]);
          hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
          s.head[s.ins_h] = s.strstart;
          /***/
        }
      } while (--s.prev_length !== 0);
      s.match_available = 0;
      s.match_length = MIN_MATCH - 1;
      s.strstart++;

      if (bflush) {
        /*** FLUSH_BLOCK(s, 0); ***/
        flush_block_only(s, false);
        if (s.strm.avail_out === 0) {
          return BS_NEED_MORE;
        }
        /***/
      }

    } else if (s.match_available) {
      /* If there was no match at the previous position, output a
       * single literal. If there was a match but the current match
       * is longer, truncate the previous match to a single literal.
       */
      //Tracevv((stderr,"%c", s->window[s->strstart-1]));
      /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);

      if (bflush) {
        /*** FLUSH_BLOCK_ONLY(s, 0) ***/
        flush_block_only(s, false);
        /***/
      }
      s.strstart++;
      s.lookahead--;
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
    } else {
      /* There is no previous match to compare with, wait for
       * the next step to decide.
       */
      s.match_available = 1;
      s.strstart++;
      s.lookahead--;
    }
  }
  //Assert (flush != Z_NO_FLUSH, "no flush?");
  if (s.match_available) {
    //Tracevv((stderr,"%c", s->window[s->strstart-1]));
    /*** _tr_tally_lit(s, s.window[s.strstart-1], bflush); ***/
    bflush = _tr_tally(s, 0, s.window[s.strstart - 1]);

    s.match_available = 0;
  }
  s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }

  return BS_BLOCK_DONE;
};


/* ===========================================================================
 * For Z_RLE, simply look for runs of bytes, generate matches only of distance
 * one.  Do not maintain a hash table.  (It will be regenerated if this run of
 * deflate switches away from Z_RLE.)
 */
const deflate_rle = (s, flush) => {

  let bflush;            /* set if current block must be flushed */
  let prev;              /* byte at distance one to match */
  let scan, strend;      /* scan goes up to strend for length of run */

  const _win = s.window;

  for (;;) {
    /* Make sure that we always have enough lookahead, except
     * at the end of the input file. We need MAX_MATCH bytes
     * for the longest run, plus one for the unrolled loop.
     */
    if (s.lookahead <= MAX_MATCH) {
      fill_window(s);
      if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
        return BS_NEED_MORE;
      }
      if (s.lookahead === 0) { break; } /* flush the current block */
    }

    /* See how many times the previous byte repeats */
    s.match_length = 0;
    if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
      scan = s.strstart - 1;
      prev = _win[scan];
      if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
        strend = s.strstart + MAX_MATCH;
        do {
          /*jshint noempty:false*/
        } while (prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 prev === _win[++scan] && prev === _win[++scan] &&
                 scan < strend);
        s.match_length = MAX_MATCH - (strend - scan);
        if (s.match_length > s.lookahead) {
          s.match_length = s.lookahead;
        }
      }
      //Assert(scan <= s->window+(uInt)(s->window_size-1), "wild scan");
    }

    /* Emit match if have run of MIN_MATCH or longer, else emit literal */
    if (s.match_length >= MIN_MATCH) {
      //check_match(s, s.strstart, s.strstart - 1, s.match_length);

      /*** _tr_tally_dist(s, 1, s.match_length - MIN_MATCH, bflush); ***/
      bflush = _tr_tally(s, 1, s.match_length - MIN_MATCH);

      s.lookahead -= s.match_length;
      s.strstart += s.match_length;
      s.match_length = 0;
    } else {
      /* No match, output a literal byte */
      //Tracevv((stderr,"%c", s->window[s->strstart]));
      /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
      bflush = _tr_tally(s, 0, s.window[s.strstart]);

      s.lookahead--;
      s.strstart++;
    }
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* ===========================================================================
 * For Z_HUFFMAN_ONLY, do not look for matches.  Do not maintain a hash table.
 * (It will be regenerated if this run of deflate switches away from Huffman.)
 */
const deflate_huff = (s, flush) => {

  let bflush;             /* set if current block must be flushed */

  for (;;) {
    /* Make sure that we have a literal to write. */
    if (s.lookahead === 0) {
      fill_window(s);
      if (s.lookahead === 0) {
        if (flush === Z_NO_FLUSH) {
          return BS_NEED_MORE;
        }
        break;      /* flush the current block */
      }
    }

    /* Output a literal byte */
    s.match_length = 0;
    //Tracevv((stderr,"%c", s->window[s->strstart]));
    /*** _tr_tally_lit(s, s.window[s.strstart], bflush); ***/
    bflush = _tr_tally(s, 0, s.window[s.strstart]);
    s.lookahead--;
    s.strstart++;
    if (bflush) {
      /*** FLUSH_BLOCK(s, 0); ***/
      flush_block_only(s, false);
      if (s.strm.avail_out === 0) {
        return BS_NEED_MORE;
      }
      /***/
    }
  }
  s.insert = 0;
  if (flush === Z_FINISH) {
    /*** FLUSH_BLOCK(s, 1); ***/
    flush_block_only(s, true);
    if (s.strm.avail_out === 0) {
      return BS_FINISH_STARTED;
    }
    /***/
    return BS_FINISH_DONE;
  }
  if (s.sym_next) {
    /*** FLUSH_BLOCK(s, 0); ***/
    flush_block_only(s, false);
    if (s.strm.avail_out === 0) {
      return BS_NEED_MORE;
    }
    /***/
  }
  return BS_BLOCK_DONE;
};

/* Values for max_lazy_match, good_match and max_chain_length, depending on
 * the desired pack level (0..9). The values given below have been tuned to
 * exclude worst case performance for pathological files. Better values may be
 * found for specific files.
 */
function Config(good_length, max_lazy, nice_length, max_chain, func) {

  this.good_length = good_length;
  this.max_lazy = max_lazy;
  this.nice_length = nice_length;
  this.max_chain = max_chain;
  this.func = func;
}

const configuration_table = [
  /*      good lazy nice chain */
  new Config(0, 0, 0, 0, deflate_stored),          /* 0 store only */
  new Config(4, 4, 8, 4, deflate_fast),            /* 1 max speed, no lazy matches */
  new Config(4, 5, 16, 8, deflate_fast),           /* 2 */
  new Config(4, 6, 32, 32, deflate_fast),          /* 3 */

  new Config(4, 4, 16, 16, deflate_slow),          /* 4 lazy matches */
  new Config(8, 16, 32, 32, deflate_slow),         /* 5 */
  new Config(8, 16, 128, 128, deflate_slow),       /* 6 */
  new Config(8, 32, 128, 256, deflate_slow),       /* 7 */
  new Config(32, 128, 258, 1024, deflate_slow),    /* 8 */
  new Config(32, 258, 258, 4096, deflate_slow)     /* 9 max compression */
];


/* ===========================================================================
 * Initialize the "longest match" routines for a new zlib stream
 */
const lm_init = (s) => {

  s.window_size = 2 * s.w_size;

  /*** CLEAR_HASH(s); ***/
  zero(s.head); // Fill with NIL (= 0);

  /* Set the default configuration parameters:
   */
  s.max_lazy_match = configuration_table[s.level].max_lazy;
  s.good_match = configuration_table[s.level].good_length;
  s.nice_match = configuration_table[s.level].nice_length;
  s.max_chain_length = configuration_table[s.level].max_chain;

  s.strstart = 0;
  s.block_start = 0;
  s.lookahead = 0;
  s.insert = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  s.ins_h = 0;
};


function DeflateState() {
  this.strm = null;            /* pointer back to this zlib stream */
  this.status = 0;            /* as the name implies */
  this.pending_buf = null;      /* output still pending */
  this.pending_buf_size = 0;  /* size of pending_buf */
  this.pending_out = 0;       /* next pending byte to output to the stream */
  this.pending = 0;           /* nb of bytes in the pending buffer */
  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip */
  this.gzhead = null;         /* gzip header information to write */
  this.gzindex = 0;           /* where in extra, name, or comment */
  this.method = Z_DEFLATED; /* can only be DEFLATED */
  this.last_flush = -1;   /* value of flush param for previous deflate call */

  this.w_size = 0;  /* LZ77 window size (32K by default) */
  this.w_bits = 0;  /* log2(w_size)  (8..16) */
  this.w_mask = 0;  /* w_size - 1 */

  this.window = null;
  /* Sliding window. Input bytes are read into the second half of the window,
   * and move to the first half later to keep a dictionary of at least wSize
   * bytes. With this organization, matches are limited to a distance of
   * wSize-MAX_MATCH bytes, but this ensures that IO is always
   * performed with a length multiple of the block size.
   */

  this.window_size = 0;
  /* Actual size of window: 2*wSize, except when the user input buffer
   * is directly used as sliding window.
   */

  this.prev = null;
  /* Link to older string with same hash index. To limit the size of this
   * array to 64K, this link is maintained only for the last 32K strings.
   * An index in this array is thus a window index modulo 32K.
   */

  this.head = null;   /* Heads of the hash chains or NIL. */

  this.ins_h = 0;       /* hash index of string to be inserted */
  this.hash_size = 0;   /* number of elements in hash table */
  this.hash_bits = 0;   /* log2(hash_size) */
  this.hash_mask = 0;   /* hash_size-1 */

  this.hash_shift = 0;
  /* Number of bits by which ins_h must be shifted at each input
   * step. It must be such that after MIN_MATCH steps, the oldest
   * byte no longer takes part in the hash key, that is:
   *   hash_shift * MIN_MATCH >= hash_bits
   */

  this.block_start = 0;
  /* Window position at the beginning of the current output block. Gets
   * negative when the window is moved backwards.
   */

  this.match_length = 0;      /* length of best match */
  this.prev_match = 0;        /* previous match */
  this.match_available = 0;   /* set if previous match exists */
  this.strstart = 0;          /* start of string to insert */
  this.match_start = 0;       /* start of matching string */
  this.lookahead = 0;         /* number of valid bytes ahead in window */

  this.prev_length = 0;
  /* Length of the best match at previous step. Matches not greater than this
   * are discarded. This is used in the lazy match evaluation.
   */

  this.max_chain_length = 0;
  /* To speed up deflation, hash chains are never searched beyond this
   * length.  A higher limit improves compression ratio but degrades the
   * speed.
   */

  this.max_lazy_match = 0;
  /* Attempt to find a better match only when the current match is strictly
   * smaller than this value. This mechanism is used only for compression
   * levels >= 4.
   */
  // That's alias to max_lazy_match, don't use directly
  //this.max_insert_length = 0;
  /* Insert new strings in the hash table only if the match length is not
   * greater than this length. This saves time but degrades compression.
   * max_insert_length is used only for compression levels <= 3.
   */

  this.level = 0;     /* compression level (1..9) */
  this.strategy = 0;  /* favor or force Huffman coding*/

  this.good_match = 0;
  /* Use a faster search when the previous match is longer than this */

  this.nice_match = 0; /* Stop searching when current match exceeds this */

              /* used by trees.c: */

  /* Didn't use ct_data typedef below to suppress compiler warning */

  // struct ct_data_s dyn_ltree[HEAP_SIZE];   /* literal and length tree */
  // struct ct_data_s dyn_dtree[2*D_CODES+1]; /* distance tree */
  // struct ct_data_s bl_tree[2*BL_CODES+1];  /* Huffman tree for bit lengths */

  // Use flat array of DOUBLE size, with interleaved fata,
  // because JS does not support effective
  this.dyn_ltree  = new Uint16Array(HEAP_SIZE * 2);
  this.dyn_dtree  = new Uint16Array((2 * D_CODES + 1) * 2);
  this.bl_tree    = new Uint16Array((2 * BL_CODES + 1) * 2);
  zero(this.dyn_ltree);
  zero(this.dyn_dtree);
  zero(this.bl_tree);

  this.l_desc   = null;         /* desc. for literal tree */
  this.d_desc   = null;         /* desc. for distance tree */
  this.bl_desc  = null;         /* desc. for bit length tree */

  //ush bl_count[MAX_BITS+1];
  this.bl_count = new Uint16Array(MAX_BITS + 1);
  /* number of codes at each bit length for an optimal tree */

  //int heap[2*L_CODES+1];      /* heap used to build the Huffman trees */
  this.heap = new Uint16Array(2 * L_CODES + 1);  /* heap used to build the Huffman trees */
  zero(this.heap);

  this.heap_len = 0;               /* number of elements in the heap */
  this.heap_max = 0;               /* element of largest frequency */
  /* The sons of heap[n] are heap[2*n] and heap[2*n+1]. heap[0] is not used.
   * The same heap array is used to build all trees.
   */

  this.depth = new Uint16Array(2 * L_CODES + 1); //uch depth[2*L_CODES+1];
  zero(this.depth);
  /* Depth of each subtree used as tie breaker for trees of equal frequency
   */

  this.sym_buf = 0;        /* buffer for distances and literals/lengths */

  this.lit_bufsize = 0;
  /* Size of match buffer for literals/lengths.  There are 4 reasons for
   * limiting lit_bufsize to 64K:
   *   - frequencies can be kept in 16 bit counters
   *   - if compression is not successful for the first block, all input
   *     data is still in the window so we can still emit a stored block even
   *     when input comes from standard input.  (This can also be done for
   *     all blocks if lit_bufsize is not greater than 32K.)
   *   - if compression is not successful for a file smaller than 64K, we can
   *     even emit a stored file instead of a stored block (saving 5 bytes).
   *     This is applicable only for zip (not gzip or zlib).
   *   - creating new Huffman trees less frequently may not provide fast
   *     adaptation to changes in the input data statistics. (Take for
   *     example a binary file with poorly compressible code followed by
   *     a highly compressible string table.) Smaller buffer sizes give
   *     fast adaptation but have of course the overhead of transmitting
   *     trees more frequently.
   *   - I can't count above 4
   */

  this.sym_next = 0;      /* running index in sym_buf */
  this.sym_end = 0;       /* symbol table full when sym_next reaches this */

  this.opt_len = 0;       /* bit length of current block with optimal trees */
  this.static_len = 0;    /* bit length of current block with static trees */
  this.matches = 0;       /* number of string matches in current block */
  this.insert = 0;        /* bytes at end of window left to insert */


  this.bi_buf = 0;
  /* Output buffer. bits are inserted starting at the bottom (least
   * significant bits).
   */
  this.bi_valid = 0;
  /* Number of valid bits in bi_buf.  All bits above the last valid bit
   * are always zero.
   */

  // Used for window memory init. We safely ignore it for JS. That makes
  // sense only for pointers and memory check tools.
  //this.high_water = 0;
  /* High water mark offset in window for initialized bytes -- bytes above
   * this are set to zero in order to avoid memory check warnings when
   * longest match routines access bytes past the input.  This is then
   * updated to the new high water mark.
   */
}


/* =========================================================================
 * Check for a valid deflate stream state. Return 0 if ok, 1 if not.
 */
const deflateStateCheck = (strm) => {

  if (!strm) {
    return 1;
  }
  const s = strm.state;
  if (!s || s.strm !== strm || (s.status !== INIT_STATE &&
//#ifdef GZIP
                                s.status !== GZIP_STATE &&
//#endif
                                s.status !== EXTRA_STATE &&
                                s.status !== NAME_STATE &&
                                s.status !== COMMENT_STATE &&
                                s.status !== HCRC_STATE &&
                                s.status !== BUSY_STATE &&
                                s.status !== FINISH_STATE)) {
    return 1;
  }
  return 0;
};


const deflateResetKeep = (strm) => {

  if (deflateStateCheck(strm)) {
    return err(strm, Z_STREAM_ERROR);
  }

  strm.total_in = strm.total_out = 0;
  strm.data_type = Z_UNKNOWN;

  const s = strm.state;
  s.pending = 0;
  s.pending_out = 0;

  if (s.wrap < 0) {
    s.wrap = -s.wrap;
    /* was made negative by deflate(..., Z_FINISH); */
  }
  s.status =
//#ifdef GZIP
    s.wrap === 2 ? GZIP_STATE :
//#endif
    s.wrap ? INIT_STATE : BUSY_STATE;
  strm.adler = (s.wrap === 2) ?
    0  // crc32(0, Z_NULL, 0)
  :
    1; // adler32(0, Z_NULL, 0)
  s.last_flush = -2;
  _tr_init(s);
  return Z_OK;
};


const deflateReset = (strm) => {

  const ret = deflateResetKeep(strm);
  if (ret === Z_OK) {
    lm_init(strm.state);
  }
  return ret;
};


const deflateSetHeader = (strm, head) => {

  if (deflateStateCheck(strm) || strm.state.wrap !== 2) {
    return Z_STREAM_ERROR;
  }
  strm.state.gzhead = head;
  return Z_OK;
};


const deflateInit2 = (strm, level, method, windowBits, memLevel, strategy) => {

  if (!strm) { // === Z_NULL
    return Z_STREAM_ERROR;
  }
  let wrap = 1;

  if (level === Z_DEFAULT_COMPRESSION) {
    level = 6;
  }

  if (windowBits < 0) { /* suppress zlib wrapper */
    wrap = 0;
    windowBits = -windowBits;
  }

  else if (windowBits > 15) {
    wrap = 2;           /* write gzip wrapper instead */
    windowBits -= 16;
  }


  if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED ||
    windowBits < 8 || windowBits > 15 || level < 0 || level > 9 ||
    strategy < 0 || strategy > Z_FIXED || (windowBits === 8 && wrap !== 1)) {
    return err(strm, Z_STREAM_ERROR);
  }


  if (windowBits === 8) {
    windowBits = 9;
  }
  /* until 256-byte window bug fixed */

  const s = new DeflateState();

  strm.state = s;
  s.strm = strm;
  s.status = INIT_STATE;     /* to pass state test in deflateReset() */

  s.wrap = wrap;
  s.gzhead = null;
  s.w_bits = windowBits;
  s.w_size = 1 << s.w_bits;
  s.w_mask = s.w_size - 1;

  s.hash_bits = memLevel + 7;
  s.hash_size = 1 << s.hash_bits;
  s.hash_mask = s.hash_size - 1;
  s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);

  s.window = new Uint8Array(s.w_size * 2);
  s.head = new Uint16Array(s.hash_size);
  s.prev = new Uint16Array(s.w_size);

  // Don't need mem init magic for JS.
  //s.high_water = 0;  /* nothing written to s->window yet */

  s.lit_bufsize = 1 << (memLevel + 6); /* 16K elements by default */

  /* We overlay pending_buf and sym_buf. This works since the average size
   * for length/distance pairs over any compressed block is assured to be 31
   * bits or less.
   *
   * Analysis: The longest fixed codes are a length code of 8 bits plus 5
   * extra bits, for lengths 131 to 257. The longest fixed distance codes are
   * 5 bits plus 13 extra bits, for distances 16385 to 32768. The longest
   * possible fixed-codes length/distance pair is then 31 bits total.
   *
   * sym_buf starts one-fourth of the way into pending_buf. So there are
   * three bytes in sym_buf for every four bytes in pending_buf. Each symbol
   * in sym_buf is three bytes -- two for the distance and one for the
   * literal/length. As each symbol is consumed, the pointer to the next
   * sym_buf value to read moves forward three bytes. From that symbol, up to
   * 31 bits are written to pending_buf. The closest the written pending_buf
   * bits gets to the next sym_buf symbol to read is just before the last
   * code is written. At that time, 31*(n-2) bits have been written, just
   * after 24*(n-2) bits have been consumed from sym_buf. sym_buf starts at
   * 8*n bits into pending_buf. (Note that the symbol buffer fills when n-1
   * symbols are written.) The closest the writing gets to what is unread is
   * then n+14 bits. Here n is lit_bufsize, which is 16384 by default, and
   * can range from 128 to 32768.
   *
   * Therefore, at a minimum, there are 142 bits of space between what is
   * written and what is read in the overlain buffers, so the symbols cannot
   * be overwritten by the compressed data. That space is actually 139 bits,
   * due to the three-bit fixed-code block header.
   *
   * That covers the case where either Z_FIXED is specified, forcing fixed
   * codes, or when the use of fixed codes is chosen, because that choice
   * results in a smaller compressed block than dynamic codes. That latter
   * condition then assures that the above analysis also covers all dynamic
   * blocks. A dynamic-code block will only be chosen to be emitted if it has
   * fewer bits than a fixed-code block would for the same set of symbols.
   * Therefore its average symbol length is assured to be less than 31. So
   * the compressed data for a dynamic block also cannot overwrite the
   * symbols from which it is being constructed.
   */

  s.pending_buf_size = s.lit_bufsize * 4;
  s.pending_buf = new Uint8Array(s.pending_buf_size);

  // It is offset from `s.pending_buf` (size is `s.lit_bufsize * 2`)
  //s->sym_buf = s->pending_buf + s->lit_bufsize;
  s.sym_buf = s.lit_bufsize;

  //s->sym_end = (s->lit_bufsize - 1) * 3;
  s.sym_end = (s.lit_bufsize - 1) * 3;
  /* We avoid equality with lit_bufsize*3 because of wraparound at 64K
   * on 16 bit machines and because stored blocks are restricted to
   * 64K-1 bytes.
   */

  s.level = level;
  s.strategy = strategy;
  s.method = method;

  return deflateReset(strm);
};

const deflateInit = (strm, level) => {

  return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
};


/* ========================================================================= */
const deflate = (strm, flush) => {

  if (deflateStateCheck(strm) || flush > Z_BLOCK || flush < 0) {
    return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
  }

  const s = strm.state;

  if (!strm.output ||
      (strm.avail_in !== 0 && !strm.input) ||
      (s.status === FINISH_STATE && flush !== Z_FINISH)) {
    return err(strm, (strm.avail_out === 0) ? Z_BUF_ERROR : Z_STREAM_ERROR);
  }

  const old_flush = s.last_flush;
  s.last_flush = flush;

  /* Flush as much pending output as possible */
  if (s.pending !== 0) {
    flush_pending(strm);
    if (strm.avail_out === 0) {
      /* Since avail_out is 0, deflate will be called again with
       * more output space, but possibly with both pending and
       * avail_in equal to zero. There won't be anything to do,
       * but this is not an error situation so make sure we
       * return OK instead of BUF_ERROR at next call of deflate:
       */
      s.last_flush = -1;
      return Z_OK;
    }

    /* Make sure there is something to do and avoid duplicate consecutive
     * flushes. For repeated and useless calls with Z_FINISH, we keep
     * returning Z_STREAM_END instead of Z_BUF_ERROR.
     */
  } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) &&
    flush !== Z_FINISH) {
    return err(strm, Z_BUF_ERROR);
  }

  /* User must not provide more input after the first FINISH: */
  if (s.status === FINISH_STATE && strm.avail_in !== 0) {
    return err(strm, Z_BUF_ERROR);
  }

  /* Write the header */
  if (s.status === INIT_STATE && s.wrap === 0) {
    s.status = BUSY_STATE;
  }
  if (s.status === INIT_STATE) {
    /* zlib header */
    let header = (Z_DEFLATED + ((s.w_bits - 8) << 4)) << 8;
    let level_flags = -1;

    if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
      level_flags = 0;
    } else if (s.level < 6) {
      level_flags = 1;
    } else if (s.level === 6) {
      level_flags = 2;
    } else {
      level_flags = 3;
    }
    header |= (level_flags << 6);
    if (s.strstart !== 0) { header |= PRESET_DICT; }
    header += 31 - (header % 31);

    putShortMSB(s, header);

    /* Save the adler32 of the preset dictionary: */
    if (s.strstart !== 0) {
      putShortMSB(s, strm.adler >>> 16);
      putShortMSB(s, strm.adler & 0xffff);
    }
    strm.adler = 1; // adler32(0L, Z_NULL, 0);
    s.status = BUSY_STATE;

    /* Compression must start with an empty pending buffer */
    flush_pending(strm);
    if (s.pending !== 0) {
      s.last_flush = -1;
      return Z_OK;
    }
  }
//#ifdef GZIP
  if (s.status === GZIP_STATE) {
    /* gzip header */
    strm.adler = 0;  //crc32(0L, Z_NULL, 0);
    put_byte(s, 31);
    put_byte(s, 139);
    put_byte(s, 8);
    if (!s.gzhead) { // s->gzhead == Z_NULL
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, 0);
      put_byte(s, s.level === 9 ? 2 :
                  (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
                   4 : 0));
      put_byte(s, OS_CODE);
      s.status = BUSY_STATE;

      /* Compression must start with an empty pending buffer */
      flush_pending(strm);
      if (s.pending !== 0) {
        s.last_flush = -1;
        return Z_OK;
      }
    }
    else {
      put_byte(s, (s.gzhead.text ? 1 : 0) +
                  (s.gzhead.hcrc ? 2 : 0) +
                  (!s.gzhead.extra ? 0 : 4) +
                  (!s.gzhead.name ? 0 : 8) +
                  (!s.gzhead.comment ? 0 : 16)
      );
      put_byte(s, s.gzhead.time & 0xff);
      put_byte(s, (s.gzhead.time >> 8) & 0xff);
      put_byte(s, (s.gzhead.time >> 16) & 0xff);
      put_byte(s, (s.gzhead.time >> 24) & 0xff);
      put_byte(s, s.level === 9 ? 2 :
                  (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ?
                   4 : 0));
      put_byte(s, s.gzhead.os & 0xff);
      if (s.gzhead.extra && s.gzhead.extra.length) {
        put_byte(s, s.gzhead.extra.length & 0xff);
        put_byte(s, (s.gzhead.extra.length >> 8) & 0xff);
      }
      if (s.gzhead.hcrc) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending, 0);
      }
      s.gzindex = 0;
      s.status = EXTRA_STATE;
    }
  }
  if (s.status === EXTRA_STATE) {
    if (s.gzhead.extra/* != Z_NULL*/) {
      let beg = s.pending;   /* start of bytes to update crc */
      let left = (s.gzhead.extra.length & 0xffff) - s.gzindex;
      while (s.pending + left > s.pending_buf_size) {
        let copy = s.pending_buf_size - s.pending;
        // zmemcpy(s.pending_buf + s.pending,
        //    s.gzhead.extra + s.gzindex, copy);
        s.pending_buf.set(s.gzhead.extra.subarray(s.gzindex, s.gzindex + copy), s.pending);
        s.pending = s.pending_buf_size;
        //--- HCRC_UPDATE(beg) ---//
        if (s.gzhead.hcrc && s.pending > beg) {
          strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
        }
        //---//
        s.gzindex += copy;
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK;
        }
        beg = 0;
        left -= copy;
      }
      // JS specific: s.gzhead.extra may be TypedArray or Array for backward compatibility
      //              TypedArray.slice and TypedArray.from don't exist in IE10-IE11
      let gzhead_extra = new Uint8Array(s.gzhead.extra);
      // zmemcpy(s->pending_buf + s->pending,
      //     s->gzhead->extra + s->gzindex, left);
      s.pending_buf.set(gzhead_extra.subarray(s.gzindex, s.gzindex + left), s.pending);
      s.pending += left;
      //--- HCRC_UPDATE(beg) ---//
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      //---//
      s.gzindex = 0;
    }
    s.status = NAME_STATE;
  }
  if (s.status === NAME_STATE) {
    if (s.gzhead.name/* != Z_NULL*/) {
      let beg = s.pending;   /* start of bytes to update crc */
      let val;
      do {
        if (s.pending === s.pending_buf_size) {
          //--- HCRC_UPDATE(beg) ---//
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          //---//
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK;
          }
          beg = 0;
        }
        // JS specific: little magic to add zero terminator to end of string
        if (s.gzindex < s.gzhead.name.length) {
          val = s.gzhead.name.charCodeAt(s.gzindex++) & 0xff;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);
      //--- HCRC_UPDATE(beg) ---//
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      //---//
      s.gzindex = 0;
    }
    s.status = COMMENT_STATE;
  }
  if (s.status === COMMENT_STATE) {
    if (s.gzhead.comment/* != Z_NULL*/) {
      let beg = s.pending;   /* start of bytes to update crc */
      let val;
      do {
        if (s.pending === s.pending_buf_size) {
          //--- HCRC_UPDATE(beg) ---//
          if (s.gzhead.hcrc && s.pending > beg) {
            strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
          }
          //---//
          flush_pending(strm);
          if (s.pending !== 0) {
            s.last_flush = -1;
            return Z_OK;
          }
          beg = 0;
        }
        // JS specific: little magic to add zero terminator to end of string
        if (s.gzindex < s.gzhead.comment.length) {
          val = s.gzhead.comment.charCodeAt(s.gzindex++) & 0xff;
        } else {
          val = 0;
        }
        put_byte(s, val);
      } while (val !== 0);
      //--- HCRC_UPDATE(beg) ---//
      if (s.gzhead.hcrc && s.pending > beg) {
        strm.adler = crc32(strm.adler, s.pending_buf, s.pending - beg, beg);
      }
      //---//
    }
    s.status = HCRC_STATE;
  }
  if (s.status === HCRC_STATE) {
    if (s.gzhead.hcrc) {
      if (s.pending + 2 > s.pending_buf_size) {
        flush_pending(strm);
        if (s.pending !== 0) {
          s.last_flush = -1;
          return Z_OK;
        }
      }
      put_byte(s, strm.adler & 0xff);
      put_byte(s, (strm.adler >> 8) & 0xff);
      strm.adler = 0; //crc32(0L, Z_NULL, 0);
    }
    s.status = BUSY_STATE;

    /* Compression must start with an empty pending buffer */
    flush_pending(strm);
    if (s.pending !== 0) {
      s.last_flush = -1;
      return Z_OK;
    }
  }
//#endif

  /* Start a new block or continue the current one.
   */
  if (strm.avail_in !== 0 || s.lookahead !== 0 ||
    (flush !== Z_NO_FLUSH && s.status !== FINISH_STATE)) {
    let bstate = s.level === 0 ? deflate_stored(s, flush) :
                 s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) :
                 s.strategy === Z_RLE ? deflate_rle(s, flush) :
                 configuration_table[s.level].func(s, flush);

    if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
      s.status = FINISH_STATE;
    }
    if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
      if (strm.avail_out === 0) {
        s.last_flush = -1;
        /* avoid BUF_ERROR next call, see above */
      }
      return Z_OK;
      /* If flush != Z_NO_FLUSH && avail_out == 0, the next call
       * of deflate should use the same flush parameter to make sure
       * that the flush is complete. So we don't have to output an
       * empty block here, this will be done at next call. This also
       * ensures that for a very small output buffer, we emit at most
       * one empty block.
       */
    }
    if (bstate === BS_BLOCK_DONE) {
      if (flush === Z_PARTIAL_FLUSH) {
        _tr_align(s);
      }
      else if (flush !== Z_BLOCK) { /* FULL_FLUSH or SYNC_FLUSH */

        _tr_stored_block(s, 0, 0, false);
        /* For a full flush, this empty block will be recognized
         * as a special marker by inflate_sync().
         */
        if (flush === Z_FULL_FLUSH) {
          /*** CLEAR_HASH(s); ***/             /* forget history */
          zero(s.head); // Fill with NIL (= 0);

          if (s.lookahead === 0) {
            s.strstart = 0;
            s.block_start = 0;
            s.insert = 0;
          }
        }
      }
      flush_pending(strm);
      if (strm.avail_out === 0) {
        s.last_flush = -1; /* avoid BUF_ERROR at next call, see above */
        return Z_OK;
      }
    }
  }

  if (flush !== Z_FINISH) { return Z_OK; }
  if (s.wrap <= 0) { return Z_STREAM_END; }

  /* Write the trailer */
  if (s.wrap === 2) {
    put_byte(s, strm.adler & 0xff);
    put_byte(s, (strm.adler >> 8) & 0xff);
    put_byte(s, (strm.adler >> 16) & 0xff);
    put_byte(s, (strm.adler >> 24) & 0xff);
    put_byte(s, strm.total_in & 0xff);
    put_byte(s, (strm.total_in >> 8) & 0xff);
    put_byte(s, (strm.total_in >> 16) & 0xff);
    put_byte(s, (strm.total_in >> 24) & 0xff);
  }
  else
  {
    putShortMSB(s, strm.adler >>> 16);
    putShortMSB(s, strm.adler & 0xffff);
  }

  flush_pending(strm);
  /* If avail_out is zero, the application will call deflate again
   * to flush the rest.
   */
  if (s.wrap > 0) { s.wrap = -s.wrap; }
  /* write the trailer only once! */
  return s.pending !== 0 ? Z_OK : Z_STREAM_END;
};


const deflateEnd = (strm) => {

  if (deflateStateCheck(strm)) {
    return Z_STREAM_ERROR;
  }

  const status = strm.state.status;

  strm.state = null;

  return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
};


/* =========================================================================
 * Initializes the compression dictionary from the given byte
 * sequence without producing any compressed output.
 */
const deflateSetDictionary = (strm, dictionary) => {

  let dictLength = dictionary.length;

  if (deflateStateCheck(strm)) {
    return Z_STREAM_ERROR;
  }

  const s = strm.state;
  const wrap = s.wrap;

  if (wrap === 2 || (wrap === 1 && s.status !== INIT_STATE) || s.lookahead) {
    return Z_STREAM_ERROR;
  }

  /* when using zlib wrappers, compute Adler-32 for provided dictionary */
  if (wrap === 1) {
    /* adler32(strm->adler, dictionary, dictLength); */
    strm.adler = adler32(strm.adler, dictionary, dictLength, 0);
  }

  s.wrap = 0;   /* avoid computing Adler-32 in read_buf */

  /* if dictionary would fill window, just replace the history */
  if (dictLength >= s.w_size) {
    if (wrap === 0) {            /* already empty otherwise */
      /*** CLEAR_HASH(s); ***/
      zero(s.head); // Fill with NIL (= 0);
      s.strstart = 0;
      s.block_start = 0;
      s.insert = 0;
    }
    /* use the tail */
    // dictionary = dictionary.slice(dictLength - s.w_size);
    let tmpDict = new Uint8Array(s.w_size);
    tmpDict.set(dictionary.subarray(dictLength - s.w_size, dictLength), 0);
    dictionary = tmpDict;
    dictLength = s.w_size;
  }
  /* insert dictionary into window and hash */
  const avail = strm.avail_in;
  const next = strm.next_in;
  const input = strm.input;
  strm.avail_in = dictLength;
  strm.next_in = 0;
  strm.input = dictionary;
  fill_window(s);
  while (s.lookahead >= MIN_MATCH) {
    let str = s.strstart;
    let n = s.lookahead - (MIN_MATCH - 1);
    do {
      /* UPDATE_HASH(s, s->ins_h, s->window[str + MIN_MATCH-1]); */
      s.ins_h = HASH(s, s.ins_h, s.window[str + MIN_MATCH - 1]);

      s.prev[str & s.w_mask] = s.head[s.ins_h];

      s.head[s.ins_h] = str;
      str++;
    } while (--n);
    s.strstart = str;
    s.lookahead = MIN_MATCH - 1;
    fill_window(s);
  }
  s.strstart += s.lookahead;
  s.block_start = s.strstart;
  s.insert = s.lookahead;
  s.lookahead = 0;
  s.match_length = s.prev_length = MIN_MATCH - 1;
  s.match_available = 0;
  strm.next_in = next;
  strm.input = input;
  strm.avail_in = avail;
  s.wrap = wrap;
  return Z_OK;
};


module.exports.deflateInit = deflateInit;
module.exports.deflateInit2 = deflateInit2;
module.exports.deflateReset = deflateReset;
module.exports.deflateResetKeep = deflateResetKeep;
module.exports.deflateSetHeader = deflateSetHeader;
module.exports.deflate = deflate;
module.exports.deflateEnd = deflateEnd;
module.exports.deflateSetDictionary = deflateSetDictionary;
module.exports.deflateInfo = 'pako deflate (from Nodeca project)';

/* Not implemented
module.exports.deflateBound = deflateBound;
module.exports.deflateCopy = deflateCopy;
module.exports.deflateGetDictionary = deflateGetDictionary;
module.exports.deflateParams = deflateParams;
module.exports.deflatePending = deflatePending;
module.exports.deflatePrime = deflatePrime;
module.exports.deflateTune = deflateTune;
*/

},{"./adler32":25,"./constants":26,"./crc32":27,"./messages":33,"./trees":34}],29:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

function GZheader() {
  /* true if compressed data believed to be text */
  this.text       = 0;
  /* modification time */
  this.time       = 0;
  /* extra flags (not used when writing a gzip file) */
  this.xflags     = 0;
  /* operating system */
  this.os         = 0;
  /* pointer to extra field or Z_NULL if none */
  this.extra      = null;
  /* extra field length (valid if extra != Z_NULL) */
  this.extra_len  = 0; // Actually, we don't need it in JS,
                       // but leave for few code modifications

  //
  // Setup limits is not necessary because in js we should not preallocate memory
  // for inflate use constant limit in 65536 bytes
  //

  /* space at extra (only when reading header) */
  // this.extra_max  = 0;
  /* pointer to zero-terminated file name or Z_NULL */
  this.name       = '';
  /* space at name (only when reading header) */
  // this.name_max   = 0;
  /* pointer to zero-terminated comment or Z_NULL */
  this.comment    = '';
  /* space at comment (only when reading header) */
  // this.comm_max   = 0;
  /* true if there was or will be a header crc */
  this.hcrc       = 0;
  /* true when done reading gzip header (not used when writing a gzip file) */
  this.done       = false;
}

module.exports = GZheader;

},{}],30:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

// See state defs from inflate.js
const BAD = 16209;       /* got a data error -- remain here until reset */
const TYPE = 16191;      /* i: waiting for type bits, including last-flag bit */

/*
   Decode literal, length, and distance codes and write out the resulting
   literal and match bytes until either not enough input or output is
   available, an end-of-block is encountered, or a data error is encountered.
   When large enough input and output buffers are supplied to inflate(), for
   example, a 16K input buffer and a 64K output buffer, more than 95% of the
   inflate execution time is spent in this routine.

   Entry assumptions:

        state.mode === LEN
        strm.avail_in >= 6
        strm.avail_out >= 258
        start >= strm.avail_out
        state.bits < 8

   On return, state.mode is one of:

        LEN -- ran out of enough output space or enough available input
        TYPE -- reached end of block code, inflate() to interpret next block
        BAD -- error in block data

   Notes:

    - The maximum input bits used by a length/distance pair is 15 bits for the
      length code, 5 bits for the length extra, 15 bits for the distance code,
      and 13 bits for the distance extra.  This totals 48 bits, or six bytes.
      Therefore if strm.avail_in >= 6, then there is enough input to avoid
      checking for available input while decoding.

    - The maximum bytes that a single length/distance pair can output is 258
      bytes, which is the maximum length that can be coded.  inflate_fast()
      requires strm.avail_out >= 258 for each loop to avoid checking for
      output space.
 */
module.exports = function inflate_fast(strm, start) {
  let _in;                    /* local strm.input */
  let last;                   /* have enough input while in < last */
  let _out;                   /* local strm.output */
  let beg;                    /* inflate()'s initial strm.output */
  let end;                    /* while out < end, enough space available */
//#ifdef INFLATE_STRICT
  let dmax;                   /* maximum distance from zlib header */
//#endif
  let wsize;                  /* window size or zero if not using window */
  let whave;                  /* valid bytes in the window */
  let wnext;                  /* window write index */
  // Use `s_window` instead `window`, avoid conflict with instrumentation tools
  let s_window;               /* allocated sliding window, if wsize != 0 */
  let hold;                   /* local strm.hold */
  let bits;                   /* local strm.bits */
  let lcode;                  /* local strm.lencode */
  let dcode;                  /* local strm.distcode */
  let lmask;                  /* mask for first level of length codes */
  let dmask;                  /* mask for first level of distance codes */
  let here;                   /* retrieved table entry */
  let op;                     /* code bits, operation, extra bits, or */
                              /*  window position, window bytes to copy */
  let len;                    /* match length, unused bytes */
  let dist;                   /* match distance */
  let from;                   /* where to copy match from */
  let from_source;


  let input, output; // JS specific, because we have no pointers

  /* copy state to local variables */
  const state = strm.state;
  //here = state.here;
  _in = strm.next_in;
  input = strm.input;
  last = _in + (strm.avail_in - 5);
  _out = strm.next_out;
  output = strm.output;
  beg = _out - (start - strm.avail_out);
  end = _out + (strm.avail_out - 257);
//#ifdef INFLATE_STRICT
  dmax = state.dmax;
//#endif
  wsize = state.wsize;
  whave = state.whave;
  wnext = state.wnext;
  s_window = state.window;
  hold = state.hold;
  bits = state.bits;
  lcode = state.lencode;
  dcode = state.distcode;
  lmask = (1 << state.lenbits) - 1;
  dmask = (1 << state.distbits) - 1;


  /* decode literals and length/distances until end-of-block or not enough
     input data or output space */

  top:
  do {
    if (bits < 15) {
      hold += input[_in++] << bits;
      bits += 8;
      hold += input[_in++] << bits;
      bits += 8;
    }

    here = lcode[hold & lmask];

    dolen:
    for (;;) { // Goto emulation
      op = here >>> 24/*here.bits*/;
      hold >>>= op;
      bits -= op;
      op = (here >>> 16) & 0xff/*here.op*/;
      if (op === 0) {                          /* literal */
        //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
        //        "inflate:         literal '%c'\n" :
        //        "inflate:         literal 0x%02x\n", here.val));
        output[_out++] = here & 0xffff/*here.val*/;
      }
      else if (op & 16) {                     /* length base */
        len = here & 0xffff/*here.val*/;
        op &= 15;                           /* number of extra bits */
        if (op) {
          if (bits < op) {
            hold += input[_in++] << bits;
            bits += 8;
          }
          len += hold & ((1 << op) - 1);
          hold >>>= op;
          bits -= op;
        }
        //Tracevv((stderr, "inflate:         length %u\n", len));
        if (bits < 15) {
          hold += input[_in++] << bits;
          bits += 8;
          hold += input[_in++] << bits;
          bits += 8;
        }
        here = dcode[hold & dmask];

        dodist:
        for (;;) { // goto emulation
          op = here >>> 24/*here.bits*/;
          hold >>>= op;
          bits -= op;
          op = (here >>> 16) & 0xff/*here.op*/;

          if (op & 16) {                      /* distance base */
            dist = here & 0xffff/*here.val*/;
            op &= 15;                       /* number of extra bits */
            if (bits < op) {
              hold += input[_in++] << bits;
              bits += 8;
              if (bits < op) {
                hold += input[_in++] << bits;
                bits += 8;
              }
            }
            dist += hold & ((1 << op) - 1);
//#ifdef INFLATE_STRICT
            if (dist > dmax) {
              strm.msg = 'invalid distance too far back';
              state.mode = BAD;
              break top;
            }
//#endif
            hold >>>= op;
            bits -= op;
            //Tracevv((stderr, "inflate:         distance %u\n", dist));
            op = _out - beg;                /* max distance in output */
            if (dist > op) {                /* see if copy from window */
              op = dist - op;               /* distance back in window */
              if (op > whave) {
                if (state.sane) {
                  strm.msg = 'invalid distance too far back';
                  state.mode = BAD;
                  break top;
                }

// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility
//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//                if (len <= op - whave) {
//                  do {
//                    output[_out++] = 0;
//                  } while (--len);
//                  continue top;
//                }
//                len -= op - whave;
//                do {
//                  output[_out++] = 0;
//                } while (--op > whave);
//                if (op === 0) {
//                  from = _out - dist;
//                  do {
//                    output[_out++] = output[from++];
//                  } while (--len);
//                  continue top;
//                }
//#endif
              }
              from = 0; // window index
              from_source = s_window;
              if (wnext === 0) {           /* very common case */
                from += wsize - op;
                if (op < len) {         /* some from window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = _out - dist;  /* rest from output */
                  from_source = output;
                }
              }
              else if (wnext < op) {      /* wrap around window */
                from += wsize + wnext - op;
                op -= wnext;
                if (op < len) {         /* some from end of window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = 0;
                  if (wnext < len) {  /* some from start of window */
                    op = wnext;
                    len -= op;
                    do {
                      output[_out++] = s_window[from++];
                    } while (--op);
                    from = _out - dist;      /* rest from output */
                    from_source = output;
                  }
                }
              }
              else {                      /* contiguous in window */
                from += wnext - op;
                if (op < len) {         /* some from window */
                  len -= op;
                  do {
                    output[_out++] = s_window[from++];
                  } while (--op);
                  from = _out - dist;  /* rest from output */
                  from_source = output;
                }
              }
              while (len > 2) {
                output[_out++] = from_source[from++];
                output[_out++] = from_source[from++];
                output[_out++] = from_source[from++];
                len -= 3;
              }
              if (len) {
                output[_out++] = from_source[from++];
                if (len > 1) {
                  output[_out++] = from_source[from++];
                }
              }
            }
            else {
              from = _out - dist;          /* copy direct from output */
              do {                        /* minimum length is three */
                output[_out++] = output[from++];
                output[_out++] = output[from++];
                output[_out++] = output[from++];
                len -= 3;
              } while (len > 2);
              if (len) {
                output[_out++] = output[from++];
                if (len > 1) {
                  output[_out++] = output[from++];
                }
              }
            }
          }
          else if ((op & 64) === 0) {          /* 2nd level distance code */
            here = dcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
            continue dodist;
          }
          else {
            strm.msg = 'invalid distance code';
            state.mode = BAD;
            break top;
          }

          break; // need to emulate goto via "continue"
        }
      }
      else if ((op & 64) === 0) {              /* 2nd level length code */
        here = lcode[(here & 0xffff)/*here.val*/ + (hold & ((1 << op) - 1))];
        continue dolen;
      }
      else if (op & 32) {                     /* end-of-block */
        //Tracevv((stderr, "inflate:         end of block\n"));
        state.mode = TYPE;
        break top;
      }
      else {
        strm.msg = 'invalid literal/length code';
        state.mode = BAD;
        break top;
      }

      break; // need to emulate goto via "continue"
    }
  } while (_in < last && _out < end);

  /* return unused bytes (on entry, bits < 8, so in won't go too far back) */
  len = bits >> 3;
  _in -= len;
  bits -= len << 3;
  hold &= (1 << bits) - 1;

  /* update state and return */
  strm.next_in = _in;
  strm.next_out = _out;
  strm.avail_in = (_in < last ? 5 + (last - _in) : 5 - (_in - last));
  strm.avail_out = (_out < end ? 257 + (end - _out) : 257 - (_out - end));
  state.hold = hold;
  state.bits = bits;
  return;
};

},{}],31:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const adler32       = require('./adler32');
const crc32         = require('./crc32');
const inflate_fast  = require('./inffast');
const inflate_table = require('./inftrees');

const CODES = 0;
const LENS = 1;
const DISTS = 2;

/* Public constants ==========================================================*/
/* ===========================================================================*/

const {
  Z_FINISH, Z_BLOCK, Z_TREES,
  Z_OK, Z_STREAM_END, Z_NEED_DICT, Z_STREAM_ERROR, Z_DATA_ERROR, Z_MEM_ERROR, Z_BUF_ERROR,
  Z_DEFLATED
} = require('./constants');


/* STATES ====================================================================*/
/* ===========================================================================*/


const    HEAD = 16180;       /* i: waiting for magic header */
const    FLAGS = 16181;      /* i: waiting for method and flags (gzip) */
const    TIME = 16182;       /* i: waiting for modification time (gzip) */
const    OS = 16183;         /* i: waiting for extra flags and operating system (gzip) */
const    EXLEN = 16184;      /* i: waiting for extra length (gzip) */
const    EXTRA = 16185;      /* i: waiting for extra bytes (gzip) */
const    NAME = 16186;       /* i: waiting for end of file name (gzip) */
const    COMMENT = 16187;    /* i: waiting for end of comment (gzip) */
const    HCRC = 16188;       /* i: waiting for header crc (gzip) */
const    DICTID = 16189;    /* i: waiting for dictionary check value */
const    DICT = 16190;      /* waiting for inflateSetDictionary() call */
const        TYPE = 16191;      /* i: waiting for type bits, including last-flag bit */
const        TYPEDO = 16192;    /* i: same, but skip check to exit inflate on new block */
const        STORED = 16193;    /* i: waiting for stored size (length and complement) */
const        COPY_ = 16194;     /* i/o: same as COPY below, but only first time in */
const        COPY = 16195;      /* i/o: waiting for input or output to copy stored block */
const        TABLE = 16196;     /* i: waiting for dynamic block table lengths */
const        LENLENS = 16197;   /* i: waiting for code length code lengths */
const        CODELENS = 16198;  /* i: waiting for length/lit and distance code lengths */
const            LEN_ = 16199;      /* i: same as LEN below, but only first time in */
const            LEN = 16200;       /* i: waiting for length/lit/eob code */
const            LENEXT = 16201;    /* i: waiting for length extra bits */
const            DIST = 16202;      /* i: waiting for distance code */
const            DISTEXT = 16203;   /* i: waiting for distance extra bits */
const            MATCH = 16204;     /* o: waiting for output space to copy string */
const            LIT = 16205;       /* o: waiting for output space to write literal */
const    CHECK = 16206;     /* i: waiting for 32-bit check value */
const    LENGTH = 16207;    /* i: waiting for 32-bit length (gzip) */
const    DONE = 16208;      /* finished check, done -- remain here until reset */
const    BAD = 16209;       /* got a data error -- remain here until reset */
const    MEM = 16210;       /* got an inflate() memory error -- remain here until reset */
const    SYNC = 16211;      /* looking for synchronization bytes to restart inflate() */

/* ===========================================================================*/



const ENOUGH_LENS = 852;
const ENOUGH_DISTS = 592;
//const ENOUGH =  (ENOUGH_LENS+ENOUGH_DISTS);

const MAX_WBITS = 15;
/* 32K LZ77 window */
const DEF_WBITS = MAX_WBITS;


const zswap32 = (q) => {

  return  (((q >>> 24) & 0xff) +
          ((q >>> 8) & 0xff00) +
          ((q & 0xff00) << 8) +
          ((q & 0xff) << 24));
};


function InflateState() {
  this.strm = null;           /* pointer back to this zlib stream */
  this.mode = 0;              /* current inflate mode */
  this.last = false;          /* true if processing last block */
  this.wrap = 0;              /* bit 0 true for zlib, bit 1 true for gzip,
                                 bit 2 true to validate check value */
  this.havedict = false;      /* true if dictionary provided */
  this.flags = 0;             /* gzip header method and flags (0 if zlib), or
                                 -1 if raw or no header yet */
  this.dmax = 0;              /* zlib header max distance (INFLATE_STRICT) */
  this.check = 0;             /* protected copy of check value */
  this.total = 0;             /* protected copy of output count */
  // TODO: may be {}
  this.head = null;           /* where to save gzip header information */

  /* sliding window */
  this.wbits = 0;             /* log base 2 of requested window size */
  this.wsize = 0;             /* window size or zero if not using window */
  this.whave = 0;             /* valid bytes in the window */
  this.wnext = 0;             /* window write index */
  this.window = null;         /* allocated sliding window, if needed */

  /* bit accumulator */
  this.hold = 0;              /* input bit accumulator */
  this.bits = 0;              /* number of bits in "in" */

  /* for string and stored block copying */
  this.length = 0;            /* literal or length of data to copy */
  this.offset = 0;            /* distance back to copy string from */

  /* for table and code decoding */
  this.extra = 0;             /* extra bits needed */

  /* fixed and dynamic code tables */
  this.lencode = null;          /* starting table for length/literal codes */
  this.distcode = null;         /* starting table for distance codes */
  this.lenbits = 0;           /* index bits for lencode */
  this.distbits = 0;          /* index bits for distcode */

  /* dynamic table building */
  this.ncode = 0;             /* number of code length code lengths */
  this.nlen = 0;              /* number of length code lengths */
  this.ndist = 0;             /* number of distance code lengths */
  this.have = 0;              /* number of code lengths in lens[] */
  this.next = null;              /* next available space in codes[] */

  this.lens = new Uint16Array(320); /* temporary storage for code lengths */
  this.work = new Uint16Array(288); /* work area for code table building */

  /*
   because we don't have pointers in js, we use lencode and distcode directly
   as buffers so we don't need codes
  */
  //this.codes = new Int32Array(ENOUGH);       /* space for code tables */
  this.lendyn = null;              /* dynamic table for length/literal codes (JS specific) */
  this.distdyn = null;             /* dynamic table for distance codes (JS specific) */
  this.sane = 0;                   /* if false, allow invalid distance too far */
  this.back = 0;                   /* bits back of last unprocessed length/lit */
  this.was = 0;                    /* initial length of match */
}


const inflateStateCheck = (strm) => {

  if (!strm) {
    return 1;
  }
  const state = strm.state;
  if (!state || state.strm !== strm ||
    state.mode < HEAD || state.mode > SYNC) {
    return 1;
  }
  return 0;
};


const inflateResetKeep = (strm) => {

  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;
  strm.total_in = strm.total_out = state.total = 0;
  strm.msg = ''; /*Z_NULL*/
  if (state.wrap) {       /* to support ill-conceived Java test suite */
    strm.adler = state.wrap & 1;
  }
  state.mode = HEAD;
  state.last = 0;
  state.havedict = 0;
  state.flags = -1;
  state.dmax = 32768;
  state.head = null/*Z_NULL*/;
  state.hold = 0;
  state.bits = 0;
  //state.lencode = state.distcode = state.next = state.codes;
  state.lencode = state.lendyn = new Int32Array(ENOUGH_LENS);
  state.distcode = state.distdyn = new Int32Array(ENOUGH_DISTS);

  state.sane = 1;
  state.back = -1;
  //Tracev((stderr, "inflate: reset\n"));
  return Z_OK;
};


const inflateReset = (strm) => {

  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;
  state.wsize = 0;
  state.whave = 0;
  state.wnext = 0;
  return inflateResetKeep(strm);

};


const inflateReset2 = (strm, windowBits) => {
  let wrap;

  /* get the state */
  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;

  /* extract wrap request from windowBits parameter */
  if (windowBits < 0) {
    wrap = 0;
    windowBits = -windowBits;
  }
  else {
    wrap = (windowBits >> 4) + 5;
    if (windowBits < 48) {
      windowBits &= 15;
    }
  }

  /* set number of window bits, free window if different */
  if (windowBits && (windowBits < 8 || windowBits > 15)) {
    return Z_STREAM_ERROR;
  }
  if (state.window !== null && state.wbits !== windowBits) {
    state.window = null;
  }

  /* update state and reset the rest of it */
  state.wrap = wrap;
  state.wbits = windowBits;
  return inflateReset(strm);
};


const inflateInit2 = (strm, windowBits) => {

  if (!strm) { return Z_STREAM_ERROR; }
  //strm.msg = Z_NULL;                 /* in case we return an error */

  const state = new InflateState();

  //if (state === Z_NULL) return Z_MEM_ERROR;
  //Tracev((stderr, "inflate: allocated\n"));
  strm.state = state;
  state.strm = strm;
  state.window = null/*Z_NULL*/;
  state.mode = HEAD;     /* to pass state test in inflateReset2() */
  const ret = inflateReset2(strm, windowBits);
  if (ret !== Z_OK) {
    strm.state = null/*Z_NULL*/;
  }
  return ret;
};


const inflateInit = (strm) => {

  return inflateInit2(strm, DEF_WBITS);
};


/*
 Return state with length and distance decoding tables and index sizes set to
 fixed code decoding.  Normally this returns fixed tables from inffixed.h.
 If BUILDFIXED is defined, then instead this routine builds the tables the
 first time it's called, and returns those tables the first time and
 thereafter.  This reduces the size of the code by about 2K bytes, in
 exchange for a little execution time.  However, BUILDFIXED should not be
 used for threaded applications, since the rewriting of the tables and virgin
 may not be thread-safe.
 */
let virgin = true;

let lenfix, distfix; // We have no pointers in JS, so keep tables separate


const fixedtables = (state) => {

  /* build fixed huffman tables if first call (may not be thread safe) */
  if (virgin) {
    lenfix = new Int32Array(512);
    distfix = new Int32Array(32);

    /* literal/length table */
    let sym = 0;
    while (sym < 144) { state.lens[sym++] = 8; }
    while (sym < 256) { state.lens[sym++] = 9; }
    while (sym < 280) { state.lens[sym++] = 7; }
    while (sym < 288) { state.lens[sym++] = 8; }

    inflate_table(LENS,  state.lens, 0, 288, lenfix,   0, state.work, { bits: 9 });

    /* distance table */
    sym = 0;
    while (sym < 32) { state.lens[sym++] = 5; }

    inflate_table(DISTS, state.lens, 0, 32,   distfix, 0, state.work, { bits: 5 });

    /* do this just once */
    virgin = false;
  }

  state.lencode = lenfix;
  state.lenbits = 9;
  state.distcode = distfix;
  state.distbits = 5;
};


/*
 Update the window with the last wsize (normally 32K) bytes written before
 returning.  If window does not exist yet, create it.  This is only called
 when a window is already in use, or when output has been written during this
 inflate call, but the end of the deflate stream has not been reached yet.
 It is also called to create a window for dictionary data when a dictionary
 is loaded.

 Providing output buffers larger than 32K to inflate() should provide a speed
 advantage, since only the last 32K of output is copied to the sliding window
 upon return from inflate(), and since all distances after the first 32K of
 output will fall in the output data, making match copies simpler and faster.
 The advantage may be dependent on the size of the processor's data caches.
 */
const updatewindow = (strm, src, end, copy) => {

  let dist;
  const state = strm.state;

  /* if it hasn't been done already, allocate space for the window */
  if (state.window === null) {
    state.wsize = 1 << state.wbits;
    state.wnext = 0;
    state.whave = 0;

    state.window = new Uint8Array(state.wsize);
  }

  /* copy state->wsize or less output bytes into the circular window */
  if (copy >= state.wsize) {
    state.window.set(src.subarray(end - state.wsize, end), 0);
    state.wnext = 0;
    state.whave = state.wsize;
  }
  else {
    dist = state.wsize - state.wnext;
    if (dist > copy) {
      dist = copy;
    }
    //zmemcpy(state->window + state->wnext, end - copy, dist);
    state.window.set(src.subarray(end - copy, end - copy + dist), state.wnext);
    copy -= dist;
    if (copy) {
      //zmemcpy(state->window, end - copy, copy);
      state.window.set(src.subarray(end - copy, end), 0);
      state.wnext = copy;
      state.whave = state.wsize;
    }
    else {
      state.wnext += dist;
      if (state.wnext === state.wsize) { state.wnext = 0; }
      if (state.whave < state.wsize) { state.whave += dist; }
    }
  }
  return 0;
};


const inflate = (strm, flush) => {

  let state;
  let input, output;          // input/output buffers
  let next;                   /* next input INDEX */
  let put;                    /* next output INDEX */
  let have, left;             /* available input and output */
  let hold;                   /* bit buffer */
  let bits;                   /* bits in bit buffer */
  let _in, _out;              /* save starting available input and output */
  let copy;                   /* number of stored or match bytes to copy */
  let from;                   /* where to copy match bytes from */
  let from_source;
  let here = 0;               /* current decoding table entry */
  let here_bits, here_op, here_val; // paked "here" denormalized (JS specific)
  //let last;                   /* parent table entry */
  let last_bits, last_op, last_val; // paked "last" denormalized (JS specific)
  let len;                    /* length to copy for repeats, bits to drop */
  let ret;                    /* return code */
  const hbuf = new Uint8Array(4);    /* buffer for gzip header crc calculation */
  let opts;

  let n; // temporary variable for NEED_BITS

  const order = /* permutation of code lengths */
    new Uint8Array([ 16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 ]);


  if (inflateStateCheck(strm) || !strm.output ||
      (!strm.input && strm.avail_in !== 0)) {
    return Z_STREAM_ERROR;
  }

  state = strm.state;
  if (state.mode === TYPE) { state.mode = TYPEDO; }    /* skip check */


  //--- LOAD() ---
  put = strm.next_out;
  output = strm.output;
  left = strm.avail_out;
  next = strm.next_in;
  input = strm.input;
  have = strm.avail_in;
  hold = state.hold;
  bits = state.bits;
  //---

  _in = have;
  _out = left;
  ret = Z_OK;

  inf_leave: // goto emulation
  for (;;) {
    switch (state.mode) {
      case HEAD:
        if (state.wrap === 0) {
          state.mode = TYPEDO;
          break;
        }
        //=== NEEDBITS(16);
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if ((state.wrap & 2) && hold === 0x8b1f) {  /* gzip header */
          if (state.wbits === 0) {
            state.wbits = 15;
          }
          state.check = 0/*crc32(0L, Z_NULL, 0)*/;
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//

          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          state.mode = FLAGS;
          break;
        }
        if (state.head) {
          state.head.done = false;
        }
        if (!(state.wrap & 1) ||   /* check if zlib header allowed */
          (((hold & 0xff)/*BITS(8)*/ << 8) + (hold >> 8)) % 31) {
          strm.msg = 'incorrect header check';
          state.mode = BAD;
          break;
        }
        if ((hold & 0x0f)/*BITS(4)*/ !== Z_DEFLATED) {
          strm.msg = 'unknown compression method';
          state.mode = BAD;
          break;
        }
        //--- DROPBITS(4) ---//
        hold >>>= 4;
        bits -= 4;
        //---//
        len = (hold & 0x0f)/*BITS(4)*/ + 8;
        if (state.wbits === 0) {
          state.wbits = len;
        }
        if (len > 15 || len > state.wbits) {
          strm.msg = 'invalid window size';
          state.mode = BAD;
          break;
        }

        // !!! pako patch. Force use `options.windowBits` if passed.
        // Required to always use max window size by default.
        state.dmax = 1 << state.wbits;
        //state.dmax = 1 << len;

        state.flags = 0;               /* indicate zlib header */
        //Tracev((stderr, "inflate:   zlib header ok\n"));
        strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
        state.mode = hold & 0x200 ? DICTID : TYPE;
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        break;
      case FLAGS:
        //=== NEEDBITS(16); */
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.flags = hold;
        if ((state.flags & 0xff) !== Z_DEFLATED) {
          strm.msg = 'unknown compression method';
          state.mode = BAD;
          break;
        }
        if (state.flags & 0xe000) {
          strm.msg = 'unknown header flags set';
          state.mode = BAD;
          break;
        }
        if (state.head) {
          state.head.text = ((hold >> 8) & 1);
        }
        if ((state.flags & 0x0200) && (state.wrap & 4)) {
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = TIME;
        /* falls through */
      case TIME:
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if (state.head) {
          state.head.time = hold;
        }
        if ((state.flags & 0x0200) && (state.wrap & 4)) {
          //=== CRC4(state.check, hold)
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          hbuf[2] = (hold >>> 16) & 0xff;
          hbuf[3] = (hold >>> 24) & 0xff;
          state.check = crc32(state.check, hbuf, 4, 0);
          //===
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = OS;
        /* falls through */
      case OS:
        //=== NEEDBITS(16); */
        while (bits < 16) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if (state.head) {
          state.head.xflags = (hold & 0xff);
          state.head.os = (hold >> 8);
        }
        if ((state.flags & 0x0200) && (state.wrap & 4)) {
          //=== CRC2(state.check, hold);
          hbuf[0] = hold & 0xff;
          hbuf[1] = (hold >>> 8) & 0xff;
          state.check = crc32(state.check, hbuf, 2, 0);
          //===//
        }
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = EXLEN;
        /* falls through */
      case EXLEN:
        if (state.flags & 0x0400) {
          //=== NEEDBITS(16); */
          while (bits < 16) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.length = hold;
          if (state.head) {
            state.head.extra_len = hold;
          }
          if ((state.flags & 0x0200) && (state.wrap & 4)) {
            //=== CRC2(state.check, hold);
            hbuf[0] = hold & 0xff;
            hbuf[1] = (hold >>> 8) & 0xff;
            state.check = crc32(state.check, hbuf, 2, 0);
            //===//
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
        }
        else if (state.head) {
          state.head.extra = null/*Z_NULL*/;
        }
        state.mode = EXTRA;
        /* falls through */
      case EXTRA:
        if (state.flags & 0x0400) {
          copy = state.length;
          if (copy > have) { copy = have; }
          if (copy) {
            if (state.head) {
              len = state.head.extra_len - state.length;
              if (!state.head.extra) {
                // Use untyped array for more convenient processing later
                state.head.extra = new Uint8Array(state.head.extra_len);
              }
              state.head.extra.set(
                input.subarray(
                  next,
                  // extra field is limited to 65536 bytes
                  // - no need for additional size check
                  next + copy
                ),
                /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                len
              );
              //zmemcpy(state.head.extra + len, next,
              //        len + copy > state.head.extra_max ?
              //        state.head.extra_max - len : copy);
            }
            if ((state.flags & 0x0200) && (state.wrap & 4)) {
              state.check = crc32(state.check, input, copy, next);
            }
            have -= copy;
            next += copy;
            state.length -= copy;
          }
          if (state.length) { break inf_leave; }
        }
        state.length = 0;
        state.mode = NAME;
        /* falls through */
      case NAME:
        if (state.flags & 0x0800) {
          if (have === 0) { break inf_leave; }
          copy = 0;
          do {
            // TODO: 2 or 1 bytes?
            len = input[next + copy++];
            /* use constant limit because in js we should not preallocate memory */
            if (state.head && len &&
                (state.length < 65536 /*state.head.name_max*/)) {
              state.head.name += String.fromCharCode(len);
            }
          } while (len && copy < have);

          if ((state.flags & 0x0200) && (state.wrap & 4)) {
            state.check = crc32(state.check, input, copy, next);
          }
          have -= copy;
          next += copy;
          if (len) { break inf_leave; }
        }
        else if (state.head) {
          state.head.name = null;
        }
        state.length = 0;
        state.mode = COMMENT;
        /* falls through */
      case COMMENT:
        if (state.flags & 0x1000) {
          if (have === 0) { break inf_leave; }
          copy = 0;
          do {
            len = input[next + copy++];
            /* use constant limit because in js we should not preallocate memory */
            if (state.head && len &&
                (state.length < 65536 /*state.head.comm_max*/)) {
              state.head.comment += String.fromCharCode(len);
            }
          } while (len && copy < have);
          if ((state.flags & 0x0200) && (state.wrap & 4)) {
            state.check = crc32(state.check, input, copy, next);
          }
          have -= copy;
          next += copy;
          if (len) { break inf_leave; }
        }
        else if (state.head) {
          state.head.comment = null;
        }
        state.mode = HCRC;
        /* falls through */
      case HCRC:
        if (state.flags & 0x0200) {
          //=== NEEDBITS(16); */
          while (bits < 16) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          if ((state.wrap & 4) && hold !== (state.check & 0xffff)) {
            strm.msg = 'header crc mismatch';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
        }
        if (state.head) {
          state.head.hcrc = ((state.flags >> 9) & 1);
          state.head.done = true;
        }
        strm.adler = state.check = 0;
        state.mode = TYPE;
        break;
      case DICTID:
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        strm.adler = state.check = zswap32(hold);
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = DICT;
        /* falls through */
      case DICT:
        if (state.havedict === 0) {
          //--- RESTORE() ---
          strm.next_out = put;
          strm.avail_out = left;
          strm.next_in = next;
          strm.avail_in = have;
          state.hold = hold;
          state.bits = bits;
          //---
          return Z_NEED_DICT;
        }
        strm.adler = state.check = 1/*adler32(0L, Z_NULL, 0)*/;
        state.mode = TYPE;
        /* falls through */
      case TYPE:
        if (flush === Z_BLOCK || flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case TYPEDO:
        if (state.last) {
          //--- BYTEBITS() ---//
          hold >>>= bits & 7;
          bits -= bits & 7;
          //---//
          state.mode = CHECK;
          break;
        }
        //=== NEEDBITS(3); */
        while (bits < 3) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.last = (hold & 0x01)/*BITS(1)*/;
        //--- DROPBITS(1) ---//
        hold >>>= 1;
        bits -= 1;
        //---//

        switch ((hold & 0x03)/*BITS(2)*/) {
          case 0:                             /* stored block */
            //Tracev((stderr, "inflate:     stored block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = STORED;
            break;
          case 1:                             /* fixed block */
            fixedtables(state);
            //Tracev((stderr, "inflate:     fixed codes block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = LEN_;             /* decode codes */
            if (flush === Z_TREES) {
              //--- DROPBITS(2) ---//
              hold >>>= 2;
              bits -= 2;
              //---//
              break inf_leave;
            }
            break;
          case 2:                             /* dynamic block */
            //Tracev((stderr, "inflate:     dynamic codes block%s\n",
            //        state.last ? " (last)" : ""));
            state.mode = TABLE;
            break;
          case 3:
            strm.msg = 'invalid block type';
            state.mode = BAD;
        }
        //--- DROPBITS(2) ---//
        hold >>>= 2;
        bits -= 2;
        //---//
        break;
      case STORED:
        //--- BYTEBITS() ---// /* go to byte boundary */
        hold >>>= bits & 7;
        bits -= bits & 7;
        //---//
        //=== NEEDBITS(32); */
        while (bits < 32) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        if ((hold & 0xffff) !== ((hold >>> 16) ^ 0xffff)) {
          strm.msg = 'invalid stored block lengths';
          state.mode = BAD;
          break;
        }
        state.length = hold & 0xffff;
        //Tracev((stderr, "inflate:       stored length %u\n",
        //        state.length));
        //=== INITBITS();
        hold = 0;
        bits = 0;
        //===//
        state.mode = COPY_;
        if (flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case COPY_:
        state.mode = COPY;
        /* falls through */
      case COPY:
        copy = state.length;
        if (copy) {
          if (copy > have) { copy = have; }
          if (copy > left) { copy = left; }
          if (copy === 0) { break inf_leave; }
          //--- zmemcpy(put, next, copy); ---
          output.set(input.subarray(next, next + copy), put);
          //---//
          have -= copy;
          next += copy;
          left -= copy;
          put += copy;
          state.length -= copy;
          break;
        }
        //Tracev((stderr, "inflate:       stored end\n"));
        state.mode = TYPE;
        break;
      case TABLE:
        //=== NEEDBITS(14); */
        while (bits < 14) {
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
        }
        //===//
        state.nlen = (hold & 0x1f)/*BITS(5)*/ + 257;
        //--- DROPBITS(5) ---//
        hold >>>= 5;
        bits -= 5;
        //---//
        state.ndist = (hold & 0x1f)/*BITS(5)*/ + 1;
        //--- DROPBITS(5) ---//
        hold >>>= 5;
        bits -= 5;
        //---//
        state.ncode = (hold & 0x0f)/*BITS(4)*/ + 4;
        //--- DROPBITS(4) ---//
        hold >>>= 4;
        bits -= 4;
        //---//
//#ifndef PKZIP_BUG_WORKAROUND
        if (state.nlen > 286 || state.ndist > 30) {
          strm.msg = 'too many length or distance symbols';
          state.mode = BAD;
          break;
        }
//#endif
        //Tracev((stderr, "inflate:       table sizes ok\n"));
        state.have = 0;
        state.mode = LENLENS;
        /* falls through */
      case LENLENS:
        while (state.have < state.ncode) {
          //=== NEEDBITS(3);
          while (bits < 3) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.lens[order[state.have++]] = (hold & 0x07);//BITS(3);
          //--- DROPBITS(3) ---//
          hold >>>= 3;
          bits -= 3;
          //---//
        }
        while (state.have < 19) {
          state.lens[order[state.have++]] = 0;
        }
        // We have separate tables & no pointers. 2 commented lines below not needed.
        //state.next = state.codes;
        //state.lencode = state.next;
        // Switch to use dynamic table
        state.lencode = state.lendyn;
        state.lenbits = 7;

        opts = { bits: state.lenbits };
        ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
        state.lenbits = opts.bits;

        if (ret) {
          strm.msg = 'invalid code lengths set';
          state.mode = BAD;
          break;
        }
        //Tracev((stderr, "inflate:       code lengths ok\n"));
        state.have = 0;
        state.mode = CODELENS;
        /* falls through */
      case CODELENS:
        while (state.have < state.nlen + state.ndist) {
          for (;;) {
            here = state.lencode[hold & ((1 << state.lenbits) - 1)];/*BITS(state.lenbits)*/
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          if (here_val < 16) {
            //--- DROPBITS(here.bits) ---//
            hold >>>= here_bits;
            bits -= here_bits;
            //---//
            state.lens[state.have++] = here_val;
          }
          else {
            if (here_val === 16) {
              //=== NEEDBITS(here.bits + 2);
              n = here_bits + 2;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              if (state.have === 0) {
                strm.msg = 'invalid bit length repeat';
                state.mode = BAD;
                break;
              }
              len = state.lens[state.have - 1];
              copy = 3 + (hold & 0x03);//BITS(2);
              //--- DROPBITS(2) ---//
              hold >>>= 2;
              bits -= 2;
              //---//
            }
            else if (here_val === 17) {
              //=== NEEDBITS(here.bits + 3);
              n = here_bits + 3;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              len = 0;
              copy = 3 + (hold & 0x07);//BITS(3);
              //--- DROPBITS(3) ---//
              hold >>>= 3;
              bits -= 3;
              //---//
            }
            else {
              //=== NEEDBITS(here.bits + 7);
              n = here_bits + 7;
              while (bits < n) {
                if (have === 0) { break inf_leave; }
                have--;
                hold += input[next++] << bits;
                bits += 8;
              }
              //===//
              //--- DROPBITS(here.bits) ---//
              hold >>>= here_bits;
              bits -= here_bits;
              //---//
              len = 0;
              copy = 11 + (hold & 0x7f);//BITS(7);
              //--- DROPBITS(7) ---//
              hold >>>= 7;
              bits -= 7;
              //---//
            }
            if (state.have + copy > state.nlen + state.ndist) {
              strm.msg = 'invalid bit length repeat';
              state.mode = BAD;
              break;
            }
            while (copy--) {
              state.lens[state.have++] = len;
            }
          }
        }

        /* handle error breaks in while */
        if (state.mode === BAD) { break; }

        /* check for end-of-block code (better have one) */
        if (state.lens[256] === 0) {
          strm.msg = 'invalid code -- missing end-of-block';
          state.mode = BAD;
          break;
        }

        /* build code tables -- note: do not change the lenbits or distbits
           values here (9 and 6) without reading the comments in inftrees.h
           concerning the ENOUGH constants, which depend on those values */
        state.lenbits = 9;

        opts = { bits: state.lenbits };
        ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
        // We have separate tables & no pointers. 2 commented lines below not needed.
        // state.next_index = opts.table_index;
        state.lenbits = opts.bits;
        // state.lencode = state.next;

        if (ret) {
          strm.msg = 'invalid literal/lengths set';
          state.mode = BAD;
          break;
        }

        state.distbits = 6;
        //state.distcode.copy(state.codes);
        // Switch to use dynamic table
        state.distcode = state.distdyn;
        opts = { bits: state.distbits };
        ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
        // We have separate tables & no pointers. 2 commented lines below not needed.
        // state.next_index = opts.table_index;
        state.distbits = opts.bits;
        // state.distcode = state.next;

        if (ret) {
          strm.msg = 'invalid distances set';
          state.mode = BAD;
          break;
        }
        //Tracev((stderr, 'inflate:       codes ok\n'));
        state.mode = LEN_;
        if (flush === Z_TREES) { break inf_leave; }
        /* falls through */
      case LEN_:
        state.mode = LEN;
        /* falls through */
      case LEN:
        if (have >= 6 && left >= 258) {
          //--- RESTORE() ---
          strm.next_out = put;
          strm.avail_out = left;
          strm.next_in = next;
          strm.avail_in = have;
          state.hold = hold;
          state.bits = bits;
          //---
          inflate_fast(strm, _out);
          //--- LOAD() ---
          put = strm.next_out;
          output = strm.output;
          left = strm.avail_out;
          next = strm.next_in;
          input = strm.input;
          have = strm.avail_in;
          hold = state.hold;
          bits = state.bits;
          //---

          if (state.mode === TYPE) {
            state.back = -1;
          }
          break;
        }
        state.back = 0;
        for (;;) {
          here = state.lencode[hold & ((1 << state.lenbits) - 1)];  /*BITS(state.lenbits)*/
          here_bits = here >>> 24;
          here_op = (here >>> 16) & 0xff;
          here_val = here & 0xffff;

          if (here_bits <= bits) { break; }
          //--- PULLBYTE() ---//
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
          //---//
        }
        if (here_op && (here_op & 0xf0) === 0) {
          last_bits = here_bits;
          last_op = here_op;
          last_val = here_val;
          for (;;) {
            here = state.lencode[last_val +
                    ((hold & ((1 << (last_bits + last_op)) - 1))/*BITS(last.bits + last.op)*/ >> last_bits)];
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((last_bits + here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          //--- DROPBITS(last.bits) ---//
          hold >>>= last_bits;
          bits -= last_bits;
          //---//
          state.back += last_bits;
        }
        //--- DROPBITS(here.bits) ---//
        hold >>>= here_bits;
        bits -= here_bits;
        //---//
        state.back += here_bits;
        state.length = here_val;
        if (here_op === 0) {
          //Tracevv((stderr, here.val >= 0x20 && here.val < 0x7f ?
          //        "inflate:         literal '%c'\n" :
          //        "inflate:         literal 0x%02x\n", here.val));
          state.mode = LIT;
          break;
        }
        if (here_op & 32) {
          //Tracevv((stderr, "inflate:         end of block\n"));
          state.back = -1;
          state.mode = TYPE;
          break;
        }
        if (here_op & 64) {
          strm.msg = 'invalid literal/length code';
          state.mode = BAD;
          break;
        }
        state.extra = here_op & 15;
        state.mode = LENEXT;
        /* falls through */
      case LENEXT:
        if (state.extra) {
          //=== NEEDBITS(state.extra);
          n = state.extra;
          while (bits < n) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.length += hold & ((1 << state.extra) - 1)/*BITS(state.extra)*/;
          //--- DROPBITS(state.extra) ---//
          hold >>>= state.extra;
          bits -= state.extra;
          //---//
          state.back += state.extra;
        }
        //Tracevv((stderr, "inflate:         length %u\n", state.length));
        state.was = state.length;
        state.mode = DIST;
        /* falls through */
      case DIST:
        for (;;) {
          here = state.distcode[hold & ((1 << state.distbits) - 1)];/*BITS(state.distbits)*/
          here_bits = here >>> 24;
          here_op = (here >>> 16) & 0xff;
          here_val = here & 0xffff;

          if ((here_bits) <= bits) { break; }
          //--- PULLBYTE() ---//
          if (have === 0) { break inf_leave; }
          have--;
          hold += input[next++] << bits;
          bits += 8;
          //---//
        }
        if ((here_op & 0xf0) === 0) {
          last_bits = here_bits;
          last_op = here_op;
          last_val = here_val;
          for (;;) {
            here = state.distcode[last_val +
                    ((hold & ((1 << (last_bits + last_op)) - 1))/*BITS(last.bits + last.op)*/ >> last_bits)];
            here_bits = here >>> 24;
            here_op = (here >>> 16) & 0xff;
            here_val = here & 0xffff;

            if ((last_bits + here_bits) <= bits) { break; }
            //--- PULLBYTE() ---//
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
            //---//
          }
          //--- DROPBITS(last.bits) ---//
          hold >>>= last_bits;
          bits -= last_bits;
          //---//
          state.back += last_bits;
        }
        //--- DROPBITS(here.bits) ---//
        hold >>>= here_bits;
        bits -= here_bits;
        //---//
        state.back += here_bits;
        if (here_op & 64) {
          strm.msg = 'invalid distance code';
          state.mode = BAD;
          break;
        }
        state.offset = here_val;
        state.extra = (here_op) & 15;
        state.mode = DISTEXT;
        /* falls through */
      case DISTEXT:
        if (state.extra) {
          //=== NEEDBITS(state.extra);
          n = state.extra;
          while (bits < n) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          state.offset += hold & ((1 << state.extra) - 1)/*BITS(state.extra)*/;
          //--- DROPBITS(state.extra) ---//
          hold >>>= state.extra;
          bits -= state.extra;
          //---//
          state.back += state.extra;
        }
//#ifdef INFLATE_STRICT
        if (state.offset > state.dmax) {
          strm.msg = 'invalid distance too far back';
          state.mode = BAD;
          break;
        }
//#endif
        //Tracevv((stderr, "inflate:         distance %u\n", state.offset));
        state.mode = MATCH;
        /* falls through */
      case MATCH:
        if (left === 0) { break inf_leave; }
        copy = _out - left;
        if (state.offset > copy) {         /* copy from window */
          copy = state.offset - copy;
          if (copy > state.whave) {
            if (state.sane) {
              strm.msg = 'invalid distance too far back';
              state.mode = BAD;
              break;
            }
// (!) This block is disabled in zlib defaults,
// don't enable it for binary compatibility
//#ifdef INFLATE_ALLOW_INVALID_DISTANCE_TOOFAR_ARRR
//          Trace((stderr, "inflate.c too far\n"));
//          copy -= state.whave;
//          if (copy > state.length) { copy = state.length; }
//          if (copy > left) { copy = left; }
//          left -= copy;
//          state.length -= copy;
//          do {
//            output[put++] = 0;
//          } while (--copy);
//          if (state.length === 0) { state.mode = LEN; }
//          break;
//#endif
          }
          if (copy > state.wnext) {
            copy -= state.wnext;
            from = state.wsize - copy;
          }
          else {
            from = state.wnext - copy;
          }
          if (copy > state.length) { copy = state.length; }
          from_source = state.window;
        }
        else {                              /* copy from output */
          from_source = output;
          from = put - state.offset;
          copy = state.length;
        }
        if (copy > left) { copy = left; }
        left -= copy;
        state.length -= copy;
        do {
          output[put++] = from_source[from++];
        } while (--copy);
        if (state.length === 0) { state.mode = LEN; }
        break;
      case LIT:
        if (left === 0) { break inf_leave; }
        output[put++] = state.length;
        left--;
        state.mode = LEN;
        break;
      case CHECK:
        if (state.wrap) {
          //=== NEEDBITS(32);
          while (bits < 32) {
            if (have === 0) { break inf_leave; }
            have--;
            // Use '|' instead of '+' to make sure that result is signed
            hold |= input[next++] << bits;
            bits += 8;
          }
          //===//
          _out -= left;
          strm.total_out += _out;
          state.total += _out;
          if ((state.wrap & 4) && _out) {
            strm.adler = state.check =
                /*UPDATE_CHECK(state.check, put - _out, _out);*/
                (state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out));

          }
          _out = left;
          // NB: crc32 stored as signed 32-bit int, zswap32 returns signed too
          if ((state.wrap & 4) && (state.flags ? hold : zswap32(hold)) !== state.check) {
            strm.msg = 'incorrect data check';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          //Tracev((stderr, "inflate:   check matches trailer\n"));
        }
        state.mode = LENGTH;
        /* falls through */
      case LENGTH:
        if (state.wrap && state.flags) {
          //=== NEEDBITS(32);
          while (bits < 32) {
            if (have === 0) { break inf_leave; }
            have--;
            hold += input[next++] << bits;
            bits += 8;
          }
          //===//
          if ((state.wrap & 4) && hold !== (state.total & 0xffffffff)) {
            strm.msg = 'incorrect length check';
            state.mode = BAD;
            break;
          }
          //=== INITBITS();
          hold = 0;
          bits = 0;
          //===//
          //Tracev((stderr, "inflate:   length matches trailer\n"));
        }
        state.mode = DONE;
        /* falls through */
      case DONE:
        ret = Z_STREAM_END;
        break inf_leave;
      case BAD:
        ret = Z_DATA_ERROR;
        break inf_leave;
      case MEM:
        return Z_MEM_ERROR;
      case SYNC:
        /* falls through */
      default:
        return Z_STREAM_ERROR;
    }
  }

  // inf_leave <- here is real place for "goto inf_leave", emulated via "break inf_leave"

  /*
     Return from inflate(), updating the total counts and the check value.
     If there was no progress during the inflate() call, return a buffer
     error.  Call updatewindow() to create and/or update the window state.
     Note: a memory error from inflate() is non-recoverable.
   */

  //--- RESTORE() ---
  strm.next_out = put;
  strm.avail_out = left;
  strm.next_in = next;
  strm.avail_in = have;
  state.hold = hold;
  state.bits = bits;
  //---

  if (state.wsize || (_out !== strm.avail_out && state.mode < BAD &&
                      (state.mode < CHECK || flush !== Z_FINISH))) {
    if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
      state.mode = MEM;
      return Z_MEM_ERROR;
    }
  }
  _in -= strm.avail_in;
  _out -= strm.avail_out;
  strm.total_in += _in;
  strm.total_out += _out;
  state.total += _out;
  if ((state.wrap & 4) && _out) {
    strm.adler = state.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
      (state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out));
  }
  strm.data_type = state.bits + (state.last ? 64 : 0) +
                    (state.mode === TYPE ? 128 : 0) +
                    (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);
  if (((_in === 0 && _out === 0) || flush === Z_FINISH) && ret === Z_OK) {
    ret = Z_BUF_ERROR;
  }
  return ret;
};


const inflateEnd = (strm) => {

  if (inflateStateCheck(strm)) {
    return Z_STREAM_ERROR;
  }

  let state = strm.state;
  if (state.window) {
    state.window = null;
  }
  strm.state = null;
  return Z_OK;
};


const inflateGetHeader = (strm, head) => {

  /* check state */
  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  const state = strm.state;
  if ((state.wrap & 2) === 0) { return Z_STREAM_ERROR; }

  /* save header structure */
  state.head = head;
  head.done = false;
  return Z_OK;
};


const inflateSetDictionary = (strm, dictionary) => {
  const dictLength = dictionary.length;

  let state;
  let dictid;
  let ret;

  /* check state */
  if (inflateStateCheck(strm)) { return Z_STREAM_ERROR; }
  state = strm.state;

  if (state.wrap !== 0 && state.mode !== DICT) {
    return Z_STREAM_ERROR;
  }

  /* check for correct dictionary identifier */
  if (state.mode === DICT) {
    dictid = 1; /* adler32(0, null, 0)*/
    /* dictid = adler32(dictid, dictionary, dictLength); */
    dictid = adler32(dictid, dictionary, dictLength, 0);
    if (dictid !== state.check) {
      return Z_DATA_ERROR;
    }
  }
  /* copy dictionary to window using updatewindow(), which will amend the
   existing dictionary if appropriate */
  ret = updatewindow(strm, dictionary, dictLength, dictLength);
  if (ret) {
    state.mode = MEM;
    return Z_MEM_ERROR;
  }
  state.havedict = 1;
  // Tracev((stderr, "inflate:   dictionary set\n"));
  return Z_OK;
};


module.exports.inflateReset = inflateReset;
module.exports.inflateReset2 = inflateReset2;
module.exports.inflateResetKeep = inflateResetKeep;
module.exports.inflateInit = inflateInit;
module.exports.inflateInit2 = inflateInit2;
module.exports.inflate = inflate;
module.exports.inflateEnd = inflateEnd;
module.exports.inflateGetHeader = inflateGetHeader;
module.exports.inflateSetDictionary = inflateSetDictionary;
module.exports.inflateInfo = 'pako inflate (from Nodeca project)';

/* Not implemented
module.exports.inflateCodesUsed = inflateCodesUsed;
module.exports.inflateCopy = inflateCopy;
module.exports.inflateGetDictionary = inflateGetDictionary;
module.exports.inflateMark = inflateMark;
module.exports.inflatePrime = inflatePrime;
module.exports.inflateSync = inflateSync;
module.exports.inflateSyncPoint = inflateSyncPoint;
module.exports.inflateUndermine = inflateUndermine;
module.exports.inflateValidate = inflateValidate;
*/

},{"./adler32":25,"./constants":26,"./crc32":27,"./inffast":30,"./inftrees":32}],32:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

const MAXBITS = 15;
const ENOUGH_LENS = 852;
const ENOUGH_DISTS = 592;
//const ENOUGH = (ENOUGH_LENS+ENOUGH_DISTS);

const CODES = 0;
const LENS = 1;
const DISTS = 2;

const lbase = new Uint16Array([ /* Length codes 257..285 base */
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0
]);

const lext = new Uint8Array([ /* Length codes 257..285 extra */
  16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18,
  19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78
]);

const dbase = new Uint16Array([ /* Distance codes 0..29 base */
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577, 0, 0
]);

const dext = new Uint8Array([ /* Distance codes 0..29 extra */
  16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22,
  23, 23, 24, 24, 25, 25, 26, 26, 27, 27,
  28, 28, 29, 29, 64, 64
]);

const inflate_table = (type, lens, lens_index, codes, table, table_index, work, opts) =>
{
  const bits = opts.bits;
      //here = opts.here; /* table entry for duplication */

  let len = 0;               /* a code's length in bits */
  let sym = 0;               /* index of code symbols */
  let min = 0, max = 0;          /* minimum and maximum code lengths */
  let root = 0;              /* number of index bits for root table */
  let curr = 0;              /* number of index bits for current table */
  let drop = 0;              /* code bits to drop for sub-table */
  let left = 0;                   /* number of prefix codes available */
  let used = 0;              /* code entries in table used */
  let huff = 0;              /* Huffman code */
  let incr;              /* for incrementing code, index */
  let fill;              /* index for replicating entries */
  let low;               /* low bits for current root entry */
  let mask;              /* mask for low root bits */
  let next;             /* next available space in table */
  let base = null;     /* base value table to use */
//  let shoextra;    /* extra bits table to use */
  let match;                  /* use base and extra for symbol >= match */
  const count = new Uint16Array(MAXBITS + 1); //[MAXBITS+1];    /* number of codes of each length */
  const offs = new Uint16Array(MAXBITS + 1); //[MAXBITS+1];     /* offsets in table for each length */
  let extra = null;

  let here_bits, here_op, here_val;

  /*
   Process a set of code lengths to create a canonical Huffman code.  The
   code lengths are lens[0..codes-1].  Each length corresponds to the
   symbols 0..codes-1.  The Huffman code is generated by first sorting the
   symbols by length from short to long, and retaining the symbol order
   for codes with equal lengths.  Then the code starts with all zero bits
   for the first code of the shortest length, and the codes are integer
   increments for the same length, and zeros are appended as the length
   increases.  For the deflate format, these bits are stored backwards
   from their more natural integer increment ordering, and so when the
   decoding tables are built in the large loop below, the integer codes
   are incremented backwards.

   This routine assumes, but does not check, that all of the entries in
   lens[] are in the range 0..MAXBITS.  The caller must assure this.
   1..MAXBITS is interpreted as that code length.  zero means that that
   symbol does not occur in this code.

   The codes are sorted by computing a count of codes for each length,
   creating from that a table of starting indices for each length in the
   sorted table, and then entering the symbols in order in the sorted
   table.  The sorted table is work[], with that space being provided by
   the caller.

   The length counts are used for other purposes as well, i.e. finding
   the minimum and maximum length codes, determining if there are any
   codes at all, checking for a valid set of lengths, and looking ahead
   at length counts to determine sub-table sizes when building the
   decoding tables.
   */

  /* accumulate lengths for codes (assumes lens[] all in 0..MAXBITS) */
  for (len = 0; len <= MAXBITS; len++) {
    count[len] = 0;
  }
  for (sym = 0; sym < codes; sym++) {
    count[lens[lens_index + sym]]++;
  }

  /* bound code lengths, force root to be within code lengths */
  root = bits;
  for (max = MAXBITS; max >= 1; max--) {
    if (count[max] !== 0) { break; }
  }
  if (root > max) {
    root = max;
  }
  if (max === 0) {                     /* no symbols to code at all */
    //table.op[opts.table_index] = 64;  //here.op = (var char)64;    /* invalid code marker */
    //table.bits[opts.table_index] = 1;   //here.bits = (var char)1;
    //table.val[opts.table_index++] = 0;   //here.val = (var short)0;
    table[table_index++] = (1 << 24) | (64 << 16) | 0;


    //table.op[opts.table_index] = 64;
    //table.bits[opts.table_index] = 1;
    //table.val[opts.table_index++] = 0;
    table[table_index++] = (1 << 24) | (64 << 16) | 0;

    opts.bits = 1;
    return 0;     /* no symbols, but wait for decoding to report error */
  }
  for (min = 1; min < max; min++) {
    if (count[min] !== 0) { break; }
  }
  if (root < min) {
    root = min;
  }

  /* check for an over-subscribed or incomplete set of lengths */
  left = 1;
  for (len = 1; len <= MAXBITS; len++) {
    left <<= 1;
    left -= count[len];
    if (left < 0) {
      return -1;
    }        /* over-subscribed */
  }
  if (left > 0 && (type === CODES || max !== 1)) {
    return -1;                      /* incomplete set */
  }

  /* generate offsets into symbol table for each length for sorting */
  offs[1] = 0;
  for (len = 1; len < MAXBITS; len++) {
    offs[len + 1] = offs[len] + count[len];
  }

  /* sort symbols by length, by symbol order within each length */
  for (sym = 0; sym < codes; sym++) {
    if (lens[lens_index + sym] !== 0) {
      work[offs[lens[lens_index + sym]]++] = sym;
    }
  }

  /*
   Create and fill in decoding tables.  In this loop, the table being
   filled is at next and has curr index bits.  The code being used is huff
   with length len.  That code is converted to an index by dropping drop
   bits off of the bottom.  For codes where len is less than drop + curr,
   those top drop + curr - len bits are incremented through all values to
   fill the table with replicated entries.

   root is the number of index bits for the root table.  When len exceeds
   root, sub-tables are created pointed to by the root entry with an index
   of the low root bits of huff.  This is saved in low to check for when a
   new sub-table should be started.  drop is zero when the root table is
   being filled, and drop is root when sub-tables are being filled.

   When a new sub-table is needed, it is necessary to look ahead in the
   code lengths to determine what size sub-table is needed.  The length
   counts are used for this, and so count[] is decremented as codes are
   entered in the tables.

   used keeps track of how many table entries have been allocated from the
   provided *table space.  It is checked for LENS and DIST tables against
   the constants ENOUGH_LENS and ENOUGH_DISTS to guard against changes in
   the initial root table size constants.  See the comments in inftrees.h
   for more information.

   sym increments through all symbols, and the loop terminates when
   all codes of length max, i.e. all codes, have been processed.  This
   routine permits incomplete codes, so another loop after this one fills
   in the rest of the decoding tables with invalid code markers.
   */

  /* set up for code type */
  // poor man optimization - use if-else instead of switch,
  // to avoid deopts in old v8
  if (type === CODES) {
    base = extra = work;    /* dummy value--not used */
    match = 20;

  } else if (type === LENS) {
    base = lbase;
    extra = lext;
    match = 257;

  } else {                    /* DISTS */
    base = dbase;
    extra = dext;
    match = 0;
  }

  /* initialize opts for loop */
  huff = 0;                   /* starting code */
  sym = 0;                    /* starting code symbol */
  len = min;                  /* starting code length */
  next = table_index;              /* current table to fill in */
  curr = root;                /* current table index bits */
  drop = 0;                   /* current bits to drop from code for index */
  low = -1;                   /* trigger new sub-table when len > root */
  used = 1 << root;          /* use root table entries */
  mask = used - 1;            /* mask for comparing low */

  /* check available table space */
  if ((type === LENS && used > ENOUGH_LENS) ||
    (type === DISTS && used > ENOUGH_DISTS)) {
    return 1;
  }

  /* process all codes and make table entries */
  for (;;) {
    /* create table entry */
    here_bits = len - drop;
    if (work[sym] + 1 < match) {
      here_op = 0;
      here_val = work[sym];
    }
    else if (work[sym] >= match) {
      here_op = extra[work[sym] - match];
      here_val = base[work[sym] - match];
    }
    else {
      here_op = 32 + 64;         /* end of block */
      here_val = 0;
    }

    /* replicate for those indices with low len bits equal to huff */
    incr = 1 << (len - drop);
    fill = 1 << curr;
    min = fill;                 /* save offset to next table */
    do {
      fill -= incr;
      table[next + (huff >> drop) + fill] = (here_bits << 24) | (here_op << 16) | here_val |0;
    } while (fill !== 0);

    /* backwards increment the len-bit code huff */
    incr = 1 << (len - 1);
    while (huff & incr) {
      incr >>= 1;
    }
    if (incr !== 0) {
      huff &= incr - 1;
      huff += incr;
    } else {
      huff = 0;
    }

    /* go to next symbol, update count, len */
    sym++;
    if (--count[len] === 0) {
      if (len === max) { break; }
      len = lens[lens_index + work[sym]];
    }

    /* create new sub-table if needed */
    if (len > root && (huff & mask) !== low) {
      /* if first time, transition to sub-tables */
      if (drop === 0) {
        drop = root;
      }

      /* increment past last table */
      next += min;            /* here min is 1 << curr */

      /* determine length of next table */
      curr = len - drop;
      left = 1 << curr;
      while (curr + drop < max) {
        left -= count[curr + drop];
        if (left <= 0) { break; }
        curr++;
        left <<= 1;
      }

      /* check for enough space */
      used += 1 << curr;
      if ((type === LENS && used > ENOUGH_LENS) ||
        (type === DISTS && used > ENOUGH_DISTS)) {
        return 1;
      }

      /* point entry in root table to sub-table */
      low = huff & mask;
      /*table.op[low] = curr;
      table.bits[low] = root;
      table.val[low] = next - opts.table_index;*/
      table[low] = (root << 24) | (curr << 16) | (next - table_index) |0;
    }
  }

  /* fill in remaining table entry if code is incomplete (guaranteed to have
   at most one remaining entry, since if the code is incomplete, the
   maximum code length that was allowed to get this far is one bit) */
  if (huff !== 0) {
    //table.op[next + huff] = 64;            /* invalid code marker */
    //table.bits[next + huff] = len - drop;
    //table.val[next + huff] = 0;
    table[next + huff] = ((len - drop) << 24) | (64 << 16) |0;
  }

  /* set return parameters */
  //opts.table_index += used;
  opts.bits = root;
  return 0;
};


module.exports = inflate_table;

},{}],33:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

module.exports = {
  2:      'need dictionary',     /* Z_NEED_DICT       2  */
  1:      'stream end',          /* Z_STREAM_END      1  */
  0:      '',                    /* Z_OK              0  */
  '-1':   'file error',          /* Z_ERRNO         (-1) */
  '-2':   'stream error',        /* Z_STREAM_ERROR  (-2) */
  '-3':   'data error',          /* Z_DATA_ERROR    (-3) */
  '-4':   'insufficient memory', /* Z_MEM_ERROR     (-4) */
  '-5':   'buffer error',        /* Z_BUF_ERROR     (-5) */
  '-6':   'incompatible version' /* Z_VERSION_ERROR (-6) */
};

},{}],34:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

/* eslint-disable space-unary-ops */

/* Public constants ==========================================================*/
/* ===========================================================================*/


//const Z_FILTERED          = 1;
//const Z_HUFFMAN_ONLY      = 2;
//const Z_RLE               = 3;
const Z_FIXED               = 4;
//const Z_DEFAULT_STRATEGY  = 0;

/* Possible values of the data_type field (though see inflate()) */
const Z_BINARY              = 0;
const Z_TEXT                = 1;
//const Z_ASCII             = 1; // = Z_TEXT
const Z_UNKNOWN             = 2;

/*============================================================================*/


function zero(buf) { let len = buf.length; while (--len >= 0) { buf[len] = 0; } }

// From zutil.h

const STORED_BLOCK = 0;
const STATIC_TREES = 1;
const DYN_TREES    = 2;
/* The three kinds of block type */

const MIN_MATCH    = 3;
const MAX_MATCH    = 258;
/* The minimum and maximum match lengths */

// From deflate.h
/* ===========================================================================
 * Internal compression state.
 */

const LENGTH_CODES  = 29;
/* number of length codes, not counting the special END_BLOCK code */

const LITERALS      = 256;
/* number of literal bytes 0..255 */

const L_CODES       = LITERALS + 1 + LENGTH_CODES;
/* number of Literal or Length codes, including the END_BLOCK code */

const D_CODES       = 30;
/* number of distance codes */

const BL_CODES      = 19;
/* number of codes used to transfer the bit lengths */

const HEAP_SIZE     = 2 * L_CODES + 1;
/* maximum heap size */

const MAX_BITS      = 15;
/* All codes must not exceed MAX_BITS bits */

const Buf_size      = 16;
/* size of bit buffer in bi_buf */


/* ===========================================================================
 * Constants
 */

const MAX_BL_BITS = 7;
/* Bit length codes must not exceed MAX_BL_BITS bits */

const END_BLOCK   = 256;
/* end of block literal code */

const REP_3_6     = 16;
/* repeat previous bit length 3-6 times (2 bits of repeat count) */

const REPZ_3_10   = 17;
/* repeat a zero length 3-10 times  (3 bits of repeat count) */

const REPZ_11_138 = 18;
/* repeat a zero length 11-138 times  (7 bits of repeat count) */

/* eslint-disable comma-spacing,array-bracket-spacing */
const extra_lbits =   /* extra bits for each length code */
  new Uint8Array([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0]);

const extra_dbits =   /* extra bits for each distance code */
  new Uint8Array([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13]);

const extra_blbits =  /* extra bits for each bit length code */
  new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7]);

const bl_order =
  new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);
/* eslint-enable comma-spacing,array-bracket-spacing */

/* The lengths of the bit length codes are sent in order of decreasing
 * probability, to avoid transmitting the lengths for unused bit length codes.
 */

/* ===========================================================================
 * Local data. These are initialized only once.
 */

// We pre-fill arrays with 0 to avoid uninitialized gaps

const DIST_CODE_LEN = 512; /* see definition of array dist_code below */

// !!!! Use flat array instead of structure, Freq = i*2, Len = i*2+1
const static_ltree  = new Array((L_CODES + 2) * 2);
zero(static_ltree);
/* The static literal tree. Since the bit lengths are imposed, there is no
 * need for the L_CODES extra codes used during heap construction. However
 * The codes 286 and 287 are needed to build a canonical tree (see _tr_init
 * below).
 */

const static_dtree  = new Array(D_CODES * 2);
zero(static_dtree);
/* The static distance tree. (Actually a trivial tree since all codes use
 * 5 bits.)
 */

const _dist_code    = new Array(DIST_CODE_LEN);
zero(_dist_code);
/* Distance codes. The first 256 values correspond to the distances
 * 3 .. 258, the last 256 values correspond to the top 8 bits of
 * the 15 bit distances.
 */

const _length_code  = new Array(MAX_MATCH - MIN_MATCH + 1);
zero(_length_code);
/* length code for each normalized match length (0 == MIN_MATCH) */

const base_length   = new Array(LENGTH_CODES);
zero(base_length);
/* First normalized length for each code (0 = MIN_MATCH) */

const base_dist     = new Array(D_CODES);
zero(base_dist);
/* First normalized distance for each code (0 = distance of 1) */


function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {

  this.static_tree  = static_tree;  /* static tree or NULL */
  this.extra_bits   = extra_bits;   /* extra bits for each code or NULL */
  this.extra_base   = extra_base;   /* base index for extra_bits */
  this.elems        = elems;        /* max number of elements in the tree */
  this.max_length   = max_length;   /* max bit length for the codes */

  // show if `static_tree` has data or dummy - needed for monomorphic objects
  this.has_stree    = static_tree && static_tree.length;
}


let static_l_desc;
let static_d_desc;
let static_bl_desc;


function TreeDesc(dyn_tree, stat_desc) {
  this.dyn_tree = dyn_tree;     /* the dynamic tree */
  this.max_code = 0;            /* largest code with non zero frequency */
  this.stat_desc = stat_desc;   /* the corresponding static tree */
}



const d_code = (dist) => {

  return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
};


/* ===========================================================================
 * Output a short LSB first on the stream.
 * IN assertion: there is enough room in pendingBuf.
 */
const put_short = (s, w) => {
//    put_byte(s, (uch)((w) & 0xff));
//    put_byte(s, (uch)((ush)(w) >> 8));
  s.pending_buf[s.pending++] = (w) & 0xff;
  s.pending_buf[s.pending++] = (w >>> 8) & 0xff;
};


/* ===========================================================================
 * Send a value on a given number of bits.
 * IN assertion: length <= 16 and value fits in length bits.
 */
const send_bits = (s, value, length) => {

  if (s.bi_valid > (Buf_size - length)) {
    s.bi_buf |= (value << s.bi_valid) & 0xffff;
    put_short(s, s.bi_buf);
    s.bi_buf = value >> (Buf_size - s.bi_valid);
    s.bi_valid += length - Buf_size;
  } else {
    s.bi_buf |= (value << s.bi_valid) & 0xffff;
    s.bi_valid += length;
  }
};


const send_code = (s, c, tree) => {

  send_bits(s, tree[c * 2]/*.Code*/, tree[c * 2 + 1]/*.Len*/);
};


/* ===========================================================================
 * Reverse the first len bits of a code, using straightforward code (a faster
 * method would use a table)
 * IN assertion: 1 <= len <= 15
 */
const bi_reverse = (code, len) => {

  let res = 0;
  do {
    res |= code & 1;
    code >>>= 1;
    res <<= 1;
  } while (--len > 0);
  return res >>> 1;
};


/* ===========================================================================
 * Flush the bit buffer, keeping at most 7 bits in it.
 */
const bi_flush = (s) => {

  if (s.bi_valid === 16) {
    put_short(s, s.bi_buf);
    s.bi_buf = 0;
    s.bi_valid = 0;

  } else if (s.bi_valid >= 8) {
    s.pending_buf[s.pending++] = s.bi_buf & 0xff;
    s.bi_buf >>= 8;
    s.bi_valid -= 8;
  }
};


/* ===========================================================================
 * Compute the optimal bit lengths for a tree and update the total bit length
 * for the current block.
 * IN assertion: the fields freq and dad are set, heap[heap_max] and
 *    above are the tree nodes sorted by increasing frequency.
 * OUT assertions: the field len is set to the optimal bit length, the
 *     array bl_count contains the frequencies for each bit length.
 *     The length opt_len is updated; static_len is also updated if stree is
 *     not null.
 */
const gen_bitlen = (s, desc) => {
//    deflate_state *s;
//    tree_desc *desc;    /* the tree descriptor */

  const tree            = desc.dyn_tree;
  const max_code        = desc.max_code;
  const stree           = desc.stat_desc.static_tree;
  const has_stree       = desc.stat_desc.has_stree;
  const extra           = desc.stat_desc.extra_bits;
  const base            = desc.stat_desc.extra_base;
  const max_length      = desc.stat_desc.max_length;
  let h;              /* heap index */
  let n, m;           /* iterate over the tree elements */
  let bits;           /* bit length */
  let xbits;          /* extra bits */
  let f;              /* frequency */
  let overflow = 0;   /* number of elements with bit length too large */

  for (bits = 0; bits <= MAX_BITS; bits++) {
    s.bl_count[bits] = 0;
  }

  /* In a first pass, compute the optimal bit lengths (which may
   * overflow in the case of the bit length tree).
   */
  tree[s.heap[s.heap_max] * 2 + 1]/*.Len*/ = 0; /* root of the heap */

  for (h = s.heap_max + 1; h < HEAP_SIZE; h++) {
    n = s.heap[h];
    bits = tree[tree[n * 2 + 1]/*.Dad*/ * 2 + 1]/*.Len*/ + 1;
    if (bits > max_length) {
      bits = max_length;
      overflow++;
    }
    tree[n * 2 + 1]/*.Len*/ = bits;
    /* We overwrite tree[n].Dad which is no longer needed */

    if (n > max_code) { continue; } /* not a leaf node */

    s.bl_count[bits]++;
    xbits = 0;
    if (n >= base) {
      xbits = extra[n - base];
    }
    f = tree[n * 2]/*.Freq*/;
    s.opt_len += f * (bits + xbits);
    if (has_stree) {
      s.static_len += f * (stree[n * 2 + 1]/*.Len*/ + xbits);
    }
  }
  if (overflow === 0) { return; }

  // Tracev((stderr,"\nbit length overflow\n"));
  /* This happens for example on obj2 and pic of the Calgary corpus */

  /* Find the first bit length which could increase: */
  do {
    bits = max_length - 1;
    while (s.bl_count[bits] === 0) { bits--; }
    s.bl_count[bits]--;      /* move one leaf down the tree */
    s.bl_count[bits + 1] += 2; /* move one overflow item as its brother */
    s.bl_count[max_length]--;
    /* The brother of the overflow item also moves one step up,
     * but this does not affect bl_count[max_length]
     */
    overflow -= 2;
  } while (overflow > 0);

  /* Now recompute all bit lengths, scanning in increasing frequency.
   * h is still equal to HEAP_SIZE. (It is simpler to reconstruct all
   * lengths instead of fixing only the wrong ones. This idea is taken
   * from 'ar' written by Haruhiko Okumura.)
   */
  for (bits = max_length; bits !== 0; bits--) {
    n = s.bl_count[bits];
    while (n !== 0) {
      m = s.heap[--h];
      if (m > max_code) { continue; }
      if (tree[m * 2 + 1]/*.Len*/ !== bits) {
        // Tracev((stderr,"code %d bits %d->%d\n", m, tree[m].Len, bits));
        s.opt_len += (bits - tree[m * 2 + 1]/*.Len*/) * tree[m * 2]/*.Freq*/;
        tree[m * 2 + 1]/*.Len*/ = bits;
      }
      n--;
    }
  }
};


/* ===========================================================================
 * Generate the codes for a given tree and bit counts (which need not be
 * optimal).
 * IN assertion: the array bl_count contains the bit length statistics for
 * the given tree and the field len is set for all tree elements.
 * OUT assertion: the field code is set for all tree elements of non
 *     zero code length.
 */
const gen_codes = (tree, max_code, bl_count) => {
//    ct_data *tree;             /* the tree to decorate */
//    int max_code;              /* largest code with non zero frequency */
//    ushf *bl_count;            /* number of codes at each bit length */

  const next_code = new Array(MAX_BITS + 1); /* next code value for each bit length */
  let code = 0;              /* running code value */
  let bits;                  /* bit index */
  let n;                     /* code index */

  /* The distribution counts are first used to generate the code values
   * without bit reversal.
   */
  for (bits = 1; bits <= MAX_BITS; bits++) {
    code = (code + bl_count[bits - 1]) << 1;
    next_code[bits] = code;
  }
  /* Check that the bit counts in bl_count are consistent. The last code
   * must be all ones.
   */
  //Assert (code + bl_count[MAX_BITS]-1 == (1<<MAX_BITS)-1,
  //        "inconsistent bit counts");
  //Tracev((stderr,"\ngen_codes: max_code %d ", max_code));

  for (n = 0;  n <= max_code; n++) {
    let len = tree[n * 2 + 1]/*.Len*/;
    if (len === 0) { continue; }
    /* Now reverse the bits */
    tree[n * 2]/*.Code*/ = bi_reverse(next_code[len]++, len);

    //Tracecv(tree != static_ltree, (stderr,"\nn %3d %c l %2d c %4x (%x) ",
    //     n, (isgraph(n) ? n : ' '), len, tree[n].Code, next_code[len]-1));
  }
};


/* ===========================================================================
 * Initialize the various 'constant' tables.
 */
const tr_static_init = () => {

  let n;        /* iterates over tree elements */
  let bits;     /* bit counter */
  let length;   /* length value */
  let code;     /* code value */
  let dist;     /* distance index */
  const bl_count = new Array(MAX_BITS + 1);
  /* number of codes at each bit length for an optimal tree */

  // do check in _tr_init()
  //if (static_init_done) return;

  /* For some embedded targets, global variables are not initialized: */
/*#ifdef NO_INIT_GLOBAL_POINTERS
  static_l_desc.static_tree = static_ltree;
  static_l_desc.extra_bits = extra_lbits;
  static_d_desc.static_tree = static_dtree;
  static_d_desc.extra_bits = extra_dbits;
  static_bl_desc.extra_bits = extra_blbits;
#endif*/

  /* Initialize the mapping length (0..255) -> length code (0..28) */
  length = 0;
  for (code = 0; code < LENGTH_CODES - 1; code++) {
    base_length[code] = length;
    for (n = 0; n < (1 << extra_lbits[code]); n++) {
      _length_code[length++] = code;
    }
  }
  //Assert (length == 256, "tr_static_init: length != 256");
  /* Note that the length 255 (match length 258) can be represented
   * in two different ways: code 284 + 5 bits or code 285, so we
   * overwrite length_code[255] to use the best encoding:
   */
  _length_code[length - 1] = code;

  /* Initialize the mapping dist (0..32K) -> dist code (0..29) */
  dist = 0;
  for (code = 0; code < 16; code++) {
    base_dist[code] = dist;
    for (n = 0; n < (1 << extra_dbits[code]); n++) {
      _dist_code[dist++] = code;
    }
  }
  //Assert (dist == 256, "tr_static_init: dist != 256");
  dist >>= 7; /* from now on, all distances are divided by 128 */
  for (; code < D_CODES; code++) {
    base_dist[code] = dist << 7;
    for (n = 0; n < (1 << (extra_dbits[code] - 7)); n++) {
      _dist_code[256 + dist++] = code;
    }
  }
  //Assert (dist == 256, "tr_static_init: 256+dist != 512");

  /* Construct the codes of the static literal tree */
  for (bits = 0; bits <= MAX_BITS; bits++) {
    bl_count[bits] = 0;
  }

  n = 0;
  while (n <= 143) {
    static_ltree[n * 2 + 1]/*.Len*/ = 8;
    n++;
    bl_count[8]++;
  }
  while (n <= 255) {
    static_ltree[n * 2 + 1]/*.Len*/ = 9;
    n++;
    bl_count[9]++;
  }
  while (n <= 279) {
    static_ltree[n * 2 + 1]/*.Len*/ = 7;
    n++;
    bl_count[7]++;
  }
  while (n <= 287) {
    static_ltree[n * 2 + 1]/*.Len*/ = 8;
    n++;
    bl_count[8]++;
  }
  /* Codes 286 and 287 do not exist, but we must include them in the
   * tree construction to get a canonical Huffman tree (longest code
   * all ones)
   */
  gen_codes(static_ltree, L_CODES + 1, bl_count);

  /* The static distance tree is trivial: */
  for (n = 0; n < D_CODES; n++) {
    static_dtree[n * 2 + 1]/*.Len*/ = 5;
    static_dtree[n * 2]/*.Code*/ = bi_reverse(n, 5);
  }

  // Now data ready and we can init static trees
  static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS + 1, L_CODES, MAX_BITS);
  static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0,          D_CODES, MAX_BITS);
  static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0,         BL_CODES, MAX_BL_BITS);

  //static_init_done = true;
};


/* ===========================================================================
 * Initialize a new block.
 */
const init_block = (s) => {

  let n; /* iterates over tree elements */

  /* Initialize the trees. */
  for (n = 0; n < L_CODES;  n++) { s.dyn_ltree[n * 2]/*.Freq*/ = 0; }
  for (n = 0; n < D_CODES;  n++) { s.dyn_dtree[n * 2]/*.Freq*/ = 0; }
  for (n = 0; n < BL_CODES; n++) { s.bl_tree[n * 2]/*.Freq*/ = 0; }

  s.dyn_ltree[END_BLOCK * 2]/*.Freq*/ = 1;
  s.opt_len = s.static_len = 0;
  s.sym_next = s.matches = 0;
};


/* ===========================================================================
 * Flush the bit buffer and align the output on a byte boundary
 */
const bi_windup = (s) =>
{
  if (s.bi_valid > 8) {
    put_short(s, s.bi_buf);
  } else if (s.bi_valid > 0) {
    //put_byte(s, (Byte)s->bi_buf);
    s.pending_buf[s.pending++] = s.bi_buf;
  }
  s.bi_buf = 0;
  s.bi_valid = 0;
};

/* ===========================================================================
 * Compares to subtrees, using the tree depth as tie breaker when
 * the subtrees have equal frequency. This minimizes the worst case length.
 */
const smaller = (tree, n, m, depth) => {

  const _n2 = n * 2;
  const _m2 = m * 2;
  return (tree[_n2]/*.Freq*/ < tree[_m2]/*.Freq*/ ||
         (tree[_n2]/*.Freq*/ === tree[_m2]/*.Freq*/ && depth[n] <= depth[m]));
};

/* ===========================================================================
 * Restore the heap property by moving down the tree starting at node k,
 * exchanging a node with the smallest of its two sons if necessary, stopping
 * when the heap property is re-established (each father smaller than its
 * two sons).
 */
const pqdownheap = (s, tree, k) => {
//    deflate_state *s;
//    ct_data *tree;  /* the tree to restore */
//    int k;               /* node to move down */

  const v = s.heap[k];
  let j = k << 1;  /* left son of k */
  while (j <= s.heap_len) {
    /* Set j to the smallest of the two sons: */
    if (j < s.heap_len &&
      smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
      j++;
    }
    /* Exit if v is smaller than both sons */
    if (smaller(tree, v, s.heap[j], s.depth)) { break; }

    /* Exchange v with the smallest son */
    s.heap[k] = s.heap[j];
    k = j;

    /* And continue down the tree, setting j to the left son of k */
    j <<= 1;
  }
  s.heap[k] = v;
};


// inlined manually
// const SMALLEST = 1;

/* ===========================================================================
 * Send the block data compressed using the given Huffman trees
 */
const compress_block = (s, ltree, dtree) => {
//    deflate_state *s;
//    const ct_data *ltree; /* literal tree */
//    const ct_data *dtree; /* distance tree */

  let dist;           /* distance of matched string */
  let lc;             /* match length or unmatched char (if dist == 0) */
  let sx = 0;         /* running index in sym_buf */
  let code;           /* the code to send */
  let extra;          /* number of extra bits to send */

  if (s.sym_next !== 0) {
    do {
      dist = s.pending_buf[s.sym_buf + sx++] & 0xff;
      dist += (s.pending_buf[s.sym_buf + sx++] & 0xff) << 8;
      lc = s.pending_buf[s.sym_buf + sx++];
      if (dist === 0) {
        send_code(s, lc, ltree); /* send a literal byte */
        //Tracecv(isgraph(lc), (stderr," '%c' ", lc));
      } else {
        /* Here, lc is the match length - MIN_MATCH */
        code = _length_code[lc];
        send_code(s, code + LITERALS + 1, ltree); /* send the length code */
        extra = extra_lbits[code];
        if (extra !== 0) {
          lc -= base_length[code];
          send_bits(s, lc, extra);       /* send the extra length bits */
        }
        dist--; /* dist is now the match distance - 1 */
        code = d_code(dist);
        //Assert (code < D_CODES, "bad d_code");

        send_code(s, code, dtree);       /* send the distance code */
        extra = extra_dbits[code];
        if (extra !== 0) {
          dist -= base_dist[code];
          send_bits(s, dist, extra);   /* send the extra distance bits */
        }
      } /* literal or match pair ? */

      /* Check that the overlay between pending_buf and sym_buf is ok: */
      //Assert(s->pending < s->lit_bufsize + sx, "pendingBuf overflow");

    } while (sx < s.sym_next);
  }

  send_code(s, END_BLOCK, ltree);
};


/* ===========================================================================
 * Construct one Huffman tree and assigns the code bit strings and lengths.
 * Update the total bit length for the current block.
 * IN assertion: the field freq is set for all tree elements.
 * OUT assertions: the fields len and code are set to the optimal bit length
 *     and corresponding code. The length opt_len is updated; static_len is
 *     also updated if stree is not null. The field max_code is set.
 */
const build_tree = (s, desc) => {
//    deflate_state *s;
//    tree_desc *desc; /* the tree descriptor */

  const tree     = desc.dyn_tree;
  const stree    = desc.stat_desc.static_tree;
  const has_stree = desc.stat_desc.has_stree;
  const elems    = desc.stat_desc.elems;
  let n, m;          /* iterate over heap elements */
  let max_code = -1; /* largest code with non zero frequency */
  let node;          /* new node being created */

  /* Construct the initial heap, with least frequent element in
   * heap[SMALLEST]. The sons of heap[n] are heap[2*n] and heap[2*n+1].
   * heap[0] is not used.
   */
  s.heap_len = 0;
  s.heap_max = HEAP_SIZE;

  for (n = 0; n < elems; n++) {
    if (tree[n * 2]/*.Freq*/ !== 0) {
      s.heap[++s.heap_len] = max_code = n;
      s.depth[n] = 0;

    } else {
      tree[n * 2 + 1]/*.Len*/ = 0;
    }
  }

  /* The pkzip format requires that at least one distance code exists,
   * and that at least one bit should be sent even if there is only one
   * possible code. So to avoid special checks later on we force at least
   * two codes of non zero frequency.
   */
  while (s.heap_len < 2) {
    node = s.heap[++s.heap_len] = (max_code < 2 ? ++max_code : 0);
    tree[node * 2]/*.Freq*/ = 1;
    s.depth[node] = 0;
    s.opt_len--;

    if (has_stree) {
      s.static_len -= stree[node * 2 + 1]/*.Len*/;
    }
    /* node is 0 or 1 so it does not have extra bits */
  }
  desc.max_code = max_code;

  /* The elements heap[heap_len/2+1 .. heap_len] are leaves of the tree,
   * establish sub-heaps of increasing lengths:
   */
  for (n = (s.heap_len >> 1/*int /2*/); n >= 1; n--) { pqdownheap(s, tree, n); }

  /* Construct the Huffman tree by repeatedly combining the least two
   * frequent nodes.
   */
  node = elems;              /* next internal node of the tree */
  do {
    //pqremove(s, tree, n);  /* n = node of least frequency */
    /*** pqremove ***/
    n = s.heap[1/*SMALLEST*/];
    s.heap[1/*SMALLEST*/] = s.heap[s.heap_len--];
    pqdownheap(s, tree, 1/*SMALLEST*/);
    /***/

    m = s.heap[1/*SMALLEST*/]; /* m = node of next least frequency */

    s.heap[--s.heap_max] = n; /* keep the nodes sorted by frequency */
    s.heap[--s.heap_max] = m;

    /* Create a new node father of n and m */
    tree[node * 2]/*.Freq*/ = tree[n * 2]/*.Freq*/ + tree[m * 2]/*.Freq*/;
    s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
    tree[n * 2 + 1]/*.Dad*/ = tree[m * 2 + 1]/*.Dad*/ = node;

    /* and insert the new node in the heap */
    s.heap[1/*SMALLEST*/] = node++;
    pqdownheap(s, tree, 1/*SMALLEST*/);

  } while (s.heap_len >= 2);

  s.heap[--s.heap_max] = s.heap[1/*SMALLEST*/];

  /* At this point, the fields freq and dad are set. We can now
   * generate the bit lengths.
   */
  gen_bitlen(s, desc);

  /* The field len is now set, we can generate the bit codes */
  gen_codes(tree, max_code, s.bl_count);
};


/* ===========================================================================
 * Scan a literal or distance tree to determine the frequencies of the codes
 * in the bit length tree.
 */
const scan_tree = (s, tree, max_code) => {
//    deflate_state *s;
//    ct_data *tree;   /* the tree to be scanned */
//    int max_code;    /* and its largest code of non zero frequency */

  let n;                     /* iterates over all tree elements */
  let prevlen = -1;          /* last emitted length */
  let curlen;                /* length of current code */

  let nextlen = tree[0 * 2 + 1]/*.Len*/; /* length of next code */

  let count = 0;             /* repeat count of the current code */
  let max_count = 7;         /* max repeat count */
  let min_count = 4;         /* min repeat count */

  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }
  tree[(max_code + 1) * 2 + 1]/*.Len*/ = 0xffff; /* guard */

  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1]/*.Len*/;

    if (++count < max_count && curlen === nextlen) {
      continue;

    } else if (count < min_count) {
      s.bl_tree[curlen * 2]/*.Freq*/ += count;

    } else if (curlen !== 0) {

      if (curlen !== prevlen) { s.bl_tree[curlen * 2]/*.Freq*/++; }
      s.bl_tree[REP_3_6 * 2]/*.Freq*/++;

    } else if (count <= 10) {
      s.bl_tree[REPZ_3_10 * 2]/*.Freq*/++;

    } else {
      s.bl_tree[REPZ_11_138 * 2]/*.Freq*/++;
    }

    count = 0;
    prevlen = curlen;

    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;

    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;

    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};


/* ===========================================================================
 * Send a literal or distance tree in compressed form, using the codes in
 * bl_tree.
 */
const send_tree = (s, tree, max_code) => {
//    deflate_state *s;
//    ct_data *tree; /* the tree to be scanned */
//    int max_code;       /* and its largest code of non zero frequency */

  let n;                     /* iterates over all tree elements */
  let prevlen = -1;          /* last emitted length */
  let curlen;                /* length of current code */

  let nextlen = tree[0 * 2 + 1]/*.Len*/; /* length of next code */

  let count = 0;             /* repeat count of the current code */
  let max_count = 7;         /* max repeat count */
  let min_count = 4;         /* min repeat count */

  /* tree[max_code+1].Len = -1; */  /* guard already set */
  if (nextlen === 0) {
    max_count = 138;
    min_count = 3;
  }

  for (n = 0; n <= max_code; n++) {
    curlen = nextlen;
    nextlen = tree[(n + 1) * 2 + 1]/*.Len*/;

    if (++count < max_count && curlen === nextlen) {
      continue;

    } else if (count < min_count) {
      do { send_code(s, curlen, s.bl_tree); } while (--count !== 0);

    } else if (curlen !== 0) {
      if (curlen !== prevlen) {
        send_code(s, curlen, s.bl_tree);
        count--;
      }
      //Assert(count >= 3 && count <= 6, " 3_6?");
      send_code(s, REP_3_6, s.bl_tree);
      send_bits(s, count - 3, 2);

    } else if (count <= 10) {
      send_code(s, REPZ_3_10, s.bl_tree);
      send_bits(s, count - 3, 3);

    } else {
      send_code(s, REPZ_11_138, s.bl_tree);
      send_bits(s, count - 11, 7);
    }

    count = 0;
    prevlen = curlen;
    if (nextlen === 0) {
      max_count = 138;
      min_count = 3;

    } else if (curlen === nextlen) {
      max_count = 6;
      min_count = 3;

    } else {
      max_count = 7;
      min_count = 4;
    }
  }
};


/* ===========================================================================
 * Construct the Huffman tree for the bit lengths and return the index in
 * bl_order of the last bit length code to send.
 */
const build_bl_tree = (s) => {

  let max_blindex;  /* index of last bit length code of non zero freq */

  /* Determine the bit length frequencies for literal and distance trees */
  scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
  scan_tree(s, s.dyn_dtree, s.d_desc.max_code);

  /* Build the bit length tree: */
  build_tree(s, s.bl_desc);
  /* opt_len now includes the length of the tree representations, except
   * the lengths of the bit lengths codes and the 5+5+4 bits for the counts.
   */

  /* Determine the number of bit length codes to send. The pkzip format
   * requires that at least 4 bit length codes be sent. (appnote.txt says
   * 3 but the actual value used is 4.)
   */
  for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) {
    if (s.bl_tree[bl_order[max_blindex] * 2 + 1]/*.Len*/ !== 0) {
      break;
    }
  }
  /* Update opt_len to include the bit length tree and counts */
  s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
  //Tracev((stderr, "\ndyn trees: dyn %ld, stat %ld",
  //        s->opt_len, s->static_len));

  return max_blindex;
};


/* ===========================================================================
 * Send the header for a block using dynamic Huffman trees: the counts, the
 * lengths of the bit length codes, the literal tree and the distance tree.
 * IN assertion: lcodes >= 257, dcodes >= 1, blcodes >= 4.
 */
const send_all_trees = (s, lcodes, dcodes, blcodes) => {
//    deflate_state *s;
//    int lcodes, dcodes, blcodes; /* number of codes for each tree */

  let rank;                    /* index in bl_order */

  //Assert (lcodes >= 257 && dcodes >= 1 && blcodes >= 4, "not enough codes");
  //Assert (lcodes <= L_CODES && dcodes <= D_CODES && blcodes <= BL_CODES,
  //        "too many codes");
  //Tracev((stderr, "\nbl counts: "));
  send_bits(s, lcodes - 257, 5); /* not +255 as stated in appnote.txt */
  send_bits(s, dcodes - 1,   5);
  send_bits(s, blcodes - 4,  4); /* not -3 as stated in appnote.txt */
  for (rank = 0; rank < blcodes; rank++) {
    //Tracev((stderr, "\nbl code %2d ", bl_order[rank]));
    send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1]/*.Len*/, 3);
  }
  //Tracev((stderr, "\nbl tree: sent %ld", s->bits_sent));

  send_tree(s, s.dyn_ltree, lcodes - 1); /* literal tree */
  //Tracev((stderr, "\nlit tree: sent %ld", s->bits_sent));

  send_tree(s, s.dyn_dtree, dcodes - 1); /* distance tree */
  //Tracev((stderr, "\ndist tree: sent %ld", s->bits_sent));
};


/* ===========================================================================
 * Check if the data type is TEXT or BINARY, using the following algorithm:
 * - TEXT if the two conditions below are satisfied:
 *    a) There are no non-portable control characters belonging to the
 *       "block list" (0..6, 14..25, 28..31).
 *    b) There is at least one printable character belonging to the
 *       "allow list" (9 {TAB}, 10 {LF}, 13 {CR}, 32..255).
 * - BINARY otherwise.
 * - The following partially-portable control characters form a
 *   "gray list" that is ignored in this detection algorithm:
 *   (7 {BEL}, 8 {BS}, 11 {VT}, 12 {FF}, 26 {SUB}, 27 {ESC}).
 * IN assertion: the fields Freq of dyn_ltree are set.
 */
const detect_data_type = (s) => {
  /* block_mask is the bit mask of block-listed bytes
   * set bits 0..6, 14..25, and 28..31
   * 0xf3ffc07f = binary 11110011111111111100000001111111
   */
  let block_mask = 0xf3ffc07f;
  let n;

  /* Check for non-textual ("block-listed") bytes. */
  for (n = 0; n <= 31; n++, block_mask >>>= 1) {
    if ((block_mask & 1) && (s.dyn_ltree[n * 2]/*.Freq*/ !== 0)) {
      return Z_BINARY;
    }
  }

  /* Check for textual ("allow-listed") bytes. */
  if (s.dyn_ltree[9 * 2]/*.Freq*/ !== 0 || s.dyn_ltree[10 * 2]/*.Freq*/ !== 0 ||
      s.dyn_ltree[13 * 2]/*.Freq*/ !== 0) {
    return Z_TEXT;
  }
  for (n = 32; n < LITERALS; n++) {
    if (s.dyn_ltree[n * 2]/*.Freq*/ !== 0) {
      return Z_TEXT;
    }
  }

  /* There are no "block-listed" or "allow-listed" bytes:
   * this stream either is empty or has tolerated ("gray-listed") bytes only.
   */
  return Z_BINARY;
};


let static_init_done = false;

/* ===========================================================================
 * Initialize the tree data structures for a new zlib stream.
 */
const _tr_init = (s) =>
{

  if (!static_init_done) {
    tr_static_init();
    static_init_done = true;
  }

  s.l_desc  = new TreeDesc(s.dyn_ltree, static_l_desc);
  s.d_desc  = new TreeDesc(s.dyn_dtree, static_d_desc);
  s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);

  s.bi_buf = 0;
  s.bi_valid = 0;

  /* Initialize the first block of the first file: */
  init_block(s);
};


/* ===========================================================================
 * Send a stored block
 */
const _tr_stored_block = (s, buf, stored_len, last) => {
//DeflateState *s;
//charf *buf;       /* input block */
//ulg stored_len;   /* length of input block */
//int last;         /* one if this is the last block for a file */

  send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);    /* send block type */
  bi_windup(s);        /* align on byte boundary */
  put_short(s, stored_len);
  put_short(s, ~stored_len);
  if (stored_len) {
    s.pending_buf.set(s.window.subarray(buf, buf + stored_len), s.pending);
  }
  s.pending += stored_len;
};


/* ===========================================================================
 * Send one empty static block to give enough lookahead for inflate.
 * This takes 10 bits, of which 7 may remain in the bit buffer.
 */
const _tr_align = (s) => {
  send_bits(s, STATIC_TREES << 1, 3);
  send_code(s, END_BLOCK, static_ltree);
  bi_flush(s);
};


/* ===========================================================================
 * Determine the best encoding for the current block: dynamic trees, static
 * trees or store, and write out the encoded block.
 */
const _tr_flush_block = (s, buf, stored_len, last) => {
//DeflateState *s;
//charf *buf;       /* input block, or NULL if too old */
//ulg stored_len;   /* length of input block */
//int last;         /* one if this is the last block for a file */

  let opt_lenb, static_lenb;  /* opt_len and static_len in bytes */
  let max_blindex = 0;        /* index of last bit length code of non zero freq */

  /* Build the Huffman trees unless a stored block is forced */
  if (s.level > 0) {

    /* Check if the file is binary or text */
    if (s.strm.data_type === Z_UNKNOWN) {
      s.strm.data_type = detect_data_type(s);
    }

    /* Construct the literal and distance trees */
    build_tree(s, s.l_desc);
    // Tracev((stderr, "\nlit data: dyn %ld, stat %ld", s->opt_len,
    //        s->static_len));

    build_tree(s, s.d_desc);
    // Tracev((stderr, "\ndist data: dyn %ld, stat %ld", s->opt_len,
    //        s->static_len));
    /* At this point, opt_len and static_len are the total bit lengths of
     * the compressed block data, excluding the tree representations.
     */

    /* Build the bit length tree for the above two trees, and get the index
     * in bl_order of the last bit length code to send.
     */
    max_blindex = build_bl_tree(s);

    /* Determine the best encoding. Compute the block lengths in bytes. */
    opt_lenb = (s.opt_len + 3 + 7) >>> 3;
    static_lenb = (s.static_len + 3 + 7) >>> 3;

    // Tracev((stderr, "\nopt %lu(%lu) stat %lu(%lu) stored %lu lit %u ",
    //        opt_lenb, s->opt_len, static_lenb, s->static_len, stored_len,
    //        s->sym_next / 3));

    if (static_lenb <= opt_lenb) { opt_lenb = static_lenb; }

  } else {
    // Assert(buf != (char*)0, "lost buf");
    opt_lenb = static_lenb = stored_len + 5; /* force a stored block */
  }

  if ((stored_len + 4 <= opt_lenb) && (buf !== -1)) {
    /* 4: two words for the lengths */

    /* The test buf != NULL is only necessary if LIT_BUFSIZE > WSIZE.
     * Otherwise we can't have processed more than WSIZE input bytes since
     * the last block flush, because compression would have been
     * successful. If LIT_BUFSIZE <= WSIZE, it is never too late to
     * transform a block into a stored block.
     */
    _tr_stored_block(s, buf, stored_len, last);

  } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {

    send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
    compress_block(s, static_ltree, static_dtree);

  } else {
    send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
    send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
    compress_block(s, s.dyn_ltree, s.dyn_dtree);
  }
  // Assert (s->compressed_len == s->bits_sent, "bad compressed size");
  /* The above check is made mod 2^32, for files larger than 512 MB
   * and uLong implemented on 32 bits.
   */
  init_block(s);

  if (last) {
    bi_windup(s);
  }
  // Tracev((stderr,"\ncomprlen %lu(%lu) ", s->compressed_len>>3,
  //       s->compressed_len-7*last));
};

/* ===========================================================================
 * Save the match info and tally the frequency counts. Return true if
 * the current block must be flushed.
 */
const _tr_tally = (s, dist, lc) => {
//    deflate_state *s;
//    unsigned dist;  /* distance of matched string */
//    unsigned lc;    /* match length-MIN_MATCH or unmatched char (if dist==0) */

  s.pending_buf[s.sym_buf + s.sym_next++] = dist;
  s.pending_buf[s.sym_buf + s.sym_next++] = dist >> 8;
  s.pending_buf[s.sym_buf + s.sym_next++] = lc;
  if (dist === 0) {
    /* lc is the unmatched char */
    s.dyn_ltree[lc * 2]/*.Freq*/++;
  } else {
    s.matches++;
    /* Here, lc is the match length - MIN_MATCH */
    dist--;             /* dist = match distance - 1 */
    //Assert((ush)dist < (ush)MAX_DIST(s) &&
    //       (ush)lc <= (ush)(MAX_MATCH-MIN_MATCH) &&
    //       (ush)d_code(dist) < (ush)D_CODES,  "_tr_tally: bad match");

    s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]/*.Freq*/++;
    s.dyn_dtree[d_code(dist) * 2]/*.Freq*/++;
  }

  return (s.sym_next === s.sym_end);
};

module.exports._tr_init  = _tr_init;
module.exports._tr_stored_block = _tr_stored_block;
module.exports._tr_flush_block  = _tr_flush_block;
module.exports._tr_tally = _tr_tally;
module.exports._tr_align = _tr_align;

},{}],35:[function(require,module,exports){
'use strict';

// (C) 1995-2013 Jean-loup Gailly and Mark Adler
// (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin
//
// This software is provided 'as-is', without any express or implied
// warranty. In no event will the authors be held liable for any damages
// arising from the use of this software.
//
// Permission is granted to anyone to use this software for any purpose,
// including commercial applications, and to alter it and redistribute it
// freely, subject to the following restrictions:
//
// 1. The origin of this software must not be misrepresented; you must not
//   claim that you wrote the original software. If you use this software
//   in a product, an acknowledgment in the product documentation would be
//   appreciated but is not required.
// 2. Altered source versions must be plainly marked as such, and must not be
//   misrepresented as being the original software.
// 3. This notice may not be removed or altered from any source distribution.

function ZStream() {
  /* next input byte */
  this.input = null; // JS specific, because we have no pointers
  this.next_in = 0;
  /* number of bytes available at input */
  this.avail_in = 0;
  /* total number of input bytes read so far */
  this.total_in = 0;
  /* next output byte should be put there */
  this.output = null; // JS specific, because we have no pointers
  this.next_out = 0;
  /* remaining free space at output */
  this.avail_out = 0;
  /* total number of bytes output so far */
  this.total_out = 0;
  /* last error message, NULL if no error */
  this.msg = ''/*Z_NULL*/;
  /* not visible by applications */
  this.state = null;
  /* best guess about the data type: binary or text */
  this.data_type = 2/*Z_UNKNOWN*/;
  /* adler32 value of the uncompressed data */
  this.adler = 0;
}

module.exports = ZStream;

},{}]},{},[10])(10)
});
