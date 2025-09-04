// Silent Charges - Turn-based puzzle game
// Implementation based on the game brief

// Constants and enums
const MAX_GRID_SIZE = 64;
const CANVAS_SIZE = 640;

const Tile = {
    FLOOR: 0,
    WALL: 1,
    VOID: 2
};

const BombState = {
    TICKING: 'ticking',
    EXPLODING: 'exploding'
};

const GameState = {
    PLAYING: 'playing',
    WON: 'won',
    LOST: 'lost'
};

// Configuration
const DEFAULT_CONFIG = {
    gridSize: 32,
    blastRange: 3,
    defaultHearingRadius: 8,
    memoryTTL: 8,
    maxBombsPerTurn: 1,
    chainReactions: false,
    undoEnabled: true
};

// Utility functions
class Vec {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    equals(other) {
        return this.x === other.x && this.y === other.y;
    }

    manhattanDistance(other) {
        return Math.abs(this.x - other.x) + Math.abs(this.y - other.y);
    }

    clone() {
        return new Vec(this.x, this.y);
    }
}

// Entity classes
class Target {
    constructor(id, pos) {
        this.id = id;
        this.pos = new Vec(pos.x, pos.y);
        this.destroyed = false;
    }
}

class Bomb {
    constructor(id, pos, hasTimer = false) {
        this.id = id;
        this.pos = new Vec(pos.x, pos.y);
        this.hasTimer = hasTimer;
        this.timer = hasTimer ? 3 : 1; // Green = 3, Yellow = 2, Red = 1
        this.state = BombState.TICKING;
    }

    getNoiseLevel() {
        if (this.state === BombState.EXPLODING) return 4;
        if (!this.hasTimer) return 3; // Immediate bombs are always "red" noise
        
        // Timer to noise mapping: 3->1 (Green), 2->2 (Yellow), 1->3 (Red)
        return 4 - this.timer;
    }

    getColor() {
        if (!this.hasTimer) return '#ff0000'; // Red for immediate
        
        switch (this.timer) {
            case 3: return '#00ff00'; // Green
            case 2: return '#ffff00'; // Yellow  
            case 1: return '#ff0000'; // Red
            default: return '#ffffff';
        }
    }

    cycleTimer() {
        if (!this.hasTimer) return;
        this.timer = this.timer === 3 ? 1 : this.timer + 1; // 3->1, 1->2, 2->3
    }
}

class Guard {
    constructor(id, pos, hearingRadius = DEFAULT_CONFIG.defaultHearingRadius) {
        this.id = id;
        this.pos = new Vec(pos.x, pos.y);
        this.hearingRadius = hearingRadius;
        this.memory = null; // {pos: Vec, turnIndex: number}
        this.targetPos = null; // Current movement target
    }
}

// Level definition
class Level {
    constructor(levelData) {
        this.id = levelData.id;
        this.name = levelData.name;
        this.bounds = levelData.bounds || null; // Optional bounds for backward compatibility
        this.targets = [];
        this.guards = [];
        this.config = { ...DEFAULT_CONFIG, ...levelData.config };
        this.grid = this.createEmptyGrid();
        
        this.initializeFromData(levelData);
    }

    createEmptyGrid() {
        const grid = [];
        const gridSize = Math.min(this.config.gridSize || DEFAULT_CONFIG.gridSize, MAX_GRID_SIZE);
        for (let y = 0; y < gridSize; y++) {
            grid[y] = [];
            for (let x = 0; x < gridSize; x++) {
                grid[y][x] = Tile.VOID;
            }
        }
        return grid;
    }

    initializeFromData(levelData) {
        // Load grid data directly if available, otherwise parse ASCII layout
        if (levelData.grid && Array.isArray(levelData.grid)) {
            // Load from grid array
            for (let y = 0; y < Math.min(levelData.grid.length, this.config.gridSize); y++) {
                for (let x = 0; x < Math.min(levelData.grid[y].length, this.config.gridSize); x++) {
                    this.grid[y][x] = levelData.grid[y][x];
                }
            }
        } else if (levelData.layout) {
            // Parse ASCII layout (for backward compatibility)
            this.parseASCIILayout(levelData.layout);
        }

        // Add targets
        levelData.targets.forEach((targetData, index) => {
            this.targets.push(new Target(index, new Vec(targetData.x, targetData.y)));
        });

        // Add guards
        levelData.guards.forEach((guardData, index) => {
            const hearingRadius = guardData.hearingRadius || this.config.defaultHearingRadius;
            this.guards.push(new Guard(index, new Vec(guardData.x, guardData.y), hearingRadius));
        });
    }

    parseASCIILayout(layout) {
        const lines = layout.trim().split('\n');
        const startY = this.bounds ? this.bounds.y : 0;
        const startX = this.bounds ? this.bounds.x : 0;

        for (let row = 0; row < lines.length; row++) {
            const line = lines[row];
            for (let col = 0; col < line.length; col++) {
                const x = startX + col;
                const y = startY + row;
                
                if (x >= this.config.gridSize || y >= this.config.gridSize) continue;

                const char = line[col];
                switch (char) {
                    case '#':
                        this.grid[y][x] = Tile.WALL;
                        break;
                    case '.':
                    case 'G':
                    case 'T':
                    case 'S':
                        this.grid[y][x] = Tile.FLOOR;
                        break;
                    default:
                        this.grid[y][x] = Tile.VOID;
                }
            }
        }
    }

    isValidPosition(pos) {
        return pos.x >= 0 && pos.x < this.config.gridSize && pos.y >= 0 && pos.y < this.config.gridSize;
    }

    isPassable(pos) {
        if (!this.isValidPosition(pos)) return false;
        return this.grid[pos.y][pos.x] === Tile.FLOOR;
    }

    isOccupiedByTarget(pos) {
        return this.targets.some(target => !target.destroyed && target.pos.equals(pos));
    }

    isOccupiedByGuard(pos) {
        return this.guards.some(guard => guard.pos.equals(pos));
    }

    canPlaceBomb(pos) {
        if (!this.isValidPosition(pos)) return false;
        if (this.grid[pos.y][pos.x] !== Tile.FLOOR) return false;
        if (this.isOccupiedByTarget(pos)) return false;
        if (this.isOccupiedByGuard(pos)) return false;
        return true;
    }
}

// Pathfinding using A*
class Pathfinder {
    constructor(level) {
        this.level = level;
    }

    // Get path distance between two points (for sound propagation)
    getPathDistance(start, end) {
        if (start.equals(end)) return 0;

        const openSet = [{pos: start, g: 0, f: start.manhattanDistance(end)}];
        const closedSet = new Set();
        const gScore = new Map();
        gScore.set(`${start.x},${start.y}`, 0);

        while (openSet.length > 0) {
            // Sort by f score, then by h, then by y,x for determinism
            openSet.sort((a, b) => {
                if (a.f !== b.f) return a.f - b.f;
                const hA = a.pos.manhattanDistance(end);
                const hB = b.pos.manhattanDistance(end);
                if (hA !== hB) return hA - hB;
                if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
                return a.pos.x - b.pos.x;
            });

            const current = openSet.shift();
            const currentKey = `${current.pos.x},${current.pos.y}`;

            if (current.pos.equals(end)) {
                return current.g;
            }

            closedSet.add(currentKey);

            // Check all 4 directions
            const directions = [{x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}, {x: -1, y: 0}];
            
            for (const dir of directions) {
                const neighbor = new Vec(current.pos.x + dir.x, current.pos.y + dir.y);
                const neighborKey = `${neighbor.x},${neighbor.y}`;

                if (!this.level.isPassable(neighbor) || closedSet.has(neighborKey)) {
                    continue;
                }

                const tentativeG = current.g + 1;
                const currentGScore = gScore.get(neighborKey) || Infinity;

                if (tentativeG < currentGScore) {
                    gScore.set(neighborKey, tentativeG);
                    const f = tentativeG + neighbor.manhattanDistance(end);
                    
                    // Remove existing entry if present
                    const existingIndex = openSet.findIndex(item => 
                        item.pos.x === neighbor.x && item.pos.y === neighbor.y);
                    if (existingIndex >= 0) {
                        openSet.splice(existingIndex, 1);
                    }
                    
                    openSet.push({pos: neighbor, g: tentativeG, f: f});
                }
            }
        }

        return Infinity; // No path found
    }

    // Get next step towards target (returns next position or current position if can't move)
    getNextStep(start, target) {
        if (start.equals(target)) return start;

        const openSet = [{pos: start, g: 0, f: start.manhattanDistance(target), parent: null}];
        const closedSet = new Set();
        const gScore = new Map();
        gScore.set(`${start.x},${start.y}`, 0);

        while (openSet.length > 0) {
            openSet.sort((a, b) => {
                if (a.f !== b.f) return a.f - b.f;
                const hA = a.pos.manhattanDistance(target);
                const hB = b.pos.manhattanDistance(target);
                if (hA !== hB) return hA - hB;
                if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
                return a.pos.x - b.pos.x;
            });

            const current = openSet.shift();
            const currentKey = `${current.pos.x},${current.pos.y}`;

            if (current.pos.equals(target)) {
                // Reconstruct path to find first step
                let pathNode = current;
                while (pathNode.parent && !pathNode.parent.pos.equals(start)) {
                    pathNode = pathNode.parent;
                }
                return pathNode.pos;
            }

            closedSet.add(currentKey);

            const directions = [{x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}, {x: -1, y: 0}];
            
            for (const dir of directions) {
                const neighbor = new Vec(current.pos.x + dir.x, current.pos.y + dir.y);
                const neighborKey = `${neighbor.x},${neighbor.y}`;

                if (!this.level.isPassable(neighbor) || closedSet.has(neighborKey)) {
                    continue;
                }

                const tentativeG = current.g + 1;
                const currentGScore = gScore.get(neighborKey) || Infinity;

                if (tentativeG < currentGScore) {
                    gScore.set(neighborKey, tentativeG);
                    const f = tentativeG + neighbor.manhattanDistance(target);
                    
                    const existingIndex = openSet.findIndex(item => 
                        item.pos.x === neighbor.x && item.pos.y === neighbor.y);
                    if (existingIndex >= 0) {
                        openSet.splice(existingIndex, 1);
                    }
                    
                    openSet.push({pos: neighbor, g: tentativeG, f: f, parent: current});
                }
            }
        }

        return start; // No path found, stay in place
    }
}

// Main Game class
class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.level = null;
        this.bombs = [];
        this.turnIndex = 0;
        this.gameState = GameState.PLAYING;
        this.pathfinder = null;
        this.gameHistory = []; // For undo functionality
        this.bombIdCounter = 0;
        this.currentGridSize = DEFAULT_CONFIG.gridSize;
        this.currentTileSize = CANVAS_SIZE / this.currentGridSize;
        this.currentLevelIndex = 0;
        this.mousePos = new Vec(-1, -1); // Mouse position in grid coordinates
        this.showBombPreview = false;
        this.levels = []; // Will be loaded from JSON files
        this.explosions = []; // Active explosion animations
        this.animationLoopActive = false;
        this.gameOverFade = null; // Red fade animation
        this.autoTurnTimer = null; // Timer for automatic turn progression
        
        this.setupEventListeners();
        this.loadLevels(); // Load levels from JSON files
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseenter', (e) => this.handleMouseEnter(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
        document.getElementById('endTurnButton').addEventListener('click', () => this.endTurn());
        document.getElementById('nextLevelButton').addEventListener('click', () => this.nextLevel());
        document.getElementById('prevLevelButton').addEventListener('click', () => this.prevLevel());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.endTurn();
            } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.undo();
            }
        });
    }

    loadLevel(levelData, levelIndex = 0) {
        this.level = new Level(levelData);
        this.pathfinder = new Pathfinder(this.level);
        this.bombs = [];
        this.turnIndex = 0;
        this.gameState = GameState.PLAYING;
        this.gameHistory = [];
        this.bombIdCounter = 0;
        this.currentLevelIndex = levelIndex;
        
        // Update grid size and tile size for this level
        this.currentGridSize = Math.min(this.level.config.gridSize || DEFAULT_CONFIG.gridSize, MAX_GRID_SIZE);
        this.currentTileSize = CANVAS_SIZE / this.currentGridSize;
        
        this.updateUI();
        this.render();
        this.saveGameState();
    }

    restartLevel() {
        if (this.level && this.levels.length > this.currentLevelIndex) {
            this.loadLevel(this.levels[this.currentLevelIndex], this.currentLevelIndex);
        }
    }

    nextLevel() {
        if (this.currentLevelIndex < this.levels.length - 1) {
            this.currentLevelIndex++;
            this.loadLevel(this.levels[this.currentLevelIndex], this.currentLevelIndex);
        }
    }

    prevLevel() {
        if (this.currentLevelIndex > 0) {
            this.currentLevelIndex--;
            this.loadLevel(this.levels[this.currentLevelIndex], this.currentLevelIndex);
        }
    }

    async loadLevels() {
        try {
            // Check for test level in URL parameters first
            const urlParams = new URLSearchParams(window.location.search);
            const testLevelParam = urlParams.get('testLevel');
            if (testLevelParam) {
                try {
                    const testLevel = JSON.parse(decodeURIComponent(testLevelParam));
                    this.levels = [testLevel];
                    this.loadLevel(this.levels[0], 0);
                    return;
                } catch (error) {
                    console.warn('Failed to load test level:', error);
                }
            }

            // Load level index first to get the correct order
            const indexResponse = await fetch('levels/index.json');
            if (!indexResponse.ok) {
                throw new Error(`Failed to load level index: ${indexResponse.status}`);
            }
            
            const levelIndex = await indexResponse.json();
            const levelFiles = levelIndex.levels.map(levelInfo => levelInfo.file);
            
            // Load levels in the order specified by index.json
            const levelPromises = levelFiles.map(async (filename) => {
                try {
                    const response = await fetch(`levels/${filename}`);
                    if (!response.ok) {
                        throw new Error(`Failed to load ${filename}: ${response.status}`);
                    }
                    return await response.json();
                } catch (error) {
                    console.error(`Error loading ${filename}:`, error);
                    return null;
                }
            });

            const loadedLevels = await Promise.all(levelPromises);
            this.levels = loadedLevels.filter(level => level !== null);
            this.levelIndex = levelIndex; // Store index for reference

            if (this.levels.length === 0) {
                throw new Error('No levels could be loaded');
            }

            // Start with first level
            this.loadLevel(this.levels[0], 0);
        } catch (error) {
            console.error('Failed to load levels:', error);
            // Fallback to hardcoded levels if file loading fails
            this.loadFallbackLevels();
        }
    }

    loadFallbackLevels() {
        console.log('Loading fallback levels...');
        // Keep a minimal fallback level for emergencies
        this.levels = [{
            id: 'fallback-1',
            name: 'Fallback Level',
            config: {
                gridSize: 16,
                timersAllowed: false,
                blastRange: 3,
                maxActiveBombs: 4,
                maxBombsPerTurn: 1,
                defaultHearingRadius: 8,
                memoryTTL: 8,
                chainReactions: false
            },
            guards: [{x: 3, y: 3, hearingRadius: 8}],
            targets: [{x: 8, y: 5}],
            grid: [
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2],
                [2,1,0,0,0,0,0,0,0,0,0,0,0,0,1,2],
                [2,1,0,0,0,0,0,0,0,0,0,0,0,0,1,2],
                [2,1,0,0,0,0,0,0,0,0,0,0,0,0,1,2],
                [2,1,0,0,0,0,0,0,0,0,0,0,0,0,1,2],
                [2,1,0,0,0,0,0,0,0,0,0,0,0,0,1,2],
                [2,1,0,0,0,0,0,0,0,0,0,0,0,0,1,2],
                [2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],
                [2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]
            ]
        }];
        this.loadLevel(this.levels[0], 0);
    }

    handleCanvasClick(e) {
        if (this.gameState !== GameState.PLAYING) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.currentTileSize);
        const y = Math.floor((e.clientY - rect.top) / this.currentTileSize);
        const clickPos = new Vec(x, y);

        // Check if clicking on existing bomb to cycle timer (Level 3 only)
        if (this.level.config.timersAllowed) {
            const existingBomb = this.bombs.find(bomb => bomb.pos.equals(clickPos));
            if (existingBomb && existingBomb.hasTimer) {
                existingBomb.cycleTimer();
                this.render();
                return;
            }
        }

        // Try to place a new bomb
        this.placeBomb(clickPos);
    }

    placeBomb(pos) {
        if (!this.level.canPlaceBomb(pos)) return false;
        
        // Check bomb limits
        if (this.bombs.length >= this.level.config.maxActiveBombs) return false;

        const bombsThisTurn = this.bombs.filter(bomb => bomb.turnPlaced === this.turnIndex).length;
        if (bombsThisTurn >= this.level.config.maxBombsPerTurn) return false;

        // Create new bomb
        const bomb = new Bomb(this.bombIdCounter++, pos, this.level.config.timersAllowed);
        bomb.turnPlaced = this.turnIndex;
        this.bombs.push(bomb);

        this.updateUI();
        this.render();
        return true;
    }

    startAnimationLoop() {
        if (this.animationLoopActive) return;
        this.animationLoopActive = true;
        
        const animate = () => {
            // Remove expired explosions
            const now = Date.now();
            this.explosions = this.explosions.filter(explosion => 
                now - explosion.startTime < explosion.duration
            );
            
            // Continue animation if there are still explosions
            if (this.explosions.length > 0) {
                this.render();
                requestAnimationFrame(animate);
            } else {
                this.animationLoopActive = false;
            }
        };
        
        requestAnimationFrame(animate);
    }

    renderExplosions() {
        if (this.explosions.length === 0) return;
        
        const now = Date.now();
        const originalAlpha = this.ctx.globalAlpha;
        
        for (const explosion of this.explosions) {
            const elapsed = now - explosion.startTime;
            const progress = Math.min(elapsed / explosion.duration, 1);
            
            // Animation phases
            if (progress < 0.3) {
                // Expanding flash phase
                this.renderExplosionFlash(explosion, progress / 0.3);
            } else if (progress < 0.7) {
                // Bright explosion phase
                this.renderExplosionBright(explosion, (progress - 0.3) / 0.4);
            } else {
                // Fading smoke phase
                this.renderExplosionSmoke(explosion, (progress - 0.7) / 0.3);
            }
        }
        
        this.ctx.globalAlpha = originalAlpha;
    }

    renderExplosionFlash(explosion, progress) {
        // White expanding flash
        this.ctx.globalAlpha = 0.9 * (1 - progress * 0.5);
        this.ctx.fillStyle = '#ffffff';
        
        const centerX = explosion.pos.x * this.currentTileSize + this.currentTileSize / 2;
        const centerY = explosion.pos.y * this.currentTileSize + this.currentTileSize / 2;
        const maxRadius = this.currentTileSize * 2;
        const radius = progress * maxRadius;
        
        this.ctx.beginPath();
        this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        this.ctx.fill();
    }

    renderExplosionBright(explosion, progress) {
        // Bright orange/red explosion covering blast tiles
        const alpha = 0.8 * (1 - progress * 0.5);
        this.ctx.globalAlpha = alpha;
        
        // Alternate between orange and red for flickering effect
        const colors = ['#ff6600', '#ff3300', '#ffaa00'];
        const colorIndex = Math.floor(progress * 10) % colors.length;
        this.ctx.fillStyle = colors[colorIndex];
        
        for (const tile of explosion.blastTiles) {
            if (!this.level.isValidPosition(tile)) continue;
            
            const screenX = tile.x * this.currentTileSize;
            const screenY = tile.y * this.currentTileSize;
            
            // Add some randomness to the explosion shape
            const jitter = 2;
            const offsetX = (Math.random() - 0.5) * jitter;
            const offsetY = (Math.random() - 0.5) * jitter;
            
            this.ctx.fillRect(
                screenX + offsetX, 
                screenY + offsetY, 
                this.currentTileSize, 
                this.currentTileSize
            );
        }
    }

    renderExplosionSmoke(explosion, progress) {
        // Gray smoke fading out
        this.ctx.globalAlpha = 0.4 * (1 - progress);
        this.ctx.fillStyle = '#666666';
        
        for (const tile of explosion.blastTiles) {
            if (!this.level.isValidPosition(tile)) continue;
            
            const screenX = tile.x * this.currentTileSize;
            const screenY = tile.y * this.currentTileSize;
            
            // Smoke particles with random positions
            const particleCount = 3;
            for (let i = 0; i < particleCount; i++) {
                const offsetX = (Math.random() - 0.5) * this.currentTileSize * 0.8;
                const offsetY = (Math.random() - 0.5) * this.currentTileSize * 0.8;
                const size = this.currentTileSize * 0.3 * (1 - progress);
                
                this.ctx.beginPath();
                this.ctx.arc(
                    screenX + this.currentTileSize / 2 + offsetX,
                    screenY + this.currentTileSize / 2 + offsetY,
                    size,
                    0,
                    Math.PI * 2
                );
                this.ctx.fill();
            }
        }
    }

    endTurn() {
        if (this.gameState !== GameState.PLAYING) return;
        
        if (this.autoTurnTimer) {
            clearTimeout(this.autoTurnTimer);
            this.autoTurnTimer = null;
        }

        this.simulateTurn();
        this.updateUI();
        this.render();
        
        // Start animation loop if there are active explosions
        if (this.explosions.length > 0) {
            this.startAnimationLoop();
        }
        
        // Handle game over
        if (this.gameState === GameState.LOST) {
            this.startGameOverFade();
        }
    }

    simulateTurn() {
        this.turnIndex++;

        // Phase 1: Tick bombs and collect noise sources
        const tickingSources = [];
        const explodingSources = [];

        for (const bomb of this.bombs) {
            if (this.level.config.timersAllowed && bomb.hasTimer) {
                if (bomb.timer > 1) {
                    bomb.timer--;
                    tickingSources.push({pos: bomb.pos, level: bomb.getNoiseLevel()});
                } else { // timer === 1
                    tickingSources.push({pos: bomb.pos, level: bomb.getNoiseLevel()});
                    bomb.state = BombState.EXPLODING;
                    explodingSources.push({pos: bomb.pos, level: 4});
                }
            } else {
                // No timers - bomb explodes immediately next turn
                bomb.state = BombState.EXPLODING;
                explodingSources.push({pos: bomb.pos, level: 4});
            }
        }

        // Phase 2: Guard target selection and movement
        const proposals = new Map();
        
        for (const guard of this.level.guards) {
            const target = this.chooseGuardTarget(guard, tickingSources, explodingSources);
            
            if (target) {
                guard.memory = null; // Clear memory when actively pursuing
                guard.targetPos = target.pos;
                const nextStep = this.pathfinder.getNextStep(guard.pos, target.pos);
                proposals.set(guard.id, nextStep);
            } else if (guard.memory && (this.turnIndex - guard.memory.turnIndex) <= this.level.config.memoryTTL) {
                guard.targetPos = guard.memory.pos;
                const nextStep = this.pathfinder.getNextStep(guard.pos, guard.memory.pos);
                proposals.set(guard.id, nextStep);
            } else {
                guard.targetPos = null;
                proposals.set(guard.id, guard.pos); // Stay in place
            }
        }

        // Phase 3: Resolve movement conflicts
        this.resolveMovementConflicts(proposals);

        // Phase 4: Handle explosions
        let anyGuardKilled = false;
        const explodingBombs = this.bombs.filter(bomb => bomb.state === BombState.EXPLODING);
        
        for (const bomb of explodingBombs) {
            const blastTiles = this.calculateBlastTiles(bomb.pos);
            
            // Destroy targets
            for (const target of this.level.targets) {
                if (!target.destroyed && blastTiles.some(tile => tile.equals(target.pos))) {
                    target.destroyed = true;
                }
            }

            // Check for guard casualties
            for (const guard of this.level.guards) {
                if (blastTiles.some(tile => tile.equals(guard.pos))) {
                    anyGuardKilled = true;
                    break;
                }
            }
        }

        // Create explosion animations and remove exploded bombs
        for (const bomb of explodingBombs) {
            this.explosions.push({
                pos: bomb.pos.clone(),
                blastTiles: this.calculateBlastTiles(bomb.pos),
                startTime: Date.now(),
                duration: 800 // Animation duration in ms
            });
        }
        
        this.bombs = this.bombs.filter(bomb => bomb.state !== BombState.EXPLODING);

        // Phase 5: Update guard memory
        for (const guard of this.level.guards) {
            const audibleExplosions = explodingSources.filter(explosion => {
                const distance = this.pathfinder.getPathDistance(guard.pos, explosion.pos);
                return distance <= guard.hearingRadius;
            });

            if (audibleExplosions.length > 0) {
                // Choose closest explosion, with tie-breaking
                audibleExplosions.sort((a, b) => {
                    const distA = this.pathfinder.getPathDistance(guard.pos, a.pos);
                    const distB = this.pathfinder.getPathDistance(guard.pos, b.pos);
                    if (distA !== distB) return distA - distB;
                    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
                    return a.pos.x - b.pos.x;
                });

                guard.memory = {
                    pos: audibleExplosions[0].pos,
                    turnIndex: this.turnIndex
                };
            } else if (guard.memory && (this.turnIndex - guard.memory.turnIndex) > this.level.config.memoryTTL) {
                guard.memory = null;
            }
        }

        // Phase 6: Check win/lose conditions
        if (anyGuardKilled) {
            this.gameState = GameState.LOST;
        } else if (this.level.targets.every(target => target.destroyed)) {
            this.gameState = GameState.WON;
            // Auto-advance to next level after a short delay
            if (this.currentLevelIndex < this.levels.length - 1) {
                setTimeout(() => {
                    if (this.gameState === GameState.WON) { // Make sure we're still in won state
                        this.nextLevel();
                    }
                }, 2000);
            }
        }
    }

    chooseGuardTarget(guard, tickingSources, explodingSources) {
        const allSources = [...tickingSources, ...explodingSources];
        const audibleSources = allSources.filter(source => {
            const distance = this.pathfinder.getPathDistance(guard.pos, source.pos);
            return distance <= guard.hearingRadius;
        });

        if (audibleSources.length === 0) return null;

        // Sort by noise level (descending), then distance (ascending), then preference for explosions, then lexicographic
        audibleSources.sort((a, b) => {
            // Higher noise level first
            if (a.level !== b.level) return b.level - a.level;
            
            // Closer distance first
            const distA = this.pathfinder.getPathDistance(guard.pos, a.pos);
            const distB = this.pathfinder.getPathDistance(guard.pos, b.pos);
            if (distA !== distB) return distA - distB;
            
            // Explosion over ticking (explosions have level 4)
            const isExplosionA = explodingSources.includes(a);
            const isExplosionB = explodingSources.includes(b);
            if (isExplosionA !== isExplosionB) return isExplosionB ? 1 : -1;
            
            // Lexicographic tie-breaking
            if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
            return a.pos.x - b.pos.x;
        });

        return audibleSources[0];
    }

    resolveMovementConflicts(proposals) {
        const destinationMap = new Map();
        
        // Group proposals by destination
        for (const [guardId, destination] of proposals) {
            const key = `${destination.x},${destination.y}`;
            if (!destinationMap.has(key)) {
                destinationMap.set(key, []);
            }
            destinationMap.get(key).push(guardId);
        }

        // Resolve conflicts
        const validMoves = new Map();
        
        for (const [guardId, destination] of proposals) {
            const guard = this.level.guards.find(g => g.id === guardId);
            const destKey = `${destination.x},${destination.y}`;
            const claimants = destinationMap.get(destKey);
            
            // If multiple guards want the same destination, none can move there
            if (claimants.length > 1) {
                validMoves.set(guardId, guard.pos);
                continue;
            }

            // Check for swap conflicts
            const currentKey = `${guard.pos.x},${guard.pos.y}`;
            const occupyingGuardId = destinationMap.has(currentKey) ? 
                destinationMap.get(currentKey).find(id => id !== guardId) : null;
            
            if (occupyingGuardId) {
                const occupyingGuard = this.level.guards.find(g => g.id === occupyingGuardId);
                const occupyingDestination = proposals.get(occupyingGuardId);
                
                // If we're trying to swap, prevent it
                if (occupyingDestination && occupyingDestination.equals(guard.pos)) {
                    validMoves.set(guardId, guard.pos);
                    validMoves.set(occupyingGuardId, occupyingGuard.pos);
                    continue;
                }
            }

            validMoves.set(guardId, destination);
        }

        // Apply valid moves
        for (const guard of this.level.guards) {
            const newPos = validMoves.get(guard.id);
            if (newPos) {
                guard.pos = newPos.clone();
            }
        }
    }

    calculateBlastTiles(bombPos) {
        // Use circular blast pattern with reduced radius
        const blastRadius = Math.max(1, this.level.config.blastRange - 1);
        return this.calculateCircularBlast(bombPos, blastRadius);
    }

    saveGameState() {
        const state = {
            bombs: this.bombs.map(bomb => ({...bomb, pos: bomb.pos.clone()})),
            guards: this.level.guards.map(guard => ({
                ...guard, 
                pos: guard.pos.clone(),
                memory: guard.memory ? {
                    pos: guard.memory.pos.clone(),
                    turnIndex: guard.memory.turnIndex
                } : null
            })),
            targets: this.level.targets.map(target => ({...target, pos: target.pos.clone()})),
            turnIndex: this.turnIndex,
            gameState: this.gameState
        };
        
        this.gameHistory.push(JSON.stringify(state));
        
        // Limit history size
        if (this.gameHistory.length > 20) {
            this.gameHistory.shift();
        }
    }

    undo() {
        if (this.gameHistory.length <= 1) return; // Keep at least the initial state
        
        this.gameHistory.pop(); // Remove current state
        const previousState = JSON.parse(this.gameHistory[this.gameHistory.length - 1]);
        
        // Restore state
        this.bombs = previousState.bombs.map(bomb => {
            const restored = new Bomb(bomb.id, bomb.pos, bomb.hasTimer);
            restored.timer = bomb.timer;
            restored.state = bomb.state;
            restored.turnPlaced = bomb.turnPlaced;
            return restored;
        });
        
        this.level.guards.forEach((guard, index) => {
            const savedGuard = previousState.guards[index];
            guard.pos = new Vec(savedGuard.pos.x, savedGuard.pos.y);
            guard.memory = savedGuard.memory ? {
                pos: new Vec(savedGuard.memory.pos.x, savedGuard.memory.pos.y),
                turnIndex: savedGuard.memory.turnIndex
            } : null;
            guard.targetPos = null;
        });
        
        this.level.targets.forEach((target, index) => {
            target.destroyed = previousState.targets[index].destroyed;
        });
        
        this.turnIndex = previousState.turnIndex;
        this.gameState = previousState.gameState;
        
        this.updateUI();
        this.render();
    }

    handleMouseMove(e) {
        if (this.gameState !== GameState.PLAYING) {
            this.showBombPreview = false;
            this.render();
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / this.currentTileSize);
        const y = Math.floor((e.clientY - rect.top) / this.currentTileSize);
        const newPos = new Vec(x, y);

        if (!this.mousePos.equals(newPos)) {
            this.mousePos = newPos;
            this.showBombPreview = this.level.canPlaceBomb(this.mousePos) && 
                                  this.bombs.length < this.level.config.maxActiveBombs;
            this.render();
        }
    }

    handleMouseEnter(e) {
        this.handleMouseMove(e);
    }

    handleMouseLeave(e) {
        this.showBombPreview = false;
        this.mousePos = new Vec(-1, -1);
        this.render();
    }

    updateUI() {
        const status = document.getElementById('gameStatus');
        // Remove all text, just use color indicators
        status.textContent = '';
        if (this.gameState === GameState.WON) {
            status.className = 'status-win';
        } else if (this.gameState === GameState.LOST) {
            status.className = 'status-lose';
        } else {
            status.className = 'status-playing';
        }
        
        // Update navigation buttons
        document.getElementById('prevLevelButton').disabled = this.currentLevelIndex === 0;
        document.getElementById('nextLevelButton').disabled = this.currentLevelIndex >= this.levels.length - 1;
        
        // Update end turn button
        document.getElementById('endTurnButton').disabled = this.gameState !== GameState.PLAYING;
    }

    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Render grid background
        this.renderGrid();
        
        // Render level bounds outline (if available)
        if (this.level.bounds) {
            this.renderBounds();
        }
        
        // Render tiles
        this.renderTiles();
        
        // Render targets
        this.renderTargets();
        
        // Render guards
        this.renderGuards();
        
        // Render bombs
        this.renderBombs();
        
        // Render UI overlays
        this.renderOverlays();
    }

    renderGrid() {
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 0.5;
        
        for (let x = 0; x <= this.currentGridSize; x++) {
            this.ctx.beginPath();
            this.ctx.moveTo(x * this.currentTileSize, 0);
            this.ctx.lineTo(x * this.currentTileSize, CANVAS_SIZE);
            this.ctx.stroke();
        }
        
        for (let y = 0; y <= this.currentGridSize; y++) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y * this.currentTileSize);
            this.ctx.lineTo(CANVAS_SIZE, y * this.currentTileSize);
            this.ctx.stroke();
        }
    }

    renderBounds() {
        if (!this.level.bounds) return;
        
        const bounds = this.level.bounds;
        this.ctx.strokeStyle = '#666';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(
            bounds.x * this.currentTileSize,
            bounds.y * this.currentTileSize,
            bounds.w * this.currentTileSize,
            bounds.h * this.currentTileSize
        );
    }

    renderTiles() {
        for (let y = 0; y < this.currentGridSize; y++) {
            for (let x = 0; x < this.currentGridSize; x++) {
                const tile = this.level.grid[y][x];
                const screenX = x * this.currentTileSize;
                const screenY = y * this.currentTileSize;
                
                switch (tile) {
                    case Tile.WALL:
                        this.ctx.fillStyle = '#666';
                        this.ctx.fillRect(screenX, screenY, this.currentTileSize, this.currentTileSize);
                        break;
                    case Tile.FLOOR:
                        this.ctx.fillStyle = '#222';
                        this.ctx.fillRect(screenX, screenY, this.currentTileSize, this.currentTileSize);
                        break;
                    case Tile.VOID:
                        this.ctx.fillStyle = '#000';
                        this.ctx.fillRect(screenX, screenY, this.currentTileSize, this.currentTileSize);
                        break;
                }
            }
        }
    }

    renderTargets() {
        for (const target of this.level.targets) {
            if (target.destroyed) continue;
            
            const screenX = target.pos.x * this.currentTileSize;
            const screenY = target.pos.y * this.currentTileSize;
            
            // Draw target as a red square
            this.ctx.fillStyle = '#ff4444';
            this.ctx.fillRect(
                screenX + this.currentTileSize * 0.2,
                screenY + this.currentTileSize * 0.2,
                this.currentTileSize * 0.6,
                this.currentTileSize * 0.6
            );
            
            // Add inner detail
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillRect(
                screenX + this.currentTileSize * 0.4,
                screenY + this.currentTileSize * 0.4,
                this.currentTileSize * 0.2,
                this.currentTileSize * 0.2
            );
        }
    }

    renderGuards() {
        for (const guard of this.level.guards) {
            const screenX = guard.pos.x * this.currentTileSize;
            const screenY = guard.pos.y * this.currentTileSize;
            
            // Draw guard as blue circle
            this.ctx.fillStyle = '#4444ff';
            this.ctx.beginPath();
            this.ctx.arc(
                screenX + this.currentTileSize / 2,
                screenY + this.currentTileSize / 2,
                this.currentTileSize * 0.3,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            
            // Draw direction arrow if guard has a target
            if (guard.targetPos && !guard.pos.equals(guard.targetPos)) {
                const dx = guard.targetPos.x - guard.pos.x;
                const dy = guard.targetPos.y - guard.pos.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                
                if (length > 0) {
                    const normalizedDx = dx / length;
                    const normalizedDy = dy / length;
                    
                    this.ctx.strokeStyle = '#88ccff';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.moveTo(
                        screenX + this.currentTileSize / 2,
                        screenY + this.currentTileSize / 2
                    );
                    this.ctx.lineTo(
                        screenX + this.currentTileSize / 2 + normalizedDx * this.currentTileSize * 0.4,
                        screenY + this.currentTileSize / 2 + normalizedDy * this.currentTileSize * 0.4
                    );
                    this.ctx.stroke();
                }
            }
        }
    }

    renderBombs() {
        for (const bomb of this.bombs) {
            const screenX = bomb.pos.x * this.currentTileSize;
            const screenY = bomb.pos.y * this.currentTileSize;
            
            // Draw bomb body
            this.ctx.fillStyle = '#333';
            this.ctx.beginPath();
            this.ctx.arc(
                screenX + this.currentTileSize / 2,
                screenY + this.currentTileSize / 2,
                this.currentTileSize * 0.35,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            
            // Draw timer LED
            this.ctx.fillStyle = bomb.getColor();
            this.ctx.beginPath();
            this.ctx.arc(
                screenX + this.currentTileSize / 2,
                screenY + this.currentTileSize / 2,
                this.currentTileSize * 0.15,
                0,
                Math.PI * 2
            );
            this.ctx.fill();
            
            // Add timer number if applicable
            if (bomb.hasTimer) {
                this.ctx.fillStyle = '#000';
                this.ctx.font = `${this.currentTileSize * 0.2}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(
                    bomb.timer.toString(),
                    screenX + this.currentTileSize / 2,
                    screenY + this.currentTileSize / 2
                );
            }
        }
    }

    renderOverlays() {
        // Render blast radius for placed bombs
        this.renderBlastRadii();
        
        // Render explosion animations
        this.renderExplosions();
        
        // Render bomb placement preview
        this.renderBombPreview();
        
        // Render game over fade
        this.renderGameOverFade();
    }

    renderBombPreview() {
        if (!this.showBombPreview || this.gameState !== GameState.PLAYING) return;
        
        const screenX = this.mousePos.x * this.currentTileSize;
        const screenY = this.mousePos.y * this.currentTileSize;
        
        // Save current alpha
        const originalAlpha = this.ctx.globalAlpha;
        this.ctx.globalAlpha = 0.5;
        
        // Draw preview bomb body
        this.ctx.fillStyle = '#333';
        this.ctx.beginPath();
        this.ctx.arc(
            screenX + this.currentTileSize / 2,
            screenY + this.currentTileSize / 2,
            this.currentTileSize * 0.35,
            0,
            Math.PI * 2
        );
        this.ctx.fill();
        
        // Draw preview timer LED (use appropriate color for current level)
        const previewBombColor = this.level.config.timersAllowed ? '#00ff00' : '#ff0000'; // Green for timer levels, red for immediate
        this.ctx.fillStyle = previewBombColor;
        this.ctx.beginPath();
        this.ctx.arc(
            screenX + this.currentTileSize / 2,
            screenY + this.currentTileSize / 2,
            this.currentTileSize * 0.15,
            0,
            Math.PI * 2
        );
        this.ctx.fill();
        
        // Add timer number if applicable
        if (this.level.config.timersAllowed) {
            this.ctx.fillStyle = '#000';
            this.ctx.font = `${this.currentTileSize * 0.2}px Arial`;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(
                '3', // Default timer value
                screenX + this.currentTileSize / 2,
                screenY + this.currentTileSize / 2
            );
        }
        
        // Show blast radius preview
        if (this.showBombPreview) {
            this.renderBlastPreview(this.mousePos);
        }
        
        // Restore original alpha
        this.ctx.globalAlpha = originalAlpha;
    }

    renderBlastRadii() {
        // Show blast radius for all placed bombs
        const originalAlpha = this.ctx.globalAlpha;
        
        for (const bomb of this.bombs) {
            this.renderBlastPattern(bomb.pos, bomb.getColor(), 0.15); // More visible
        }
        
        this.ctx.globalAlpha = originalAlpha;
    }

    renderBlastPreview(pos) {
        if (!this.level.canPlaceBomb(pos)) return;
        
        const originalAlpha = this.ctx.globalAlpha;
        
        const previewColor = this.level.config.timersAllowed ? '#00ff00' : '#ff0000';
        this.renderBlastPattern(pos, previewColor, 0.25); // More visible for preview
        
        this.ctx.globalAlpha = originalAlpha;
    }

    renderBlastPattern(bombPos, color, alpha) {
        // Use circular blast radius instead of cross pattern
        const blastRadius = Math.max(1, this.level.config.blastRange - 1); // Reduce radius by 1
        const blastTiles = this.calculateCircularBlast(bombPos, blastRadius);
        
        this.ctx.globalAlpha = alpha;
        this.ctx.fillStyle = color;
        
        for (const tile of blastTiles) {
            if (!this.level.isValidPosition(tile)) continue;
            
            const screenX = tile.x * this.currentTileSize;
            const screenY = tile.y * this.currentTileSize;
            
            // Fill the tile with some transparency
            this.ctx.fillRect(screenX, screenY, this.currentTileSize, this.currentTileSize);
        }
    }

    calculateCircularBlast(bombPos, radius) {
        const blastTiles = [];
        
        for (let x = bombPos.x - radius; x <= bombPos.x + radius; x++) {
            for (let y = bombPos.y - radius; y <= bombPos.y + radius; y++) {
                const pos = new Vec(x, y);
                
                // Calculate distance from bomb center
                const distance = Math.sqrt(Math.pow(x - bombPos.x, 2) + Math.pow(y - bombPos.y, 2));
                
                // Include tiles within the circular radius
                if (distance <= radius && this.level.isValidPosition(pos)) {
                    // Check if there's a clear path (no walls blocking)
                    if (this.hasLineOfSight(bombPos, pos)) {
                        blastTiles.push(pos);
                    }
                }
            }
        }
        
        return blastTiles;
    }

    hasLineOfSight(start, end) {
        // Simple line of sight check - if there's a wall directly between, block it
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance === 0) return true; // Same position
        
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        const stepX = dx / steps;
        const stepY = dy / steps;
        
        for (let i = 1; i < steps; i++) {
            const checkX = Math.round(start.x + stepX * i);
            const checkY = Math.round(start.y + stepY * i);
            const checkPos = new Vec(checkX, checkY);
            
            if (this.level.isValidPosition(checkPos) && 
                this.level.grid[checkPos.y][checkPos.x] === Tile.WALL) {
                return false;
            }
        }
        
        return true;
    }


    startGameOverFade() {
        this.gameOverFade = {
            startTime: Date.now(),
            duration: 1000 // 1 second fade
        };
        
        if (!this.animationLoopActive) {
            this.startAnimationLoop();
        }
        
        // Reset level after fade completes
        setTimeout(() => {
            this.restartLevel();
            this.gameOverFade = null;
        }, 1200);
    }

    renderGameOverFade() {
        if (!this.gameOverFade) return;
        
        const elapsed = Date.now() - this.gameOverFade.startTime;
        const progress = Math.min(elapsed / this.gameOverFade.duration, 1);
        
        // Red fade overlay
        const originalAlpha = this.ctx.globalAlpha;
        this.ctx.globalAlpha = progress * 0.7; // Max 70% opacity
        this.ctx.fillStyle = '#ff0000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.globalAlpha = originalAlpha;
    }
}

// Levels are now loaded from JSON files in the levels/ folder

// Initialize game when page loads
window.addEventListener('load', () => {
    new Game();
});