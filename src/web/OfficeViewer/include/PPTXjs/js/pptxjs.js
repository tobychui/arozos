/**
 * pptxjs.js
 * Ver. : 1.10.4
 * last update: 14/05/2020
 * Author: meshesha , https://github.com/meshesha
 * LICENSE: MIT
 * url:https://meshesha.github.io/pptxjs
 * New: 
 *  - fixed security issue
 *  - new divs2slides (v.1.3.2)
 *  - fixed div width issue
 */

(function ($) {
    $.fn.pptxToHtml = function (options) {
        //var worker;
        var $result = $(this);
        var divId = $result.attr("id");

        var isDone = false;

        var MsgQueue = new Array();

        var themeContent = null;

        var slideLayoutClrOvride = "";

        var chartID = 0;
        var _order = 1;
        var titleFontSize = 42;
        var bodyFontSize = 20;
        var otherFontSize = 16;
        var isSlideMode = false;
        var styleTable = {};
        var settings = $.extend(true, {
            // These are the defaults.
            pptxFileUrl: "",
            fileInputId: "",
            slidesScale: "", //Change Slides scale by percent
            slideMode: false, /** true,false*/
            keyBoardShortCut: false,  /** true,false ,condition: slideMode: true XXXXX - need to remove - this is doublcated*/
            mediaProcess: true, /** true,false: if true then process video and audio files */
            jsZipV2: false,
            slideModeConfig: {
                first: 1,
                nav: true, /** true,false : show or not nav buttons*/
                navTxtColor: "black", /** color */
                keyBoardShortCut: true, /** true,false ,condition: */
                showSlideNum: true, /** true,false */
                showTotalSlideNum: true, /** true,false */
                autoSlide: true, /** false or seconds , F8 to active ,keyBoardShortCut: true */
                randomAutoSlide: false, /** true,false ,autoSlide:true */
                loop: false,  /** true,false */
                background: false, /** false or color*/
                transition: "default", /** transition type: "slid","fade","default","random" , to show transition efects :transitionTime > 0.5 */
                transitionTime: 1 /** transition time between slides in seconds */
            }
        }, options);
        //
        $("#" + divId).prepend(
            $("<span></span>").attr({
                "class": "slides-loadnig-msg",
                "style": "display:block; color:#e0e0e0; font-size:20px; width:50%; margin:0 auto;"
            }).html("Loading...")
        );
        if (settings.slideMode) {
            if (!jQuery().divs2slides) {
                jQuery.getScript('./js/divs2slides.js');
            }
        }
        if (settings.jsZipV2 !== false) {
            jQuery.getScript(settings.jsZipV2);
            if (localStorage.getItem('isPPTXjsReLoaded') !== 'yes') {
                localStorage.setItem('isPPTXjsReLoaded', 'yes');
                location.reload();
            }
        }

        if (settings.keyBoardShortCut) {
            $(document).bind("keydown", function (event) {
                event.preventDefault();
                var key = event.keyCode;
                console.log(key, isDone)
                if (key == 116 && !isSlideMode) { //F5
                    isSlideMode = true;
                    $("#" + divId + " .slide").hide();
                    setTimeout(function () {
                        //if(isDone){
                        var slideConf = settings.slideModeConfig;
                        //console.log(key,isDone,slideConf)
                        $(".slides-loadnig-msg").remove()
                        $("#" + divId).divs2slides({
                            first: slideConf.first,
                            nav: slideConf.nav,
                            showPlayPauseBtn: settings.showPlayPauseBtn,
                            navTxtColor: slideConf.navTxtColor,
                            keyBoardShortCut: slideConf.keyBoardShortCut,
                            showSlideNum: slideConf.showSlideNum,
                            showTotalSlideNum: slideConf.showTotalSlideNum,
                            autoSlide: slideConf.autoSlide,
                            randomAutoSlide: slideConf.randomAutoSlide,
                            loop: slideConf.loop,
                            background: slideConf.background,
                            transition: slideConf.transition,
                            transitionTime: slideConf.transitionTime
                        });
                        //}

                        var sScale = settings.slidesScale;
                        var trnsfrmScl = "";
                        if (sScale != "") {
                            var numsScale = parseInt(sScale);
                            var scaleVal = numsScale / 100;
                            trnsfrmScl = 'transform:scale(' + scaleVal + '); transform-origin:top';
                        }

                        var numOfSlides = 1;
                        var sScaleVal = (sScale != "") ? scaleVal : 1;
                        var slidesHeight = $("#" + divId + " .slide").height();
                        //console.log(slidesHeight);
                        $("#all_slides_warpper").attr({
                            style: trnsfrmScl  /*+ ";height: " + (numOfSlides * slidesHeight * sScaleVal) + "px"*/
                        })
                    }, 1500);
                } else if (key == 116 && isSlideMode) {
                    //exit slide mode - TODO

                }
            });
        }
        if (settings.pptxFileUrl != "") {
            JSZipUtils.getBinaryContent(settings.pptxFileUrl, function (err, content) {
                var blob = new Blob([content]);
                var file_name = settings.pptxFileUrl;
                var fArry = file_name.split(".");
                fArry.pop();
                blob.name = fArry[0];
                FileReaderJS.setupBlob(blob, {
                    readAsDefault: "ArrayBuffer",
                    on: {
                        load: function (e, file) {
                            //console.log(e.target.result);
                            convertToHtml(e.target.result);
                        }
                    }
                });
            });
        } else {
            $(".slides-loadnig-msg").remove()
        }
        if (settings.fileInputId != "") {
            $("#" + settings.fileInputId).on("change", function (evt) {
                $result.html("");
                var file = evt.target.files[0];
                // var fileName = file[0].name;
                //var fileSize = file[0].size;
                var fileType = file.type;
                if (fileType == "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
                    FileReaderJS.setupBlob(file, {
                        readAsDefault: "ArrayBuffer",
                        on: {
                            load: function (e, file) {
                                //console.log(e.target.result);
                                convertToHtml(e.target.result);
                            }
                        }
                    });
                } else {
                    alert("This is not pptx file");
                }
            });
        }
        function convertToHtml(file) {
            //'use strict';
            var zip = new JSZip(), s;
            //if (typeof file === 'string') { // Load
            zip = zip.load(file);  //zip.load(file, { base64: true });
            var rslt_ary = processPPTX(zip);
            //s = readXmlFile(zip, 'ppt/tableStyles.xml');

            var slidesHeight = $("#" + divId + " .slide").height();

            for (var i = 0; i < rslt_ary.length; i++) {
                switch (rslt_ary[i]["type"]) {
                    case "slide":
                        $result.append(rslt_ary[i]["data"]);
                        break;
                    case "pptx-thumb":
                        //$("#pptx-thumb").attr("src", "data:image/jpeg;base64," +rslt_ary[i]["data"]);
                        break;
                    case "slideSize":
                        /*
                        var slideWidth = rslt_ary[i]["data"].width;
                        var slideHeight = rslt_ary[i]["data"].height;
                        $("#"+divId).css({
                            'width': slideWidth + 80,
                            'height': slideHeight + 60
                        });
                        */
                        break;
                    case "globalCSS":
                        $result.append("<style>" + rslt_ary[i]["data"] + "</style>");
                        break;
                    case "ExecutionTime":
                        // $result.prepend("<div id='presentation_toolbar'></div>");
                        processMsgQueue(MsgQueue);
                        setNumericBullets($(".block"));
                        setNumericBullets($("table td"));

                        isDone = true;

                        if (settings.slideMode && !isSlideMode) {
                            isSlideMode = true;
                            $("#" + divId + " .slide").hide();
                            setTimeout(function () {
                                var slideConf = settings.slideModeConfig;
                                $(".slides-loadnig-msg").remove();
                                $("#" + divId).divs2slides({
                                    first: slideConf.first,
                                    nav: slideConf.nav,
                                    showPlayPauseBtn: settings.showPlayPauseBtn,
                                    navTxtColor: slideConf.navTxtColor,
                                    keyBoardShortCut: slideConf.keyBoardShortCut,
                                    showSlideNum: slideConf.showSlideNum,
                                    showTotalSlideNum: slideConf.showTotalSlideNum,
                                    autoSlide: slideConf.autoSlide,
                                    randomAutoSlide: slideConf.randomAutoSlide,
                                    loop: slideConf.loop,
                                    background: slideConf.background,
                                    transition: slideConf.transition,
                                    transitionTime: slideConf.transitionTime
                                });

                                var sScale = settings.slidesScale;
                                var trnsfrmScl = "";
                                if (sScale != "") {
                                    var numsScale = parseInt(sScale);
                                    var scaleVal = numsScale / 100;
                                    trnsfrmScl = 'transform:scale(' + scaleVal + '); transform-origin:top';
                                }

                                var numOfSlides = 1;
                                var sScaleVal = (sScale != "") ? scaleVal : 1;
                                //console.log(slidesHeight);
                                $("#all_slides_warpper").attr({
                                    style: trnsfrmScl + ";height: " + (numOfSlides * slidesHeight * sScaleVal) + "px"
                                })

                            }, 1500);
                        } else if (!settings.slideMode) {
                            $(".slides-loadnig-msg").remove();
                        }
                        break;
                    default:
                }
            }
            if (!settings.slideMode) {
                if (document.getElementById("all_slides_warpper") === null) {
                    $("#" + divId + " .slide").wrapAll("<div id='all_slides_warpper'></div>");
                }
            }
            var sScale = settings.slidesScale;
            var trnsfrmScl = "";
            if (sScale != "") {
                var numsScale = parseInt(sScale);
                var scaleVal = numsScale / 100;
                trnsfrmScl = 'transform:scale(' + scaleVal + '); transform-origin:top';
            }

            var slidesHeight = $("#" + divId + " .slide").height();
            var numOfSlides = $("#" + divId + " .slide").length;
            var sScaleVal = (sScale != "") ? scaleVal : 1;
            //console.log("slidesHeight: " + slidesHeight + "\nnumOfSlides: " + numOfSlides + "\nScale: " + sScaleVal)

            $("#all_slides_warpper").attr({
                style: trnsfrmScl + ";height: " + (numOfSlides * slidesHeight * sScaleVal) + "px"
            })

            //}
        }
        function processPPTX(zip) {
            var post_ary = [];
            var dateBefore = new Date();

            if (zip.file("docProps/thumbnail.jpeg") !== null) {
                var pptxThumbImg = base64ArrayBuffer(zip.file("docProps/thumbnail.jpeg").asArrayBuffer());
                post_ary.push({
                    "type": "pptx-thumb",
                    "data": pptxThumbImg
                });
            }

            var filesInfo = getContentTypes(zip);
            var slideSize = getSlideSize(zip);
            themeContent = loadTheme(zip);

            tableStyles = readXmlFile(zip, "ppt/tableStyles.xml");

            post_ary.push({
                "type": "slideSize",
                "data": slideSize
            });

            var numOfSlides = filesInfo["slides"].length;
            for (var i = 0; i < numOfSlides; i++) {
                var filename = filesInfo["slides"][i];
                var slideHtml = processSingleSlide(zip, filename, i, slideSize);
                post_ary.push({
                    "type": "slide",
                    "data": slideHtml
                });
                post_ary.push({
                    "type": "progress-update",
                    "data": (i + 1) * 100 / numOfSlides
                });
            }

            post_ary.push({
                "type": "globalCSS",
                "data": genGlobalCSS()
            });

            var dateAfter = new Date();
            post_ary.push({
                "type": "ExecutionTime",
                "data": dateAfter - dateBefore
            });
            return post_ary;
        }

        function readXmlFile(zip, filename) {
            var xmlData = tXml(zip.file(filename).asText(), { simplify: 1 });
            if (xmlData["?xml"] !== undefined) {
                return xmlData["?xml"];
            } else {
                return xmlData;
            }

        }
        function getContentTypes(zip) {
            var ContentTypesJson = readXmlFile(zip, "[Content_Types].xml");

            var subObj = ContentTypesJson["Types"]["Override"];
            var slidesLocArray = [];
            var slideLayoutsLocArray = [];
            for (var i = 0; i < subObj.length; i++) {
                switch (subObj[i]["attrs"]["ContentType"]) {
                    case "application/vnd.openxmlformats-officedocument.presentationml.slide+xml":
                        slidesLocArray.push(subObj[i]["attrs"]["PartName"].substr(1));
                        break;
                    case "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml":
                        slideLayoutsLocArray.push(subObj[i]["attrs"]["PartName"].substr(1));
                        break;
                    default:
                }
            }
            return {
                "slides": slidesLocArray,
                "slideLayouts": slideLayoutsLocArray
            };
        }

        function getSlideSize(zip) {
            // Pixel = EMUs * Resolution / 914400;  (Resolution = 96)
            var rtenObj = {};
            var content = readXmlFile(zip, "ppt/presentation.xml");
            var sldSzAttrs = content["p:presentation"]["p:sldSz"]["attrs"];
            //var cWidth = settings.width,
            //    cHeight = settings.height;
            //if(cWidth === false && cHeight === false){
            rtenObj = {
                "width": parseInt(sldSzAttrs["cx"]) * 96 / 914400,
                "height": parseInt(sldSzAttrs["cy"]) * 96 / 914400
            };
            /*    
            }else if(cWidth !== false && cHeight === false){
                rtenObj =  {
                    "width": cWidth,
                    "height": parseInt(sldSzAttrs["cy"]) * 96 / 914400
                };
            }else if(cWidth === false && cHeight !== false){
                rtenObj =  {
                    "width":  parseInt(sldSzAttrs["cx"]) * 96 / 914400,
                    "height": cHeight
                };
            }else{
                rtenObj =  {
                    "width":  cWidth,
                    "height": cHeight
                };

            }*/
            return rtenObj;
        }

        function loadTheme(zip) {
            var preResContent = readXmlFile(zip, "ppt/_rels/presentation.xml.rels");
            var relationshipArray = preResContent["Relationships"]["Relationship"];
            var themeURI = undefined;
            if (relationshipArray.constructor === Array) {
                for (var i = 0; i < relationshipArray.length; i++) {
                    if (relationshipArray[i]["attrs"]["Type"] === "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme") {
                        themeURI = relationshipArray[i]["attrs"]["Target"];
                        break;
                    }
                }
            } else if (relationshipArray["attrs"]["Type"] === "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme") {
                themeURI = relationshipArray["attrs"]["Target"];
            }

            if (themeURI === undefined) {
                throw Error("Can't open theme file.");
            }

            return readXmlFile(zip, "ppt/" + themeURI);
        }

        function processSingleSlide(zip, sldFileName, index, slideSize) {
            /*
            self.postMessage({
                "type": "INFO",
                "data": "Processing slide" + (index + 1)
            });
            */
            // =====< Step 1 >=====
            // Read relationship filename of the slide (Get slideLayoutXX.xml)
            // @sldFileName: ppt/slides/slide1.xml
            // @resName: ppt/slides/_rels/slide1.xml.rels
            var resName = sldFileName.replace("slides/slide", "slides/_rels/slide") + ".rels";
            var resContent = readXmlFile(zip, resName);
            var RelationshipArray = resContent["Relationships"]["Relationship"];
            var layoutFilename = "";
            var slideResObj = {};
            if (RelationshipArray.constructor === Array) {
                for (var i = 0; i < RelationshipArray.length; i++) {
                    switch (RelationshipArray[i]["attrs"]["Type"]) {
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout":
                            layoutFilename = RelationshipArray[i]["attrs"]["Target"].replace("../", "ppt/");
                            break;
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide":
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image":
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart":
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink":
                        default:
                            slideResObj[RelationshipArray[i]["attrs"]["Id"]] = {
                                "type": RelationshipArray[i]["attrs"]["Type"].replace("http://schemas.openxmlformats.org/officeDocument/2006/relationships/", ""),
                                "target": RelationshipArray[i]["attrs"]["Target"].replace("../", "ppt/")
                            };
                    }
                }
            } else {
                layoutFilename = RelationshipArray["attrs"]["Target"].replace("../", "ppt/");
            }
            //console.log(slideResObj);
            // Open slideLayoutXX.xml
            var slideLayoutContent = readXmlFile(zip, layoutFilename);
            var slideLayoutTables = indexNodes(slideLayoutContent);
            var sldLayoutClrOvr = slideLayoutContent["p:sldLayout"]["p:clrMapOvr"]["a:overrideClrMapping"];

            //console.log(slideLayoutClrOvride);
            if (sldLayoutClrOvr !== undefined) {
                slideLayoutClrOvride = sldLayoutClrOvr["attrs"];
            }
            // =====< Step 2 >=====
            // Read slide master filename of the slidelayout (Get slideMasterXX.xml)
            // @resName: ppt/slideLayouts/slideLayout1.xml
            // @masterName: ppt/slideLayouts/_rels/slideLayout1.xml.rels
            var slideLayoutResFilename = layoutFilename.replace("slideLayouts/slideLayout", "slideLayouts/_rels/slideLayout") + ".rels";
            var slideLayoutResContent = readXmlFile(zip, slideLayoutResFilename);
            RelationshipArray = slideLayoutResContent["Relationships"]["Relationship"];
            var masterFilename = "";
            var layoutResObj = {};
            if (RelationshipArray.constructor === Array) {
                for (var i = 0; i < RelationshipArray.length; i++) {
                    switch (RelationshipArray[i]["attrs"]["Type"]) {
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster":
                            masterFilename = RelationshipArray[i]["attrs"]["Target"].replace("../", "ppt/");
                            break;
                        default:
                            layoutResObj[RelationshipArray[i]["attrs"]["Id"]] = {
                                "type": RelationshipArray[i]["attrs"]["Type"].replace("http://schemas.openxmlformats.org/officeDocument/2006/relationships/", ""),
                                "target": RelationshipArray[i]["attrs"]["Target"].replace("../", "ppt/")
                            };
                    }
                }
            } else {
                masterFilename = RelationshipArray["attrs"]["Target"].replace("../", "ppt/");
            }
            // Open slideMasterXX.xml
            var slideMasterContent = readXmlFile(zip, masterFilename);
            var slideMasterTextStyles = getTextByPathList(slideMasterContent, ["p:sldMaster", "p:txStyles"]);
            var slideMasterTables = indexNodes(slideMasterContent);

            /////////////////Amir/////////////
            //Open slideMasterXX.xml.rels
            var slideMasterResFilename = masterFilename.replace("slideMasters/slideMaster", "slideMasters/_rels/slideMaster") + ".rels";
            var slideMasterResContent = readXmlFile(zip, slideMasterResFilename);
            RelationshipArray = slideMasterResContent["Relationships"]["Relationship"];
            var themeFilename = "";
            var masterResObj = {};
            if (RelationshipArray.constructor === Array) {
                for (var i = 0; i < RelationshipArray.length; i++) {
                    switch (RelationshipArray[i]["attrs"]["Type"]) {
                        case "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme":
                            themeFilename = RelationshipArray[i]["attrs"]["Target"].replace("../", "ppt/");
                            break;
                        default:
                            masterResObj[RelationshipArray[i]["attrs"]["Id"]] = {
                                "type": RelationshipArray[i]["attrs"]["Type"].replace("http://schemas.openxmlformats.org/officeDocument/2006/relationships/", ""),
                                "target": RelationshipArray[i]["attrs"]["Target"].replace("../", "ppt/")
                            };
                    }
                }
            } else {
                themeFilename = RelationshipArray["attrs"]["Target"].replace("../", "ppt/");
            }
            //console.log(themeFilename)
            //Load Theme file
            if (themeFilename !== undefined) {
                themeContent = readXmlFile(zip, themeFilename);
            }
            // =====< Step 3 >=====
            var slideContent = readXmlFile(zip, sldFileName);
            var nodes = slideContent["p:sld"]["p:cSld"]["p:spTree"];
            var warpObj = {
                "zip": zip,
                "slideLayoutTables": slideLayoutTables,
                "slideMasterTables": slideMasterTables,
                "slideResObj": slideResObj,
                "slideMasterTextStyles": slideMasterTextStyles,
                "layoutResObj": layoutResObj,
                "masterResObj": masterResObj
            };

            var bgColor = getSlideBackgroundFill(slideContent, slideLayoutContent, slideMasterContent, warpObj);
            var result = "<div class='slide' style='width:" + slideSize.width + "px; height:" + slideSize.height + "px;" + bgColor + "'>"
            //result += "<div>"+getBackgroundShapes(slideContent, slideLayoutContent, slideMasterContent,warpObj) + "</div>" - TODO
            for (var nodeKey in nodes) {
                if (nodes[nodeKey].constructor === Array) {
                    for (var i = 0; i < nodes[nodeKey].length; i++) {
                        result += processNodesInSlide(nodeKey, nodes[nodeKey][i], warpObj);
                    }
                } else {
                    result += processNodesInSlide(nodeKey, nodes[nodeKey], warpObj);
                }
            }

            return result + "</div>";
        }

        function indexNodes(content) {

            var keys = Object.keys(content);
            var spTreeNode = content[keys[0]]["p:cSld"]["p:spTree"];

            var idTable = {};
            var idxTable = {};
            var typeTable = {};

            for (var key in spTreeNode) {

                if (key == "p:nvGrpSpPr" || key == "p:grpSpPr") {
                    continue;
                }

                var targetNode = spTreeNode[key];

                if (targetNode.constructor === Array) {
                    for (var i = 0; i < targetNode.length; i++) {
                        var nvSpPrNode = targetNode[i]["p:nvSpPr"];
                        var id = getTextByPathList(nvSpPrNode, ["p:cNvPr", "attrs", "id"]);
                        var idx = getTextByPathList(nvSpPrNode, ["p:nvPr", "p:ph", "attrs", "idx"]);
                        var type = getTextByPathList(nvSpPrNode, ["p:nvPr", "p:ph", "attrs", "type"]);

                        if (id !== undefined) {
                            idTable[id] = targetNode[i];
                        }
                        if (idx !== undefined) {
                            idxTable[idx] = targetNode[i];
                        }
                        if (type !== undefined) {
                            typeTable[type] = targetNode[i];
                        }
                    }
                } else {
                    var nvSpPrNode = targetNode["p:nvSpPr"];
                    var id = getTextByPathList(nvSpPrNode, ["p:cNvPr", "attrs", "id"]);
                    var idx = getTextByPathList(nvSpPrNode, ["p:nvPr", "p:ph", "attrs", "idx"]);
                    var type = getTextByPathList(nvSpPrNode, ["p:nvPr", "p:ph", "attrs", "type"]);

                    if (id !== undefined) {
                        idTable[id] = targetNode;
                    }
                    if (idx !== undefined) {
                        idxTable[idx] = targetNode;
                    }
                    if (type !== undefined) {
                        typeTable[type] = targetNode;
                    }
                }

            }

            return { "idTable": idTable, "idxTable": idxTable, "typeTable": typeTable };
        }

        function processNodesInSlide(nodeKey, nodeValue, warpObj) {

            var result = "";

            switch (nodeKey) {
                case "p:sp":    // Shape, Text
                    result = processSpNode(nodeValue, warpObj);
                    break;
                case "p:cxnSp":    // Shape, Text (with connection)
                    result = processCxnSpNode(nodeValue, warpObj);
                    break;
                case "p:pic":    // Picture
                    result = processPicNode(nodeValue, warpObj);
                    break;
                case "p:graphicFrame":    // Chart, Diagram, Table
                    result = processGraphicFrameNode(nodeValue, warpObj);
                    break;
                case "p:grpSp":
                    result = processGroupSpNode(nodeValue, warpObj);
                    break;
                case "mc:AlternateContent": //Equations and formulas as Image
                    var mcFallbackNode = getTextByPathList(nodeValue, ["mc:Fallback", "p:sp"]);
                    result = processSpNode(mcFallbackNode, warpObj);
                    break;
                default:
            }

            return result;

        }

        function processGroupSpNode(node, warpObj) {

            var factor = 96 / 914400;

            var xfrmNode = node["p:grpSpPr"]["a:xfrm"];
            var x = parseInt(xfrmNode["a:off"]["attrs"]["x"]) * factor;
            var y = parseInt(xfrmNode["a:off"]["attrs"]["y"]) * factor;
            var chx = parseInt(xfrmNode["a:chOff"]["attrs"]["x"]) * factor;
            var chy = parseInt(xfrmNode["a:chOff"]["attrs"]["y"]) * factor;
            var cx = parseInt(xfrmNode["a:ext"]["attrs"]["cx"]) * factor;
            var cy = parseInt(xfrmNode["a:ext"]["attrs"]["cy"]) * factor;
            var chcx = parseInt(xfrmNode["a:chExt"]["attrs"]["cx"]) * factor;
            var chcy = parseInt(xfrmNode["a:chExt"]["attrs"]["cy"]) * factor;

            var order = node["attrs"]["order"];

            var result = "<div class='block group' style='z-index: " + order + "; top: " + (y - chy) + "px; left: " + (x - chx) + "px; width: " + (cx - chcx) + "px; height: " + (cy - chcy) + "px;'>";

            // Procsee all child nodes
            for (var nodeKey in node) {
                if (node[nodeKey].constructor === Array) {
                    for (var i = 0; i < node[nodeKey].length; i++) {
                        result += processNodesInSlide(nodeKey, node[nodeKey][i], warpObj);
                    }
                } else {
                    result += processNodesInSlide(nodeKey, node[nodeKey], warpObj);
                }
            }

            result += "</div>";

            return result;
        }

        function processSpNode(node, warpObj) {

            /*
            *  958    <xsd:complexType name="CT_GvmlShape">
            *  959   <xsd:sequence>
            *  960     <xsd:element name="nvSpPr" type="CT_GvmlShapeNonVisual"     minOccurs="1" maxOccurs="1"/>
            *  961     <xsd:element name="spPr"   type="CT_ShapeProperties"        minOccurs="1" maxOccurs="1"/>
            *  962     <xsd:element name="txSp"   type="CT_GvmlTextShape"          minOccurs="0" maxOccurs="1"/>
            *  963     <xsd:element name="style"  type="CT_ShapeStyle"             minOccurs="0" maxOccurs="1"/>
            *  964     <xsd:element name="extLst" type="CT_OfficeArtExtensionList" minOccurs="0" maxOccurs="1"/>
            *  965   </xsd:sequence>
            *  966 </xsd:complexType>
            */

            var id = getTextByPathList(node, ["p:nvSpPr", "p:cNvPr", "attrs", "id"]);
            var name = getTextByPathList(node, ["p:nvSpPr", "p:cNvPr", "attrs", "name"]);
            var idx = (getTextByPathList(node, ["p:nvSpPr", "p:nvPr", "p:ph"]) === undefined) ? undefined : getTextByPathList(node, ["p:nvSpPr", "p:nvPr", "p:ph", "attrs", "idx"]);
            var type = (getTextByPathList(node, ["p:nvSpPr", "p:nvPr", "p:ph"]) === undefined) ? undefined : getTextByPathList(node, ["p:nvSpPr", "p:nvPr", "p:ph", "attrs", "type"]);
            var order = getTextByPathList(node, ["attrs", "order"]);

            var slideLayoutSpNode = undefined;
            var slideMasterSpNode = undefined;

            if (type !== undefined) {
                if (idx !== undefined) {
                    slideLayoutSpNode = warpObj["slideLayoutTables"]["typeTable"][type];
                    slideMasterSpNode = warpObj["slideMasterTables"]["typeTable"][type];
                } else {
                    slideLayoutSpNode = warpObj["slideLayoutTables"]["typeTable"][type];
                    slideMasterSpNode = warpObj["slideMasterTables"]["typeTable"][type];
                }
            } else {
                if (idx !== undefined) {
                    slideLayoutSpNode = warpObj["slideLayoutTables"]["idxTable"][idx];
                    slideMasterSpNode = warpObj["slideMasterTables"]["idxTable"][idx];
                } else {
                    // Nothing
                }
            }

            if (type === undefined) {
                type = getTextByPathList(slideLayoutSpNode, ["p:nvSpPr", "p:nvPr", "p:ph", "attrs", "type"]);
                if (type === undefined) {
                    type = getTextByPathList(slideMasterSpNode, ["p:nvSpPr", "p:nvPr", "p:ph", "attrs", "type"]);
                }
            }

            return genShape(node, slideLayoutSpNode, slideMasterSpNode, id, name, idx, type, order, warpObj);
        }

        function processCxnSpNode(node, warpObj) {

            var id = node["p:nvCxnSpPr"]["p:cNvPr"]["attrs"]["id"];
            var name = node["p:nvCxnSpPr"]["p:cNvPr"]["attrs"]["name"];
            //var idx = (node["p:nvCxnSpPr"]["p:nvPr"]["p:ph"] === undefined) ? undefined : node["p:nvSpPr"]["p:nvPr"]["p:ph"]["attrs"]["idx"];
            //var type = (node["p:nvCxnSpPr"]["p:nvPr"]["p:ph"] === undefined) ? undefined : node["p:nvSpPr"]["p:nvPr"]["p:ph"]["attrs"]["type"];
            //<p:cNvCxnSpPr>(<p:cNvCxnSpPr>, <a:endCxn>)
            var order = node["attrs"]["order"];

            return genShape(node, undefined, undefined, id, name, undefined, undefined, order, warpObj);
        }

        function genShape(node, slideLayoutSpNode, slideMasterSpNode, id, name, idx, type, order, warpObj) {

            var xfrmList = ["p:spPr", "a:xfrm"];
            var slideXfrmNode = getTextByPathList(node, xfrmList);
            var slideLayoutXfrmNode = getTextByPathList(slideLayoutSpNode, xfrmList);
            var slideMasterXfrmNode = getTextByPathList(slideMasterSpNode, xfrmList);

            var result = "";
            var shpId = getTextByPathList(node, ["attrs", "order"]);
            //console.log("shpId: ",shpId)
            var shapType = getTextByPathList(node, ["p:spPr", "a:prstGeom", "attrs", "prst"]);

            //custGeom - Amir
            var custShapType = getTextByPathList(node, ["p:spPr", "a:custGeom"]);

            var isFlipV = false;
            if (getTextByPathList(slideXfrmNode, ["attrs", "flipV"]) === "1" || getTextByPathList(slideXfrmNode, ["attrs", "flipH"]) === "1") {
                isFlipV = true;
            }
            /////////////////////////Amir////////////////////////
            //rotate
            var rotate = angleToDegrees(getTextByPathList(slideXfrmNode, ["attrs", "rot"]));
            //console.log("rotate: "+rotate);
            var txtRotate;
            var txtXframeNode = getTextByPathList(node, ["p:txXfrm"]);
            if (txtXframeNode !== undefined) {
                var txtXframeRot = getTextByPathList(txtXframeNode, ["attrs", "rot"]);
                if (txtXframeRot !== undefined) {
                    txtRotate = angleToDegrees(txtXframeRot) + 90;
                }
            } else {
                txtRotate = rotate;
            }
            //////////////////////////////////////////////////
            if (shapType !== undefined || custShapType !== undefined) {
                var off = getTextByPathList(slideXfrmNode, ["a:off", "attrs"]);
                var x = parseInt(off["x"]) * 96 / 914400;
                var y = parseInt(off["y"]) * 96 / 914400;

                var ext = getTextByPathList(slideXfrmNode, ["a:ext", "attrs"]);
                var w = parseInt(ext["cx"]) * 96 / 914400;
                var h = parseInt(ext["cy"]) * 96 / 914400;

                result += "<svg class='drawing' _id='" + id + "' _idx='" + idx + "' _type='" + type + "' _name='" + name +
                    "' style='" +
                    getPosition(slideXfrmNode, undefined, undefined) +
                    getSize(slideXfrmNode, undefined, undefined) +
                    " z-index: " + order + ";" +
                    "transform: rotate(" + rotate + "deg);" +
                    "'>";
                result += '<defs>'
                // Fill Color
                var fillColor = getShapeFill(node, true, warpObj);
                var grndFillFlg = false;
                var imgFillFlg = false;
                var clrFillType = getFillType(getTextByPathList(node, ["p:spPr"]));
                /////////////////////////////////////////                    
                if (clrFillType == "GRADIENT_FILL") {
                    grndFillFlg = true;
                    var color_arry = fillColor.color;
                    var angl = fillColor.rot;
                    var svgGrdnt = getSvgGradient(w, h, angl, color_arry, shpId);
                    //fill="url(#linGrd)"
                    result += svgGrdnt;
                } else if (clrFillType == "PIC_FILL") {
                    imgFillFlg = true;
                    var svgBgImg = getSvgImagePattern(fillColor, shpId);
                    //fill="url(#imgPtrn)"
                    //console.log(svgBgImg)
                    result += svgBgImg;
                } else {
                    if (clrFillType != "SOLID_FILL" && clrFillType != "PATTERN_FILL" &&
                        (shapType == "arc" ||
                            shapType == "bracketPair" ||
                            shapType == "bracePair" ||
                            shapType == "leftBracket" ||
                            shapType == "leftBrace" ||
                            shapType == "rightBrace" ||
                            shapType == "rightBracket")) { //Temp. solution  - TODO
                        fillColor = "none";
                    }
                }
                // Border Color
                var border = getBorder(node, true, "shape");

                var headEndNodeAttrs = getTextByPathList(node, ["p:spPr", "a:ln", "a:headEnd", "attrs"]);
                var tailEndNodeAttrs = getTextByPathList(node, ["p:spPr", "a:ln", "a:tailEnd", "attrs"]);
                // type: none, triangle, stealth, diamond, oval, arrow

                if ((headEndNodeAttrs !== undefined && (headEndNodeAttrs["type"] === "triangle" || headEndNodeAttrs["type"] === "arrow")) ||
                    (tailEndNodeAttrs !== undefined && (tailEndNodeAttrs["type"] === "triangle" || tailEndNodeAttrs["type"] === "arrow"))) {
                    var triangleMarker = "<marker id='markerTriangle_" + shpId + "' viewBox='0 0 10 10' refX='1' refY='5' markerWidth='5' markerHeight='5' stroke='" + border.color + "' fill='" + border.color +
                        "' orient='auto-start-reverse' markerUnits='strokeWidth'><path d='M 0 0 L 10 5 L 0 10 z' /></marker>";
                    result += triangleMarker;
                }
                result += '</defs>'
            }
            if (shapType !== undefined && custShapType === undefined) {

                switch (shapType) {
                    case "rect":
                    case "flowChartProcess":
                    case "flowChartPredefinedProcess":
                    case "flowChartInternalStorage":
                    case "actionButtonBlank":
                        result += "<rect x='0' y='0' width='" + w + "' height='" + h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        if (shapType == "flowChartPredefinedProcess") {
                            result += "<rect x='" + w * (1 / 8) + "' y='0' width='" + w * (6 / 8) + "' height='" + h + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        } else if (shapType == "flowChartInternalStorage") {
                            result += " <polyline points='" + w * (1 / 8) + " 0," + w * (1 / 8) + " " + h + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                            result += " <polyline points='0 " + h * (1 / 8) + "," + w + " " + h * (1 / 8) + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        }
                        break;
                    case "flowChartCollate":
                        var d = "M 0,0" +
                            " L" + w + "," + 0 +
                            " L" + 0 + "," + h +
                            " L" + w + "," + h +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "flowChartDocument":
                        var y1, y2, y3, x1;
                        x1 = w * 10800 / 21600;
                        y1 = h * 17322 / 21600;
                        y2 = h * 20172 / 21600;
                        y3 = h * 23922 / 21600;
                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + y1 +
                            " C" + x1 + "," + y1 + " " + x1 + "," + y3 + " " + 0 + "," + y2 +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartMultidocument":
                        var y1, y2, y3, y4, y5, y6, y7, y8, y9, x1, x2, x3, x4, x5, x6, x7;
                        y1 = h * 18022 / 21600;
                        y2 = h * 3675 / 21600;
                        y3 = h * 23542 / 21600;
                        y4 = h * 1815 / 21600;
                        y5 = h * 16252 / 21600;
                        y6 = h * 16352 / 21600;
                        y7 = h * 14392 / 21600;
                        y8 = h * 20782 / 21600;
                        y9 = h * 14467 / 21600;
                        x1 = w * 1532 / 21600;
                        x2 = w * 20000 / 21600;
                        x3 = w * 9298 / 21600;
                        x4 = w * 19298 / 21600;
                        x5 = w * 18595 / 21600;
                        x6 = w * 2972 / 21600;
                        x7 = w * 20800 / 21600;
                        var d = "M" + 0 + "," + y2 +
                            " L" + x5 + "," + y2 +
                            " L" + x5 + "," + y1 +
                            " C" + x3 + "," + y1 + " " + x3 + "," + y3 + " " + 0 + "," + y8 +
                            " z" +
                            "M" + x1 + "," + y2 +
                            " L" + x1 + "," + y4 +
                            " L" + x2 + "," + y4 +
                            " L" + x2 + "," + y5 +
                            " C" + x4 + "," + y5 + " " + x5 + "," + y6 + " " + x5 + "," + y6 +
                            "M" + x6 + "," + y4 +
                            " L" + x6 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + y7 +
                            " C" + x7 + "," + y7 + " " + x2 + "," + y9 + " " + x2 + "," + y9;

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "actionButtonBackPrevious":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + g11 + "," + vc +
                            " L" + g12 + "," + g9 +
                            " L" + g12 + "," + g10 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonBeginning":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12, g13, g14, g15, g16, g17;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 / 8;
                        g15 = g13 / 4;
                        g16 = g11 + g14;
                        g17 = g11 + g15;
                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + g17 + "," + vc +
                            " L" + g12 + "," + g9 +
                            " L" + g12 + "," + g10 +
                            " z" +
                            "M" + g16 + "," + g9 +
                            " L" + g11 + "," + g9 +
                            " L" + g11 + "," + g10 +
                            " L" + g16 + "," + g10 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonDocument":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, dx1, g11, g12, g13, g14, g15;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        dx1 = ss * 9 / 32;
                        g11 = hc - dx1;
                        g12 = hc + dx1;
                        g13 = ss * 3 / 16;
                        g14 = g12 - g13;
                        g15 = g9 + g13;
                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + g11 + "," + g9 +
                            " L" + g14 + "," + g9 +
                            " L" + g12 + "," + g15 +
                            " L" + g12 + "," + g10 +
                            " L" + g11 + "," + g10 +
                            " z" +
                            "M" + g14 + "," + g9 +
                            " L" + g14 + "," + g15 +
                            " L" + g12 + "," + g15 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonEnd":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12, g13, g14, g15, g16, g17;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 * 3 / 4;
                        g15 = g13 * 7 / 8;
                        g16 = g11 + g14;
                        g17 = g11 + g15;
                        var d = "M" + 0 + "," + h +
                            " L" + w + "," + h +
                            " L" + w + "," + 0 +
                            " L" + 0 + "," + 0 +
                            " z" +
                            " M" + g17 + "," + g9 +
                            " L" + g12 + "," + g9 +
                            " L" + g12 + "," + g10 +
                            " L" + g17 + "," + g10 +
                            " z" +
                            " M" + g16 + "," + vc +
                            " L" + g11 + "," + g9 +
                            " L" + g11 + "," + g10 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonForwardNext":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;

                        var d = "M" + 0 + "," + h +
                            " L" + w + "," + h +
                            " L" + w + "," + 0 +
                            " L" + 0 + "," + 0 +
                            " z" +
                            " M" + g12 + "," + vc +
                            " L" + g11 + "," + g9 +
                            " L" + g11 + "," + g10 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonHelp":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g11, g13, g14, g15, g16, g19, g20, g21, g23, g24, g27, g29, g30, g31, g33, g36, g37, g41, g42;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g11 = hc - dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 / 7;
                        g15 = g13 * 3 / 14;
                        g16 = g13 * 2 / 7;
                        g19 = g13 * 3 / 7;
                        g20 = g13 * 4 / 7;
                        g21 = g13 * 17 / 28;
                        g23 = g13 * 21 / 28;
                        g24 = g13 * 11 / 14;
                        g27 = g9 + g16;
                        g29 = g9 + g21;
                        g30 = g9 + g23;
                        g31 = g9 + g24;
                        g33 = g11 + g15;
                        g36 = g11 + g19;
                        g37 = g11 + g20;
                        g41 = g13 / 14;
                        g42 = g13 * 3 / 28;
                        var cX1 = g33 + g16;
                        var cX2 = g36 + g14;
                        var cY3 = g31 + g42;
                        var cX4 = (g37 + g36 + g16) / 2;

                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + g33 + "," + g27 +
                            shapeArc(cX1, g27, g16, g16, 180, 360, false).replace("M", "L") +
                            shapeArc(cX4, g27, g14, g15, 0, 90, false).replace("M", "L") +
                            shapeArc(cX4, g29, g41, g42, 270, 180, false).replace("M", "L") +
                            " L" + g37 + "," + g30 +
                            " L" + g36 + "," + g30 +
                            " L" + g36 + "," + g29 +
                            shapeArc(cX2, g29, g14, g15, 180, 270, false).replace("M", "L") +
                            shapeArc(g37, g27, g41, g42, 90, 0, false).replace("M", "L") +
                            shapeArc(cX1, g27, g14, g14, 0, -180, false).replace("M", "L") +
                            " z" +
                            "M" + hc + "," + g31 +
                            shapeArc(hc, cY3, g42, g42, 270, 630, false).replace("M", "L") +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonHome":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g20, g21, g22, g23, g24, g25, g26, g27, g28, g29, g30, g31, g32, g33;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 / 16;
                        g15 = g13 / 8;
                        g16 = g13 * 3 / 16;
                        g17 = g13 * 5 / 16;
                        g18 = g13 * 7 / 16;
                        g19 = g13 * 9 / 16;
                        g20 = g13 * 11 / 16;
                        g21 = g13 * 3 / 4;
                        g22 = g13 * 13 / 16;
                        g23 = g13 * 7 / 8;
                        g24 = g9 + g14;
                        g25 = g9 + g16;
                        g26 = g9 + g17;
                        g27 = g9 + g21;
                        g28 = g11 + g15;
                        g29 = g11 + g18;
                        g30 = g11 + g19;
                        g31 = g11 + g20;
                        g32 = g11 + g22;
                        g33 = g11 + g23;

                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            " M" + hc + "," + g9 +
                            " L" + g11 + "," + vc +
                            " L" + g28 + "," + vc +
                            " L" + g28 + "," + g10 +
                            " L" + g33 + "," + g10 +
                            " L" + g33 + "," + vc +
                            " L" + g12 + "," + vc +
                            " L" + g32 + "," + g26 +
                            " L" + g32 + "," + g24 +
                            " L" + g31 + "," + g24 +
                            " L" + g31 + "," + g25 +
                            " z" +
                            " M" + g29 + "," + g27 +
                            " L" + g30 + "," + g27 +
                            " L" + g30 + "," + g10 +
                            " L" + g29 + "," + g10 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonInformation":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g11, g13, g14, g17, g18, g19, g20, g22, g23, g24, g25, g28, g29, g30, g31, g32, g34, g35, g37, g38;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g11 = hc - dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 / 32;
                        g17 = g13 * 5 / 16;
                        g18 = g13 * 3 / 8;
                        g19 = g13 * 13 / 32;
                        g20 = g13 * 19 / 32;
                        g22 = g13 * 11 / 16;
                        g23 = g13 * 13 / 16;
                        g24 = g13 * 7 / 8;
                        g25 = g9 + g14;
                        g28 = g9 + g17;
                        g29 = g9 + g18;
                        g30 = g9 + g23;
                        g31 = g9 + g24;
                        g32 = g11 + g17;
                        g34 = g11 + g19;
                        g35 = g11 + g20;
                        g37 = g11 + g22;
                        g38 = g13 * 3 / 32;
                        var cY1 = g9 + dx2;
                        var cY2 = g25 + g38;

                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + hc + "," + g9 +
                            shapeArc(hc, cY1, dx2, dx2, 270, 630, false).replace("M", "L") +
                            " z" +
                            "M" + hc + "," + g25 +
                            shapeArc(hc, cY2, g38, g38, 270, 630, false).replace("M", "L") +
                            "M" + g32 + "," + g28 +
                            " L" + g35 + "," + g28 +
                            " L" + g35 + "," + g30 +
                            " L" + g37 + "," + g30 +
                            " L" + g37 + "," + g31 +
                            " L" + g32 + "," + g31 +
                            " L" + g32 + "," + g30 +
                            " L" + g34 + "," + g30 +
                            " L" + g34 + "," + g29 +
                            " L" + g32 + "," + g29 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonMovie":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g20, g21, g22, g23, g24, g25, g26, g27,
                            g28, g29, g30, g31, g32, g33, g34, g35, g36, g37, g38, g39, g40, g41, g42, g43, g44, g45, g46, g47, g48;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 * 1455 / 21600;
                        g15 = g13 * 1905 / 21600;
                        g16 = g13 * 2325 / 21600;
                        g17 = g13 * 16155 / 21600;
                        g18 = g13 * 17010 / 21600;
                        g19 = g13 * 19335 / 21600;
                        g20 = g13 * 19725 / 21600;
                        g21 = g13 * 20595 / 21600;
                        g22 = g13 * 5280 / 21600;
                        g23 = g13 * 5730 / 21600;
                        g24 = g13 * 6630 / 21600;
                        g25 = g13 * 7492 / 21600;
                        g26 = g13 * 9067 / 21600;
                        g27 = g13 * 9555 / 21600;
                        g28 = g13 * 13342 / 21600;
                        g29 = g13 * 14580 / 21600;
                        g30 = g13 * 15592 / 21600;
                        g31 = g11 + g14;
                        g32 = g11 + g15;
                        g33 = g11 + g16;
                        g34 = g11 + g17;
                        g35 = g11 + g18;
                        g36 = g11 + g19;
                        g37 = g11 + g20;
                        g38 = g11 + g21;
                        g39 = g9 + g22;
                        g40 = g9 + g23;
                        g41 = g9 + g24;
                        g42 = g9 + g25;
                        g43 = g9 + g26;
                        g44 = g9 + g27;
                        g45 = g9 + g28;
                        g46 = g9 + g29;
                        g47 = g9 + g30;
                        g48 = g9 + g31;

                        var d = "M" + 0 + "," + h +
                            " L" + w + "," + h +
                            " L" + w + "," + 0 +
                            " L" + 0 + "," + 0 +
                            " z" +
                            "M" + g11 + "," + g39 +
                            " L" + g11 + "," + g44 +
                            " L" + g31 + "," + g44 +
                            " L" + g32 + "," + g43 +
                            " L" + g33 + "," + g43 +
                            " L" + g33 + "," + g47 +
                            " L" + g35 + "," + g47 +
                            " L" + g35 + "," + g45 +
                            " L" + g36 + "," + g45 +
                            " L" + g38 + "," + g46 +
                            " L" + g12 + "," + g46 +
                            " L" + g12 + "," + g41 +
                            " L" + g38 + "," + g41 +
                            " L" + g37 + "," + g42 +
                            " L" + g35 + "," + g42 +
                            " L" + g35 + "," + g41 +
                            " L" + g34 + "," + g40 +
                            " L" + g32 + "," + g40 +
                            " L" + g31 + "," + g39 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonReturn":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g20, g21, g22, g23, g24, g25, g26, g27;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 * 7 / 8;
                        g15 = g13 * 3 / 4;
                        g16 = g13 * 5 / 8;
                        g17 = g13 * 3 / 8;
                        g18 = g13 / 4;
                        g19 = g9 + g15;
                        g20 = g9 + g16;
                        g21 = g9 + g18;
                        g22 = g11 + g14;
                        g23 = g11 + g15;
                        g24 = g11 + g16;
                        g25 = g11 + g17;
                        g26 = g11 + g18;
                        g27 = g13 / 8;
                        var cX1 = g24 - g27;
                        var cY2 = g19 - g27;
                        var cX3 = g11 + g17;
                        var cY4 = g10 - g17;

                        var d = "M" + 0 + "," + h +
                            " L" + w + "," + h +
                            " L" + w + "," + 0 +
                            " L" + 0 + "," + 0 +
                            " z" +
                            " M" + g12 + "," + g21 +
                            " L" + g23 + "," + g9 +
                            " L" + hc + "," + g21 +
                            " L" + g24 + "," + g21 +
                            " L" + g24 + "," + g20 +
                            shapeArc(cX1, g20, g27, g27, 0, 90, false).replace("M", "L") +
                            " L" + g25 + "," + g19 +
                            shapeArc(g25, cY2, g27, g27, 90, 180, false).replace("M", "L") +
                            " L" + g26 + "," + g21 +
                            " L" + g11 + "," + g21 +
                            " L" + g11 + "," + g20 +
                            shapeArc(cX3, g20, g17, g17, 180, 90, false).replace("M", "L") +
                            " L" + hc + "," + g10 +
                            shapeArc(hc, cY4, g17, g17, 90, 0, false).replace("M", "L") +
                            " L" + g22 + "," + g21 +
                            " z";

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "actionButtonSound":
                        var hc = w / 2, vc = h / 2, ss = Math.min(w, h);
                        var dx2, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g20, g21, g22, g23, g24, g25, g26;

                        dx2 = ss * 3 / 8;
                        g9 = vc - dx2;
                        g10 = vc + dx2;
                        g11 = hc - dx2;
                        g12 = hc + dx2;
                        g13 = ss * 3 / 4;
                        g14 = g13 / 8;
                        g15 = g13 * 5 / 16;
                        g16 = g13 * 5 / 8;
                        g17 = g13 * 11 / 16;
                        g18 = g13 * 3 / 4;
                        g19 = g13 * 7 / 8;
                        g20 = g9 + g14;
                        g21 = g9 + g15;
                        g22 = g9 + g17;
                        g23 = g9 + g19;
                        g24 = g11 + g15;
                        g25 = g11 + g16;
                        g26 = g11 + g18;

                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            " M" + g11 + "," + g21 +
                            " L" + g24 + "," + g21 +
                            " L" + g25 + "," + g9 +
                            " L" + g25 + "," + g10 +
                            " L" + g24 + "," + g22 +
                            " L" + g11 + "," + g22 +
                            " z" +
                            " M" + g26 + "," + g21 +
                            " L" + g12 + "," + g20 +
                            " M" + g26 + "," + vc +
                            " L" + g12 + "," + vc +
                            " M" + g26 + "," + g22 +
                            " L" + g12 + "," + g23;

                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "irregularSeal1":
                    case "irregularSeal2":
                        if (shapType == "irregularSeal1") {
                            var d = "M" + w * 10800 / 21600 + "," + h * 5800 / 21600 +
                                " L" + w * 14522 / 21600 + "," + 0 +
                                " L" + w * 14155 / 21600 + "," + h * 5325 / 21600 +
                                " L" + w * 18380 / 21600 + "," + h * 4457 / 21600 +
                                " L" + w * 16702 / 21600 + "," + h * 7315 / 21600 +
                                " L" + w * 21097 / 21600 + "," + h * 8137 / 21600 +
                                " L" + w * 17607 / 21600 + "," + h * 10475 / 21600 +
                                " L" + w + "," + h * 13290 / 21600 +
                                " L" + w * 16837 / 21600 + "," + h * 12942 / 21600 +
                                " L" + w * 18145 / 21600 + "," + h * 18095 / 21600 +
                                " L" + w * 14020 / 21600 + "," + h * 14457 / 21600 +
                                " L" + w * 13247 / 21600 + "," + h * 19737 / 21600 +
                                " L" + w * 10532 / 21600 + "," + h * 14935 / 21600 +
                                " L" + w * 8485 / 21600 + "," + h +
                                " L" + w * 7715 / 21600 + "," + h * 15627 / 21600 +
                                " L" + w * 4762 / 21600 + "," + h * 17617 / 21600 +
                                " L" + w * 5667 / 21600 + "," + h * 13937 / 21600 +
                                " L" + w * 135 / 21600 + "," + h * 14587 / 21600 +
                                " L" + w * 3722 / 21600 + "," + h * 11775 / 21600 +
                                " L" + 0 + "," + h * 8615 / 21600 +
                                " L" + w * 4627 / 21600 + "," + h * 7617 / 21600 +
                                " L" + w * 370 / 21600 + "," + h * 2295 / 21600 +
                                " L" + w * 7312 / 21600 + "," + h * 6320 / 21600 +
                                " L" + w * 8352 / 21600 + "," + h * 2295 / 21600 +
                                " z";
                        } else if (shapType == "irregularSeal2") {
                            var d = "M" + w * 11462 / 21600 + "," + h * 4342 / 21600 +
                                " L" + w * 14790 / 21600 + "," + 0 +
                                " L" + w * 14525 / 21600 + "," + h * 5777 / 21600 +
                                " L" + w * 18007 / 21600 + "," + h * 3172 / 21600 +
                                " L" + w * 16380 / 21600 + "," + h * 6532 / 21600 +
                                " L" + w + "," + h * 6645 / 21600 +
                                " L" + w * 16985 / 21600 + "," + h * 9402 / 21600 +
                                " L" + w * 18270 / 21600 + "," + h * 11290 / 21600 +
                                " L" + w * 16380 / 21600 + "," + h * 12310 / 21600 +
                                " L" + w * 18877 / 21600 + "," + h * 15632 / 21600 +
                                " L" + w * 14640 / 21600 + "," + h * 14350 / 21600 +
                                " L" + w * 14942 / 21600 + "," + h * 17370 / 21600 +
                                " L" + w * 12180 / 21600 + "," + h * 15935 / 21600 +
                                " L" + w * 11612 / 21600 + "," + h * 18842 / 21600 +
                                " L" + w * 9872 / 21600 + "," + h * 17370 / 21600 +
                                " L" + w * 8700 / 21600 + "," + h * 19712 / 21600 +
                                " L" + w * 7527 / 21600 + "," + h * 18125 / 21600 +
                                " L" + w * 4917 / 21600 + "," + h +
                                " L" + w * 4805 / 21600 + "," + h * 18240 / 21600 +
                                " L" + w * 1285 / 21600 + "," + h * 17825 / 21600 +
                                " L" + w * 3330 / 21600 + "," + h * 15370 / 21600 +
                                " L" + 0 + "," + h * 12877 / 21600 +
                                " L" + w * 3935 / 21600 + "," + h * 11592 / 21600 +
                                " L" + w * 1172 / 21600 + "," + h * 8270 / 21600 +
                                " L" + w * 5372 / 21600 + "," + h * 7817 / 21600 +
                                " L" + w * 4502 / 21600 + "," + h * 3625 / 21600 +
                                " L" + w * 8550 / 21600 + "," + h * 6382 / 21600 +
                                " L" + w * 9722 / 21600 + "," + h * 1887 / 21600 +
                                " z";
                        }
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartTerminator":
                        var x1, x2, y1, cd2 = 180, cd4 = 90, c3d4 = 270;
                        x1 = w * 3475 / 21600;
                        x2 = w * 18125 / 21600;
                        y1 = h * 10800 / 21600;
                        //path attrs: w = 21600; h = 21600; 
                        var d = "M" + x1 + "," + 0 +
                            " L" + x2 + "," + 0 +
                            shapeArc(x2, h / 2, x1, y1, c3d4, c3d4 + cd2, false).replace("M", "L") +
                            " L" + x1 + "," + h +
                            shapeArc(x1, h / 2, x1, y1, cd4, cd4 + cd2, false).replace("M", "L") +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartPunchedTape":
                        var x1, x1, y1, y2, cd2 = 180;
                        x1 = w * 5 / 20;
                        y1 = h * 2 / 20;
                        y2 = h * 18 / 20;
                        var d = "M" + 0 + "," + y1 +
                            shapeArc(x1, y1, x1, y1, cd2, 0, false).replace("M", "L") +
                            shapeArc(w * (3 / 4), y1, x1, y1, cd2, 360, false).replace("M", "L") +
                            " L" + w + "," + y2 +
                            shapeArc(w * (3 / 4), y2, x1, y1, 0, -cd2, false).replace("M", "L") +
                            shapeArc(x1, y2, x1, y1, 0, cd2, false).replace("M", "L") +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartOnlineStorage":
                        var x1, y1, c3d4 = 270, cd4 = 90;
                        x1 = w * 1 / 6;
                        y1 = h * 3 / 6;
                        var d = "M" + x1 + "," + 0 +
                            " L" + w + "," + 0 +
                            shapeArc(w, h / 2, x1, y1, c3d4, 90, false).replace("M", "L") +
                            " L" + x1 + "," + h +
                            shapeArc(x1, h / 2, x1, y1, cd4, 270, false).replace("M", "L") +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartDisplay":
                        var x1, x2, y1, c3d4 = 270, cd2 = 180;
                        x1 = w * 1 / 6;
                        x2 = w * 5 / 6;
                        y1 = h * 3 / 6;
                        //path attrs: w = 6; h = 6; 
                        var d = "M" + 0 + "," + y1 +
                            " L" + x1 + "," + 0 +
                            " L" + x2 + "," + 0 +
                            shapeArc(w, h / 2, x1, y1, c3d4, c3d4 + cd2, false).replace("M", "L") +
                            " L" + x1 + "," + h +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartDelay":
                        var wd2 = w / 2, hd2 = h / 2, cd2 = 180, c3d4 = 270, cd4 = 90;
                        var d = "M" + 0 + "," + 0 +
                            " L" + wd2 + "," + 0 +
                            shapeArc(wd2, hd2, wd2, hd2, c3d4, c3d4 + cd2, false).replace("M", "L") +
                            " L" + 0 + "," + h +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "flowChartMagneticTape":
                        var wd2 = w / 2, hd2 = h / 2, cd2 = 180, c3d4 = 270, cd4 = 90;
                        var idy, ib, ang1;
                        idy = hd2 * Math.sin(Math.PI / 4);
                        ib = hd2 + idy;
                        ang1 = Math.atan(h / w);
                        var ang1Dg = ang1 * 180 / Math.PI;
                        var d = "M" + wd2 + "," + h +
                            shapeArc(wd2, hd2, wd2, hd2, cd4, cd2, false).replace("M", "L") +
                            shapeArc(wd2, hd2, wd2, hd2, cd2, c3d4, false).replace("M", "L") +
                            shapeArc(wd2, hd2, wd2, hd2, c3d4, 360, false).replace("M", "L") +
                            shapeArc(wd2, hd2, wd2, hd2, 0, ang1Dg, false).replace("M", "L") +
                            " L" + w + "," + ib +
                            " L" + w + "," + h +
                            " z";
                        result += "<path d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "ellipse":
                    case "flowChartConnector":
                    case "flowChartSummingJunction":
                    case "flowChartOr":
                        result += "<ellipse cx='" + (w / 2) + "' cy='" + (h / 2) + "' rx='" + (w / 2) + "' ry='" + (h / 2) + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        if (shapType == "flowChartOr") {
                            result += " <polyline points='" + w / 2 + " " + 0 + "," + w / 2 + " " + h + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                            result += " <polyline points='" + 0 + " " + h / 2 + "," + w + " " + h / 2 + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        } else if (shapType == "flowChartSummingJunction") {
                            var idx, idy, il, ir, it, ib, hc = w / 2, vc = h / 2, wd2 = w / 2, hd2 = h / 2;
                            var angVal = Math.PI / 4;
                            idx = wd2 * Math.cos(angVal);
                            idy = hd2 * Math.sin(angVal);
                            il = hc - idx;
                            ir = hc + idx;
                            it = vc - idy;
                            ib = vc + idy;
                            result += " <polyline points='" + il + " " + it + "," + ir + " " + ib + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                            result += " <polyline points='" + ir + " " + it + "," + il + " " + ib + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        }
                        break;
                    case "roundRect":
                    case "round1Rect":
                    case "round2DiagRect":
                    case "round2SameRect":
                    case "snip1Rect":
                    case "snip2DiagRect":
                    case "snip2SameRect":
                    case "flowChartAlternateProcess":
                    case "flowChartPunchedCard":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val;// = 0.33334;
                        var sAdj2, sAdj2_val;// = 0.33334;
                        var shpTyp, adjTyp;
                        if (shapAdjst_ary !== undefined && shapAdjst_ary.constructor === Array) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) / 50000;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj2_val = parseInt(sAdj2.substr(4)) / 50000;
                                }
                            }
                        } else if (shapAdjst_ary !== undefined && shapAdjst_ary.constructor !== Array) {
                            var sAdj = getTextByPathList(shapAdjst_ary, ["attrs", "fmla"]);
                            sAdj1_val = parseInt(sAdj.substr(4)) / 50000;
                            sAdj2_val = 0;
                        }
                        //console.log("shapType: ",shapType,",node: ",node )
                        var tranglRott = "";
                        switch (shapType) {
                            case "roundRect":
                            case "flowChartAlternateProcess":
                                shpTyp = "round";
                                adjTyp = "cornrAll";
                                if (sAdj1_val === undefined) sAdj1_val = 0.33334;
                                sAdj2_val = 0;
                                break;
                            case "round1Rect":
                                shpTyp = "round";
                                adjTyp = "cornr1";
                                if (sAdj1_val === undefined) sAdj1_val = 0.33334;
                                sAdj2_val = 0;
                                break;
                            case "round2DiagRect":
                                shpTyp = "round";
                                adjTyp = "diag";
                                if (sAdj1_val === undefined) sAdj1_val = 0.33334;
                                if (sAdj2_val === undefined) sAdj2_val = 0;
                                break;
                            case "round2SameRect":
                                shpTyp = "round";
                                adjTyp = "cornr2";
                                if (sAdj1_val === undefined) sAdj1_val = 0.33334;
                                if (sAdj2_val === undefined) sAdj2_val = 0;
                                break;
                            case "snip1Rect":
                            case "flowChartPunchedCard":
                                shpTyp = "snip";
                                adjTyp = "cornr1";
                                if (sAdj1_val === undefined) sAdj1_val = 0.33334;
                                sAdj2_val = 0;
                                if (shapType == "flowChartPunchedCard") {
                                    tranglRott = "transform='translate(" + w + ",0) scale(-1,1)'";
                                }
                                break;
                            case "snip2DiagRect":
                                shpTyp = "snip";
                                adjTyp = "diag";
                                if (sAdj1_val === undefined) sAdj1_val = 0;
                                if (sAdj2_val === undefined) sAdj2_val = 0.33334;
                                break;
                            case "snip2SameRect":
                                shpTyp = "snip";
                                adjTyp = "cornr2";
                                if (sAdj1_val === undefined) sAdj1_val = 0.33334;
                                if (sAdj2_val === undefined) sAdj2_val = 0;
                                break;
                        }
                        var d_val = shapeSnipRoundRect(w, h, sAdj1_val, sAdj2_val, shpTyp, adjTyp);
                        result += "<path " + tranglRott + "  d='" + d_val + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "snipRoundRect":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.33334;
                        var sAdj2, sAdj2_val = 0.33334;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) / 50000;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj2_val = parseInt(sAdj2.substr(4)) / 50000;
                                }
                            }
                        }
                        var d_val = "M0," + h + " L" + w + "," + h + " L" + w + "," + (h / 2) * sAdj2_val +
                            " L" + (w / 2 + (w / 2) * (1 - sAdj2_val)) + ",0 L" + (w / 2) * sAdj1_val + ",0 Q0,0 0," + (h / 2) * sAdj1_val + " z";

                        result += "<path   d='" + d_val + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "bentConnector2":
                        var d = "";
                        if (isFlipV) {
                            d = "M 0 " + w + " L " + h + " " + w + " L " + h + " 0";
                        } else {
                            d = "M " + w + " 0 L " + w + " " + h + " L 0 " + h;
                        }
                        result += "<path d='" + d + "' stroke='" + border.color +
                            "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' fill='none' ";
                        if (headEndNodeAttrs !== undefined && (headEndNodeAttrs["type"] === "triangle" || headEndNodeAttrs["type"] === "arrow")) {
                            result += "marker-start='url(#markerTriangle_" + shpId + ")' ";
                        }
                        if (tailEndNodeAttrs !== undefined && (tailEndNodeAttrs["type"] === "triangle" || tailEndNodeAttrs["type"] === "arrow")) {
                            result += "marker-end='url(#markerTriangle_" + shpId + ")' ";
                        }
                        result += "/>";
                        break;
                    case "rtTriangle":
                        result += " <polygon points='0 0,0 " + h + "," + w + " " + h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "triangle":
                    case "flowChartExtract":
                    case "flowChartMerge":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var shapAdjst_val = 0.5;
                        if (shapAdjst !== undefined) {
                            shapAdjst_val = parseInt(shapAdjst.substr(4)) * 96 / 9144000;
                            //console.log("w: "+w+"\nh: "+h+"\nshapAdjst: "+shapAdjst+"\nshapAdjst_val: "+shapAdjst_val);
                        }
                        var tranglRott = "";
                        if (shapType == "flowChartMerge") {
                            tranglRott = "transform='rotate(180 " + w / 2 + "," + h / 2 + ")'";
                        }
                        result += " <polygon " + tranglRott + " points='" + (w * shapAdjst_val) + " 0,0 " + h + "," + w + " " + h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "diamond":
                    case "flowChartDecision":
                    case "flowChartSort":
                        result += " <polygon points='" + (w / 2) + " 0,0 " + (h / 2) + "," + (w / 2) + " " + h + "," + w + " " + (h / 2) + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        if (shapType == "flowChartSort") {
                            result += " <polyline points='0 " + h / 2 + "," + w + " " + h / 2 + "' fill='none' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        }
                        break;
                    case "trapezoid":
                    case "flowChartManualOperation":
                    case "flowChartManualInput":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adjst_val = 0.2;
                        var max_adj_const = 0.7407;
                        if (shapAdjst !== undefined) {
                            var adjst = parseInt(shapAdjst.substr(4)) * 96 / 9144000;
                            adjst_val = (adjst * 0.5) / max_adj_const;
                            // console.log("w: "+w+"\nh: "+h+"\nshapAdjst: "+shapAdjst+"\nadjst_val: "+adjst_val);
                        }
                        var cnstVal = 0;
                        var tranglRott = "";
                        if (shapType == "flowChartManualOperation") {
                            tranglRott = "transform='rotate(180 " + w / 2 + "," + h / 2 + ")'";
                        }
                        if (shapType == "flowChartManualInput") {
                            adjst_val = 0;
                            cnstVal = h / 5;
                        }
                        result += " <polygon " + tranglRott + " points='" + (w * adjst_val) + " " + cnstVal + ",0 " + h + "," + w + " " + h + "," + (1 - adjst_val) * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "parallelogram":
                    case "flowChartInputOutput":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adjst_val = 0.25;
                        var max_adj_const;
                        if (w > h) {
                            max_adj_const = w / h;
                        } else {
                            max_adj_const = h / w;
                        }
                        if (shapAdjst !== undefined) {
                            var adjst = parseInt(shapAdjst.substr(4)) / 100000;
                            adjst_val = adjst / max_adj_const;
                            //console.log("w: "+w+"\nh: "+h+"\nadjst: "+adjst_val+"\nmax_adj_const: "+max_adj_const);
                        }
                        result += " <polygon points='" + adjst_val * w + " 0,0 " + h + "," + (1 - adjst_val) * w + " " + h + "," + w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;

                        break;
                    case "pentagon":
                        result += " <polygon points='" + (0.5 * w) + " 0,0 " + (0.375 * h) + "," + (0.15 * w) + " " + h + "," + 0.85 * w + " " + h + "," + w + " " + 0.375 * h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "hexagon":
                    case "flowChartPreparation":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 25000 * 96 / 914400;
                        var vf = 115470 * 96 / 914400;;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var angVal1 = 60 * Math.PI / 180;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var maxAdj, a, shd2, x1, x2, dy1, y1, y2, vc = h / 2, hd2 = h / 2;
                        var ss = Math.min(w, h);
                        maxAdj = cnstVal1 * w / ss;
                        a = (adj < 0) ? 0 : (adj > maxAdj) ? maxAdj : adj;
                        shd2 = hd2 * vf / cnstVal2;
                        x1 = ss * a / cnstVal2;
                        x2 = w - x1;
                        dy1 = shd2 * Math.sin(angVal1);
                        y1 = vc - dy1;
                        y2 = vc + dy1;

                        var d = "M" + 0 + "," + vc +
                            " L" + x1 + "," + y1 +
                            " L" + x2 + "," + y1 +
                            " L" + w + "," + vc +
                            " L" + x2 + "," + y2 +
                            " L" + x1 + "," + y2 +
                            " z";

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "heptagon":
                        result += " <polygon points='" + (0.5 * w) + " 0," + w / 8 + " " + h / 4 + ",0 " + (5 / 8) * h + "," + w / 4 + " " + h + "," + (3 / 4) * w + " " + h + "," +
                            w + " " + (5 / 8) * h + "," + (7 / 8) * w + " " + h / 4 + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "octagon":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj1 = 0.25;
                        if (shapAdjst !== undefined) {
                            adj1 = parseInt(shapAdjst.substr(4)) / 100000;

                        }
                        var adj2 = (1 - adj1);
                        //console.log("adj1: "+adj1+"\nadj2: "+adj2);
                        result += " <polygon points='" + adj1 * w + " 0,0 " + adj1 * h + ",0 " + adj2 * h + "," + adj1 * w + " " + h + "," + adj2 * w + " " + h + "," +
                            w + " " + adj2 * h + "," + w + " " + adj1 * h + "," + adj2 * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "decagon":
                        result += " <polygon points='" + (3 / 8) * w + " 0," + w / 8 + " " + h / 8 + ",0 " + h / 2 + "," + w / 8 + " " + (7 / 8) * h + "," + (3 / 8) * w + " " + h + "," +
                            (5 / 8) * w + " " + h + "," + (7 / 8) * w + " " + (7 / 8) * h + "," + w + " " + h / 2 + "," + (7 / 8) * w + " " + h / 8 + "," + (5 / 8) * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "dodecagon":
                        result += " <polygon points='" + (3 / 8) * w + " 0," + w / 8 + " " + h / 8 + ",0 " + (3 / 8) * h + ",0 " + (5 / 8) * h + "," + w / 8 + " " + (7 / 8) * h + "," + (3 / 8) * w + " " + h + "," +
                            (5 / 8) * w + " " + h + "," + (7 / 8) * w + " " + (7 / 8) * h + "," + w + " " + (5 / 8) * h + "," + w + " " + (3 / 8) * h + "," + (7 / 8) * w + " " + h / 8 + "," + (5 / 8) * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "star4":
                    case "star5":
                    case "star6":
                    case "star7":
                    case "star8":
                    case "star10":
                    case "star12":
                    case "star16":
                    case "star24":
                    case "star32":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);//[0]["attrs"]["fmla"];
                        var starNum = shapType.substr(4);
                        var shapAdjst1, adj;
                        switch (starNum) {
                            case "4":
                                adj = 30;
                                break;
                            case "5":
                                adj = 40;
                                break;
                            case "6":
                                adj = 60;
                                break;
                            case "7":
                                adj = 70;
                                break;
                            case "8":
                                adj = 77;
                                break;
                            case "10":
                                adj = 86;
                                break;
                            case "12":
                            case "16":
                            case "24":
                            case "32":
                                adj = 75;
                                break;
                        }
                        if (shapAdjst !== undefined) {
                            shapAdjst1 = getTextByPathList(shapAdjst, ["attrs", "fmla"]);
                            if (shapAdjst1 === undefined) {
                                shapAdjst1 = shapAdjst[0]["attrs"]["fmla"];
                            }
                            if (shapAdjst1 !== undefined) {
                                adj = 2 * parseInt(shapAdjst1.substr(4)) / 1000;
                            }
                        }

                        var points = shapeStar(adj, starNum);
                        result += " <polygon points='" + points + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "pie":
                    case "pieWedge":
                    case "arc":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var adj1, adj2, H, shapAdjst1, shapAdjst2, isClose;
                        if (shapType == "pie") {
                            adj1 = 0;
                            adj2 = 270;
                            H = h;
                            isClose = true;
                        } else if (shapType == "pieWedge") {
                            adj1 = 180;
                            adj2 = 270;
                            H = 2 * h;
                            isClose = true;
                        } else if (shapType == "arc") {
                            adj1 = 270;
                            adj2 = 0;
                            H = h;
                            isClose = false;
                        }
                        if (shapAdjst !== undefined) {
                            shapAdjst1 = getTextByPathList(shapAdjst, ["attrs", "fmla"]);
                            shapAdjst2 = shapAdjst1;
                            if (shapAdjst1 === undefined) {
                                shapAdjst1 = shapAdjst[0]["attrs"]["fmla"];
                                shapAdjst2 = shapAdjst[1]["attrs"]["fmla"];
                            }
                            if (shapAdjst1 !== undefined) {
                                adj1 = parseInt(shapAdjst1.substr(4)) / 60000;
                            }
                            if (shapAdjst2 !== undefined) {
                                adj2 = parseInt(shapAdjst2.substr(4)) / 60000;
                            }
                        }
                        var pieVals = shapePie(H, w, adj1, adj2, isClose);
                        //console.log("shapType: ",shapType,"\nimgFillFlg: ",imgFillFlg,"\ngrndFillFlg: ",grndFillFlg,"\nshpId: ",shpId,"\nfillColor: ",fillColor);
                        result += "<path   d='" + pieVals[0] + "' transform='" + pieVals[1] + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "chord":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 45;
                        var sAdj2, sAdj2_val = 270;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) / 60000;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj2_val = parseInt(sAdj2.substr(4)) / 60000;
                                }
                            }
                        }
                        var hR = h / 2;
                        var wR = w / 2;
                        var d_val = shapeArc(wR, hR, wR, hR, sAdj1_val, sAdj2_val, true);
                        //console.log("shapType: ",shapType,", sAdj1_val: ",sAdj1_val,", sAdj2_val: ",sAdj2_val)
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "frame":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj1 = 12500 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj1 = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a1, x1, x4, y4;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > cnstVal1) a1 = cnstVal1
                        else a1 = adj1
                        x1 = Math.min(w, h) * a1 / cnstVal2;
                        x4 = w - x1;
                        y4 = h - x1;
                        var d = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + x1 + "," + x1 +
                            " L" + x1 + "," + y4 +
                            " L" + x4 + "," + y4 +
                            " L" + x4 + "," + x1 +
                            " z";
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "donut":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a, dr, iwd2, ihd2;
                        if (adj < 0) a = 0
                        else if (adj > cnstVal1) a = cnstVal1
                        else a = adj
                        dr = Math.min(w, h) * a / cnstVal2;
                        iwd2 = w / 2 - dr;
                        ihd2 = h / 2 - dr;
                        var d = "M" + 0 + "," + h / 2 +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 180, 270, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 270, 360, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 0, 90, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 90, 180, false).replace("M", "L") +
                            " z" +
                            "M" + dr + "," + h / 2 +
                            shapeArc(w / 2, h / 2, iwd2, ihd2, 180, 90, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, iwd2, ihd2, 90, 0, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, iwd2, ihd2, 0, -90, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, iwd2, ihd2, 270, 180, false).replace("M", "L") +
                            " z";
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "noSmoking":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 18750 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a, dr, iwd2, ihd2, ang, ang2rad, ct, st, m, n, drd2, dang, dang2, swAng, t3, stAng1, stAng2;
                        if (adj < 0) a = 0
                        else if (adj > cnstVal1) a = cnstVal1
                        else a = adj
                        dr = Math.min(w, h) * a / cnstVal2;
                        iwd2 = w / 2 - dr;
                        ihd2 = h / 2 - dr;
                        ang = Math.atan(h / w);
                        //ang2rad = ang*Math.PI/180;
                        ct = ihd2 * Math.cos(ang);
                        st = iwd2 * Math.sin(ang);
                        m = Math.sqrt(ct * ct + st * st); //"mod ct st 0"
                        n = iwd2 * ihd2 / m;
                        drd2 = dr / 2;
                        dang = Math.atan(drd2 / n);
                        dang2 = dang * 2;
                        swAng = -Math.PI + dang2;
                        //t3 = Math.atan(h/w);
                        stAng1 = ang - dang;
                        stAng2 = stAng1 - Math.PI;
                        var ct1, st1, m1, n1, dx1, dy1, x1, y1, y1, y2;
                        ct1 = ihd2 * Math.cos(stAng1);
                        st1 = iwd2 * Math.sin(stAng1);
                        m1 = Math.sqrt(ct1 * ct1 + st1 * st1); //"mod ct1 st1 0"
                        n1 = iwd2 * ihd2 / m1;
                        dx1 = n1 * Math.cos(stAng1);
                        dy1 = n1 * Math.sin(stAng1);
                        x1 = w / 2 + dx1;
                        y1 = h / 2 + dy1;
                        x2 = w / 2 - dx1;
                        y2 = h / 2 - dy1;
                        var stAng1deg = stAng1 * 180 / Math.PI;
                        var stAng2deg = stAng2 * 180 / Math.PI;
                        var swAng2deg = swAng * 180 / Math.PI;
                        var d = "M" + 0 + "," + h / 2 +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 180, 270, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 270, 360, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 0, 90, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 90, 180, false).replace("M", "L") +
                            " z" +
                            "M" + x1 + "," + y1 +
                            shapeArc(w / 2, h / 2, iwd2, ihd2, stAng1deg, (stAng1deg + swAng2deg), false).replace("M", "L") +
                            " z" +
                            "M" + x2 + "," + y2 +
                            shapeArc(w / 2, h / 2, iwd2, ihd2, stAng2deg, (stAng2deg + swAng2deg), false).replace("M", "L") +
                            " z";
                        //console.log("adj: ",adj,"x1:",x1,",y1:",y1," x2:",x2,",y2:",y2,",stAng1:",stAng1,",stAng1deg:",stAng1deg,",stAng2:",stAng2,",stAng2deg:",stAng2deg,",swAng:",swAng,",swAng2deg:",swAng2deg)

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "halfFrame":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 3.5;
                        var sAdj2, sAdj2_val = 3.5;
                        var cnsVal = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj2_val = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var minWH = Math.min(w, h);
                        var maxAdj2 = (cnsVal * w) / minWH;
                        var a1, a2;
                        if (sAdj2_val < 0) a2 = 0
                        else if (sAdj2_val > maxAdj2) a2 = maxAdj2
                        else a2 = sAdj2_val
                        var x1 = (minWH * a2) / cnsVal;
                        var g1 = h * x1 / w;
                        var g2 = h - g1;
                        var maxAdj1 = (cnsVal * g2) / minWH;
                        if (sAdj1_val < 0) a1 = 0
                        else if (sAdj1_val > maxAdj1) a1 = maxAdj1
                        else a1 = sAdj1_val
                        var y1 = minWH * a1 / cnsVal;
                        var dx2 = y1 * w / h;
                        var x2 = w - dx2;
                        var dy2 = x1 * h / w;
                        var y2 = h - dy2;
                        var d = "M0,0" +
                            " L" + w + "," + 0 +
                            " L" + x2 + "," + y1 +
                            " L" + x1 + "," + y1 +
                            " L" + x1 + "," + y2 +
                            " L0," + h + " z";

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        //console.log("w: ",w,", h: ",h,", sAdj1_val: ",sAdj1_val,", sAdj2_val: ",sAdj2_val,",maxAdj1: ",maxAdj1,",maxAdj2: ",maxAdj2)
                        break;
                    case "blockArc":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 180;
                        var sAdj2, adj2 = 0;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) / 60000;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) / 60000;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }

                        var stAng, istAng, a3, sw11, sw12, swAng, iswAng;
                        var cd1 = 360;
                        if (adj1 < 0) stAng = 0
                        else if (adj1 > cd1) stAng = cd1
                        else stAng = adj1 //180

                        if (adj2 < 0) istAng = 0
                        else if (adj2 > cd1) istAng = cd1
                        else istAng = adj2 //0

                        if (adj3 < 0) a3 = 0
                        else if (adj3 > cnstVal1) a3 = cnstVal1
                        else a3 = adj3

                        sw11 = istAng - stAng; // -180
                        sw12 = sw11 + cd1; //180
                        swAng = (sw11 > 0) ? sw11 : sw12; //180
                        iswAng = -swAng; //-180

                        var endAng = stAng + swAng;
                        var iendAng = istAng + iswAng;

                        var wt1, ht1, dx1, dy1, x1, y1, stRd, istRd, wd2, hd2, hc, vc;
                        stRd = stAng * (Math.PI) / 180;
                        istRd = istAng * (Math.PI) / 180;
                        wd2 = w / 2;
                        hd2 = h / 2;
                        hc = w / 2;
                        vc = h / 2;
                        if (stAng > 90 && stAng < 270) {
                            wt1 = wd2 * (Math.sin((Math.PI) / 2 - stRd));
                            ht1 = hd2 * (Math.cos((Math.PI) / 2 - stRd));

                            dx1 = wd2 * (Math.cos(Math.atan(ht1 / wt1)));
                            dy1 = hd2 * (Math.sin(Math.atan(ht1 / wt1)));

                            x1 = hc - dx1;
                            y1 = vc - dy1;
                        } else {
                            wt1 = wd2 * (Math.sin(stRd));
                            ht1 = hd2 * (Math.cos(stRd));

                            dx1 = wd2 * (Math.cos(Math.atan(wt1 / ht1)));
                            dy1 = hd2 * (Math.sin(Math.atan(wt1 / ht1)));

                            x1 = hc + dx1;
                            y1 = vc + dy1;
                        }
                        var dr, iwd2, ihd2, wt2, ht2, dx2, dy2, x2, y2;
                        dr = Math.min(w, h) * a3 / cnstVal2;
                        iwd2 = wd2 - dr;
                        ihd2 = hd2 - dr;
                        //console.log("stAng: ",stAng," swAng: ",swAng ," endAng:",endAng)
                        if ((endAng <= 450 && endAng > 270) || ((endAng >= 630 && endAng < 720))) {
                            wt2 = iwd2 * (Math.sin(istRd));
                            ht2 = ihd2 * (Math.cos(istRd));
                            dx2 = iwd2 * (Math.cos(Math.atan(wt2 / ht2)));
                            dy2 = ihd2 * (Math.sin(Math.atan(wt2 / ht2)));
                            x2 = hc + dx2;
                            y2 = vc + dy2;
                        } else {
                            wt2 = iwd2 * (Math.sin((Math.PI) / 2 - istRd));
                            ht2 = ihd2 * (Math.cos((Math.PI) / 2 - istRd));

                            dx2 = iwd2 * (Math.cos(Math.atan(ht2 / wt2)));
                            dy2 = ihd2 * (Math.sin(Math.atan(ht2 / wt2)));
                            x2 = hc - dx2;
                            y2 = vc - dy2;
                        }
                        var d = "M" + x1 + "," + y1 +
                            shapeArc(wd2, hd2, wd2, hd2, stAng, endAng, false).replace("M", "L") +
                            " L" + x2 + "," + y2 +
                            shapeArc(wd2, hd2, iwd2, ihd2, istAng, iendAng, false).replace("M", "L") +
                            " z";
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "bracePair":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 8333 * 96 / 914400;
                        var cnstVal1 = 25000 * 96 / 914400;
                        var cnstVal2 = 50000 * 96 / 914400;
                        var cnstVal3 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var vc = h / 2, cd = 360, cd2 = 180, cd4 = 90, c3d4 = 270, a, x1, x2, x3, x4, y2, y3, y4;
                        if (adj < 0) a = 0
                        else if (adj > cnstVal1) a = cnstVal1
                        else a = adj
                        var minWH = Math.min(w, h);
                        x1 = minWH * a / cnstVal3;
                        x2 = minWH * a / cnstVal2;
                        x3 = w - x2;
                        x4 = w - x1;
                        y2 = vc - x1;
                        y3 = vc + x1;
                        y4 = h - x1;
                        //console.log("w:",w," h:",h," x1:",x1," x2:",x2," x3:",x3," x4:",x4," y2:",y2," y3:",y3," y4:",y4)
                        var d = "M" + x2 + "," + h +
                            shapeArc(x2, y4, x1, x1, cd4, cd2, false).replace("M", "L") +
                            " L" + x1 + "," + y3 +
                            shapeArc(0, y3, x1, x1, 0, (-cd4), false).replace("M", "L") +
                            shapeArc(0, y2, x1, x1, cd4, 0, false).replace("M", "L") +
                            " L" + x1 + "," + x1 +
                            shapeArc(x2, x1, x1, x1, cd2, c3d4, false).replace("M", "L") +
                            " M" + x3 + "," + 0 +
                            shapeArc(x3, x1, x1, x1, c3d4, cd, false).replace("M", "L") +
                            " L" + x4 + "," + y2 +
                            shapeArc(w, y2, x1, x1, cd2, cd4, false).replace("M", "L") +
                            shapeArc(w, y3, x1, x1, c3d4, cd2, false).replace("M", "L") +
                            " L" + x4 + "," + y4 +
                            shapeArc(x3, y4, x1, x1, 0, cd4, false).replace("M", "L");

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "leftBrace":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 8333 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, cd2 = 180, cd4 = 90, c3d4 = 270, a1, a2, q1, q2, q3, y1, y2, y3, y4;
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal2) a2 = cnstVal2
                        else a2 = adj2
                        var minWH = Math.min(w, h);
                        q1 = cnstVal2 - a2;
                        if (q1 < a2) q2 = q1
                        else q2 = a2
                        q3 = q2 / 2;
                        var maxAdj1 = q3 * h / minWH;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        y1 = minWH * a1 / cnstVal2;
                        y3 = h * a2 / cnstVal2;
                        y2 = y3 - y1;
                        y4 = y3 + y1;
                        //console.log("w:",w," h:",h," q1:",q1," q2:",q2," q3:",q3," y1:",y1," y3:",y3," y4:",y4," maxAdj1:",maxAdj1)
                        var d = "M" + w + "," + h +
                            shapeArc(w, h - y1, w / 2, y1, cd4, cd2, false).replace("M", "L") +
                            " L" + w / 2 + "," + y4 +
                            shapeArc(0, y4, w / 2, y1, 0, (-cd4), false).replace("M", "L") +
                            shapeArc(0, y2, w / 2, y1, cd4, 0, false).replace("M", "L") +
                            " L" + w / 2 + "," + y1 +
                            shapeArc(w, y1, w / 2, y1, cd2, c3d4, false).replace("M", "L");

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "rightBrace":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 8333 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, cd = 360, cd2 = 180, cd4 = 90, c3d4 = 270, a1, a2, q1, q2, q3, y1, y2, y3, y4;
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal2) a2 = cnstVal2
                        else a2 = adj2
                        var minWH = Math.min(w, h);
                        q1 = cnstVal2 - a2;
                        if (q1 < a2) q2 = q1
                        else q2 = a2
                        q3 = q2 / 2;
                        var maxAdj1 = q3 * h / minWH;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        y1 = minWH * a1 / cnstVal2;
                        y3 = h * a2 / cnstVal2;
                        y2 = y3 - y1;
                        y4 = h - y1;
                        //console.log("w:",w," h:",h," q1:",q1," q2:",q2," q3:",q3," y1:",y1," y2:",y2," y3:",y3," y4:",y4," maxAdj1:",maxAdj1)
                        var d = "M" + 0 + "," + 0 +
                            shapeArc(0, y1, w / 2, y1, c3d4, cd, false).replace("M", "L") +
                            " L" + w / 2 + "," + y2 +
                            shapeArc(w, y2, w / 2, y1, cd2, cd4, false).replace("M", "L") +
                            shapeArc(w, y3 + y1, w / 2, y1, c3d4, cd2, false).replace("M", "L") +
                            " L" + w / 2 + "," + y4 +
                            shapeArc(0, y4, w / 2, y1, 0, cd4, false).replace("M", "L");

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "bracketPair":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 16667 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var r = w, b = h, cd2 = 180, cd4 = 90, c3d4 = 270, a, x1, x2, y2;
                        if (adj < 0) a = 0
                        else if (adj > cnstVal1) a = cnstVal1
                        else a = adj
                        x1 = Math.min(w, h) * a / cnstVal2;
                        x2 = r - x1;
                        y2 = b - x1;
                        //console.log("w:",w," h:",h," x1:",x1," x2:",x2," y2:",y2)
                        var d = shapeArc(x1, x1, x1, x1, c3d4, cd2, false) +
                            shapeArc(x1, y2, x1, x1, cd2, cd4, false).replace("M", "L") +
                            shapeArc(x2, x1, x1, x1, c3d4, (c3d4 + cd4), false) +
                            shapeArc(x2, y2, x1, x1, 0, cd4, false).replace("M", "L");
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "leftBracket":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 8333 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var maxAdj = cnstVal1 * h / Math.min(w, h);
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var r = w, b = h, cd2 = 180, cd4 = 90, c3d4 = 270, a, y1, y2;
                        if (adj < 0) a = 0
                        else if (adj > maxAdj) a = maxAdj
                        else a = adj
                        y1 = Math.min(w, h) * a / cnstVal2;
                        if (y1 > w) y1 = w;
                        y2 = b - y1;
                        var d = "M" + r + "," + b +
                            shapeArc(y1, y2, y1, y1, cd4, cd2, false).replace("M", "L") +
                            " L" + 0 + "," + y1 +
                            shapeArc(y1, y1, y1, y1, cd2, c3d4, false).replace("M", "L") +
                            " L" + r + "," + 0
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "rightBracket":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 8333 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var maxAdj = cnstVal1 * h / Math.min(w, h);
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var cd = 360, cd2 = 180, cd4 = 90, c3d4 = 270, a, y1, y2, y3;
                        if (adj < 0) a = 0
                        else if (adj > maxAdj) a = maxAdj
                        else a = adj
                        y1 = Math.min(w, h) * a / cnstVal2;
                        y2 = h - y1;
                        y3 = w - y1;
                        //console.log("w:",w," h:",h," y1:",y1," y2:",y2," y3:",y3)
                        var d = "M" + 0 + "," + h +
                            shapeArc(y3, y2, y1, y1, cd4, 0, false).replace("M", "L") +
                            //" L"+ r + "," + y2 +
                            " L" + w + "," + h / 2 +
                            shapeArc(y3, y1, y1, y1, cd, c3d4, false).replace("M", "L") +
                            " L" + 0 + "," + 0
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "moon":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 0.5;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) / 100000;//*96/914400;;
                        }
                        var hd2, cd2, cd4;

                        hd2 = h / 2;
                        cd2 = 180;
                        cd4 = 90;

                        var adj2 = (1 - adj) * w;
                        var d = "M" + w + "," + h +
                            shapeArc(w, hd2, w, hd2, cd4, (cd4 + cd2), false).replace("M", "L") +
                            shapeArc(w, hd2, adj2, hd2, (cd4 + cd2), cd4, false).replace("M", "L") +
                            " z";
                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "corner":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 50000 * 96 / 914400;
                        var sAdj2, sAdj2_val = 50000 * 96 / 914400;
                        var cnsVal = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj2_val = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var minWH = Math.min(w, h);
                        var maxAdj1 = cnsVal * h / minWH;
                        var maxAdj2 = cnsVal * w / minWH;
                        var a1, a2, x1, dy1, y1;
                        if (sAdj1_val < 0) a1 = 0
                        else if (sAdj1_val > maxAdj1) a1 = maxAdj1
                        else a1 = sAdj1_val

                        if (sAdj2_val < 0) a2 = 0
                        else if (sAdj2_val > maxAdj2) a2 = maxAdj2
                        else a2 = sAdj2_val
                        x1 = minWH * a2 / cnsVal;
                        dy1 = minWH * a1 / cnsVal;
                        y1 = h - dy1;

                        var d = "M0,0" +
                            " L" + x1 + "," + 0 +
                            " L" + x1 + "," + y1 +
                            " L" + w + "," + y1 +
                            " L" + w + "," + h +
                            " L0," + h + " z";

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "diagStripe":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var sAdj1_val = 50000 * 96 / 914400;
                        var cnsVal = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            sAdj1_val = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a1, x2, y2;
                        if (sAdj1_val < 0) a1 = 0
                        else if (sAdj1_val > cnsVal) a1 = cnsVal
                        else a1 = sAdj1_val
                        x2 = w * a1 / cnsVal;
                        y2 = h * a1 / cnsVal;
                        var d = "M" + 0 + "," + y2 +
                            " L" + x2 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + 0 + "," + h + " z";

                        result += "<path   d='" + d + "'  fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "gear6":
                    case "gear9":
                        txtRotate = 0;
                        var gearNum = shapType.substr(4), d;
                        if (gearNum == "6") {
                            d = shapeGear(w, h / 3.5, parseInt(gearNum));
                        } else { //gearNum=="9"
                            d = shapeGear(w, h / 3.5, parseInt(gearNum));
                        }
                        result += "<path   d='" + d + "' transform='rotate(20," + (3 / 7) * h + "," + (3 / 7) * h + ")' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "bentConnector3":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var shapAdjst_val = 0.5;
                        if (shapAdjst !== undefined) {
                            shapAdjst_val = parseInt(shapAdjst.substr(4)) / 100000;
                            if (isFlipV) {
                                result += " <polyline points='" + w + " 0," + ((1 - shapAdjst_val) * w) + " 0," + ((1 - shapAdjst_val) * w) + " " + h + ",0 " + h + "' fill='transparent'" +
                                    "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' ";
                            } else {
                                result += " <polyline points='0 0," + (shapAdjst_val) * w + " 0," + (shapAdjst_val) * w + " " + h + "," + w + " " + h + "' fill='transparent'" +
                                    "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' ";
                            }
                            if (headEndNodeAttrs !== undefined && (headEndNodeAttrs["type"] === "triangle" || headEndNodeAttrs["type"] === "arrow")) {
                                result += "marker-start='url(#markerTriangle_" + shpId + ")' ";
                            }
                            if (tailEndNodeAttrs !== undefined && (tailEndNodeAttrs["type"] === "triangle" || tailEndNodeAttrs["type"] === "arrow")) {
                                result += "marker-end='url(#markerTriangle_" + shpId + ")' ";
                            }
                            result += "/>";
                        }
                        break;
                    case "plus":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj1 = 0.25;
                        if (shapAdjst !== undefined) {
                            adj1 = parseInt(shapAdjst.substr(4)) / 100000;

                        }
                        var adj2 = (1 - adj1);
                        result += " <polygon points='" + adj1 * w + " 0," + adj1 * w + " " + adj1 * h + ",0 " + adj1 * h + ",0 " + adj2 * h + "," +
                            adj1 * w + " " + adj2 * h + "," + adj1 * w + " " + h + "," + adj2 * w + " " + h + "," + adj2 * w + " " + adj2 * h + "," + w + " " + adj2 * h + "," +
                            +w + " " + adj1 * h + "," + adj2 * w + " " + adj1 * h + "," + adj2 * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "teardrop":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj1 = 100000 * 96 / 914400;
                        var cnsVal1 = adj1;
                        var cnsVal2 = 200000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj1 = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a1, r2, tw, th, sw, sh, dx1, dy1, x1, y1, x2, y2, rd45;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > cnsVal2) a1 = cnsVal2
                        else a1 = adj1
                        r2 = Math.sqrt(2);
                        tw = r2 * (w / 2);
                        th = r2 * (h / 2);
                        sw = (tw * a1) / cnsVal1;
                        sh = (th * a1) / cnsVal1;
                        rd45 = (45 * (Math.PI) / 180);
                        dx1 = sw * (Math.cos(rd45));
                        dy1 = sh * (Math.cos(rd45));
                        x1 = (w / 2) + dx1;
                        y1 = (h / 2) - dy1;
                        x2 = ((w / 2) + x1) / 2;
                        y2 = ((h / 2) + y1) / 2;

                        var d_val = shapeArc(w / 2, h / 2, w / 2, h / 2, 180, 270, false) +
                            "Q " + x2 + ",0 " + x1 + "," + y1 +
                            "Q " + w + "," + y2 + " " + w + "," + h / 2 +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 0, 90, false).replace("M", "L") +
                            shapeArc(w / 2, h / 2, w / 2, h / 2, 90, 180, false).replace("M", "L") + " z";
                        result += "<path   d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        // console.log("shapAdjst: ",shapAdjst,", adj1: ",adj1);
                        break;
                    case "plaque":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj1 = 16667 * 96 / 914400;
                        var cnsVal1 = 50000 * 96 / 914400;
                        var cnsVal2 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj1 = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a1, x1, x2, y2;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > cnsVal1) a1 = cnsVal1
                        else a1 = adj1
                        x1 = a1 * (Math.min(w, h)) / cnsVal2;
                        x2 = w - x1;
                        y2 = h - x1;

                        var d_val = "M0," + x1 +
                            shapeArc(0, 0, x1, x1, 90, 0, false).replace("M", "L") +
                            " L" + x2 + "," + 0 +
                            shapeArc(w, 0, x1, x1, 180, 90, false).replace("M", "L") +
                            " L" + w + "," + y2 +
                            shapeArc(w, h, x1, x1, 270, 180, false).replace("M", "L") +
                            " L" + x1 + "," + h +
                            shapeArc(0, h, x1, x1, 0, -90, false).replace("M", "L") + " z";
                        result += "<path   d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "sun":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var refr = 96 / 914400;
                        var adj1 = 25000 * refr;
                        var cnstVal1 = 12500 * refr;
                        var cnstVal2 = 46875 * refr;
                        if (shapAdjst !== undefined) {
                            adj1 = parseInt(shapAdjst.substr(4)) * refr;
                        }
                        var a1;
                        if (adj1 < cnstVal1) a1 = cnstVal1
                        else if (adj1 > cnstVal2) a1 = cnstVal2
                        else a1 = adj1

                        var cnstVa3 = 50000 * refr;
                        var cnstVa4 = 100000 * refr;
                        var g0 = cnstVa3 - a1,
                            g1 = g0 * (30274 * refr) / (32768 * refr),
                            g2 = g0 * (12540 * refr) / (32768 * refr),
                            g3 = g1 + cnstVa3,
                            g4 = g2 + cnstVa3,
                            g5 = cnstVa3 - g1,
                            g6 = cnstVa3 - g2,
                            g7 = g0 * (23170 * refr) / (32768 * refr),
                            g8 = cnstVa3 + g7,
                            g9 = cnstVa3 - g7,
                            g10 = g5 * 3 / 4,
                            g11 = g6 * 3 / 4,
                            g12 = g10 + 3662 * refr,
                            g13 = g11 + 36620 * refr,
                            g14 = g11 + 12500 * refr,
                            g15 = cnstVa4 - g10,
                            g16 = cnstVa4 - g12,
                            g17 = cnstVa4 - g13,
                            g18 = cnstVa4 - g14,
                            ox1 = w * (18436 * refr) / (21600 * refr),
                            oy1 = h * (3163 * refr) / (21600 * refr),
                            ox2 = w * (3163 * refr) / (21600 * refr),
                            oy2 = h * (18436 * refr) / (21600 * refr),
                            x8 = w * g8 / cnstVa4,
                            x9 = w * g9 / cnstVa4,
                            x10 = w * g10 / cnstVa4,
                            x12 = w * g12 / cnstVa4,
                            x13 = w * g13 / cnstVa4,
                            x14 = w * g14 / cnstVa4,
                            x15 = w * g15 / cnstVa4,
                            x16 = w * g16 / cnstVa4,
                            x17 = w * g17 / cnstVa4,
                            x18 = w * g18 / cnstVa4,
                            x19 = w * a1 / cnstVa4,
                            wR = w * g0 / cnstVa4,
                            hR = h * g0 / cnstVa4,
                            y8 = h * g8 / cnstVa4,
                            y9 = h * g9 / cnstVa4,
                            y10 = h * g10 / cnstVa4,
                            y12 = h * g12 / cnstVa4,
                            y13 = h * g13 / cnstVa4,
                            y14 = h * g14 / cnstVa4,
                            y15 = h * g15 / cnstVa4,
                            y16 = h * g16 / cnstVa4,
                            y17 = h * g17 / cnstVa4,
                            y18 = h * g18 / cnstVa4;

                        var d_val = "M" + w + "," + h / 2 +
                            " L" + x15 + "," + y18 +
                            " L" + x15 + "," + y14 +
                            "z" +
                            " M" + ox1 + "," + oy1 +
                            " L" + x16 + "," + y17 +
                            " L" + x13 + "," + y12 +
                            "z" +
                            " M" + w / 2 + "," + 0 +
                            " L" + x18 + "," + y10 +
                            " L" + x14 + "," + y10 +
                            "z" +
                            " M" + ox2 + "," + oy1 +
                            " L" + x17 + "," + y12 +
                            " L" + x12 + "," + y17 +
                            "z" +
                            " M" + 0 + "," + h / 2 +
                            " L" + x10 + "," + y14 +
                            " L" + x10 + "," + y18 +
                            "z" +
                            " M" + ox2 + "," + oy2 +
                            " L" + x12 + "," + y13 +
                            " L" + x17 + "," + y16 +
                            "z" +
                            " M" + w / 2 + "," + h +
                            " L" + x14 + "," + y15 +
                            " L" + x18 + "," + y15 +
                            "z" +
                            " M" + ox1 + "," + oy2 +
                            " L" + x13 + "," + y16 +
                            " L" + x16 + "," + y13 +
                            " z" +
                            " M" + x19 + "," + h / 2 +
                            shapeArc(w / 2, h / 2, wR, hR, 180, 540, false).replace("M", "L") +
                            " z";
                        //console.log("adj1: ",adj1,d_val);
                        result += "<path   d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";


                        break;
                    case "heart":
                        var dx1, dx2, x1, x2, x3, x4, y1;
                        dx1 = w * 49 / 48;
                        dx2 = w * 10 / 48
                        x1 = w / 2 - dx1
                        x2 = w / 2 - dx2
                        x3 = w / 2 + dx2
                        x4 = w / 2 + dx1
                        y1 = -h / 3;
                        var d_val = "M" + w / 2 + "," + h / 4 +
                            "C" + x3 + "," + y1 + " " + x4 + "," + h / 4 + " " + w / 2 + "," + h +
                            "C" + x1 + "," + h / 4 + " " + x2 + "," + y1 + " " + w / 2 + "," + h / 4 + " z";

                        result += "<path   d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "lightningBolt":
                        var x1 = w * 5022 / 21600,
                            x2 = w * 11050 / 21600,
                            x3 = w * 8472 / 21600,
                            x4 = w * 8757 / 21600,
                            x5 = w * 10012 / 21600,
                            x6 = w * 14767 / 21600,
                            x7 = w * 12222 / 21600,
                            x8 = w * 12860 / 21600,
                            x9 = w * 13917 / 21600,
                            x10 = w * 7602 / 21600,
                            x11 = w * 16577 / 21600,
                            y1 = h * 3890 / 21600,
                            y2 = h * 6080 / 21600,
                            y3 = h * 6797 / 21600,
                            y4 = h * 7437 / 21600,
                            y5 = h * 12877 / 21600,
                            y6 = h * 9705 / 21600,
                            y7 = h * 12007 / 21600,
                            y8 = h * 13987 / 21600,
                            y9 = h * 8382 / 21600,
                            y10 = h * 14277 / 21600,
                            y11 = h * 14915 / 21600;

                        var d_val = "M" + x3 + "," + 0 +
                            " L" + x8 + "," + y2 +
                            " L" + x2 + "," + y3 +
                            " L" + x11 + "," + y7 +
                            " L" + x6 + "," + y5 +
                            " L" + w + "," + h +
                            " L" + x5 + "," + y11 +
                            " L" + x7 + "," + y8 +
                            " L" + x1 + "," + y6 +
                            " L" + x10 + "," + y9 +
                            " L" + 0 + "," + y1 + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "cube":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var refr = 96 / 914400;
                        var adj = 25000 * refr;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * refr;
                        }
                        var d_val;
                        var cnstVal2 = 100000 * refr;
                        var ss = Math.min(w, h);
                        var a, y1, y4, x4;
                        a = (adj < 0) ? 0 : (adj > cnstVal2) ? cnstVal2 : adj;
                        y1 = ss * a / cnstVal2;
                        y4 = h - y1;
                        x4 = w - y1;
                        d_val = "M" + 0 + "," + y1 +
                            " L" + y1 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + y4 +
                            " L" + x4 + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            "M" + 0 + "," + y1 +
                            " L" + x4 + "," + y1 +
                            " M" + x4 + "," + y1 +
                            " L" + w + "," + 0 +
                            "M" + x4 + "," + y1 +
                            " L" + x4 + "," + h;

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "bevel":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var refr = 96 / 914400;
                        var adj = 12500 * refr;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * refr;
                        }
                        var d_val;
                        var cnstVal1 = 50000 * refr;
                        var cnstVal2 = 100000 * refr;
                        var ss = Math.min(w, h);
                        var a, x1, x2, y2;
                        a = (adj < 0) ? 0 : (adj > cnstVal1) ? cnstVal1 : adj;
                        x1 = ss * a / cnstVal2;
                        x2 = w - x1;
                        y2 = h - x1;
                        d_val = "M" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + h +
                            " L" + 0 + "," + h +
                            " z" +
                            " M" + x1 + "," + x1 +
                            " L" + x2 + "," + x1 +
                            " L" + x2 + "," + y2 +
                            " L" + x1 + "," + y2 +
                            " z" +
                            " M" + 0 + "," + 0 +
                            " L" + x1 + "," + x1 +
                            " M" + 0 + "," + h +
                            " L" + x1 + "," + y2 +
                            " M" + w + "," + 0 +
                            " L" + x2 + "," + x1 +
                            " M" + w + "," + h +
                            " L" + x2 + "," + y2;

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "foldedCorner":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var refr = 96 / 914400;
                        var adj = 16667 * refr;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * refr;
                        }
                        var d_val;
                        var cnstVal1 = 50000 * refr;
                        var cnstVal2 = 100000 * refr;
                        var ss = Math.min(w, h);
                        var a, dy2, dy1, x1, x2, y2, y1;
                        a = (adj < 0) ? 0 : (adj > cnstVal1) ? cnstVal1 : adj;
                        dy2 = ss * a / cnstVal2;
                        dy1 = dy2 / 5;
                        x1 = w - dy2;
                        x2 = x1 + dy1;
                        y2 = h - dy2;
                        y1 = y2 + dy1;
                        d_val = "M" + x1 + "," + h +
                            " L" + x2 + "," + y1 +
                            " L" + w + "," + y2 +
                            " L" + x1 + "," + h +
                            " L" + 0 + "," + h +
                            " L" + 0 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + y2;

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "cloud":
                    case "cloudCallout":
                        var x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, y0, y1, y2, y3, y4, y5, y6, y7, y8, y9, y10, y11,
                            rx1, rx2, rx3, rx4, rx5, rx6, rx7, rx8, rx9, rx10, rx11, ry1, ry2, ry3, ry4, ry5, ry6, ry7, ry8, ry9, ry10, ry11;
                        x0 = w * 3900 / 43200;;
                        x1 = w * 4693 / 43200;
                        x2 = w * 6928 / 43200;
                        x3 = w * 16478 / 43200;
                        x4 = w * 28827 / 43200;
                        x5 = w * 34129 / 43200;
                        x6 = w * 41798 / 43200;
                        x7 = w * 38324 / 43200;
                        x8 = w * 29078 / 43200;
                        x9 = w * 22141 / 43200;
                        x10 = w * 14000 / 43200;
                        x11 = w * 4127 / 43200;
                        y0 = h * 14370 / 43200;
                        y1 = h * 26177 / 43200;
                        y2 = h * 34899 / 43200;
                        y3 = h * 39090 / 43200;
                        y4 = h * 34751 / 43200;
                        y5 = h * 22954 / 43200;
                        y6 = h * 15354 / 43200;
                        y7 = h * 5426 / 43200;
                        y8 = h * 3952 / 43200;
                        y9 = h * 4720 / 43200;
                        y10 = h * 5192 / 43200;
                        y11 = h * 15789 / 43200;
                        //Path:
                        //(path attrs: w = 43200; h = 43200; )
                        var rX1 = w * 6753 / 43200, rY1 = h * 9190 / 43200, rX2 = w * 5333 / 43200, rY2 = h * 7267 / 43200, rX3 = w * 4365 / 43200,
                            rY3 = h * 5945 / 43200, rX4 = w * 4857 / 43200, rY4 = h * 6595 / 43200, rY5 = h * 7273 / 43200, rX6 = w * 6775 / 43200,
                            rY6 = h * 9220 / 43200, rX7 = w * 5785 / 43200, rY7 = h * 7867 / 43200, rX8 = w * 6752 / 43200, rY8 = h * 9215 / 43200,
                            rX9 = w * 7720 / 43200, rY9 = h * 10543 / 43200, rX10 = w * 4360 / 43200, rY10 = h * 5918 / 43200, rX11 = w * 4345 / 43200;
                        var sA1 = -11429249 / 60000, wA1 = 7426832 / 60000, sA2 = -8646143 / 60000, wA2 = 5396714 / 60000, sA3 = -8748475 / 60000,
                            wA3 = 5983381 / 60000, sA4 = -7859164 / 60000, wA4 = 7034504 / 60000, sA5 = -4722533 / 60000, wA5 = 6541615 / 60000,
                            sA6 = -2776035 / 60000, wA6 = 7816140 / 60000, sA7 = 37501 / 60000, wA7 = 6842000 / 60000, sA8 = 1347096 / 60000,
                            wA8 = 6910353 / 60000, sA9 = 3974558 / 60000, wA9 = 4542661 / 60000, sA10 = -16496525 / 60000, wA10 = 8804134 / 60000,
                            sA11 = -14809710 / 60000, wA11 = 9151131 / 60000;

                        var cX0, cX1, cX2, cX3, cX4, cX5, cX6, cX7, cX8, cX9, cX10, cY0, cY1, cY2, cY3, cY4, cY5, cY6, cY7, cY8, cY9, cY10;
                        var arc1, arc2, arc3, arc4, arc5, arc6, arc7, arc8, arc9, arc10, arc11;
                        var lxy1, lxy2, lxy3, lxy4, lxy5, lxy6, lxy7, lxy8, lxy9, lxy10;

                        cX0 = x0 - rX1 * Math.cos(sA1 * Math.PI / 180);
                        cY0 = y0 - rY1 * Math.sin(sA1 * Math.PI / 180);
                        arc1 = shapeArc(cX0, cY0, rX1, rY1, sA1, sA1 + wA1, false).replace("M", "L");
                        lxy1 = arc1.substr(arc1.lastIndexOf("L") + 1).split(" ");
                        cX1 = parseInt(lxy1[0]) - rX2 * Math.cos(sA2 * Math.PI / 180);
                        cY1 = parseInt(lxy1[1]) - rY2 * Math.sin(sA2 * Math.PI / 180);
                        arc2 = shapeArc(cX1, cY1, rX2, rY2, sA2, sA2 + wA2, false).replace("M", "L");
                        lxy2 = arc2.substr(arc2.lastIndexOf("L") + 1).split(" ");
                        cX2 = parseInt(lxy2[0]) - rX3 * Math.cos(sA3 * Math.PI / 180);
                        cY2 = parseInt(lxy2[1]) - rY3 * Math.sin(sA3 * Math.PI / 180);
                        arc3 = shapeArc(cX2, cY2, rX3, rY3, sA3, sA3 + wA3, false).replace("M", "L");
                        lxy3 = arc3.substr(arc3.lastIndexOf("L") + 1).split(" ");
                        cX3 = parseInt(lxy3[0]) - rX4 * Math.cos(sA4 * Math.PI / 180);
                        cY3 = parseInt(lxy3[1]) - rY4 * Math.sin(sA4 * Math.PI / 180);
                        arc4 = shapeArc(cX3, cY3, rX4, rY4, sA4, sA4 + wA4, false).replace("M", "L");
                        lxy4 = arc4.substr(arc4.lastIndexOf("L") + 1).split(" ");
                        cX4 = parseInt(lxy4[0]) - rX2 * Math.cos(sA5 * Math.PI / 180);
                        cY4 = parseInt(lxy4[1]) - rY5 * Math.sin(sA5 * Math.PI / 180);
                        arc5 = shapeArc(cX4, cY4, rX2, rY5, sA5, sA5 + wA5, false).replace("M", "L");
                        lxy5 = arc5.substr(arc5.lastIndexOf("L") + 1).split(" ");
                        cX5 = parseInt(lxy5[0]) - rX6 * Math.cos(sA6 * Math.PI / 180);
                        cY5 = parseInt(lxy5[1]) - rY6 * Math.sin(sA6 * Math.PI / 180);
                        arc6 = shapeArc(cX5, cY5, rX6, rY6, sA6, sA6 + wA6, false).replace("M", "L");
                        lxy6 = arc6.substr(arc6.lastIndexOf("L") + 1).split(" ");
                        cX6 = parseInt(lxy6[0]) - rX7 * Math.cos(sA7 * Math.PI / 180);
                        cY6 = parseInt(lxy6[1]) - rY7 * Math.sin(sA7 * Math.PI / 180);
                        arc7 = shapeArc(cX6, cY6, rX7, rY7, sA7, sA7 + wA7, false).replace("M", "L");
                        lxy7 = arc7.substr(arc7.lastIndexOf("L") + 1).split(" ");
                        cX7 = parseInt(lxy7[0]) - rX8 * Math.cos(sA8 * Math.PI / 180);
                        cY7 = parseInt(lxy7[1]) - rY8 * Math.sin(sA8 * Math.PI / 180);
                        arc8 = shapeArc(cX7, cY7, rX8, rY8, sA8, sA8 + wA8, false).replace("M", "L");
                        lxy8 = arc8.substr(arc8.lastIndexOf("L") + 1).split(" ");
                        cX8 = parseInt(lxy8[0]) - rX9 * Math.cos(sA9 * Math.PI / 180);
                        cY8 = parseInt(lxy8[1]) - rY9 * Math.sin(sA9 * Math.PI / 180);
                        arc9 = shapeArc(cX8, cY8, rX9, rY9, sA9, sA9 + wA9, false).replace("M", "L");
                        lxy9 = arc9.substr(arc9.lastIndexOf("L") + 1).split(" ");
                        cX9 = parseInt(lxy9[0]) - rX10 * Math.cos(sA10 * Math.PI / 180);
                        cY9 = parseInt(lxy9[1]) - rY10 * Math.sin(sA10 * Math.PI / 180);
                        arc10 = shapeArc(cX9, cY9, rX10, rY10, sA10, sA10 + wA10, false).replace("M", "L");
                        lxy10 = arc10.substr(arc10.lastIndexOf("L") + 1).split(" ");
                        cX10 = parseInt(lxy10[0]) - rX11 * Math.cos(sA11 * Math.PI / 180);
                        cY10 = parseInt(lxy10[1]) - rY3 * Math.sin(sA11 * Math.PI / 180);
                        arc11 = shapeArc(cX10, cY10, rX11, rY3, sA11, sA11 + wA11, false).replace("M", "L");

                        var d1 = "M" + x0 + "," + y0 +
                            arc1 +
                            arc2 +
                            arc3 +
                            arc4 +
                            arc5 +
                            arc6 +
                            arc7 +
                            arc8 +
                            arc9 +
                            arc10 +
                            arc11 +
                            " z";
                        if (shapType == "cloudCallout") {
                            var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                            var refr = 96 / 914400;
                            var sAdj1, adj1 = -20833 * refr;
                            var sAdj2, adj2 = 62500 * refr;
                            if (shapAdjst_ary !== undefined) {
                                for (var i = 0; i < shapAdjst_ary.length; i++) {
                                    var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                    if (sAdj_name == "adj1") {
                                        sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                        adj1 = parseInt(sAdj1.substr(4)) * refr;
                                    } else if (sAdj_name == "adj2") {
                                        sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                        adj2 = parseInt(sAdj2.substr(4)) * refr;
                                    }
                                }
                            }
                            var d_val;
                            var cnstVal2 = 100000 * refr;
                            var ss = Math.min(w, h);
                            var wd2 = w / 2, hd2 = h / 2;

                            var dxPos, dyPos, xPos, yPos, ht, wt, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11, g12, g13, g14, g15, g16,
                                g17, g18, g19, g20, g21, g22, g23, g24, g25, g26, x23, x24, x25;

                            dxPos = w * adj1 / cnstVal2;
                            dyPos = h * adj2 / cnstVal2;
                            xPos = wd2 + dxPos;
                            yPos = hd2 + dyPos;
                            ht = hd2 * Math.cos(Math.atan(dyPos / dxPos));
                            wt = wd2 * Math.sin(Math.atan(dyPos / dxPos));
                            g2 = wd2 * Math.cos(Math.atan(wt / ht));
                            g3 = hd2 * Math.sin(Math.atan(wt / ht));
                            //console.log("adj1: ",adj1,"adj2: ",adj2)
                            if (adj1 >= 0) {
                                g4 = wd2 + g2;
                                g5 = hd2 + g3;
                            } else {
                                g4 = wd2 - g2;
                                g5 = hd2 - g3;
                            }
                            g6 = g4 - xPos;
                            g7 = g5 - yPos;
                            g8 = Math.sqrt(g6 * g6 + g7 * g7);
                            g9 = ss * 6600 / 21600;
                            g10 = g8 - g9;
                            g11 = g10 / 3;
                            g12 = ss * 1800 / 21600;
                            g13 = g11 + g12;
                            g14 = g13 * g6 / g8;
                            g15 = g13 * g7 / g8;
                            g16 = g14 + xPos;
                            g17 = g15 + yPos;
                            g18 = ss * 4800 / 21600;
                            g19 = g11 * 2;
                            g20 = g18 + g19;
                            g21 = g20 * g6 / g8;
                            g22 = g20 * g7 / g8;
                            g23 = g21 + xPos;
                            g24 = g22 + yPos;
                            g25 = ss * 1200 / 21600;
                            g26 = ss * 600 / 21600;
                            x23 = xPos + g26;
                            x24 = g16 + g25;
                            x25 = g23 + g12;

                            d_val = //" M" + x23 + "," + yPos + 
                                shapeArc(x23 - g26, yPos, g26, g26, 0, 360, false) + //.replace("M","L") +
                                " z" +
                                " M" + x24 + "," + g17 +
                                shapeArc(x24 - g25, g17, g25, g25, 0, 360, false).replace("M", "L") +
                                " z" +
                                " M" + x25 + "," + g24 +
                                shapeArc(x25 - g12, g24, g12, g12, 0, 360, false).replace("M", "L") +
                                " z";
                            d1 += d_val;
                        }
                        result += "<path d='" + d1 + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "smileyFace":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var refr = 96 / 914400;
                        var adj = 4653 * refr;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * refr;
                        }
                        var d_val;
                        var cnstVal1 = 50000 * refr;
                        var cnstVal2 = 100000 * refr;
                        var cnstVal3 = 4653 * refr;
                        var ss = Math.min(w, h);
                        var a, x1, x2, x3, x4, y1, y3, dy2, y2, y4, dy3, y5, wR, hR, wd2, hd2;
                        wd2 = w / 2;
                        hd2 = h / 2;
                        a = (adj < -cnstVal3) ? -cnstVal3 : (adj > cnstVal3) ? cnstVal3 : adj;
                        x1 = w * 4969 / 21699;
                        x2 = w * 6215 / 21600;
                        x3 = w * 13135 / 21600;
                        x4 = w * 16640 / 21600;
                        y1 = h * 7570 / 21600;
                        y3 = h * 16515 / 21600;
                        dy2 = h * a / cnstVal2;
                        y2 = y3 - dy2;
                        y4 = y3 + dy2;
                        dy3 = h * a / cnstVal1;
                        y5 = y4 + dy3;
                        wR = w * 1125 / 21600;
                        hR = h * 1125 / 21600;
                        var cX1 = x2 - wR * Math.cos(Math.PI);
                        var cY1 = y1 - hR * Math.sin(Math.PI);
                        var cX2 = x3 - wR * Math.cos(Math.PI);
                        d_val = //eyes
                            shapeArc(cX1, cY1, wR, hR, 180, 540, false) +
                            shapeArc(cX2, cY1, wR, hR, 180, 540, false) +
                            //mouth
                            " M" + x1 + "," + y2 +
                            " Q" + wd2 + "," + y5 + " " + x4 + "," + y2 +
                            " Q" + wd2 + "," + y5 + " " + x1 + "," + y2 +
                            //head
                            " M" + 0 + "," + hd2 +
                            shapeArc(wd2, hd2, wd2, hd2, 180, 540, false).replace("M", "L") +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "verticalScroll":
                    case "horizontalScroll":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var refr = 96 / 914400;
                        var adj = 12500 * refr;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * refr;
                        }
                        var d_val;
                        var cnstVal1 = 25000 * refr;
                        var cnstVal2 = 100000 * refr;
                        var ss = Math.min(w, h);
                        var t = 0, l = 0, b = h, r = w;
                        var a, ch, ch2, ch4;
                        a = (adj < 0) ? 0 : (adj > cnstVal1) ? cnstVal1 : adj;
                        ch = ss * a / cnstVal2;
                        ch2 = ch / 2;
                        ch4 = ch / 4;
                        if (shapType == "verticalScroll") {
                            var x3, x4, x6, x7, x5, y3, y4;
                            x3 = ch + ch2;
                            x4 = ch + ch;
                            x6 = r - ch;
                            x7 = r - ch2;
                            x5 = x6 - ch2;
                            y3 = b - ch;
                            y4 = b - ch2;

                            d_val = "M" + ch + "," + y3 +
                                " L" + ch + "," + ch2 +
                                shapeArc(x3, ch2, ch2, ch2, 180, 270, false).replace("M", "L") +
                                " L" + x7 + "," + t +
                                shapeArc(x7, ch2, ch2, ch2, 270, 450, false).replace("M", "L") +
                                " L" + x6 + "," + ch +
                                " L" + x6 + "," + y4 +
                                shapeArc(x5, y4, ch2, ch2, 0, 90, false).replace("M", "L") +
                                " L" + ch2 + "," + b +
                                shapeArc(ch2, y4, ch2, ch2, 90, 270, false).replace("M", "L") +
                                " z" +
                                " M" + x3 + "," + t +
                                shapeArc(x3, ch2, ch2, ch2, 270, 450, false).replace("M", "L") +
                                shapeArc(x3, x3 / 2, ch4, ch4, 90, 270, false).replace("M", "L") +
                                " L" + x4 + "," + ch2 +
                                " M" + x6 + "," + ch +
                                " L" + x3 + "," + ch +
                                " M" + ch + "," + y4 +
                                shapeArc(ch2, y4, ch2, ch2, 0, 270, false).replace("M", "L") +
                                shapeArc(ch2, (y4 + y3) / 2, ch4, ch4, 270, 450, false).replace("M", "L") +
                                " z" +
                                " M" + ch + "," + y4 +
                                " L" + ch + "," + y3;
                        } else if (shapType == "horizontalScroll") {
                            var y3, y4, y6, y7, y5, x3, x4;
                            y3 = ch + ch2;
                            y4 = ch + ch;
                            y6 = b - ch;
                            y7 = b - ch2;
                            y5 = y6 - ch2;
                            x3 = r - ch;
                            x4 = r - ch2;

                            d_val = "M" + l + "," + y3 +
                                shapeArc(ch2, y3, ch2, ch2, 180, 270, false).replace("M", "L") +
                                " L" + x3 + "," + ch +
                                " L" + x3 + "," + ch2 +
                                shapeArc(x4, ch2, ch2, ch2, 180, 360, false).replace("M", "L") +
                                " L" + r + "," + y5 +
                                shapeArc(x4, y5, ch2, ch2, 0, 90, false).replace("M", "L") +
                                " L" + ch + "," + y6 +
                                " L" + ch + "," + y7 +
                                shapeArc(ch2, y7, ch2, ch2, 0, 180, false).replace("M", "L") +
                                " z" +
                                "M" + x4 + "," + ch +
                                shapeArc(x4, ch2, ch2, ch2, 90, -180, false).replace("M", "L") +
                                shapeArc((x3 + x4) / 2, ch2, ch4, ch4, 180, 0, false).replace("M", "L") +
                                " z" +
                                " M" + x4 + "," + ch +
                                " L" + x3 + "," + ch +
                                " M" + ch2 + "," + y4 +
                                " L" + ch2 + "," + y3 +
                                shapeArc(y3 / 2, y3, ch4, ch4, 180, 360, false).replace("M", "L") +
                                shapeArc(ch2, y3, ch2, ch2, 0, 180, false).replace("M", "L") +
                                " M" + ch + "," + y3 +
                                " L" + ch + "," + y6;
                        }

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "wedgeEllipseCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var refr = 96 / 914400;
                        var sAdj1, adj1 = -20833 * refr;
                        var sAdj2, adj2 = 62500 * refr;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * refr;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * refr;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 100000 * 96 / 914400;
                        var angVal1 = 11 * Math.PI / 180;
                        var ss = Math.min(w, h);
                        var dxPos, dyPos, xPos, yPos, sdx, sdy, pang, stAng, enAng, dx1, dy1, x1, y1, dx2, dy2,
                            x2, y2, stAng1, enAng1, swAng1, swAng2, swAng,
                            vc = h / 2, hc = w / 2;
                        dxPos = w * adj1 / cnstVal1;
                        dyPos = h * adj2 / cnstVal1;
                        xPos = hc + dxPos;
                        yPos = vc + dyPos;
                        sdx = dxPos * h;
                        sdy = dyPos * w;
                        pang = Math.atan(sdy / sdx);
                        stAng = pang + angVal1;
                        enAng = pang - angVal1;
                        console.log("dxPos: ", dxPos, "dyPos: ", dyPos)
                        dx1 = hc * Math.cos(stAng);
                        dy1 = vc * Math.sin(stAng);
                        dx2 = hc * Math.cos(enAng);
                        dy2 = vc * Math.sin(enAng);
                        if (dxPos >= 0) {
                            x1 = hc + dx1;
                            y1 = vc + dy1;
                            x2 = hc + dx2;
                            y2 = vc + dy2;
                        } else {
                            x1 = hc - dx1;
                            y1 = vc - dy1;
                            x2 = hc - dx2;
                            y2 = vc - dy2;
                        }
                        /*
                        //stAng = pang+angVal1;
                        //enAng = pang-angVal1;
                        //dx1 = hc*Math.cos(stAng);
                        //dy1 = vc*Math.sin(stAng);
                        x1 = hc+dx1;
                        y1 = vc+dy1;
                        dx2 = hc*Math.cos(enAng);
                        dy2 = vc*Math.sin(enAng);
                        x2 = hc+dx2;
                        y2 = vc+dy2;
                        stAng1 = Math.atan(dy1/dx1);
                        enAng1 = Math.atan(dy2/dx2);
                        swAng1 = enAng1-stAng1;
                        swAng2 = swAng1+2*Math.PI;
                        swAng = (swAng1 > 0)?swAng1:swAng2;
                        var stAng1Dg = stAng1*180/Math.PI;
                        var swAngDg = swAng*180/Math.PI;
                        var endAng = stAng1Dg + swAngDg;
                        */
                        d_val = "M" + x1 + "," + y1 +
                            " L" + xPos + "," + yPos +
                            " L" + x2 + "," + y2 +
                            //" z" +
                            shapeArc(hc, vc, hc, vc, 0, 360, true);// +
                        //shapeArc(hc,vc,hc,vc,stAng1Dg,stAng1Dg+swAngDg,false).replace("M","L") +
                        //" z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "wedgeRectCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var refr = 96 / 914400;
                        var sAdj1, adj1 = -20833 * refr;
                        var sAdj2, adj2 = 62500 * refr;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * refr;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * refr;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 100000 * 96 / 914400;
                        var dxPos, dyPos, xPos, yPos, dx, dy, dq, ady, adq, dz, xg1, xg2, x1, x2,
                            yg1, yg2, y1, y2, t1, xl, t2, xt, t3, xr, t4, xb, t5, yl, t6, yt, t7, yr, t8, yb,
                            vc = h / 2, hc = w / 2;
                        dxPos = w * adj1 / cnstVal1;
                        dyPos = h * adj2 / cnstVal1;
                        xPos = hc + dxPos;
                        yPos = vc + dyPos;
                        dx = xPos - hc;
                        dy = yPos - vc;
                        dq = dxPos * h / w;
                        ady = Math.abs(dyPos);
                        adq = Math.abs(dq);
                        dz = ady - adq;
                        xg1 = (dxPos > 0) ? 7 : 2;
                        xg2 = (dxPos > 0) ? 10 : 5;
                        x1 = w * xg1 / 12;
                        x2 = w * xg2 / 12;
                        yg1 = (dyPos > 0) ? 7 : 2;
                        yg2 = (dyPos > 0) ? 10 : 5;
                        y1 = h * yg1 / 12;
                        y2 = h * yg2 / 12;
                        t1 = (dxPos > 0) ? 0 : xPos;
                        xl = (dz > 0) ? 0 : t1;
                        t2 = (dyPos > 0) ? x1 : xPos;
                        xt = (dz > 0) ? t2 : x1;
                        t3 = (dxPos > 0) ? xPos : w;
                        xr = (dz > 0) ? w : t3;
                        t4 = (dyPos > 0) ? xPos : x1;
                        xb = (dz > 0) ? t4 : x1;
                        t5 = (dxPos > 0) ? y1 : yPos;
                        yl = (dz > 0) ? y1 : t5;
                        t6 = (dyPos > 0) ? 0 : yPos;
                        yt = (dz > 0) ? t6 : 0;
                        t7 = (dxPos > 0) ? yPos : y1;
                        yr = (dz > 0) ? y1 : t7;
                        t8 = (dyPos > 0) ? yPos : h;
                        yb = (dz > 0) ? t8 : h;

                        d_val = "M" + 0 + "," + 0 +
                            " L" + x1 + "," + 0 +
                            " L" + xt + "," + yt +
                            " L" + x2 + "," + 0 +
                            " L" + w + "," + 0 +
                            " L" + w + "," + y1 +
                            " L" + xr + "," + yr +
                            " L" + w + "," + y2 +
                            " L" + w + "," + h +
                            " L" + x2 + "," + h +
                            " L" + xb + "," + yb +
                            " L" + x1 + "," + h +
                            " L" + 0 + "," + h +
                            " L" + 0 + "," + y2 +
                            " L" + xl + "," + yl +
                            " L" + 0 + "," + y1 +
                            " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "wedgeRoundRectCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var refr = 96 / 914400;
                        var sAdj1, adj1 = -20833 * refr;
                        var sAdj2, adj2 = 62500 * refr;
                        var sAdj3, adj3 = 16667 * refr;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * refr;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * refr;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * refr;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 100000 * 96 / 914400;
                        var ss = Math.min(w, h);
                        var dxPos, dyPos, xPos, yPos, dq, ady, adq, dz, xg1, xg2, x1, x2, yg1, yg2, y1, y2,
                            t1, xl, t2, xt, t3, xr, t4, xb, t5, yl, t6, yt, t7, yr, t8, yb, u1, u2, v2,
                            vc = h / 2, hc = w / 2;
                        dxPos = w * adj1 / cnstVal1;
                        dyPos = h * adj2 / cnstVal1;
                        xPos = hc + dxPos;
                        yPos = vc + dyPos;
                        dq = dxPos * h / w;
                        ady = Math.abs(dyPos);
                        adq = Math.abs(dq);
                        dz = ady - adq;
                        xg1 = (dxPos > 0) ? 7 : 2;
                        xg2 = (dxPos > 0) ? 10 : 5;
                        x1 = w * xg1 / 12;
                        x2 = w * xg2 / 12;
                        yg1 = (dyPos > 0) ? 7 : 2;
                        yg2 = (dyPos > 0) ? 10 : 5;
                        y1 = h * yg1 / 12;
                        y2 = h * yg2 / 12;
                        t1 = (dxPos > 0) ? 0 : xPos;
                        xl = (dz > 0) ? 0 : t1;
                        t2 = (dyPos > 0) ? x1 : xPos;
                        xt = (dz > 0) ? t2 : x1;
                        t3 = (dxPos > 0) ? xPos : w;
                        xr = (dz > 0) ? w : t3;
                        t4 = (dyPos > 0) ? xPos : x1;
                        xb = (dz > 0) ? t4 : x1;
                        t5 = (dxPos > 0) ? y1 : yPos;
                        yl = (dz > 0) ? y1 : t5;
                        t6 = (dyPos > 0) ? 0 : yPos;
                        yt = (dz > 0) ? t6 : 0;
                        t7 = (dxPos > 0) ? yPos : y1;
                        yr = (dz > 0) ? y1 : t7;
                        t8 = (dyPos > 0) ? yPos : h;
                        yb = (dz > 0) ? t8 : h;
                        u1 = ss * adj3 / cnstVal1;
                        u2 = w - u1;
                        v2 = h - u1;
                        d_val = "M" + 0 + "," + u1 +
                            shapeArc(u1, u1, u1, u1, 180, 270, false).replace("M", "L") +
                            " L" + x1 + "," + 0 +
                            " L" + xt + "," + yt +
                            " L" + x2 + "," + 0 +
                            " L" + u2 + "," + 0 +
                            shapeArc(u2, u1, u1, u1, 270, 360, false).replace("M", "L") +
                            " L" + w + "," + y1 +
                            " L" + xr + "," + yr +
                            " L" + w + "," + y2 +
                            " L" + w + "," + v2 +
                            shapeArc(u2, v2, u1, u1, 0, 90, false).replace("M", "L") +
                            " L" + x2 + "," + h +
                            " L" + xb + "," + yb +
                            " L" + x1 + "," + h +
                            " L" + u1 + "," + h +
                            shapeArc(u1, v2, u1, u1, 90, 180, false).replace("M", "L") +
                            " L" + 0 + "," + y2 +
                            " L" + xl + "," + yl +
                            " L" + 0 + "," + y1 +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "accentBorderCallout1":
                    case "accentBorderCallout2":
                    case "accentBorderCallout3":
                    case "borderCallout1":
                    case "borderCallout2":
                    case "borderCallout3":
                    case "accentCallout1":
                    case "accentCallout2":
                    case "accentCallout3":
                    case "callout1":
                    case "callout2":
                    case "callout3":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var refr = 96 / 914400;
                        var sAdj1, adj1 = 18750 * refr;
                        var sAdj2, adj2 = -8333 * refr;
                        var sAdj3, adj3 = 18750 * refr;
                        var sAdj4, adj4 = -16667 * refr;
                        var sAdj5, adj5 = 100000 * refr;
                        var sAdj6, adj6 = -16667 * refr;
                        var sAdj7, adj7 = 112963 * refr;
                        var sAdj8, adj8 = -8333 * refr;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * refr;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * refr;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * refr;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * refr;
                                } else if (sAdj_name == "adj5") {
                                    sAdj5 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj5 = parseInt(sAdj5.substr(4)) * refr;
                                } else if (sAdj_name == "adj6") {
                                    sAdj6 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj6 = parseInt(sAdj6.substr(4)) * refr;
                                } else if (sAdj_name == "adj7") {
                                    sAdj7 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj7 = parseInt(sAdj7.substr(4)) * refr;
                                } else if (sAdj_name == "adj8") {
                                    sAdj8 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj8 = parseInt(sAdj8.substr(4)) * refr;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 100000 * refr;
                        var isBorder = true;
                        switch (shapType) {
                            case "borderCallout1":
                            case "callout1":
                                if (shapType == "borderCallout1") {
                                    isBorder = true;
                                } else {
                                    isBorder = false;
                                }
                                if (shapAdjst_ary === undefined) {
                                    adj1 = 18750 * refr;
                                    adj2 = -8333 * refr;
                                    adj3 = 112500 * refr;
                                    adj4 = -38333 * refr;
                                }
                                var y1, x1, y2, x2;
                                y1 = h * adj1 / cnstVal1;
                                x1 = w * adj2 / cnstVal1;
                                y2 = h * adj3 / cnstVal1;
                                x2 = w * adj4 / cnstVal1;
                                d_val = "M" + 0 + "," + 0 +
                                    " L" + w + "," + 0 +
                                    " L" + w + "," + h +
                                    " L" + 0 + "," + h +
                                    " z" +
                                    " M" + x1 + "," + y1 +
                                    " L" + x2 + "," + y2;
                                break;
                            case "borderCallout2":
                            case "callout2":
                                if (shapType == "borderCallout2") {
                                    isBorder = true;
                                } else {
                                    isBorder = false;
                                }
                                if (shapAdjst_ary === undefined) {
                                    adj1 = 18750 * refr;
                                    adj2 = -8333 * refr;
                                    adj3 = 18750 * refr;
                                    adj4 = -16667 * refr;

                                    adj5 = 112500 * refr;
                                    adj6 = -46667 * refr;
                                }
                                var y1, x1, y2, x2, y3, x3;

                                y1 = h * adj1 / cnstVal1;
                                x1 = w * adj2 / cnstVal1;
                                y2 = h * adj3 / cnstVal1;
                                x2 = w * adj4 / cnstVal1;

                                y3 = h * adj5 / cnstVal1;
                                x3 = w * adj6 / cnstVal1;
                                d_val = "M" + 0 + "," + 0 +
                                    " L" + w + "," + 0 +
                                    " L" + w + "," + h +
                                    " L" + 0 + "," + h +
                                    " z" +

                                    " M" + x1 + "," + y1 +
                                    " L" + x2 + "," + y2 +

                                    " L" + x3 + "," + y3 +
                                    " L" + x2 + "," + y2;

                                break;
                            case "borderCallout3":
                            case "callout3":
                                if (shapType == "borderCallout3") {
                                    isBorder = true;
                                } else {
                                    isBorder = false;
                                }
                                if (shapAdjst_ary === undefined) {
                                    adj1 = 18750 * refr;
                                    adj2 = -8333 * refr;
                                    adj3 = 18750 * refr;
                                    adj4 = -16667 * refr;

                                    adj5 = 100000 * refr;
                                    adj6 = -16667 * refr;

                                    adj7 = 112963 * refr;
                                    adj8 = -8333 * refr;
                                }
                                var y1, x1, y2, x2, y3, x3, y4, x4;

                                y1 = h * adj1 / cnstVal1;
                                x1 = w * adj2 / cnstVal1;
                                y2 = h * adj3 / cnstVal1;
                                x2 = w * adj4 / cnstVal1;

                                y3 = h * adj5 / cnstVal1;
                                x3 = w * adj6 / cnstVal1;

                                y4 = h * adj7 / cnstVal1;
                                x4 = w * adj8 / cnstVal1;
                                d_val = "M" + 0 + "," + 0 +
                                    " L" + w + "," + 0 +
                                    " L" + w + "," + h +
                                    " L" + 0 + "," + h +
                                    " z" +

                                    " M" + x1 + "," + y1 +
                                    " L" + x2 + "," + y2 +

                                    " L" + x3 + "," + y3 +

                                    " L" + x4 + "," + y4 +
                                    " L" + x3 + "," + y3 +
                                    " L" + x2 + "," + y2;
                                break;
                            case "accentBorderCallout1":
                            case "accentCallout1":
                                if (shapType == "accentBorderCallout1") {
                                    isBorder = true;
                                } else {
                                    isBorder = false;
                                }

                                if (shapAdjst_ary === undefined) {
                                    adj1 = 18750 * refr;
                                    adj2 = -8333 * refr;
                                    adj3 = 112500 * refr;
                                    adj4 = -38333 * refr;
                                }
                                var y1, x1, y2, x2;
                                y1 = h * adj1 / cnstVal1;
                                x1 = w * adj2 / cnstVal1;
                                y2 = h * adj3 / cnstVal1;
                                x2 = w * adj4 / cnstVal1;
                                d_val = "M" + 0 + "," + 0 +
                                    " L" + w + "," + 0 +
                                    " L" + w + "," + h +
                                    " L" + 0 + "," + h +
                                    " z" +

                                    " M" + x1 + "," + y1 +
                                    " L" + x2 + "," + y2 +

                                    " M" + x1 + "," + 0 +
                                    " L" + x1 + "," + h;
                                break;
                            case "accentBorderCallout2":
                            case "accentCallout2":
                                if (shapType == "accentBorderCallout2") {
                                    isBorder = true;
                                } else {
                                    isBorder = false;
                                }
                                if (shapAdjst_ary === undefined) {
                                    adj1 = 18750 * refr;
                                    adj2 = -8333 * refr;
                                    adj3 = 18750 * refr;
                                    adj4 = -16667 * refr;
                                    adj5 = 112500 * refr;
                                    adj6 = -46667 * refr;
                                }
                                var y1, x1, y2, x2, y3, x3;

                                y1 = h * adj1 / cnstVal1;
                                x1 = w * adj2 / cnstVal1;
                                y2 = h * adj3 / cnstVal1;
                                x2 = w * adj4 / cnstVal1;
                                y3 = h * adj5 / cnstVal1;
                                x3 = w * adj6 / cnstVal1;
                                d_val = "M" + 0 + "," + 0 +
                                    " L" + w + "," + 0 +
                                    " L" + w + "," + h +
                                    " L" + 0 + "," + h +
                                    " z" +

                                    " M" + x1 + "," + y1 +
                                    " L" + x2 + "," + y2 +
                                    " L" + x3 + "," + y3 +
                                    " L" + x2 + "," + y2 +

                                    " M" + x1 + "," + 0 +
                                    " L" + x1 + "," + h;

                                break;
                            case "accentBorderCallout3":
                            case "accentCallout3":
                                if (shapType == "accentBorderCallout3") {
                                    isBorder = true;
                                } else {
                                    isBorder = false;
                                }
                                isBorder = true;
                                if (shapAdjst_ary === undefined) {
                                    adj1 = 18750 * refr;
                                    adj2 = -8333 * refr;
                                    adj3 = 18750 * refr;
                                    adj4 = -16667 * refr;
                                    adj5 = 100000 * refr;
                                    adj6 = -16667 * refr;
                                    adj7 = 112963 * refr;
                                    adj8 = -8333 * refr;
                                }
                                var y1, x1, y2, x2, y3, x3, y4, x4;

                                y1 = h * adj1 / cnstVal1;
                                x1 = w * adj2 / cnstVal1;
                                y2 = h * adj3 / cnstVal1;
                                x2 = w * adj4 / cnstVal1;
                                y3 = h * adj5 / cnstVal1;
                                x3 = w * adj6 / cnstVal1;
                                y4 = h * adj7 / cnstVal1;
                                x4 = w * adj8 / cnstVal1;
                                d_val = "M" + 0 + "," + 0 +
                                    " L" + w + "," + 0 +
                                    " L" + w + "," + h +
                                    " L" + 0 + "," + h +
                                    " z" +

                                    " M" + x1 + "," + y1 +
                                    " L" + x2 + "," + y2 +
                                    " L" + x3 + "," + y3 +
                                    " L" + x4 + "," + y4 +
                                    " L" + x3 + "," + y3 +
                                    " L" + x2 + "," + y2 +

                                    " M" + x1 + "," + 0 +
                                    " L" + x1 + "," + h;
                                break;
                        }

                        console.log("shapType: ", shapType, ",isBorder:", isBorder)
                        //if(isBorder){
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        //}else{
                        //    result += "<path d='"+d_val+"' fill='" + (!imgFillFlg?(grndFillFlg?"url(#linGrd_"+shpId+")":fillColor):"url(#imgPtrn_"+shpId+")") + 
                        //        "' stroke='none' />";

                        //}
                        break;
                    case "leftRightRibbon":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var refr = 96 / 914400;
                        var sAdj1, adj1 = 50000 * refr;
                        var sAdj2, adj2 = 50000 * refr;
                        var sAdj3, adj3 = 16667 * refr;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * refr;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * refr;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * refr;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 33333 * refr;
                        var cnstVal2 = 100000 * refr;
                        var cnstVal3 = 200000 * refr;
                        var cnstVal4 = 400000 * refr;
                        var ss = Math.min(w, h);
                        var a3, maxAdj1, a1, w1, maxAdj2, a2, x1, x4, dy1, dy2, ly1, ry4, ly2, ry3, ly4, ry1,
                            ly3, ry2, hR, x2, x3, y1, y2, wd32 = w / 32, vc = h / 2, hc = w / 2;

                        a3 = (adj3 < 0) ? 0 : (adj3 > cnstVal1) ? cnstVal1 : adj3;
                        maxAdj1 = cnstVal2 - a3;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        w1 = hc - wd32;
                        maxAdj2 = cnstVal2 * w1 / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        x1 = ss * a2 / cnstVal2;
                        x4 = w - x1;
                        dy1 = h * a1 / cnstVal3;
                        dy2 = h * a3 / -cnstVal3;
                        ly1 = vc + dy2 - dy1;
                        ry4 = vc + dy1 - dy2;
                        ly2 = ly1 + dy1;
                        ry3 = h - ly2;
                        ly4 = ly2 * 2;
                        ry1 = h - ly4;
                        ly3 = ly4 - ly1;
                        ry2 = h - ly3;
                        hR = a3 * ss / cnstVal4;
                        x2 = hc - wd32;
                        x3 = hc + wd32;
                        y1 = ly1 + hR;
                        y2 = ry2 - hR;

                        d_val = "M" + 0 + "," + ly2 +
                            "L" + x1 + "," + 0 +
                            "L" + x1 + "," + ly1 +
                            "L" + hc + "," + ly1 +
                            shapeArc(hc, y1, wd32, hR, 270, 450, false).replace("M", "L") +
                            shapeArc(hc, y2, wd32, hR, 270, 90, false).replace("M", "L") +
                            "L" + x4 + "," + ry2 +
                            "L" + x4 + "," + ry1 +
                            "L" + w + "," + ry3 +
                            "L" + x4 + "," + h +
                            "L" + x4 + "," + ry4 +
                            "L" + hc + "," + ry4 +
                            shapeArc(hc, ry4 - hR, wd32, hR, 90, 180, false).replace("M", "L") +
                            "L" + x2 + "," + ly3 +
                            "L" + x1 + "," + ly3 +
                            "L" + x1 + "," + ly4 +
                            " z" +
                            "M" + x3 + "," + y1 +
                            "L" + x3 + "," + ry2 +
                            "M" + x2 + "," + y2 +
                            "L" + x2 + "," + ly3;

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "ribbon":
                    case "ribbon2":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 16667 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 25000 * 96 / 914400;
                        var cnstVal2 = 33333 * 96 / 914400;
                        var cnstVal3 = 75000 * 96 / 914400;
                        var cnstVal4 = 100000 * 96 / 914400;
                        var cnstVal5 = 200000 * 96 / 914400;
                        var cnstVal6 = 400000 * 96 / 914400;
                        var hc = w / 2, t = 0, l = 0, b = h, r = w, wd8 = w / 8, wd32 = w / 32;
                        var a1, a2, x10, dx2, x2, x9, x3, x8, x5, x6, x4, x7, y1, y2, y4, y3, hR, y6;
                        a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal2) ? cnstVal2 : adj1;
                        a2 = (adj2 < cnstVal1) ? cnstVal1 : (adj2 > cnstVal3) ? cnstVal3 : adj2;
                        x10 = r - wd8;
                        dx2 = w * a2 / cnstVal5;
                        x2 = hc - dx2;
                        x9 = hc + dx2;
                        x3 = x2 + wd32;
                        x8 = x9 - wd32;
                        x5 = x2 + wd8;
                        x6 = x9 - wd8;
                        x4 = x5 - wd32;
                        x7 = x6 + wd32;
                        hR = h * a1 / cnstVal6;
                        if (shapType == "ribbon2") {
                            var dy1, dy2, y7;
                            dy1 = h * a1 / cnstVal5;
                            y1 = b - dy1;
                            dy2 = h * a1 / cnstVal4;
                            y2 = b - dy2;
                            y4 = t + dy2;
                            y3 = (y4 + b) / 2;
                            y6 = b - hR;///////////////////
                            y7 = y1 - hR;

                            d_val = "M" + l + "," + b +
                                " L" + wd8 + "," + y3 +
                                " L" + l + "," + y4 +
                                " L" + x2 + "," + y4 +
                                " L" + x2 + "," + hR +
                                shapeArc(x3, hR, wd32, hR, 180, 270, false).replace("M", "L") +
                                " L" + x8 + "," + t +
                                shapeArc(x8, hR, wd32, hR, 270, 360, false).replace("M", "L") +
                                " L" + x9 + "," + y4 +
                                " L" + x9 + "," + y4 +
                                " L" + r + "," + y4 +
                                " L" + x10 + "," + y3 +
                                " L" + r + "," + b +
                                " L" + x7 + "," + b +
                                shapeArc(x7, y6, wd32, hR, 90, 270, false).replace("M", "L") +
                                " L" + x8 + "," + y1 +
                                shapeArc(x8, y7, wd32, hR, 90, -90, false).replace("M", "L") +
                                " L" + x3 + "," + y2 +
                                shapeArc(x3, y7, wd32, hR, 270, 90, false).replace("M", "L") +
                                " L" + x4 + "," + y1 +
                                shapeArc(x4, y6, wd32, hR, 270, 450, false).replace("M", "L") +
                                " z" +
                                " M" + x5 + "," + y2 +
                                " L" + x5 + "," + y6 +
                                "M" + x6 + "," + y6 +
                                " L" + x6 + "," + y2 +
                                "M" + x2 + "," + y7 +
                                " L" + x2 + "," + y4 +
                                "M" + x9 + "," + y4 +
                                " L" + x9 + "," + y7;
                        } else if (shapType == "ribbon") {
                            var y5;
                            y1 = h * a1 / cnstVal5;
                            y2 = h * a1 / cnstVal4;
                            y4 = b - y2;
                            y3 = y4 / 2;
                            y5 = b - hR; ///////////////////////
                            y6 = y2 - hR;
                            d_val = "M" + l + "," + t +
                                " L" + x4 + "," + t +
                                shapeArc(x4, hR, wd32, hR, 270, 450, false).replace("M", "L") +
                                " L" + x3 + "," + y1 +
                                shapeArc(x3, y6, wd32, hR, 270, 90, false).replace("M", "L") +
                                " L" + x8 + "," + y2 +
                                shapeArc(x8, y6, wd32, hR, 90, -90, false).replace("M", "L") +
                                " L" + x7 + "," + y1 +
                                shapeArc(x7, hR, wd32, hR, 90, 270, false).replace("M", "L") +
                                " L" + r + "," + t +
                                " L" + x10 + "," + y3 +
                                " L" + r + "," + y4 +
                                " L" + x9 + "," + y4 +
                                " L" + x9 + "," + y5 +
                                shapeArc(x8, y5, wd32, hR, 0, 90, false).replace("M", "L") +
                                " L" + x3 + "," + b +
                                shapeArc(x3, y5, wd32, hR, 90, 180, false).replace("M", "L") +
                                " L" + x2 + "," + y4 +
                                " L" + l + "," + y4 +
                                " L" + wd8 + "," + y3 +
                                " z" +
                                " M" + x5 + "," + hR +
                                " L" + x5 + "," + y2 +
                                "M" + x6 + "," + y2 +
                                " L" + x6 + "," + hR +
                                "M" + x2 + "," + y4 +
                                " L" + x2 + "," + y6 +
                                "M" + x9 + "," + y6 +
                                " L" + x9 + "," + y4;
                        }
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "doubleWave":
                    case "wave":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = (shapType == "doubleWave") ? 6250 * 96 / 914400 : 12500 * 96 / 914400;
                        var sAdj2, adj2 = 0;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal2 = -10000 * 96 / 914400;
                        var cnstVal3 = 50000 * 96 / 914400;
                        var cnstVal4 = 100000 * 96 / 914400;
                        var hc = w / 2, t = 0, l = 0, b = h, r = w, wd8 = w / 8, wd32 = w / 32;
                        if (shapType == "doubleWave") {
                            var cnstVal1 = 12500 * 96 / 914400;
                            var a1, a2, y1, dy2, y2, y3, y4, y5, y6, of2, dx2, x2, dx8, x8, dx3, x3, dx4, x4, x5, x6, x7, x9, x15, x10, x11, x12, x13, x14;
                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal1) ? cnstVal1 : adj1;
                            a2 = (adj2 < cnstVal2) ? cnstVal2 : (adj2 > cnstVal4) ? cnstVal4 : adj2;
                            y1 = h * a1 / cnstVal4;
                            dy2 = y1 * 10 / 3;
                            y2 = y1 - dy2;
                            y3 = y1 + dy2;
                            y4 = b - y1;
                            y5 = y4 - dy2;
                            y6 = y4 + dy2;
                            of2 = w * a2 / cnstVal3;
                            dx2 = (of2 > 0) ? 0 : of2;
                            x2 = l - dx2;
                            dx8 = (of2 > 0) ? of2 : 0;
                            x8 = r - dx8;
                            dx3 = (dx2 + x8) / 6;
                            x3 = x2 + dx3;
                            dx4 = (dx2 + x8) / 3;
                            x4 = x2 + dx4;
                            x5 = (x2 + x8) / 2;
                            x6 = x5 + dx3;
                            x7 = (x6 + x8) / 2;
                            x9 = l + dx8;
                            x15 = r + dx2;
                            x10 = x9 + dx3;
                            x11 = x9 + dx4;
                            x12 = (x9 + x15) / 2;
                            x13 = x12 + dx3;
                            x14 = (x13 + x15) / 2;

                            d_val = "M" + x2 + "," + y1 +
                                " C" + x3 + "," + y2 + " " + x4 + "," + y3 + " " + x5 + "," + y1 +
                                " C" + x6 + "," + y2 + " " + x7 + "," + y3 + " " + x8 + "," + y1 +
                                " L" + x15 + "," + y4 +
                                " C" + x14 + "," + y6 + " " + x13 + "," + y5 + " " + x12 + "," + y4 +
                                " C" + x11 + "," + y6 + " " + x10 + "," + y5 + " " + x9 + "," + y4 +
                                " z";
                        } else if (shapType == "wave") {
                            var cnstVal5 = 20000 * 96 / 914400;
                            var a1, a2, y1, dy2, y2, y3, y4, y5, y6, of2, dx2, x2, dx5, x5, dx3, x3, x4, x6, x10, x7, x8;
                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal5) ? cnstVal5 : adj1;
                            a2 = (adj2 < cnstVal2) ? cnstVal2 : (adj2 > cnstVal4) ? cnstVal4 : adj2;
                            y1 = h * a1 / cnstVal4;
                            dy2 = y1 * 10 / 3;
                            y2 = y1 - dy2;
                            y3 = y1 + dy2;
                            y4 = b - y1;
                            y5 = y4 - dy2;
                            y6 = y4 + dy2;
                            of2 = w * a2 / cnstVal3;
                            dx2 = (of2 > 0) ? 0 : of2;
                            x2 = l - dx2;
                            dx5 = (of2 > 0) ? of2 : 0;
                            x5 = r - dx5;
                            dx3 = (dx2 + x5) / 3;
                            x3 = x2 + dx3;
                            x4 = (x3 + x5) / 2;
                            x6 = l + dx5;
                            x10 = r + dx2;
                            x7 = x6 + dx3;
                            x8 = (x7 + x10) / 2;

                            d_val = "M" + x2 + "," + y1 +
                                " C" + x3 + "," + y2 + " " + x4 + "," + y3 + " " + x5 + "," + y1 +
                                " L" + x10 + "," + y4 +
                                " C" + x8 + "," + y6 + " " + x7 + "," + y5 + " " + x6 + "," + y4 +
                                " z";
                        }
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "ellipseRibbon":
                    case "ellipseRibbon2":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var sAdj3, adj3 = 12500 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var d_val;
                        var cnstVal1 = 25000 * 96 / 914400;
                        var cnstVal3 = 75000 * 96 / 914400;
                        var cnstVal4 = 100000 * 96 / 914400;
                        var cnstVal5 = 200000 * 96 / 914400;
                        var hc = w / 2, t = 0, l = 0, b = h, r = w, wd8 = w / 8;
                        var a1, a2, q10, q11, q12, minAdj3, a3, dx2, x2, x3, x4, x5, x6, dy1, f1, q1, q2,
                            cx1, cx2, q1, dy3, q3, q4, q5, rh, q8, cx4, q9, cx5;
                        a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal4) ? cnstVal4 : adj1;
                        a2 = (adj2 < cnstVal1) ? cnstVal1 : (adj2 > cnstVal3) ? cnstVal3 : adj2;
                        q10 = cnstVal4 - a1;
                        q11 = q10 / 2;
                        q12 = a1 - q11;
                        minAdj3 = (0 > q12) ? 0 : q12;
                        a3 = (adj3 < minAdj3) ? minAdj3 : (adj3 > a1) ? a1 : adj3;
                        dx2 = w * a2 / cnstVal5;
                        x2 = hc - dx2;
                        x3 = x2 + wd8;
                        x4 = r - x3;
                        x5 = r - x2;
                        x6 = r - wd8;
                        dy1 = h * a3 / cnstVal4;
                        f1 = 4 * dy1 / w;
                        q1 = x3 * x3 / w;
                        q2 = x3 - q1;
                        cx1 = x3 / 2;
                        cx2 = r - cx1;
                        q1 = h * a1 / cnstVal4;
                        dy3 = q1 - dy1;
                        q3 = x2 * x2 / w;
                        q4 = x2 - q3;
                        q5 = f1 * q4;
                        rh = b - q1;
                        q8 = dy1 * 14 / 16;
                        cx4 = x2 / 2;
                        q9 = f1 * cx4;
                        cx5 = r - cx4;
                        if (shapType == "ellipseRibbon") {
                            var y1, cy1, y3, q6, q7, cy3, y2, y5, y6,
                                cy4, cy6, y7, cy7, y8;
                            y1 = f1 * q2;
                            cy1 = f1 * cx1;
                            y3 = q5 + dy3;
                            q6 = dy1 + dy3 - y3;
                            q7 = q6 + dy1;
                            cy3 = q7 + dy3;
                            y2 = (q8 + rh) / 2;
                            y5 = q5 + rh;
                            y6 = y3 + rh;
                            cy4 = q9 + rh;
                            cy6 = cy3 + rh;
                            y7 = y1 + dy3;
                            cy7 = q1 + q1 - y7;
                            y8 = b - dy1;
                            //
                            d_val = "M" + l + "," + t +
                                " Q" + cx1 + "," + cy1 + " " + x3 + "," + y1 +
                                " L" + x2 + "," + y3 +
                                " Q" + hc + "," + cy3 + " " + x5 + "," + y3 +
                                " L" + x4 + "," + y1 +
                                " Q" + cx2 + "," + cy1 + " " + r + "," + t +
                                " L" + x6 + "," + y2 +
                                " L" + r + "," + rh +
                                " Q" + cx5 + "," + cy4 + " " + x5 + "," + y5 +
                                " L" + x5 + "," + y6 +
                                " Q" + hc + "," + cy6 + " " + x2 + "," + y6 +
                                " L" + x2 + "," + y5 +
                                " Q" + cx4 + "," + cy4 + " " + l + "," + rh +
                                " L" + wd8 + "," + y2 +
                                " z" +
                                "M" + x2 + "," + y5 +
                                " L" + x2 + "," + y3 +
                                "M" + x5 + "," + y3 +
                                " L" + x5 + "," + y5 +
                                "M" + x3 + "," + y1 +
                                " L" + x3 + "," + y7 +
                                "M" + x4 + "," + y7 +
                                " L" + x4 + "," + y1;
                        } else if (shapType == "ellipseRibbon2") {
                            var u1, y1, cu1, cy1, q3, q5, u3, y3, q6, q7, cu3, cy3, rh, q8, u2, y2,
                                u5, y5, u6, y6, cu4, cy4, cu6, cy6, u7, y7, cu7, cy7;
                            u1 = f1 * q2;
                            y1 = b - u1;
                            cu1 = f1 * cx1;
                            cy1 = b - cu1;
                            u3 = q5 + dy3;
                            y3 = b - u3;
                            q6 = dy1 + dy3 - u3;
                            q7 = q6 + dy1;
                            cu3 = q7 + dy3;
                            cy3 = b - cu3;
                            u2 = (q8 + rh) / 2;
                            y2 = b - u2;
                            u5 = q5 + rh;
                            y5 = b - u5;
                            u6 = u3 + rh;
                            y6 = b - u6;
                            cu4 = q9 + rh;
                            cy4 = b - cu4;
                            cu6 = cu3 + rh;
                            cy6 = b - cu6;
                            u7 = u1 + dy3;
                            y7 = b - u7;
                            cu7 = q1 + q1 - u7;
                            cy7 = b - cu7;
                            //
                            d_val = "M" + l + "," + b +
                                " L" + wd8 + "," + y2 +
                                " L" + l + "," + q1 +
                                " Q" + cx4 + "," + cy4 + " " + x2 + "," + y5 +
                                " L" + x2 + "," + y6 +
                                " Q" + hc + "," + cy6 + " " + x5 + "," + y6 +
                                " L" + x5 + "," + y5 +
                                " Q" + cx5 + "," + cy4 + " " + r + "," + q1 +
                                " L" + x6 + "," + y2 +
                                " L" + r + "," + b +
                                " Q" + cx2 + "," + cy1 + " " + x4 + "," + y1 +
                                " L" + x5 + "," + y3 +
                                " Q" + hc + "," + cy3 + " " + x2 + "," + y3 +
                                " L" + x3 + "," + y1 +
                                " Q" + cx1 + "," + cy1 + " " + l + "," + b +
                                " z" +
                                "M" + x2 + "," + y3 +
                                " L" + x2 + "," + y5 +
                                "M" + x5 + "," + y5 +
                                " L" + x5 + "," + y3 +
                                "M" + x3 + "," + y7 +
                                " L" + x3 + "," + y1 +
                                "M" + x4 + "," + y1 +
                                " L" + x4 + "," + y7;
                        }
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "line":
                    case "straightConnector1":
                    case "bentConnector4":
                    case "bentConnector5":
                    case "curvedConnector2":
                    case "curvedConnector3":
                    case "curvedConnector4":
                    case "curvedConnector5":
                        if (isFlipV) {
                            result += "<line x1='" + w + "' y1='0' x2='0' y2='" + h + "' stroke='" + border.color +
                                "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' ";
                        } else {
                            result += "<line x1='0' y1='0' x2='" + w + "' y2='" + h + "' stroke='" + border.color +
                                "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' ";
                        }
                        if (headEndNodeAttrs !== undefined && (headEndNodeAttrs["type"] === "triangle" || headEndNodeAttrs["type"] === "arrow")) {
                            result += "marker-start='url(#markerTriangle_" + shpId + ")' ";
                        }
                        if (tailEndNodeAttrs !== undefined && (tailEndNodeAttrs["type"] === "triangle" || tailEndNodeAttrs["type"] === "arrow")) {
                            result += "marker-end='url(#markerTriangle_" + shpId + ")' ";
                        }
                        result += "/>";
                        break;
                    case "rightArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.25;//0.5;
                        var sAdj2, sAdj2_val = 0.5;
                        var max_sAdj2_const = w / h;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = 0.5 - (parseInt(sAdj1.substr(4)) / 200000);
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    var sAdj2_val2 = parseInt(sAdj2.substr(4)) / 100000;
                                    sAdj2_val = 1 - ((sAdj2_val2) / max_sAdj2_const);
                                }
                            }
                        }
                        //console.log("w: "+w+"\nh: "+h+"\nsAdj1: "+sAdj1_val+"\nsAdj2: "+sAdj2_val);

                        result += " <polygon points='" + w + " " + h / 2 + "," + sAdj2_val * w + " 0," + sAdj2_val * w + " " + sAdj1_val * h + ",0 " + sAdj1_val * h +
                            ",0 " + (1 - sAdj1_val) * h + "," + sAdj2_val * w + " " + (1 - sAdj1_val) * h + ", " + sAdj2_val * w + " " + h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "leftArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.25;//0.5;
                        var sAdj2, sAdj2_val = 0.5;
                        var max_sAdj2_const = w / h;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = 0.5 - (parseInt(sAdj1.substr(4)) / 200000);
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    var sAdj2_val2 = parseInt(sAdj2.substr(4)) / 100000;
                                    sAdj2_val = (sAdj2_val2) / max_sAdj2_const;
                                }
                            }
                        }
                        //console.log("w: "+w+"\nh: "+h+"\nsAdj1: "+sAdj1_val+"\nsAdj2: "+sAdj2_val);

                        result += " <polygon points='0 " + h / 2 + "," + sAdj2_val * w + " " + h + "," + sAdj2_val * w + " " + (1 - sAdj1_val) * h + "," + w + " " + (1 - sAdj1_val) * h +
                            "," + w + " " + sAdj1_val * h + "," + sAdj2_val * w + " " + sAdj1_val * h + ", " + sAdj2_val * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "downArrow":
                    case "flowChartOffpageConnector":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.25;//0.5;
                        var sAdj2, sAdj2_val = 0.5;
                        var max_sAdj2_const = h / w;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) / 200000;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    var sAdj2_val2 = parseInt(sAdj2.substr(4)) / 100000;
                                    sAdj2_val = (sAdj2_val2) / max_sAdj2_const;
                                }
                            }
                        }

                        if (shapType == "flowChartOffpageConnector") {
                            sAdj1_val = 0.5;
                            sAdj2_val = 0.212;
                        }
                        result += " <polygon points='" + (0.5 - sAdj1_val) * w + " 0," + (0.5 - sAdj1_val) * w + " " + (1 - sAdj2_val) * h + ",0 " + (1 - sAdj2_val) * h + "," + (w / 2) + " " + h +
                            "," + w + " " + (1 - sAdj2_val) * h + "," + (0.5 + sAdj1_val) * w + " " + (1 - sAdj2_val) * h + ", " + (0.5 + sAdj1_val) * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "upArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.25;//0.5;
                        var sAdj2, sAdj2_val = 0.5;
                        var max_sAdj2_const = h / w;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = parseInt(sAdj1.substr(4)) / 200000;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    var sAdj2_val2 = parseInt(sAdj2.substr(4)) / 100000;
                                    sAdj2_val = (sAdj2_val2) / max_sAdj2_const;
                                }
                            }
                        }
                        result += " <polygon points='" + (w / 2) + " 0,0 " + sAdj2_val * h + "," + (0.5 - sAdj1_val) * w + " " + sAdj2_val * h + "," + (0.5 - sAdj1_val) * w + " " + h +
                            "," + (0.5 + sAdj1_val) * w + " " + h + "," + (0.5 + sAdj1_val) * w + " " + sAdj2_val * h + ", " + w + " " + sAdj2_val * h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "leftRightArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.25;
                        var sAdj2, sAdj2_val = 0.25;
                        var max_sAdj2_const = w / h;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = 0.5 - (parseInt(sAdj1.substr(4)) / 200000);
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    var sAdj2_val2 = parseInt(sAdj2.substr(4)) / 100000;
                                    sAdj2_val = (sAdj2_val2) / max_sAdj2_const;
                                }
                            }
                        }
                        //console.log("w: "+w+"\nh: "+h+"\nsAdj1: "+sAdj1_val+"\nsAdj2: "+sAdj2_val);

                        result += " <polygon points='0 " + h / 2 + "," + sAdj2_val * w + " " + h + "," + sAdj2_val * w + " " + (1 - sAdj1_val) * h + "," + (1 - sAdj2_val) * w + " " + (1 - sAdj1_val) * h +
                            "," + (1 - sAdj2_val) * w + " " + h + "," + w + " " + h / 2 + ", " + (1 - sAdj2_val) * w + " 0," + (1 - sAdj2_val) * w + " " + sAdj1_val * h + "," +
                            sAdj2_val * w + " " + sAdj1_val * h + "," + sAdj2_val * w + " 0' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "upDownArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, sAdj1_val = 0.25;
                        var sAdj2, sAdj2_val = 0.25;
                        var max_sAdj2_const = h / w;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    sAdj1_val = 0.5 - (parseInt(sAdj1.substr(4)) / 200000);
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    var sAdj2_val2 = parseInt(sAdj2.substr(4)) / 100000;
                                    sAdj2_val = (sAdj2_val2) / max_sAdj2_const;
                                }
                            }
                        }
                        //console.log("w: "+w+"\nh: "+h+"\nsAdj1: "+sAdj1_val+"\nsAdj2: "+sAdj2_val);

                        result += " <polygon points='" + w / 2 + " 0,0 " + sAdj2_val * h + "," + sAdj1_val * w + " " + sAdj2_val * h + "," + sAdj1_val * w + " " + (1 - sAdj2_val) * h +
                            ",0 " + (1 - sAdj2_val) * h + "," + w / 2 + " " + h + ", " + w + " " + (1 - sAdj2_val) * h + "," + (1 - sAdj1_val) * w + " " + (1 - sAdj2_val) * h + "," +
                            (1 - sAdj1_val) * w + " " + sAdj2_val * h + "," + w + " " + sAdj2_val * h + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";
                        break;
                    case "quadArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 22500 * 96 / 914400;
                        var sAdj2, adj2 = 22500 * 96 / 914400;
                        var sAdj3, adj3 = 22500 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, a1, a2, a3, q1, x1, x2, dx2, x3, dx3, x4, x5, x6, y2, y3, y4, y5, y6, maxAdj1, maxAdj3;
                        var minWH = Math.min(w, h);
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal1) a2 = cnstVal1
                        else a2 = adj2
                        maxAdj1 = 2 * a2;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        q1 = cnstVal2 - maxAdj1;
                        maxAdj3 = q1 / 2;
                        if (adj3 < 0) a3 = 0
                        else if (adj3 > maxAdj3) a3 = maxAdj3
                        else a3 = adj3
                        x1 = minWH * a3 / cnstVal2;
                        dx2 = minWH * a2 / cnstVal2;
                        x2 = hc - dx2;
                        x5 = hc + dx2;
                        dx3 = minWH * a1 / cnstVal3;
                        x3 = hc - dx3;
                        x4 = hc + dx3;
                        x6 = w - x1;
                        y2 = vc - dx2;
                        y5 = vc + dx2;
                        y3 = vc - dx3;
                        y4 = vc + dx3;
                        y6 = h - x1;
                        var d_val = "M" + 0 + "," + vc +
                            " L" + x1 + "," + y2 +
                            " L" + x1 + "," + y3 +
                            " L" + x3 + "," + y3 +
                            " L" + x3 + "," + x1 +
                            " L" + x2 + "," + x1 +
                            " L" + hc + "," + 0 +
                            " L" + x5 + "," + x1 +
                            " L" + x4 + "," + x1 +
                            " L" + x4 + "," + y3 +
                            " L" + x6 + "," + y3 +
                            " L" + x6 + "," + y2 +
                            " L" + w + "," + vc +
                            " L" + x6 + "," + y5 +
                            " L" + x6 + "," + y4 +
                            " L" + x4 + "," + y4 +
                            " L" + x4 + "," + y6 +
                            " L" + x5 + "," + y6 +
                            " L" + hc + "," + h +
                            " L" + x2 + "," + y6 +
                            " L" + x3 + "," + y6 +
                            " L" + x3 + "," + y4 +
                            " L" + x1 + "," + y4 +
                            " L" + x1 + "," + y5 + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "leftRightUpArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, a1, a2, a3, q1, x1, x2, dx2, x3, dx3, x4, x5, x6, y2, dy2, y3, y4, y5, maxAdj1, maxAdj3;
                        var minWH = Math.min(w, h);
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal1) a2 = cnstVal1
                        else a2 = adj2
                        maxAdj1 = 2 * a2;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        q1 = cnstVal2 - maxAdj1;
                        maxAdj3 = q1 / 2;
                        if (adj3 < 0) a3 = 0
                        else if (adj3 > maxAdj3) a3 = maxAdj3
                        else a3 = adj3
                        x1 = minWH * a3 / cnstVal2;
                        dx2 = minWH * a2 / cnstVal2;
                        x2 = hc - dx2;
                        x5 = hc + dx2;
                        dx3 = minWH * a1 / cnstVal3;
                        x3 = hc - dx3;
                        x4 = hc + dx3;
                        x6 = w - x1;
                        dy2 = minWH * a2 / cnstVal1;
                        y2 = h - dy2;
                        y4 = h - dx2;
                        y3 = y4 - dx3;
                        y5 = y4 + dx3;
                        var d_val = "M" + 0 + "," + y4 +
                            " L" + x1 + "," + y2 +
                            " L" + x1 + "," + y3 +
                            " L" + x3 + "," + y3 +
                            " L" + x3 + "," + x1 +
                            " L" + x2 + "," + x1 +
                            " L" + hc + "," + 0 +
                            " L" + x5 + "," + x1 +
                            " L" + x4 + "," + x1 +
                            " L" + x4 + "," + y3 +
                            " L" + x6 + "," + y3 +
                            " L" + x6 + "," + y2 +
                            " L" + w + "," + y4 +
                            " L" + x6 + "," + h +
                            " L" + x6 + "," + y5 +
                            " L" + x1 + "," + y5 +
                            " L" + x1 + "," + h + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "leftUpArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, a1, a2, a3, x1, x2, dx4, dx3, x3, x4, x5, y2, y3, y4, y5, maxAdj1, maxAdj3;
                        var minWH = Math.min(w, h);
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal1) a2 = cnstVal1
                        else a2 = adj2
                        maxAdj1 = 2 * a2;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        maxAdj3 = cnstVal2 - maxAdj1;
                        if (adj3 < 0) a3 = 0
                        else if (adj3 > maxAdj3) a3 = maxAdj3
                        else a3 = adj3
                        x1 = minWH * a3 / cnstVal2;
                        dx2 = minWH * a2 / cnstVal1;
                        x2 = w - dx2;
                        y2 = h - dx2;
                        dx4 = minWH * a2 / cnstVal2;
                        x4 = w - dx4;
                        y4 = h - dx4;
                        dx3 = minWH * a1 / cnstVal3;
                        x3 = x4 - dx3;
                        x5 = x4 + dx3;
                        y3 = y4 - dx3;
                        y5 = y4 + dx3;
                        var d_val = "M" + 0 + "," + y4 +
                            " L" + x1 + "," + y2 +
                            " L" + x1 + "," + y3 +
                            " L" + x3 + "," + y3 +
                            " L" + x3 + "," + x1 +
                            " L" + x2 + "," + x1 +
                            " L" + x4 + "," + 0 +
                            " L" + w + "," + x1 +
                            " L" + x5 + "," + x1 +
                            " L" + x5 + "," + y5 +
                            " L" + x1 + "," + y5 +
                            " L" + x1 + "," + h + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "bentUpArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, a1, a2, a3, dx1, x1, dx2, x2, dx3, x3, x4, y1, y2, dy2;
                        var minWH = Math.min(w, h);
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > cnstVal1) a1 = cnstVal1
                        else a1 = adj1
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal1) a2 = cnstVal1
                        else a2 = adj2
                        if (adj3 < 0) a3 = 0
                        else if (adj3 > maxAdj3) a3 = maxAdj3
                        else a3 = adj3
                        y1 = minWH * a3 / cnstVal2;
                        dx1 = minWH * a2 / cnstVal1;
                        x1 = w - dx1;
                        dx3 = minWH * a2 / cnstVal2;
                        x3 = w - dx3;
                        dx2 = minWH * a1 / cnstVal3;
                        x2 = x3 - dx2;
                        x4 = x3 + dx2;
                        dy2 = minWH * a1 / cnstVal2;
                        y2 = h - dy2;
                        var d_val = "M" + 0 + "," + y2 +
                            " L" + x2 + "," + y2 +
                            " L" + x2 + "," + y1 +
                            " L" + x1 + "," + y1 +
                            " L" + x3 + "," + 0 +
                            " L" + w + "," + y1 +
                            " L" + x4 + "," + y1 +
                            " L" + x4 + "," + h +
                            " L" + 0 + "," + h + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "bentArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 43750 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var a1, a2, a3, a4, x3, x4, y3, y4, y5, y6, maxAdj1, maxAdj4;
                        var minWH = Math.min(w, h);
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal1) a2 = cnstVal1
                        else a2 = adj2
                        maxAdj1 = 2 * a2;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        if (adj3 < 0) a3 = 0
                        else if (adj3 > cnstVal1) a3 = cnstVal1
                        else a3 = adj3
                        var th, aw2, th2, dh2, ah, bw, bh, bs, bd, bd3, bd2,
                            th = minWH * a1 / cnstVal2;
                        aw2 = minWH * a2 / cnstVal2;
                        th2 = th / 2;
                        dh2 = aw2 - th2;
                        ah = minWH * a3 / cnstVal2;
                        bw = w - ah;
                        bh = h - dh2;
                        bs = (bw < bh) ? bw : bh;
                        maxAdj4 = cnstVal2 * bs / minWH;
                        if (adj4 < 0) a4 = 0
                        else if (adj4 > maxAdj4) a4 = maxAdj4
                        else a4 = adj4
                        bd = minWH * a4 / cnstVal2;
                        bd3 = bd - th;
                        bd2 = (bd3 > 0) ? bd3 : 0;
                        x3 = th + bd2;
                        x4 = w - ah;
                        y3 = dh2 + th;
                        y4 = y3 + dh2;
                        y5 = dh2 + bd;
                        y6 = y3 + bd2;

                        var d_val = "M" + 0 + "," + h +
                            " L" + 0 + "," + y5 +
                            shapeArc(bd, y5, bd, bd, 180, 270, false).replace("M", "L") +
                            " L" + x4 + "," + dh2 +
                            " L" + x4 + "," + 0 +
                            " L" + w + "," + aw2 +
                            " L" + x4 + "," + y4 +
                            " L" + x4 + "," + y3 +
                            " L" + x3 + "," + y3 +
                            shapeArc(x3, y6, bd2, bd2, 270, 180, false).replace("M", "L") +
                            " L" + th + "," + h + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "uturnArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 43750 * 96 / 914400;
                        var sAdj5, adj5 = 75000 * 96 / 914400;
                        var cnstVal1 = 25000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj5") {
                                    sAdj5 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj5 = parseInt(sAdj5.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var a1, a2, a3, a4, a5, q1, q2, q3, x3, x4, x5, x6, x7, x8, x9, y4, y5, minAdj5, maxAdj1, maxAdj3, maxAdj4;
                        var minWH = Math.min(w, h);
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > cnstVal1) a2 = cnstVal1
                        else a2 = adj2
                        maxAdj1 = 2 * a2;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > maxAdj1) a1 = maxAdj1
                        else a1 = adj1
                        q2 = a1 * minWH / h;
                        q3 = cnstVal2 - q2;
                        maxAdj3 = q3 * h / minWH;
                        if (adj3 < 0) a3 = 0
                        else if (adj3 > maxAdj3) a3 = maxAdj3
                        else a3 = adj3
                        q1 = a3 + a1;
                        minAdj5 = q1 * minWH / h;
                        if (adj5 < minAdj5) a5 = minAdj5
                        else if (adj5 > cnstVal2) a5 = cnstVal2
                        else a5 = adj5

                        var th, aw2, th2, dh2, ah, bw, bs, bd, bd3, bd2,
                            th = minWH * a1 / cnstVal2;
                        aw2 = minWH * a2 / cnstVal2;
                        th2 = th / 2;
                        dh2 = aw2 - th2;
                        y5 = h * a5 / cnstVal2;
                        ah = minWH * a3 / cnstVal2;
                        y4 = y5 - ah;
                        x9 = w - dh2;
                        bw = x9 / 2;
                        bs = (bw < y4) ? bw : y4;
                        maxAdj4 = cnstVal2 * bs / minWH;
                        if (adj4 < 0) a4 = 0
                        else if (adj4 > maxAdj4) a4 = maxAdj4
                        else a4 = adj4
                        bd = minWH * a4 / cnstVal2;
                        bd3 = bd - th;
                        bd2 = (bd3 > 0) ? bd3 : 0;
                        x3 = th + bd2;
                        x8 = w - aw2;
                        x6 = x8 - aw2;
                        x7 = x6 + dh2;
                        x4 = x9 - bd;
                        x5 = x7 - bd2;
                        cx = (th + x7) / 2
                        var cy = (y4 + th) / 2
                        var d_val = "M" + 0 + "," + h +
                            " L" + 0 + "," + bd +
                            shapeArc(bd, bd, bd, bd, 180, 270, false).replace("M", "L") +
                            " L" + x4 + "," + 0 +
                            shapeArc(x4, bd, bd, bd, 270, 360, false).replace("M", "L") +
                            " L" + x9 + "," + y4 +
                            " L" + w + "," + y4 +
                            " L" + x8 + "," + y5 +
                            " L" + x6 + "," + y4 +
                            " L" + x7 + "," + y4 +
                            " L" + x7 + "," + x3 +
                            shapeArc(x5, x3, bd2, bd2, 0, -90, false).replace("M", "L") +
                            " L" + x3 + "," + th +
                            shapeArc(x3, x3, bd2, bd2, 270, 180, false).replace("M", "L") +
                            " L" + th + "," + h + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "stripedRightArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 50000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var cnstVal1 = 100000 * 96 / 914400;
                        var cnstVal2 = 200000 * 96 / 914400;
                        var cnstVal3 = 84375 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var a1, a2, x4, x5, dx5, x6, dx6, y1, dy1, y2, maxAdj2, vc = h / 2;
                        var minWH = Math.min(w, h);
                        maxAdj2 = cnstVal3 * w / minWH;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > cnstVal1) a1 = cnstVal1
                        else a1 = adj1
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > maxAdj2) a2 = maxAdj2
                        else a2 = adj2
                        x4 = minWH * 5 / 32;
                        dx5 = minWH * a2 / cnstVal1;
                        x5 = w - dx5;
                        dy1 = h * a1 / cnstVal2;
                        y1 = vc - dy1;
                        y2 = vc + dy1;
                        //dx6 = dy1*dx5/hd2;
                        //x6 = w-dx6;
                        var ssd8 = minWH / 8,
                            ssd16 = minWH / 16,
                            ssd32 = minWH / 32;
                        var d_val = "M" + 0 + "," + y1 +
                            " L" + ssd32 + "," + y1 +
                            " L" + ssd32 + "," + y2 +
                            " L" + 0 + "," + y2 + " z" +
                            " M" + ssd16 + "," + y1 +
                            " L" + ssd8 + "," + y1 +
                            " L" + ssd8 + "," + y2 +
                            " L" + ssd16 + "," + y2 + " z" +
                            " M" + x4 + "," + y1 +
                            " L" + x5 + "," + y1 +
                            " L" + x5 + "," + 0 +
                            " L" + w + "," + vc +
                            " L" + x5 + "," + h +
                            " L" + x5 + "," + y2 +
                            " L" + x4 + "," + y2 + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "notchedRightArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 50000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var cnstVal1 = 100000 * 96 / 914400;
                        var cnstVal2 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var a1, a2, x1, x2, dx2, y1, dy1, y2, maxAdj2, vc = h / 2, hd2 = vc;
                        var minWH = Math.min(w, h);
                        maxAdj2 = cnstVal1 * w / minWH;
                        if (adj1 < 0) a1 = 0
                        else if (adj1 > cnstVal1) a1 = cnstVal1
                        else a1 = adj1
                        if (adj2 < 0) a2 = 0
                        else if (adj2 > maxAdj2) a2 = maxAdj2
                        else a2 = adj2
                        dx2 = minWH * a2 / cnstVal1;
                        x2 = w - dx2;
                        dy1 = h * a1 / cnstVal2;
                        y1 = vc - dy1;
                        y2 = vc + dy1;
                        x1 = dy1 * dx2 / hd2;
                        var d_val = "M" + 0 + "," + y1 +
                            " L" + x2 + "," + y1 +
                            " L" + x2 + "," + 0 +
                            " L" + w + "," + vc +
                            " L" + x2 + "," + h +
                            " L" + x2 + "," + y2 +
                            " L" + 0 + "," + y2 +
                            " L" + x1 + "," + vc + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "homePlate":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 50000 * 96 / 914400;
                        var cnstVal1 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a, x1, dx1, maxAdj, vc = h / 2;
                        var minWH = Math.min(w, h);
                        maxAdj = cnstVal1 * w / minWH;
                        if (adj < 0) a = 0
                        else if (adj > maxAdj) a = maxAdj
                        else a = adj
                        dx1 = minWH * a / cnstVal1;
                        x1 = w - dx1;
                        var d_val = "M" + 0 + "," + 0 +
                            " L" + x1 + "," + 0 +
                            " L" + w + "," + vc +
                            " L" + x1 + "," + h +
                            " L" + 0 + "," + h + " z";

                        result += "<path  d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "chevron":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 50000 * 96 / 914400;
                        var cnstVal1 = 100000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var a, x1, dx1, x2, maxAdj, vc = h / 2;
                        var minWH = Math.min(w, h);
                        maxAdj = cnstVal1 * w / minWH;
                        if (adj < 0) a = 0
                        else if (adj > maxAdj) a = maxAdj
                        else a = adj
                        x1 = minWH * a / cnstVal1;
                        x2 = w - x1;
                        var d_val = "M" + 0 + "," + 0 +
                            " L" + x2 + "," + 0 +
                            " L" + w + "," + vc +
                            " L" + x2 + "," + h +
                            " L" + 0 + "," + h +
                            " L" + x1 + "," + vc + " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";


                        break;
                    case "rightArrowCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 64977 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var maxAdj2, a2, maxAdj1, a1, maxAdj3, a3, q2, maxAdj4, a4, dy1, dy2, y1, y2, y3, y4, dx3, x3, x2, x1;
                        var vc = h / 2, r = w, b = h, l = 0, t = 0;
                        var ss = Math.min(w, h);
                        maxAdj2 = cnstVal1 * h / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        maxAdj1 = a2 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        maxAdj3 = cnstVal2 * w / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        q2 = a3 * ss / w;
                        maxAdj4 = cnstVal - q2;
                        a4 = (adj4 < 0) ? 0 : (adj4 > maxAdj4) ? maxAdj4 : adj4;
                        dy1 = ss * a2 / cnstVal2;
                        dy2 = ss * a1 / cnstVal3;
                        y1 = vc - dy1;
                        y2 = vc - dy2;
                        y3 = vc + dy2;
                        y4 = vc + dy1;
                        dx3 = ss * a3 / cnstVal2;
                        x3 = r - dx3;
                        x2 = w * a4 / cnstVal2;
                        x1 = x2 / 2;
                        var d_val = "M" + l + "," + t +
                            " L" + x2 + "," + t +
                            " L" + x2 + "," + y2 +
                            " L" + x3 + "," + y2 +
                            " L" + x3 + "," + y1 +
                            " L" + r + "," + vc +
                            " L" + x3 + "," + y4 +
                            " L" + x3 + "," + y3 +
                            " L" + x2 + "," + y3 +
                            " L" + x2 + "," + b +
                            " L" + l + "," + b +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "downArrowCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 64977 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var maxAdj2, a2, maxAdj1, a1, maxAdj3, a3, q2, maxAdj4, a4, dx1, dx2, x1, x2, x3, x4, dy3, y3, y2, y1;
                        var hc = w / 2, r = w, b = h, l = 0, t = 0;
                        var ss = Math.min(w, h);

                        maxAdj2 = cnstVal1 * w / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        maxAdj1 = a2 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        maxAdj3 = cnstVal2 * h / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        q2 = a3 * ss / h;
                        maxAdj4 = cnstVal2 - q2;
                        a4 = (adj4 < 0) ? 0 : (adj4 > maxAdj4) ? maxAdj4 : adj4;
                        dx1 = ss * a2 / cnstVal2;
                        dx2 = ss * a1 / cnstVal3;
                        x1 = hc - dx1;
                        x2 = hc - dx2;
                        x3 = hc + dx2;
                        x4 = hc + dx1;
                        dy3 = ss * a3 / cnstVal2;
                        y3 = b - dy3;
                        y2 = h * a4 / cnstVal2;
                        y1 = y2 / 2;
                        var d_val = "M" + l + "," + t +
                            " L" + r + "," + t +
                            " L" + r + "," + y2 +
                            " L" + x3 + "," + y2 +
                            " L" + x3 + "," + y3 +
                            " L" + x4 + "," + y3 +
                            " L" + hc + "," + b +
                            " L" + x1 + "," + y3 +
                            " L" + x2 + "," + y3 +
                            " L" + x2 + "," + y2 +
                            " L" + l + "," + y2 +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "leftArrowCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 64977 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var maxAdj2, a2, maxAdj1, a1, maxAdj3, a3, q2, maxAdj4, a4, dy1, dy2, y1, y2, y3, y4, x1, dx2, x2, x3;
                        var vc = h / 2, r = w, b = h, l = 0, t = 0;
                        var ss = Math.min(w, h);

                        maxAdj2 = cnstVal1 * h / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        maxAdj1 = a2 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        maxAdj3 = cnstVal2 * w / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        q2 = a3 * ss / w;
                        maxAdj4 = cnstVal2 - q2;
                        a4 = (adj4 < 0) ? 0 : (adj4 > maxAdj4) ? maxAdj4 : adj4;
                        dy1 = ss * a2 / cnstVal2;
                        dy2 = ss * a1 / cnstVal3;
                        y1 = vc - dy1;
                        y2 = vc - dy2;
                        y3 = vc + dy2;
                        y4 = vc + dy1;
                        x1 = ss * a3 / cnstVal2;
                        dx2 = w * a4 / cnstVal2;
                        x2 = r - dx2;
                        x3 = (x2 + r) / 2;
                        var d_val = "M" + l + "," + vc +
                            " L" + x1 + "," + y1 +
                            " L" + x1 + "," + y2 +
                            " L" + x2 + "," + y2 +
                            " L" + x2 + "," + t +
                            " L" + r + "," + t +
                            " L" + r + "," + b +
                            " L" + x2 + "," + b +
                            " L" + x2 + "," + y3 +
                            " L" + x1 + "," + y3 +
                            " L" + x1 + "," + y4 +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "upArrowCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 64977 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var maxAdj2, a2, maxAdj1, a1, maxAdj3, a3, q2, maxAdj4, a4, dx1, dx2, x1, x2, x3, x4, y1, dy2, y2, y3;
                        var hc = w / 2, r = w, b = h, l = 0, t = 0;
                        var ss = Math.min(w, h);
                        maxAdj2 = cnstVal1 * w / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        maxAdj1 = a2 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        maxAdj3 = cnstVal2 * h / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        q2 = a3 * ss / h;
                        maxAdj4 = cnstVal2 - q2;
                        a4 = (adj4 < 0) ? 0 : (adj4 > maxAdj4) ? maxAdj4 : adj4;
                        dx1 = ss * a2 / cnstVal2;
                        dx2 = ss * a1 / cnstVal3;
                        x1 = hc - dx1;
                        x2 = hc - dx2;
                        x3 = hc + dx2;
                        x4 = hc + dx1;
                        y1 = ss * a3 / cnstVal2;
                        dy2 = h * a4 / cnstVal2;
                        y2 = b - dy2;
                        y3 = (y2 + b) / 2;

                        var d_val = "M" + l + "," + y2 +
                            " L" + x2 + "," + y2 +
                            " L" + x2 + "," + y1 +
                            " L" + x1 + "," + y1 +
                            " L" + hc + "," + t +
                            " L" + x4 + "," + y1 +
                            " L" + x3 + "," + y1 +
                            " L" + x3 + "," + y2 +
                            " L" + r + "," + y2 +
                            " L" + r + "," + b +
                            " L" + l + "," + b +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "leftRightArrowCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 25000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var sAdj4, adj4 = 48123 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var maxAdj2, a2, maxAdj1, a1, maxAdj3, a3, q2, maxAdj4, a4, dy1, dy2, y1, y2, y3, y4, x1, x4, dx2, x2, x3;
                        var vc = h / 2, hc = w / 2, r = w, b = h, l = 0, t = 0;
                        var ss = Math.min(w, h);
                        maxAdj2 = cnstVal1 * h / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        maxAdj1 = a2 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        maxAdj3 = cnstVal1 * w / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        q2 = a3 * ss / wd2;
                        maxAdj4 = cnstVal2 - q2;
                        a4 = (adj4 < 0) ? 0 : (adj4 > maxAdj4) ? maxAdj4 : adj4;
                        dy1 = ss * a2 / cnstVal2;
                        dy2 = ss * a1 / cnstVal3;
                        y1 = vc - dy1;
                        y2 = vc - dy2;
                        y3 = vc + dy2;
                        y4 = vc + dy1;
                        x1 = ss * a3 / cnstVal2;
                        x4 = r - x1;
                        dx2 = w * a4 / cnstVal3;
                        x2 = hc - dx2;
                        x3 = hc + dx2;
                        var d_val = "M" + l + "," + vc +
                            " L" + x1 + "," + y1 +
                            " L" + x1 + "," + y2 +
                            " L" + x2 + "," + y2 +
                            " L" + x2 + "," + t +
                            " L" + x3 + "," + t +
                            " L" + x3 + "," + y2 +
                            " L" + x4 + "," + y2 +
                            " L" + x4 + "," + y1 +
                            " L" + r + "," + vc +
                            " L" + x4 + "," + y4 +
                            " L" + x4 + "," + y3 +
                            " L" + x3 + "," + y3 +
                            " L" + x3 + "," + b +
                            " L" + x2 + "," + b +
                            " L" + x2 + "," + y3 +
                            " L" + x1 + "," + y3 +
                            " L" + x1 + "," + y4 +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "quadArrowCallout":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 18515 * 96 / 914400;
                        var sAdj2, adj2 = 18515 * 96 / 914400;
                        var sAdj3, adj3 = 18515 * 96 / 914400;
                        var sAdj4, adj4 = 48123 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = parseInt(sAdj4.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, r = w, b = h, l = 0, t = 0;
                        var ss = Math.min(w, h);
                        var a2, maxAdj1, a1, maxAdj3, a3, q2, maxAdj4, a4, dx2, dx3, ah, dx1, dy1, x8, x2, x7, x3, x6, x4, x5, y8, y2, y7, y3, y6, y4, y5;
                        a2 = (adj2 < 0) ? 0 : (adj2 > cnstVal1) ? cnstVal1 : adj2;
                        maxAdj1 = a2 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        maxAdj3 = cnstVal1 - a2;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        q2 = a3 * 2;
                        maxAdj4 = cnstVal2 - q2;
                        a4 = (adj4 < a1) ? a1 : (adj4 > maxAdj4) ? maxAdj4 : adj4;
                        dx2 = ss * a2 / cnstVal2;
                        dx3 = ss * a1 / cnstVal3;
                        ah = ss * a3 / cnstVal2;
                        dx1 = w * a4 / cnstVal3;
                        dy1 = h * a4 / cnstVal3;
                        x8 = r - ah;
                        x2 = hc - dx1;
                        x7 = hc + dx1;
                        x3 = hc - dx2;
                        x6 = hc + dx2;
                        x4 = hc - dx3;
                        x5 = hc + dx3;
                        y8 = b - ah;
                        y2 = vc - dy1;
                        y7 = vc + dy1;
                        y3 = vc - dx2;
                        y6 = vc + dx2;
                        y4 = vc - dx3;
                        y5 = vc + dx3;
                        var d_val = "M" + l + "," + vc +
                            " L" + ah + "," + y3 +
                            " L" + ah + "," + y4 +
                            " L" + x2 + "," + y4 +
                            " L" + x2 + "," + y2 +
                            " L" + x4 + "," + y2 +
                            " L" + x4 + "," + ah +
                            " L" + x3 + "," + ah +
                            " L" + hc + "," + t +
                            " L" + x6 + "," + ah +
                            " L" + x5 + "," + ah +
                            " L" + x5 + "," + y2 +
                            " L" + x7 + "," + y2 +
                            " L" + x7 + "," + y4 +
                            " L" + x8 + "," + y4 +
                            " L" + x8 + "," + y3 +
                            " L" + r + "," + vc +
                            " L" + x8 + "," + y6 +
                            " L" + x8 + "," + y5 +
                            " L" + x7 + "," + y5 +
                            " L" + x7 + "," + y7 +
                            " L" + x5 + "," + y7 +
                            " L" + x5 + "," + y8 +
                            " L" + x6 + "," + y8 +
                            " L" + hc + "," + b +
                            " L" + x3 + "," + y8 +
                            " L" + x4 + "," + y8 +
                            " L" + x4 + "," + y7 +
                            " L" + x2 + "," + y7 +
                            " L" + x2 + "," + y5 +
                            " L" + ah + "," + y5 +
                            " L" + ah + "," + y6 +
                            " z";

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "curvedDownArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, wd2 = w / 2, r = w, b = h, l = 0, t = 0, c3d4 = 270, cd2 = 180, cd4 = 90;
                        var ss = Math.min(w, h);
                        var maxAdj2, a2, a1, th, aw, q1, wR, q7, q8, q9, q10, q11, idy, maxAdj3, a3, ah, x3, q2, q3, q4, q5, dx, x5, x7, q6, dh, x4, x8, aw2, x6, y1, swAng, mswAng, iy, ix, q12, dang2, stAng, stAng2, swAng2, swAng3;

                        maxAdj2 = cnstVal1 * w / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal2) ? cnstVal2 : adj1;
                        th = ss * a1 / cnstVal2;
                        aw = ss * a2 / cnstVal2;
                        q1 = (th + aw) / 4;
                        wR = wd2 - q1;
                        q7 = wR * 2;
                        q8 = q7 * q7;
                        q9 = th * th;
                        q10 = q8 - q9;
                        q11 = Math.sqrt(q10);
                        idy = q11 * h / q7;
                        maxAdj3 = cnstVal2 * idy / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        ah = ss * adj3 / cnstVal2;
                        x3 = wR + th;
                        q2 = h * h;
                        q3 = ah * ah;
                        q4 = q2 - q3;
                        q5 = Math.sqrt(q4);
                        dx = q5 * wR / h;
                        x5 = wR + dx;
                        x7 = x3 + dx;
                        q6 = aw - th;
                        dh = q6 / 2;
                        x4 = x5 - dh;
                        x8 = x7 + dh;
                        aw2 = aw / 2;
                        x6 = r - aw2;
                        y1 = b - ah;
                        swAng = Math.atan(dx / ah);
                        var swAngDeg = swAng * 180 / Math.PI;
                        mswAng = -swAngDeg;
                        iy = b - idy;
                        ix = (wR + x3) / 2;
                        q12 = th / 2;
                        dang2 = Math.atan(q12 / idy);
                        var dang2Deg = dang2 * 180 / Math.PI;
                        stAng = c3d4 + swAngDeg;
                        stAng2 = c3d4 - dang2Deg;
                        swAng2 = dang2Deg - cd4;
                        swAng3 = cd4 + dang2Deg;
                        //var cX = x5 - Math.cos(stAng*Math.PI/180) * wR;
                        //var cY = y1 - Math.sin(stAng*Math.PI/180) * h;

                        var d_val = "M" + x6 + "," + b +
                            " L" + x4 + "," + y1 +
                            " L" + x5 + "," + y1 +
                            shapeArc(wR, h, wR, h, stAng, (stAng + mswAng), false).replace("M", "L") +
                            " L" + x3 + "," + t +
                            shapeArc(x3, h, wR, h, c3d4, (c3d4 + swAngDeg), false).replace("M", "L") +
                            " L" + (x5 + th) + "," + y1 +
                            " L" + x8 + "," + y1 +
                            " z" +
                            "M" + x3 + "," + t +
                            shapeArc(x3, h, wR, h, stAng2, (stAng2 + swAng2), false).replace("M", "L") +
                            shapeArc(wR, h, wR, h, cd2, (cd2 + swAng3), false).replace("M", "L");

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "curvedLeftArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, hd2 = h / 2, r = w, b = h, l = 0, t = 0, c3d4 = 270, cd2 = 180, cd4 = 90;
                        var ss = Math.min(w, h);
                        var maxAdj2, a2, a1, th, aw, q1, hR, q7, q8, q9, q10, q11, idx, maxAdj3, a3, ah, y3, q2, q3, q4, q5, dy, y5, y7, q6, dh, y4, y8, aw2, y6, x1, swAng, mswAng, ix, iy, q12, dang2, swAng2, swAng3, stAng3;

                        maxAdj2 = cnstVal1 * h / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > a2) ? a2 : adj1;
                        th = ss * a1 / cnstVal2;
                        aw = ss * a2 / cnstVal2;
                        q1 = (th + aw) / 4;
                        hR = hd2 - q1;
                        q7 = hR * 2;
                        q8 = q7 * q7;
                        q9 = th * th;
                        q10 = q8 - q9;
                        q11 = Math.sqrt(q10);
                        idx = q11 * w / q7;
                        maxAdj3 = cnstVal2 * idx / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        ah = ss * a3 / cnstVal2;
                        y3 = hR + th;
                        q2 = w * w;
                        q3 = ah * ah;
                        q4 = q2 - q3;
                        q5 = Math.sqrt(q4);
                        dy = q5 * hR / w;
                        y5 = hR + dy;
                        y7 = y3 + dy;
                        q6 = aw - th;
                        dh = q6 / 2;
                        y4 = y5 - dh;
                        y8 = y7 + dh;
                        aw2 = aw / 2;
                        y6 = b - aw2;
                        x1 = l + ah;
                        swAng = Math.atan(dy / ah);
                        mswAng = -swAng;
                        ix = l + idx;
                        iy = (hR + y3) / 2;
                        q12 = th / 2;
                        dang2 = Math.atan(q12 / idx);
                        swAng2 = dang2 - swAng;
                        swAng3 = swAng + dang2;
                        stAng3 = -dang2;
                        var swAngDg, swAng2Dg, swAng3Dg, stAng3dg;
                        swAngDg = swAng * 180 / Math.PI;
                        swAng2Dg = swAng2 * 180 / Math.PI;
                        swAng3Dg = swAng3 * 180 / Math.PI;
                        stAng3dg = stAng3 * 180 / Math.PI;

                        var d_val = "M" + r + "," + y3 +
                            shapeArc(l, hR, w, hR, 0, -cd4, false).replace("M", "L") +
                            " L" + l + "," + t +
                            shapeArc(l, y3, w, hR, c3d4, (c3d4 + cd4), false).replace("M", "L") +
                            " L" + r + "," + y3 +
                            shapeArc(l, y3, w, hR, 0, swAngDg, false).replace("M", "L") +
                            " L" + x1 + "," + y7 +
                            " L" + x1 + "," + y8 +
                            " L" + l + "," + y6 +
                            " L" + x1 + "," + y4 +
                            " L" + x1 + "," + y5 +
                            shapeArc(l, hR, w, hR, swAngDg, (swAngDg + swAng2Dg), false).replace("M", "L") +
                            shapeArc(l, hR, w, hR, 0, -cd4, false).replace("M", "L") +
                            shapeArc(l, y3, w, hR, c3d4, (c3d4 + cd4), false).replace("M", "L");

                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "curvedRightArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, hd2 = h / 2, r = w, b = h, l = 0, t = 0, c3d4 = 270, cd2 = 180, cd4 = 90;
                        var ss = Math.min(w, h);
                        var maxAdj2, a2, a1, th, aw, q1, hR, q7, q8, q9, q10, q11, idx, maxAdj3, a3, ah, y3, q2, q3, q4, q5, dy, y5, y7, q6, dh, y4, y8, aw2, y6, x1, swAng, stAng, mswAng, ix, iy, q12, dang2, swAng2, swAng3, stAng3;

                        maxAdj2 = cnstVal1 * h / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > a2) ? a2 : adj1;
                        th = ss * a1 / cnstVal2;
                        aw = ss * a2 / cnstVal2;
                        q1 = (th + aw) / 4;
                        hR = hd2 - q1;
                        q7 = hR * 2;
                        q8 = q7 * q7;
                        q9 = th * th;
                        q10 = q8 - q9;
                        q11 = Math.sqrt(q10);
                        idx = q11 * w / q7;
                        maxAdj3 = cnstVal2 * idx / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        ah = ss * a3 / cnstVal2;
                        y3 = hR + th;
                        q2 = w * w;
                        q3 = ah * ah;
                        q4 = q2 - q3;
                        q5 = Math.sqrt(q4);
                        dy = q5 * hR / w;
                        y5 = hR + dy;
                        y7 = y3 + dy;
                        q6 = aw - th;
                        dh = q6 / 2;
                        y4 = y5 - dh;
                        y8 = y7 + dh;
                        aw2 = aw / 2;
                        y6 = b - aw2;
                        x1 = r - ah;
                        swAng = Math.atan(dy / ah);
                        stAng = Math.PI + 0 - swAng;
                        mswAng = -swAng;
                        ix = r - idx;
                        iy = (hR + y3) / 2;
                        q12 = th / 2;
                        dang2 = Math.atan(q12 / idx);
                        swAng2 = dang2 - Math.PI / 2;
                        swAng3 = Math.PI / 2 + dang2;
                        stAng3 = Math.PI - dang2;

                        var stAngDg, mswAngDg, swAngDg, swAng2dg;
                        stAngDg = stAng * 180 / Math.PI;
                        mswAngDg = mswAng * 180 / Math.PI;
                        swAngDg = swAng * 180 / Math.PI;
                        swAng2dg = swAng2 * 180 / Math.PI;

                        var d_val = "M" + l + "," + hR +
                            shapeArc(w, hR, w, hR, cd2, cd2 + mswAngDg, false).replace("M", "L") +
                            " L" + x1 + "," + y5 +
                            " L" + x1 + "," + y4 +
                            " L" + r + "," + y6 +
                            " L" + x1 + "," + y8 +
                            " L" + x1 + "," + y7 +
                            shapeArc(w, y3, w, hR, stAngDg, stAngDg + swAngDg, false).replace("M", "L") +
                            " L" + l + "," + hR +
                            shapeArc(w, hR, w, hR, cd2, cd2 + cd4, false).replace("M", "L") +
                            " L" + r + "," + th +
                            shapeArc(w, y3, w, hR, c3d4, c3d4 + swAng2dg, false).replace("M", "L")
                        "";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "curvedUpArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 25000 * 96 / 914400;
                        var sAdj2, adj2 = 50000 * 96 / 914400;
                        var sAdj3, adj3 = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = parseInt(sAdj3.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, wd2 = w / 2, r = w, b = h, l = 0, t = 0, c3d4 = 270, cd2 = 180, cd4 = 90;
                        var ss = Math.min(w, h);
                        var maxAdj2, a2, a1, th, aw, q1, wR, q7, q8, q9, q10, q11, idy, maxAdj3, a3, ah, x3, q2, q3, q4, q5, dx, x5, x7, q6, dh, x4, x8, aw2, x6, y1, swAng, mswAng, iy, ix, q12, dang2, swAng2, mswAng2, stAng3, swAng3, stAng2;

                        maxAdj2 = cnstVal1 * w / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal2) ? cnstVal2 : adj1;
                        th = ss * a1 / cnstVal2;
                        aw = ss * a2 / cnstVal2;
                        q1 = (th + aw) / 4;
                        wR = wd2 - q1;
                        q7 = wR * 2;
                        q8 = q7 * q7;
                        q9 = th * th;
                        q10 = q8 - q9;
                        q11 = Math.sqrt(q10);
                        idy = q11 * h / q7;
                        maxAdj3 = cnstVal2 * idy / ss;
                        a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                        ah = ss * adj3 / cnstVal2;
                        x3 = wR + th;
                        q2 = h * h;
                        q3 = ah * ah;
                        q4 = q2 - q3;
                        q5 = Math.sqrt(q4);
                        dx = q5 * wR / h;
                        x5 = wR + dx;
                        x7 = x3 + dx;
                        q6 = aw - th;
                        dh = q6 / 2;
                        x4 = x5 - dh;
                        x8 = x7 + dh;
                        aw2 = aw / 2;
                        x6 = r - aw2;
                        y1 = t + ah;
                        swAng = Math.atan(dx / ah);
                        mswAng = -swAng;
                        iy = t + idy;
                        ix = (wR + x3) / 2;
                        q12 = th / 2;
                        dang2 = Math.atan(q12 / idy);
                        swAng2 = dang2 - swAng;
                        mswAng2 = -swAng2;
                        stAng3 = Math.PI / 2 - swAng;
                        swAng3 = swAng + dang2;
                        stAng2 = Math.PI / 2 - dang2;

                        var stAng2dg, swAng2dg, swAngDg, swAng2dg;
                        stAng2dg = stAng2 * 180 / Math.PI;
                        swAng2dg = swAng2 * 180 / Math.PI;
                        stAng3dg = stAng3 * 180 / Math.PI;
                        swAngDg = swAng * 180 / Math.PI;

                        var d_val = //"M" + ix + "," +iy + 
                            shapeArc(wR, 0, wR, h, stAng2dg, stAng2dg + swAng2dg, false) + //.replace("M","L") +
                            " L" + x5 + "," + y1 +
                            " L" + x4 + "," + y1 +
                            " L" + x6 + "," + t +
                            " L" + x8 + "," + y1 +
                            " L" + x7 + "," + y1 +
                            shapeArc(x3, 0, wR, h, stAng3dg, stAng3dg + swAngDg, false).replace("M", "L") +
                            " L" + wR + "," + b +
                            shapeArc(wR, 0, wR, h, cd4, cd2, false).replace("M", "L") +
                            " L" + th + "," + t +
                            shapeArc(x3, 0, wR, h, cd2, cd4, false).replace("M", "L") +
                            "";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "mathDivide":
                    case "mathEqual":
                    case "mathMinus":
                    case "mathMultiply":
                    case "mathNotEqual":
                    case "mathPlus":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1;
                        var sAdj2, adj2;
                        var sAdj3, adj3;
                        if (shapAdjst_ary !== undefined) {
                            if (shapAdjst_ary.constructor === Array) {
                                for (var i = 0; i < shapAdjst_ary.length; i++) {
                                    var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                    if (sAdj_name == "adj1") {
                                        sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                        adj1 = parseInt(sAdj1.substr(4));
                                    } else if (sAdj_name == "adj2") {
                                        sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                        adj2 = parseInt(sAdj2.substr(4));
                                    } else if (sAdj_name == "adj3") {
                                        sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                        adj3 = parseInt(sAdj3.substr(4));
                                    }
                                }
                            } else {
                                sAdj1 = getTextByPathList(shapAdjst_ary, ["attrs", "fmla"]);
                                adj1 = parseInt(sAdj1.substr(4));
                            }
                        }
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var cnstVal3 = 200000 * 96 / 914400;
                        var dVal;
                        var hc = w / 2, vc = h / 2, hd2 = h / 2;
                        if (shapType == "mathNotEqual") {
                            if (shapAdjst_ary === undefined) {
                                adj1 = 23520 * 96 / 914400;
                                adj2 = 110 * Math.PI / 180;
                                adj3 = 11760 * 96 / 914400;
                            } else {
                                adj1 = adj1 * 96 / 914400;
                                adj2 = (adj2 / 60000) * Math.PI / 180;
                                adj3 = adj3 * 96 / 914400;
                            }
                            var a1, crAng, a2a1, maxAdj3, a3, dy1, dy2, dx1, x1, x8, y2, y3, y1, y4,
                                cadj2, xadj2, len, bhw, bhw2, x7, dx67, x6, dx57, x5, dx47, x4, dx37,
                                x3, dx27, x2, rx7, rx6, rx5, rx4, rx3, rx2, dx7, rxt, lxt, rx, lx,
                                dy3, dy4, ry, ly, dlx, drx, dly, dry, xC1, xC2, yC1, yC2, yC3, yC4;
                            var angVal1 = 70 * Math.PI / 180, angVal2 = 110 * Math.PI / 180;
                            var cnstVal4 = 73490 * 96 / 914400;
                            //var cd4 = 90;
                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal1) ? cnstVal1 : adj1;
                            crAng = (adj2 < angVal1) ? angVal1 : (adj2 > angVal2) ? angVal2 : adj2;
                            a2a1 = a1 * 2;
                            maxAdj3 = cnstVal2 - a2a1;
                            a3 = (adj3 < 0) ? 0 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                            dy1 = h * a1 / cnstVal2;
                            dy2 = h * a3 / cnstVal3;
                            dx1 = w * cnstVal4 / cnstVal3;
                            x1 = hc - dx1;
                            x8 = hc + dx1;
                            y2 = vc - dy2;
                            y3 = vc + dy2;
                            y1 = y2 - dy1;
                            y4 = y3 + dy1;
                            cadj2 = crAng - Math.PI / 2;
                            xadj2 = hd2 * Math.tan(cadj2);
                            len = Math.sqrt(xadj2 * xadj2 + hd2 * hd2);
                            bhw = len * dy1 / hd2;
                            bhw2 = bhw / 2;
                            x7 = hc + xadj2 - bhw2;
                            dx67 = xadj2 * y1 / hd2;
                            x6 = x7 - dx67;
                            dx57 = xadj2 * y2 / hd2;
                            x5 = x7 - dx57;
                            dx47 = xadj2 * y3 / hd2;
                            x4 = x7 - dx47;
                            dx37 = xadj2 * y4 / hd2;
                            x3 = x7 - dx37;
                            dx27 = xadj2 * 2;
                            x2 = x7 - dx27;
                            rx7 = x7 + bhw;
                            rx6 = x6 + bhw;
                            rx5 = x5 + bhw;
                            rx4 = x4 + bhw;
                            rx3 = x3 + bhw;
                            rx2 = x2 + bhw;
                            dx7 = dy1 * hd2 / len;
                            rxt = x7 + dx7;
                            lxt = rx7 - dx7;
                            rx = (cadj2 > 0) ? rxt : rx7;
                            lx = (cadj2 > 0) ? x7 : lxt;
                            dy3 = dy1 * xadj2 / len;
                            dy4 = -dy3;
                            ry = (cadj2 > 0) ? dy3 : 0;
                            ly = (cadj2 > 0) ? 0 : dy4;
                            dlx = w - rx;
                            drx = w - lx;
                            dly = h - ry;
                            dry = h - ly;
                            xC1 = (rx + lx) / 2;
                            xC2 = (drx + dlx) / 2;
                            yC1 = (ry + ly) / 2;
                            yC2 = (y1 + y2) / 2;
                            yC3 = (y3 + y4) / 2;
                            yC4 = (dry + dly) / 2;

                            dVal = "M" + x1 + "," + y1 +
                                " L" + x6 + "," + y1 +
                                " L" + lx + "," + ly +
                                " L" + rx + "," + ry +
                                " L" + rx6 + "," + y1 +
                                " L" + x8 + "," + y1 +
                                " L" + x8 + "," + y2 +
                                " L" + rx5 + "," + y2 +
                                " L" + rx4 + "," + y3 +
                                " L" + x8 + "," + y3 +
                                " L" + x8 + "," + y4 +
                                " L" + rx3 + "," + y4 +
                                " L" + drx + "," + dry +
                                " L" + dlx + "," + dly +
                                " L" + x3 + "," + y4 +
                                " L" + x1 + "," + y4 +
                                " L" + x1 + "," + y3 +
                                " L" + x4 + "," + y3 +
                                " L" + x5 + "," + y2 +
                                " L" + x1 + "," + y2 +
                                " z";
                        } else if (shapType == "mathDivide") {
                            if (shapAdjst_ary === undefined) {
                                adj1 = 23520 * 96 / 914400;
                                adj2 = 5880 * 96 / 914400;
                                adj3 = 11760 * 96 / 914400;
                            } else {
                                adj1 = adj1 * 96 / 914400;
                                adj2 = adj2 * 96 / 914400;
                                adj3 = adj3 * 96 / 914400;
                            }
                            var a1, ma1, ma3h, ma3w, maxAdj3, a3, m4a3, maxAdj2, a2, dy1, yg, rad, dx1,
                                y3, y4, a, y2, y1, y5, x1, x3, x2;
                            var cnstVal4 = 1000 * 96 / 914400;
                            var cnstVal5 = 36745 * 96 / 914400;
                            var cnstVal6 = 73490 * 96 / 914400;
                            a1 = (adj1 < cnstVal4) ? cnstVal4 : (adj1 > cnstVal5) ? cnstVal5 : adj1;
                            ma1 = -a1;
                            ma3h = (cnstVal6 + ma1) / 4;
                            ma3w = cnstVal5 * w / h;
                            maxAdj3 = (ma3h < ma3w) ? ma3h : ma3w;
                            a3 = (adj3 < cnstVal4) ? cnstVal4 : (adj3 > maxAdj3) ? maxAdj3 : adj3;
                            m4a3 = -4 * a3;
                            maxAdj2 = cnstVal6 + m4a3 - a1;
                            a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                            dy1 = h * a1 / cnstVal3;
                            yg = h * a2 / cnstVal2;
                            rad = h * a3 / cnstVal2;
                            dx1 = w * cnstVal6 / cnstVal3;
                            y3 = vc - dy1;
                            y4 = vc + dy1;
                            a = yg + rad;
                            y2 = y3 - a;
                            y1 = y2 - rad;
                            y5 = h - y1;
                            x1 = hc - dx1;
                            x3 = hc + dx1;
                            x2 = hc - rad;
                            var cd4 = 90, c3d4 = 270;
                            var cX1 = hc - Math.cos(c3d4 * Math.PI / 180) * rad;
                            var cY1 = y1 - Math.sin(c3d4 * Math.PI / 180) * rad;
                            var cX2 = hc - Math.cos(Math.PI / 2) * rad;
                            var cY2 = y5 - Math.sin(Math.PI / 2) * rad;
                            dVal = "M" + hc + "," + y1 +
                                shapeArc(cX1, cY1, rad, rad, c3d4, c3d4 + 360, false).replace("M", "L") +
                                " z" +
                                " M" + hc + "," + y5 +
                                shapeArc(cX2, cY2, rad, rad, cd4, cd4 + 360, false).replace("M", "L") +
                                " z" +
                                " M" + x1 + "," + y3 +
                                " L" + x3 + "," + y3 +
                                " L" + x3 + "," + y4 +
                                " L" + x1 + "," + y4 +
                                " z";
                        } else if (shapType == "mathEqual") {
                            if (shapAdjst_ary === undefined) {
                                adj1 = 23520 * 96 / 914400;
                                adj2 = 11760 * 96 / 914400;
                            } else {
                                adj1 = adj1 * 96 / 914400;
                                adj2 = adj2 * 96 / 914400;
                            }
                            var cnstVal5 = 36745 * 96 / 914400;
                            var cnstVal6 = 73490 * 96 / 914400;
                            var a1, a2a1, mAdj2, a2, dy1, dy2, dx1, y2, y3, y1, y4, x1, x2, yC1, yC2;

                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal5) ? cnstVal5 : adj1;
                            a2a1 = a1 * 2;
                            mAdj2 = cnstVal2 - a2a1;
                            a2 = (adj2 < 0) ? 0 : (adj2 > mAdj2) ? mAdj2 : adj2;
                            dy1 = h * a1 / cnstVal2;
                            dy2 = h * a2 / cnstVal3;
                            dx1 = w * cnstVal6 / cnstVal3;
                            y2 = vc - dy2;
                            y3 = vc + dy2;
                            y1 = y2 - dy1;
                            y4 = y3 + dy1;
                            x1 = hc - dx1;
                            x2 = hc + dx1;
                            yC1 = (y1 + y2) / 2;
                            yC2 = (y3 + y4) / 2;
                            dVal = "M" + x1 + "," + y1 +
                                " L" + x2 + "," + y1 +
                                " L" + x2 + "," + y2 +
                                " L" + x1 + "," + y2 +
                                " z" +
                                "M" + x1 + "," + y3 +
                                " L" + x2 + "," + y3 +
                                " L" + x2 + "," + y4 +
                                " L" + x1 + "," + y4 +
                                " z";
                        } else if (shapType == "mathMinus") {
                            if (shapAdjst_ary === undefined) {
                                adj1 = 23520 * 96 / 914400;
                            } else {
                                adj1 = adj1 * 96 / 914400;
                            }
                            var cnstVal6 = 73490 * 96 / 914400;
                            var a1, dy1, dx1, y1, y2, x1, x2;
                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal2) ? cnstVal2 : adj1;
                            dy1 = h * a1 / cnstVal3;
                            dx1 = w * cnstVal6 / cnstVal3;
                            y1 = vc - dy1;
                            y2 = vc + dy1;
                            x1 = hc - dx1;
                            x2 = hc + dx1;

                            dVal = "M" + x1 + "," + y1 +
                                " L" + x2 + "," + y1 +
                                " L" + x2 + "," + y2 +
                                " L" + x1 + "," + y2 +
                                " z";
                        } else if (shapType == "mathMultiply") {
                            if (shapAdjst_ary === undefined) {
                                adj1 = 23520 * 96 / 914400;
                            } else {
                                adj1 = adj1 * 96 / 914400;
                            }
                            var cnstVal6 = 51965 * 96 / 914400;
                            var a1, th, a, sa, ca, ta, dl, rw, lM, xM, yM, dxAM, dyAM,
                                xA, yA, xB, yB, xBC, yBC, yC, xD, xE, yFE, xFE, xF, xL, yG, yH, yI, xC2, yC3;
                            var ss = Math.min(w, h);
                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal6) ? cnstVal6 : adj1;
                            th = ss * a1 / cnstVal2;
                            a = Math.atan(h / w);
                            sa = 1 * Math.sin(a);
                            ca = 1 * Math.cos(a);
                            ta = 1 * Math.tan(a);
                            dl = Math.sqrt(w * w + h * h);
                            rw = dl * cnstVal6 / cnstVal2;
                            lM = dl - rw;
                            xM = ca * lM / 2;
                            yM = sa * lM / 2;
                            dxAM = sa * th / 2;
                            dyAM = ca * th / 2;
                            xA = xM - dxAM;
                            yA = yM + dyAM;
                            xB = xM + dxAM;
                            yB = yM - dyAM;
                            xBC = hc - xB;
                            yBC = xBC * ta;
                            yC = yBC + yB;
                            xD = w - xB;
                            xE = w - xA;
                            yFE = vc - yA;
                            xFE = yFE / ta;
                            xF = xE - xFE;
                            xL = xA + xFE;
                            yG = h - yA;
                            yH = h - yB;
                            yI = h - yC;
                            xC2 = w - xM;
                            yC3 = h - yM;

                            dVal = "M" + xA + "," + yA +
                                " L" + xB + "," + yB +
                                " L" + hc + "," + yC +
                                " L" + xD + "," + yB +
                                " L" + xE + "," + yA +
                                " L" + xF + "," + vc +
                                " L" + xE + "," + yG +
                                " L" + xD + "," + yH +
                                " L" + hc + "," + yI +
                                " L" + xB + "," + yH +
                                " L" + xA + "," + yG +
                                " L" + xL + "," + vc +
                                " z";
                        } else if (shapType == "mathPlus") {
                            if (shapAdjst_ary === undefined) {
                                adj1 = 23520 * 96 / 914400;
                            } else {
                                adj1 = adj1 * 96 / 914400;
                            }
                            var cnstVal6 = 73490 * 96 / 914400;
                            var ss = Math.min(w, h);
                            var a1, dx1, dy1, dx2, x1, x2, x3, x4, y1, y2, y3, y4;

                            a1 = (adj1 < 0) ? 0 : (adj1 > cnstVal6) ? cnstVal6 : adj1;
                            dx1 = w * cnstVal6 / cnstVal3;
                            dy1 = h * cnstVal6 / cnstVal3;
                            dx2 = ss * a1 / cnstVal3;
                            x1 = hc - dx1;
                            x2 = hc - dx2;
                            x3 = hc + dx2;
                            x4 = hc + dx1;
                            y1 = vc - dy1;
                            y2 = vc - dx2;
                            y3 = vc + dx2;
                            y4 = vc + dy1;

                            dVal = "M" + x1 + "," + y2 +
                                " L" + x2 + "," + y2 +
                                " L" + x2 + "," + y1 +
                                " L" + x3 + "," + y1 +
                                " L" + x3 + "," + y2 +
                                " L" + x4 + "," + y2 +
                                " L" + x4 + "," + y3 +
                                " L" + x3 + "," + y3 +
                                " L" + x3 + "," + y4 +
                                " L" + x2 + "," + y4 +
                                " L" + x2 + "," + y3 +
                                " L" + x1 + "," + y3 +
                                " z";
                        }
                        result += "<path d='" + dVal + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        //console.log(shapType);
                        break;
                    case "can":
                    case "flowChartMagneticDisk":
                    case "flowChartMagneticDrum":
                        var shapAdjst = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd", "attrs", "fmla"]);
                        var adj = 25000 * 96 / 914400;
                        var cnstVal1 = 50000 * 96 / 914400;
                        var cnstVal2 = 200000 * 96 / 914400;
                        if (shapAdjst !== undefined) {
                            adj = parseInt(shapAdjst.substr(4)) * 96 / 914400;
                        }
                        var ss = Math.min(w, h);
                        var maxAdj, a, y1, y2, y3, dVal;
                        if (shapType == "flowChartMagneticDisk" || shapType == "flowChartMagneticDrum") {
                            adj = 50000 * 96 / 914400;
                        }
                        maxAdj = cnstVal1 * h / ss;
                        a = (adj < 0) ? 0 : (adj > maxAdj) ? maxAdj : adj;
                        y1 = ss * a / cnstVal2;
                        y2 = y1 + y1;
                        y3 = h - y1;
                        var cd2 = 180, wd2 = w / 2;

                        var tranglRott = "";
                        if (shapType == "flowChartMagneticDrum") {
                            tranglRott = "transform='rotate(90 " + w / 2 + "," + h / 2 + ")'";
                        }
                        dVal = shapeArc(wd2, y1, wd2, y1, 0, cd2, false) +
                            shapeArc(wd2, y1, wd2, y1, cd2, cd2 + cd2, false).replace("M", "L") +
                            " L" + w + "," + y3 +
                            shapeArc(wd2, y3, wd2, y1, 0, cd2, false).replace("M", "L") +
                            " L" + 0 + "," + y1;

                        result += "<path " + tranglRott + " d='" + dVal + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "swooshArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var refr = 96 / 914400;
                        var sAdj1, adj1 = 25000 * refr;
                        var sAdj2, adj2 = 16667 * refr;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * refr;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = parseInt(sAdj2.substr(4)) * refr;
                                }
                            }
                        }
                        var cnstVal1 = 1 * refr;
                        var cnstVal2 = 70000 * refr;
                        var cnstVal3 = 75000 * refr;
                        var cnstVal4 = 100000 * refr;
                        var ss = Math.min(w, h);
                        var ssd8 = ss / 8;
                        var hd6 = h / 6;

                        var a1, maxAdj2, a2, ad1, ad2, xB, yB, alfa, dx0, xC, dx1, yF, xF, xE, yE, dy2, dy22, dy3, yD, dy4, yP1, xP1, dy5, yP2, xP2;

                        a1 = (adj1 < cnstVal1) ? cnstVal1 : (adj1 > cnstVal3) ? cnstVal3 : adj1;
                        maxAdj2 = cnstVal2 * w / ss;
                        a2 = (adj2 < 0) ? 0 : (adj2 > maxAdj2) ? maxAdj2 : adj2;
                        ad1 = h * a1 / cnstVal4;
                        ad2 = ss * a2 / cnstVal4;
                        xB = w - ad2;
                        yB = ssd8;
                        alfa = (Math.PI / 2) / 14;
                        dx0 = ssd8 * Math.tan(alfa);
                        xC = xB - dx0;
                        dx1 = ad1 * Math.tan(alfa);
                        yF = yB + ad1;
                        xF = xB + dx1;
                        xE = xF + dx0;
                        yE = yF + ssd8;
                        dy2 = yE - 0;
                        dy22 = dy2 / 2;
                        dy3 = h / 20;
                        yD = dy22 - dy3;
                        dy4 = hd6;
                        yP1 = hd6 + dy4;
                        xP1 = w / 6;
                        dy5 = hd6 / 2;
                        yP2 = yF + dy5;
                        xP2 = w / 4;

                        var dVal = "M" + 0 + "," + h +
                            " Q" + xP1 + "," + yP1 + " " + xB + "," + yB +
                            " L" + xC + "," + 0 +
                            " L" + w + "," + yD +
                            " L" + xE + "," + yE +
                            " L" + xF + "," + yF +
                            " Q" + xP2 + "," + yP2 + " " + 0 + "," + h +
                            " z";

                        result += "<path d='" + dVal + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "circularArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 12500 * 96 / 914400;
                        var sAdj2, adj2 = (1142319 / 60000) * Math.PI / 180;
                        var sAdj3, adj3 = (20457681 / 60000) * Math.PI / 180;
                        var sAdj4, adj4 = (10800000 / 60000) * Math.PI / 180;
                        var sAdj5, adj5 = 12500 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = (parseInt(sAdj2.substr(4)) / 60000) * Math.PI / 180;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = (parseInt(sAdj3.substr(4)) / 60000) * Math.PI / 180;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = (parseInt(sAdj4.substr(4)) / 60000) * Math.PI / 180;
                                } else if (sAdj_name == "adj5") {
                                    sAdj5 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj5 = parseInt(sAdj5.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, r = w, b = h, l = 0, t = 0, wd2 = w / 2, hd2 = h / 2;
                        var ss = Math.min(w, h);
                        var a5, maxAdj1, a1, enAng, stAng, th, thh, th2, rw1, rh1, rw2, rh2, rw3, rh3, wtH, htH, dxH,
                            dyH, xH, yH, rI, u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11, u12, u13, u14, u15, u16, u17,
                            u18, u19, u20, u21, maxAng, aAng, ptAng, wtA, htA, dxA, dyA, xA, yA, wtE, htE, dxE, dyE, xE, yE,
                            dxG, dyG, xG, yG, dxB, dyB, xB, yB, sx1, sy1, sx2, sy2, rO, x1O, y1O, x2O, y2O, dxO, dyO, dO,
                            q1, q2, DO, q3, q4, q5, q6, q7, q8, sdelO, ndyO, sdyO, q9, q10, q11, dxF1, q12, dxF2, adyO,
                            q13, q14, dyF1, q15, dyF2, q16, q17, q18, q19, q20, q21, q22, dxF, dyF, sdxF, sdyF, xF, yF,
                            x1I, y1I, x2I, y2I, dxI, dyI, dI, v1, v2, DI, v3, v4, v5, v6, v7, v8, sdelI, v9, v10, v11,
                            dxC1, v12, dxC2, adyI, v13, v14, dyC1, v15, dyC2, v16, v17, v18, v19, v20, v21, v22, dxC, dyC,
                            sdxC, sdyC, xC, yC, ist0, ist1, istAng, isw1, isw2, iswAng, p1, p2, p3, p4, p5, xGp, yGp,
                            xBp, yBp, en0, en1, en2, sw0, sw1, swAng;
                        var cnstVal1 = 25000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var rdAngVal1 = (1 / 60000) * Math.PI / 180;
                        var rdAngVal2 = (21599999 / 60000) * Math.PI / 180;
                        var rdAngVal3 = 2 * Math.PI;

                        a5 = (adj5 < 0) ? 0 : (adj5 > cnstVal1) ? cnstVal1 : adj5;
                        maxAdj1 = a5 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        enAng = (adj3 < rdAngVal1) ? rdAngVal1 : (adj3 > rdAngVal2) ? rdAngVal2 : adj3;
                        stAng = (adj4 < 0) ? 0 : (adj4 > rdAngVal2) ? rdAngVal2 : adj4; //////////////////////////////////////////
                        th = ss * a1 / cnstVal2;
                        thh = ss * a5 / cnstVal2;
                        th2 = th / 2;
                        rw1 = wd2 + th2 - thh;
                        rh1 = hd2 + th2 - thh;
                        rw2 = rw1 - th;
                        rh2 = rh1 - th;
                        rw3 = rw2 + th2;
                        rh3 = rh2 + th2;
                        wtH = rw3 * Math.sin(enAng);
                        htH = rh3 * Math.cos(enAng);

                        //dxH = rw3*Math.cos(Math.atan(wtH/htH));
                        //dyH = rh3*Math.sin(Math.atan(wtH/htH));
                        dxH = rw3 * Math.cos(Math.atan2(wtH, htH));
                        dyH = rh3 * Math.sin(Math.atan2(wtH, htH));

                        xH = hc + dxH;
                        yH = vc + dyH;
                        rI = (rw2 < rh2) ? rw2 : rh2;
                        u1 = dxH * dxH;
                        u2 = dyH * dyH;
                        u3 = rI * rI;
                        u4 = u1 - u3;
                        u5 = u2 - u3;
                        u6 = u4 * u5 / u1;
                        u7 = u6 / u2;
                        u8 = 1 - u7;
                        u9 = Math.sqrt(u8);
                        u10 = u4 / dxH;
                        u11 = u10 / dyH;
                        u12 = (1 + u9) / u11;

                        //u13 = Math.atan(u12/1);
                        u13 = Math.atan2(u12, 1);

                        u14 = u13 + rdAngVal3;
                        u15 = (u13 > 0) ? u13 : u14;
                        u16 = u15 - enAng;
                        u17 = u16 + rdAngVal3;
                        u18 = (u16 > 0) ? u16 : u17;
                        u19 = u18 - cd2;
                        u20 = u18 - rdAngVal3;
                        u21 = (u19 > 0) ? u20 : u18;
                        maxAng = Math.abs(u21);
                        aAng = (adj2 < 0) ? 0 : (adj2 > maxAng) ? maxAng : adj2;
                        ptAng = enAng + aAng;
                        wtA = rw3 * Math.sin(ptAng);
                        htA = rh3 * Math.cos(ptAng);
                        //dxA = rw3*Math.cos(Math.atan(wtA/htA));
                        //dyA = rh3*Math.sin(Math.atan(wtA/htA));
                        dxA = rw3 * Math.cos(Math.atan2(wtA, htA));
                        dyA = rh3 * Math.sin(Math.atan2(wtA, htA));

                        xA = hc + dxA;
                        yA = vc + dyA;
                        wtE = rw1 * Math.sin(stAng);
                        htE = rh1 * Math.cos(stAng);

                        //dxE = rw1*Math.cos(Math.atan(wtE/htE));
                        //dyE = rh1*Math.sin(Math.atan(wtE/htE));
                        dxE = rw1 * Math.cos(Math.atan2(wtE, htE));
                        dyE = rh1 * Math.sin(Math.atan2(wtE, htE));

                        xE = hc + dxE;
                        yE = vc + dyE;
                        dxG = thh * Math.cos(ptAng);
                        dyG = thh * Math.sin(ptAng);
                        xG = xH + dxG;
                        yG = yH + dyG;
                        dxB = thh * Math.cos(ptAng);
                        dyB = thh * Math.sin(ptAng);
                        xB = xH - dxB;
                        yB = yH - dyB;
                        sx1 = xB - hc;
                        sy1 = yB - vc;
                        sx2 = xG - hc;
                        sy2 = yG - vc;
                        rO = (rw1 < rh1) ? rw1 : rh1;
                        x1O = sx1 * rO / rw1;
                        y1O = sy1 * rO / rh1;
                        x2O = sx2 * rO / rw1;
                        y2O = sy2 * rO / rh1;
                        dxO = x2O - x1O;
                        dyO = y2O - y1O;
                        dO = Math.sqrt(dxO * dxO + dyO * dyO);
                        q1 = x1O * y2O;
                        q2 = x2O * y1O;
                        DO = q1 - q2;
                        q3 = rO * rO;
                        q4 = dO * dO;
                        q5 = q3 * q4;
                        q6 = DO * DO;
                        q7 = q5 - q6;
                        q8 = (q7 > 0) ? q7 : 0;
                        sdelO = Math.sqrt(q8);
                        ndyO = dyO * -1;
                        sdyO = (ndyO > 0) ? -1 : 1;
                        q9 = sdyO * dxO;
                        q10 = q9 * sdelO;
                        q11 = DO * dyO;
                        dxF1 = (q11 + q10) / q4;
                        q12 = q11 - q10;
                        dxF2 = q12 / q4;
                        adyO = Math.abs(dyO);
                        q13 = adyO * sdelO;
                        q14 = DO * dxO / -1;
                        dyF1 = (q14 + q13) / q4;
                        q15 = q14 - q13;
                        dyF2 = q15 / q4;
                        q16 = x2O - dxF1;
                        q17 = x2O - dxF2;
                        q18 = y2O - dyF1;
                        q19 = y2O - dyF2;
                        q20 = Math.sqrt(q16 * q16 + q18 * q18);
                        q21 = Math.sqrt(q17 * q17 + q19 * q19);
                        q22 = q21 - q20;
                        dxF = (q22 > 0) ? dxF1 : dxF2;
                        dyF = (q22 > 0) ? dyF1 : dyF2;
                        sdxF = dxF * rw1 / rO;
                        sdyF = dyF * rh1 / rO;
                        xF = hc + sdxF;
                        yF = vc + sdyF;
                        x1I = sx1 * rI / rw2;
                        y1I = sy1 * rI / rh2;
                        x2I = sx2 * rI / rw2;
                        y2I = sy2 * rI / rh2;
                        dxI = x2I - x1I;
                        dyI = y2I - y1I;
                        dI = Math.sqrt(dxI * dxI + dyI * dyI);
                        v1 = x1I * y2I;
                        v2 = x2I * y1I;
                        DI = v1 - v2;
                        v3 = rI * rI;
                        v4 = dI * dI;
                        v5 = v3 * v4;
                        v6 = DI * DI;
                        v7 = v5 - v6;
                        v8 = (v7 > 0) ? v7 : 0;
                        sdelI = Math.sqrt(v8);
                        v9 = sdyO * dxI;
                        v10 = v9 * sdelI;
                        v11 = DI * dyI;
                        dxC1 = (v11 + v10) / v4;
                        v12 = v11 - v10;
                        dxC2 = v12 / v4;
                        adyI = Math.abs(dyI);
                        v13 = adyI * sdelI;
                        v14 = DI * dxI / -1;
                        dyC1 = (v14 + v13) / v4;
                        v15 = v14 - v13;
                        dyC2 = v15 / v4;
                        v16 = x1I - dxC1;
                        v17 = x1I - dxC2;
                        v18 = y1I - dyC1;
                        v19 = y1I - dyC2;
                        v20 = Math.sqrt(v16 * v16 + v18 * v18);
                        v21 = Math.sqrt(v17 * v17 + v19 * v19);
                        v22 = v21 - v20;
                        dxC = (v22 > 0) ? dxC1 : dxC2;
                        dyC = (v22 > 0) ? dyC1 : dyC2;
                        sdxC = dxC * rw2 / rI;
                        sdyC = dyC * rh2 / rI;
                        xC = hc + sdxC;
                        yC = vc + sdyC;

                        //ist0 = Math.atan(sdyC/sdxC);
                        ist0 = Math.atan2(sdyC, sdxC);

                        ist1 = ist0 + rdAngVal3;
                        istAng = (ist0 > 0) ? ist0 : ist1;
                        isw1 = stAng - istAng;
                        isw2 = isw1 - rdAngVal3;
                        iswAng = (isw1 > 0) ? isw2 : isw1;
                        p1 = xF - xC;
                        p2 = yF - yC;
                        p3 = Math.sqrt(p1 * p1 + p2 * p2);
                        p4 = p3 / 2;
                        p5 = p4 - thh;
                        xGp = (p5 > 0) ? xF : xG;
                        yGp = (p5 > 0) ? yF : yG;
                        xBp = (p5 > 0) ? xC : xB;
                        yBp = (p5 > 0) ? yC : yB;

                        //en0 = Math.atan(sdyF/sdxF);
                        en0 = Math.atan2(sdyF, sdxF);

                        en1 = en0 + rdAngVal3;
                        en2 = (en0 > 0) ? en0 : en1;
                        sw0 = en2 - stAng;
                        sw1 = sw0 + rdAngVal3;
                        swAng = (sw0 > 0) ? sw0 : sw1;

                        var strtAng = stAng * 180 / Math.PI
                        var endAng = strtAng + (swAng * 180 / Math.PI);
                        var stiAng = istAng * 180 / Math.PI;
                        var swiAng = iswAng * 180 / Math.PI;
                        var ediAng = stiAng + swiAng;

                        var d_val = shapeArc(w / 2, h / 2, rw1, rh1, strtAng, endAng, false) +
                            " L" + xGp + "," + yGp +
                            " L" + xA + "," + yA +
                            " L" + xBp + "," + yBp +
                            " L" + xC + "," + yC +
                            shapeArc(w / 2, h / 2, rw2, rh2, stiAng, ediAng, false).replace("M", "L") +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "leftCircularArrow":
                        var shapAdjst_ary = getTextByPathList(node, ["p:spPr", "a:prstGeom", "a:avLst", "a:gd"]);
                        var sAdj1, adj1 = 12500 * 96 / 914400;
                        var sAdj2, adj2 = (-1142319 / 60000) * Math.PI / 180;
                        var sAdj3, adj3 = (1142319 / 60000) * Math.PI / 180;
                        var sAdj4, adj4 = (10800000 / 60000) * Math.PI / 180;
                        var sAdj5, adj5 = 12500 * 96 / 914400;
                        if (shapAdjst_ary !== undefined) {
                            for (var i = 0; i < shapAdjst_ary.length; i++) {
                                var sAdj_name = getTextByPathList(shapAdjst_ary[i], ["attrs", "name"]);
                                if (sAdj_name == "adj1") {
                                    sAdj1 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj1 = parseInt(sAdj1.substr(4)) * 96 / 914400;
                                } else if (sAdj_name == "adj2") {
                                    sAdj2 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj2 = (parseInt(sAdj2.substr(4)) / 60000) * Math.PI / 180;
                                } else if (sAdj_name == "adj3") {
                                    sAdj3 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj3 = (parseInt(sAdj3.substr(4)) / 60000) * Math.PI / 180;
                                } else if (sAdj_name == "adj4") {
                                    sAdj4 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj4 = (parseInt(sAdj4.substr(4)) / 60000) * Math.PI / 180;
                                } else if (sAdj_name == "adj5") {
                                    sAdj5 = getTextByPathList(shapAdjst_ary[i], ["attrs", "fmla"]);
                                    adj5 = parseInt(sAdj5.substr(4)) * 96 / 914400;
                                }
                            }
                        }
                        var vc = h / 2, hc = w / 2, r = w, b = h, l = 0, t = 0, wd2 = w / 2, hd2 = h / 2;
                        var ss = Math.min(w, h);
                        var cnstVal1 = 25000 * 96 / 914400;
                        var cnstVal2 = 100000 * 96 / 914400;
                        var rdAngVal1 = (1 / 60000) * Math.PI / 180;
                        var rdAngVal2 = (21599999 / 60000) * Math.PI / 180;
                        var rdAngVal3 = 2 * Math.PI;
                        var a5, maxAdj1, a1, enAng, stAng, th, thh, th2, rw1, rh1, rw2, rh2, rw3, rh3, wtH, htH, dxH, dyH, xH, yH, rI,
                            u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11, u12, u13, u14, u15, u16, u17, u18, u19, u20, u21, u22,
                            minAng, u23, a2, aAng, ptAng, wtA, htA, dxA, dyA, xA, yA, wtE, htE, dxE, dyE, xE, yE, wtD, htD, dxD, dyD,
                            xD, yD, dxG, dyG, xG, yG, dxB, dyB, xB, yB, sx1, sy1, sx2, sy2, rO, x1O, y1O, x2O, y2O, dxO, dyO, dO,
                            q1, q2, DO, q3, q4, q5, q6, q7, q8, sdelO, ndyO, sdyO, q9, q10, q11, dxF1, q12, dxF2, adyO, q13, q14, dyF1,
                            q15, dyF2, q16, q17, q18, q19, q20, q21, q22, dxF, dyF, sdxF, sdyF, xF, yF, x1I, y1I, x2I, y2I, dxI, dyI, dI,
                            v1, v2, DI, v3, v4, v5, v6, v7, v8, sdelI, v9, v10, v11, dxC1, v12, dxC2, adyI, v13, v14, dyC1, v15, dyC2, v16,
                            v17, v18, v19, v20, v21, v22, dxC, dyC, sdxC, sdyC, xC, yC, ist0, ist1, istAng0, isw1, isw2, iswAng0, istAng,
                            iswAng, p1, p2, p3, p4, p5, xGp, yGp, xBp, yBp, en0, en1, en2, sw0, sw1, swAng, stAng0;

                        a5 = (adj5 < 0) ? 0 : (adj5 > cnstVal1) ? cnstVal1 : adj5;
                        maxAdj1 = a5 * 2;
                        a1 = (adj1 < 0) ? 0 : (adj1 > maxAdj1) ? maxAdj1 : adj1;
                        enAng = (adj3 < rdAngVal1) ? rdAngVal1 : (adj3 > rdAngVal2) ? rdAngVal2 : adj3;
                        stAng = (adj4 < 0) ? 0 : (adj4 > rdAngVal2) ? rdAngVal2 : adj4;
                        th = ss * a1 / cnstVal2;
                        thh = ss * a5 / cnstVal2;
                        th2 = th / 2;
                        rw1 = wd2 + th2 - thh;
                        rh1 = hd2 + th2 - thh;
                        rw2 = rw1 - th;
                        rh2 = rh1 - th;
                        rw3 = rw2 + th2;
                        rh3 = rh2 + th2;
                        wtH = rw3 * Math.sin(enAng);
                        htH = rh3 * Math.cos(enAng);
                        dxH = rw3 * Math.cos(Math.atan2(wtH, htH));
                        dyH = rh3 * Math.sin(Math.atan2(wtH, htH));
                        xH = hc + dxH;
                        yH = vc + dyH;
                        rI = (rw2 < rh2) ? rw2 : rh2;
                        u1 = dxH * dxH;
                        u2 = dyH * dyH;
                        u3 = rI * rI;
                        u4 = u1 - u3;
                        u5 = u2 - u3;
                        u6 = u4 * u5 / u1;
                        u7 = u6 / u2;
                        u8 = 1 - u7;
                        u9 = Math.sqrt(u8);
                        u10 = u4 / dxH;
                        u11 = u10 / dyH;
                        u12 = (1 + u9) / u11;
                        u13 = Math.atan2(u12, 1);
                        u14 = u13 + rdAngVal3;
                        u15 = (u13 > 0) ? u13 : u14;
                        u16 = u15 - enAng;
                        u17 = u16 + rdAngVal3;
                        u18 = (u16 > 0) ? u16 : u17;
                        u19 = u18 - cd2;
                        u20 = u18 - rdAngVal3;
                        u21 = (u19 > 0) ? u20 : u18;
                        u22 = Math.abs(u21);
                        minAng = u22 * -1;
                        u23 = Math.abs(adj2);
                        a2 = u23 * -1;
                        aAng = (a2 < minAng) ? minAng : (a2 > 0) ? 0 : a2;
                        ptAng = enAng + aAng;
                        wtA = rw3 * Math.sin(ptAng);
                        htA = rh3 * Math.cos(ptAng);
                        dxA = rw3 * Math.cos(Math.atan2(wtA, htA));
                        dyA = rh3 * Math.sin(Math.atan2(wtA, htA));
                        xA = hc + dxA;
                        yA = vc + dyA;
                        wtE = rw1 * Math.sin(stAng);
                        htE = rh1 * Math.cos(stAng);
                        dxE = rw1 * Math.cos(Math.atan2(wtE, htE));
                        dyE = rh1 * Math.sin(Math.atan2(wtE, htE));
                        xE = hc + dxE;
                        yE = vc + dyE;
                        wtD = rw2 * Math.sin(stAng);
                        htD = rh2 * Math.cos(stAng);
                        dxD = rw2 * Math.cos(Math.atan2(wtD, htD));
                        dyD = rh2 * Math.sin(Math.atan2(wtD, htD));
                        xD = hc + dxD;
                        yD = vc + dyD;
                        dxG = thh * Math.cos(ptAng);
                        dyG = thh * Math.sin(ptAng);
                        xG = xH + dxG;
                        yG = yH + dyG;
                        dxB = thh * Math.cos(ptAng);
                        dyB = thh * Math.sin(ptAng);
                        xB = xH - dxB;
                        yB = yH - dyB;
                        sx1 = xB - hc;
                        sy1 = yB - vc;
                        sx2 = xG - hc;
                        sy2 = yG - vc;
                        rO = (rw1 < rh1) ? rw1 : rh1;
                        x1O = sx1 * rO / rw1;
                        y1O = sy1 * rO / rh1;
                        x2O = sx2 * rO / rw1;
                        y2O = sy2 * rO / rh1;
                        dxO = x2O - x1O;
                        dyO = y2O - y1O;
                        dO = Math.sqrt(dxO * dxO + dyO * dyO);
                        q1 = x1O * y2O;
                        q2 = x2O * y1O;
                        DO = q1 - q2;
                        q3 = rO * rO;
                        q4 = dO * dO;
                        q5 = q3 * q4;
                        q6 = DO * DO;
                        q7 = q5 - q6;
                        q8 = (q7 > 0) ? q7 : 0;
                        sdelO = Math.sqrt(q8);
                        ndyO = dyO * -1;
                        sdyO = (ndyO > 0) ? -1 : 1;
                        q9 = sdyO * dxO;
                        q10 = q9 * sdelO;
                        q11 = DO * dyO;
                        dxF1 = (q11 + q10) / q4;
                        q12 = q11 - q10;
                        dxF2 = q12 / q4;
                        adyO = Math.abs(dyO);
                        q13 = adyO * sdelO;
                        q14 = DO * dxO / -1;
                        dyF1 = (q14 + q13) / q4;
                        q15 = q14 - q13;
                        dyF2 = q15 / q4;
                        q16 = x2O - dxF1;
                        q17 = x2O - dxF2;
                        q18 = y2O - dyF1;
                        q19 = y2O - dyF2;
                        q20 = Math.sqrt(q16 * q16 + q18 * q18);
                        q21 = Math.sqrt(q17 * q17 + q19 * q19);
                        q22 = q21 - q20;
                        dxF = (q22 > 0) ? dxF1 : dxF2;
                        dyF = (q22 > 0) ? dyF1 : dyF2;
                        sdxF = dxF * rw1 / rO;
                        sdyF = dyF * rh1 / rO;
                        xF = hc + sdxF;
                        yF = vc + sdyF;
                        x1I = sx1 * rI / rw2;
                        y1I = sy1 * rI / rh2;
                        x2I = sx2 * rI / rw2;
                        y2I = sy2 * rI / rh2;
                        dxI = x2I - x1I;
                        dyI = y2I - y1I;
                        dI = Math.sqrt(dxI * dxI + dyI * dyI);
                        v1 = x1I * y2I;
                        v2 = x2I * y1I;
                        DI = v1 - v2;
                        v3 = rI * rI;
                        v4 = dI * dI;
                        v5 = v3 * v4;
                        v6 = DI * DI;
                        v7 = v5 - v6;
                        v8 = (v7 > 0) ? v7 : 0;
                        sdelI = Math.sqrt(v8);
                        v9 = sdyO * dxI;
                        v10 = v9 * sdelI;
                        v11 = DI * dyI;
                        dxC1 = (v11 + v10) / v4;
                        v12 = v11 - v10;
                        dxC2 = v12 / v4;
                        adyI = Math.abs(dyI);
                        v13 = adyI * sdelI;
                        v14 = DI * dxI / -1;
                        dyC1 = (v14 + v13) / v4;
                        v15 = v14 - v13;
                        dyC2 = v15 / v4;
                        v16 = x1I - dxC1;
                        v17 = x1I - dxC2;
                        v18 = y1I - dyC1;
                        v19 = y1I - dyC2;
                        v20 = Math.sqrt(v16 * v16 + v18 * v18);
                        v21 = Math.sqrt(v17 * v17 + v19 * v19);
                        v22 = v21 - v20;
                        dxC = (v22 > 0) ? dxC1 : dxC2;
                        dyC = (v22 > 0) ? dyC1 : dyC2;
                        sdxC = dxC * rw2 / rI;
                        sdyC = dyC * rh2 / rI;
                        xC = hc + sdxC;
                        yC = vc + sdyC;
                        ist0 = Math.atan2(sdyC, sdxC);
                        ist1 = ist0 + rdAngVal3;
                        istAng0 = (ist0 > 0) ? ist0 : ist1;
                        isw1 = stAng - istAng0;
                        isw2 = isw1 + rdAngVal3;
                        iswAng0 = (isw1 > 0) ? isw1 : isw2;
                        istAng = istAng0 + iswAng0;
                        iswAng = -iswAng0;
                        p1 = xF - xC;
                        p2 = yF - yC;
                        p3 = Math.sqrt(p1 * p1 + p2 * p2);
                        p4 = p3 / 2;
                        p5 = p4 - thh;
                        xGp = (p5 > 0) ? xF : xG;
                        yGp = (p5 > 0) ? yF : yG;
                        xBp = (p5 > 0) ? xC : xB;
                        yBp = (p5 > 0) ? yC : yB;
                        en0 = Math.atan2(sdyF, sdxF);
                        en1 = en0 + rdAngVal3;
                        en2 = (en0 > 0) ? en0 : en1;
                        sw0 = en2 - stAng;
                        sw1 = sw0 - rdAngVal3;
                        swAng = (sw0 > 0) ? sw1 : sw0;
                        stAng0 = stAng + swAng;

                        var strtAng = stAng0 * 180 / Math.PI;
                        var endAng = stAng * 180 / Math.PI;
                        var stiAng = istAng * 180 / Math.PI;
                        var swiAng = iswAng * 180 / Math.PI;
                        var ediAng = stiAng + swiAng;

                        var d_val = "M" + xE + "," + yE +
                            " L" + xD + "," + yD +
                            shapeArc(w / 2, h / 2, rw2, rh2, stiAng, ediAng, false).replace("M", "L") +
                            " L" + xBp + "," + yBp +
                            " L" + xA + "," + yA +
                            " L" + xGp + "," + yGp +
                            " L" + xF + "," + yF +
                            shapeArc(w / 2, h / 2, rw1, rh1, strtAng, endAng, false).replace("M", "L") +
                            " z";
                        result += "<path d='" + d_val + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                            "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' />";

                        break;
                    case "leftRightCircularArrow":
                    case "chartPlus":
                    case "chartStar":
                    case "chartX":
                    case "cornerTabs":
                    case "flowChartOfflineStorage":
                    case "folderCorner":
                    case "funnel":
                    case "lineInv":
                    case "nonIsoscelesTrapezoid":
                    case "plaqueTabs":
                    case "squareTabs":
                    case "upDownArrowCallout":
                        console.log(shapType, " -unsupported shape type.");
                        break;
                    case undefined:
                    default:
                        console.warn("Undefine shape type.(" + shapType + ")");
                }

                result += "</svg>";

                result += "<div class='block content " + getVerticalAlign(node, slideLayoutSpNode, slideMasterSpNode, type) +
                    "' _id='" + id + "' _idx='" + idx + "' _type='" + type + "' _name='" + name +
                    "' style='" +
                    getPosition(slideXfrmNode, slideLayoutXfrmNode, slideMasterXfrmNode) +
                    getSize(slideXfrmNode, slideLayoutXfrmNode, slideMasterXfrmNode) +
                    " z-index: " + order + ";" +
                    "transform: rotate(" + txtRotate + "deg);" +
                    "'>";

                // TextBody
                if (node["p:txBody"] !== undefined) {
                    result += genTextBody(node["p:txBody"], node, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                }
                result += "</div>";
            } else if (custShapType !== undefined) {
                //custGeom here - Amir ///////////////////////////////////////////////////////
                //http://officeopenxml.com/drwSp-custGeom.php
                var pathLstNode = getTextByPathList(custShapType, ["a:pathLst"]);
                var pathNode = getTextByPathList(pathLstNode, ["a:path", "attrs"]);
                var maxX = parseInt(pathNode["w"]) * 96 / 914400;
                var maxY = parseInt(pathNode["h"]) * 96 / 914400;
                //console.log("w = "+w+"\nh = "+h+"\nmaxX = "+maxX +"\nmaxY = " + maxY);
                //cheke if it is close shape
                var closeNode = getTextByPathList(pathLstNode, ["a:path", "a:close"]);
                var startPoint = getTextByPathList(pathLstNode, ["a:path", "a:moveTo", "a:pt", "attrs"]);
                var spX = parseInt(startPoint["x"]) * 96 / 914400;
                var spY = parseInt(startPoint["y"]) * 96 / 914400;
                var d = "M" + spX + "," + spY;
                var pathNodes = getTextByPathList(pathLstNode, ["a:path"]);
                var lnToNodes = pathNodes["a:lnTo"];
                var cubicBezToNodes = pathNodes["a:cubicBezTo"];
                var arcToNodes = pathNodes["a:arcTo"];
                var sortblAry = [];
                if (lnToNodes !== undefined) {
                    Object.keys(lnToNodes).forEach(function (key) {
                        var lnToPtNode = lnToNodes[key]["a:pt"];
                        if (lnToPtNode !== undefined) {
                            Object.keys(lnToPtNode).forEach(function (key2) {
                                var ptObj = {};
                                var lnToNoPt = lnToPtNode[key2];
                                var ptX = lnToNoPt["attrs", "x"];
                                var ptY = lnToNoPt["attrs", "y"];
                                var ptOrdr = lnToNoPt["attrs", "order"];
                                ptObj.type = "lnto";
                                ptObj.order = ptOrdr;
                                ptObj.x = ptX;
                                ptObj.y = ptY;
                                sortblAry.push(ptObj);
                                //console.log(key2, lnToNoPt);

                            });
                        }
                    });

                }
                if (cubicBezToNodes !== undefined) {
                    Object.keys(cubicBezToNodes).forEach(function (key) {
                        //console.log("cubicBezTo["+key+"]:");
                        var cubicBezToPtNodes = cubicBezToNodes[key]["a:pt"];
                        if (cubicBezToPtNodes !== undefined) {
                            Object.keys(cubicBezToPtNodes).forEach(function (key2) {
                                //console.log("cubicBezTo["+key+"]pt["+key2+"]:");
                                var cubBzPts = cubicBezToPtNodes[key2];
                                Object.keys(cubBzPts).forEach(function (key3) {
                                    //console.log(key3, cubBzPts[key3]);
                                    var ptObj = {};
                                    var cubBzPt = cubBzPts[key3];
                                    var ptX = cubBzPt["attrs", "x"];
                                    var ptY = cubBzPt["attrs", "y"];
                                    var ptOrdr = cubBzPt["attrs", "order"];
                                    ptObj.type = "cubicBezTo";
                                    ptObj.order = ptOrdr;
                                    ptObj.x = ptX;
                                    ptObj.y = ptY;
                                    sortblAry.push(ptObj);
                                });
                            });
                        }
                    });
                }
                if (arcToNodes !== undefined) {
                    var arcToNodesAttrs = arcToNodes["attrs"];
                    var arcOrder = arcToNodesAttrs["order"];
                    var hR = arcToNodesAttrs["hR"];
                    var wR = arcToNodesAttrs["wR"];
                    var stAng = arcToNodesAttrs["stAng"];
                    var swAng = arcToNodesAttrs["swAng"];
                    var shftX = 0;
                    var shftY = 0;
                    var arcToPtNode = getTextByPathList(arcToNodes, ["a:pt", "attrs"]);
                    if (arcToPtNode !== undefined) {
                        shftX = arcToPtNode["x"];
                        shftY = arcToPtNode["y"];
                        //console.log("shftX: ",shftX," shftY: ",shftY)
                    }
                    var ptObj = {};
                    ptObj.type = "arcTo";
                    ptObj.order = arcOrder;
                    ptObj.hR = hR;
                    ptObj.wR = wR;
                    ptObj.stAng = stAng;
                    ptObj.swAng = swAng;
                    ptObj.shftX = shftX;
                    ptObj.shftY = shftY;
                    sortblAry.push(ptObj);

                }
                var sortByOrder = sortblAry.slice(0);
                sortByOrder.sort(function (a, b) {
                    return a.order - b.order;
                });
                //console.log(sortByOrder);
                var k = 0;
                while (k < sortByOrder.length) {
                    if (sortByOrder[k].type == "lnto") {
                        var Lx = parseInt(sortByOrder[k].x) * 96 / 914400;
                        var Ly = parseInt(sortByOrder[k].y) * 96 / 914400;
                        d += "L" + Lx + "," + Ly;
                        k++;
                    } else if (sortByOrder[k].type == "cubicBezTo") {
                        var Cx1 = parseInt(sortByOrder[k].x) * 96 / 914400;
                        var Cy1 = parseInt(sortByOrder[k].y) * 96 / 914400;
                        var Cx2 = parseInt(sortByOrder[k + 1].x) * 96 / 914400;
                        var Cy2 = parseInt(sortByOrder[k + 1].y) * 96 / 914400;
                        var Cx3 = parseInt(sortByOrder[k + 2].x) * 96 / 914400;
                        var Cy3 = parseInt(sortByOrder[k + 2].y) * 96 / 914400;

                        d += "C" + Cx1 + "," + Cy1 + " " + Cx2 + "," + Cy2 + " " + Cx3 + "," + Cy3;
                        k += 3;
                    } else if (sortByOrder[k].type == "arcTo") {
                        var hR = parseInt(sortByOrder[k].hR) * 96 / 914400;
                        var wR = parseInt(sortByOrder[k].wR) * 96 / 914400;
                        var stAng = parseInt(sortByOrder[k].stAng) / 60000;
                        var swAng = parseInt(sortByOrder[k].swAng) / 60000;
                        //var shftX = parseInt(sortByOrder[k].shftX) * 96 / 914400;
                        //var shftY = parseInt(sortByOrder[k].shftY) * 96 / 914400;
                        var endAng = stAng + swAng;

                        d += shapeArc(wR, hR, wR, hR, stAng, endAng, false);
                        k++;
                    }
                }
                result += "<path d='" + d + "' fill='" + (!imgFillFlg ? (grndFillFlg ? "url(#linGrd_" + shpId + ")" : fillColor) : "url(#imgPtrn_" + shpId + ")") +
                    "' stroke='" + border.color + "' stroke-width='" + border.width + "' stroke-dasharray='" + border.strokeDasharray + "' ";
                if (closeNode !== undefined) {
                    //console.log("Close shape");
                    result += "/>";
                } else {
                    //console.log("Open shape");
                    //check and add "marker-start" and "marker-end"
                    if (headEndNodeAttrs !== undefined && (headEndNodeAttrs["type"] === "triangle" || headEndNodeAttrs["type"] === "arrow")) {
                        result += "marker-start='url(#markerTriangle_" + shpId + ")' ";
                    }
                    if (tailEndNodeAttrs !== undefined && (tailEndNodeAttrs["type"] === "triangle" || tailEndNodeAttrs["type"] === "arrow")) {
                        result += "marker-end='url(#markerTriangle_" + shpId + ")' ";
                    }
                    result += "/>";

                }

                result += "</svg>";

                result += "<div class='block content " + getVerticalAlign(node, slideLayoutSpNode, slideMasterSpNode, type) +
                    "' _id='" + id + "' _idx='" + idx + "' _type='" + type + "' _name='" + name +
                    "' style='" +
                    getPosition(slideXfrmNode, slideLayoutXfrmNode, slideMasterXfrmNode) +
                    getSize(slideXfrmNode, slideLayoutXfrmNode, slideMasterXfrmNode) +
                    " z-index: " + order + ";" +
                    "transform: rotate(" + txtRotate + "deg);" +
                    "'>";

                // TextBody
                if (node["p:txBody"] !== undefined) {
                    result += genTextBody(node["p:txBody"], node, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                }
                result += "</div>";

                // result = "";
            } else {

                result += "<div class='block content " + getVerticalAlign(node, slideLayoutSpNode, slideMasterSpNode, type) +
                    "' _id='" + id + "' _idx='" + idx + "' _type='" + type + "' _name='" + name +
                    "' style='" +
                    getPosition(slideXfrmNode, slideLayoutXfrmNode, slideMasterXfrmNode) +
                    getSize(slideXfrmNode, slideLayoutXfrmNode, slideMasterXfrmNode) +
                    getBorder(node, false, "shape") +
                    getShapeFill(node, false, warpObj) +
                    " z-index: " + order + ";" +
                    "transform: rotate(" + txtRotate + "deg);" +
                    "'>";

                // TextBody
                if (node["p:txBody"] !== undefined) {
                    result += genTextBody(node["p:txBody"], node, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                }
                result += "</div>";

            }

            return result;
        }
        function shapeStar(adj, starNum) {
            var innerRadius = adj; /*1-100*/
            var outerRadius = 100;//star.outerRadius;
            var numPoints = starNum;/*1-100*/
            var center = Math.max(innerRadius, outerRadius);
            var angle = Math.PI / numPoints;
            var points = [];

            for (var i = 0; i < numPoints * 2; i++) {
                var radius = i & 1 ? innerRadius : outerRadius;
                points.push(center + radius * Math.sin(i * angle));
                points.push(center - radius * Math.cos(i * angle));
            }

            return points;
        }
        function shapePie(H, w, adj1, adj2, isClose) {
            var pieVal = parseInt(adj2);
            var piAngle = parseInt(adj1);
            var size = parseInt(H),
                radius = (size / 2),
                value = pieVal - piAngle;
            if (value < 0) {
                value = 360 + value;
            }
            //console.log("value: ",value)      
            value = Math.min(Math.max(value, 0), 360);

            //calculate x,y coordinates of the point on the circle to draw the arc to. 
            var x = Math.cos((2 * Math.PI) / (360 / value));
            var y = Math.sin((2 * Math.PI) / (360 / value));


            //d is a string that describes the path of the slice.
            var longArc, d, rot;
            if (isClose) {
                longArc = (value <= 180) ? 0 : 1;
                d = "M" + radius + "," + radius + " L" + radius + "," + 0 + " A" + radius + "," + radius + " 0 " + longArc + ",1 " + (radius + y * radius) + "," + (radius - x * radius) + " z";
                rot = "rotate(" + (piAngle - 270) + ", " + radius + ", " + radius + ")";
            } else {
                longArc = (value <= 180) ? 0 : 1;
                var radius1 = radius;
                var radius2 = w / 2;
                d = "M" + radius1 + "," + 0 + " A" + radius2 + "," + radius1 + " 0 " + longArc + ",1 " + (radius2 + y * radius2) + "," + (radius1 - x * radius1);
                rot = "rotate(" + (piAngle + 90) + ", " + radius + ", " + radius + ")";
            }

            return [d, rot];
        }
        function shapeGear(w, h, points) {
            var innerRadius = h;//gear.innerRadius;
            var outerRadius = 1.5 * innerRadius;
            var cx = outerRadius;//Math.max(innerRadius, outerRadius),                   // center x
            cy = outerRadius;//Math.max(innerRadius, outerRadius),                    // center y
            notches = points,//gear.points,                      // num. of notches
                radiusO = outerRadius,                    // outer radius
                radiusI = innerRadius,                    // inner radius
                taperO = 50,                     // outer taper %
                taperI = 35,                     // inner taper %

                // pre-calculate values for loop

                pi2 = 2 * Math.PI,            // cache 2xPI (360deg)
                angle = pi2 / (notches * 2),    // angle between notches
                taperAI = angle * taperI * 0.005, // inner taper offset (100% = half notch)
                taperAO = angle * taperO * 0.005, // outer taper offset
                a = angle,                  // iterator (angle)
                toggle = false;
            // move to starting point
            var d = " M" + (cx + radiusO * Math.cos(taperAO)) + " " + (cy + radiusO * Math.sin(taperAO));

            // loop
            for (; a <= pi2 + angle; a += angle) {
                // draw inner to outer line
                if (toggle) {
                    d += " L" + (cx + radiusI * Math.cos(a - taperAI)) + "," + (cy + radiusI * Math.sin(a - taperAI));
                    d += " L" + (cx + radiusO * Math.cos(a + taperAO)) + "," + (cy + radiusO * Math.sin(a + taperAO));
                } else { // draw outer to inner line
                    d += " L" + (cx + radiusO * Math.cos(a - taperAO)) + "," + (cy + radiusO * Math.sin(a - taperAO)); // outer line
                    d += " L" + (cx + radiusI * Math.cos(a + taperAI)) + "," + (cy + radiusI * Math.sin(a + taperAI));// inner line

                }
                // switch level
                toggle = !toggle;
            }
            // close the final line
            d += " ";
            return d;
        }
        function shapeArc(cX, cY, rX, rY, stAng, endAng, isClose) {
            var dData;
            var angle = stAng;
            if (endAng >= stAng) {
                while (angle <= endAng) {
                    var radians = angle * (Math.PI / 180);  // convert degree to radians
                    var x = cX + Math.cos(radians) * rX;
                    var y = cY + Math.sin(radians) * rY;
                    if (angle == stAng) {
                        dData = " M" + x + " " + y;
                    }
                    dData += " L" + x + " " + y;
                    angle++;
                }
            } else {
                while (angle > endAng) {
                    var radians = angle * (Math.PI / 180);  // convert degree to radians
                    var x = cX + Math.cos(radians) * rX;
                    var y = cY + Math.sin(radians) * rY;
                    if (angle == stAng) {
                        dData = " M " + x + " " + y;
                    }
                    dData += " L " + x + " " + y;
                    angle--;
                }
            }
            dData += (isClose ? " z" : "");
            return dData;
        }
        function shapeSnipRoundRect(w, h, adj1, adj2, shapeType, adjType) {
            /* 
            shapeType: snip,round
            adjType: cornr1,cornr2,cornrAll,diag
            */
            var adjA, adjB, adjC, adjD;
            if (adjType == "cornr1") {
                adjA = 0;
                adjB = 0;
                adjC = 0;
                adjD = adj1;
            } else if (adjType == "cornr2") {
                adjA = adj1;
                adjB = adj2;
                adjC = adj2;
                adjD = adj1;
            } else if (adjType == "cornrAll") {
                adjA = adj1;
                adjB = adj1;
                adjC = adj1;
                adjD = adj1;
            } else if (adjType == "diag") {
                adjA = adj1;
                adjB = adj2;
                adjC = adj1;
                adjD = adj2;
            }
            //d is a string that describes the path of the slice.
            var d;
            if (shapeType == "round") {
                d = "M0" + "," + (h / 2 + (1 - adjB) * (h / 2)) + " Q" + 0 + "," + h + " " + adjB * (w / 2) + "," + h + " L" + (w / 2 + (1 - adjC) * (w / 2)) + "," + h +
                    " Q" + w + "," + h + " " + w + "," + (h / 2 + (h / 2) * (1 - adjC)) + "L" + w + "," + (h / 2) * adjD +
                    " Q" + w + "," + 0 + " " + (w / 2 + (w / 2) * (1 - adjD)) + ",0 L" + (w / 2) * adjA + ",0" +
                    " Q" + 0 + "," + 0 + " 0," + (h / 2) * (adjA) + " z";
            } else if (shapeType == "snip") {
                d = "M0" + "," + adjA * (h / 2) + " L0" + "," + (h / 2 + (h / 2) * (1 - adjB)) + "L" + adjB * (w / 2) + "," + h +
                    " L" + (w / 2 + (w / 2) * (1 - adjC)) + "," + h + "L" + w + "," + (h / 2 + (h / 2) * (1 - adjC)) +
                    " L" + w + "," + adjD * (h / 2) + "L" + (w / 2 + (w / 2) * (1 - adjD)) + ",0 L" + ((w / 2) * adjA) + ",0 z";
            }
            return d;
        }
        /*
        function shapePolygon(sidesNum) {
            var sides  = sidesNum;
            var radius = 100;
            var angle  = 2 * Math.PI / sides;
            var points = []; 
            
            for (var i = 0; i < sides; i++) {
                points.push(radius + radius * Math.sin(i * angle));
                points.push(radius - radius * Math.cos(i * angle));
            }
            
            return points;
        }
        */
        function processPicNode(node, warpObj) {
            var rtrnData = "";
            var mediaPicFlag = false;
            var order = node["attrs"]["order"];

            var rid = node["p:blipFill"]["a:blip"]["attrs"]["r:embed"];
            var imgName = warpObj["slideResObj"][rid]["target"];
            var imgFileExt = extractFileExtension(imgName).toLowerCase();
            var zip = warpObj["zip"];
            var imgArrayBuffer = zip.file(imgName).asArrayBuffer();
            var mimeType = "";
            var xfrmNode = node["p:spPr"]["a:xfrm"];
            ///////////////////////////////////////Amir//////////////////////////////
            var rotate = 0;
            var rotateNode = getTextByPathList(node, ["p:spPr", "a:xfrm", "attrs", "rot"]);
            if (rotateNode !== undefined) {
                rotate = angleToDegrees(rotateNode);
            }
            //video
            var vdoNode = getTextByPathList(node, ["p:nvPicPr", "p:nvPr", "a:videoFile"]);
            var vdoRid, vdoFile, vdoFileExt, vdoMimeType, uInt8Array, blob, vdoBlob, mediaSupportFlag = false;
            var mediaProcess = settings.mediaProcess;
            if (vdoNode !== undefined & mediaProcess) {
                vdoRid = vdoNode["attrs"]["r:link"];
                vdoFile = warpObj["slideResObj"][vdoRid]["target"];
                uInt8Array = zip.file(vdoFile).asArrayBuffer();
                vdoFileExt = extractFileExtension(vdoFile).toLowerCase();
                if (vdoFileExt == "mp4" || vdoFileExt == "webm" || vdoFileExt == "ogg") {
                    vdoMimeType = getMimeType(vdoFileExt);
                    blob = new Blob([uInt8Array], {
                        type: vdoMimeType
                    });
                    vdoBlob = URL.createObjectURL(blob);
                    mediaSupportFlag = true;
                    mediaPicFlag = true;
                }
            }
            //Audio
            var audioNode = getTextByPathList(node, ["p:nvPicPr", "p:nvPr", "a:audioFile"]);
            var audioRid, audioFile, audioFileExt, audioMimeType, uInt8ArrayAudio, blobAudio, audioBlob;
            var audioPlayerFlag = false;
            var audioObjc;
            if (audioNode !== undefined & mediaProcess) {
                audioRid = audioNode["attrs"]["r:link"];
                audioFile = warpObj["slideResObj"][audioRid]["target"];
                audioFileExt = extractFileExtension(audioFile).toLowerCase();
                if (audioFileExt == "mp3" || audioFileExt == "wav" || audioFileExt == "ogg") {
                    uInt8ArrayAudio = zip.file(audioFile).asArrayBuffer();
                    blobAudio = new Blob([uInt8ArrayAudio]);
                    audioBlob = URL.createObjectURL(blobAudio);
                    var cx = parseInt(xfrmNode["a:ext"]["attrs"]["cx"]) * 20;
                    var cy = xfrmNode["a:ext"]["attrs"]["cy"];
                    var x = parseInt(xfrmNode["a:off"]["attrs"]["x"]) / 2.5;
                    var y = xfrmNode["a:off"]["attrs"]["y"];
                    audioObjc = {
                        "a:ext": {
                            "attrs": {
                                "cx": cx,
                                "cy": cy
                            }
                        },
                        "a:off": {
                            "attrs": {
                                "x": x,
                                "y": y

                            }
                        }
                    }
                    audioPlayerFlag = true;
                    mediaSupportFlag = true;
                    mediaPicFlag = true;
                }
            }
            //console.log(node)
            //////////////////////////////////////////////////////////////////////////
            mimeType = getMimeType(imgFileExt);
            rtrnData = "<div class='block content' style='" +
                ((mediaProcess && audioPlayerFlag) ? getPosition(audioObjc, undefined, undefined) : getPosition(xfrmNode, undefined, undefined)) +
                ((mediaProcess && audioPlayerFlag) ? getSize(audioObjc, undefined, undefined) : getSize(xfrmNode, undefined, undefined)) +
                " z-index: " + order + ";" +
                "transform: rotate(" + rotate + "deg);'>";
            if ((vdoNode === undefined && audioNode === undefined) || !mediaProcess || !mediaSupportFlag) {
                rtrnData += "<img src='data:" + mimeType + ";base64," + base64ArrayBuffer(imgArrayBuffer) + "' style='width: 100%; height: 100%'/>";
            } else if ((vdoNode !== undefined || audioNode !== undefined) && mediaProcess && mediaSupportFlag) {
                if (vdoNode !== undefined) {
                    rtrnData += "<video  src='" + vdoBlob + "' controls style='width: 100%; height: 100%'>Your browser does not support the video tag.</video>";
                }
                if (audioNode !== undefined) {
                    rtrnData += '<audio id="audio_player" controls ><source src="' + audioBlob + '"></audio>';
                    //'<button onclick="audio_player.play()">Play</button>'+
                    //'<button onclick="audio_player.pause()">Pause</button>';
                }
            }
            if (!mediaSupportFlag && mediaPicFlag) {
                rtrnData += "<span style='color:red;font-size:40px;position: absolute;'>This media file Not supported by HTML5</span>";
            }
            if ((vdoNode !== undefined || audioNode !== undefined) && !mediaProcess && mediaSupportFlag) {
                console.log("Founded supported media file but media process disabled (mediaProcess=false)");
            }
            rtrnData += "</div>";
            //console.log(rtrnData)
            return rtrnData;
        }

        function processGraphicFrameNode(node, warpObj) {

            var result = "";
            var graphicTypeUri = getTextByPathList(node, ["a:graphic", "a:graphicData", "attrs", "uri"]);

            switch (graphicTypeUri) {
                case "http://schemas.openxmlformats.org/drawingml/2006/table":
                    result = genTable(node, warpObj);
                    break;
                case "http://schemas.openxmlformats.org/drawingml/2006/chart":
                    result = genChart(node, warpObj);
                    break;
                case "http://schemas.openxmlformats.org/drawingml/2006/diagram":
                    result = genDiagram(node, warpObj);
                    break;
                default:
            }

            return result;
        }

        function processSpPrNode(node, warpObj) {

            /*
            * 2241 <xsd:complexType name="CT_ShapeProperties">
            * 2242   <xsd:sequence>
            * 2243     <xsd:element name="xfrm" type="CT_Transform2D"  minOccurs="0" maxOccurs="1"/>
            * 2244     <xsd:group   ref="EG_Geometry"                  minOccurs="0" maxOccurs="1"/>
            * 2245     <xsd:group   ref="EG_FillProperties"            minOccurs="0" maxOccurs="1"/>
            * 2246     <xsd:element name="ln" type="CT_LineProperties" minOccurs="0" maxOccurs="1"/>
            * 2247     <xsd:group   ref="EG_EffectProperties"          minOccurs="0" maxOccurs="1"/>
            * 2248     <xsd:element name="scene3d" type="CT_Scene3D"   minOccurs="0" maxOccurs="1"/>
            * 2249     <xsd:element name="sp3d" type="CT_Shape3D"      minOccurs="0" maxOccurs="1"/>
            * 2250     <xsd:element name="extLst" type="CT_OfficeArtExtensionList" minOccurs="0" maxOccurs="1"/>
            * 2251   </xsd:sequence>
            * 2252   <xsd:attribute name="bwMode" type="ST_BlackWhiteMode" use="optional"/>
            * 2253 </xsd:complexType>
            */

            // TODO:
        }

        function genTextBody(textBodyNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj) {


            var text = "";
            var slideMasterTextStyles = warpObj["slideMasterTextStyles"];

            if (textBodyNode === undefined) {
                return text;
            }
            //rtl : <p:txBody>
            //          <a:bodyPr wrap="square" rtlCol="1">

            //var rtlStr = "";
            if (textBodyNode["a:p"].constructor === Array) {
                // multi p
                for (var i = 0; i < textBodyNode["a:p"].length; i++) {
                    var pNode = textBodyNode["a:p"][i];
                    var rNode = pNode["a:r"];

                    //var isRTL = getTextDirection(pNode, type, slideMasterTextStyles);
                    //rtlStr = "";//"dir='"+isRTL+"'";

                    text += "<div  class='" + getHorizontalAlign(pNode, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) + "'>";
                    text += genBuChar(pNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);

                    if (rNode === undefined) {
                        // without r
                        text += genSpanElement(pNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                    } else if (rNode.constructor === Array) {
                        // with multi r
                        for (var j = 0; j < rNode.length; j++) {
                            text += genSpanElement(rNode[j], spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                            //////////////////Amir////////////
                            if (pNode["a:br"] !== undefined) {
                                text += "<br>";
                            }
                            //////////////////////////////////                    
                        }
                    } else {
                        // with one r
                        text += genSpanElement(rNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                    }
                    text += "</div>";
                }
            } else {
                // one p
                var pNode = textBodyNode["a:p"];
                var rNode = pNode["a:r"];

                //var isRTL = getTextDirection(pNode, type, slideMasterTextStyles);
                //rtlStr = "";//"dir='"+isRTL+"'";

                text += "<div class='slide-prgrph " + getHorizontalAlign(pNode, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) + "'>";
                text += genBuChar(pNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                if (rNode === undefined) {
                    // without r
                    text += genSpanElement(pNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                } else if (rNode.constructor === Array) {
                    // with multi r
                    for (var j = 0; j < rNode.length; j++) {
                        text += genSpanElement(rNode[j], spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                        //////////////////Amir////////////
                        if (pNode["a:br"] !== undefined) {
                            text += "<br>";
                        }
                        //////////////////////////////////
                    }
                } else {
                    // with one r
                    text += genSpanElement(rNode, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj);
                }
                text += "</div>";
            }

            return text;
        }

        function genBuChar(node, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj) {
            ///////////////////////////////////////Amir///////////////////////////////
            var sldMstrTxtStyles = warpObj["slideMasterTextStyles"];

            var rNode = getTextByPathList(node, ["a:r"]);
            if (rNode !== undefined && rNode.constructor === Array) {
                rNode = rNode[0];
            }
            var dfltBultColor, dfltBultSize, bultColor, bultSize;
            if (rNode !== undefined) {
                dfltBultColor = getFontColorPr(rNode, spNode, type, sldMstrTxtStyles)[0];
                dfltBultSize = getFontSize(rNode, slideLayoutSpNode, slideMasterSpNode, type, sldMstrTxtStyles);
            } else {
                dfltBultColor = getFontColorPr(node, spNode, type, sldMstrTxtStyles)[0];
                dfltBultSize = getFontSize(node, slideLayoutSpNode, slideMasterSpNode, type, sldMstrTxtStyles);
            }
            //console.log("Bullet Size: " + bultSize);

            var bullet = "";
            /////////////////////////////////////////////////////////////////


            var pPrNode = node["a:pPr"];

            //////////////////cheke if is rtl ///Amir ////////////////////////////////////
            var getRtlVal = getTextByPathList(pPrNode, ["attrs", "rtl"])
            var isRTL = false;
            if (getRtlVal !== undefined && getRtlVal == "1") {
                isRTL = true;
            }
            ////////////////////////////////////////////////////////////

            var lvl = parseInt(getTextByPathList(pPrNode, ["attrs", "lvl"]));
            if (isNaN(lvl)) {
                lvl = 0;
            }

            var buChar = getTextByPathList(pPrNode, ["a:buChar", "attrs", "char"]);
            /////////////////////////////////Amir///////////////////////////////////
            var buType = "TYPE_NONE";
            var buNum = getTextByPathList(pPrNode, ["a:buAutoNum", "attrs", "type"]);
            var buPic = getTextByPathList(pPrNode, ["a:buBlip"]);
            if (buChar !== undefined) {
                buType = "TYPE_BULLET";
                // console.log("Bullet Chr to code: " + buChar.charCodeAt(0));
            }
            if (buNum !== undefined) {
                buType = "TYPE_NUMERIC";
            }
            if (buPic !== undefined) {
                buType = "TYPE_BULPIC";
            }

            if (buType != "TYPE_NONE") {
                var buFontAttrs = getTextByPathList(pPrNode, ["a:buFont", "attrs"]);
            }
            //console.log("Bullet Type: " + buType);
            //console.log("NumericTypr: " + buNum);
            //console.log("buChar: " + (buChar === undefined?'':buChar.charCodeAt(0)));
            //get definde bullet COLOR
            var buClrNode = getTextByPathList(pPrNode, ["a:buClr"]);
            var defBultColor = "NoNe";
            if (buClrNode !== undefined) {
                defBultColor = getSolidFill(buClrNode);
            } else {
                // console.log("buClrNode: " + buClrNode);
            }

            if (defBultColor == "NoNe") {
                bultColor = dfltBultColor;
            } else {
                bultColor = "#" + defBultColor;
            }
            //get definde bullet SIZE
            var buFontSize;
            buFontSize = getTextByPathList(pPrNode, ["a:buSzPts", "attrs", "val"]); //pt
            if (buFontSize !== undefined) {
                bultSize = parseInt(buFontSize) / 100 + "pt";
            } else {
                buFontSize = getTextByPathList(pPrNode, ["a:buSzPct", "attrs", "val"]);
                if (buFontSize !== undefined) {
                    var prcnt = parseInt(buFontSize) / 100000;
                    //dfltBultSize = XXpt
                    var dfltBultSizeNoPt = dfltBultSize.substr(0, dfltBultSize.length - 2);
                    bultSize = prcnt * (parseInt(dfltBultSizeNoPt)) + "pt";
                } else {
                    bultSize = dfltBultSize;
                }
            }
            ////////////////////////////////////////////////////////////////////////
            if (buType == "TYPE_BULLET") {
                //var buFontAttrs = getTextByPathList(pPrNode, ["a:buFont", "attrs"]);
                if (buFontAttrs !== undefined) {
                    var marginLeft = parseInt(getTextByPathList(pPrNode, ["attrs", "marL"])) * 96 / 914400;
                    var marginRight = parseInt(buFontAttrs["pitchFamily"]);
                    if (isNaN(marginLeft)) {
                        marginLeft = 328600 * 96 / 914400;
                    }
                    if (isNaN(marginRight)) {
                        marginRight = 0;
                    }
                    var typeface = buFontAttrs["typeface"];

                    bullet = "<span style='font-family: " + typeface +
                        "; margin-left: " + marginLeft * lvl + "px" +
                        "; margin-right: " + marginRight + "px" +
                        ";color:" + bultColor +
                        ";font-size:" + bultSize + ";";
                    if (isRTL) {
                        bullet += " float: right;  direction:rtl";
                    }
                    bullet += "'>" + buChar + "</span>";
                } else {
                    marginLeft = 328600 * 96 / 914400 * lvl;

                    bullet = "<span style='margin-left: " + marginLeft + "px;'>" + buChar + "</span>";
                }
            } else if (buType == "TYPE_NUMERIC") { ///////////Amir///////////////////////////////
                if (buFontAttrs !== undefined) {
                    var marginLeft = parseInt(getTextByPathList(pPrNode, ["attrs", "marL"])) * 96 / 914400;
                    var marginRight = parseInt(buFontAttrs["pitchFamily"]);

                    if (isNaN(marginLeft)) {
                        marginLeft = 328600 * 96 / 914400;
                    }
                    if (isNaN(marginRight)) {
                        marginRight = 0;
                    }
                    //var typeface = buFontAttrs["typeface"];

                    bullet = "<span style='margin-left: " + marginLeft * lvl + "px" +
                        "; margin-right: " + marginRight + "px" +
                        ";color:" + bultColor +
                        ";font-size:" + bultSize + ";";
                    if (isRTL) {
                        bullet += " float: right; direction:rtl;";
                    } else {
                        bullet += " float: left; direction:ltr;";
                    }
                    bullet += "' data-bulltname = '" + buNum + "' data-bulltlvl = '" + lvl + "' class='numeric-bullet-style'></span>";
                } else {
                    marginLeft = 328600 * 96 / 914400 * lvl;
                    bullet = "<span style='margin-left: " + marginLeft + "px;";
                    if (isRTL) {
                        bullet += " float: right; direction:rtl;";
                    } else {
                        bullet += " float: left; direction:ltr;";
                    }
                    bullet += "' data-bulltname = '" + buNum + "' data-bulltlvl = '" + lvl + "' class='numeric-bullet-style'></span>";
                }

            } else if (buType == "TYPE_BULPIC") { //PIC BULLET
                var marginLeft = parseInt(getTextByPathList(pPrNode, ["attrs", "marL"])) * 96 / 914400;
                var marginRight = parseInt(getTextByPathList(pPrNode, ["attrs", "marR"])) * 96 / 914400;

                if (isNaN(marginRight)) {
                    marginRight = 0;
                }
                //console.log("marginRight: "+marginRight)
                //buPic
                if (isNaN(marginLeft)) {
                    marginLeft = 328600 * 96 / 914400;
                } else {
                    marginLeft = 0;
                }
                //var buPicId = getTextByPathList(buPic, ["a:blip","a:extLst","a:ext","asvg:svgBlip" , "attrs", "r:embed"]);
                var buPicId = getTextByPathList(buPic, ["a:blip", "attrs", "r:embed"]);
                var svgPicPath = "";
                var buImg;
                if (buPicId !== undefined) {
                    //svgPicPath = warpObj["slideResObj"][buPicId]["target"];
                    //buImg = warpObj["zip"].file(svgPicPath).asText();
                    //}else{
                    //buPicId = getTextByPathList(buPic, ["a:blip", "attrs", "r:embed"]);
                    var imgPath = warpObj["slideResObj"][buPicId]["target"];
                    //console.log("imgPath: ", imgPath);
                    var imgArrayBuffer = warpObj["zip"].file(imgPath).asArrayBuffer();
                    var imgExt = imgPath.split(".").pop();
                    var imgMimeType = getMimeType(imgExt);
                    buImg = "<img src='data:" + imgMimeType + ";base64," + base64ArrayBuffer(imgArrayBuffer) + "' style='width: 100%; height: 100%'/>"
                    //console.log("imgPath: "+imgPath+"\nimgMimeType: "+imgMimeType)
                }
                if (buPicId === undefined) {
                    buImg = "&#8227;";
                }
                bullet = "<span style='margin-left: " + marginLeft * lvl + "px" +
                    "; margin-right: " + marginRight + "px" +
                    ";width:" + bultSize + ";display: inline-block; ";
                if (isRTL) {
                    bullet += " float: right;direction:rtl";
                }
                bullet += "'>" + buImg + "  </span>";
                //////////////////////////////////////////////////////////////////////////////////////
            } else {
                bullet = "<span style='margin-left: " + 328600 * 96 / 914400 * lvl + "px" +
                    "; margin-right: " + 0 + "px;'></span>";
            }

            return bullet;
        }

        function genSpanElement(node, spNode, slideLayoutSpNode, slideMasterSpNode, type, warpObj) {

            var slideMasterTextStyles = warpObj["slideMasterTextStyles"];

            var text = node["a:t"];
            if (typeof text !== 'string') {
                text = getTextByPathList(node, ["a:fld", "a:t"]);
                if (typeof text !== 'string') {
                    text = "&nbsp;";
                }
            }
            //console.log("genSpanElement: ",node)
            //getFontColor
            var fontClrPr = getFontColorPr(node, spNode, type, slideMasterTextStyles);
            var styleText =
                "color:" + fontClrPr[0] + ";" +
                "text-shadow:" + fontClrPr[1] + ";" +
                "font-size:" + getFontSize(node, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) + ";" +
                "font-family:" + getFontType(node, type, slideMasterTextStyles) + ";" +
                "font-weight:" + getFontBold(node, type, slideMasterTextStyles) + ";" +
                "font-style:" + getFontItalic(node, type, slideMasterTextStyles) + ";" +
                "text-decoration:" + getFontDecoration(node, type, slideMasterTextStyles) + ";" +
                "text-align:" + getTextHorizontalAlign(node, type, slideMasterTextStyles) + ";" +
                "vertical-align:" + getTextVerticalAlign(node, type, slideMasterTextStyles) + ";";
            //////////////////Amir///////////////
            var highlight = getTextByPathList(node, ["a:rPr", "a:highlight"]);
            if (highlight !== undefined) {
                styleText += "background-color:#" + getSolidFill(highlight) + ";";
                styleText += "Opacity:" + getColorOpacity(highlight) + ";";
            }
            ///////////////////////////////////////////
            var cssName = "";

            if (styleText in styleTable) {
                cssName = styleTable[styleText]["name"];
            } else {
                cssName = "_css_" + (Object.keys(styleTable).length + 1);
                styleTable[styleText] = {
                    "name": cssName,
                    "text": styleText
                };
            }

            var linkID = getTextByPathList(node, ["a:rPr", "a:hlinkClick", "attrs", "r:id"]);
            //get link colors : TODO
            if (linkID !== undefined) {
                var linkURL = warpObj["slideResObj"][linkID]["target"];
                linkURL = escapeHtml(linkURL);
                return "<span class='text-block " + cssName + "'><a href='" + linkURL + "' target='_blank'>" + text.replace(/\s/i, "&nbsp;") + "</a></span>";
            } else {
                return "<span class='text-block " + cssName + "'>" + text.replace(/\s/i, "&nbsp;") + "</span>";
            }

        }

        function genGlobalCSS() {
            var cssText = "";
            for (var key in styleTable) {
                cssText += "div ." + styleTable[key]["name"] + "{" + styleTable[key]["text"] + "}\n"; //section > div
            }
            return cssText;
        }

        function genTable(node, warpObj) {

            var order = node["attrs"]["order"];
            var tableNode = getTextByPathList(node, ["a:graphic", "a:graphicData", "a:tbl"]);
            var xfrmNode = getTextByPathList(node, ["p:xfrm"]);
            /////////////////////////////////////////Amir////////////////////////////////////////////////
            var getTblPr = getTextByPathList(node, ["a:graphic", "a:graphicData", "a:tbl", "a:tblPr"]);
            var getColsGrid = getTextByPathList(node, ["a:graphic", "a:graphicData", "a:tbl", "a:tblGrid", "a:gridCol"]);
            var tblDir = "";
            if (getTblPr !== undefined) {
                var isRTL = getTblPr["attrs"]["rtl"];
                tblDir = (isRTL == 1 ? "dir=rtl" : "dir=ltr");
            }
            var firstRowAttr = getTblPr["attrs"]["firstRow"]; //associated element <a:firstRow> in the table styles
            var firstColAttr = getTblPr["attrs"]["firstCol"]; //associated element <a:firstCol> in the table styles
            var lastRowAttr = getTblPr["attrs"]["lastRow"]; //associated element <a:lastRow> in the table styles
            var lastColAttr = getTblPr["attrs"]["lastCol"]; //associated element <a:lastCol> in the table styles
            var bandRowAttr = getTblPr["attrs"]["bandRow"]; //associated element <a:band1H>, <a:band2H> in the table styles
            var bandColAttr = getTblPr["attrs"]["bandCol"]; //associated element <a:band1V>, <a:band2V> in the table styles
            //console.log(firstColAttr);
            ////////////////////////////////////////////////////////////////////////////////////////////
            var tableHtml = "<table " + tblDir + " style='border-collapse: collapse;" + getPosition(xfrmNode, undefined, undefined) + getSize(xfrmNode, undefined, undefined) + " z-index: " + order + ";'>";

            var trNodes = tableNode["a:tr"];
            if (trNodes.constructor === Array) {
                for (var i = 0; i < trNodes.length; i++) {
                    //////////////rows Style ////////////Amir
                    var rowHeightParam = trNodes[i]["attrs"]["h"];
                    var rowHeight = 0;
                    var rowsStyl = "";
                    if (rowHeightParam !== undefined) {
                        rowHeight = parseInt(rowHeightParam) * 96 / 914400;
                        rowsStyl += "height:" + rowHeight + "px;";
                        //tableHtml += "<tr style='height:"+rowHeight+"px;'>";
                    }

                    //get from Theme (tableStyles.xml) TODO 
                    //get tableStyleId = a:tbl => a:tblPr => a:tableStyleId
                    var thisTblStyle;
                    var tbleStyleId = getTblPr["a:tableStyleId"];
                    if (tbleStyleId !== undefined) {
                        //get Style from tableStyles.xml by {var tbleStyleId}
                        //table style object : tableStyles
                        var tbleStylList = tableStyles["a:tblStyleLst"]["a:tblStyle"];
                        if (tbleStylList.constructor === Array) {
                            for (var k = 0; k < tbleStylList.length; k++) {
                                if (tbleStylList[k]["attrs"]["styleId"] == tbleStyleId) {
                                    thisTblStyle = tbleStylList[k];
                                }
                            }
                        } else {
                            if (tbleStylList["attrs"]["styleId"] == tbleStyleId) {
                                thisTblStyle = tbleStylList;
                            }
                        }
                    }
                    //console.log(thisTblStyle);
                    if (i == 0 && firstRowAttr !== undefined) {
                        var fillColor = "fff";
                        var colorOpacity = 1;
                        if (thisTblStyle["a:firstRow"] !== undefined) {
                            var bgFillschemeClr = getTextByPathList(thisTblStyle, ["a:firstRow", "a:tcStyle", "a:fill", "a:solidFill"]);
                            if (bgFillschemeClr !== undefined) {
                                fillColor = getSolidFill(bgFillschemeClr);
                                colorOpacity = getColorOpacity(bgFillschemeClr);
                            }
                            //console.log(thisTblStyle["a:firstRow"])

                            //borders color
                            //borders Width
                            var borderStyl = getTextByPathList(thisTblStyle, ["a:firstRow", "a:tcStyle", "a:tcBdr"]);
                            if (borderStyl !== undefined) {
                                var row_borders = getTableBorders(borderStyl);
                                rowsStyl += row_borders;
                            }
                            //console.log(thisTblStyle["a:firstRow"])

                            //Text Style - TODO
                            var rowTxtStyl = getTextByPathList(thisTblStyle, ["a:firstRow", "a:tcTxStyle"]);
                            if (rowTxtStyl !== undefined) {
                                /*
                            var fontClrPr = getFontColorPr(node, spNode, type, slideMasterTextStyles);
                            var styleText = 
                                "color:" + fontClrPr[0] + ";" +
                                "text-shadow:" + fontClrPr[1] + ";" +
                                "font-size:" + getFontSize(node, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) + ";" + 
                                "font-family:" + getFontType(node, type, slideMasterTextStyles) + ";" + 
                                "font-weight:" + getFontBold(node, type, slideMasterTextStyles) + ";" +
                                "font-style:" + getFontItalic(node, type, slideMasterTextStyles) + ";" +
                                "text-decoration:" + getFontDecoration(node, type, slideMasterTextStyles) + ";" +
                                "text-align:" + getTextHorizontalAlign(node, type, slideMasterTextStyles) + ";" +
                                "vertical-align:" + getTextVerticalAlign(node, type, slideMasterTextStyles) + ";";
                                */
                            }

                        }
                        rowsStyl += " background-color:#" + fillColor + ";" +
                            " opacity:" + colorOpacity + ";";

                    } else if (i > 0 && bandRowAttr !== undefined) {
                        var fillColor = "fff";
                        var colorOpacity = 1;
                        if ((i % 2) == 0) {
                            if (thisTblStyle["a:band2H"] !== undefined) {
                                //console.log(thisTblStyle["a:band2H"]);
                                var bgFillschemeClr = getTextByPathList(thisTblStyle, ["a:band2H", "a:tcStyle", "a:fill", "a:solidFill"]);
                                if (bgFillschemeClr !== undefined) {
                                    fillColor = getSolidFill(bgFillschemeClr);
                                    colorOpacity = getColorOpacity(bgFillschemeClr);
                                }
                                //borders color
                                //borders Width
                                var borderStyl = getTextByPathList(thisTblStyle, ["a:band2H", "a:tcStyle", "a:tcBdr"]);
                                if (borderStyl !== undefined) {
                                    var row_borders = getTableBorders(borderStyl);
                                    rowsStyl += row_borders;
                                }
                                //console.log(thisTblStyle["a:band2H"])

                                //Text Style - TODO
                                var rowTxtStyl = getTextByPathList(thisTblStyle, ["a:band2H", "a:tcTxStyle"]);
                                if (rowTxtStyl !== undefined) {

                                }
                                //console.log(i,thisTblStyle)
                            }/*else{
                                var bgFillschemeClr = thisTblStyle["a:wholeTbl"]["a:tcStyle"]["a:fill"]["a:solidFill"];
                                if(bgFillschemeClr !==undefined){
                                    fillColor = getSolidFill(bgFillschemeClr);
                                    colorOpacity = getColorOpacity(bgFillschemeClr);
                                }
                                //borders color
                                //borders Width
                                var borderStyl = thisTblStyle["a:wholeTbl"]["a:tcStyle"]["a:tcBdr"];
                                if(borderStyl !== undefined){
                                    var row_borders = getTableBorders(borderStyl);
                                    rowsStyl += row_borders;
                                }
                                //console.log(thisTblStyle["a:wholeTbl"])
                                
                                //Text Style - TODO
                                var rowTxtStyl = thisTblStyle["a:wholeTbl"]["a:tcTxStyle"];
                                if(rowTxtStyl !== undefined){
                                    
                                }                        
                            }*/
                        } else {
                            if (thisTblStyle["a:band1H"] !== undefined) {
                                var bgFillschemeClr = getTextByPathList(thisTblStyle, ["a:band1H", "a:tcStyle", "a:fill", "a:solidFill"]);
                                if (bgFillschemeClr !== undefined) {
                                    fillColor = getSolidFill(bgFillschemeClr);
                                    colorOpacity = getColorOpacity(bgFillschemeClr);
                                }
                                //borders color
                                //borders Width
                                var borderStyl = getTextByPathList(thisTblStyle, ["a:band1H", "a:tcStyle", "a:tcBdr"]);
                                if (borderStyl !== undefined) {
                                    var row_borders = getTableBorders(borderStyl);
                                    rowsStyl += row_borders;
                                }
                                //console.log(thisTblStyle["a:band1H"])

                                //Text Style - TODO
                                var rowTxtStyl = getTextByPathList(thisTblStyle, ["a:band1H", "a:tcTxStyle"]);
                                if (rowTxtStyl !== undefined) {

                                }
                            }
                        }
                        rowsStyl += " background-color:#" + fillColor + ";" +
                            " opacity:" + colorOpacity + ";";
                    }
                    tableHtml += "<tr style='" + rowsStyl + "'>";
                    ////////////////////////////////////////////////

                    var tcNodes = trNodes[i]["a:tc"];

                    if (tcNodes.constructor === Array) {
                        for (var j = 0; j < tcNodes.length; j++) {
                            var text = genTextBody(tcNodes[j]["a:txBody"], node, undefined, undefined, undefined, warpObj);
                            var rowSpan = getTextByPathList(tcNodes[j], ["attrs", "rowSpan"]);
                            var colSpan = getTextByPathList(tcNodes[j], ["attrs", "gridSpan"]);
                            var vMerge = getTextByPathList(tcNodes[j], ["attrs", "vMerge"]);
                            var hMerge = getTextByPathList(tcNodes[j], ["attrs", "hMerge"]);
                            //Cells Style : TODO /////////////Amir
                            //console.log(tcNodes[j]);
                            //if(j==0 && ())
                            var colWidthParam = getColsGrid[j]["attrs"]["w"];
                            var colStyl = "";
                            if (colWidthParam !== undefined) {
                                var colWidth = parseInt(colWidthParam) * 96 / 914400;
                                colStyl += "width:" + colWidth + "px;"
                            }
                            var getFill = tcNodes[j]["a:tcPr"]["a:solidFill"];
                            var fillColor = "";
                            var colorOpacity = 1;
                            if (getFill !== undefined) {
                                //console.log(getFill);
                                fillColor = getSolidFill(getFill);
                                colorOpacity = getColorOpacity(getFill);
                            } else {
                                //get from Theme (tableStyles.xml) TODO 
                                //get tableStyleId = a:tbl => a:tblPr => a:tableStyleId
                                var tbleStyleId = getTblPr["a:tableStyleId"];
                                if (tbleStyleId !== undefined) {
                                    //get Style from tableStyles.xml by {var tbleStyleId}
                                    //table style object : tableStyles
                                    var tbleStylList = tableStyles["a:tblStyleLst"]["a:tblStyle"];

                                    for (var k = 0; k < tbleStylList.length; k++) {
                                        if (tbleStylList[k]["attrs"]["styleId"] == tbleStyleId) {
                                            //console.log(tbleStylList[k]);
                                        }
                                    }
                                }
                                //console.log(tbleStyleId);
                            }
                            if (fillColor != "") {
                                colStyl += " background-color:#" + fillColor + ";";
                                colStyl += " opacity" + colorOpacity + ";";
                            }
                            //console.log(fillColor);
                            ////////////////////////////////////


                            if (rowSpan !== undefined) {
                                tableHtml += "<td rowspan='" + parseInt(rowSpan) + "' style='" + colStyl + "'>" + text + "</td>";
                            } else if (colSpan !== undefined) {
                                tableHtml += "<td colspan='" + parseInt(colSpan) + "' style='" + colStyl + "'>" + text + "</td>";
                            } else if (vMerge === undefined && hMerge === undefined) {
                                tableHtml += "<td style='" + colStyl + "'>" + text + "</td>";
                            }
                        }
                    } else {
                        var text = genTextBody(tcNodes["a:txBody"]);
                        //Cells Style : TODO /////////////Amir
                        var colWidthParam = getColsGrid[0]["attrs"]["w"];
                        var colStyl = "";
                        if (colWidthParam !== undefined) {
                            var colWidth = parseInt(colWidthParam) * 96 / 914400;
                            colStyl += "width:" + colWidth + "px;"
                        }
                        var getFill = tcNodes["a:tcPr"]["a:solidFill"];
                        var fillColor = "";
                        var colorOpacity = 1;
                        if (getFill !== undefined) {
                            //console.log(getFill);   
                            fillColor = getSolidFill(getFill);
                            colorOpacity = getColorOpacity(getFill);
                        } else {
                            //get from Theme TODO
                        }
                        if (fillColor != "") {
                            colStyl += " background-color:#" + fillColor + ";"
                            colStyl += " opacity" + colorOpacity + ";";
                        }
                        ////////////////////////////////////
                        tableHtml += "<td style='" + colStyl + "'>" + text + "</td>";
                    }
                    tableHtml += "</tr>";
                }
            } else {
                //////////////row height ////////////Amir
                var rowHeightParam = trNodes["attrs"]["h"];
                var rowHeight = 0;
                if (rowHeightParam !== undefined) {
                    rowHeight = parseInt(rowHeightParam) * 96 / 914400;
                    tableHtml += "<tr style='height:" + rowHeight + "px;'>";
                } else {
                    tableHtml += "<tr>";
                }
                ////////////////////////////////////////////////
                var tcNodes = trNodes["a:tc"];
                if (tcNodes.constructor === Array) {
                    for (var j = 0; j < tcNodes.length; j++) {
                        var text = genTextBody(tcNodes[j]["a:txBody"]);
                        //Cells Style : TODO /////////////Amir
                        var colWidthParam = getColsGrid[j]["attrs"]["w"];
                        var colStyl = "";
                        if (colWidthParam !== undefined) {
                            var colWidth = parseInt(colWidthParam) * 96 / 914400;
                            colStyl += "width:" + colWidth + "px;"
                        }
                        var getFill = tcNodes[j]["a:tcPr"]["a:solidFill"];
                        var fillColor = "";
                        var colorOpacity = 1;
                        if (getFill !== undefined) {
                            fillColor = getSolidFill(getFill);
                            colorOpacity = getColorOpacity(getFill);
                        } else {
                            //get from Theme TODO
                            //get tableStyleId
                            // a:tbl => a:tblPr => a:tableStyleId
                        }
                        if (fillColor != "") {
                            colStyl += " background-color:#" + fillColor + ";"
                            colStyl += " opacity" + colorOpacity + ";";
                        }
                        ////////////////////////////////////
                        tableHtml += "<td style='" + colStyl + "'>" + text + "</td>";
                    }
                } else {
                    var text = genTextBody(tcNodes["a:txBody"]);
                    //Cells Style : TODO /////////////Amir
                    var colWidthParam = getColsGrid[0]["attrs"]["w"];
                    var colStyl = "";
                    if (colWidthParam !== undefined) {
                        var colWidth = parseInt(colWidthParam) * 96 / 914400;
                        colStyl += "width:" + colWidth + "px;"
                    }
                    var getFill = tcNodes[j]["a:tcPr"]["a:solidFill"];
                    var fillColor = "";
                    var colorOpacity = 1;
                    if (getFill !== undefined) {
                        //console.log(getFill);
                        fillColor = getSolidFill(getFill);
                        colorOpacity = getColorOpacity(getFill);
                    } else {
                        //get from Theme TODO
                    }
                    if (fillColor != "") {
                        colStyl += " background-color:#" + fillColor + ";"
                        colStyl += " opacity" + colorOpacity + ";";
                    }
                    ////////////////////////////////////
                    tableHtml += "<td style='" + colStyl + "'>" + text + "</td>";
                }
                tableHtml += "</tr>";
            }

            return tableHtml;
        }

        function genChart(node, warpObj) {

            var order = node["attrs"]["order"];
            var xfrmNode = getTextByPathList(node, ["p:xfrm"]);
            var result = "<div id='chart" + chartID + "' class='block content' style='" +
                getPosition(xfrmNode, undefined, undefined) + getSize(xfrmNode, undefined, undefined) +
                " z-index: " + order + ";'></div>";

            var rid = node["a:graphic"]["a:graphicData"]["c:chart"]["attrs"]["r:id"];
            var refName = warpObj["slideResObj"][rid]["target"];
            var content = readXmlFile(warpObj["zip"], refName);
            var plotArea = getTextByPathList(content, ["c:chartSpace", "c:chart", "c:plotArea"]);

            var chartData = null;
            for (var key in plotArea) {
                switch (key) {
                    case "c:lineChart":
                        chartData = {
                            "type": "createChart",
                            "data": {
                                "chartID": "chart" + chartID,
                                "chartType": "lineChart",
                                "chartData": extractChartData(plotArea[key]["c:ser"])
                            }
                        };
                        break;
                    case "c:barChart":
                        chartData = {
                            "type": "createChart",
                            "data": {
                                "chartID": "chart" + chartID,
                                "chartType": "barChart",
                                "chartData": extractChartData(plotArea[key]["c:ser"])
                            }
                        };
                        break;
                    case "c:pieChart":
                        chartData = {
                            "type": "createChart",
                            "data": {
                                "chartID": "chart" + chartID,
                                "chartType": "pieChart",
                                "chartData": extractChartData(plotArea[key]["c:ser"])
                            }
                        };
                        break;
                    case "c:pie3DChart":
                        chartData = {
                            "type": "createChart",
                            "data": {
                                "chartID": "chart" + chartID,
                                "chartType": "pie3DChart",
                                "chartData": extractChartData(plotArea[key]["c:ser"])
                            }
                        };
                        break;
                    case "c:areaChart":
                        chartData = {
                            "type": "createChart",
                            "data": {
                                "chartID": "chart" + chartID,
                                "chartType": "areaChart",
                                "chartData": extractChartData(plotArea[key]["c:ser"])
                            }
                        };
                        break;
                    case "c:scatterChart":
                        chartData = {
                            "type": "createChart",
                            "data": {
                                "chartID": "chart" + chartID,
                                "chartType": "scatterChart",
                                "chartData": extractChartData(plotArea[key]["c:ser"])
                            }
                        };
                        break;
                    case "c:catAx":
                        break;
                    case "c:valAx":
                        break;
                    default:
                }
            }

            if (chartData !== null) {
                MsgQueue.push(chartData);
            }

            chartID++;
            return result;
        }

        function genDiagram(node, warpObj) {
            //console.log(warpObj)
            //readXmlFile(zip, sldFileName)
            /**files define the diagram:
             * 1-colors#.xml,
             * 2-data#.xml, 
             * 3-layout#.xml,
             * 4-quickStyle#.xml.
             * 5-drawing#.xml, which Microsoft added as an extension for persisting diagram layout information.
             */
            ///get colors#.xml, data#.xml , layout#.xml , quickStyle#.xml
            var order = node["attrs"]["order"];
            var zip = warpObj["zip"];
            var xfrmNode = getTextByPathList(node, ["p:xfrm"]);
            var dgmRelIds = getTextByPathList(node, ["a:graphic", "a:graphicData", "dgm:relIds", "attrs"]);
            //console.log(dgmRelIds)
            var dgmClrFileId = dgmRelIds["r:cs"];
            var dgmDataFileId = dgmRelIds["r:dm"];
            var dgmLayoutFileId = dgmRelIds["r:lo"];
            var dgmQuickStyleFileId = dgmRelIds["r:qs"];
            var dgmClrFileName = warpObj["slideResObj"][dgmClrFileId].target,
                dgmDataFileName = warpObj["slideResObj"][dgmDataFileId].target,
                dgmLayoutFileName = warpObj["slideResObj"][dgmLayoutFileId].target;
            dgmQuickStyleFileName = warpObj["slideResObj"][dgmQuickStyleFileId].target;
            //console.log(dgmClrFileName,"\n",dgmDataFileName,"\n",dgmLayoutFileName,"\n",dgmQuickStyleFileName);
            var dgmClr = readXmlFile(zip, dgmClrFileName);
            var dgmData = readXmlFile(zip, dgmDataFileName);
            var dgmLayout = readXmlFile(zip, dgmLayoutFileName);
            var dgmQuickStyle = readXmlFile(zip, dgmQuickStyleFileName);
            //console.log(dgmClr,dgmData,dgmLayout,dgmQuickStyle)
            ///get drawing#.xml
            var dgmDrwFileName = "";
            var dataModelExt = getTextByPathList(dgmData, ["dgm:dataModel", "dgm:extLst", "a:ext", "dsp:dataModelExt", "attrs"]);
            if (dataModelExt !== undefined) {
                var dgmDrwFileId = dataModelExt["relId"];
                dgmDrwFileName = warpObj["slideResObj"][dgmDrwFileId]["target"];
            }
            //console.log("dgmDrwFileName: ",dgmDrwFileName);
            var dgmDrwFile = "";
            if (dgmDrwFileName != "") {
                dgmDrwFile = readXmlFile(zip, dgmDrwFileName);
            }
            //console.log("dgmDrwFile: ",dgmDrwFile);
            //processSpNode(node, warpObj)
            var dgmDrwSpArray = getTextByPathList(dgmDrwFile, ["dsp:drawing", "dsp:spTree", "dsp:sp"]);
            var rslt = "";
            if (dgmDrwSpArray !== undefined) {
                var dgmDrwSpArrayLen = dgmDrwSpArray.length;
                for (var i = 0; i < dgmDrwSpArrayLen; i++) {
                    var dspSp = dgmDrwSpArray[i];
                    var dspSpObjToStr = JSON.stringify(dspSp);
                    var pSpStr = dspSpObjToStr.replace(/dsp:/g, "p:");
                    var pSpStrToObj = JSON.parse(pSpStr);
                    //console.log("pSpStrToObj["+i+"]: ",pSpStrToObj);
                    rslt += processSpNode(pSpStrToObj, warpObj)
                    //console.log("rslt["+i+"]: ",rslt);
                }
                // dgmDrwFile: "dsp:"-> "p:"
            }

            return "<div class='block content' style='" +
                getPosition(xfrmNode, undefined, undefined) +
                getSize(xfrmNode, undefined, undefined) +
                "'>" + rslt + "</div>";
        }

        function getPosition(slideSpNode, slideLayoutSpNode, slideMasterSpNode) {

            var off = undefined;
            var x = -1, y = -1;

            if (slideSpNode !== undefined) {
                off = slideSpNode["a:off"]["attrs"];
            } else if (slideLayoutSpNode !== undefined) {
                off = slideLayoutSpNode["a:off"]["attrs"];
            } else if (slideMasterSpNode !== undefined) {
                off = slideMasterSpNode["a:off"]["attrs"];
            }

            if (off === undefined) {
                return "";
            } else {
                x = parseInt(off["x"]) * 96 / 914400;
                y = parseInt(off["y"]) * 96 / 914400;
                return (isNaN(x) || isNaN(y)) ? "" : "top:" + y + "px; left:" + x + "px;";
            }

        }

        function getSize(slideSpNode, slideLayoutSpNode, slideMasterSpNode) {

            var ext = undefined;
            var w = -1, h = -1;

            if (slideSpNode !== undefined) {
                ext = slideSpNode["a:ext"]["attrs"];
            } else if (slideLayoutSpNode !== undefined) {
                ext = slideLayoutSpNode["a:ext"]["attrs"];
            } else if (slideMasterSpNode !== undefined) {
                ext = slideMasterSpNode["a:ext"]["attrs"];
            }

            if (ext === undefined) {
                return "";
            } else {
                w = parseInt(ext["cx"]) * 96 / 914400;
                h = parseInt(ext["cy"]) * 96 / 914400;
                return (isNaN(w) || isNaN(h)) ? "" : "width:" + w + "px; height:" + h + "px;";
            }

        }

        function getHorizontalAlign(node, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) {

            var algn = getTextByPathList(node, ["a:pPr", "attrs", "algn"]);
            if (algn === undefined) {
                algn = getTextByPathList(slideLayoutSpNode, ["p:txBody", "a:p", "a:pPr", "attrs", "algn"]);
                if (algn === undefined) {
                    algn = getTextByPathList(slideMasterSpNode, ["p:txBody", "a:p", "a:pPr", "attrs", "algn"]);
                    if (algn === undefined) {
                        switch (type) {
                            case "title":
                            case "subTitle":
                            case "ctrTitle":
                                algn = getTextByPathList(slideMasterTextStyles, ["p:titleStyle", "a:lvl1pPr", "attrs", "alng"]);
                                break;
                            default:
                                algn = getTextByPathList(slideMasterTextStyles, ["p:otherStyle", "a:lvl1pPr", "attrs", "alng"]);
                        }
                    }
                }
            }
            // TODO:
            if (algn === undefined) {
                if (type == "title" || type == "subTitle" || type == "ctrTitle") {
                    return "h-mid";
                } else if (type == "sldNum") {
                    return "h-right";
                }
            }
            return algn === "ctr" ? "h-mid" : algn === "r" ? "h-right" : "h-left";
        }

        function getVerticalAlign(node, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) {

            // 上中下對齊: X, <a:bodyPr anchor="ctr">, <a:bodyPr anchor="b">
            var anchor = getTextByPathList(node, ["p:txBody", "a:bodyPr", "attrs", "anchor"]);
            if (anchor === undefined) {
                anchor = getTextByPathList(slideLayoutSpNode, ["p:txBody", "a:bodyPr", "attrs", "anchor"]);
                if (anchor === undefined) {
                    anchor = getTextByPathList(slideMasterSpNode, ["p:txBody", "a:bodyPr", "attrs", "anchor"]);
                }
            }

            return anchor === "ctr" ? "v-mid" : anchor === "b" ? "v-down" : "v-up";
        }

        function getFontType(node, type, slideMasterTextStyles) {
            var typeface = getTextByPathList(node, ["a:rPr", "a:latin", "attrs", "typeface"]);

            if (typeface === undefined) {
                var fontSchemeNode = getTextByPathList(themeContent, ["a:theme", "a:themeElements", "a:fontScheme"]);
                if (type == "title" || type == "subTitle" || type == "ctrTitle") {
                    typeface = getTextByPathList(fontSchemeNode, ["a:majorFont", "a:latin", "attrs", "typeface"]);
                } else if (type == "body") {
                    typeface = getTextByPathList(fontSchemeNode, ["a:minorFont", "a:latin", "attrs", "typeface"]);
                } else {
                    typeface = getTextByPathList(fontSchemeNode, ["a:minorFont", "a:latin", "attrs", "typeface"]);
                }
            }

            return (typeface === undefined) ? "inherit" : typeface;
        }

        function getFontColorPr(node, spNode, type, slideMasterTextStyles) {
            //text border using: text-shadow: -1px 0 black, 0 1px black, 1px 0 black, 0 -1px black;
            //{getFontColor(..) return color} -> getFontColorPr(..) return array[color,textBordr/shadow]
            //https://stackoverflow.com/questions/2570972/css-font-border
            //https://www.w3schools.com/cssref/css3_pr_text-shadow.asp
            //console.log(node)
            var rPrNode = getTextByPathList(node, ["a:rPr"]);
            var filTyp, color, textBordr;
            if (rPrNode !== undefined) {
                filTyp = getFillType(rPrNode);
                if (filTyp == "SOLID_FILL") {
                    var solidFillNode = getTextByPathList(node, ["a:rPr", "a:solidFill"]);
                    color = getSolidFill(solidFillNode);
                } else if (filTyp == "PATTERN_FILL") {
                    var pattFill = getTextByPathList(node, ["a:rPr", "a:pattFill"]);
                    color = getPatternFill(pattFill);
                } else {
                    var sPstyle = getTextByPathList(spNode, ["p:style", "a:fontRef"]);
                    if (sPstyle !== undefined) {
                        color = getSolidFill(sPstyle);
                    }
                }
                //console.log(node,filTyp,color)
            }
            if (color === undefined || color === "FFF") {
                color = "#000";
            } else {
                color = "#" + color;
            }
            //textBordr
            var txtBrdrNode = getTextByPathList(node, ["a:rPr", "a:ln"]);
            if (txtBrdrNode !== undefined) {
                var txBrd = getBorder(node, false, "text");
                var txBrdAry = txBrd.split(" ");
                var brdSize = (parseInt(txBrdAry[0].substring(0, txBrdAry[0].indexOf("pt"))) * (4 / 3)) + "px";
                var brdClr = txBrdAry[2];
                //var brdTyp = txBrdAry[1]; //not in use
                textBordr = "-" + brdSize + " 0 " + brdClr + ", 0 " + brdSize + " " + brdClr + ", " + brdSize + " 0 " + brdClr + ", 0 -" + brdSize + " " + brdClr + ";"
                //console.log(node,"txBrd: ",textBordr);
            } else {
                textBordr = "none";
            }
            return [color, textBordr];
        }
        function getFontSize(node, slideLayoutSpNode, slideMasterSpNode, type, slideMasterTextStyles) {
            var fontSize = undefined;
            if (node["a:rPr"] !== undefined) {
                fontSize = parseInt(node["a:rPr"]["attrs"]["sz"]) / 100;
            }

            if ((isNaN(fontSize) || fontSize === undefined)) {
                var sz = getTextByPathList(slideLayoutSpNode, ["p:txBody", "a:lstStyle", "a:lvl1pPr", "a:defRPr", "attrs", "sz"]);
                fontSize = parseInt(sz) / 100;
            }

            if (isNaN(fontSize) || fontSize === undefined) {
                if (type == "title" || type == "subTitle" || type == "ctrTitle") {
                    var sz = getTextByPathList(slideMasterTextStyles, ["p:titleStyle", "a:lvl1pPr", "a:defRPr", "attrs", "sz"]);
                } else if (type == "body") {
                    var sz = getTextByPathList(slideMasterTextStyles, ["p:bodyStyle", "a:lvl1pPr", "a:defRPr", "attrs", "sz"]);
                } else if (type == "dt" || type == "sldNum") {
                    var sz = "1200";
                } else if (type === undefined) {
                    var sz = getTextByPathList(slideMasterTextStyles, ["p:otherStyle", "a:lvl1pPr", "a:defRPr", "attrs", "sz"]);
                }
                fontSize = parseInt(sz) / 100;
            }

            var baseline = getTextByPathList(node, ["a:rPr", "attrs", "baseline"]);
            if (baseline !== undefined && !isNaN(fontSize)) {
                fontSize -= 10;
            }

            return isNaN(fontSize) ? "inherit" : (fontSize + "pt");
        }

        function getFontBold(node, type, slideMasterTextStyles) {
            return (node["a:rPr"] !== undefined && node["a:rPr"]["attrs"]["b"] === "1") ? "bold" : "initial";
        }

        function getFontItalic(node, type, slideMasterTextStyles) {
            return (node["a:rPr"] !== undefined && node["a:rPr"]["attrs"]["i"] === "1") ? "italic" : "normal";
        }

        function getFontDecoration(node, type, slideMasterTextStyles) {
            ///////////////////////////////Amir///////////////////////////////
            if (node["a:rPr"] !== undefined) {
                var underLine = node["a:rPr"]["attrs"]["u"] !== undefined ? node["a:rPr"]["attrs"]["u"] : "none";
                var strikethrough = node["a:rPr"]["attrs"]["strike"] !== undefined ? node["a:rPr"]["attrs"]["strike"] : 'noStrike';
                //console.log("strikethrough: "+strikethrough);

                if (underLine != "none" && strikethrough == "noStrike") {
                    return "underline";
                } else if (underLine == "none" && strikethrough != "noStrike") {
                    return "line-through";
                } else if (underLine != "none" && strikethrough != "noStrike") {
                    return "underline line-through";
                } else {
                    return "initial";
                }
            } else {
                return "initial";
            }
            /////////////////////////////////////////////////////////////////
            //return (node["a:rPr"] !== undefined && node["a:rPr"]["attrs"]["u"] === "sng") ? "underline" : "initial";
        }
        ////////////////////////////////////Amir/////////////////////////////////////
        function getTextHorizontalAlign(node, type, slideMasterTextStyles) {
            var getAlgn = getTextByPathList(node, ["a:pPr", "attrs", "algn"]);
            var align = "initial";
            if (getAlgn !== undefined) {
                switch (getAlgn) {
                    case "l":
                        align = "left";
                        break;
                    case "r":
                        align = "right";
                        break;
                    case "ctr":
                        align = "center";
                        break;
                    case "just":
                        align = "justify";
                        break;
                    case "dist":
                        align = "justify";
                        break;
                    default:
                        align = "initial";
                }
            }
            return align;
        }
        /////////////////////////////////////////////////////////////////////
        function getTextVerticalAlign(node, type, slideMasterTextStyles) {
            var baseline = getTextByPathList(node, ["a:rPr", "attrs", "baseline"]);
            return baseline === undefined ? "baseline" : (parseInt(baseline) / 1000) + "%";
        }
        ///////////////////////////////////Amir/////////////////////////////
        function getTextDirection(node, type, slideMasterTextStyles) {
            //get lvl
            var pprLvl = getTextByPathList(node, ["a:pPr", "attrs", "lvl"]);
            var pprLvlNum = pprLvl === undefined ? 1 : Number(pprLvl) + 1;
            var lvlNode = "a:lvl" + pprLvlNum + "pPr";
            var pprAlgn = getTextByPathList(node, ["a:pPr", "attrs", "algn"]);
            var isDir = getTextByPathList(slideMasterTextStyles, ["p:bodyStyle", lvlNode, "attrs", "rtl"]);
            //var tmp = getTextByPathList(node, ["a:r", "a:t"]);
            var dir = "";
            if (isDir !== undefined) {
                if (isDir == "1" && (pprAlgn === undefined || pprAlgn == "r")) {
                    dir = "rtl";
                } else { //isDir =="0"
                    dir = "ltr";
                }
            }
            //console.log(tmp,isDir,pprAlgn,dir)
            return dir;
        }
        function getTableBorders(node) {
            var borderStyle = "";
            if (node["a:bottom"] !== undefined) {
                var obj = {
                    "p:spPr": {
                        "a:ln": node["a:bottom"]["a:ln"]
                    }
                }
                var borders = getBorder(obj, false, "shape");
                borderStyle += borders.replace("border", "border-bottom");
            }
            if (node["a:top"] !== undefined) {
                var obj = {
                    "p:spPr": {
                        "a:ln": node["a:top"]["a:ln"]
                    }
                }
                var borders = getBorder(obj, false, "shape");
                borderStyle += borders.replace("border", "border-top");
            }
            if (node["a:right"] !== undefined) {
                var obj = {
                    "p:spPr": {
                        "a:ln": node["a:right"]["a:ln"]
                    }
                }
                var borders = getBorder(obj, false, "shape");
                borderStyle += borders.replace("border", "border-right");
            }
            if (node["a:left"] !== undefined) {
                var obj = {
                    "p:spPr": {
                        "a:ln": node["a:left"]["a:ln"]
                    }
                }
                var borders = getBorder(obj, false, "shape");
                borderStyle += borders.replace("border", "border-left");
            }

            return borderStyle;
        }
        //////////////////////////////////////////////////////////////////
        function getBorder(node, isSvgMode, bType) {
            var cssText, lineNode;
            if (bType == "shape") {
                cssText = "border: ";
                lineNode = node["p:spPr"]["a:ln"];
            } else if (bType == "text") {
                cssText = "";
                lineNode = node["a:rPr"]["a:ln"];

            }

            // Border width: 1pt = 12700, default = 0.75pt
            var borderWidth = parseInt(getTextByPathList(lineNode, ["attrs", "w"])) / 12700;
            if (isNaN(borderWidth) || borderWidth < 1) {
                cssText += "1pt ";
            } else {
                cssText += borderWidth + "pt ";
            }
            // Border type
            var borderType = getTextByPathList(lineNode, ["a:prstDash", "attrs", "val"]);
            var strokeDasharray = "0";
            switch (borderType) {
                case "solid":
                    cssText += "solid";
                    strokeDasharray = "0";
                    break;
                case "dash":
                    cssText += "dashed";
                    strokeDasharray = "5";
                    break;
                case "dashDot":
                    cssText += "dashed";
                    strokeDasharray = "5, 5, 1, 5";
                    break;
                case "dot":
                    cssText += "dotted";
                    strokeDasharray = "1, 5";
                    break;
                case "lgDash":
                    cssText += "dashed";
                    strokeDasharray = "10, 5";
                    break;
                case "lgDashDotDot":
                    cssText += "dashed";
                    strokeDasharray = "10, 5, 1, 5, 1, 5";
                    break;
                case "sysDash":
                    cssText += "dashed";
                    strokeDasharray = "5, 2";
                    break;
                case "sysDashDot":
                    cssText += "dashed";
                    strokeDasharray = "5, 2, 1, 5";
                    break;
                case "sysDashDotDot":
                    cssText += "dashed";
                    strokeDasharray = "5, 2, 1, 5, 1, 5";
                    break;
                case "sysDot":
                    cssText += "dotted";
                    strokeDasharray = "2, 5";
                    break;
                case undefined:
                //console.log(borderType);
                default:
                    cssText += "solid";
                    strokeDasharray = "0";
            }
            // Border color
            var borderColor = getTextByPathList(lineNode, ["a:solidFill", "a:srgbClr", "attrs", "val"]);
            if (borderColor === undefined) {
                var schemeClrNode = getTextByPathList(lineNode, ["a:solidFill", "a:schemeClr"]);
                if (schemeClrNode !== undefined) {
                    var schemeClr = "a:" + getTextByPathList(schemeClrNode, ["attrs", "val"]);
                    var borderColor = getSchemeColorFromTheme(schemeClr, undefined);
                }
            }

            // 2. drawingML namespace
            if (borderColor === undefined) {
                var schemeClrNode = getTextByPathList(node, ["p:style", "a:lnRef", "a:schemeClr"]);
                if (schemeClrNode !== undefined) {
                    var schemeClr = "a:" + getTextByPathList(schemeClrNode, ["attrs", "val"]);
                    var borderColor = getSchemeColorFromTheme(schemeClr, undefined);
                }

                if (borderColor !== undefined) {
                    var shade = getTextByPathList(schemeClrNode, ["a:shade", "attrs", "val"]);
                    if (shade !== undefined) {
                        shade = parseInt(shade) / 100000;
                        var color = new colz.Color("#" + borderColor);
                        color.setLum(color.hsl.l * shade);
                        borderColor = color.hex.replace("#", "");
                    }
                }

            }

            if (borderColor === undefined) {
                if (isSvgMode) {
                    borderColor = "none";
                } else {
                    borderColor = "#000";
                }
            } else {
                borderColor = "#" + borderColor;

            }
            cssText += " " + borderColor + " ";



            if (isSvgMode) {
                return { "color": borderColor, "width": borderWidth, "type": borderType, "strokeDasharray": strokeDasharray };
            } else {
                return cssText + ";";
            }
        }

        function getSlideBackgroundFill(slideContent, slideLayoutContent, slideMasterContent, warpObj) {
            //console.log(slideContent)
            //getFillType(node)
            var bgPr = getTextByPathList(slideContent, ["p:sld", "p:cSld", "p:bg", "p:bgPr"]);
            var bgRef = getTextByPathList(slideContent, ["p:sld", "p:cSld", "p:bg", "p:bgRef"]);
            var bgcolor;
            if (bgPr !== undefined) {
                //bgcolor = "background-color: blue;";
                var bgFillTyp = getFillType(bgPr);

                if (bgFillTyp == "SOLID_FILL") {
                    var sldFill = bgPr["a:solidFill"];
                    var bgColor = getSolidFill(sldFill);
                    var sldTint = getColorOpacity(sldFill);
                    bgcolor = "background: rgba(" + hexToRgbNew(bgColor) + "," + sldTint + ");";

                } else if (bgFillTyp == "GRADIENT_FILL") {
                    bgcolor = getBgGradientFill(bgPr, undefined, slideMasterContent);
                } else if (bgFillTyp == "PIC_FILL") {
                    bgcolor = getBgPicFill(bgPr, "slideBg", warpObj);

                }
                //console.log(slideContent,slideMasterContent,color_ary,tint_ary,rot,bgcolor)
            } else if (bgRef !== undefined) {
                //console.log("slideContent",bgRef)
                var phClr;
                if (bgRef["a:srgbClr"] !== undefined) {
                    phClr = getTextByPathList(bgRef, ["a:srgbClr", "attrs", "val"]); //#...
                } else if (bgRef["a:schemeClr"] !== undefined) { //a:schemeClr
                    var schemeClr = getTextByPathList(bgRef, ["a:schemeClr", "attrs", "val"]);
                    phClr = getSchemeColorFromTheme("a:" + schemeClr, slideMasterContent); //#...
                    //console.log("schemeClr",schemeClr,"phClr=",phClr)
                }
                var idx = Number(bgRef["attrs"]["idx"]);


                if (idx == 0 || idx == 1000) {
                    //no background
                } else if (idx > 0 && idx < 1000) {
                    //fillStyleLst in themeContent
                    //themeContent["a:fmtScheme"]["a:fillStyleLst"]
                    //bgcolor = "background: red;";
                } else if (idx > 1000) {
                    //bgFillStyleLst  in themeContent
                    //themeContent["a:fmtScheme"]["a:bgFillStyleLst"]
                    var trueIdx = idx - 1000;
                    var bgFillLst = themeContent["a:theme"]["a:themeElements"]["a:fmtScheme"]["a:bgFillStyleLst"];
                    var sortblAry = [];
                    Object.keys(bgFillLst).forEach(function (key) {
                        var bgFillLstTyp = bgFillLst[key];
                        if (key != "attrs") {
                            if (bgFillLstTyp.constructor === Array) {
                                for (var i = 0; i < bgFillLstTyp.length; i++) {
                                    var obj = {};
                                    obj[key] = bgFillLstTyp[i];
                                    obj["idex"] = bgFillLstTyp[i]["attrs"]["order"];
                                    sortblAry.push(obj)
                                }
                            } else {
                                var obj = {};
                                obj[key] = bgFillLstTyp;
                                obj["idex"] = bgFillLstTyp["attrs"]["order"];
                                sortblAry.push(obj)
                            }
                        }
                    });
                    var sortByOrder = sortblAry.slice(0);
                    sortByOrder.sort(function (a, b) {
                        return a.idex - b.idex;
                    });
                    var bgFillLstIdx = sortByOrder[trueIdx - 1];
                    var bgFillTyp = getFillType(bgFillLstIdx);
                    if (bgFillTyp == "SOLID_FILL") {
                        var sldFill = bgFillLstIdx["a:solidFill"];
                        //var sldBgColor = getSolidFill(sldFill);
                        var sldTint = getColorOpacity(sldFill);
                        bgcolor = "background: rgba(" + hexToRgbNew(phClr) + "," + sldTint + ");";
                        //console.log("slideMasterContent - sldFill",sldFill)
                    } else if (bgFillTyp == "GRADIENT_FILL") {
                        bgcolor = getBgGradientFill(bgFillLstIdx, phClr, slideMasterContent);
                    }
                }

            } else {
                bgPr = getTextByPathList(slideLayoutContent, ["p:sldLayout", "p:cSld", "p:bg", "p:bgPr"]);
                bgRef = getTextByPathList(slideLayoutContent, ["p:sldLayout", "p:cSld", "p:bg", "p:bgRef"]);
                //console.log("slideLayoutContent",bgPr,bgRef)
                if (bgPr !== undefined) {
                    var bgFillTyp = getFillType(bgPr);
                    if (bgFillTyp == "SOLID_FILL") {
                        var sldFill = bgPr["a:solidFill"];
                        var bgColor = getSolidFill(sldFill);
                        var sldTint = getColorOpacity(sldFill);
                        bgcolor = "background: rgba(" + hexToRgbNew(bgColor) + "," + sldTint + ");";
                    } else if (bgFillTyp == "GRADIENT_FILL") {
                        bgcolor = getBgGradientFill(bgPr, undefined, slideMasterContent);
                    } else if (bgFillTyp == "PIC_FILL") {
                        bgcolor = getBgPicFill(bgPr, "layoutBg", warpObj);

                    }
                    //console.log("slideLayoutContent",bgcolor)
                } else if (bgRef !== undefined) {
                    bgcolor = "background: red;";
                } else {
                    bgPr = getTextByPathList(slideMasterContent, ["p:sldMaster", "p:cSld", "p:bg", "p:bgPr"]);
                    bgRef = getTextByPathList(slideMasterContent, ["p:sldMaster", "p:cSld", "p:bg", "p:bgRef"]);

                    //console.log("bgRef",bgRef["a:schemeClr"]["attrs"]["val"])
                    if (bgPr !== undefined) {
                        var bgFillTyp = getFillType(bgPr);
                        if (bgFillTyp == "SOLID_FILL") {
                            var sldFill = bgPr["a:solidFill"];
                            var bgColor = getSolidFill(sldFill);
                            var sldTint = getColorOpacity(sldFill);
                            bgcolor = "background: rgba(" + hexToRgbNew(bgColor) + "," + sldTint + ");";
                        } else if (bgFillTyp == "GRADIENT_FILL") {
                            bgcolor = getBgGradientFill(bgPr, undefined, slideMasterContent);
                        } else if (bgFillTyp == "PIC_FILL") {
                            bgcolor = getBgPicFill(bgPr, "masterBg", warpObj);
                        }
                    } else if (bgRef !== undefined) {
                        //var obj={
                        //    "a:solidFill": bgRef
                        //}
                        //var phClr = getSolidFill(bgRef);
                        var phClr;
                        if (bgRef["a:srgbClr"] !== undefined) {
                            phClr = getTextByPathList(bgRef, ["a:srgbClr", "attrs", "val"]); //#...
                        } else if (bgRef["a:schemeClr"] !== undefined) { //a:schemeClr
                            var schemeClr = getTextByPathList(bgRef, ["a:schemeClr", "attrs", "val"]);

                            phClr = getSchemeColorFromTheme("a:" + schemeClr, slideMasterContent); //#...
                            //console.log("phClr",phClr)
                        }
                        var idx = Number(bgRef["attrs"]["idx"]);
                        //console.log("phClr=",phClr,"idx=",idx)

                        if (idx == 0 || idx == 1000) {
                            //no background
                        } else if (idx > 0 && idx < 1000) {
                            //fillStyleLst in themeContent
                            //themeContent["a:fmtScheme"]["a:fillStyleLst"]
                            //bgcolor = "background: red;";
                        } else if (idx > 1000) {
                            //bgFillStyleLst  in themeContent
                            //themeContent["a:fmtScheme"]["a:bgFillStyleLst"]
                            var trueIdx = idx - 1000;
                            var bgFillLst = themeContent["a:theme"]["a:themeElements"]["a:fmtScheme"]["a:bgFillStyleLst"];
                            var sortblAry = [];
                            Object.keys(bgFillLst).forEach(function (key) {
                                //console.log("cubicBezTo["+key+"]:");
                                var bgFillLstTyp = bgFillLst[key];
                                if (key != "attrs") {
                                    if (bgFillLstTyp.constructor === Array) {
                                        for (var i = 0; i < bgFillLstTyp.length; i++) {
                                            var obj = {};
                                            obj[key] = bgFillLstTyp[i];
                                            obj["idex"] = bgFillLstTyp[i]["attrs"]["order"];
                                            sortblAry.push(obj)
                                        }
                                    } else {
                                        var obj = {};
                                        obj[key] = bgFillLstTyp;
                                        obj["idex"] = bgFillLstTyp["attrs"]["order"];
                                        sortblAry.push(obj)
                                    }
                                }
                            });
                            var sortByOrder = sortblAry.slice(0);
                            sortByOrder.sort(function (a, b) {
                                return a.idex - b.idex;
                            });
                            var bgFillLstIdx = sortByOrder[trueIdx - 1];
                            var bgFillTyp = getFillType(bgFillLstIdx);
                            //console.log("bgFillLstIdx",bgFillLstIdx);
                            if (bgFillTyp == "SOLID_FILL") {
                                var sldFill = bgFillLstIdx["a:solidFill"];
                                var sldTint = getColorOpacity(sldFill);
                                bgcolor = "background: rgba(" + hexToRgbNew(phClr) + "," + sldTint + ");";
                            } else if (bgFillTyp == "GRADIENT_FILL") {
                                bgcolor = getBgGradientFill(bgFillLstIdx, phClr, slideMasterContent);
                            } else {
                                console.log(bgFillTyp)
                            }
                        }
                    }
                }
            }

            //console.log("bgcolor: ",bgcolor)   
            return bgcolor;
        }
        function getBgGradientFill(bgPr, phClr, slideMasterContent) {
            var bgcolor = "";
            if (bgPr !== undefined) {
                var grdFill = bgPr["a:gradFill"];
                var gsLst = grdFill["a:gsLst"]["a:gs"];
                var startColorNode, endColorNode;
                var color_ary = [];
                var tint_ary = [];
                for (var i = 0; i < gsLst.length; i++) {
                    var lo_tint;
                    var lo_color = "";
                    if (gsLst[i]["a:srgbClr"] !== undefined) {
                        if (phClr === undefined) {
                            lo_color = getTextByPathList(gsLst[i], ["a:srgbClr", "attrs", "val"]); //#...
                        }
                        lo_tint = getTextByPathList(gsLst[i], ["a:srgbClr", "a:tint", "attrs", "val"]);
                    } else if (gsLst[i]["a:schemeClr"] !== undefined) { //a:schemeClr
                        if (phClr === undefined) {
                            var schemeClr = getTextByPathList(gsLst[i], ["a:schemeClr", "attrs", "val"]);
                            lo_color = getSchemeColorFromTheme("a:" + schemeClr, slideMasterContent); //#...
                        }
                        lo_tint = getTextByPathList(gsLst[i], ["a:schemeClr", "a:tint", "attrs", "val"]);
                        //console.log("schemeClr",schemeClr,slideMasterContent)
                    }
                    //console.log("lo_color",lo_color)
                    color_ary[i] = lo_color;
                    tint_ary[i] = (lo_tint !== undefined) ? parseInt(lo_tint) / 100000 : 1;
                }
                //get rot
                var lin = grdFill["a:lin"];
                var rot = 90;
                if (lin !== undefined) {
                    rot = angleToDegrees(lin["attrs"]["ang"]) + 90;
                }
                bgcolor = "background: linear-gradient(" + rot + "deg,";
                for (var i = 0; i < gsLst.length; i++) {
                    if (i == gsLst.length - 1) {
                        if (phClr === undefined) {
                            bgcolor += "rgba(" + hexToRgbNew(color_ary[i]) + "," + tint_ary[i] + ")" + ");";
                        } else {
                            bgcolor += "rgba(" + hexToRgbNew(phClr) + "," + tint_ary[i] + ")" + ");";
                        }
                    } else {
                        if (phClr === undefined) {
                            bgcolor += "rgba(" + hexToRgbNew(color_ary[i]) + "," + tint_ary[i] + ")" + ", ";
                        } else {
                            bgcolor += "rgba(" + hexToRgbNew(phClr) + "," + tint_ary[i] + ")" + ", ";
                        }
                    }
                }
            } else {
                if (phClr === undefined) {
                    bgcolor = "rgba(" + hexToRgbNew(phClr) + ",0);";
                }
            }
            return bgcolor;
        }
        function getBgPicFill(bgPr, sorce, warpObj) {
            var bgcolor;
            var picFillBase64 = getPicFill(sorce, bgPr["a:blipFill"], warpObj);
            var ordr = bgPr["attrs"]["order"];
            //a:srcRect
            //a:stretch => a:fillRect =>attrs (l:-17000, r:-17000)
            bgcolor = "background-image: url(" + picFillBase64 + ");  z-index: " + ordr + ";";
            return bgcolor;
        }
        function hexToRgbNew(hex) {
            var arrBuff = new ArrayBuffer(4);
            var vw = new DataView(arrBuff);
            vw.setUint32(0, parseInt(hex, 16), false);
            var arrByte = new Uint8Array(arrBuff);

            return arrByte[1] + "," + arrByte[2] + "," + arrByte[3];
        }
        function getShapeFill(node, isSvgMode, warpObj) {

            // 1. presentationML
            // p:spPr/ [a:noFill, solidFill, gradFill, blipFill, pattFill, grpFill]
            // From slide
            //Fill Type:
            //console.log("ShapeFill: ", node)
            var fillType = getFillType(getTextByPathList(node, ["p:spPr"]));
            var fillColor;
            if (fillType == "NO_FILL") {
                return isSvgMode ? "none" : "background-color: initial;";
            } else if (fillType == "SOLID_FILL") {
                var shpFill = node["p:spPr"]["a:solidFill"];
                fillColor = getSolidFill(shpFill);
            } else if (fillType == "GRADIENT_FILL") {
                var shpFill = node["p:spPr"]["a:gradFill"];
                // fillColor = getSolidFill(shpFill);
                fillColor = getGradientFill(shpFill);
                //console.log("shpFill",shpFill,grndColor.color)
            } else if (fillType == "PATTERN_FILL") {
                var shpFill = node["p:spPr"]["a:pattFill"];
                fillColor = getPatternFill(shpFill);
            } else if (fillType == "PIC_FILL") {
                var shpFill = node["p:spPr"]["a:blipFill"];
                fillColor = getPicFill("slideBg", shpFill, warpObj);
            }


            // 2. drawingML namespace
            if (fillColor === undefined) {
                var clrName = getTextByPathList(node, ["p:style", "a:fillRef"]);
                fillColor = getSolidFill(clrName);
            }

            if (fillColor !== undefined) {
                if (fillType == "GRADIENT_FILL") {
                    if (isSvgMode) {
                        // console.log("GRADIENT_FILL color", fillColor.color[0])
                        return fillColor;
                    } else {
                        var colorAry = fillColor.color;
                        var rot = fillColor.rot;

                        var bgcolor = "background: linear-gradient(" + rot + "deg,";
                        for (var i = 0; i < colorAry.length; i++) {
                            if (i == colorAry.length - 1) {
                                bgcolor += colorAry[i] + ");";
                            } else {
                                bgcolor += colorAry[i] + ", ";
                            }

                        }
                        return bgcolor;
                    }
                } else if (fillType == "PIC_FILL") {
                    if (isSvgMode) {
                        return fillColor;
                    } else {

                        return "background-image:url(" + fillColor + ");";
                    }
                } else {
                    if (isSvgMode) {
                        var color = new colz.Color(fillColor);
                        fillColor = color.rgb.toString();

                        return fillColor;
                    } else {
                        //console.log(node,"fillColor: ",fillColor,"fillType: ",fillType,"isSvgMode: ",isSvgMode)
                        return "background-color: #" + fillColor + ";";
                    }
                }
            } else {
                if (isSvgMode) {
                    return "none";
                } else {
                    return "background-color: initial;";
                }

            }

        }
        ///////////////////////Amir//////////////////////////////
        function getFillType(node) {
            //Need to test/////////////////////////////////////////////
            //SOLID_FILL
            //PIC_FILL
            //GRADIENT_FILL
            //PATTERN_FILL
            //NO_FILL
            var fillType = "";
            if (node["a:noFill"] !== undefined) {
                fillType = "NO_FILL";
            }
            if (node["a:solidFill"] !== undefined) {
                fillType = "SOLID_FILL";
            }
            if (node["a:gradFill"] !== undefined) {
                fillType = "GRADIENT_FILL";
            }
            if (node["a:pattFill"] !== undefined) {
                fillType = "PATTERN_FILL";
            }
            if (node["a:blipFill"] !== undefined) {
                fillType = "PIC_FILL";
            }

            return fillType;
        }
        function getGradientFill(node) {
            var gsLst = node["a:gsLst"]["a:gs"];
            //get start color
            var color_ary = [];
            var tint_ary = [];
            for (var i = 0; i < gsLst.length; i++) {
                var lo_tint;
                var lo_color = getSolidFill(gsLst[i]);
                if (gsLst[i]["a:srgbClr"] !== undefined) {
                    var lumMod = parseInt(getTextByPathList(node, ["a:srgbClr", "a:lumMod", "attrs", "val"])) / 100000;
                    var lumOff = parseInt(getTextByPathList(node, ["a:srgbClr", "a:lumOff", "attrs", "val"])) / 100000;
                    if (isNaN(lumMod)) {
                        lumMod = 1.0;
                    }
                    if (isNaN(lumOff)) {
                        lumOff = 0;
                    }
                    //console.log([lumMod, lumOff]);
                    lo_color = applyLumModify(lo_color, lumMod, lumOff);
                } else if (gsLst[i]["a:schemeClr"] !== undefined) { //a:schemeClr
                    var lumMod = parseInt(getTextByPathList(gsLst[i], ["a:schemeClr", "a:lumMod", "attrs", "val"])) / 100000;
                    var lumOff = parseInt(getTextByPathList(gsLst[i], ["a:schemeClr", "a:lumOff", "attrs", "val"])) / 100000;
                    if (isNaN(lumMod)) {
                        lumMod = 1.0;
                    }
                    if (isNaN(lumOff)) {
                        lumOff = 0;
                    }
                    //console.log([lumMod, lumOff]);
                    lo_color = applyLumModify(lo_color, lumMod, lumOff);
                }
                //console.log("lo_color",lo_color)
                color_ary[i] = lo_color;
            }
            //get rot
            var lin = node["a:lin"];
            var rot = 0;
            if (lin !== undefined) {
                rot = angleToDegrees(lin["attrs"]["ang"]) + 90;
            }
            return {
                "color": color_ary,
                "rot": rot
            }
        }
        function getPicFill(type, node, warpObj) {
            //Need to test/////////////////////////////////////////////
            //rId
            //TODO - Image Properties - Tile, Stretch, or Display Portion of Image
            //(http://officeopenxml.com/drwPic-tile.php)
            var img;
            var rId = node["a:blip"]["attrs"]["r:embed"];
            var imgPath;
            if (type == "slideBg") {
                imgPath = getTextByPathList(warpObj, ["slideResObj", rId, "target"]);
            } else if (type == "layoutBg") {
                imgPath = getTextByPathList(warpObj, ["layoutResObj", rId, "target"]);
            } else if (type == "masterBg") {
                imgPath = getTextByPathList(warpObj, ["masterResObj", rId, "target"]);
            }
            imgPath = escapeHtml(imgPath);

            if (imgPath === undefined) {
                return undefined;
            }
            var imgExt = imgPath.split(".").pop();
            if (imgExt == "xml") {
                return undefined;
            }
            var imgArrayBuffer = warpObj["zip"].file(imgPath).asArrayBuffer();
            var imgMimeType = getMimeType(imgExt);
            img = "data:" + imgMimeType + ";base64," + base64ArrayBuffer(imgArrayBuffer);
            return img;
        }
        function getPatternFill(node) {
            var color = "";
            var fgClr = node["a:fgClr"];
            color = getSolidFill(fgClr);
            return color;
        }

        function getSolidFill(node) {

            if (node === undefined) {
                return undefined;
            }

            var color = "FFF";

            if (node["a:srgbClr"] !== undefined) {
                color = getTextByPathList(node, ["a:srgbClr", "attrs", "val"]); //#...
            } else if (node["a:schemeClr"] !== undefined) { //a:schemeClr
                var schemeClr = getTextByPathList(node, ["a:schemeClr", "attrs", "val"]);
                //console.log(schemeClr)
                color = getSchemeColorFromTheme("a:" + schemeClr, undefined); //#...

            } else if (node["a:scrgbClr"] !== undefined) {
                //<a:scrgbClr r="50%" g="50%" b="50%"/>  //Need to test/////////////////////////////////////////////
                var defBultColorVals = node["a:scrgbClr"]["attrs"];
                var red = (defBultColorVals["r"].indexOf("%") != -1) ? defBultColorVals["r"].split("%").shift() : defBultColorVals["r"];
                var green = (defBultColorVals["g"].indexOf("%") != -1) ? defBultColorVals["g"].split("%").shift() : defBultColorVals["g"];
                var blue = (defBultColorVals["b"].indexOf("%") != -1) ? defBultColorVals["b"].split("%").shift() : defBultColorVals["b"];
                var scrgbClr = red + "," + green + "," + blue;
                color = toHex(255 * (Number(red) / 100)) + toHex(255 * (Number(green) / 100)) + toHex(255 * (Number(blue) / 100));
                //console.log("scrgbClr: " + scrgbClr);

            } else if (node["a:prstClr"] !== undefined) {
                //<a:prstClr val="black"/>  //Need to test/////////////////////////////////////////////
                var prstClr = node["a:prstClr"]["attrs"]["val"];
                color = getColorName2Hex(prstClr);
                //console.log("prstClr: " + prstClr+" => hexClr: "+color);
            } else if (node["a:hslClr"] !== undefined) {
                //<a:hslClr hue="14400000" sat="100%" lum="50%"/>  //Need to test/////////////////////////////////////////////
                var defBultColorVals = node["a:hslClr"]["attrs"];
                var hue = Number(defBultColorVals["hue"]) / 100000;
                var sat = Number((defBultColorVals["sat"].indexOf("%") != -1) ? defBultColorVals["sat"].split("%").shift() : defBultColorVals["sat"]) / 100;
                var lum = Number((defBultColorVals["lum"].indexOf("%") != -1) ? defBultColorVals["lum"].split("%").shift() : defBultColorVals["lum"]) / 100;
                var hslClr = defBultColorVals["hue"] + "," + defBultColorVals["sat"] + "," + defBultColorVals["lum"];
                var hsl2rgb = hslToRgb(hue, sat, lum);
                color = toHex(hsl2rgb.r) + toHex(hsl2rgb.g) + toHex(hsl2rgb.b);
                //defBultColor = cnvrtHslColor2Hex(hslClr); //TODO
                // console.log("hslClr: " + hslClr);
            } else if (node["a:sysClr"] !== undefined) {
                //<a:sysClr val="windowText" lastClr="000000"/>  //Need to test/////////////////////////////////////////////
                var sysClr = getTextByPathList(node, ["a:sysClr", "attrs", "lastClr"]);
                if (sysClr !== undefined) {
                    color = sysClr;
                }
            }
            return color;
        }
        function toHex(n) {
            var hex = n.toString(16);
            while (hex.length < 2) { hex = "0" + hex; }
            return hex;
        }
        function hslToRgb(hue, sat, light) {
            var t1, t2, r, g, b;
            hue = hue / 60;
            if (light <= 0.5) {
                t2 = light * (sat + 1);
            } else {
                t2 = light + sat - (light * sat);
            }
            t1 = light * 2 - t2;
            r = hueToRgb(t1, t2, hue + 2) * 255;
            g = hueToRgb(t1, t2, hue) * 255;
            b = hueToRgb(t1, t2, hue - 2) * 255;
            return { r: r, g: g, b: b };
        }
        function hueToRgb(t1, t2, hue) {
            if (hue < 0) hue += 6;
            if (hue >= 6) hue -= 6;
            if (hue < 1) return (t2 - t1) * hue + t1;
            else if (hue < 3) return t2;
            else if (hue < 4) return (t2 - t1) * (4 - hue) + t1;
            else return t1;
        }
        function getColorName2Hex(name) {
            var hex;
            var colorName = ['AliceBlue', 'AntiqueWhite', 'Aqua', 'Aquamarine', 'Azure', 'Beige', 'Bisque', 'Black', 'BlanchedAlmond', 'Blue', 'BlueViolet', 'Brown', 'BurlyWood', 'CadetBlue', 'Chartreuse', 'Chocolate', 'Coral', 'CornflowerBlue', 'Cornsilk', 'Crimson', 'Cyan', 'DarkBlue', 'DarkCyan', 'DarkGoldenRod', 'DarkGray', 'DarkGrey', 'DarkGreen', 'DarkKhaki', 'DarkMagenta', 'DarkOliveGreen', 'DarkOrange', 'DarkOrchid', 'DarkRed', 'DarkSalmon', 'DarkSeaGreen', 'DarkSlateBlue', 'DarkSlateGray', 'DarkSlateGrey', 'DarkTurquoise', 'DarkViolet', 'DeepPink', 'DeepSkyBlue', 'DimGray', 'DimGrey', 'DodgerBlue', 'FireBrick', 'FloralWhite', 'ForestGreen', 'Fuchsia', 'Gainsboro', 'GhostWhite', 'Gold', 'GoldenRod', 'Gray', 'Grey', 'Green', 'GreenYellow', 'HoneyDew', 'HotPink', 'IndianRed', 'Indigo', 'Ivory', 'Khaki', 'Lavender', 'LavenderBlush', 'LawnGreen', 'LemonChiffon', 'LightBlue', 'LightCoral', 'LightCyan', 'LightGoldenRodYellow', 'LightGray', 'LightGrey', 'LightGreen', 'LightPink', 'LightSalmon', 'LightSeaGreen', 'LightSkyBlue', 'LightSlateGray', 'LightSlateGrey', 'LightSteelBlue', 'LightYellow', 'Lime', 'LimeGreen', 'Linen', 'Magenta', 'Maroon', 'MediumAquaMarine', 'MediumBlue', 'MediumOrchid', 'MediumPurple', 'MediumSeaGreen', 'MediumSlateBlue', 'MediumSpringGreen', 'MediumTurquoise', 'MediumVioletRed', 'MidnightBlue', 'MintCream', 'MistyRose', 'Moccasin', 'NavajoWhite', 'Navy', 'OldLace', 'Olive', 'OliveDrab', 'Orange', 'OrangeRed', 'Orchid', 'PaleGoldenRod', 'PaleGreen', 'PaleTurquoise', 'PaleVioletRed', 'PapayaWhip', 'PeachPuff', 'Peru', 'Pink', 'Plum', 'PowderBlue', 'Purple', 'RebeccaPurple', 'Red', 'RosyBrown', 'RoyalBlue', 'SaddleBrown', 'Salmon', 'SandyBrown', 'SeaGreen', 'SeaShell', 'Sienna', 'Silver', 'SkyBlue', 'SlateBlue', 'SlateGray', 'SlateGrey', 'Snow', 'SpringGreen', 'SteelBlue', 'Tan', 'Teal', 'Thistle', 'Tomato', 'Turquoise', 'Violet', 'Wheat', 'White', 'WhiteSmoke', 'Yellow', 'YellowGreen'];
            var colorHex = ['f0f8ff', 'faebd7', '00ffff', '7fffd4', 'f0ffff', 'f5f5dc', 'ffe4c4', '000000', 'ffebcd', '0000ff', '8a2be2', 'a52a2a', 'deb887', '5f9ea0', '7fff00', 'd2691e', 'ff7f50', '6495ed', 'fff8dc', 'dc143c', '00ffff', '00008b', '008b8b', 'b8860b', 'a9a9a9', 'a9a9a9', '006400', 'bdb76b', '8b008b', '556b2f', 'ff8c00', '9932cc', '8b0000', 'e9967a', '8fbc8f', '483d8b', '2f4f4f', '2f4f4f', '00ced1', '9400d3', 'ff1493', '00bfff', '696969', '696969', '1e90ff', 'b22222', 'fffaf0', '228b22', 'ff00ff', 'dcdcdc', 'f8f8ff', 'ffd700', 'daa520', '808080', '808080', '008000', 'adff2f', 'f0fff0', 'ff69b4', 'cd5c5c', '4b0082', 'fffff0', 'f0e68c', 'e6e6fa', 'fff0f5', '7cfc00', 'fffacd', 'add8e6', 'f08080', 'e0ffff', 'fafad2', 'd3d3d3', 'd3d3d3', '90ee90', 'ffb6c1', 'ffa07a', '20b2aa', '87cefa', '778899', '778899', 'b0c4de', 'ffffe0', '00ff00', '32cd32', 'faf0e6', 'ff00ff', '800000', '66cdaa', '0000cd', 'ba55d3', '9370db', '3cb371', '7b68ee', '00fa9a', '48d1cc', 'c71585', '191970', 'f5fffa', 'ffe4e1', 'ffe4b5', 'ffdead', '000080', 'fdf5e6', '808000', '6b8e23', 'ffa500', 'ff4500', 'da70d6', 'eee8aa', '98fb98', 'afeeee', 'db7093', 'ffefd5', 'ffdab9', 'cd853f', 'ffc0cb', 'dda0dd', 'b0e0e6', '800080', '663399', 'ff0000', 'bc8f8f', '4169e1', '8b4513', 'fa8072', 'f4a460', '2e8b57', 'fff5ee', 'a0522d', 'c0c0c0', '87ceeb', '6a5acd', '708090', '708090', 'fffafa', '00ff7f', '4682b4', 'd2b48c', '008080', 'd8bfd8', 'ff6347', '40e0d0', 'ee82ee', 'f5deb3', 'ffffff', 'f5f5f5', 'ffff00', '9acd32'];
            var findIndx = colorName.indexOf(name);
            if (findIndx != -1) {
                hex = colorHex[findIndx];
            }
            return hex;
        }
        function getColorOpacity(solidFill) {

            if (solidFill === undefined) {
                return undefined;
            }
            var opcity = 1;

            if (solidFill["a:srgbClr"] !== undefined) {
                var tint = getTextByPathList(solidFill, ["a:srgbClr", "a:tint", "attrs", "val"]);
                if (tint !== undefined) {
                    opcity = parseInt(tint) / 100000;
                }
            } else if (solidFill["a:schemeClr"] !== undefined) {
                var tint = getTextByPathList(solidFill, ["a:schemeClr", "a:tint", "attrs", "val"]);
                if (tint !== undefined) {
                    opcity = parseInt(tint) / 100000;
                }
            } else if (solidFill["a:scrgbClr"] !== undefined) {
                var tint = getTextByPathList(solidFill, ["a:scrgbClr", "a:tint", "attrs", "val"]);
                if (tint !== undefined) {
                    opcity = parseInt(tint) / 100000;
                }

            } else if (solidFill["a:prstClr"] !== undefined) {
                var tint = getTextByPathList(solidFill, ["a:prstClr", "a:tint", "attrs", "val"]);
                if (tint !== undefined) {
                    opcity = parseInt(tint) / 100000;
                }
            } else if (solidFill["a:hslClr"] !== undefined) {
                var tint = getTextByPathList(solidFill, ["a:hslClr", "a:tint", "attrs", "val"]);
                if (tint !== undefined) {
                    opcity = parseInt(tint) / 100000;
                }
            } else if (solidFill["a:sysClr"] !== undefined) {
                var tint = getTextByPathList(solidFill, ["a:sysClr", "a:tint", "attrs", "val"]);
                if (tint !== undefined) {
                    opcity = parseInt(tint) / 100000;
                }
            }

            return opcity;
        }
        function getSchemeColorFromTheme(schemeClr, sldMasterNode) {
            //<p:clrMap ...> in slide master
            // e.g. tx2="dk2" bg2="lt2" tx1="dk1" bg1="lt1" slideLayoutClrOvride

            if (slideLayoutClrOvride == "" || slideLayoutClrOvride === undefined) {
                slideLayoutClrOvride = getTextByPathList(sldMasterNode, ["p:sldMaster", "p:clrMap", "attrs"])
            }
            //console.log(slideLayoutClrOvride);
            var schmClrName = schemeClr.substr(2);
            if (slideLayoutClrOvride !== undefined) {
                switch (schmClrName) {
                    case "tx1":
                    case "tx2":
                    case "bg1":
                    case "bg2":
                        schemeClr = "a:" + slideLayoutClrOvride[schmClrName];
                        //console.log(schmClrName+ "=> "+schemeClr);
                        break;
                }
            } else {
                switch (schmClrName) {
                    case "tx1":
                        schemeClr = "a:dk1";
                        break;
                    case "tx2":
                        schemeClr = "a:dk2";
                        break;
                    case "bg1":
                        schemeClr = "a:lt1";
                        break;
                    case "bg2":
                        schemeClr = "a:lt2";
                        break;
                }
            }
            var refNode = getTextByPathList(themeContent, ["a:theme", "a:themeElements", "a:clrScheme", schemeClr]);
            var color = getTextByPathList(refNode, ["a:srgbClr", "attrs", "val"]);
            if (color === undefined && refNode !== undefined) {
                color = getTextByPathList(refNode, ["a:sysClr", "attrs", "lastClr"]);
            }
            //console.log(color)
            return color;
        }

        function extractChartData(serNode) {

            var dataMat = new Array();

            if (serNode === undefined) {
                return dataMat;
            }

            if (serNode["c:xVal"] !== undefined) {
                var dataRow = new Array();
                eachElement(serNode["c:xVal"]["c:numRef"]["c:numCache"]["c:pt"], function (innerNode, index) {
                    dataRow.push(parseFloat(innerNode["c:v"]));
                    return "";
                });
                dataMat.push(dataRow);
                dataRow = new Array();
                eachElement(serNode["c:yVal"]["c:numRef"]["c:numCache"]["c:pt"], function (innerNode, index) {
                    dataRow.push(parseFloat(innerNode["c:v"]));
                    return "";
                });
                dataMat.push(dataRow);
            } else {
                eachElement(serNode, function (innerNode, index) {
                    var dataRow = new Array();
                    var colName = getTextByPathList(innerNode, ["c:tx", "c:strRef", "c:strCache", "c:pt", "c:v"]) || index;

                    // Category (string or number)
                    var rowNames = {};
                    if (getTextByPathList(innerNode, ["c:cat", "c:strRef", "c:strCache", "c:pt"]) !== undefined) {
                        eachElement(innerNode["c:cat"]["c:strRef"]["c:strCache"]["c:pt"], function (innerNode, index) {
                            rowNames[innerNode["attrs"]["idx"]] = innerNode["c:v"];
                            return "";
                        });
                    } else if (getTextByPathList(innerNode, ["c:cat", "c:numRef", "c:numCache", "c:pt"]) !== undefined) {
                        eachElement(innerNode["c:cat"]["c:numRef"]["c:numCache"]["c:pt"], function (innerNode, index) {
                            rowNames[innerNode["attrs"]["idx"]] = innerNode["c:v"];
                            return "";
                        });
                    }

                    // Value
                    if (getTextByPathList(innerNode, ["c:val", "c:numRef", "c:numCache", "c:pt"]) !== undefined) {
                        eachElement(innerNode["c:val"]["c:numRef"]["c:numCache"]["c:pt"], function (innerNode, index) {
                            dataRow.push({ x: innerNode["attrs"]["idx"], y: parseFloat(innerNode["c:v"]) });
                            return "";
                        });
                    }

                    dataMat.push({ key: colName, values: dataRow, xlabels: rowNames });
                    return "";
                });
            }

            return dataMat;
        }

        // ===== Node functions =====
        /**
         * getTextByPathStr
         * @param {Object} node
         * @param {string} pathStr
         */
        function getTextByPathStr(node, pathStr) {
            return getTextByPathList(node, pathStr.trim().split(/\s+/));
        }

        /**
         * getTextByPathList
         * @param {Object} node
         * @param {string Array} path
         */
        function getTextByPathList(node, path) {

            if (path.constructor !== Array) {
                throw Error("Error of path type! path is not array.");
            }

            if (node === undefined) {
                return undefined;
            }

            var l = path.length;
            for (var i = 0; i < l; i++) {
                node = node[path[i]];
                if (node === undefined) {
                    return undefined;
                }
            }

            return node;
        }

        /**
         * eachElement
         * @param {Object} node
         * @param {function} doFunction
         */
        function eachElement(node, doFunction) {
            if (node === undefined) {
                return;
            }
            var result = "";
            if (node.constructor === Array) {
                var l = node.length;
                for (var i = 0; i < l; i++) {
                    result += doFunction(node[i], i);
                }
            } else {
                result += doFunction(node, 0);
            }
            return result;
        }

        // ===== Color functions =====
        /**
         * applyShade
         * @param {string} rgbStr
         * @param {number} shadeValue
         */
        function applyShade(rgbStr, shadeValue) {
            var color = new colz.Color(rgbStr);
            color.setLum(color.hsl.l * shadeValue);
            return color.rgb.toString();
        }

        /**
         * applyTint
         * @param {string} rgbStr
         * @param {number} tintValue
         */
        function applyTint(rgbStr, tintValue) {
            var color = new colz.Color(rgbStr);
            color.setLum(color.hsl.l * tintValue + (1 - tintValue));
            return color.rgb.toString();
        }

        /**
         * applyLumModify
         * @param {string} rgbStr
         * @param {number} factor
         * @param {number} offset
         */
        function applyLumModify(rgbStr, factor, offset) {
            var color = new colz.Color(rgbStr);
            //color.setLum(color.hsl.l * factor);
            color.setLum(color.hsl.l * (1 + offset));
            return color.rgb.toString();
        }

        ///////////////////////Amir////////////////
        function angleToDegrees(angle) {
            if (angle == "" || angle == null) {
                return 0;
            }
            return Math.round(angle / 60000);
        }
        function getMimeType(imgFileExt) {
            var mimeType = "";
            //console.log(imgFileExt)
            switch (imgFileExt.toLowerCase()) {
                case "jpg":
                case "jpeg":
                    mimeType = "image/jpeg";
                    break;
                case "png":
                    mimeType = "image/png";
                    break;
                case "gif":
                    mimeType = "image/gif";
                    break;
                case "emf": // Not native support
                    mimeType = "image/x-emf";
                    break;
                case "wmf": // Not native support
                    mimeType = "image/x-wmf";
                    break;
                case "svg":
                    mimeType = "image/svg+xml";
                    break;
                case "mp4":
                    mimeType = "video/mp4";
                    break;
                case "webm":
                    mimeType = "video/webm";
                    break;
                case "ogg":
                    mimeType = "video/ogg";
                    break;
                case "avi":
                    mimeType = "video/avi";
                    break;
                case "mpg":
                    mimeType = "video/mpg";
                    break;
                case "wmv":
                    mimeType = "video/wmv";
                    break;
                case "mp3":
                    mimeType = "audio/mpeg";
                    break;
                case "wav":
                    mimeType = "audio/wav";
                    break;
            }
            return mimeType;
        }
        function getSvgGradient(w, h, angl, color_arry, shpId) {
            var stopsArray = getMiddleStops(color_arry.length - 2);

            var svgAngle = '',
                svgHeight = h,
                svgWidth = w,
                svg = '',
                xy_ary = SVGangle(angl, svgHeight, svgWidth),
                x1 = xy_ary[0],
                y1 = xy_ary[1],
                x2 = xy_ary[2],
                y2 = xy_ary[3];

            var sal = stopsArray.length,
                sr = sal < 20 ? 100 : 1000;
            svgAngle = ' gradientUnits="userSpaceOnUse" x1="' + x1 + '%" y1="' + y1 + '%" x2="' + x2 + '%" y2="' + y2 + '%"';
            svgAngle = '<linearGradient id="linGrd_' + shpId + '"' + svgAngle + '>\n';
            svg += svgAngle;

            for (var i = 0; i < sal; i++) {
                svg += '<stop offset="' + Math.round(parseFloat(stopsArray[i]) / 100 * sr) / sr + '" stop-color="' + color_arry[i] + '"';
                svg += '/>\n'
            }

            svg += '</linearGradient>\n' + '';

            return svg
        }
        function getMiddleStops(s) {
            var sArry = ['0%', '100%'];
            if (s == 0) {
                return true
            } else {
                var i = s;
                while (i--) {
                    var middleStop = 100 - ((100 / (s + 1)) * (i + 1)), // AM: Ex - For 3 middle stops, progression will be 25%, 50%, and 75%, plus 0% and 100% at the ends.
                        middleStopString = middleStop + "%";
                    sArry.splice(-1, 0, middleStopString);
                } // AM: add into stopsArray before 100%
            }
            return sArry
        }
        function SVGangle(deg, svgHeight, svgWidth) {
            var w = parseFloat(svgWidth),
                h = parseFloat(svgHeight),
                ang = parseFloat(deg),
                o = 2,
                n = 2,
                wc = w / 2,
                hc = h / 2,
                tx1 = 2,
                ty1 = 2,
                tx2 = 2,
                ty2 = 2,
                k = (((ang % 360) + 360) % 360),
                j = (360 - k) * Math.PI / 180,
                i = Math.tan(j),
                l = hc - i * wc;

            if (k == 0) {
                tx1 = w,
                    ty1 = hc,
                    tx2 = 0,
                    ty2 = hc
            } else if (k < 90) {
                n = w,
                    o = 0
            } else if (k == 90) {
                tx1 = wc,
                    ty1 = 0,
                    tx2 = wc,
                    ty2 = h
            } else if (k < 180) {
                n = 0,
                    o = 0
            } else if (k == 180) {
                tx1 = 0,
                    ty1 = hc,
                    tx2 = w,
                    ty2 = hc
            } else if (k < 270) {
                n = 0,
                    o = h
            } else if (k == 270) {
                tx1 = wc,
                    ty1 = h,
                    tx2 = wc,
                    ty2 = 0
            } else {
                n = w,
                    o = h;
            }
            // AM: I could not quite figure out what m, n, and o are supposed to represent from the original code on visualcsstools.com.
            var m = o + (n / i),
                tx1 = tx1 == 2 ? i * (m - l) / (Math.pow(i, 2) + 1) : tx1,
                ty1 = ty1 == 2 ? i * tx1 + l : ty1,
                tx2 = tx2 == 2 ? w - tx1 : tx2,
                ty2 = ty2 == 2 ? h - ty1 : ty2,
                x1 = Math.round(tx2 / w * 100 * 100) / 100,
                y1 = Math.round(ty2 / h * 100 * 100) / 100,
                x2 = Math.round(tx1 / w * 100 * 100) / 100,
                y2 = Math.round(ty1 / h * 100 * 100) / 100;
            return [x1, y1, x2, y2];
        }
        function getSvgImagePattern(fillColor, shpId) {
            var ptrn = '<pattern id="imgPtrn_' + shpId + '"  patternContentUnits="objectBoundingBox"  width="1" height="1">';
            //console.log("fillColor: ", fillColor)
            fillColor = escapeHtml(fillColor);
            ptrn += '<image  xlink:href="' + fillColor + '" preserveAspectRatio="none" width="1" height="1"></image>';
            ptrn += '</pattern>';
            return ptrn;
        }

        function processMsgQueue(queue) {
            for (var i = 0; i < queue.length; i++) {
                processSingleMsg(queue[i].data);
            }
        }

        function processSingleMsg(d) {

            var chartID = d.chartID;
            var chartType = d.chartType;
            var chartData = d.chartData;

            var data = [];

            var chart = null;
            switch (chartType) {
                case "lineChart":
                    data = chartData;
                    chart = nv.models.lineChart()
                        .useInteractiveGuideline(true);
                    chart.xAxis.tickFormat(function (d) { return chartData[0].xlabels[d] || d; });
                    break;
                case "barChart":
                    data = chartData;
                    chart = nv.models.multiBarChart();
                    chart.xAxis.tickFormat(function (d) { return chartData[0].xlabels[d] || d; });
                    break;
                case "pieChart":
                case "pie3DChart":
                    data = chartData[0].values;
                    chart = nv.models.pieChart();
                    break;
                case "areaChart":
                    data = chartData;
                    chart = nv.models.stackedAreaChart()
                        .clipEdge(true)
                        .useInteractiveGuideline(true);
                    chart.xAxis.tickFormat(function (d) { return chartData[0].xlabels[d] || d; });
                    break;
                case "scatterChart":

                    for (var i = 0; i < chartData.length; i++) {
                        var arr = [];
                        for (var j = 0; j < chartData[i].length; j++) {
                            arr.push({ x: j, y: chartData[i][j] });
                        }
                        data.push({ key: 'data' + (i + 1), values: arr });
                    }

                    //data = chartData;
                    chart = nv.models.scatterChart()
                        .showDistX(true)
                        .showDistY(true)
                        .color(d3.scale.category10().range());
                    chart.xAxis.axisLabel('X').tickFormat(d3.format('.02f'));
                    chart.yAxis.axisLabel('Y').tickFormat(d3.format('.02f'));
                    break;
                default:
            }

            if (chart !== null) {

                d3.select("#" + chartID)
                    .append("svg")
                    .datum(data)
                    .transition().duration(500)
                    .call(chart);

                nv.utils.windowResize(chart.update);
                isDone = true;
            }

        }

        function setNumericBullets(elem) {
            var prgrphs_arry = elem;
            for (var i = 0; i < prgrphs_arry.length; i++) {
                var buSpan = $(prgrphs_arry[i]).find('.numeric-bullet-style');
                if (buSpan.length > 0) {
                    //console.log("DIV-"+i+":");
                    var prevBultTyp = "";
                    var prevBultLvl = "";
                    var buletIndex = 0;
                    var tmpArry = new Array();
                    var tmpArryIndx = 0;
                    var buletTypSrry = new Array();
                    for (var j = 0; j < buSpan.length; j++) {
                        var bult_typ = $(buSpan[j]).data("bulltname");
                        var bult_lvl = $(buSpan[j]).data("bulltlvl");
                        //console.log(j+" - "+bult_typ+" lvl: "+bult_lvl );
                        if (buletIndex == 0) {
                            prevBultTyp = bult_typ;
                            prevBultLvl = bult_lvl;
                            tmpArry[tmpArryIndx] = buletIndex;
                            buletTypSrry[tmpArryIndx] = bult_typ;
                            buletIndex++;
                        } else {
                            if (bult_typ == prevBultTyp && bult_lvl == prevBultLvl) {
                                prevBultTyp = bult_typ;
                                prevBultLvl = bult_lvl;
                                buletIndex++;
                                tmpArry[tmpArryIndx] = buletIndex;
                                buletTypSrry[tmpArryIndx] = bult_typ;
                            } else if (bult_typ != prevBultTyp && bult_lvl == prevBultLvl) {
                                prevBultTyp = bult_typ;
                                prevBultLvl = bult_lvl;
                                tmpArryIndx++;
                                tmpArry[tmpArryIndx] = buletIndex;
                                buletTypSrry[tmpArryIndx] = bult_typ;
                                buletIndex = 1;
                            } else if (bult_typ != prevBultTyp && Number(bult_lvl) > Number(prevBultLvl)) {
                                prevBultTyp = bult_typ;
                                prevBultLvl = bult_lvl;
                                tmpArryIndx++;
                                tmpArry[tmpArryIndx] = buletIndex;
                                buletTypSrry[tmpArryIndx] = bult_typ;
                                buletIndex = 1;
                            } else if (bult_typ != prevBultTyp && Number(bult_lvl) < Number(prevBultLvl)) {
                                prevBultTyp = bult_typ;
                                prevBultLvl = bult_lvl;
                                tmpArryIndx--;
                                buletIndex = tmpArry[tmpArryIndx] + 1;
                            }
                        }
                        //console.log(buletTypSrry[tmpArryIndx]+" - "+buletIndex);
                        var numIdx = getNumTypeNum(buletTypSrry[tmpArryIndx], buletIndex);
                        $(buSpan[j]).html(numIdx);
                    }
                }
            }
        }
        function getNumTypeNum(numTyp, num) {
            var rtrnNum = "";
            switch (numTyp) {
                case "arabicPeriod":
                    rtrnNum = num + ". ";
                    break;
                case "arabicParenR":
                    rtrnNum = num + ") ";
                    break;
                case "alphaLcParenR":
                    rtrnNum = alphaNumeric(num, "lowerCase") + ") ";
                    break;
                case "alphaLcPeriod":
                    rtrnNum = alphaNumeric(num, "lowerCase") + ". ";
                    break;

                case "alphaUcParenR":
                    rtrnNum = alphaNumeric(num, "upperCase") + ") ";
                    break;
                case "alphaUcPeriod":
                    rtrnNum = alphaNumeric(num, "upperCase") + ". ";
                    break;

                case "romanUcPeriod":
                    rtrnNum = romanize(num) + ". ";
                    break;
                case "romanLcParenR":
                    rtrnNum = romanize(num) + ") ";
                    break;
                case "hebrew2Minus":
                    rtrnNum = hebrew2Minus.format(num) + "-";
                    break;
                default:
                    rtrnNum = num;
            }
            return rtrnNum;
        }
        function romanize(num) {
            if (!+num)
                return false;
            var digits = String(+num).split(""),
                key = ["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM",
                    "", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC",
                    "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"],
                roman = "",
                i = 3;
            while (i--)
                roman = (key[+digits.pop() + (i * 10)] || "") + roman;
            return Array(+digits.join("") + 1).join("M") + roman;
        }
        var hebrew2Minus = archaicNumbers([
            [1000, ''],
            [400, 'ת'],
            [300, 'ש'],
            [200, 'ר'],
            [100, 'ק'],
            [90, 'צ'],
            [80, 'פ'],
            [70, 'ע'],
            [60, 'ס'],
            [50, 'נ'],
            [40, 'מ'],
            [30, 'ל'],
            [20, 'כ'],
            [10, 'י'],
            [9, 'ט'],
            [8, 'ח'],
            [7, 'ז'],
            [6, 'ו'],
            [5, 'ה'],
            [4, 'ד'],
            [3, 'ג'],
            [2, 'ב'],
            [1, 'א'],
            [/יה/, 'ט״ו'],
            [/יו/, 'ט״ז'],
            [/([א-ת])([א-ת])$/, '$1״$2'],
            [/^([א-ת])$/, "$1׳"]
        ]);
        function archaicNumbers(arr) {
            var arrParse = arr.slice().sort(function (a, b) { return b[1].length - a[1].length });
            return {
                format: function (n) {
                    var ret = '';
                    jQuery.each(arr, function () {
                        var num = this[0];
                        if (parseInt(num) > 0) {
                            for (; n >= num; n -= num) ret += this[1];
                        } else {
                            ret = ret.replace(num, this[1]);
                        }
                    });
                    return ret;
                }
            }
        }
        function alphaNumeric(num, upperLower) {
            num = Number(num) - 1;
            var aNum = "";
            if (upperLower == "upperCase") {
                aNum = (((num / 26 >= 1) ? String.fromCharCode(num / 26 + 64) : '') + String.fromCharCode(num % 26 + 65)).toUpperCase();
            } else if (upperLower == "lowerCase") {
                aNum = (((num / 26 >= 1) ? String.fromCharCode(num / 26 + 64) : '') + String.fromCharCode(num % 26 + 65)).toLowerCase();
            }
            return aNum;
        }
        function base64ArrayBuffer(arrayBuffer) {
            var base64 = '';
            var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            var bytes = new Uint8Array(arrayBuffer);
            var byteLength = bytes.byteLength;
            var byteRemainder = byteLength % 3;
            var mainLength = byteLength - byteRemainder;

            var a, b, c, d;
            var chunk;

            for (var i = 0; i < mainLength; i = i + 3) {
                chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
                a = (chunk & 16515072) >> 18;
                b = (chunk & 258048) >> 12;
                c = (chunk & 4032) >> 6;
                d = chunk & 63;
                base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
            }

            if (byteRemainder == 1) {
                chunk = bytes[mainLength];
                a = (chunk & 252) >> 2;
                b = (chunk & 3) << 4;
                base64 += encodings[a] + encodings[b] + '==';
            } else if (byteRemainder == 2) {
                chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
                a = (chunk & 64512) >> 10;
                b = (chunk & 1008) >> 4;
                c = (chunk & 15) << 2;
                base64 += encodings[a] + encodings[b] + encodings[c] + '=';
            }

            return base64;
        }

        function extractFileExtension(filename) {
            return filename.substr((~-filename.lastIndexOf(".") >>> 0) + 2);
        }

        function escapeHtml(text) {
            var map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text.replace(/[&<>"']/g, function (m) { return map[m]; });
        }
        /////////////////////////////////////tXml///////////////////////////
        /*
        This is my custom tXml.js file
        */
        function tXml(t, r) { "use strict"; function e() { for (var r = []; t[l];)if (t.charCodeAt(l) == s) { if (t.charCodeAt(l + 1) === h) return l = t.indexOf(u, l), l + 1 && (l += 1), r; if (t.charCodeAt(l + 1) === v) { if (t.charCodeAt(l + 2) == m) { for (; -1 !== l && (t.charCodeAt(l) !== d || t.charCodeAt(l - 1) != m || t.charCodeAt(l - 2) != m || -1 == l);)l = t.indexOf(u, l + 1); -1 === l && (l = t.length) } else for (l += 2; t.charCodeAt(l) !== d && t[l];)l++; l++; continue } var e = a(); r.push(e) } else { var i = n(); i.trim().length > 0 && r.push(i), l++ } return r } function n() { var r = l; return l = t.indexOf(c, l) - 1, -2 === l && (l = t.length), t.slice(r, l + 1) } function i() { for (var r = l; -1 === A.indexOf(t[l]) && t[l];)l++; return t.slice(r, l) } function a() { var r = {}; l++, r.tagName = i(); for (var n = !1; t.charCodeAt(l) !== d && t[l];) { var a = t.charCodeAt(l); if (a > 64 && 91 > a || a > 96 && 123 > a) { for (var f = i(), c = t.charCodeAt(l); c && c !== p && c !== g && !(c > 64 && 91 > c || c > 96 && 123 > c) && c !== d;)l++, c = t.charCodeAt(l); if (n || (r.attributes = {}, n = !0), c === p || c === g) { var s = o(); if (-1 === l) return r } else s = null, l--; r.attributes[f] = s } l++ } if (t.charCodeAt(l - 1) !== h) if ("script" == r.tagName) { var u = l + 1; l = t.indexOf("</script>", l), r.children = [t.slice(u, l - 1)], l += 8 } else if ("style" == r.tagName) { var u = l + 1; l = t.indexOf("</style>", l), r.children = [t.slice(u, l - 1)], l += 7 } else -1 == C.indexOf(r.tagName) && (l++, r.children = e(f)); else l++; return r } function o() { var r = t[l], e = ++l; return l = t.indexOf(r, e), t.slice(e, l) } function f() { var e = new RegExp("\\s" + r.attrName + "\\s*=['\"]" + r.attrValue + "['\"]").exec(t); return e ? e.index : -1 } r = r || {}; var l = r.pos || 0, c = "<", s = "<".charCodeAt(0), u = ">", d = ">".charCodeAt(0), m = "-".charCodeAt(0), h = "/".charCodeAt(0), v = "!".charCodeAt(0), p = "'".charCodeAt(0), g = '"'.charCodeAt(0), A = "\n	>/= ", C = ["img", "br", "input", "meta", "link"], y = null; if (void 0 !== r.attrValue) { r.attrName = r.attrName || "id"; for (var y = []; -1 !== (l = f());)l = t.lastIndexOf("<", l), -1 !== l && y.push(a()), t = t.substr(l), l = 0 } else y = r.parseNode ? a() : e(); return r.filter && (y = tXml.filter(y, r.filter)), r.simplify && (y = tXml.simplify(y)), y.pos = l, y } var _order = 1; tXml.simplify = function (t) { var r = {}; if (void 0 === t) return {}; if (1 === t.length && "string" == typeof t[0]) return t[0]; t.forEach(function (t) { if ("object" == typeof t) { r[t.tagName] || (r[t.tagName] = []); var e = tXml.simplify(t.children || []); r[t.tagName].push(e), t.attributes && (e.attrs = t.attributes), void 0 === e.attrs ? e.attrs = { order: _order } : e.attrs.order = _order, _order++ } }); for (var e in r) 1 == r[e].length && (r[e] = r[e][0]); return r }, tXml.filter = function (t, r) { var e = []; return t.forEach(function (t) { if ("object" == typeof t && r(t) && e.push(t), t.children) { var n = tXml.filter(t.children, r); e = e.concat(n) } }), e }, tXml.stringify = function (t) { function r(t) { if (t) for (var r = 0; r < t.length; r++)"string" == typeof t[r] ? n += t[r].trim() : e(t[r]) } function e(t) { n += "<" + t.tagName; for (var e in t.attributes) n += null === t.attributes[e] ? " " + e : -1 === t.attributes[e].indexOf('"') ? " " + e + '="' + t.attributes[e].trim() + '"' : " " + e + "='" + t.attributes[e].trim() + "'"; n += ">", r(t.children), n += "</" + t.tagName + ">" } var n = ""; return r(t), n }, tXml.toContentString = function (t) { if (Array.isArray(t)) { var r = ""; return t.forEach(function (t) { r += " " + tXml.toContentString(t), r = r.trim() }), r } return "object" == typeof t ? tXml.toContentString(t.children) : " " + t }, tXml.getElementById = function (t, r, e) { var n = tXml(t, { attrValue: r, simplify: e }); return e ? n : n[0] }, tXml.getElementsByClassName = function (t, r, e) { return tXml(t, { attrName: "class", attrValue: "[a-zA-Z0-9-s ]*" + r + "[a-zA-Z0-9-s ]*", simplify: e }) }, tXml.parseStream = function (t, r) { if ("function" == typeof r && (cb = r, r = 0), "string" == typeof r && (r = r.length + 2), "string" == typeof t) { var e = require("fs"); t = e.createReadStream(t, { start: r }), r = 0 } var n = r, i = "", a = 0; return t.on("data", function (r) { a++, i += r; for (var e = 0; ;) { n = i.indexOf("<", n) + 1; var o = tXml(i, { pos: n, parseNode: !0 }); if (n = o.pos, n > i.length - 1 || e > n) return void (e && (i = i.slice(e), n = 0, e = 0)); t.emit("xml", o), e = n } i = i.slice(n), n = 0 }), t.on("end", function () { console.log("end") }), t }, "object" == typeof module && (module.exports = tXml);
    };

    /*!
    JSZipUtils - A collection of cross-browser utilities to go along with JSZip.
    <http://stuk.github.io/jszip-utils>
    (c) 2014 Stuart Knightley, David Duponchel
    Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip-utils/master/LICENSE.markdown.
    */
    !function (a) { "object" == typeof exports ? module.exports = a() : "function" == typeof define && define.amd ? define(a) : "undefined" != typeof window ? window.JSZipUtils = a() : "undefined" != typeof global ? global.JSZipUtils = a() : "undefined" != typeof self && (self.JSZipUtils = a()) }(function () { return function a(b, c, d) { function e(g, h) { if (!c[g]) { if (!b[g]) { var i = "function" == typeof require && require; if (!h && i) return i(g, !0); if (f) return f(g, !0); throw new Error("Cannot find module '" + g + "'") } var j = c[g] = { exports: {} }; b[g][0].call(j.exports, function (a) { var c = b[g][1][a]; return e(c ? c : a) }, j, j.exports, a, b, c, d) } return c[g].exports } for (var f = "function" == typeof require && require, g = 0; g < d.length; g++)e(d[g]); return e }({ 1: [function (a, b) { "use strict"; function c() { try { return new window.XMLHttpRequest } catch (a) { } } function d() { try { return new window.ActiveXObject("Microsoft.XMLHTTP") } catch (a) { } } var e = {}; e._getBinaryFromXHR = function (a) { return a.response || a.responseText }; var f = window.ActiveXObject ? function () { return c() || d() } : c; e.getBinaryContent = function (a, b) { try { var c = f(); c.open("GET", a, !0), "responseType" in c && (c.responseType = "arraybuffer"), c.overrideMimeType && c.overrideMimeType("text/plain; charset=x-user-defined"), c.onreadystatechange = function () { var d, f; if (4 === c.readyState) if (200 === c.status || 0 === c.status) { d = null, f = null; try { d = e._getBinaryFromXHR(c) } catch (g) { f = new Error(g) } b(f, d) } else b(new Error("Ajax error for " + a + " : " + this.status + " " + this.statusText), null) }, c.send() } catch (d) { b(new Error(d), null) } }, b.exports = e }, {}] }, {}, [1])(1) });

    /**
     * Colorz (or Colz) is a Javascript "library" to help
     * in color conversion between the usual color-spaces
     * Hex - Rgb - Hsl / Hsv - Hsb
     *
     * It provides some helpers to output Canvas / CSS
     * color strings.
     *
     * by Carlos Cabo 2013
     * http://carloscabo.com
     *
     * Some formulas borrowed from Wikipedia or other authors.
    */

    (function (name, definition) {
        if (typeof define === "function") {
            define(definition);
        } else if (typeof module !== "undefined" && module.exports) {
            module.exports = definition();
        } else {
            var theModule = definition(),
                global = this,
                old = global[name];
            theModule.noConflict = function () {
                global[name] = old;
                return theModule;
            };
            global[name] = theModule;
        }
    })("colz", function () {
        var round = Math.round,
            toString = "toString",
            colz = colz || {},
            Rgb,
            Rgba,
            Hsl,
            Hsla,
            Color,
            ColorScheme,
            hexToRgb,
            componentToHex,
            rgbToHex,
            rgbToHsl,
            hue2rgb,
            hslToRgb,
            rgbToHsb,
            hsbToRgb,
            hsbToHsl,
            hsvToHsl,
            hsvToRgb,
            randomColor;
        Rgb = colz.Rgb = function (col) {
            this.r = col[0];
            this.g = col[1];
            this.b = col[2];
        };
        Rgb.prototype[toString] = function () {
            return "rgb(" + this.r + "," + this.g + "," + this.b + ")";
        };
        Rgba = colz.Rgba = function (col) {
            this.r = col[0];
            this.g = col[1];
            this.b = col[2];
            this.a = col[3];
        };
        Rgba.prototype[toString] = function () {
            return (
                "rgba(" + this.r + "," + this.g + "," + this.b + "," + this.a + ")"
            );
        };
        Hsl = colz.Hsl = function (col) {
            this.h = col[0];
            this.s = col[1];
            this.l = col[2];
        };
        Hsl.prototype[toString] = function () {
            return "hsl(" + this.h + "," + this.s + "%," + this.l + "%)";
        };
        Hsla = colz.Hsla = function (col) {
            this.h = col[0];
            this.s = col[1];
            this.l = col[2];
            this.a = col[3];
        };
        Hsla.prototype[toString] = function () {
            return (
                "hsla(" + this.h + "," + this.s + "%," + this.l + "%," + this.a + ")"
            );
        };
        Color = colz.Color = function () {
            this.hex = this.r = this.g = this.b = this.h = this.s = this.l = this.a = this.hsl = this.hsla = this.rgb = this.rgba = null;
            this.init(arguments);
        };
        var colorPrototype = Color.prototype;
        colorPrototype.init = function (arg) {
            var _this = this;
            if (typeof arg[0] === "string") {
                if (arg[0].charAt(0) !== "#") {
                    arg[0] = "#" + arg[0];
                }
                if (arg[0].length < 7) {
                    arg[0] =
                        "#" +
                        arg[0][1] +
                        arg[0][1] +
                        arg[0][2] +
                        arg[0][2] +
                        arg[0][3] +
                        arg[0][3];
                }
                _this.hex = arg[0].toLowerCase();
                _this.rgb = new Rgb(hexToRgb(_this.hex));
                _this.r = _this.rgb.r;
                _this.g = _this.rgb.g;
                _this.b = _this.rgb.b;
                _this.a = 1;
                _this.rgba = new Rgba([_this.r, _this.g, _this.b, _this.a]);
            }
            if (typeof arg[0] === "number") {
                _this.r = arg[0];
                _this.g = arg[1];
                _this.b = arg[2];
                if (typeof arg[3] === "undefined") {
                    _this.a = 1;
                } else {
                    _this.a = arg[3];
                }
                _this.rgb = new Rgb([_this.r, _this.g, _this.b]);
                _this.rgba = new Rgba([_this.r, _this.g, _this.b, _this.a]);
                _this.hex = rgbToHex([_this.r, _this.g, _this.b]);
            }
            if (arg[0] instanceof Array) {
                _this.r = arg[0][0];
                _this.g = arg[0][1];
                _this.b = arg[0][2];
                if (typeof arg[0][3] === "undefined") {
                    _this.a = 1;
                } else {
                    _this.a = arg[0][3];
                }
                _this.rgb = new Rgb([_this.r, _this.g, _this.b]);
                _this.rgba = new Rgba([_this.r, _this.g, _this.b, _this.a]);
                _this.hex = rgbToHex([_this.r, _this.g, _this.b]);
            }
            _this.hsl = new Hsl(colz.rgbToHsl([_this.r, _this.g, _this.b]));
            _this.h = _this.hsl.h;
            _this.s = _this.hsl.s;
            _this.l = _this.hsl.l;
            _this.hsla = new Hsla([_this.h, _this.s, _this.l, _this.a]);
        };
        colorPrototype.setHue = function (newhue) {
            var _this = this;
            _this.h = newhue;
            _this.hsl.h = newhue;
            _this.hsla.h = newhue;
            _this.updateFromHsl();
        };
        colorPrototype.setSat = function (newsat) {
            var _this = this;
            _this.s = newsat;
            _this.hsl.s = newsat;
            _this.hsla.s = newsat;
            _this.updateFromHsl();
        };
        colorPrototype.setLum = function (newlum) {
            var _this = this;
            _this.l = newlum;
            _this.hsl.l = newlum;
            _this.hsla.l = newlum;
            _this.updateFromHsl();
        };
        colorPrototype.setAlpha = function (newalpha) {
            this.a = newalpha;
            this.hsla.a = newalpha;
            this.rgba.a = newalpha;
        };
        colorPrototype.updateFromHsl = function () {
            this.rgb = null;
            this.rgb = new Rgb(colz.hslToRgb([this.h, this.s, this.l]));
            this.r = this.rgb.r;
            this.g = this.rgb.g;
            this.b = this.rgb.b;
            this.rgba.r = this.rgb.r;
            this.rgba.g = this.rgb.g;
            this.rgba.b = this.rgb.b;
            this.hex = null;
            this.hex = rgbToHex([this.r, this.g, this.b]);
        };
        randomColor = colz.randomColor = function () {
            var r = "#" + Math.random().toString(16).slice(2, 8);
            return new Color(r);
        };
        hexToRgb = colz.hexToRgb = function (hex) {
            var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result
                ? [
                    parseInt(result[1], 16),
                    parseInt(result[2], 16),
                    parseInt(result[3], 16)
                ]
                : null;
        };
        componentToHex = colz.componentToHex = function (c) {
            var hex = c.toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        };
        rgbToHex = colz.rgbToHex = function () {
            var arg, r, g, b;
            arg = arguments;
            if (arg.length > 1) {
                r = arg[0];
                g = arg[1];
                b = arg[2];
            } else {
                r = arg[0][0];
                g = arg[0][1];
                b = arg[0][2];
            }
            return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
        };
        rgbToHsl = colz.rgbToHsl = function () {
            var arg, r, g, b, h, s, l, d, max, min;
            arg = arguments;
            if (typeof arg[0] === "number") {
                r = arg[0];
                g = arg[1];
                b = arg[2];
            } else {
                r = arg[0][0];
                g = arg[0][1];
                b = arg[0][2];
            }
            r /= 255;
            g /= 255;
            b /= 255;
            max = Math.max(r, g, b);
            min = Math.min(r, g, b);
            l = (max + min) / 2;
            if (max === min) {
                h = s = 0;
            } else {
                d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r:
                        h = (g - b) / d + (g < b ? 6 : 0);
                        break;
                    case g:
                        h = (b - r) / d + 2;
                        break;
                    case b:
                        h = (r - g) / d + 4;
                        break;
                }
                h /= 6;
            }
            h = round(h * 360);
            s = round(s * 100);
            l = round(l * 100);
            return [h, s, l];
        };
        hue2rgb = colz.hue2rgb = function (p, q, t) {
            if (t < 0) {
                t += 1;
            }
            if (t > 1) {
                t -= 1;
            }
            if (t < 1 / 6) {
                return p + (q - p) * 6 * t;
            }
            if (t < 1 / 2) {
                return q;
            }
            if (t < 2 / 3) {
                return p + (q - p) * (2 / 3 - t) * 6;
            }
            return p;
        };
        hslToRgb = colz.hslToRgb = function () {
            var arg, r, g, b, h, s, l, q, p;
            arg = arguments;
            if (typeof arg[0] === "number") {
                h = arg[0] / 360;
                s = arg[1] / 100;
                l = arg[2] / 100;
            } else {
                h = arg[0][0] / 360;
                s = arg[0][1] / 100;
                l = arg[0][2] / 100;
            }
            if (s === 0) {
                r = g = b = l;
            } else {
                q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                p = 2 * l - q;
                r = colz.hue2rgb(p, q, h + 1 / 3);
                g = colz.hue2rgb(p, q, h);
                b = colz.hue2rgb(p, q, h - 1 / 3);
            }
            return [round(r * 255), round(g * 255), round(b * 255)];
        };
        rgbToHsb = colz.rgbToHsb = function (r, g, b) {
            var max, min, h, s, v, d;
            r = r / 255;
            g = g / 255;
            b = b / 255;
            max = Math.max(r, g, b);
            min = Math.min(r, g, b);
            v = max;
            d = max - min;
            s = max === 0 ? 0 : d / max;
            if (max === min) {
                h = 0;
            } else {
                switch (max) {
                    case r:
                        h = (g - b) / d + (g < b ? 6 : 0);
                        break;
                    case g:
                        h = (b - r) / d + 2;
                        break;
                    case b:
                        h = (r - g) / d + 4;
                        break;
                }
                h /= 6;
            }
            h = round(h * 360);
            s = round(s * 100);
            v = round(v * 100);
            return [h, s, v];
        };
        hsbToRgb = colz.hsbToRgb = function (h, s, v) {
            var r, g, b, i, f, p, q, t;
            if (v === 0) {
                return [0, 0, 0];
            }
            s = s / 100;
            v = v / 100;
            h = h / 60;
            i = Math.floor(h);
            f = h - i;
            p = v * (1 - s);
            q = v * (1 - s * f);
            t = v * (1 - s * (1 - f));
            if (i === 0) {
                r = v;
                g = t;
                b = p;
            } else if (i === 1) {
                r = q;
                g = v;
                b = p;
            } else if (i === 2) {
                r = p;
                g = v;
                b = t;
            } else if (i === 3) {
                r = p;
                g = q;
                b = v;
            } else if (i === 4) {
                r = t;
                g = p;
                b = v;
            } else if (i === 5) {
                r = v;
                g = p;
                b = q;
            }
            r = Math.floor(r * 255);
            g = Math.floor(g * 255);
            b = Math.floor(b * 255);
            return [r, g, b];
        };
        hsbToHsl = colz.hsbToHsl = function (h, s, b) {
            return colz.rgbToHsl(colz.hsbToRgb(h, s, b));
        };
        hsvToHsl = colz.hsvToHsl = colz.hsbToHsl;
        hsvToRgb = colz.hsvToRgb = colz.hsbToRgb;
        ColorScheme = colz.ColorScheme = function (color_val, angle_array) {
            this.palette = [];
            if (angle_array === undefined && color_val instanceof Array) {
                this.createFromColors(color_val);
            } else {
                this.createFromAngles(color_val, angle_array);
            }
        };
        var colorSchemePrototype = ColorScheme.prototype;
        colorSchemePrototype.createFromColors = function (color_val) {
            for (var i in color_val) {
                if (color_val.hasOwnProperty(i)) {
                    this.palette.push(new Color(color_val[i]));
                }
            }
            return this.palette;
        };
        colorSchemePrototype.createFromAngles = function (color_val, angle_array) {
            this.palette.push(new Color(color_val));
            for (var i in angle_array) {
                if (angle_array.hasOwnProperty(i)) {
                    var tempHue = (this.palette[0].h + angle_array[i]) % 360;
                    this.palette.push(
                        new Color(
                            colz.hslToRgb([tempHue, this.palette[0].s, this.palette[0].l])
                        )
                    );
                }
            }
            return this.palette;
        };
        ColorScheme.Compl = function (color_val) {
            return new ColorScheme(color_val, [180]);
        };
        ColorScheme.Triad = function (color_val) {
            return new ColorScheme(color_val, [120, 240]);
        };
        ColorScheme.Tetrad = function (color_val) {
            return new ColorScheme(color_val, [60, 180, 240]);
        };
        ColorScheme.Analog = function (color_val) {
            return new ColorScheme(color_val, [-45, 45]);
        };
        ColorScheme.Split = function (color_val) {
            return new ColorScheme(color_val, [150, 210]);
        };
        ColorScheme.Accent = function (color_val) {
            return new ColorScheme(color_val, [-45, 45, 180]);
        };
        return colz;
    });
}(jQuery));
