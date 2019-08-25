<html>
<head>
  <style>
	#minesweeper-main {
	  display: flex;
	}

	#game-container {
	  display: inline-block;
	  padding: 10px 10px 1px 10px;
	  background-color: #BEBFC0;
	}

	#help-container {
	  border: 1px solid black;
	  flex: 1;
	  margin: 0px 10px;
	  padding: 10px;
	}

	.inset {
	  border-top: 3px solid #808080;
	  border-right: 3px solid white;
	  border-bottom: 3px solid white;
	  border-left: 3px solid #808080;
	}

	.outset {
	  border-top: 3px solid white;
	  border-right: 3px solid #808080;
	  border-bottom: 3px solid #808080;
	  border-left: 3px solid white;
	}

	.control-panel {
	  /* width set in minesweeper.js:initControlPanel */
	  height: 38px;
	  margin-bottom: 10px;
	}

	.reset-button {
	  width: 32px;
	  height: 32px;
	  font-size: 28px;
	  text-align: center;
	  /* margin-left set in minesweeper.js:initControlPanel to center this */
	}

	.counter {
	  font-family: sans-serif;
	  font-size: 30px;
	  color: red;
	  background-color: black;
	  padding: 2px 7px 0px 7px;
	  height: 36px;
	  min-width: 51px;
	}

	.cell {
	  padding: 5px 2px 6px 9px;
	  font-family: monospace;
	  font-weight: bold;
	  color: #C0C0C0;
	  background-color: #C0C0C0;
	  width: 21px;
	  height: 21px;
	}

	.revealed {
	  border-top: 1px solid #828282;
	  border-left: 1px solid #828282;
	  text-align: center;
	  padding: 8px 8px 8px 8px;
	  min-width: 10px;
	}

	.cell-X {
	  color: black;
	  background-color: #e64723;
	}

	.cell-0 {
	  color: #C2C2C2;
	  background-color: #C2C2C2;
	}

	.cell-1 {
	  color: #110CBD; /* blue */
	}

	.cell-2 {
	  color: #155F10; /* green */
	}

	.cell-3 {
	  color: #BB1419; /* red */
	}

	.cell-4 {
	  color: #02126A; /* indigo */
	}

	.cell-5 {
	  color: #740E19; /* brown */
	}

	.cell-6 {
	  color: #008284; /* teal */
	}

	.cell-7 {
	  color: #840185; /* purple */
	}

	.cell-8 {
	  color: #757575; /* gray */
	}

	.debug {
	  color: #A0A0A0;
	}

	.debug-link {
	  color: #BEBFC0;
	  text-decoration: none;
	}

	.flagged {
	  color: black;
	  text-align: right;
	}

	.no-highlight {
	  -webkit-touch-callout: none;
	  -webkit-user-select: none;
	  -khtml-user-select: none;
	  -moz-user-select: none;
	  -ms-user-select: none;
	  user-select: none;
	}

	div {
	  min-width: 21px;
	  min-height: 21px;
	}

	div.mine {
	  text-align: right;
	}

	td:not(.revealed):not(.debug) > div.mine {
	  visibility: hidden;
	}
    
    body{
        background:rgba(255,255,255,0.5);
    }
  </style>
</head>
<body>
  <p id='mine-count'></p>
  <div id="minesweeper-main" class="no-highlight">
    <div id="game-container"></div>
    <div id="help-container" style="display:none;">
      <p>Misclicks: <span id="misclick-counter">0</span></p>
    </div>
  </div>

  <script src='../../script/jquery.min.js'></script>
   <script src='../../script/ao_module.js'></script>
   <script>
       //Init of the module
       ao_module_setGlassEffectMode();
       ao_module_setWindowSize(345,430);
       ao_module_setFixedWindowSize();
       ao_module_setWindowIcon("bomb");
       ao_module_setWindowTitle("Minesweeper");
   </script>
  <script>
	 /**
	 * Constructor for a Minesweeper game object.
	 *
	 * @param {String} containerId HTML ID for an empty element to contain this
	 *     minesweeper game's display.
	 */
	var Minesweeper = function(containerId) {
	  this.mainContainer = $(containerId);

	  this.MINE = '\uD83D\uDCA3'; // bomb emoji
	  this.FLAG = '\uD83D\uDEA9'; // triangle flag emoji
	  this.MAX_TIME = 999;
	  this.SETTINGS = {
		BEGINNER: {
		  rows: 8,
		  cols: 8,
		  mines: 10 
		},
		INTERMEDIATE: {
		  rows: 16,
		  cols: 16,
		  mines: 40
		},
		EXPERT: {
		  rows: 16,
		  cols: 30,
		  mines: 99
		}
	  };
	};

	/**
	 * Attaches Minesweeper display to screen and sets up click listeners.
	 */
	Minesweeper.prototype.init = function(settings) {
	  this.debug = false;

	  this.settings = settings;
	  this.won = false;
	  this.lost = false;

	  this.firstClickOccurred = false;

	  this.cellsRevealed = 0;
	  this.cellsFlagged = 0;
	  this.cellsToReveal = (settings.rows * settings.cols) - settings.mines;

	  this.elapsedTime = 0;
	  clearInterval(this.timeInterval);

	  this.misclickCount = 0;

	  this.initField(settings.rows, settings.cols);
	  this.initDisplay();
	};

	/**
	 * Only generates a 2-D array with the given rows and cols as dimensions; does
	 * not actually add mines to field. Mines are added after the first click.
	 *
	 * Each cell is an object with two properties: val and flagged. Each val is
	 * either MINE or a number representing how many MINEs are adjacent to that
	 * cell. flagged starts out as false and is toggled when the user marks a cell
	 * as a flag.
	 */
	Minesweeper.prototype.initField = function(rows, cols) {
	  // Initialize 2-D array
	  this.field = [];
	  for (var i = 0; i < rows; i++) {
		var row = new Array(cols);
		for (var j = 0; j < cols; j++) {
		  row[j] = { val: 0, flagged: false };
		}
		this.field.push(row);
	  }
	};

	/**
	 * Updates this.field to contain the number of mines requested.
	 *
	 * Should be called after the user has made their first click so that mines can
	 * be placed while avoiding that location.
	 */
	Minesweeper.prototype.setMines = function(mines, firstClickRow, firstClickCol) {
	  var field = this.field;
	  var rows = field.length;
	  var cols = field[0].length;

	  // Must count mines actually planted so that mines are not placed in
	  // previously selected locations.
	  var minesPlanted = 0;
	  while (minesPlanted != mines) {
		var row = Math.floor(Math.random() * rows);
		var col = Math.floor(Math.random() * cols);

		// Cannot use cell if the user just clicked it or if it was already a mine
		if ((row == firstClickRow && col == firstClickCol)
		  || (field[row][col] && field[row][col].val == this.MINE)) continue;

		field[row][col] = {
		  val: this.MINE,
		  flagged: false
		};

		minesPlanted++;
	  }

	  // Fill field with mine counts
	  for (var i = 0; i < rows; i++) {
		for (var j = 0; j < cols; j++) {
		  field[i][j].val = this.countAdjacentMines(i, j);
		}
	  }
	};

	/**
	 * For a given coordinate, returns the number of mines it is next to.
	 */
	Minesweeper.prototype.countAdjacentMines = function(row, col) {
	  var field = this.field;
	  if (field[row][col] && field[row][col].val == this.MINE) return this.MINE;
	  var count = 0;
	  var neighbors = this.getNeighbors(row, col);
	  for (var i = 0; i < neighbors.length; i++) {
		var r = neighbors[i].row;
		var c = neighbors[i].col;
		if (field[r][c] && field[r][c].val == this.MINE) count++;
	  }
	  return count;
	};

	/**
	 * Every cell calls this click handler the first time it's clicked. If it was
	 * the first cell to be clicked (flagged cells do not count), this finally adds
	 * mines to the screen and excludes this click. Otherwise, a first click was
	 * already made, so we can just change this cell's click handler for the
	 * duration of the game.
	 */
	Minesweeper.prototype.firstClickHandler = function(row, col) {
	  if (this.field[row][col].flagged) return;

	  if (this.firstClickOccurred) {
		var that = this;
		var cell = this.getCell(row, col);
		cell.unbind('click');
		cell.click(function(event) {
		  that.mainClickHandler(row, col);
		});
	  } else {
		this.firstClickOccurred = true;
		this.setMines(this.settings.mines, row, col);
		this.initDisplay();
		this.startTimer();
	  }

	  this.mainClickHandler(row, col);
	};

	/**
	 * Adds HTML table for this object's already initialized field. Control panel is
	 * added after mines are added in order to set width correctly.
	 */
	Minesweeper.prototype.initDisplay = function() {
	  // for resetting the game
	  if (this.display) this.display.empty();

	  this.display = $('#game-container');
	  this.gameTable = $(document.createElement('table'));
	  this.gameTable.addClass('no-highlight inset');
	  this.gameTable.attr('cellspacing', 0);

	  var that = this;
	  this.field.forEach(function(row, r) {

		var tr = document.createElement('tr');
		row.forEach(function(cell, c) {

		  var td = $(document.createElement('td'));
		  td.html(that.createElemForValue(that.field[r][c].val));

		  // left click
		  td.click(function(event) {
			that.firstClickHandler(r, c);
		  });
		  
		  // right click
		  td.get(0).oncontextmenu = function(event) {
			event.preventDefault();
			that.toggleFlag(r, c);
		  };

		  // styling
		  td.addClass('cell outset');
		  if (that.debug) td.addClass('debug');
		  if (that.field[r][c].flagged) {
			td.addClass('flagged');
			td.html(that.FLAG);
		  }

		  tr.appendChild(td.get(0));
		});
		that.gameTable.append(tr);
	  });
	  this.display.prepend(this.gameTable);
	  this.initControlPanel();
	  this.initHelper();
	};

	/**
	 * Control panel is the top portion that has the timer, mine count, and reset
	 * button. This adds those components to the top of the container.  Must be
	 * called after the game cells are added so that the total width can be used.
	 */
	Minesweeper.prototype.initControlPanel = function() {
	  var that = this;
	  this.controlPanel = $(document.createElement('div'));
	  this.controlPanel.resetButton = $(document.createElement('div'));
	  this.controlPanel.flagCount = $(document.createElement('div'));
	  this.controlPanel.timer = $(document.createElement('div'));

	  var controlPanel = this.controlPanel;
	  var resetButton = this.controlPanel.resetButton;
	  var flagCount = this.controlPanel.flagCount;
	  var timer = this.controlPanel.timer;

	  controlPanel.append(resetButton);
	  this.display.prepend(controlPanel);

	  // overall panel styling
	  controlPanel.addClass('control-panel inset');

	  // debug link styling
	  var debugLink = $(document.createElement('a'));
	  debugLink.html('debug');
	  debugLink.click(this.toggleDebug);
	  debugLink.addClass('debug-link');
	  this.display.append(debugLink);

	  // reset button styling and clicks
	  resetButton.addClass('reset-button outset');
	  resetButton.css('margin-left',
		  (controlPanel.innerWidth() - resetButton.width()) / 2);
	  resetButton.click(function(event) {
		that.init(that.settings);
	  });

	  // counter for mines left
	  controlPanel.prepend(flagCount);
	  flagCount.addClass('counter');
	  flagCount.html(this.zeroFill(this.settings.mines, 2));
	  flagCount.css('float', 'left');

	  // counter for time elapsed
	  controlPanel.prepend(timer);
	  timer.addClass('counter');
	  timer.html(this.zeroFill(0));
	  timer.css('float', 'right');
	  timer.css('text-align', 'right');
	};

	Minesweeper.prototype.initHelper = function() {
	  this.misclickDisplay = $('#misclick-counter');
	};

	/**
	 * Returns the HTML element for this cell.
	 */
	Minesweeper.prototype.getCell = function(row, col) {
	  return $(this.gameTable[0].rows[row].cells[col]);
	};

	/**
	 * Click (left) usually means reveal the cell selected. For revealed cells,
	 * behavior depends on its neighbors. If the number of unrevealed neighbors is
	 * equal to this cell's value, flag all of them. If the user has already flagged
	 * exactly as many mines as this cell's value, expand the rest (potentially
	 * resulting in a loss).
	 */
	Minesweeper.prototype.mainClickHandler = function(row, col) {
	  var field = this.field;

	  // do nothing if already lost or if a flagged cell is clicked
	  if (this.gameEnded() || field[row][col].flagged) return;

	  if (!this.getCell(row, col).hasClass('revealed')) {
		this.revealCell(row, col);

	  } else if (this.flagAllNeighborsRequested(row, col)) {
		var neighbors = this.getNeighbors(row, col);
		for (var i = 0; i < neighbors.length; i++) {
		  this.toggleFlag(neighbors[i].row, neighbors[i].col, true);
		}

	  } else if (this.expandRequested(row, col)) {
		var neighbors = this.getNeighbors(row, col);
		for (var i = 0; i < neighbors.length; i++) {
		  this.revealCell(neighbors[i].row, neighbors[i].col);
		  if (this.gameEnded()) return;
		}

	  } else {
		this.misclickCount++;
		this.misclickDisplay.html(this.misclickCount);
	  }
	};

	/**
	 * Reveals cell at (row, col), then recursively expands its neighbors if it
	 * doesn't have any neighboring mines (i.e., its field value is 0).
	 *
	 * It is possible to lose if the user manually tries to expand all neighbors on
	 * a cell by incorrectly flagging neighboring cells (see mainClickHandler);
	 * otherwise, it shouldn't be possible for this to result in a loss.
	 */
	Minesweeper.prototype.revealCell = function(row, col) {
	  // base case: don't reveal flagged or already revealed cells
	  if (this.field[row][col].flagged
		  || this.getCell(row, col).hasClass('revealed')) return;

	  this.revealSingleCell(row, col);

	  // base case: stop expanding if cell is non-zero or its reveal lead to a loss 
	  if (this.gameEnded() || this.field[row][col].val != 0) return;

	  // recursive step: reveal neighbors
	  var neighbors = this.getNeighbors(row, col);
	  for (var i = 0; i < neighbors.length; i++) {
		this.revealCell(neighbors[i].row, neighbors[i].col);
		if (this.gameEnded()) return;
	  }
	};

	/**
	 * Updates styling for a cell so that it shows its number on the screen.
	 * Checks whether this reveal resulted in a win or loss.
	 */
	Minesweeper.prototype.revealSingleCell = function(row, col) {
	  var displayCell = this.getCell(row, col);
	  var cell = this.field[row][col];

	  if (displayCell.hasClass('revealed') || cell.flagged) return;

	  displayCell.html(this.createElemForValue(cell.val));
	  displayCell.addClass('revealed cell-' + (cell.val == this.MINE ? 'X' : cell.val));
	  displayCell.removeClass('outset');
	  if (this.debug) displayCell.removeClass('debug');

	  this.cellsRevealed++;
	  if (cell.val == this.MINE) {
		this.displayLoss();
	  } else if (this.cellsRevealed == this.cellsToReveal) {
		this.displayWin();
	  }
	};

	/**
	 * Returns a list of coordinates for cells adjacent to this row and column.
	 */
	Minesweeper.prototype.getNeighbors = function(row, col) {
	  var field = this.field;
	  var neighbors = [];
	  for (var r = row - 1; r <= row + 1; r++) {
		for (var c = col - 1; c <= col + 1; c++) {
		  if (0 <= r && r < field.length
			  && 0 <= c && c < field[0].length
			  && !(r == row && c == col)) {
			neighbors.push({row: r, col: c});
		  }
		}
	  }
	  return neighbors;
	};

	/**
	 * Non-traditional feature: If user clicks on a revealed cell and it has exactly
	 * as many unrevealed cells as its mine count, this returns true so that all of
	 * its cells can be flagged immediately.
	 */
	Minesweeper.prototype.flagAllNeighborsRequested = function(row, col) {
	  if (!this.getCell(row, col).hasClass('revealed')) return false;

	  var unrevealedCount = 0;
	  var neighbors = this.getNeighbors(row, col);
	  for (var i = 0; i < neighbors.length; i++) {
		var neighbor = this.getCell(neighbors[i].row, neighbors[i].col);
		if (!neighbor.hasClass('revealed')) {
		  unrevealedCount++;
		}
	  }

	  return unrevealedCount == this.field[row][col].val;
	};

	/**
	 * A valid expansion request is one where the cell clicked has already been
	 * revealed and has exactly as many flagged neighbors as its own value.
	 */
	Minesweeper.prototype.expandRequested = function(row, col) {
	  if (!this.getCell(row, col).hasClass('revealed')) return false;

	  var flagCount = 0;
	  var neighbors = this.getNeighbors(row, col);
	  for (var i = 0; i < neighbors.length; i++) {
		var r = neighbors[i].row;
		var c = neighbors[i].col;
		var neighbor = this.getCell(r, c);
		if (!neighbor.hasClass('revealed') && this.field[r][c].flagged) {
		  flagCount++;
		}
	  }

	  return flagCount == this.field[row][col].val;
	};

	/**
	 * Switches styling to display a flagged or unflagged cell.
	 * @param {Boolean} forceFlag allows an already-flagged cell to stay flagged.
	 */
	Minesweeper.prototype.toggleFlag = function(row, col, forceFlag) {
	  var displayCell = this.getCell(row, col);

	  if (this.gameEnded() || displayCell.hasClass('revealed')) return;

	  var cell = this.field[row][col];
	  if (!this.field[row][col].flagged) {
		displayCell.addClass('flagged');
		displayCell.html(this.createElemForValue(this.FLAG));
		this.cellsFlagged++;
		cell.flagged = true;
	  } else if (!forceFlag) {
		displayCell.removeClass('flagged');
		displayCell.html(this.createElemForValue(cell.val));
		this.cellsFlagged--;
		cell.flagged = false;
	  }
	  this.controlPanel.flagCount.html(this.settings.mines - this.cellsFlagged);
	};

	/**
	 * Starts timer so that display clock ticks every second.
	 */
	Minesweeper.prototype.startTimer = function() {
	  var that = this;
	  this.timeInterval = setInterval(function() {
		that.controlPanel.timer.html(++that.elapsedTime);
		if (that.elapsedTime == that.MAX_TIME)
		  clearInterval(that.timeInterval);
	  }, 1000);
	};

	/**
	 * Stops timer and shows win message.
	 */
	Minesweeper.prototype.displayWin = function() {
	  this.won = true;
	  this.controlPanel.resetButton.html('\uD83D\uDE0E');
	  clearInterval(this.timeInterval);
	};

	/**
	 * Reveals all unflagged mines, shows loss message, and sets this.lost to true.
	 */
	Minesweeper.prototype.displayLoss = function() {
	  if (this.lost) return;
	  this.lost = true;
	  this.controlPanel.resetButton.html('\uD83D\uDE35'); // dizzy face emoji
	  clearInterval(this.timeInterval);
	  for (var r = 0; r < this.field.length; r++) {
		for (var c = 0; c < this.field[0].length; c++) {
		  var cell = this.field[r][c];
		  if (cell.val == this.MINE && !cell.flagged) {
			this.revealSingleCell(r, c);
		  }
		}
	  }
	};

	/**
	 * For debugging purposes, allow the user to continue playing as if they haven't
	 * lost, even if mines have been revealed.
	 */
	Minesweeper.prototype.gameEnded = function() {
	  return !this.debug && (this.won || this.lost);
	};

	/**
	 * Returns the given value as a string padded with zeroes up to length.
	 */
	Minesweeper.prototype.zeroFill = function(value, length) {
	  if (length === undefined) length = 3;
	  return value;
	};

	/**
	 * When called, reveals (or hides) values of all cells.
	 */
	Minesweeper.prototype.toggleDebug = function() {
	  this.debug = !this.debug;
	  $('.cell:not(.revealed)').toggleClass('debug');
	};

	/**
	 * Creates the div that must wrap cell values for min-width/height reasons.
	 */
	Minesweeper.prototype.createElemForValue = function(val) {
	  var div = $(document.createElement('div'));
	  if (val == this.MINE) {
		div.addClass('mine');
	  }
	  div.html(val);
	  return div.get(0);
	}

  </script>
<script>
    var ms = new Minesweeper('#minesweeper-main');
    ms.init(ms.SETTINGS.BEGINNER);
    //ms.init(ms.SETTINGS.EXPERT);
</script>
</body>
</html>

