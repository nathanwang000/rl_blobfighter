'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Particle  (hit sparks, death bursts)
// ─────────────────────────────────────────────────────────────────────────────

class Particle {
  constructor(x, y, vx, vy, radius, color, life) {
    this.x      = x;
    this.y      = y;
    this.vx     = vx;
    this.vy     = vy;
    this.radius = radius;
    this.color  = color;
    this.life   = life;
    this.maxLife = life;
  }

  get alive() { return this.life > 0; }

  update() {
    this.x  += this.vx;
    this.y  += this.vy;
    this.vy += 0.25;  // particle gravity
    this.vx *= 0.92;
    this.life--;
  }

  draw(ctx) {
    const t = this.life / this.maxLife;
    ctx.save();
    ctx.globalAlpha = t * t;
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * t, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Game class
// ─────────────────────────────────────────────────────────────────────────────

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx    = this.canvas.getContext('2d');

    // Input
    this._held    = new Set();
    this._pressed = new Set();
    this._setupInput();

    // Game objects
    this.platforms   = PLATFORM_DATA.map(d => new Platform(d));
    this.blobs       = [];
    this.projectiles = [];
    this.particles   = [];
    this.ai          = null;

    // Visual
    this.screenShake = 0;
    this.frameCount  = 0;
    this._stars      = this._genStars(90);
    this._lastTime   = null;    // for fixed-timestep loop
    this._accumulator = 0;
    this._fixedStep   = 1000 / 60;  // ms per logic tick (locked to 60 fps)

    // State machine: 'title' | 'playing' | 'gameover'
    this.state = 'title';

    this._showScreen('title-screen');

    this._setupResize();
    requestAnimationFrame((ts) => this._loop(ts));
  }

  // ── Input ────────────────────────────────────────────────────────────────

  _setupInput() {
    const gameKeys = new Set(Object.values(KEYS));
    window.addEventListener('keydown', e => {
      if (gameKeys.has(e.key)) e.preventDefault();
      if (!this._held.has(e.key)) this._pressed.add(e.key);
      this._held.add(e.key);
    });
    window.addEventListener('keyup', e => {
      this._held.delete(e.key);
    });
  }

  _isHeld(key)    { return this._held.has(key); }
  _wasPressed(key){ return this._pressed.has(key); }

  _getP1Actions() {
    return {
      left:        this._isHeld(KEYS.P1_LEFT),
      right:       this._isHeld(KEYS.P1_RIGHT),
      jump:        this._isHeld(KEYS.P1_JUMP),      // held; blob handles tap logic
      drop:        this._isHeld(KEYS.P1_DROP),       // held; combine with jump to fall through
      dash:        this._wasPressed(KEYS.P1_DASH),
      shortAttack: this._wasPressed(KEYS.P1_SHORT_ATTACK),
      longAttack:  this._wasPressed(KEYS.P1_LONG_ATTACK),
    };
  }

  /**
   * Public snapshot of the current P1 action — used by HumanAI shim so a
   * TrajectoryRecordingAI wrapper can record human play.
   * Must be called WITHIN the same frame as _getP1Actions().
   */
  getP1ActionsSnapshot() { return this._getP1Actions(); }

  // ── Game-state helpers ───────────────────────────────────────────────────

  _startGame() {
    this.blobs       = [
      new Blob(SPAWN_P1.x, SPAWN_P1.y, 0),
      new Blob(SPAWN_P2.x, SPAWN_P2.y, 1),
    ];
    this.projectiles = [];
    this.particles   = [];
    this.ai          = new RuleBasedAI();
    this.state       = 'playing';
    this._showScreen(null);
    SFX.startMusic();
  }

  _getGameState() {
    return {
      players:     this.blobs.map(b => b.toState()),
      projectiles: this.projectiles.map(p => ({
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, owner: p.owner,
      })),
      platforms: PLATFORM_DATA,
    };
  }

  // ── Core loop ────────────────────────────────────────────────────────────

  _loop(timestamp) {
    if (this._lastTime === null) this._lastTime = timestamp;
    // Cap delta to 100 ms to avoid spiral-of-death after tab switching
    const delta = Math.min(timestamp - this._lastTime, 100);
    this._lastTime = timestamp;
    this._accumulator += delta;

    while (this._accumulator >= this._fixedStep) {
      this._update();
      this._pressed.clear();
      this._accumulator -= this._fixedStep;
    }

    this._render();
    requestAnimationFrame((ts) => this._loop(ts));
  }

  _update() {
    this.frameCount++;

    if (this.state === 'title') {
      if (this._wasPressed(KEYS.CONFIRM)) this._startGame();
      return;
    }

    if (this.state === 'gameover') {
      if (this._wasPressed(KEYS.CONFIRM)) this._startGame();
      return;
    }

    // ── Gather actions ────────────────────────────────────────────────────
    const p1Actions   = this._getP1Actions();
    const gameState   = this._getGameState();
    const p2Actions   = this.ai.getAction(gameState, 1);
    const allActions  = [p1Actions, p2Actions];

    // ── Update blobs ──────────────────────────────────────────────────────
    for (let i = 0; i < 2; i++) {
      this.blobs[i].update(allActions[i], this.platforms);
      // Consume sound events from this frame
      for (const ev of this.blobs[i].soundEvents) {
        switch (ev) {
          case 'jump':    SFX.playJump();        break;
          case 'airjump': SFX.playAirJump();     break;
          case 'land':    SFX.playLand();        break;
          case 'dash':    SFX.playDash();        break;
          case 'swing':   SFX.playMeleeSwing();  break;
        }
      }
      if (this.blobs[i].pendingProjectile) {
        SFX.playProjFire();
        this._spawnProjectile(this.blobs[i]);
      }
    }

    // ── Melee collision ───────────────────────────────────────────────────
    for (let i = 0; i < 2; i++) {
      const attacker = this.blobs[i];
      const defender = this.blobs[1 - i];
      const hb       = attacker.getAttackHitbox();
      if (!hb) continue;

      // Circle-vs-rect: clamp defender centre to rect, check distance vs blob radius
      const cx = Math.max(hb.x, Math.min(defender.x, hb.x + hb.w));
      const cy = Math.max(hb.y, Math.min(defender.y, hb.y + hb.h));
      if (Math.hypot(defender.x - cx, defender.y - cy) < BLOB_RADIUS * 0.85) {
        const hit = defender.applyHit(
          SHORT_DAMAGE,
          attacker.facing * SHORT_KB_X,
          SHORT_KB_Y,
          SHORT_HITSTUN,
        );
        if (hit) {
          attacker.attackHit = true;
          SFX.playMeleeHit();
          this._spawnHitParticles(defender.x, defender.y, defender.color, 12);
          this.screenShake = Math.max(this.screenShake, 7);
        }
      }
    }

    // ── Projectile update & hit detection ────────────────────────────────
    for (const proj of this.projectiles) {
      proj.update();
      if (!proj.active) continue;

      const target = this.blobs[1 - proj.owner];
      const d      = Math.hypot(proj.x - target.x, proj.y - target.y);
      if (d < PROJ_RADIUS + BLOB_RADIUS * 0.82) {
        const hit = target.applyHit(
          PROJ_DAMAGE,
          Math.sign(proj.vx) * PROJ_KB_X,
          PROJ_KB_Y,
          PROJ_HITSTUN,
        );
        if (hit) {
          proj.active = false;
          SFX.playProjHit();
          this._spawnHitParticles(proj.x, proj.y, proj.color, 8);
          this.screenShake = Math.max(this.screenShake, 4);
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => p.active);

    // ── Check health / stocks ─────────────────────────────────────────────
    for (const blob of this.blobs) {
      if (blob.health <= 0 && blob.invincible === 0) {
        SFX.playDeath();
        this._spawnHitParticles(blob.x, blob.y, blob.color, 22);
        this.screenShake = Math.max(this.screenShake, 14);
        blob.loseStock();
      }
    }

    // ── Fall-off-stage detection ──────────────────────────────────────────
    for (const blob of this.blobs) {
      if (blob.y > CANVAS_H + 60 && blob.invincible === 0) {
        blob.health = 0;
        this._spawnHitParticles(blob.x, Math.min(blob.y, CANVAS_H - 10), blob.color, 16);
        this.screenShake = Math.max(this.screenShake, 10);
        blob.loseStock();
      }
    }

    // ── Win condition ─────────────────────────────────────────────────────
    for (const blob of this.blobs) {
      if (blob.stocks <= 0) {
        const winner = this.blobs.find(b => b !== blob);
        this._triggerGameOver(winner.name);
        return;
      }
    }

    // ── Particles ─────────────────────────────────────────────────────────
    for (const p of this.particles) p.update();
    this.particles = this.particles.filter(p => p.alive);

    // ── Screen shake decay ────────────────────────────────────────────────
    this.screenShake *= 0.82;
    if (this.screenShake < 0.4) this.screenShake = 0;
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  _render() {
    const ctx = this.ctx;
    ctx.save();

    // Screen shake offset
    if (this.screenShake > 0) {
      ctx.translate(
        (Math.random() - 0.5) * this.screenShake * 2.2,
        (Math.random() - 0.5) * this.screenShake * 2.2,
      );
    }

    this._drawBackground(ctx);

    if (this.state === 'playing' || this.state === 'gameover') {
      // Platforms
      for (const plat of this.platforms) plat.draw(ctx);

      // Particles (behind characters)
      for (const p of this.particles) p.draw(ctx);

      // Projectiles
      for (const proj of this.projectiles) proj.draw(ctx);

      // Blobs
      for (const blob of this.blobs) blob.draw(ctx);

      // HUD
      this._drawHUD(ctx);
    }

    ctx.restore();
  }

  _drawBackground(ctx) {
    // Gradient sky
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#07051a');
    grad.addColorStop(1, '#130d35');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Stars
    for (const s of this._stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(this.frameCount * s.spd + s.phase);
      ctx.globalAlpha = s.bright * twinkle;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.sz, s.sz);
    }
    ctx.globalAlpha = 1;

    // Distant nebula blobs (static, painted once)
    ctx.save();
    ctx.globalAlpha = 0.06;
    [[200, 120, 180, '#6633cc'], [600, 80, 140, '#3366cc'], [400, 300, 100, '#cc3366']].forEach(([nx, ny, nr, nc]) => {
      const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      ng.addColorStop(0, nc);
      ng.addColorStop(1, 'transparent');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.arc(nx, ny, nr, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  _drawHUD(ctx) {
    const barW = 210;
    const barH = 18;
    const padX = 22;
    const padY = 16;

    for (let i = 0; i < 2; i++) {
      const blob = this.blobs[i];
      const x    = i === 0 ? padX : CANVAS_W - padX - barW;
      const y    = padY;

      // Player name
      ctx.font      = 'bold 12px "Courier New", monospace';
      ctx.fillStyle = blob.color;
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText(blob.name, i === 0 ? x : x + barW, y + 1);

      // HP bar bg
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(x, y + 5, barW, barH);

      // HP bar fill
      const pct   = blob.health / MAX_HEALTH;
      const hpCol = pct > 0.5 ? '#4cdd60' : pct > 0.25 ? '#ffbb33' : '#ff4444';
      ctx.fillStyle = hpCol;
      ctx.fillRect(x, y + 5, barW * pct, barH);

      // HP bar border
      ctx.strokeStyle = '#444466';
      ctx.lineWidth   = 1;
      ctx.strokeRect(x, y + 5, barW, barH);

      // HP number
      ctx.fillStyle = '#ffffffcc';
      ctx.font      = '10px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(blob.health)}`, x + barW / 2, y + 5 + barH - 4);

      // Stocks (lives) — small dots below the bar
      for (let s = 0; s < MAX_STOCKS; s++) {
        const dotX = i === 0 ? x + s * 15 + 5 : x + barW - s * 15 - 5;
        const dotY = y + 5 + barH + 10;
        ctx.beginPath();
        ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
        ctx.fillStyle   = s < blob.stocks ? blob.color : '#222244';
        ctx.fill();
        ctx.strokeStyle = '#44446699';
        ctx.lineWidth   = 1;
        ctx.stroke();
      }
    }

    // Centre timer / frame counter (subtle)
    ctx.font      = '11px "Courier New", monospace';
    ctx.fillStyle = '#ffffff33';
    ctx.textAlign = 'center';
    ctx.fillText(`BLOBFIGHT`, CANVAS_W / 2, padY + 12);
  }

  // ── Fullscreen scaling ─────────────────────────────────────────────────

  _setupResize() {
    const container = document.getElementById('container');
    const resize = () => {
      const s = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
      container.style.transform = `scale(${s})`;
    };
    window.addEventListener('resize', resize);
    resize();
  }

  // ── Helper spawners ───────────────────────────────────────────────────────

  _spawnProjectile(blob) {
    const proj = new Projectile(
      blob.x + blob.facing * (BLOB_RADIUS + 2),
      blob.y,
      blob.facing * PROJ_SPEED,
      blob.playerIndex,
    );
    this.projectiles.push(proj);
  }

  _spawnHitParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 5;
      this.particles.push(new Particle(
        x, y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed - 1.5,
        2 + Math.random() * 5,
        color,
        18 + Math.floor(Math.random() * 22),
      ));
    }
  }

  _genStars(count) {
    return Array.from({ length: count }, () => ({
      x:     Math.random() * CANVAS_W,
      y:     Math.random() * CANVAS_H * 0.78,
      sz:    Math.random() < 0.15 ? 2 : 1,
      bright: 0.25 + Math.random() * 0.75,
      spd:   0.018 + Math.random() * 0.045,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  // ── Screen management ─────────────────────────────────────────────────────

  _showScreen(id) {
    document.querySelectorAll('.overlay-screen').forEach(el => {
      el.style.display = 'none';
    });
    if (id) document.getElementById(id).style.display = '';
  }

  _triggerGameOver(winnerName) {
    // Give any trajectory recorders a chance to record the terminal transition
    if (this.ai && typeof this.ai.markDone === 'function') {
      this.ai.markDone(this._getGameState(), 1);
    }
    this.state = 'gameover';
    document.getElementById('winner-text').textContent = `${winnerName} WINS!`;
    this._showScreen('gameover-screen');
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => { new Game(); });
