/*
    3D Modeler - dragging a plane into an offset sketch plane

    As in Inventor: with Start 2D Sketch waiting for a plane, pressing on a
    plane or a flat face and dragging away from it pulls out a work plane
    parallel to it; on release a box by the pointer takes the exact offset
    (OK or Enter makes the plane and opens a sketch on it, Cancel or Esc
    drops it). A plain click still sketches on the plane itself.

    dragOffset(start, now, screenNormal, worldPerPixel) -> mm
        start, now      pointer positions in pixels
        screenNormal    pixels the plane's normal covers per mm on screen
        Along the normal as it shows on screen; when the normal points at
        the viewer (the plane is seen face on) dragging up is outward.
    snapOffset(value, worldPerPixel) -> value rounded to a step that
        suits the zoom (1, 0.1, 10 mm ...)
    The box by the pointer is offsetbox.js.
*/

export function dragOffset(start, now, screenNormal, worldPerPixel) {
    const len2 = screenNormal[0] * screenNormal[0] + screenNormal[1] * screenNormal[1];
    const perPixel = 1 / worldPerPixel;
    if (len2 < 0.0625 * perPixel * perPixel) {
        return (start[1] - now[1]) * worldPerPixel;
    }
    return ((now[0] - start[0]) * screenNormal[0] + (now[1] - start[1]) * screenNormal[1]) / len2;
}

export function snapOffset(value, worldPerPixel) {
    const step = Math.pow(10, Math.floor(Math.log10(Math.max(worldPerPixel * 10, 1e-6))));
    const v = +(Math.round(value / step) * step).toFixed(6);
    return v === 0 ? 0 : v; // no "-0"
}
