// This library provides WebAssembly bindings for the FreeCAD's geometric solver library planegcs.
// Copyright (C) 2023  Miroslav Šerý, Salusoft89 <miroslav.sery@salusoft89.cz>  
// Copyright (C) 2024  Angelo Bartolome <angelo.m.bartolome@gmail.com>
export const property_offsets = {
    point: {
        x: 0,
        y: 1
    },
    circle: {
        radius: 0
    },
    arc: {
        start_angle: 0,
        end_angle: 1,
        radius: 2
    },
    ellipse: {
        radmin: 0,
    },
    arc_of_ellipse: {
        start_angle: 0,
        end_angle: 1,
        radmin: 2
    },
    parabola: {},
    arc_of_parabola: {
        start_angle: 0,
        end_angle: 1,
    },
    hyperbola: {
        radmin: 0,
    },
    arc_of_hyperbola: {
        start_angle: 0,
        end_angle: 1,
        radmin: 2
    },
    line: {},
    bspline: {},
};
export default function get_property_offset(primitive_type, property_key) {
    const primitive_offsets = property_offsets[primitive_type];
    if (primitive_offsets) {
        const offset = primitive_offsets[property_key];
        if (offset !== undefined) {
            return offset;
        }
    }
    throw new Error(`Unknown property ${property_key} for primitive <${primitive_type}>`);
}
//# sourceMappingURL=geom_params.js.map