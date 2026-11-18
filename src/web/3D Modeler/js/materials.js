/*
    3D Modeler - materials

    What a part can be made of, for its mass: MATERIALS (density in g/cm3),
    materialById(id), normalizeMaterial(stored) and massOf(volume, material).
    The document keeps { id, density } under `material`. Pure: no DOM, used
    by the document module and the Material panel (features/material.js).
*/

export const MATERIALS = [
    { id: 'pla', label: 'PLA', density: 1.24 },
    { id: 'petg', label: 'PETG', density: 1.27 },
    { id: 'abs', label: 'ABS', density: 1.04 },
    { id: 'asa', label: 'ASA', density: 1.07 },
    { id: 'nylon', label: 'Nylon (PA12)', density: 1.01 },
    { id: 'tpu', label: 'TPU', density: 1.21 },
    { id: 'resin', label: 'Photopolymer resin', density: 1.15 },
    { id: 'acrylic', label: 'Acrylic (PMMA)', density: 1.18 },
    { id: 'pom', label: 'Acetal (POM)', density: 1.41 },
    { id: 'aluminium', label: 'Aluminium 6061', density: 2.70 },
    { id: 'steel', label: 'Steel, mild', density: 7.85 },
    { id: 'stainless', label: 'Stainless steel 304', density: 8.00 },
    { id: 'brass', label: 'Brass', density: 8.50 },
    { id: 'copper', label: 'Copper', density: 8.96 },
    { id: 'titanium', label: 'Titanium Ti-6Al-4V', density: 4.43 },
    { id: 'oak', label: 'Wood, oak', density: 0.75 },
    { id: 'pine', label: 'Wood, pine', density: 0.50 },
    { id: 'custom', label: 'Custom', density: 1 }
];

export function materialById(id) {
    return MATERIALS.find(function (m) {
        return m.id === id;
    }) || null;
}

// A stored material made safe: { id, density } or null (none chosen)
export function normalizeMaterial(m) {
    if (!m || typeof m !== 'object') {
        return null;
    }
    const known = materialById(m.id);
    if (!known) {
        return null;
    }
    const density = known.id === 'custom' ? Number(m.density) : known.density;
    if (!(density > 0) || density > 30) {
        return null;
    }
    return { id: known.id, density: density };
}

// The mass line of Mass Properties: grams below a kilogram
export function massOf(volume, material) {
    const m = normalizeMaterial(material);
    if (!m) {
        return null;
    }
    const grams = volume / 1000 * m.density;
    const label = m.id === 'custom' ? 'Custom (' + m.density + ' g/cm3)' : materialById(m.id).label + ' (' + m.density + ' g/cm3)';
    return { grams: grams, text: grams >= 1000 ? (grams / 1000).toFixed(3) + ' kg' : grams.toFixed(2) + ' g', material: label };
}
