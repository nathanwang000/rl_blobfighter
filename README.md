# BlobFight

A browser-based 2D fighter game where every character is a blob. Open `index.html` in any modern browser — no build step required.

## Controls (Player 1)

| Key | Action |
|-----|--------|
| `← →` | Move |
| `X` | Jump (coyote-time supported) |
| `S` | Dash |
| `Z` | Melee attack (short range) |
| `A` | Blast (long-range projectile) |

All key bindings live in a single object at the top of `js/constants.js` — edit `KEYS` there to remap anything.

## Project Structure

```
blobfight/
  index.html          # Entry point — open this to play
  style.css
  js/
    constants.js      # All tunable values: keys, physics, damage, stage layout
    platform.js       # Platform rendering
    projectile.js     # Projectile physics + rendering
    blob.js           # Blob character: physics, combat, squish animation
    ai.js             # AI controllers (see below)
    game.js           # Main game loop, collision, HUD, particles
```

## AI Interface

All AI controllers extend `AIController` and implement one method:

```js
getAction(state, playerIndex)
// → { left, right, jump, dash, shortAttack, longAttack }
```

The `state` object contains only the minimal game state (no pixels):
- `state.players[i]` — position, velocity, health, cooldowns, etc.
- `state.projectiles` — active projectiles
- `state.platforms` — static platform layout

### Neural Network AI

Use the built-in helpers to convert between game state and flat vectors:

```js
class MyNetAI extends AIController {
  getAction(state, playerIndex) {
    const input  = AIController.stateToVector(state, playerIndex); // Float32Array, 42 values
    const output = this.net.forward(input);                        // 6 sigmoid outputs
    return AIController.vectorToAction(output);
  }
}
```

State vector layout (42 floats, all normalised):

| Slice | Content |
|-------|---------|
| 0–9 | Self: x, y, vx, vy, health, facing, onGround, shortCD, longCD, dashCD |
| 10–19 | Opponent: same encoding |
| 20–21 | Relative position (dx, dy) |
| 22–41 | Up to 4 projectiles × 5 values each (x, y, vx, vy, owner) |

### Trajectory Recording

Wrap any controller to collect `(state, action, reward, done)` tuples for training:

```js
const recorder = new TrajectoryRecordingAI(new RuleBasedAI(), /* playerIndex */ 1);
// pass recorder to Game as the AI
// after the episode ends:
const transitions = recorder.flush();
// [{ state: Float32Array(42), action: Float32Array(6), reward: number, done: bool }, ...]
```

To record **human play** (behaviour cloning):

```js
const humanShim = new HumanAI(() => game.getP1ActionsSnapshot());
const recorder  = new TrajectoryRecordingAI(humanShim, 0);
```

Override `computeReward(prevState, currState, playerIndex)` in a subclass to customise the reward signal.
