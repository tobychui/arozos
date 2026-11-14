/*
    3D Modeler - pictures for the Image finish

    A picture the user chooses for a part's look is made smaller (at most
    MAX_SIDE pixels on its longest side) and kept inside the part as a data
    URL: JPEG, or PNG when it has see-through parts, so the part file stays
    one file that opens anywhere.

    toTextureImage(bytes, name) -> Promise of { url, name, width, height }
*/

import { MAX_IMAGE_CHARS } from '../appearance.js';

export const MAX_SIDE = 1024;
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

// The size a picture of w x h is kept at
export function textureSize(w, h, max) {
    const k = Math.min(1, (max || MAX_SIDE) / Math.max(w, h, 1));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function mimeOf(name) {
    const ext = String(name).split('.').pop().toLowerCase();
    return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
}

export function toTextureImage(bytes, name) {
    const type = mimeOf(name);
    const url = URL.createObjectURL(new Blob([bytes], { type: type }));
    return new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            const size = textureSize(img.naturalWidth, img.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = size[0];
            canvas.height = size[1];
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size[0], size[1]);
            let alpha = false;
            if (type !== 'image/jpeg') {
                const data = ctx.getImageData(0, 0, size[0], size[1]).data;
                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] < 250) {
                        alpha = true;
                        break;
                    }
                }
            }
            let out = alpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
            if (out.length > MAX_IMAGE_CHARS) {
                out = canvas.toDataURL('image/jpeg', 0.7);
            }
            resolve({ url: out, name: name, width: size[0], height: size[1] });
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error(name + ' is not a picture this browser can read'));
        };
        img.src = url;
    });
}
