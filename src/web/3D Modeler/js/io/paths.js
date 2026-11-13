/*
    3D Modeler - paths of linked files

    Assemblies link to their part files and drawings to their models by
    path. ArozOS paths start with a root: "user:/Desktop/Bracket.aopart",
    "storage:/Projects/Bracket.aopart". A link is saved relative to the
    file that holds it ("parts/Bracket.aopart", "../Bracket.aopart") when
    both are under the same root, so a folder can be moved or copied as a
    whole; it stays absolute when the roots differ, or while the holding
    file has never been saved.

    While a document is open its links are absolute (resolveFrom on load),
    and they are made relative again when it is written (relativeTo), for
    the place it is written to: Save As to another folder stays right.
*/

// "user:/a/b.aopart" -> { root: "user", parts: ["a", "b.aopart"] }, or null
export function splitPath(path) {
    const text = String(path || '');
    const i = text.indexOf(':/');
    if (i <= 0 || text.slice(0, i).indexOf('/') >= 0) {
        return null;
    }
    return { root: text.slice(0, i), parts: text.slice(i + 2).split('/').filter(Boolean) };
}

export function isAbsolute(path) {
    return !!splitPath(path);
}

export function rootOf(path) {
    const s = splitPath(path);
    return s ? s.root : '';
}

// The folder of a file, with a trailing slash: "user:/a/"
export function folderOf(path) {
    const s = splitPath(path);
    return s ? s.root + ':/' + s.parts.slice(0, -1).map(function (p) {
        return p + '/';
    }).join('') : '';
}

export function fileNameOf(path) {
    const parts = String(path || '').split('/');
    return parts[parts.length - 1];
}

// The link from the file `from` to the file `target`, relative when both
// are under the same root ("Bracket.aopart", "../parts/Bracket.aopart"),
// else `target` itself
export function relativeTo(from, target) {
    const a = splitPath(from);
    const b = splitPath(target);
    if (!a || !b || a.root !== b.root) {
        return target;
    }
    const dir = a.parts.slice(0, -1);
    let i = 0;
    while (i < dir.length && i < b.parts.length - 1 && dir[i] === b.parts[i]) {
        i++;
    }
    let out = '';
    for (let k = i; k < dir.length; k++) {
        out += '../';
    }
    return out + b.parts.slice(i).join('/');
}

// A link read from the file `from`, as an absolute path. Absolute links
// come back as they are; a relative one cannot be resolved without `from`
// (the file was never saved) and comes back as it is.
export function resolveFrom(from, link) {
    if (!link || isAbsolute(link)) {
        return link;
    }
    const a = splitPath(from);
    if (!a) {
        return link;
    }
    const parts = a.parts.slice(0, -1);
    String(link).split('/').forEach(function (seg) {
        if (seg === '..') {
            parts.pop();
        } else if (seg && seg !== '.') {
            parts.push(seg);
        }
    });
    return a.root + ':/' + parts.join('/');
}
