var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export { Algorithm, SolveStatus, DebugMode, Constraint_Alignment, InternalAlignmentType } from "./planegcs_dist/enums.js";
export { is_sketch_constraint, is_sketch_geometry, get_referenced_sketch_params, get_constrained_primitive_ids } from "./sketch/sketch_primitive.js";
export { SketchIndex } from "./sketch/sketch_index.js";
export * from "./planegcs_dist/constraints.js";
import init_planegcs_module from "./planegcs_dist/planegcs.js";
export { init_planegcs_module };
import { GcsWrapper } from "./sketch/gcs_wrapper.js";
export { GcsWrapper };
export function make_gcs_wrapper(wasm_path) {
    return __awaiter(this, void 0, void 0, function* () {
        const module = yield init_planegcs_module(wasm_path ? { locateFile: () => wasm_path } : undefined);
        const gcs = new module.GcsSystem();
        return new GcsWrapper(gcs, module);
    });
}
//# sourceMappingURL=index.js.map