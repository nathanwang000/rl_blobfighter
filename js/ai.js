'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Base AI controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All AI controllers must extend this class and override getAction().
 *
 * The `state` object passed in has the shape:
 *   {
 *     players:    [ playerStateObj, playerStateObj ],  // index 0 = P1, 1 = P2
 *     projectiles: [ { x, y, vx, vy, owner }, ... ],
 *     platforms:   [ { x, y, w, h }, ... ],
 *   }
 *
 * playerStateObj keys: x, y, vx, vy, health, stocks, facing, onGround,
 *   isDashing, isAttacking, shortCooldown, longCooldown, dashCooldown,
 *   hitstun, invincible
 *
 * getAction() must return:
 *   { left, right, jump, dash, shortAttack, longAttack }  (all booleans)
 *
 * For a neural-network AI, use AIController.stateToVector(state, playerIndex)
 * to get a flat Float32Array suitable as model input, then map the output
 * back to the action object with AIController.vectorToAction(outputArray).
 */
class AIController {
  getAction(/* state, playerIndex */) {
    return { left: false, right: false, jump: false, dash: false, shortAttack: false, longAttack: false };
  }

  // ── Helpers for neural-network subclasses ─────────────────────────────────

  /**
   * Converts a game state snapshot into a normalised flat array.
   * Vector length: 10 (self) + 10 (opponent) + MAX_PROJ_IN_STATE * 5 + 2 (relative) = 42
   *
   * @param {{ players, projectiles, platforms }} state
   * @param {number} playerIndex  - 0 or 1
   * @returns {Float32Array}
   */
  static stateToVector(state, playerIndex) {
    const me  = state.players[playerIndex];
    const opp = state.players[1 - playerIndex];

    const encodePlayer = (p) => [
      p.x             / CANVAS_W,
      p.y             / CANVAS_H,
      p.vx            / MOVE_SPEED,
      p.vy            / MAX_FALL_SPEED,
      p.health        / MAX_HEALTH,
      (p.facing + 1)  / 2,       // map {-1,1} → {0,1}
      p.onGround,
      p.shortCooldown / SHORT_COOLDOWN,
      p.longCooldown  / LONG_COOLDOWN,
      p.dashCooldown  / DASH_COOLDOWN,
    ];

    const v = [
      ...encodePlayer(me),
      ...encodePlayer(opp),
      // Relative position
      (opp.x - me.x) / CANVAS_W,
      (opp.y - me.y) / CANVAS_H,
    ];

    // Projectiles – up to MAX_PROJ_IN_STATE, padded with zeros
    const projs = state.projectiles.slice(0, MAX_PROJ_IN_STATE);
    for (let i = 0; i < MAX_PROJ_IN_STATE; i++) {
      const p = projs[i];
      v.push(
        p ? p.x  / CANVAS_W : 0,
        p ? p.y  / CANVAS_H : 0,
        p ? p.vx / PROJ_SPEED : 0,
        p ? p.vy / MAX_FALL_SPEED : 0,
        p ? (p.owner === playerIndex ? 1 : -1) : 0,  // +1 = mine, -1 = opponent's
      );
    }

    return new Float32Array(v);
  }

  /**
   * Maps a 6-element sigmoid output vector → discrete action object.
   * Order: [left, right, jump, dash, shortAttack, longAttack]
   * Threshold at 0.5 by default.
   *
   * @param {Float32Array|number[]} output
   * @param {number} [threshold=0.5]
   * @returns {{ left, right, jump, dash, shortAttack, longAttack }}
   */
  static vectorToAction(output, threshold = 0.5) {
    return {
      left:        output[0] > threshold,
      right:       output[1] > threshold,
      jump:        output[2] > threshold,
      dash:        output[3] > threshold,
      shortAttack: output[4] > threshold,
      longAttack:  output[5] > threshold,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trajectory recording wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps any AIController and records (state, action, reward, done) tuples.
 * Works for AI-controlled players AND human players (pass a HumanAI shim below).
 *
 * Usage:
 *   const recorder = new TrajectoryRecordingAI(new RuleBasedAI(), 1);
 *   // ... pass recorder as the AI to Game ...
 *   // After episode ends:
 *   const data = recorder.flush();  // array of transition objects
 *
 * Reward shaping is intentionally separated into computeReward() so you can
 * override it in a subclass without touching anything else.
 */
class TrajectoryRecordingAI extends AIController {
  /**
   * @param {AIController} innerAI      - The controller whose actions we record.
   * @param {number}       playerIndex  - Which player this wrapper is tracking.
   */
  constructor(innerAI, playerIndex) {
    super();
    this.innerAI     = innerAI;
    this.playerIndex = playerIndex;

    /** @type {Array<{state:Float32Array, action:Float32Array, reward:number, done:boolean}>} */
    this.trajectory  = [];

    this._prevState  = null;
    this._prevAction = null;
  }

  getAction(state, playerIndex) {
    // Compute reward for the transition that just completed
    if (this._prevState !== null) {
      const reward = this.computeReward(this._prevState, state, playerIndex);
      this.trajectory.push({
        state:  AIController.stateToVector(this._prevState, playerIndex),
        action: TrajectoryRecordingAI.actionToVector(this._prevAction),
        reward,
        done: false,   // set to true on the terminal step via markDone()
      });
    }

    const action = this.innerAI.getAction(state, playerIndex);
    this._prevState  = state;
    this._prevAction = action;
    return action;
  }

  /**
   * Call this from Game when the episode ends (stock reaches 0).
   * Finalises the last transition in the trajectory.
   *
   * @param {object} terminalState - The final state snapshot.
   * @param {number} playerIndex
   */
  markDone(terminalState, playerIndex) {
    if (this._prevState === null) return;
    const reward = this.computeReward(this._prevState, terminalState, playerIndex);
    this.trajectory.push({
      state:  AIController.stateToVector(this._prevState, playerIndex),
      action: TrajectoryRecordingAI.actionToVector(this._prevAction),
      reward,
      done: true,
    });
    this._prevState  = null;
    this._prevAction = null;
  }

  /**
   * Override this in a subclass to change reward shaping.
   * Default: health delta (positive = dealt damage, negative = took damage)
   *          plus a large bonus/penalty for stock changes.
   *
   * @param {object} prev  - Previous game state.
   * @param {object} curr  - Current game state.
   * @param {number} pi    - Player index being rewarded.
   * @returns {number}
   */
  computeReward(prev, curr, pi) {
    const me  = { prev: prev.players[pi],     curr: curr.players[pi] };
    const opp = { prev: prev.players[1 - pi], curr: curr.players[1 - pi] };

    const damagDealt    = (opp.prev.health - opp.curr.health) / MAX_HEALTH;
    const damageTaken   = (me.prev.health  - me.curr.health)  / MAX_HEALTH;
    const stockLost     = (me.prev.stocks  - me.curr.stocks)  > 0 ? -2.0 : 0;
    const stockTaken    = (opp.prev.stocks - opp.curr.stocks) > 0 ?  2.0 : 0;

    return damagDealt * 1.0 - damageTaken * 1.0 + stockLost + stockTaken;
  }

  /**
   * Returns and clears the recorded trajectory.
   * @returns {Array<{state, action, reward, done}>}
   */
  flush() {
    const t = this.trajectory;
    this.trajectory = [];
    return t;
  }

  /**
   * Converts an action object → a 6-element binary Float32Array.
   * Order matches vectorToAction(): [left, right, jump, dash, short, long]
   * @param {{ left, right, jump, dash, shortAttack, longAttack }} action
   * @returns {Float32Array}
   */
  static actionToVector(action) {
    return new Float32Array([
      action.left        ? 1 : 0,
      action.right       ? 1 : 0,
      action.jump        ? 1 : 0,
      action.dash        ? 1 : 0,
      action.shortAttack ? 1 : 0,
      action.longAttack  ? 1 : 0,
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Human shim — wraps the human input function so you can record human play
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pass a function that returns the current human action object (same shape as
 * getAction returns). This lets TrajectoryRecordingAI wrap human play too.
 *
 *   const humanShim = new HumanAI(() => game.getP1ActionsSnapshot());
 *   const recorder  = new TrajectoryRecordingAI(humanShim, 0);
 */
class HumanAI extends AIController {
  /** @param {() => {left,right,jump,dash,shortAttack,longAttack}} actionFn */
  constructor(actionFn) {
    super();
    this._actionFn = actionFn;
  }
  getAction() { return this._actionFn(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule-based AI  (default opponent)
// ─────────────────────────────────────────────────────────────────────────────

class RuleBasedAI extends AIController {
  constructor() {
    super();
    this._jumpCooldown = 0;
    this._longCooldown = 0;  // separate from blob cooldown – controls AI fire-rate
    this._retreatTimer = 0;
  }

  getAction(state, playerIndex) {
    const me  = state.players[playerIndex];
    const opp = state.players[1 - playerIndex];

    const dx   = opp.x - me.x;
    const dy   = opp.y - me.y;
    const dist = Math.hypot(dx, dy);
    const dir  = Math.sign(dx) || 1;  // horizontal direction to opponent

    const act = { left: false, right: false, jump: false, dash: false, shortAttack: false, longAttack: false };

    if (this._jumpCooldown > 0) this._jumpCooldown--;
    if (this._longCooldown > 0) this._longCooldown--;

    // ── Retreat when low health ───────────────────────────────────────────
    const healthRatio = me.health / MAX_HEALTH;
    if (healthRatio < 0.3 && dist < 120) {
      this._retreatTimer = 30;
    }
    if (this._retreatTimer > 0) {
      this._retreatTimer--;
      if (dir > 0) act.left  = true;
      else         act.right = true;
    } else {
      // ── Chase / space management ────────────────────────────────────────
      const ideal = SHORT_RANGE * 0.85;
      if (dist > ideal + 20) {
        // Close the gap
        if (dir > 0) act.right = true;
        else         act.left  = true;
      } else if (dist < 35) {
        // Back off slightly when right on top of opponent
        if (dir > 0) act.left  = true;
        else         act.right = true;
      }
    }

    // ── Face opponent always ──────────────────────────────────────────────
    // (handled implicitly by movement; when standing still, nudge facing)
    if (!act.left && !act.right) {
      if (dx > 5)       act.right = true;
      else if (dx < -5) act.left  = true;
    }

    // ── Short attack when in melee range ──────────────────────────────────
    if (dist < SHORT_RANGE + 8 && me.shortCooldown === 0 && me.hitstun === 0) {
      act.shortAttack = true;
    }

    // ── Long attack at medium range ───────────────────────────────────────
    if (dist > 80 && dist < 360 && me.longCooldown === 0 && this._longCooldown === 0 && me.hitstun === 0) {
      // Fire with some randomness to feel less mechanical
      if (Math.random() < 0.35) {
        act.longAttack    = true;
        this._longCooldown = 18;  // extra AI-side delay between shots
      }
    }

    // ── Jump to reach opponent on higher platform ─────────────────────────
    if (this._jumpCooldown === 0) {
      const oppHigher = dy < -55 && me.onGround;
      if (oppHigher) {
        act.jump           = true;
        this._jumpCooldown = 50;
      }

      // Dodge incoming projectiles
      const threat = state.projectiles.find(p =>
        p.owner !== playerIndex &&
        Math.abs(p.y - me.y) < BLOB_RADIUS * 2 &&
        Math.sign(p.vx) === dir &&   // heading toward me
        Math.abs(p.x - me.x) < 180
      );
      if (threat && me.onGround) {
        act.jump           = true;
        this._jumpCooldown = 28;
      }
    }

    // ── Dash to close distance quickly ───────────────────────────────────
    if (dist > 220 && me.dashCooldown === 0 && me.onGround && me.hitstun === 0) {
      if (Math.random() < 0.03) {
        act.dash = true;
      }
    }

    // ── Dash-escape when being comboed ────────────────────────────────────
    if (me.hitstun > 0 && me.dashCooldown === 0 && Math.random() < 0.15) {
      act.dash = true;
    }

    return act;
  }
}
