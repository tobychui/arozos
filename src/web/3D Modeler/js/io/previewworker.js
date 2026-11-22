/*
    3D Modeler - JPEG encoding of a document's preview, off the page's thread

    Gets { id, bitmap, quality } from io/preview.js, flattens the picture on
    white (JPEG has no transparency) and answers { id, url } with a JPEG
    data URL, or { id, error }.
*/

self.onmessage = function (e) {
    const id = e.data && e.data.id;
    const bitmap = e.data && e.data.bitmap;
    const fail = function (err) {
        self.postMessage({ id: id, error: String(err && err.message || err) });
    };
    try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, bitmap.width, bitmap.height);
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        canvas.convertToBlob({ type: 'image/jpeg', quality: e.data.quality || 0.85 }).then(function (blob) {
            if (blob.type !== 'image/jpeg') {
                fail('This browser cannot write JPEG');
                return;
            }
            self.postMessage({ id: id, url: new FileReaderSync().readAsDataURL(blob) });
        }).catch(fail);
    } catch (err) {
        fail(err);
    }
};
