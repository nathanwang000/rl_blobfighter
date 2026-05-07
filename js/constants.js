'use strict';

// ── Canvas ────────────────────────────────────────────────────────────────────
const CANVAS_W = 800;
const CANVAS_H = 450;

// ── Key bindings ─────────────────────────────────────────────────────────────
// Edit the VALUES here to remap any control. Keys are KeyboardEvent.key strings.
const KEYS = {
  P1_LEFT:         'ArrowLeft',
  P1_RIGHT:        'ArrowRight',
  P1_JUMP:         'x',
  P1_AIM_UP:       'ArrowUp',    // hold while attacking to aim upward
  P1_DROP:         'ArrowDown',  // hold + jump to drop through; also aims attacks downward
  P1_DASH:         's',
  P1_SHORT_ATTACK: 'z',
  P1_LONG_ATTACK:  'a',
  PAUSE:           'Escape',
  CONFIRM:         'Enter',
};

// ── Physics ───────────────────────────────────────────────────────────────────
const GRAVITY         = 0.55;
const MAX_FALL_SPEED  = 15;
const MOVE_SPEED      = 4.5;
const JUMP_VY         = -13.5;
const COYOTE_FRAMES   = 5;     // grace frames after walking off a ledge
const FRICTION_GROUND = 0.60;  // velocity decay when no horizontal input (grounded)
const FRICTION_AIR    = 0.92;  // velocity decay when no horizontal input (airborne)

// ── Dash ──────────────────────────────────────────────────────────────────────
const DASH_SPEED     = 13;
const DASH_DURATION  = 13;   // frames the dash persists
const DASH_COOLDOWN  = 50;   // frames before next dash is allowed

// ── Blob character ────────────────────────────────────────────────────────────
const BLOB_RADIUS     = 26;
const MAX_HEALTH      = 100;
const MAX_STOCKS      = 2;    // lives per player
const RESPAWN_FRAMES  = 100;  // invincibility frames after losing a stock
const MAX_AIR_JUMPS   = 1;    // extra jumps available while airborne (double jump)

// ── Short-range attack ────────────────────────────────────────────────────────
const SHORT_RANGE      = 72;   // px hitbox reach
const SHORT_DAMAGE     = 14;
const SHORT_DURATION   = 10;  // frames hitbox is live
const SHORT_COOLDOWN   = 28;
const SHORT_KB_X       = 8;   // knockback in the facing direction
const SHORT_KB_Y       = -5;
const SHORT_HITSTUN    = 18;

// ── Long-range attack (projectile) ────────────────────────────────────────────
const LONG_COOLDOWN    = 55;
const PROJ_SPEED       = 7.5;
const PROJ_DAMAGE      = 10;
const PROJ_RADIUS      = 10;
const PROJ_LIFETIME    = 100;  // frames until projectile expires
const PROJ_KB_X        = 4;
const PROJ_KB_Y        = -2;
const PROJ_HITSTUN     = 12;

// ── Stage layout ──────────────────────────────────────────────────────────────
// x, y = top-left corner; y is the TOP surface of the platform.
// isGround: true means it's drawn as the main ground strip.
const PLATFORM_DATA = [
  { x: 0,   y: 415, w: 800, h: 35, isGround: true },  // ground
  // Near-ground steps (great for quick mix-ups)
  { x: 180, y: 355, w: 100, h: 14 },                  // low-left step
  { x: 520, y: 355, w: 100, h: 14 },                  // low-right step
  // Mid-level shelves
  { x: 65,  y: 295, w: 145, h: 14 },                  // mid-left shelf
  { x: 590, y: 295, w: 145, h: 14 },                  // mid-right shelf
  { x: 310, y: 275, w: 180, h: 14 },                  // centre-mid bridge
  // Upper level
  { x: 30,  y: 195, w: 100, h: 14 },                  // far-left upper
  { x: 670, y: 195, w: 100, h: 14 },                  // far-right upper
  { x: 285, y: 175, w: 230, h: 14 },                  // centre upper
  // Apex — high skill ceiling
  { x: 340, y: 90,  w: 120, h: 14 },                  // apex
];

const SPAWN_P1 = { x: 180, y: 370 };
const SPAWN_P2 = { x: 620, y: 370 };

// ── AI state encoding ─────────────────────────────────────────────────────────
// Maximum number of projectiles encoded in the compact AI state vector.
// Vectors are padded with zeros when fewer projectiles exist.
const MAX_PROJ_IN_STATE = 4;
