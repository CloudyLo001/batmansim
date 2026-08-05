# Build: "Knightfall" — an Arkham Knight Glide Showcase

Build a cinematic, interactive 3D web experience (Three.js, single-page, desktop-first) that showcases the highest-quality assets Mint can generate. Batman leaps from an aircraft above a storm-wrapped Gotham at night, and the player glides him down through rain and searchlights toward a bat-signal, landing in a crouch on a gargoyle. Tone reference: *Batman: Arkham Knight* night flight — steel-blue moonlight, wet black armor, neon city bleeding through fog, dark ocean around an island metropolis.

**Quality bar:** This is a flagship demo. Every asset must be generated at maximum quality settings — high-poly sculpt detail, 4K PBR textures, clean retopology for the animated character. No placeholder geometry, no flat-shaded stand-ins. If an asset comes back mediocre, revise and regenerate it before integrating.

## 1. Assets to generate with Mint (all at highest quality)

1. **Batman — Arkham Knight batsuit** (hero asset, rigged + animated):
   - Armored plated batsuit: matte carbon-black segmented plates with subtle metallic edge wear, glossy wet-rain specular highlights, sculpted musculature, long-eared cowl, glowing-edge chest bat emblem kept subtle. Body only or with a simple rigid cape stub — the flowing cape is a separate simulated mesh (see §3).
   - Animations needed: skydive tuck (arms back, head-first), glide pose (arms into the cape "wings", legs trailing), bank-left / bank-right lean, steep-dive tuck, landing flare (body swings vertical, arms high), crouched gargoyle perch (one knee down, one fist on the stone, cape draped). Use Mint's rig + animation pipeline; retopologize/optimize the model for real-time before animating.
2. **Militia blimp**: dark armored zeppelin with a caged/geodesic frame over the envelope (like the reference screenshots), gondola underneath, red warning lights, mounted searchlight.
3. **Gothic tower top + gargoyle**: rain-slick stone, art-deco/gothic cathedral spire crown with a protruding gargoyle ledge — the landing target. Enough detail to hold a close-up hero shot.
4. **City environment / world**: a dark island metropolis at night viewed from above — dense gothic-deco skyscrapers, thousands of window lights, neon signage in reds/cyans/oranges bleeding through low fog, bridges, a ferris wheel silhouette, surrounded by moonlit black ocean. Built for aerial viewing at 200–1400 m altitude.
5. **Sky**: stormy night skybox — towering moonlit cumulus, a huge full moon with visible surface detail, star gaps between clouds.

## 2. Experience flow (three phases)

**Phase 1 — The Jump (scripted cinematic, ~8 s):** Open on the aircraft silhouetted against the full moon above the cloud deck. Batman steps out and drops — camera whips to follow the head-first dive. He punches through the cloud layer (volumetric fog burst past the camera), the city reveals below, the cape snaps open with a visible jolt, and the camera settles into the chase position. Controls hand over seamlessly with a brief "TAKE FLIGHT" HUD flash.

**Phase 2 — The Glide (player-controlled):** Chase camera behind and slightly above Batman, exactly like the reference screenshots.
- Mouse left/right → banking turns (body rolls, cape twists, camera lags then swings around — banking should feel weighty, not instant).
- Mouse up/down → gentle pitch within limits.
- Hold left mouse button → dive: Batman tucks, speed builds, FOV stretches, rain streaks elongate, wind-line particles streak past. Release → cape flares, dive speed converts to a swoop upward. This dive-to-swoop loop is the core feel — tune it until it's satisfying.
- The **bat-signal projected on a distant cloud bank** marks the objective; the HUD distance counter runs down as the player approaches. Gentle auto-correction keeps a wildly off-course player from leaving the city bounds (invisible steering pressure, never a hard wall).

**Phase 3 — The Landing (proximity-triggered cinematic):** Within ~60 m of the signal tower, control eases out: Batman flares the cape hard, sheds speed, and drops into a crouch on the gargoyle. The camera performs one slow orbital hero-shot around the perched silhouette — lightning flash behind him at the apex — then holds a low-angle composition with the bat-signal and moon in frame. "PRESS R TO DROP AGAIN" restarts from the jump.

## 3. The cape — the centerpiece animation

The cape is a dedicated cloth-simulated mesh (Verlet/position-based cloth grid pinned at the shoulders, or a GPU vertex-shader cloth if perf demands), NOT a baked animation:
- Constant turbulent wind ripple during glide; amplitude and flap frequency scale with airspeed.
- Banking twists the cape asymmetrically toward the outside of the turn.
- Diving pins it flat and trembling against the body; releasing a dive produces a full "crack" unfurl.
- On the perch it settles and drapes over the gargoyle with residual gusts.
- Material: heavy matte black weave with faint anisotropic sheen when moonlight rakes across it.

## 4. Atmosphere & effects

- **Storm**: camera-space rain streak particles (elongating with speed), rolling cloud deck, periodic lightning — a bright sky flash that rim-lights Batman's silhouette for 2–3 frames, occasional visible bolt over the ocean.
- **Blimps**: 2–3 militia blimps drifting at different altitudes, sweeping volumetric searchlight cones through the fog; glinting when a beam crosses near the player.
- **Bat-signal**: volumetric projector beam from the tower up onto the clouds, slightly flickering, visible from anywhere on the map.
- **Fog & light**: low city-hugging fog that neon soaks into; moon god-rays through cloud gaps; window lights as instanced emissives with bloom.
- **Post-processing**: filmic bloom, subtle film grain, vignette, steel-blue/teal color grade with warm neon accents, chromatic aberration + slight motion blur only during dives.

## 5. Diegetic Arkham-style HUD

Minimal, angular, cyan-white, semi-transparent, matching the reference screenshots:
- Compass strip top-center (cardinal letters, objective tick).
- Objective marker on the bat-signal tower with live distance readout counting down (e.g. "1228m").
- Small altitude readout; a "LOCAL SURVEILLANCE / RANGE" style tag when a blimp is nearby.
- HUD elements ease in/out — hidden during cinematics, active during the glide.

## 6. Technical requirements

- Three.js (latest), WebGL2, 60 fps target on a mid-range GPU at 1080p.
- Instancing for window lights/city repeats, LOD or impostors for the far city, frustum-culled particles.
- Load screen styled as a bat-emblem bootup with progress; preload everything before Phase 1.
- Desktop-first; on mobile fall back to an auto-piloted cinematic of the same route.
- No audio.
