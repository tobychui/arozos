// This library provides WebAssembly bindings for the FreeCAD's geometric solver library planegcs.
// Copyright (C) 2023  Miroslav Šerý, Salusoft89 <miroslav.sery@salusoft89.cz>  
import { is_sketch_geometry } from "./sketch_primitive.js";
export class SketchIndexBase {
    get_primitive_or_fail(id) {
        const obj = this.get_primitive(id);
        if (obj === undefined) {
            throw new Error(`sketch object ${id} not found`);
        }
        return obj;
    }
    get_sketch_point(id) {
        const obj = this.get_primitive_or_fail(id);
        if (obj.type !== 'point') {
            throw new Error(`sketch object ${id} is not a sketch point`);
        }
        return obj;
    }
    get_sketch_line(id) {
        const obj = this.get_primitive_or_fail(id);
        if (obj.type !== 'line') {
            throw new Error(`sketch object ${id} is not a sketch line`);
        }
        return obj;
    }
    get_sketch_circle(id) {
        const obj = this.get_primitive_or_fail(id);
        if (obj.type !== 'circle') {
            throw new Error(`sketch object ${id} is not a sketch circle`);
        }
        return obj;
    }
    get_sketch_arc(id) {
        const obj = this.get_primitive_or_fail(id);
        if (obj.type !== 'arc') {
            throw new Error(`sketch object ${id} is not a sketch arc`);
        }
        return obj;
    }
    get_constraints() {
        return this.get_primitives().filter(o => !is_sketch_geometry(o));
    }
    toString() {
        return this.get_primitives().map(o => JSON.stringify(o)).join('\n');
    }
}
export class SketchIndex extends SketchIndexBase {
    constructor() {
        super(...arguments);
        this.index = new Map();
        this.primitive_ids = [];
    }
    has(id) {
        return this.index.has(id);
    }
    delete_primitive(id) {
        return this.index.delete(id);
    }
    set_primitive(obj) {
        if (!this.has(obj.id)) {
            this.primitive_ids.push(obj.id);
        }
        this.index.set(obj.id, obj);
    }
    get_primitive(id) {
        return this.index.get(id);
    }
    get_primitives() {
        return Array.from(this.index.values());
    }
    get_id_by_index(index) {
        return this.primitive_ids[index - 1];
    }
    clear() {
        this.index.clear();
        this.primitive_ids = [];
    }
    counter() {
        return this.primitive_ids.length;
    }
}
//# sourceMappingURL=sketch_index.js.map