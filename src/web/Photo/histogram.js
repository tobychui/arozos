function generateHistogram(imageElement, canvas) {
    try {
        // Check if image is loaded and has valid dimensions
        if (!imageElement.complete || imageElement.naturalWidth === 0) {
            console.log('Image not fully loaded yet');
            // Retry after a short delay
            setTimeout(() => generateHistogram(imageElement, canvas), 100);
            return;
        }

        console.log('Generating histogram for image:', imageElement.naturalWidth, 'x', imageElement.naturalHeight);

        // Create a temporary canvas to get image data
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = imageElement.naturalWidth;
        tempCanvas.height = imageElement.naturalHeight;

        // Draw the image to the temp canvas
        tempCtx.drawImage(imageElement, 0, 0);

        // Get image data
        const imageData = tempCtx.getImageData(0, 0, imageElement.naturalWidth, imageElement.naturalHeight);

        const { width, height, data } = imageData;
        const totalPixels = width * height;
        const numSamples = Math.min(10000, totalPixels); // sample up to 10,000 pixels

        // Initialize histogram arrays for R, G, B
        const histR = new Array(256).fill(0);
        const histG = new Array(256).fill(0);
        const histB = new Array(256).fill(0);

        // Sample pixels
        let sampleCount = 0;
        for (let s = 0; s < numSamples; s++) {
            const i = Math.floor(Math.random() * width);
            const j = Math.floor(Math.random() * height);
            const index = (j * width + i) * 4;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            histR[r]++;
            histG[g]++;
            histB[b]++;
            sampleCount++;
        }

        console.log('Sampled', sampleCount, 'pixels for histogram');

        // Draw histogram on canvas
        const ctx = canvas.getContext('2d');
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        // Find max value for scaling
        const maxR = Math.max(...histR.slice(1, 255));
        const maxG = Math.max(...histG.slice(1, 255));
        const maxB = Math.max(...histB.slice(1, 255));
        const maxVal = Math.max(maxR, maxG, maxB);

        if (maxVal === 0) {
            // No data to display
            ctx.fillStyle = '#666';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No histogram data', canvasWidth / 2, canvasHeight / 2);
            console.log('No histogram data to display');
            return;
        }

        const scale = canvasHeight / maxVal;

        // Draw bars for each channel with some transparency
        for (let i = 1; i < 255; i+=2) {
            // Red channel
            ctx.fillStyle = 'rgba(255, 100, 100, 0.7)';
            ctx.fillRect(i * (canvasWidth / 256), canvasHeight - histR[i] * scale, canvasWidth / 256, histR[i] * scale);

            // Green channel
            ctx.fillStyle = 'rgba(100, 255, 100, 0.7)';
            ctx.fillRect(i * (canvasWidth / 256), canvasHeight - histG[i] * scale, canvasWidth / 256, histG[i] * scale);

            // Blue channel
            ctx.fillStyle = 'rgba(100, 100, 255, 0.7)';
            ctx.fillRect(i * (canvasWidth / 256), canvasHeight - histB[i] * scale, canvasWidth / 256, histB[i] * scale);
        }

        // Add a subtle border
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, canvasWidth, canvasHeight);

        console.log('Histogram generated successfully');

    } catch (error) {
        console.error('Error generating histogram:', error);
        const ctx = canvas.getContext('2d');
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Histogram unavailable', canvasWidth / 2, canvasHeight / 2);
    }
}

function analysis_tone_types(imageElement, callback) {
    try {
        // Check if image is loaded and has valid dimensions
        if (!imageElement.complete || imageElement.naturalWidth === 0) {
            console.log('Image not fully loaded yet');
            // Retry after a short delay
            setTimeout(() => analysis_tone_types(imageElement, callback), 100);
            return;
        }

        console.log('Analyzing tone for image:', imageElement.naturalWidth, 'x', imageElement.naturalHeight);

        // Create a temporary canvas to get image data
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = imageElement.naturalWidth;
        tempCanvas.height = imageElement.naturalHeight;

        // Draw the image to the temp canvas
        tempCtx.drawImage(imageElement, 0, 0);

        // Get image data
        const imageData = tempCtx.getImageData(0, 0, imageElement.naturalWidth, imageElement.naturalHeight);

        const { width, height, data } = imageData;
        const totalPixels = width * height;

        // Thresholds for shadows and highlights (in luminance 0-255)
        const shadowThreshold = 0.1 * 255; // 10%
        const highlightThreshold = 0.9 * 255; // 90%

        let totalLuminance = 0;
        let minLum = 255;
        let maxLum = 0;
        let shadowCount = 0;
        let highlightCount = 0;

        // Calculate luminance for each pixel
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;

            totalLuminance += lum;
            if (lum < minLum) minLum = lum;
            if (lum > maxLum) maxLum = lum;
            if (lum < shadowThreshold) shadowCount++;
            if (lum > highlightThreshold) highlightCount++;
        }

        // Brightness: average luminance as percentage
        const avgLuminance = totalLuminance / totalPixels;
        const brightness = (avgLuminance / 255) * 100;

        // Contrast: range-based as percentage
        const contrast = ((maxLum - minLum) / 255) * 100;

        // Shadow and highlight ratios
        const shadowRatio = (shadowCount / totalPixels) * 100;
        const highlightRatio = (highlightCount / totalPixels) * 100;

        // Return results to callback
        callback({
            brightness: Math.round(brightness) + "%",
            contrast: Math.round(contrast) + "%",
            shadowRatio: Math.round(shadowRatio) + "%",
            highlightRatio: Math.round(highlightRatio) + "%"
        });

        console.log('Tone analysis completed');

    } catch (error) {
        console.error('Error in analysis_tone_types:', error);
        callback(null);
    }
}


function get_tone_type(brightness, contrast, shadowRatio, highlightRatio) {
    const b = parseFloat(brightness);
    const c = parseFloat(contrast);
    const s = parseFloat(shadowRatio);
    const h = parseFloat(highlightRatio);

    // Classify based on brightness (Key)
    let key;
    if (b > 65) {
        key = "High Key";
    } else if (b < 35) {
        key = "Low Key";
    } else {
        key = "Middle Key";
    }

    // Classify based on contrast (Scale)
    let scale;
    if (c > 70) {
        scale = "Long Scale";
    } else if (c < 30) {
        scale = "Short Scale";
    } else {
        scale = "Middle Scale";
    }

    return key + " " + scale;
}