'use strict';

class Projectile {
  /**
   * @param {number} x       - Spawn X
   * @param {number} y       - Spawn Y
   * @param {number} vx      - Horizontal velocity
   * @param {number} vy      - Vertical velocity
   * @param {number} owner   - Player index (0 or 1) that fired this
   */
  constructor(x, y, vx, vy, owner) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.owner = owner;
    this.radius = PROJ_RADIUS;
    this.lifetime = PROJ_LIFETIME;
    this.active = true;

    // Colour derived from owner
    this.color     = owner === 0 ? '#33aaff' : '#ff7733';
    this.colorGlow = owner === 0 ? '#55ccff' : '#ffaa55';
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.lifetime--;
    if (this.lifetime <= 0 || this.x < -60 || this.x > CANVAS_W + 60) {
      this.active = false;
    }
  }

  draw(ctx) {
    if (!this.active) return;
    const alpha = Math.min(1, this.lifetime / 15);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Outer glow
    ctx.shadowBlur = 18;
    ctx.shadowColor = this.colorGlow;

    // Body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();

    // Bright core
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Motion trail dots
    const trailLen = 3;
    for (let i = 1; i <= trailLen; i++) {
      ctx.globalAlpha = alpha * (1 - i / (trailLen + 1)) * 0.4;
      ctx.beginPath();
      ctx.arc(
        this.x - this.vx * i * 1.2,
        this.y - this.vy * i * 1.2,
        this.radius * (1 - i * 0.25),
        0, Math.PI * 2
      );
      ctx.fillStyle = this.color;
      ctx.fill();
    }

    ctx.restore();
  }
}
