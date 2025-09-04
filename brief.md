Product Brief — “Silent Charges” (Working Title)
1) High-level concept

A minimalist, turn-based, single-player puzzle game played on a 64×64 grid. The player never controls a character; they place bombs on tiles and end the turn. Guards react to sound and move one tile per turn toward the loudest audible source. The goal in every level is to destroy all targets without killing any guards.

There are three short tutorial levels, each silently teaching one mechanic through level design (no text instructions). Player actions are intentionally limited to preserve the “thinky” feel.

2) Core constraints (design goals → implementation requirements)

Disembodied play: No avatar. Input verbs are:

Place Bomb, 2) Adjust Bomb Timer (level 3 only), 3) End Turn, 4) Undo (optional but recommended for puzzle iteration).

Turn-based: Strict, deterministic step order (specified below).

Limited actions: By default one bomb placement per turn. (Level config can override to >1 if needed, but keep 1 for the three intro levels.)

Grid: Entire simulation lives on a 64×64 integer grid (x:0..63, y:0..63).

Singleplayer.

Three mechanics introduced across three levels (one level per mechanic).

No text instructions: Learning via affordances, animation, color, sound, and failure/retry.

3) Entities & tiles
3.1 Tile types (enum Tile)

Floor – walkable, placeable.

Wall – blocks movement, blocks explosion wave, blocks sound propagation (see propagation).

Target – occupies a tile (non-walkable). Destroyed by explosion; contributes to win condition.

Void – outside the room bounds (non-walkable, non-placeable). Use to pad smaller rooms inside the 64×64.

Targets are separate entities layered on top of a base tile (usually Floor). For pathfinding, treat any tile occupied by Wall or Target as non-traversable for guards.

3.2 Dynamic entities

Bomb

pos: (x,y)

state: { ticking | explodingThisTurn }

Timer (level 3 only): t ∈ {1,2,3} turns before detonation. Color: Red=1, Yellow=2, Green=3.

Noise level (per turn while ticking): Green=1, Yellow=2, Red=3. Explosion produces Noise=4 exactly during the explosion step.

Blast model: Orthogonal wave (Bomberman-style). Propagates up to blastRange tiles in 4 directions (N,E,S,W) and stops in a direction when it hits a Wall. Targets in blast are destroyed; guards in blast cause fail.

Chain reaction: Off in v1 (explosions never detonate other bombs early). Keep a flag in config to enable in future.

Guard

pos: (x,y)

hearingRadius: int (configurable per level; default 8)

memory of most recent explosion location it personally heard: lastHeard: {pos, turnIndex}, or null.

Moves exactly one orthogonal tile per turn along a computed path toward a chosen sound source (or toward lastHeard if currently nothing audible but memory exists; details below).

Cannot share a tile with other guards; conflict resolution specified below.

4) Sound & visibility models
4.1 Distance & propagation

Use grid path distance (shortest walkable path length) for sound checks and tie-breaks. This respects walls (sound does not pass through walls) and matches player intuition from explosion blocking.

Compute reachability over passable tiles (Floor), ignoring guards and bombs for sound propagation (sound “flows” through them); explosions are blocked by Wall only.

4.2 Noise sources per turn

Ticking bombs: Emit noiseLevel ∈ {1,2,3} at their current tile.

Explosions: Emit noiseLevel = 4 from the blast origin tile (the bomb’s tile). Use a single point source (don’t emit from every blast tile).

If multiple sources exist, a guard selects among sources within hearingRadius by path distance.

4.3 Guard target selection (per guard, per turn)

Find all audible sources S = { s | pathDist(guard.pos, s.pos) ≤ hearingRadius }.

If S non-empty:

Choose the highest noiseLevel.

If tie: choose the closest by pathDist.

If still tie: choose the most recent source (explosion > ticking this turn).

If still tie: choose the one with lowest (y, then x) to keep determinism.

Set memory to null (fresh pursuit).

Else, if memory exists and turnNow - memory.turnIndex ≤ memoryTTL (default 8 turns):

Move toward memory.pos.

Else do not move (idle in place).

Memory is updated only on explosion events the guard personally heard that turn (path distance ≤ hearingRadius at explosion time). Ticking does not update memory, only influences current target selection.

5) Turn structure (deterministic resolution)

For each turn T:

Player Phase

Player may place up to 1 bomb on a Floor tile that is not occupied by Wall, Target, or Guard.

(Level 3) Player may click a bomb to cycle its timer: Green(3) → Yellow(2) → Red(1) → Green(3).

Player clicks End Turn.

Simulation Phase

Increment global turn index.

Bomb timers tick:

For each ticking bomb:

If timer > 1: timer -= 1 and it emits ticking noise (level = color).

If timer == 1: mark as explodingThisTurn (will explode in step 5). It also emits ticking noise for this frame before exploding noise (we handle explosion noise in step 4).

In levels 1–2 (no timers), bombs are created with explodingThisTurn = true immediately next step.

Collect ticking noise sources for this turn.

Add explosion noise sources for bombs marked explodingThisTurn (noiseLevel=4 at bomb tile).
(Note: guards choose targets using both ticking and explosion sources present this turn.)

Guard target selection & movement:

For each guard, choose target as in §4.3.

Compute a single A* step toward the chosen tile (see §6). This yields at most one orthogonal move.

Simultaneous move with reservation:

Phase A: Each guard proposes nextPos.

Phase B: Resolve conflicts:

If two or more guards propose the same nextPos, none of them moves (they all stay).

If a guard proposes moving into a tile currently occupied by another guard who also proposes to leave, allow it only if that tile is not targeted by a third guard; otherwise both stay. (Classic traffic swap prevention.)

Resolve explosions:

For each bomb exploding this turn:

Compute blast tiles with orthogonal ray-casts up to blastRange tiles (stop on Wall, do not pass through).

Destroy targets on blast tiles.

If any guard is on a blast tile at this step → Level fails immediately.

Remove exploded bombs from the world.

Update guard memory:

For each guard, if they heard an explosion this turn, set memory = { pos: explosionOrigin, turnIndex: T }.
If multiple explosions were audible, pick the closest; tie-break as in §4.3.

If no new explosion heard, decay memory by TTL check; if expired, set to null.

Win/Lose checks:

Win: All Target entities destroyed and no guard has died (ever).

Lose: Any guard killed by blast, or any other fail conditions defined by the level (e.g., bomb budget exceeded).

If neither win nor lose, proceed to next Player Phase.

6) Pathfinding details
6.1 Grid & costs

Movement is 4-directional (N,E,S,W). No diagonals.

Terrain cost is uniform (1 per step). Impassable: Wall, Target tiles. Passable: Floor (bombs and guards do not block pathfinding; their positions are considered only in movement resolution).

Use A* with Manhattan heuristic h = |dx| + |dy|. Because costs are uniform and admissible, A* is optimal.

6.2 Implementation notes

Pre-allocate a small node pool or use a closed set keyed by (x,y) for performance.

Break ties in open list by lowest h then lowest y,x to guarantee deterministic step choice.

Guards compute only the next step each turn (do not store full path; recompute each turn to adapt to new sounds).

7) Data model
7.1 Config (global)
{
  "gridSize": 64,
  "blastRange": 3,
  "defaultHearingRadius": 8,
  "memoryTTL": 8,
  "maxBombsPerTurn": 1,
  "chainReactions": false,
  "undoEnabled": true
}

7.2 Level JSON schema

{
  "id": "level-1",
  "name": "First Spark",
  "bounds": {"x": 20, "y": 20, "w": 24, "h": 24}, 
  "tiles": [ /* run-length or row strings; Walls/Floor/Targets */ ],
  "guards": [
    {"x": 30, "y": 30, "hearingRadius": 8}
  ],
  "targets": [
    {"x": 34, "y": 30}
  ],
  "bombs": {
    "timersAllowed": false,      // L1 & L2 false, L3 true
    "maxActive": 4,              // cap to prevent spam
    "maxPerTurn": 1              // aligns with “limited actions”
  },
  "win": {"destroyAllTargets": true},
  "fail": {"noGuardDeaths": true},
  "hints": {"visualOverlays": true} // see §9 for non-text cues
}

8) Three tutorial levels (mechanic introduction)

    All three are contained inside the 64×64, using a smaller bounds rectangle for clarity and to enable generous UI margins/zoom.

Level 1 — “First Spark” (Mechanic: Basic bomb placement)

    Goal pattern: Teach blast blocking and safe placement.

    Setup:

        One Target placed such that a naive, adjacent placement also hits a Guard standing in line.

        A thick wall segment positioned so that placing the bomb on the opposite side of the target destroys it while the wall blocks the line of explosion toward the guard.

        No timers. Bombs explode at end of the turn they’re placed.

        Guard is stationary unless a sound is heard (hearing radius is small enough that only the explosion is heard).

    Correct solution: Place the bomb so the wall shields the guard.
    Incorrect first try (likely): Place next to target with direct line to the guard → lose. The fail teaches that line-of-sight matters.

Level 2 — “Decoy” (Mechanic: Luring a guard)

    Goal pattern: Teach that you can create a distraction first, then strike.

    Setup:

        Target near a guard in a way that any immediate detonation kills the guard.

        There is a safe lure spot within the guard’s hearing radius that pulls the guard away along a corridor. After one explosion there, the guard walks one tile per turn, opening a window where a second explosion can destroy the target safely.

        No timers yet. Player still limited to 1 bomb per turn.

    Correct solution:

        Turn 1: Place bomb at the lure spot → it explodes; guard starts moving away.

        Turn 2: Place bomb by the target; detonation occurs while the guard is out of the blast line.

    Reinforcement: The geometry ensures the guard cannot return in time; the player internalizes “noise → movement.”

Level 3 — “Countdown” (Mechanic: Timer bombs & escalating noise)

    Goal pattern: Teach delayed explosions and noise priority (Green=1, Yellow=2, Red=3, Explosion=4).

    Setup:

        Two guards and two targets. Corridors form a Y-shape. One guard can be held by a Red ticking bomb (noise=3) while the other must be teased by a Green→Yellow progression leading away, timed so that a different bomb explodes at the right moment.

        Timers allowed: cycling Green(3)→Yellow(2)→Red(1) on click.

        Hearing radius slightly larger so both guards have choices; they must pick the loudest audible.

    Correct solution (one of several):

        Place a Green (3) far left to start a low pull; next turn retarget it to Yellow (2) or place a Red (1) decoy on the right to grab the second guard’s attention. Meanwhile, a delayed bomb near Target A counts down to explode when both guards are pulled off-line. Final placement cleans Target B.

    Learning: Visual and audio escalation makes it clear that red ticks louder, and explosion (4) overrides ticking. Ties break by proximity.

9) UX without text instructions

    Affordances:

        Bomb preview: Hover shows blast overlay (orthogonal cross up to blastRange, clipping at walls).

        Timer colors: Big LED-style color and subtle tick animation (Green slow pulse → Yellow medium → Red rapid).

        Noise rings: Each ticking or explosion source emits a faint ripple that travels through corridors (stop at walls) to visually communicate “sound respects walls.” Ring opacity/size corresponds to noise level (1–4).

        Guard intent arrow: Before committing movement, draw a thin arrow from each guard to its chosen target tile (updates live as bombs tick). On End Turn, animate one-tile step along that direction.

        Failure clarity: If a guard is killed, freeze-frame and highlight the blast line that reached them (no text).

        Undo button (no text label, iconic ⤺) to encourage experimentation.

    Camera/Zoom: Auto-fit bounds rectangle; allow pinch/scroll to zoom, pan within 64×64 canvas.

10) Art/audio minimalism

    Tiles: Flat, high-contrast. Walls solid, floors light, targets iconographic (monitor/book/crate).

    Guards: Simple silhouettes with a small “ear cone” icon that flashes when they hear something.

    Bombs: Disc with center LED color (G/Y/R), subtle ticking animation rate tied to timer.

    Audio: Four discrete volume/texture layers for noise levels 1–4.

11) Technical specification
11.1 Engine & performance

    Any 2D framework (Unity, Godot, custom), grid-based logic separate from render.

    Simulation uses integer math only; no floating point for logic to keep determinism and reproducibility (seed runs).

    64×64 grid ⇒ at most 4096 tiles. BFS/A* per guard per turn is trivial in cost at this size.

11.2 Data structures (suggestion)

type Vec = {x:number, y:number}

enum Tile { Floor, Wall, Void }
type Target = { id:number, pos:Vec }
type Bomb = {
  id:number, pos:Vec,
  hasTimer:boolean,
  timer:number,         // 1..3 (if timersEnabled)
  state:'ticking'|'exploding'
}
type Guard = {
  id:number, pos:Vec,
  hearingRadius:number,
  memory: { pos:Vec, turnIndex:number } | null
}

type Level = {
  id:string, name:string,
  bounds:{x:number,y:number,w:number,h:number},
  grid: Tile[][],
  targets: Target[],
  guards: Guard[],
  config:{
    timersAllowed:boolean,
    blastRange:number,
    hearingRadius:number,
    memoryTTL:number,
    maxActiveBombs:number,
    maxBombsPerTurn:number
  }
}

11.3 Simulation pseudocode

function endTurn():
  T++ 
  // 1) Tick bombs
  tickingSources = []
  explodingSources = []
  for b in bombs:
    if !level.config.timersAllowed:
      b.state = 'exploding'
      explodingSources.push({pos:b.pos, level:4})
    else:
      if b.state == 'ticking':
        if b.timer > 1:
          b.timer -= 1
          tickingSources.push({pos:b.pos, level:timerToNoise(b.timer)}) // 3->1, 2->2, 1->3
        else: // timer == 1
          tickingSources.push({pos:b.pos, level:3})
          b.state = 'exploding'
          explodingSources.push({pos:b.pos, level:4})

  // 2) Guard target & movement
  proposals = {}
  for g in guards:
    src = chooseSoundSource(g, tickingSources, explodingSources) // §4.3 with pathDist ≤ hearingRadius
    if src:
      g.memory = null
      step = nextAStarStep(g.pos, src.pos) // §6
      proposals[g.id] = step
    else if g.memory && T - g.memory.turnIndex <= memoryTTL:
      step = nextAStarStep(g.pos, g.memory.pos)
      proposals[g.id] = step
    else:
      proposals[g.id] = g.pos // stay

  // resolve conflicts
  applyReservation(proposals, guards)

  // 3) Explosions
  anyGuardKilled = false
  for b in bombs where b.state == 'exploding':
    blastTiles = raycastCross(b.pos, level.config.blastRange, grid) // stop on Wall
    destroyTargetsOn(blastTiles)
    if exists guard with guard.pos in blastTiles:
      anyGuardKilled = true
  bombs = bombs.filter(b => b.state != 'exploding')

  // 4) Update memory from explosions
  for g in guards:
    audibleExps = filter explodingSources where pathDist(g.pos, e.pos) ≤ g.hearingRadius
    if audibleExps not empty:
      e = tieBreak(audibleExps) // nearest, then (y,x)
      g.memory = { pos: e.pos, turnIndex: T }
    else if g.memory && (T - g.memory.turnIndex) > memoryTTL:
      g.memory = null

  // 5) Win/Lose
  if anyGuardKilled: fail()
  else if allTargetsDestroyed(): win()

Helper:

    timerToNoise(3)=1 (Green), timerToNoise(2)=2 (Yellow), timerToNoise(1)=3 (Red).

11.4 Sound reachability

    Use a bounded BFS flood from each source up to hearingRadius in passable tiles (Walls block).

    Cache per-turn sound fields if there are many sources; but with few bombs this is negligible.

11.5 Movement conflict resolution (applyReservation)

    Build map dest → list<guardId>.

    If a destination has >1 claimants, no one moves there.

    Prevent direct swaps (A→B and B→A) by keeping both in place.

    After resolution, update guard positions for the ones with unique, unoccupied dests.

12) UI & controls

    Place Bomb: Left-click on a valid tile. If maxActiveBombs reached, reject with a short buzz animation.

    Adjust Timer (L3): Click a placed bomb to cycle G→Y→R→G. Timer color also drives ticking animation rate.

    End Turn: Prominent button; keyboard Space.

    Undo: Single-step undo stack (replay-safe by storing full game state diffs).

    Overlays:

        Bomb hover: blast preview.

        Sound: gentle ripples propagating along corridors (debug toggle for testers).

        Guard arrows: intent line to current target.

    No text. Use icons and consistent animation language.

13) Level authoring tips (ensure “first-try fail, second-try learn”)

    Level 1: Make the “obvious” placement kill a guard. Add a wall nub that, if used cleverly, shields the guard. Hearing radius small so guards do not move pre-detonation; they only hear the explosion afterward (which is fine post-solve).

    Level 2: Ensure the guard’s shortest path toward the lure spot causes a 1–2 turn displacement that opens a safe blast window near the target. Avoid alternate cheese placements by adding walls that block any “single-turn” safe detonation.

    Level 3: Put both guards within radius of multiple potential sources so noise priority matters, and geometry that makes sound-blocking walls necessary for routing.

14) Tuning parameters (per level)

    blastRange (default 3).

    hearingRadius (default 8; 6–10 is a sweet spot).

    memoryTTL (default 8).

    maxActiveBombs (default 4).

    maxBombsPerTurn (default 1).

    Starting number of targets and guards.

    Whether timers are allowed.

    15) Testing & deterministic behavior

All randomness eliminated. Where ties occur, use lexicographic (y,x) order on tiles and entity id ordering for stability.

Unit tests:

Pathfinding returns expected first step given obstacles.

Sound BFS stops at walls; distances match expected.

Tie-break rules select consistent sources/steps.

Explosion ray-cast halts correctly at walls; damages correct tiles.

Movement reservation avoids collisions and swaps.

Scenario tests: Scripts reproducing Level 1–3 optimal lines to prevent regressions.

16) Accessibility & quality-of-life

Color-plus-shape indicators for timers (e.g., 1, 2, 3 ticks around the LED) for color-blind support.

Adjustable animation speed; “fast resolve” toggle after End Turn.

Optional subtle controller rumble (platform-dependent) on explosion/fail.

Undo to reduce frustration without text hints.

17) Acceptance criteria (MVP)

Runs a deterministic simulation on a 64×64 grid.

Three levels ship with layouts and configs described; each is beatable and teaches its mechanic without text.

Guards:

Move 1 tile/turn toward loudest audible source by sound-respecting walls.

Fall back to last heard explosion within TTL if nothing currently audible.

Explosions:

Orthogonal wave, blocked by walls, destroy targets; any guard in blast triggers immediate fail.

Level 3 timers:

Click cycles G(3)/Y(2)/R(1); ticking noise levels 1/2/3; explosion noise 4.

Undo works for at least 10 steps.

All tie-breaks deterministic.

18) Future-proofing (post-MVP toggles)

Optional chain reactions (explosion starts neighboring timers at 1).

Different guard archetypes (faster, braver, deaf).

Pressure plates, doors, and movable crates as new puzzle verbs without adding player actions.

Puzzle editor using the same JSON schema.

19) Example micro-layouts (ASCII for block-in)

Legend: #=Wall, .=Floor, G=Guard, T=Target, S=Suggested lure spot

Level 1 (excerpt):
############
#....G.....#
#....#.....#
#....#..T..#
#....#.....#
#..........#
############

    Correct placement: put bomb on the right side of T so the vertical wall blocks the explosion toward G.

Level 2 (excerpt):

###############
#G....######..#
#.....#....#..#
#..S..#..T.#..#
#.....#....#..#
#.....######..#
###############

    Turn 1: Bomb at S to lure G upward/left.

    Turn 2: Bomb near T while G is en route.

Level 3 (excerpt):

#################
#G....#.....G...#
#.....#.........#
#..T..#....T....#
#.....#.........#
#..S..#..S......#
#################

    Use timers: one S Red(1) to hold right guard; a Green→Yellow path left to steer the other; time the target explosions.
