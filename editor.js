// Silent Charges Level Editor
// Allows creating and editing levels for the game

// Constants from main game
const MAX_GRID_SIZE = 64;
const CANVAS_SIZE = 640;

const Tile = {
    FLOOR: 0,
    WALL: 1,
    VOID: 2
};

// Editor-specific constants
const EditorTool = {
    FLOOR: 'floor',
    WALL: 'wall',
    VOID: 'void',
    GUARD: 'guard',
    TARGET: 'target',
    ERASE: 'erase'
};

class Vec {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    equals(other) {
        return this.x === other.x && this.y === other.y;
    }

    clone() {
        return new Vec(this.x, this.y);
    }
}

class LevelEditor {
    constructor() {
        this.canvas = document.getElementById('editorCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Editor state
        this.currentTool = EditorTool.FLOOR;
        this.gridSize = 24;
        this.tileSize = CANVAS_SIZE / this.gridSize;
        this.isDragging = false;
        this.lastPaintPos = null;
        this.mousePos = new Vec(-1, -1); // Current mouse position
        this.showPreview = false;
        
        // Level data
        this.grid = [];
        this.guards = [];
        this.targets = [];
        this.guardIdCounter = 0;
        this.targetIdCounter = 0;
        
        this.initializeGrid();
        this.setupEventListeners();
        this.updateGridSize();
        this.render();
    }

    initializeGrid() {
        this.grid = [];
        for (let y = 0; y < this.gridSize; y++) {
            this.grid[y] = [];
            for (let x = 0; x < this.gridSize; x++) {
                this.grid[y][x] = Tile.VOID;
            }
        }
        
        // Clear entities when grid changes
        this.guards = [];
        this.targets = [];
        this.guardIdCounter = 0;
        this.targetIdCounter = 0;
        this.updateEntityLists();
    }

    setupEventListeners() {
        // Canvas events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
        this.canvas.addEventListener('mouseenter', (e) => this.handleMouseEnter(e));
        
        // Tool selection
        document.querySelectorAll('.tool-button').forEach(button => {
            button.addEventListener('click', (e) => {
                document.querySelector('.tool-button.active').classList.remove('active');
                button.classList.add('active');
                this.currentTool = button.dataset.tool;
            });
        });
        
        // Grid size change
        document.getElementById('gridSize').addEventListener('change', (e) => {
            this.gridSize = parseInt(e.target.value);
            this.updateGridSize();
        });
        
        // Configuration changes
        this.setupConfigListeners();
    }

    setupConfigListeners() {
        const configFields = ['levelId', 'levelName', 'timersAllowed', 'blastRange', 
                             'maxActiveBombs', 'maxBombsPerTurn', 'defaultHearingRadius'];
        
        configFields.forEach(fieldId => {
            const element = document.getElementById(fieldId);
            if (element) {
                element.addEventListener('change', () => this.updateStatusMessage('', false));
            }
        });
    }

    updateGridSize() {
        this.tileSize = CANVAS_SIZE / this.gridSize;
        this.initializeGrid();
        document.getElementById('currentGridSize').textContent = `${this.gridSize}×${this.gridSize}`;
        this.render();
    }

    getGridPos(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((clientX - rect.left) / this.tileSize);
        const y = Math.floor((clientY - rect.top) / this.tileSize);
        return new Vec(x, y);
    }

    isValidGridPos(pos) {
        return pos.x >= 0 && pos.x < this.gridSize && pos.y >= 0 && pos.y < this.gridSize;
    }

    handleMouseDown(e) {
        this.isDragging = true;
        const pos = this.getGridPos(e.clientX, e.clientY);
        this.lastPaintPos = pos;
        this.paint(pos);
    }

    handleMouseMove(e) {
        const pos = this.getGridPos(e.clientX, e.clientY);
        
        // Update preview position
        if (!this.mousePos.equals(pos)) {
            this.mousePos = pos;
            this.showPreview = this.isValidGridPos(pos);
            this.render();
        }
        
        // Handle painting when dragging
        if (this.isDragging) {
            // Only paint if we moved to a different tile
            if (!this.lastPaintPos || !pos.equals(this.lastPaintPos)) {
                this.paint(pos);
                this.lastPaintPos = pos;
            }
        }
    }

    handleMouseUp(e) {
        this.isDragging = false;
        this.lastPaintPos = null;
    }

    handleMouseEnter(e) {
        this.handleMouseMove(e);
    }

    handleMouseLeave(e) {
        this.showPreview = false;
        this.mousePos = new Vec(-1, -1);
        this.render();
    }

    paint(pos) {
        if (!this.isValidGridPos(pos)) return;

        switch (this.currentTool) {
            case EditorTool.FLOOR:
                this.grid[pos.y][pos.x] = Tile.FLOOR;
                this.removeEntitiesAt(pos);
                break;
            case EditorTool.WALL:
                this.grid[pos.y][pos.x] = Tile.WALL;
                this.removeEntitiesAt(pos);
                break;
            case EditorTool.VOID:
                this.grid[pos.y][pos.x] = Tile.VOID;
                this.removeEntitiesAt(pos);
                break;
            case EditorTool.GUARD:
                if (this.grid[pos.y][pos.x] === Tile.FLOOR) {
                    this.removeGuardAt(pos);
                    this.guards.push({
                        id: this.guardIdCounter++,
                        x: pos.x,
                        y: pos.y,
                        hearingRadius: parseInt(document.getElementById('defaultHearingRadius').value)
                    });
                    this.updateEntityLists();
                }
                break;
            case EditorTool.TARGET:
                if (this.grid[pos.y][pos.x] === Tile.FLOOR) {
                    this.removeTargetAt(pos);
                    this.targets.push({
                        id: this.targetIdCounter++,
                        x: pos.x,
                        y: pos.y
                    });
                    this.updateEntityLists();
                }
                break;
            case EditorTool.ERASE:
                this.removeEntitiesAt(pos);
                break;
        }
        
        this.render();
    }

    removeEntitiesAt(pos) {
        this.removeGuardAt(pos);
        this.removeTargetAt(pos);
        this.updateEntityLists();
    }

    removeGuardAt(pos) {
        const index = this.guards.findIndex(guard => guard.x === pos.x && guard.y === pos.y);
        if (index !== -1) {
            this.guards.splice(index, 1);
            return true;
        }
        return false;
    }

    removeTargetAt(pos) {
        const index = this.targets.findIndex(target => target.x === pos.x && target.y === pos.y);
        if (index !== -1) {
            this.targets.splice(index, 1);
            return true;
        }
        return false;
    }

    removeGuard(id) {
        const index = this.guards.findIndex(guard => guard.id === id);
        if (index !== -1) {
            this.guards.splice(index, 1);
            this.updateEntityLists();
            this.render();
        }
    }

    removeTarget(id) {
        const index = this.targets.findIndex(target => target.id === id);
        if (index !== -1) {
            this.targets.splice(index, 1);
            this.updateEntityLists();
            this.render();
        }
    }

    updateEntityLists() {
        // Update guards list
        const guardsList = document.getElementById('guardsList');
        if (this.guards.length === 0) {
            guardsList.innerHTML = '<div style="text-align: center; color: #888; font-size: 12px;">No guards placed</div>';
        } else {
            guardsList.innerHTML = this.guards.map(guard => `
                <div class="entity-item">
                    <span>Guard (${guard.x}, ${guard.y}) - R:${guard.hearingRadius}</span>
                    <button onclick="editor.removeGuard(${guard.id})">×</button>
                </div>
            `).join('');
        }
        
        // Update targets list
        const targetsList = document.getElementById('targetsList');
        if (this.targets.length === 0) {
            targetsList.innerHTML = '<div style="text-align: center; color: #888; font-size: 12px;">No targets placed</div>';
        } else {
            targetsList.innerHTML = this.targets.map(target => `
                <div class="entity-item">
                    <span>Target (${target.x}, ${target.y})</span>
                    <button onclick="editor.removeTarget(${target.id})">×</button>
                </div>
            `).join('');
        }
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Render grid
        this.renderGrid();
        
        // Render tiles
        this.renderTiles();
        
        // Render entities
        this.renderEntities();
        
        // Render preview
        this.renderPreview();
    }

    renderGrid() {
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 0.5;
        
        for (let x = 0; x <= this.gridSize; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * this.tileSize, 0);
            this.ctx.lineTo(x * this.tileSize, CANVAS_SIZE);
            this.ctx.stroke();
        }
        
        for (let y = 0; y <= this.gridSize; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * this.tileSize);
            this.ctx.lineTo(CANVAS_SIZE, y * this.tileSize);
            this.ctx.stroke();
        }
    }

    renderTiles() {
        for (let y = 0; y < this.gridSize; y++) {
            for (let x = 0; x < this.gridSize; x++) {
                const tile = this.grid[y][x];
                const screenX = x * this.tileSize;
                const screenY = y * this.tileSize;
                
                switch (tile) {
                    case Tile.WALL:
                        this.ctx.fillStyle = '#666';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        break;
                    case Tile.FLOOR:
                        this.ctx.fillStyle = '#222';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        break;
                    case Tile.VOID:
                        this.ctx.fillStyle = '#000';
                        this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                        break;
                }
            }
        }
    }

    renderEntities() {
        // Render targets
        for (const target of this.targets) {
            const screenX = target.x * this.tileSize;
            const screenY = target.y * this.tileSize;
            
            // Draw target as red square
            this.ctx.fillStyle = '#ff4444';
            this.ctx.fillRect(
                screenX + this.tileSize * 0.2,
                screenY + this.tileSize * 0.2,
                this.tileSize * 0.6,
                this.tileSize * 0.6
            );
            
            // Add inner detail
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(
                screenX + this.tileSize * 0.4,
                screenY + this.tileSize * 0.4,
                this.tileSize * 0.2,
                this.tileSize * 0.2
            );
        }
        
        // Render guards
        for (const guard of this.guards) {
            const screenX = guard.x * this.tileSize;
            const screenY = guard.y * this.tileSize;
            
            // Draw guard as blue circle
            this.ctx.fillStyle = '#4444ff';
            this.ctx.beginPath();
            this.ctx.arc(
                screenX + this.tileSize / 2,
                screenY + this.tileSize / 2,
                this.tileSize * 0.3,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            
            // Draw hearing radius as faint circle
            this.ctx.strokeStyle = '#4444ff';
            this.ctx.globalAlpha = 0.2;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(
                screenX + this.tileSize / 2,
                screenY + this.tileSize / 2,
                guard.hearingRadius * this.tileSize,
                0,
                Math.PI * 2
            );
            this.ctx.stroke();
            this.ctx.globalAlpha = 1.0;
        }
    }

    renderPreview() {
        if (!this.showPreview || !this.isValidGridPos(this.mousePos)) return;
        
        const screenX = this.mousePos.x * this.tileSize;
        const screenY = this.mousePos.y * this.tileSize;
        
        // Save current alpha
        const originalAlpha = this.ctx.globalAlpha;
        this.ctx.globalAlpha = 0.6;
        
        switch (this.currentTool) {
            case EditorTool.FLOOR:
                this.ctx.fillStyle = '#444'; // Lighter than normal floor
                this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                break;
                
            case EditorTool.WALL:
                this.ctx.fillStyle = '#888'; // Lighter than normal wall
                this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                break;
                
            case EditorTool.VOID:
                this.ctx.fillStyle = '#111'; // Lighter than normal void
                this.ctx.fillRect(screenX, screenY, this.tileSize, this.tileSize);
                break;
                
            case EditorTool.GUARD:
                if (this.grid[this.mousePos.y][this.mousePos.x] === Tile.FLOOR) {
                    // Preview guard as semi-transparent blue circle
                    this.ctx.fillStyle = '#6666ff';
                    this.ctx.beginPath();
                    this.ctx.arc(
                        screenX + this.tileSize / 2,
                        screenY + this.tileSize / 2,
                        this.tileSize * 0.3,
                        0,
                        Math.PI * 2
                    );
                    this.ctx.fill();
                    
                    // Show hearing radius preview
                    const hearingRadius = parseInt(document.getElementById('defaultHearingRadius').value);
                    this.ctx.strokeStyle = '#6666ff';
                    this.ctx.lineWidth = 1;
                    this.ctx.beginPath();
                    this.ctx.arc(
                        screenX + this.tileSize / 2,
                        screenY + this.tileSize / 2,
                        hearingRadius * this.tileSize,
                        0,
                        Math.PI * 2
                    );
                    this.ctx.stroke();
                }
                break;
                
            case EditorTool.TARGET:
                if (this.grid[this.mousePos.y][this.mousePos.x] === Tile.FLOOR) {
                    // Preview target as semi-transparent red square
                    this.ctx.fillStyle = '#ff6666';
                    this.ctx.fillRect(
                        screenX + this.tileSize * 0.2,
                        screenY + this.tileSize * 0.2,
                        this.tileSize * 0.6,
                        this.tileSize * 0.6
                    );
                    
                    // Add inner detail
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fillRect(
                        screenX + this.tileSize * 0.4,
                        screenY + this.tileSize * 0.4,
                        this.tileSize * 0.2,
                        this.tileSize * 0.2
                    );
                }
                break;
                
            case EditorTool.ERASE:
                // Show an X for erase tool
                this.ctx.strokeStyle = '#ff4444';
                this.ctx.lineWidth = 2;
                const margin = this.tileSize * 0.2;
                this.ctx.beginPath();
                this.ctx.moveTo(screenX + margin, screenY + margin);
                this.ctx.lineTo(screenX + this.tileSize - margin, screenY + this.tileSize - margin);
                this.ctx.moveTo(screenX + this.tileSize - margin, screenY + margin);
                this.ctx.lineTo(screenX + margin, screenY + this.tileSize - margin);
                this.ctx.stroke();
                break;
        }
        
        // Restore original alpha
        this.ctx.globalAlpha = originalAlpha;
        
        // Add a subtle border to show the preview tile
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.globalAlpha = 0.3;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(screenX, screenY, this.tileSize, this.tileSize);
        this.ctx.globalAlpha = originalAlpha;
    }

    exportLevel() {
        const levelData = {
            id: document.getElementById('levelId').value,
            name: document.getElementById('levelName').value,
            config: {
                gridSize: this.gridSize,
                timersAllowed: document.getElementById('timersAllowed').checked,
                blastRange: parseInt(document.getElementById('blastRange').value),
                maxActiveBombs: parseInt(document.getElementById('maxActiveBombs').value),
                maxBombsPerTurn: parseInt(document.getElementById('maxBombsPerTurn').value),
                defaultHearingRadius: parseInt(document.getElementById('defaultHearingRadius').value),
                memoryTTL: 8,
                chainReactions: false
            },
            guards: this.guards.map(guard => ({
                x: guard.x,
                y: guard.y,
                hearingRadius: guard.hearingRadius
            })),
            targets: this.targets.map(target => ({
                x: target.x,
                y: target.y
            })),
            grid: this.grid.map(row => [...row])
        };
        
        const json = JSON.stringify(levelData, null, 2);
        document.getElementById('jsonOutput').value = json;
        
        this.updateStatusMessage('Level exported successfully!', true);
        return json;
    }

    importLevel(jsonString = null) {
        try {
            const json = jsonString || document.getElementById('jsonOutput').value;
            if (!json.trim()) {
                this.updateStatusMessage('Please paste JSON data first', false);
                return;
            }
            
            const levelData = JSON.parse(json);
            
            // Validate basic structure
            if (!levelData.id || !levelData.name || !levelData.config || !levelData.grid) {
                throw new Error('Invalid level format');
            }
            
            // Load configuration
            document.getElementById('levelId').value = levelData.id;
            document.getElementById('levelName').value = levelData.name;
            document.getElementById('gridSize').value = levelData.config.gridSize || 24;
            document.getElementById('timersAllowed').checked = levelData.config.timersAllowed || false;
            document.getElementById('blastRange').value = levelData.config.blastRange || 3;
            document.getElementById('maxActiveBombs').value = levelData.config.maxActiveBombs || 4;
            document.getElementById('maxBombsPerTurn').value = levelData.config.maxBombsPerTurn || 1;
            document.getElementById('defaultHearingRadius').value = levelData.config.defaultHearingRadius || 8;
            
            // Update grid size and initialize
            this.gridSize = levelData.config.gridSize || 24;
            this.updateGridSize();
            
            // Load grid data
            if (levelData.grid && levelData.grid.length > 0) {
                for (let y = 0; y < Math.min(levelData.grid.length, this.gridSize); y++) {
                    for (let x = 0; x < Math.min(levelData.grid[y].length, this.gridSize); x++) {
                        this.grid[y][x] = levelData.grid[y][x];
                    }
                }
            }
            
            // Load entities
            this.guards = (levelData.guards || []).map((guard, index) => ({
                id: index,
                x: guard.x,
                y: guard.y,
                hearingRadius: guard.hearingRadius || 8
            }));
            this.guardIdCounter = this.guards.length;
            
            this.targets = (levelData.targets || []).map((target, index) => ({
                id: index,
                x: target.x,
                y: target.y
            }));
            this.targetIdCounter = this.targets.length;
            
            this.updateEntityLists();
            this.render();
            
            this.updateStatusMessage('Level imported successfully!', true);
        } catch (error) {
            this.updateStatusMessage(`Import failed: ${error.message}`, false);
        }
    }

    clearLevel() {
        if (confirm('Are you sure you want to clear the entire level?')) {
            this.initializeGrid();
            this.render();
            this.updateStatusMessage('Level cleared', true);
        }
    }

    updateStatusMessage(message, isSuccess) {
        const statusElement = document.getElementById('statusMessage');
        if (message) {
            statusElement.textContent = message;
            statusElement.className = isSuccess ? 'status-success' : 'status-error';
            statusElement.style.display = 'block';
            
            // Hide after 3 seconds
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 3000);
        } else {
            statusElement.style.display = 'none';
        }
    }

    validateLevel() {
        const errors = [];
        
        // Check for at least one target
        if (this.targets.length === 0) {
            errors.push('Level must have at least one target');
        }
        
        // Check that all entities are on floor tiles
        for (const guard of this.guards) {
            if (this.grid[guard.y][guard.x] !== Tile.FLOOR) {
                errors.push(`Guard at (${guard.x}, ${guard.y}) is not on a floor tile`);
            }
        }
        
        for (const target of this.targets) {
            if (this.grid[target.y][target.x] !== Tile.FLOOR) {
                errors.push(`Target at (${target.x}, ${target.y}) is not on a floor tile`);
            }
        }
        
        return errors;
    }

    testLevel() {
        const errors = this.validateLevel();
        if (errors.length > 0) {
            alert('Level validation failed:\n\n' + errors.join('\n'));
            return;
        }
        
        // Export level and open in new tab for testing
        const json = this.exportLevel();
        const encodedLevel = encodeURIComponent(json);
        const testUrl = `index.html?testLevel=${encodedLevel}`;
        window.open(testUrl, '_blank');
    }
}

// Global functions for HTML onclick handlers
function exportLevel() {
    editor.exportLevel();
}

function importLevel() {
    editor.importLevel();
}

function clearLevel() {
    editor.clearLevel();
}

function testLevel() {
    editor.testLevel();
}

function copyToClipboard() {
    const textArea = document.getElementById('jsonOutput');
    textArea.select();
    document.execCommand('copy');
    editor.updateStatusMessage('JSON copied to clipboard!', true);
}

// Initialize editor when page loads
let editor;
window.addEventListener('load', () => {
    editor = new LevelEditor();
});