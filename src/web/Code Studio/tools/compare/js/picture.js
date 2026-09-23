/*
    picture.js - image comparison

    Shows both images side by side, and can blend them into a single canvas so
    that pixel differences stand out.
*/

var CmpPicture = (function () {

    //Swappable per tab, see CmpText.captureSession for the reasoning
    function blankState(carryMode) {
        return {
            leftPath: "",
            rightPath: "",
            leftImage: null,
            rightImage: null,
            mode: carryMode || "side",   // side | difference | onion
            blend: 50,
            stats: null
        };
    }

    var state = blankState();

    var hooks = {
        onLog: function () {},
        onStatus: function () {},
        onBusy: function () {}
    };

    function setHooks(newHooks) {
        for (var key in newHooks) {
            if (Object.prototype.hasOwnProperty.call(newHooks, key)) {
                hooks[key] = newHooks[key];
            }
        }
    }

    function loadImage(path) {
        if (!path) {
            return Promise.resolve(null);
        }
        return new Promise(function (resolve) {
            var image = new Image();
            image.onload = function () {
                resolve(image);
            };
            image.onerror = function () {
                hooks.onLog("Could not decode " + path, "err");
                resolve(null);
            };
            image.src = CmpAPI.mediaURL(path);
        });
    }

    function open(leftPath, rightPath) {
        state = blankState(state.mode);
        state.leftPath = leftPath || "";
        state.rightPath = rightPath || "";
        hooks.onBusy(true, "Loading images", 30);

        return Promise.all([loadImage(leftPath), loadImage(rightPath)]).then(function (images) {
            state.leftImage = images[0];
            state.rightImage = images[1];

            var leftElement = document.getElementById("picLeft");
            var rightElement = document.getElementById("picRight");
            if (leftElement) {
                leftElement.src = leftPath ? CmpAPI.mediaURL(leftPath) : "";
                leftElement.style.display = leftPath ? "" : "none";
            }
            if (rightElement) {
                rightElement.src = rightPath ? CmpAPI.mediaURL(rightPath) : "";
                rightElement.style.display = rightPath ? "" : "none";
            }

            hooks.onBusy(false);
            analyse();
            render();
        });
    }

    //Compare the two images pixel by pixel at the size of the larger one
    function analyse() {
        state.stats = null;
        if (!state.leftImage || !state.rightImage) {
            return;
        }

        var width = Math.max(state.leftImage.naturalWidth, state.rightImage.naturalWidth);
        var height = Math.max(state.leftImage.naturalHeight, state.rightImage.naturalHeight);
        if (width === 0 || height === 0 || width * height > 24000000) {
            return;
        }

        var leftData = imageData(state.leftImage, width, height);
        var rightData = imageData(state.rightImage, width, height);
        if (!leftData || !rightData) {
            return;
        }

        var changed = 0;
        for (var i = 0; i < leftData.data.length; i += 4) {
            if (leftData.data[i] !== rightData.data[i] ||
                leftData.data[i + 1] !== rightData.data[i + 1] ||
                leftData.data[i + 2] !== rightData.data[i + 2] ||
                leftData.data[i + 3] !== rightData.data[i + 3]) {
                changed++;
            }
        }

        state.stats = {
            width: width,
            height: height,
            changedPixels: changed,
            totalPixels: width * height,
            sameDimensions: state.leftImage.naturalWidth === state.rightImage.naturalWidth &&
                state.leftImage.naturalHeight === state.rightImage.naturalHeight
        };
        state.leftData = leftData;
        state.rightData = rightData;
    }

    function imageData(image, width, height) {
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var context = canvas.getContext("2d");
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0);
        try {
            return context.getImageData(0, 0, width, height);
        } catch (e) {
            //A cross origin image would taint the canvas; report it rather
            //than failing silently
            hooks.onLog("Pixel data is unavailable for this image", "err");
            return null;
        }
    }

    function render() {
        var sidePanes = document.getElementById("picSidePanes");
        var overlayPane = document.getElementById("picOverlayPane");
        if (!sidePanes || !overlayPane) {
            return;
        }

        if (state.mode === "side") {
            sidePanes.style.display = "flex";
            overlayPane.style.display = "none";
        } else {
            sidePanes.style.display = "none";
            overlayPane.style.display = "flex";
            drawOverlay();
        }

        reportStatus();
    }

    function drawOverlay() {
        var canvas = document.getElementById("picCanvas");
        if (!canvas || !state.stats || !state.leftData || !state.rightData) {
            return;
        }

        canvas.width = state.stats.width;
        canvas.height = state.stats.height;
        var context = canvas.getContext("2d");
        var output = context.createImageData(state.stats.width, state.stats.height);
        var leftPixels = state.leftData.data;
        var rightPixels = state.rightData.data;
        var alpha = state.blend / 100;

        for (var i = 0; i < output.data.length; i += 4) {
            if (state.mode === "difference") {
                var different = leftPixels[i] !== rightPixels[i] ||
                    leftPixels[i + 1] !== rightPixels[i + 1] ||
                    leftPixels[i + 2] !== rightPixels[i + 2] ||
                    leftPixels[i + 3] !== rightPixels[i + 3];
                if (different) {
                    output.data[i] = 255;
                    output.data[i + 1] = 40;
                    output.data[i + 2] = 40;
                    output.data[i + 3] = 255;
                } else {
                    //Unchanged pixels are dimmed so the differences pop out
                    var grey = Math.round((leftPixels[i] + leftPixels[i + 1] + leftPixels[i + 2]) / 3);
                    var faded = Math.round(190 + grey * 0.22);
                    output.data[i] = faded;
                    output.data[i + 1] = faded;
                    output.data[i + 2] = faded;
                    output.data[i + 3] = leftPixels[i + 3] ? 255 : 0;
                }
            } else {
                output.data[i] = Math.round(leftPixels[i] * (1 - alpha) + rightPixels[i] * alpha);
                output.data[i + 1] = Math.round(leftPixels[i + 1] * (1 - alpha) + rightPixels[i + 1] * alpha);
                output.data[i + 2] = Math.round(leftPixels[i + 2] * (1 - alpha) + rightPixels[i + 2] * alpha);
                output.data[i + 3] = Math.round(leftPixels[i + 3] * (1 - alpha) + rightPixels[i + 3] * alpha);
            }
        }

        context.putImageData(output, 0, 0);
    }

    function reportStatus() {
        hooks.onStatus({
            leftSize: state.leftImage ?
                state.leftImage.naturalWidth + " x " + state.leftImage.naturalHeight : "",
            rightSize: state.rightImage ?
                state.rightImage.naturalWidth + " x " + state.rightImage.naturalHeight : "",
            changedPixels: state.stats ? state.stats.changedPixels : null,
            totalPixels: state.stats ? state.stats.totalPixels : null,
            sameDimensions: state.stats ? state.stats.sameDimensions : null,
            mode: state.mode
        });
    }

    function setMode(mode) {
        state.mode = mode;
        render();
    }

    function setBlend(value) {
        state.blend = value;
        if (state.mode === "onion") {
            drawOverlay();
        }
    }

    function swap() {
        var oldImage = state.leftImage;
        var oldPath = state.leftPath;
        var oldData = state.leftData;
        state.leftImage = state.rightImage;
        state.rightImage = oldImage;
        state.leftPath = state.rightPath;
        state.rightPath = oldPath;
        state.leftData = state.rightData;
        state.rightData = oldData;

        var leftElement = document.getElementById("picLeft");
        var rightElement = document.getElementById("picRight");
        if (leftElement && rightElement) {
            leftElement.src = state.leftPath ? CmpAPI.mediaURL(state.leftPath) : "";
            rightElement.src = state.rightPath ? CmpAPI.mediaURL(state.rightPath) : "";
        }
        render();
    }

    function getState() {
        return state;
    }

    function captureSession() {
        return state;
    }

    function restoreSession(saved) {
        state = saved;
        var leftElement = document.getElementById("picLeft");
        var rightElement = document.getElementById("picRight");
        if (leftElement && rightElement) {
            leftElement.src = state.leftPath ? CmpAPI.mediaURL(state.leftPath) : "";
            leftElement.style.display = state.leftPath ? "" : "none";
            rightElement.src = state.rightPath ? CmpAPI.mediaURL(state.rightPath) : "";
            rightElement.style.display = state.rightPath ? "" : "none";
        }
        render();
    }

    return {
        setHooks: setHooks,
        open: open,
        render: render,
        setMode: setMode,
        setBlend: setBlend,
        swap: swap,
        getState: getState,
        captureSession: captureSession,
        restoreSession: restoreSession
    };
})();
