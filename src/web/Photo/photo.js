/*
    Photo.js

    Author: tobychui
    This is a complete rewrite of the legacy Photo module for ArozOS

*/

let photoList = [];
let prePhoto = "";
let nextPhoto = "";
let currentModel = "";

function scrollbarVisable(){
    return $("body")[0].scrollHeight > $("body").height();
}

function getImageWidth(){
    let boxCount = 4;
    if (window.innerWidth < 500) {
        boxCount = 3;
    } else if (window.innerWidth < 800) {
        boxCount = 4;
    } else if (window.innerWidth < 1200) {
        boxCount = 5;
    }else if (window.innerWidth < 1600){
        boxCount = 6;
    } else {
        boxCount = 8;
    }

    let offsets = 2;
    if (scrollbarVisable()){
        offsets = offsets * 1.2;
    }

    return window.innerWidth / boxCount - offsets;
}

function updateImageSizes(){
    let newImageWidth = getImageWidth();
    console.log(newImageWidth, $("#viewbox").width());
    //Updates all the size of the images
    $(".imagecard").css({
        width: newImageWidth,
        height: newImageWidth
    });
}

function extractFolderName(folderpath){
    return folderpath.split("/").pop();
}

function parseExifValue(value) {
    if (typeof value === 'string' && value.includes('/')) {
        let parts = value.split('/');
        if (parts.length === 2) {
            let num = parseFloat(parts[0]);
            let den = parseFloat(parts[1]);
            if (den !== 0) {
                return num / den;
            }
        }
    }
    return parseFloat(value) || value;
}

function formatShutterSpeed(value) {
    let num = parseExifValue(value);
    if (num < 1) {
        return "1/" + Math.round(1 / num);
    } else {
        return num ;
    }
}

function photoListObject() {
    return {
        // data
        pathWildcard: "user:/Photo/*",
        currentPath: "user:/Photo",
        renderSize: 200,
        vroots: [],
        images: [],
        folders: [],
        viewMode: 'grid', // 'grid' or 'list'
        sortOrder: 'smart',
        restored: false,
        
        // init
        init() {
            this.getFolderInfo();
            this.getRootInfo();
            this.renderSize = getImageWidth();
            updateImageSizes();
            this.restored = false;
        },
        
        updateRenderingPath(newPath, callback = null){
            this.currentPath = JSON.parse(JSON.stringify(newPath));
            this.pathWildcard = newPath + '/*';
            if (this.pathWildcard.split("/").length == 3){
                //Root path already
                $("#parentFolderButton").hide();
            }else{
                $("#parentFolderButton").show();
            }
            this.restored = false;
            this.getFolderInfo(callback);
        },

        parentFolder(){
            var parentPath = JSON.parse(JSON.stringify(this.currentPath));
            parentPath = parentPath.split("/");
            parentPath.pop();
            this.currentPath = parentPath.join("/");
            this.updateRenderingPath( this.currentPath);
        },

        getFolderInfo(callback = null) {
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listFolder.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    "folder": this.pathWildcard,
                    "sort": this.sortOrder
                })
            }).then(resp => {
                resp.json().then(data => {
                    console.log(data);
                    this.folders = data[0];
                    this.images = data[1];

                    if (this.images.length == 0){
                        $("#noimg").show();
                    }else{
                        $("#noimg").hide();
                    }

                    if (this.folders.length == 0){
                        $("#nosubfolder").show();
                    }else{
                        $("#nosubfolder").hide();
                    }
                    console.log(this.folders);

                    if (!this.restored) { restoreFromHash(); this.restored = true; }
                    
                    if (callback) callback();
                });
            });
        },

        getRootInfo() {
            fetch(ao_root + "system/ajgi/interface?script=Photo/backend/listRoots.js", {
                method: 'POST',
                cache: 'no-cache',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            }).then(resp => {
                resp.json().then(data => {
                    this.vroots = data;
                    this.$nextTick(() => {
                        $('.ui.dropdown').dropdown();
                    });
                });
            })
        },

        toggleViewMode() {
            this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
            if (this.viewMode === 'grid') {
                this.renderSize = getImageWidth();
                updateImageSizes();
            }
        },

        changeSort(newSort) {
            this.sortOrder = newSort;
            this.getFolderInfo();
        }
    }
}

function renderImageList(object){
    var fd = $(object).attr("filedata");
    fd = JSON.parse(decodeURIComponent(fd));
    console.log(fd);
    
}

function ShowModal(){
    $('#photo-viewer').show();
}

function closeViewer(){
    $('#photo-viewer').hide();
    window.location.hash = '';
    ao_module_setWindowTitle("Photo");
    setTimeout(function(){
        $("#fullImage").attr("src","img/loading.png");
        $("#bg-image").attr("src","");
        $("#info-filename").text("");
        $("#info-filepath").text("");
        $("#info-dimensions").text("Loading...");
        
        // Reset EXIF data display
        $('#basic-info-section').hide();
        $('#shooting-params-section').hide();
        $('#tone-analysis-section').hide();
        $('#device-info-section').hide();
        $('#shooting-mode-section').hide();
        $('#technical-params-section').hide();
        $('#no-exif-message').hide();
        $('.ui.divider').hide();
        
        // Clear histogram canvas
        const canvas = document.getElementById('histogram-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }, 300);
}


function showImage(object){
    // Reset zoom level when switching photos
    if (typeof resetZoom === 'function') {
        resetZoom();
    }
    
    var fd = JSON.parse(decodeURIComponent($(object).attr("filedata")));
    // Update image dimensions and generate histogram when loaded
    $("#fullImage").off("load").on('load', function() {
        let width = this.naturalWidth;
        let height = this.naturalHeight;
        $("#info-dimensions").text(width + ' × ' + height + "px");

        // Wait for image to be ready, then generate histogram
        const canvas = document.getElementById('histogram-canvas');
        if (canvas) {
            generateHistogram(document.getElementById('fullImage'), canvas);
        }
    });

    let imageUrl = "../media?file=" + fd.filepath;
    $("#fullImage").attr('src', imageUrl);
    $("#bg-image").attr('src', imageUrl);
    $("#info-filename").text(fd.filename);
    $("#info-filepath").text(fd.filepath);
    
    var nextCard = $(object).next();
    var prevCard = $(object).prev();
    if (nextCard.length > 0){
        nextPhoto = nextCard[0];
    }else{
        nextPhoto = null;
    }

    if (prevCard.length > 0){
        prePhoto = prevCard[0];
    }else{
        prePhoto = null;
    }


    ao_module_setWindowTitle("Photo - " + fd.filename);

    window.location.hash = encodeURIComponent(JSON.stringify({filename: fd.filename, filepath: fd.filepath}));

    // Check for EXIF data
    fetch(ao_root + "system/ajgi/interface?script=Photo/backend/getExif.js", {
        method: 'POST',
        cache: 'no-cache',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "filepath": fd.filepath
        })
    }).then(resp => {
        resp.json().then(data => {
            formatExifData(data, fd);
        })
    }).catch(error => {
        console.error('Failed to fetch EXIF data:', error);
        formatExifData({}, fd); // Call with empty EXIF to show tone analysis
    });
}

$(document).on("keydown", function(e){
    if (e.keyCode == 27){ // Escape
        if ($('#photo-viewer').is(':visible')) {
            closeViewer();
        }
    } else if (e.keyCode == 37){
        //Left
        if (prePhoto != null){
            showImage(prePhoto);
        }
       
    }else if (e.keyCode == 39){
        //Right
        if (nextPhoto != null){
            showImage(nextPhoto);
        }
        
    }
})

function generateToneAnalysis(imageElement) {
    analysis_tone_types(imageElement, function(result) {
        if (result) {
            // Update tone type based on brightness, contrast, shadow and highlight ratios
            let toneType = get_tone_type(result.brightness, result.contrast, result.shadowRatio, result.highlightRatio);
            $('.tone-type-value').text(toneType);
            $('.brightness-value').text(result.brightness);
            $('.contrast-value').text(result.contrast);
            $('.shadow-ratio-value').text(result.shadowRatio);
            $('.highlight-ratio-value').text(result.highlightRatio);
        } else {
            $('.tone-type-value').text("N/A");
            $('.brightness-value').text("N/A");
            $('.contrast-value').text("N/A");
            $('.shadow-ratio-value').text("N/A");
            $('.highlight-ratio-value').text("N/A");
        }
    });
}

function formatExifData(exif, fileData) {
    // Hide all sections initially
    $('#basic-info-section').hide();
    $('#shooting-params-section').hide();
    $('#tone-analysis-section').hide();
    $('#device-info-section').hide();
    $('#shooting-mode-section').hide();
    $('#technical-params-section').hide();
    $('#no-exif-message').hide();

    // Hide all dividers
    $('.ui.divider').hide();

    if (!exif || Object.keys(exif).length === 0) {
        $('#no-exif-message').show();
        //Generate histogram and tone analysis only
        generateHistogram(document.getElementById('fullImage'), document.getElementById('histogram-canvas'));
        generateToneAnalysis(document.getElementById('fullImage'));
        $('#tone-analysis-section').show();
        return;
    }

    let sectionsShown = 0;

    // Section 1: Basic Information
    let basicInfoShown = false;
    if (fileData.filename) {
        let ext = fileData.filename.split('.').pop().toUpperCase();
        $('#format-value').text(ext);
        $('#format-row').show();
        basicInfoShown = true;
    } else {
        $('#format-row').hide();
    }

    if (exif.PixelXDimension && exif.PixelYDimension) {
        $('#dimensions-value').text(`${exif.PixelXDimension} × ${exif.PixelYDimension}`);
        $('#dimensions-row').show();
        let pixels = (exif.PixelXDimension * exif.PixelYDimension / 1000000).toFixed(1);
        $('#pixels-value').text(`${pixels} MP`);
        $('#pixels-row').show();
        basicInfoShown = true;
    } else {
        $('#dimensions-row').hide();
        $('#pixels-row').hide();
    }

    if (exif.ColorSpace !== undefined) {
        exif.ColorSpace = JSON.parse(exif.ColorSpace);
        let colorSpace = exif.ColorSpace === 1 ? "sRGB" : exif.ColorSpace === 65535 ? "Uncalibrated" : "Unknown";
        $('#color-space-value').text(colorSpace);
        $('#color-space-row').show();
        basicInfoShown = true;
    } else {
        $('#color-space-row').hide();
    }

    if (exif.DateTimeOriginal) {
        exif.DateTimeOriginal = JSON.parse(exif.DateTimeOriginal);
        $('#shooting-time-value').text(exif.DateTimeOriginal.replace(/:/g, '/').replace(' ', ' '));
        $('#shooting-time-row').show();
        basicInfoShown = true;
    } else {
        $('#shooting-time-row').hide();
    }

    if (exif.Software) {
        exif.Software = JSON.parse(exif.Software);
        $('#software-value').text(exif.Software);
        $('#software-row').show();
        basicInfoShown = true;
    } else {
        $('#software-row').hide();
    }

    if (basicInfoShown) {
        $('#basic-info-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#basic-info-divider').show();
    }

    // Section 2: Shooting Parameters
    let shootingParamsShown = false;
    if (exif.FocalLength) {
        $('#focal-length-value').text(JSON.parse(exif.FocalLength));
        $('#focal-length-row').show();
        shootingParamsShown = true;
    } else {
        $('#focal-length-row').hide();
    }

    if (exif.FNumber) {
        exif.FNumber = JSON.parse(exif.FNumber);
        let aperture = parseExifValue(exif.FNumber);
        let formattedAperture = aperture % 1 === 0 ? aperture.toString() : aperture.toFixed(1);
        $('#aperture-value').text('f/' + formattedAperture);
        $('#aperture-row').show();
        shootingParamsShown = true;
    } else {
        $('#aperture-row').hide();
    }

    if (exif.ExposureTime) {
        let exposureTime = JSON.parse(exif.ExposureTime);
        let formattedExposure = formatShutterSpeed(exposureTime);
        $('#shutter-speed-value').text(formattedExposure + 's');
        $('#shutter-speed-row').show();
        shootingParamsShown = true;
    } else {
        $('#shutter-speed-row').hide();
    }

    if (exif.ISOSpeedRatings) {
        $('#iso-value').text(exif.ISOSpeedRatings);
        $('#iso-row').show();
        shootingParamsShown = true;
    } else {
        $('#iso-row').hide();
    }

    if (exif.ExposureBiasValue) {
        $('#ev-value').text(JSON.parse(exif.ExposureBiasValue));
        $('#ev-row').show();
        shootingParamsShown = true;
    } else {
        $('#ev-row').hide();
    }

    if (shootingParamsShown) {
        $('#shooting-params-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#shooting-params-divider').show();
    }

    // Section 3: Tone Analysis
    $('#tone-analysis-section').show();
    sectionsShown++;
    if (sectionsShown > 1) $('#tone-analysis-divider').show();

    generateToneAnalysis(document.getElementById('fullImage'));

    // Section 4: Device Information
    let deviceInfoShown = false;
    if (exif.Make && exif.Model) {
        exif.Make = JSON.parse(exif.Make);
        exif.Model = JSON.parse(exif.Model);
        $('#camera-value').text(`${exif.Make} ${exif.Model}`);
        $('#camera-row').show();
        deviceInfoShown = true;
    } else if (exif.Model) {
        exif.Model = JSON.parse(exif.Model);
        $('#camera-value').text(exif.Model);
        $('#camera-row').show();
        deviceInfoShown = true;
    } else {
        $('#camera-row').hide();
    }

    if (exif.LensModel) {
        exif.LensModel = JSON.parse(exif.LensModel);
        $('#lens-value').text(exif.LensModel);
        $('#lens-row').show();
        deviceInfoShown = true;
    } else {
        $('#lens-row').hide();
    }

    if (exif.FocalLength) {
        exif.FocalLength = JSON.parse(exif.FocalLength);
        $('#focal-length-device-value').text(`${exif.FocalLength}mm`);
        $('#focal-length-device-row').show();
        deviceInfoShown = true;
    } else {
        $('#focal-length-device-row').hide();
    }

    if (exif.MaxApertureValue) {
        exif.MaxApertureValue = JSON.parse(exif.MaxApertureValue);
        $('#max-aperture-value').text(exif.MaxApertureValue);
        $('#max-aperture-row').show();
        deviceInfoShown = true;
    } else {
        $('#max-aperture-row').hide();
    }

    if (deviceInfoShown) {
        $('#device-info-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#device-info-divider').show();
    }

    // Section 5: Shooting Mode
    let shootingModeShown = false;
    if (exif.ExposureProgram !== undefined) {
        let programs = ["Not defined", "Manual", "Normal program", "Aperture priority", "Shutter priority", "Creative program", "Action program", "Portrait mode", "Landscape mode"];
        let program = programs[exif.ExposureProgram] || "Unknown";
        $('#exposure-program-value').text(program);
        $('#exposure-program-row').show();
        shootingModeShown = true;
    } else {
        $('#exposure-program-row').hide();
    }

    if (exif.ExposureMode !== undefined) {
        let modes = ["Auto exposure", "Manual exposure", "Auto bracket"];
        let mode = modes[exif.ExposureMode] || "Unknown";
        $('#exposure-mode-value').text(mode);
        $('#exposure-mode-row').show();
        shootingModeShown = true;
    } else {
        $('#exposure-mode-row').hide();
    }

    if (exif.MeteringMode !== undefined) {
        let metering = ["Unknown", "Average", "Center-weighted average", "Spot", "Multi-spot", "Pattern", "Partial"];
        let meter = metering[exif.MeteringMode] || "Unknown";
        $('#metering-mode-value').text(meter);
        $('#metering-mode-row').show();
        shootingModeShown = true;
    } else {
        $('#metering-mode-row').hide();
    }

    if (exif.WhiteBalance !== undefined) {
        let wb = exif.WhiteBalance === 0 ? "Auto" : "Manual";
        $('#white-balance-value').text(wb);
        $('#white-balance-row').show();
        shootingModeShown = true;
    } else {
        $('#white-balance-row').hide();
    }

    if (exif.Flash !== undefined) {
        let flash = (exif.Flash & 1) ? "On" : "Off";
        $('#flash-value').text(flash);
        $('#flash-row').show();
        shootingModeShown = true;
    } else {
        $('#flash-row').hide();
    }

    if (exif.SceneCaptureType !== undefined) {
        let scenes = ["Standard", "Landscape", "Portrait", "Night scene"];
        let scene = scenes[exif.SceneCaptureType] || "Unknown";
        $('#scene-capture-value').text(scene);
        $('#scene-capture-row').show();
        shootingModeShown = true;
    } else {
        $('#scene-capture-row').hide();
    }

    if (shootingModeShown) {
        $('#shooting-mode-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#shooting-mode-divider').show();
    }

    // Section 6: Technical Parameters
    let technicalParamsShown = false;
    if (exif.ShutterSpeedValue) {
        exif.ShutterSpeedValue = JSON.parse(exif.ShutterSpeedValue);
        let apexValue = parseExifValue(exif.ShutterSpeedValue);
        let shutterSpeedSeconds = Math.pow(2, -apexValue);
        let shutterValue = formatShutterSpeed(shutterSpeedSeconds);
        $('#shutter-speed-tech-value').text(shutterValue);
        $('#shutter-speed-tech-row').show();
        technicalParamsShown = true;
    } else {
        $('#shutter-speed-tech-row').hide();
    }

    if (exif.ApertureValue) {
       exif.ApertureValue = JSON.parse(exif.ApertureValue);
       let apexValue = parseExifValue(exif.ApertureValue);
       let apertureValue = Math.pow(2, apexValue / 2);
        $('#aperture-value-value').text(apertureValue.toFixed(1) + ' EV');
        $('#aperture-value-row').show();
        technicalParamsShown = true;
    } else {
        $('#aperture-value-row').hide();
    }

    if (exif.FocalPlaneXResolution && exif.FocalPlaneYResolution) {
        exif.FocalPlaneXResolution = JSON.parse(exif.FocalPlaneXResolution);
        exif.FocalPlaneYResolution = JSON.parse(exif.FocalPlaneYResolution);
        let xRes = parseExifValue(exif.FocalPlaneXResolution);
        let yRes = parseExifValue(exif.FocalPlaneYResolution);
        $('#focal-plane-res-value').text(Math.round(xRes) + ' × ' + Math.round(yRes));
        $('#focal-plane-res-row').show();
        technicalParamsShown = true;
    } else {
        $('#focal-plane-res-row').hide();
    }

    if (technicalParamsShown) {
        $('#technical-params-section').show();
        sectionsShown++;
        if (sectionsShown > 1) $('#technical-params-divider').show();
    }
}

function restoreFromHash() {
    if (window.location.hash) {
        let hashData = decodeURIComponent(window.location.hash.substring(1));
        try {
            let data = JSON.parse(hashData);
            // Find the element with matching filepath
            let elements = document.querySelectorAll('[filedata]');
            for (let el of elements) {
                let fdStr = el.getAttribute('filedata');
                if (fdStr) {
                    let fd = JSON.parse(decodeURIComponent(fdStr));
                    if (fd.filepath === data.filepath) {
                        showImage(el);
                        ShowModal();
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('Invalid hash data', e);
        }
    }
}

// Modify the window onload event to ensure folder and thumbnails are loaded first
window.addEventListener('load', () => {
    setTimeout(function(){
        if (window.location.hash) {
            const hashData = decodeURIComponent(window.location.hash.substring(1));
            try {
                const data = JSON.parse(hashData);
                let filename = data.filename;
                let filepath = data.filepath;
                let dir = filepath.split("/").slice(0, -1).join("/");

                // Access the Alpine data instance
                const appElement = document.querySelector('[x-data*="photoListObject"]');
                if (appElement) {
                    const app = appElement._x_dataStack[0];
                    if (app.currentPath !== dir) {
                        app.updateRenderingPath(dir, () => { 
                           setTimeout(function(){
                                console.log("Test")
                                restoreFromHash(); 
                           }, 100);
                        });
                    } else {
                        // Folder is already loaded, try to restore immediately
                        restoreFromHash();
                    }
                }
            } catch (e) {
                console.error('Invalid hash data', e);
            }
        }   
     }, 100);
});
