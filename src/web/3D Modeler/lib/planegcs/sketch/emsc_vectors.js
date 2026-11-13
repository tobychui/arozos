export function arr_to_intvec(gcs_module, arr) {
    const vec = new gcs_module.IntVector();
    for (const val of arr) {
        vec.push_back(val);
    }
    return vec;
}
export function arr_to_doublevec(gcs_module, arr) {
    const vec = new gcs_module.DoubleVector();
    for (const val of arr) {
        vec.push_back(val);
    }
    return vec;
}
export function emsc_vec_to_arr(vec) {
    const result = [];
    for (let i = 0; i < vec.size(); ++i) {
        result.push(vec.get(i));
    }
    vec.delete();
    return result;
}
//# sourceMappingURL=emsc_vectors.js.map