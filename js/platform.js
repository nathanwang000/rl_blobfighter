'use strict';

class Platform {
  /**
   * @param {{ x:number, y:number, w:number, h:number, isGround?:boolean }} data
   */
  constructor({ x, y, w, h, isGround = false }) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.isGround = isGround;
  }

  draw(ctx) {
    if (this.isGround) {
      // Earthy ground strip
      ctx.fillStyle = '#2d4a1e';
      ctx.fillRect(this.x, this.y, this.w, this.h);
      // Bright top edge
      ctx.fillStyle = '#4a7a2e';
      ctx.fillRect(this.x, this.y, this.w, 5);
      // Texture lines
      ctx.strokeStyle = '#3a6025';
      ctx.lineWidth = 1;
      for (let tx = 0; tx < this.w; tx += 40) {
        ctx.beginPath();
        ctx.moveTo(this.x + tx, this.y + 5);
        ctx.lineTo(this.x + tx + 20, this.y + this.h);
        ctx.stroke();
      }
    } else {
      // Glowing floating platform
      ctx.save();
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#7755cc';

      // Body
      ctx.fillStyle = '#3d2d6a';
      ctx.beginPath();
      ctx.roundRect(this.x, this.y, this.w, this.h, 5);
      ctx.fill();

      // Top highlight strip
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#7755cc';
      ctx.beginPath();
      ctx.roundRect(this.x + 3, this.y + 1, this.w - 6, 4, 2);
      ctx.fill();

      // Glow outline
      ctx.strokeStyle = '#9977ee55';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(this.x, this.y, this.w, this.h, 5);
      ctx.stroke();

      ctx.restore();
    }
  }
}
