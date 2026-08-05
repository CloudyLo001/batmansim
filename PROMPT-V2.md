# Knightfall — Revision Pass 2

Reference: Arkham Knight glide screenshots. The current build reads too small, too
static, and the horizon has a hard seam. Fix the following.

## 1. The cape is a WING, not a cloak (highest priority)

Replace the small hanging cloth cape with a full **bat-wing membrane**, matching the
reference silhouette:

- One continuous membrane stretched between the outstretched arms and the body,
  spanning roughly **3x the character's height** tip to tip (~5.6 m for a 1.9 m hero).
- **Leading edge** runs wingtip → shoulder → neck → shoulder → wingtip in a shallow
  forward arc, and is driven (pinned) by the pose each frame.
- **Trailing edge** is free and cloth-simulated, with the classic **scalloped bat
  cusps** (3 points per side) and a long tapered tail below the feet.
- Membrane ripples and luffs against airflow; ripple amplitude scales with airspeed.
- Material: near-black, heavy, faint cool sheen when moonlight rakes it.

The wing must be **posable**, driven by a `spread` value so it can be animated:

| State | Wing pose |
|---|---|
| Glide | Fully spread, tips slightly back and down |
| Dive | Swept back and tucked tight to the body |
| Landing flare | Hyper-extended, tips thrown forward and up, membrane billowing |
| Perch | Furled, draping behind the shoulders as a cloak |

## 2. Make the hero read BIG

He is a speck right now. Bring the chase camera in and let the wingspan fill the
frame the way the reference does — the wings should span most of the frame width
during a normal glide.

## 3. Better animation throughout

The model is unrigged (Mint cannot rig it — see task notes), so drive everything
procedurally and make it feel alive:

- Continuous subtle body motion: bob, roll into turns, pitch with airspeed.
- Wing pose blends smoothly between glide/dive/flare/furl.
- Banking: body rolls, the inside wing drops, the membrane twists asymmetrically.
- **Landing**: a real beat sequence — flare (wings thrown wide, body swinging
  upright, speed shedding), touchdown impact (slight compress + camera kick), then
  settle into a crouched perch with the wing furling into a draped cloak.

## 4. WASD navigation

Add keyboard flight alongside the mouse: A/D bank left/right, W pitch down,
S pitch up, Shift dive (same as holding the left mouse button). Keyboard and mouse
should blend, not fight.

## 5. Red light in the city

The reference city is lit with red and orange neon among the cool blue. Add:

- Red rooftop aircraft-warning beacons on the tall towers (some slowly blinking).
- Warm red/orange neon pools scattered through the streets.
- Red running lights on the blimps.
- A subtle warm rim on the hero so he is not pure silhouette against the dark city.

## 6. Fix the harsh horizon cutoff

There is a razor-straight seam across the frame where the ocean geometry is clipped
and fogged out against the unfogged skybox. Fix it so sea and sky blend:

- Match the fog colour to the sky's horizon tone.
- Fade the ocean out with distance so it dissolves into the skybox rather than
  ending at a hard edge, and keep its extent inside the camera far plane.
- Remove any banding artifacts from the old horizon haze.

Keep everything else: storm, lightning, blimps with searchlights, bat-signal
objective, Arkham HUD, gargoyle-tower landing, silent.
