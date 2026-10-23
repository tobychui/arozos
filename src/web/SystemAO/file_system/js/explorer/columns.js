/*
    columns.js

    Rearranging and resizing the details view's columns.

    A header cell dragged sideways moves its column; the grip between two
    header cells moves the boundary between those two columns, and double
    clicking the grip puts their default widths back. Both are plain mouse handling rather than HTML5 drag
    and drop: a native drag over #folderView would light up the file drop
    indicator and end up in drop().

    Name is the one fluid column. It takes whatever the fixed columns leave,
    so the table keeps filling the file area.

    Widths are applied through one generated style sheet keyed on the .fmCol*
    classes, the same way file_explorer.css sizes them, so the header table
    and the row tables stay in step. Saved per user under
    file_explorer/detailsColumns as "name,date,type,size|date:170,size:90".

    Part of the ArozOS File Manager. Loaded as a plain script from
    file_explorer.html - see the <script> block at the end of that file.
*/

const FM_COLUMN_MIN_WIDTH = 60;     //Narrowest a fixed column can be dragged
const FM_NAME_MIN_WIDTH = 140;      //Room the fluid name column always keeps
const FM_COLUMN_DRAG_THRESHOLD = 5; //Pixels of travel before a press becomes a drag

let detailsColumnOrder = ["name", "date", "type", "size"];
let detailsColumnWidths = {};       //key -> px, only columns the user resized
let columnDragEndedAt = 0;          //Lets the sort click that follows a drag be ignored

function detailsColumnByKey(key){
    return FM_SORT_COLUMNS.filter(function(c){ return c.key == key; })[0];
}

//FM_SORT_COLUMNS in the user's order
function orderedDetailsColumns(){
    return detailsColumnOrder.map(detailsColumnByKey).filter(function(col){
        return col != undefined;
    });
}

/* ---------------------------------------------------------------------- */
/*  Saving and restoring                                                   */
/* ---------------------------------------------------------------------- */
function loadDetailsColumns(){
    loadPreference("file_explorer/detailsColumns", function(value){
        if (typeof value !== "string" || value == ""){
            return;
        }
        let parts = value.split("|");

        //Keep only known keys, each once, and append any the saved order
        //predates so a new column never disappears
        let order = [];
        (parts[0] || "").split(",").forEach(function(key){
            if (detailsColumnByKey(key) != undefined && order.indexOf(key) < 0){
                order.push(key);
            }
        });
        FM_SORT_COLUMNS.forEach(function(col){
            if (order.indexOf(col.key) < 0){
                order.push(col.key);
            }
        });

        let widths = {};
        (parts[1] || "").split(",").forEach(function(entry){
            let kv = entry.split(":");
            let w = parseInt(kv[1]);
            if (kv[0] != "name" && detailsColumnByKey(kv[0]) != undefined && !isNaN(w)){
                widths[kv[0]] = Math.max(FM_COLUMN_MIN_WIDTH, w);
            }
        });

        detailsColumnOrder = order;
        detailsColumnWidths = widths;
        applyDetailsColumnWidths();
        //The listing may already be on screen by the time this arrives
        applyDetailsColumnOrder();
    });
}

function saveDetailsColumns(){
    let widths = Object.keys(detailsColumnWidths).map(function(key){
        return key + ":" + Math.round(detailsColumnWidths[key]);
    });
    setPreference("file_explorer/detailsColumns",
        encodeURIComponent(detailsColumnOrder.join(",") + "|" + widths.join(",")));
}

/* ---------------------------------------------------------------------- */
/*  Applying                                                               */
/* ---------------------------------------------------------------------- */
function applyDetailsColumnWidths(){
    let sheet = document.getElementById("fmColumnWidths");
    if (sheet == null){
        sheet = document.createElement("style");
        sheet.id = "fmColumnWidths";
        document.head.appendChild(sheet);
    }
    //The id outranks the defaults in file_explorer.css
    sheet.textContent = Object.keys(detailsColumnWidths).map(function(key){
        return "#folderView .detailstable ." + detailsColumnByKey(key).cls +
               "{width:" + Math.round(detailsColumnWidths[key]) + "px;}";
    }).join("\n");
}

//Reorders the cells of the rendered header and rows in place, no re-render
function applyDetailsColumnOrder(){
    let columns = orderedDetailsColumns();
    $("#fmListHeader tr, #folderView .detailTableContent > tr").each(function(){
        let row = this;
        columns.forEach(function(col){
            let cell = row.querySelector(":scope > ." + col.cls);
            if (cell != null){
                row.appendChild(cell);
            }
        });
    });
}

//True for the click a column drag leaves behind, which must not sort
function columnHeaderClickSuppressed(){
    return Date.now() - columnDragEndedAt < 300;
}

function visibleHeaderCells(){
    return $("#fmListHeader th.fmSortable").filter(":visible").toArray();
}

/* ---------------------------------------------------------------------- */
/*  Resizing                                                               */
/* ---------------------------------------------------------------------- */
/*
    The grip on a header cell's right edge is the boundary between that
    column and the next visible one. Dragging it trades width between those
    two only: the left column's start and the right column's end stay put,
    so no other column moves. The last column has nothing to trade with and
    shows no grip.

    The name column is never given a width. When it is one of the pair, only
    the other column's width is set and name takes up the difference, which
    comes to the same thing because the other columns do not change.
*/
function resizePairFor(grip){
    let th = $(grip).closest("th")[0];
    let cells = visibleHeaderCells();
    let next = cells[cells.indexOf(th) + 1];
    if (next == undefined){
        return null;
    }
    return {
        left: th,
        right: next,
        leftKey: $(th).attr("data-sortkey"),
        rightKey: $(next).attr("data-sortkey")
    };
}

function columnMinWidth(key){
    return key == "name" ? FM_NAME_MIN_WIDTH : FM_COLUMN_MIN_WIDTH;
}

function startColumnResize(event, grip){
    let pair = resizePairFor(grip);
    if (pair == null){
        return;
    }

    let startX = event.clientX;
    let startLeft = pair.left.offsetWidth;
    let total = startLeft + pair.right.offsetWidth;
    let minLeft = columnMinWidth(pair.leftKey);
    let maxLeft = Math.max(minLeft, total - columnMinWidth(pair.rightKey));
    let moved = false;

    $("body").addClass("fmColResizing");

    function onMove(e){
        let left = Math.min(maxLeft, Math.max(minLeft, startLeft + e.clientX - startX));
        if (pair.leftKey != "name"){
            detailsColumnWidths[pair.leftKey] = left;
        }
        if (pair.rightKey != "name"){
            detailsColumnWidths[pair.rightKey] = total - left;
        }
        moved = moved || left != startLeft;
        applyDetailsColumnWidths();
    }

    function onUp(){
        $(document).off("mousemove.fmcolresize mouseup.fmcolresize");
        $("body").removeClass("fmColResizing");
        columnDragEndedAt = Date.now();
        if (moved){
            saveDetailsColumns();
        }
    }

    $(document).on("mousemove.fmcolresize", onMove).on("mouseup.fmcolresize", onUp);
}

//Double click on a grip: both columns it sits between go back to their defaults
function resetColumnWidth(grip){
    let pair = resizePairFor(grip);
    if (pair == null){
        return;
    }
    delete detailsColumnWidths[pair.leftKey];
    delete detailsColumnWidths[pair.rightKey];
    applyDetailsColumnWidths();
    saveDetailsColumns();
}

/* ---------------------------------------------------------------------- */
/*  Reordering                                                             */
/* ---------------------------------------------------------------------- */
function startColumnMove(event, th){
    let startX = event.clientX;
    let key = $(th).attr("data-sortkey");
    let ghost = null;
    let marker = null;
    let beforeKey = null;   //Column the dragged one lands in front of; null = last

    function begin(){
        let rect = th.getBoundingClientRect();
        ghost = $('<div id="fmColGhost"></div>').text($(th).text()).css({
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            height: rect.height + "px"
        }).appendTo("body");
        marker = $('<div id="fmColDropMarker"></div>').css({
            top: rect.top + "px",
            height: rect.height + "px"
        }).appendTo("body");
        ghost.data("left", rect.left);
        $(th).addClass("fmColDragging");
        $("body").addClass("fmColMoving");
    }

    function onMove(e){
        let dx = e.clientX - startX;
        if (ghost == null){
            if (Math.abs(dx) < FM_COLUMN_DRAG_THRESHOLD){
                return;
            }
            begin();
        }
        ghost.css("left", (ghost.data("left") + dx) + "px");

        //Lands in front of the first column whose middle is right of the cursor
        let cells = visibleHeaderCells();
        beforeKey = null;
        let markerX = null;
        for (let i = 0; i < cells.length; i++){
            let r = cells[i].getBoundingClientRect();
            if (e.clientX < r.left + r.width / 2){
                beforeKey = $(cells[i]).attr("data-sortkey");
                markerX = r.left;
                break;
            }
        }
        if (markerX == null && cells.length > 0){
            markerX = cells[cells.length - 1].getBoundingClientRect().right;
        }
        marker.css("left", (markerX - 1) + "px");
    }

    function onUp(){
        $(document).off("mousemove.fmcolmove mouseup.fmcolmove");
        if (ghost == null){
            //A plain click - leave it to the sort handler
            return;
        }
        ghost.remove();
        marker.remove();
        $(th).removeClass("fmColDragging");
        $("body").removeClass("fmColMoving");
        columnDragEndedAt = Date.now();

        if (beforeKey == key){
            return;
        }
        let order = detailsColumnOrder.filter(function(k){ return k != key; });
        let at = beforeKey == null ? order.length : order.indexOf(beforeKey);
        order.splice(at, 0, key);
        if (order.join(",") != detailsColumnOrder.join(",")){
            detailsColumnOrder = order;
            applyDetailsColumnOrder();
            saveDetailsColumns();
        }
    }

    $(document).on("mousemove.fmcolmove", onMove).on("mouseup.fmcolmove", onUp);
}

//Bound once from boot, delegated because the header is redrawn per listing
function bindDetailsColumnEvents(){
    let header = $("#fmListHeader");

    header.on("mousedown", ".fmColResize", function(event){
        if (event.button != 0){
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        startColumnResize(event, this);
    });

    header.on("dblclick", ".fmColResize", function(event){
        event.stopPropagation();
        resetColumnWidth(this);
    });

    //A click on the grip must not sort the column it belongs to
    header.on("click", ".fmColResize", function(event){
        event.stopPropagation();
    });

    header.on("mousedown", "th.fmSortable", function(event){
        if (event.button != 0){
            return;
        }
        //Keeps the press from starting a text selection across the header
        event.preventDefault();
        startColumnMove(event, this);
    });
}


/*
    Reachable from outside this file: inline on* attributes in the markup,
    handlers generated in template strings, or another frame. Renaming any
    of these means updating those call sites too.
*/
window.bindDetailsColumnEvents = bindDetailsColumnEvents;
window.columnHeaderClickSuppressed = columnHeaderClickSuppressed;
window.loadDetailsColumns = loadDetailsColumns;
window.orderedDetailsColumns = orderedDetailsColumns;
