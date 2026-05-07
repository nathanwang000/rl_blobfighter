'use strict';

// Lighten a 6-digit hex colour by `amount` per channel.
function _lighten(hex, amount) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${r},${g},${b})`;
}

class Blob {
  /**
   * @param {number} x            - Spawn X
   * @param {number} y            - Spawn Y
   * @param {number} playerIndex  - 0 = Player 1 (human), 1 = Player 2 (AI)
   */
  constructor(x, y, playerIndex) {
    this.playerIndex = playerIndex;
    this.spawnX = x;
    this.spawnY = y;

    this.color     = playerIndex === 0 ? '#33aaff' : '#ff7733';
    this.colorDark = playerIndex === 0 ? '#1a5580' : '#803311';
    this.name      = playerIndex === 0 ? 'BLOB 1'  : 'BLOB 2';

    this.stocks = MAX_STOCKS;
    this._resetPhysics();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _resetPhysics() {
    this.x  = this.spawnX;
    this.y  = this.spawnY;
    this.vx = 0;
    this.vy = 0;

    this.facing   = this.playerIndex === 0 ? 1 : -1;
    this.health   = MAX_HEALTH;
    this.onGround = false;

    // Cooldown timers (count DOWN to 0)
    this.shortCooldown = 0;
    this.longCooldown  = 0;
    this.dashCooldown  = 0;

    // Active-state timers (count DOWN to 0)
    this.shortTimer = 0;   // frames the melee hitbox is active
    this.dashTimer  = 0;   // frames of current dash
    this.dashDir    = 1;

    this.hitstun    = 0;   // frames unable to act
    this.coyote     = 0;   // coyote-time frames after walking off ledge
    this.invincible = 0;   // invincibility frames (post-respawn)
    this.hitFlash   = 0;   // white-flash frames on hit

    // Per-swing hit flag – prevents multi-hit in one swing
    this.attackHit        = false;
    // Signal to Game to spawn a projectile this frame
    this.pendingProjectile = false;

    // Jump-release guard: must release jump key before jumping again
    this.jumpReleased = true;

    // Double-jump: air jumps remaining (reset on landing)
    this.airJumpsLeft = MAX_AIR_JUMPS;
    // Drop-through: frames during which non-ground platform collision is skipped
    this.dropFrames   = 0;
    // True when standing on the main ground (not a floating platform)
    this.onMainGround = false;

    // Sound events emitted this frame for game.js to consume
    this.soundEvents = [];

    // Stored aim direction at the moment each attack was initiated
    // (normalised unit vector; separate for melee vs projectile)
    this._attackAimX = this.facing;
    this._attackAimY = 0;
    this._projAimX   = this.facing;
    this._projAimY   = 0;

    // Squish/stretch animation scalars
    this.squishX = 1;
    this.squishY = 1;
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get isAttacking() { return this.shortTimer > 0; }
  get isDashing()   { return this.dashTimer  > 0; }

  // ── Core update ───────────────────────────────────────────────────────────

  /**
   * Advance physics and state by one frame.
   *
   * @param {{ left:boolean, right:boolean, jump:boolean, dash:boolean,
   *            shortAttack:boolean, longAttack:boolean }} actions
   * @param {Platform[]} platforms
   */
  update(actions, platforms) {
    // Clear sound events from last frame
    this.soundEvents = [];

    // ── Tick timers ────────────────────────────────────────────────────────
    if (this.shortCooldown > 0) this.shortCooldown--;
    if (this.longCooldown  > 0) this.longCooldown--;
    if (this.dashCooldown  > 0) this.dashCooldown--;
    if (this.shortTimer    > 0) this.shortTimer--;
    if (this.dashTimer     > 0) this.dashTimer--;
    if (this.hitstun       > 0) this.hitstun--;
    if (this.coyote        > 0) this.coyote--;
    if (this.invincible    > 0) this.invincible--;
    if (this.hitFlash      > 0) this.hitFlash--;
    if (this.dropFrames    > 0) this.dropFrames--;

    // Reset per-swing hit flag when attack ends
    if (this.shortTimer === 0) this.attackHit = false;

    // Track jump-key release so tap-to-jump feels natural for both human & AI
    if (!actions.jump) this.jumpReleased = true;

    const canAct = this.hitstun === 0;

    // ── Horizontal movement ────────────────────────────────────────────────
    if (!this.isDashing) {
      if (canAct && actions.left) {
        this.vx = -MOVE_SPEED;
        this.facing = -1;
      } else if (canAct && actions.right) {
        this.vx = MOVE_SPEED;
        this.facing = 1;
      } else {
        this.vx *= this.onGround ? FRICTION_GROUND : FRICTION_AIR;
        if (Math.abs(this.vx) < 0.4) this.vx = 0;
      }
    } else {
      // Dash: override velocity with constant speed
      this.vx = this.dashDir * DASH_SPEED;
    }

    // ── Dash initiation ────────────────────────────────────────────────────
    if (canAct && actions.dash && !this.isDashing && this.dashCooldown === 0) {
      this.dashDir      = this.facing;
      this.dashTimer    = DASH_DURATION;
      this.dashCooldown = DASH_COOLDOWN;
      this.squishX      = 1.6;
      this.squishY      = 0.55;
      this.soundEvents.push('dash');
    }

    // ── Jump / drop-through ────────────────────────────────────────────────
    // Drop through floating platform: hold ↓ + press jump while on non-ground
    if (canAct && actions.drop && actions.jump && this.jumpReleased &&
        this.onGround && !this.onMainGround) {
      this.dropFrames   = 14;
      this.onGround     = false;
      this.vy           = 2;    // small downward nudge to clear the platform
      this.jumpReleased = false;
    // Standard jump from ground / coyote window
    } else if (canAct && actions.jump && this.jumpReleased && (this.onGround || this.coyote > 0)) {
      this.vy           = JUMP_VY;
      this.onGround     = false;
      this.coyote       = 0;
      this.jumpReleased = false;
      this.airJumpsLeft = MAX_AIR_JUMPS;  // reset air jumps on any grounded jump
      this.squishX      = 0.72;
      this.squishY      = 1.4;
      this.soundEvents.push('jump');
    // Air / double jump
    } else if (canAct && actions.jump && this.jumpReleased && !this.onGround && this.airJumpsLeft > 0) {
      this.vy           = JUMP_VY * 0.88;
      this.jumpReleased = false;
      this.airJumpsLeft--;
      this.squishX      = 0.80;
      this.squishY      = 1.25;
      this.soundEvents.push('airjump');
    }

    // ── Short attack ───────────────────────────────────────────────────────
    if (canAct && actions.shortAttack && this.shortCooldown === 0 && !this.isDashing) {
      // Capture and normalise the aim direction at the moment of attack.
      // Only fall back to facing when no directional key is held at all.
      const aimX = actions.aimX ?? 0;
      const aimY = actions.aimY ?? 0;
      const rawX = aimX !== 0 ? aimX : (aimY === 0 ? this.facing : 0);
      const rawY = aimY;
      const len  = Math.hypot(rawX, rawY) || 1;
      this._attackAimX   = rawX / len;
      this._attackAimY   = rawY / len;
      this.shortTimer    = SHORT_DURATION;
      this.shortCooldown = SHORT_COOLDOWN;
      this.attackHit     = false;
      this.squishX       = 1.45;
      this.squishY       = 0.7;
      this.soundEvents.push('swing');
    }

    // ── Long attack ─────────────────────────────────────────────────────────────
    this.pendingProjectile = false;
    if (canAct && actions.longAttack && this.longCooldown === 0 && !this.isDashing) {
      const aimX = actions.aimX ?? 0;
      const aimY = actions.aimY ?? 0;
      const rawX = aimX !== 0 ? aimX : (aimY === 0 ? this.facing : 0);
      const rawY = aimY;
      const len  = Math.hypot(rawX, rawY) || 1;
      this._projAimX         = rawX / len;
      this._projAimY         = rawY / len;
      this.longCooldown      = LONG_COOLDOWN;
      this.pendingProjectile = true;
    }

    // ── Gravity ────────────────────────────────────────────────────────────
    if (!this.onGround) {
      this.vy += GRAVITY;
      if (this.vy > MAX_FALL_SPEED) this.vy = MAX_FALL_SPEED;
    }

    // ── Apply velocity ─────────────────────────────────────────────────────
    const prevBottom = this.y + BLOB_RADIUS;
    this.x += this.vx;
    this.y += this.vy;

    // ── Platform collision (one-way: land only from above) ─────────────────
    const wasOnGround = this.onGround;
    this.onGround = false;

    for (const plat of platforms) {
      // Skip non-ground platforms while actively dropping through
      if (this.dropFrames > 0 && !plat.isGround) continue;

      const blobL = this.x - BLOB_RADIUS * 0.78;
      const blobR = this.x + BLOB_RADIUS * 0.78;
      const inX   = blobR > plat.x && blobL < plat.x + plat.w;

      if (inX && this.vy >= 0 && prevBottom <= plat.y + 2 && this.y + BLOB_RADIUS >= plat.y) {
        this.y            = plat.y - BLOB_RADIUS;
        this.vy           = 0;
        this.onGround     = true;
        this.onMainGround = plat.isGround;
        if (!wasOnGround) {
          // Landing squish + reset air resources
          this.squishX      = 1.35;
          this.squishY      = 0.65;
          this.airJumpsLeft = MAX_AIR_JUMPS;
          this.soundEvents.push('land');
        }
        break;
      }
    }

    // Coyote time: brief jump grace after walking off a ledge
    if (wasOnGround && !this.onGround && this.vy > 0) {
      this.coyote = COYOTE_FRAMES;
    }

    // ── Horizontal stage bounds ────────────────────────────────────────────
    if (this.x < BLOB_RADIUS) {
      this.x = BLOB_RADIUS;
      this.vx = 0;
    }
    if (this.x > CANVAS_W - BLOB_RADIUS) {
      this.x = CANVAS_W - BLOB_RADIUS;
      this.vx = 0;
    }

    // ── Squish recovery ────────────────────────────────────────────────────
    this.squishX += (1 - this.squishX) * 0.14;
    this.squishY += (1 - this.squishY) * 0.14;
  }

  // ── Combat ───────────────────────────────────────────────────────────────

  /**
   * Apply a hit. Returns true if damage was dealt (false if invincible).
   */
  applyHit(damage, kbX, kbY, hitstunFrames) {
    if (this.invincible > 0) return false;
    this.health  = Math.max(0, this.health - damage);
    this.vx      = kbX;
    this.vy      = kbY;
    this.hitstun = hitstunFrames;
    this.hitFlash = 12;
    this.squishX  = 0.55;
    this.squishY  = 1.5;
    return true;
  }

  /**
   * Called by Game when health reaches 0. Decrements stocks and respawns.
   */
  loseStock() {
    this.stocks--;
    if (this.stocks > 0) {
      this._resetPhysics();
      this.invincible = RESPAWN_FRAMES;
      this.hitFlash   = RESPAWN_FRAMES;
    }
  }

  /**
   * Returns the active melee hitbox rect, or null if not attacking / already hit.
   * @returns {{ x:number, y:number, w:number, h:number } | null}
   */
  getAttackHitbox() {
    if (!this.isAttacking || this.attackHit) return null;
    // Hitbox is a square centred on the tip of the attack arm in the aim direction
    const reach = BLOB_RADIUS * 0.5 + SHORT_RANGE * 0.55;
    const cx    = this.x + this._attackAimX * reach;
    const cy    = this.y + this._attackAimY * reach;
    const half  = SHORT_RANGE * 0.5;
    return { x: cx - half, y: cy - half, w: SHORT_RANGE, h: SHORT_RANGE };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  draw(ctx) {
    // Invincibility flicker: skip every other 4-frame window
    if (this.invincible > 0 && Math.floor(this.invincible / 4) % 2 === 0) return;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.squishX, this.squishY);

    const r     = BLOB_RADIUS;
    const flash = this.hitFlash > 0 && this.invincible === 0;

    // Drop shadow
    ctx.save();
    ctx.scale(1, 0.28);
    ctx.translate(0, r / 0.28);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.restore();

    // Attack glow aura
    if (this.isAttacking) {
      ctx.save();
      ctx.shadowBlur = 25;
      ctx.shadowColor = this.color;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
      ctx.fillStyle = 'transparent';
      ctx.fill(); // trigger shadow
      ctx.restore();
    }

    // Body gradient
    const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, 0, 0, 0, r);
    if (flash) {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(1, '#aaaaaa');
    } else {
      grad.addColorStop(0, _lighten(this.color, 50));
      grad.addColorStop(1, this.colorDark);
    }

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Outline
    ctx.strokeStyle = flash ? '#ffffff' : this.colorDark;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Eyes
    const eyeBaseX  = this.facing * r * 0.32;
    const eyeBaseY  = -r * 0.08;
    const eyeSpread = 7;

    for (let side = -1; side <= 1; side += 2) {
      const ex = eyeBaseX + side * eyeSpread * 0.55;
      const ey = eyeBaseY + (side === 1 ? 0 : -3);

      // White sclera
      ctx.beginPath();
      ctx.arc(ex, ey, 7, 0, Math.PI * 2);
      ctx.fillStyle = flash ? '#fff' : 'white';
      ctx.fill();
      ctx.strokeStyle = '#33333366';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Pupil
      ctx.beginPath();
      ctx.arc(ex + this.facing * 2.2, ey + 1.5, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
    }

    // Melee arm / swing effect
    if (this.isAttacking) {
      const progress  = 1 - this.shortTimer / SHORT_DURATION;
      const armLength = SHORT_RANGE * (0.25 + 0.75 * Math.sin(progress * Math.PI));
      const alpha     = 0.65 * (1 - progress);
      // Arm draws in the stored aim direction
      const nx = this._attackAimX;
      const ny = this._attackAimY;

      ctx.save();
      ctx.globalAlpha    = alpha;
      ctx.shadowBlur     = 14;
      ctx.shadowColor    = this.color;
      ctx.strokeStyle    = this.color;
      ctx.lineWidth      = 9;
      ctx.lineCap        = 'round';
      ctx.beginPath();
      ctx.moveTo(nx * r * 0.6, ny * r * 0.6);
      ctx.lineTo(nx * (r + armLength), ny * (r + armLength));
      ctx.stroke();

      // Impact star at tip
      if (progress > 0.3) {
        ctx.globalAlpha = alpha * 1.2;
        ctx.lineWidth   = 3;
        const tipX = nx * (r + armLength);
        const tipY = ny * (r + armLength);
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX + Math.cos(a) * 10, tipY + Math.sin(a) * 10);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // ── State for AI ─────────────────────────────────────────────────────────

  /**
   * Returns a plain object snapshot of this blob's state for the AI.
   * All values are raw game-units (not normalised); the AI or the
   * stateToVector() helper can normalise them.
   */
  toState() {
    return {
      x:             this.x,
      y:             this.y,
      vx:            this.vx,
      vy:            this.vy,
      health:        this.health,
      stocks:        this.stocks,
      facing:        this.facing,
      onGround:      this.onGround ? 1 : 0,
      isDashing:     this.isDashing ? 1 : 0,
      isAttacking:   this.isAttacking ? 1 : 0,
      shortCooldown: this.shortCooldown,
      longCooldown:  this.longCooldown,
      dashCooldown:  this.dashCooldown,
      hitstun:       this.hitstun,
      invincible:    this.invincible,
      airJumpsLeft:  this.airJumpsLeft,
    };
  }
}
