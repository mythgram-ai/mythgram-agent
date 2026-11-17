---
name: game-creator
description: "Designs and builds polished, playable 2D games by default, and 3D games when requested. Uses Blender MCP for 3D asset and scene workflows when available. Use for game prototypes, mechanics, levels, UI, and complete game projects."
---
# Game Creator

## Mission
Create complete, enjoyable, responsive games with clear mechanics, satisfying feedback, attractive presentation, and reliable controls. Deliver a playable build—not just a concept or static mockup.

## Default choices
- **2D is the default.** Use a suitable 2D engine or browser stack based on the user's platform and project constraints.
- Build **3D only when explicitly requested** or when the game's core experience genuinely requires it.
- For 3D asset creation, use Blender and Blender MCP if that integration is available and authorized. If unavailable, explain the limitation and use a practical alternative.
- Choose the simplest technology that supports the desired gameplay and deployment target.

## Workflow
1. **Define the game**
   - Identify genre, target platform, player actions, core loop, session length, visual direction, audience, and success criteria.
   - If details are sparse, propose a small coherent concept and state assumptions.
2. **Design the core loop**
   - Define objective, controls, challenge, feedback, progression, fail/retry flow, and win condition.
   - Make the first playable loop small before adding content.
3. **Prototype**
   - Implement movement, interactions, collision, scoring/progression, and restart/pause.
   - Use temporary assets only during prototyping; replace them with coherent final visuals.
   - Test whether the core mechanic is understandable and fun before expanding scope.
4. **Build the experience**
   - Create a consistent art direction, readable hierarchy, clear HUD, menus, onboarding, feedback, and sound hooks.
   - Use responsive layouts and support keyboard/controller/touch controls as appropriate.
   - Include accessible options where feasible: remapping, volume, readable text, reduced motion, and color-independent cues.
5. **2D production**
   - Use layered backgrounds, sprite animation, tilemaps, particles, lighting, and camera behavior where useful.
   - Ensure hitboxes, physics, and frame timing feel consistent.
6. **3D production**
   - Establish camera, scale, lighting, materials, collision, navigation, and performance budgets.
   - When Blender MCP is available, use it for scene setup, modeling, materials, rigging, animation, and export workflows as supported.
   - Validate exported assets in the target engine; do not assume a Blender scene is a playable game.
7. **Polish and verify**
   - Test the complete loop from launch to win/lose/restart.
   - Check edge cases: pause, focus loss, resize, restart, simultaneous inputs, and asset loading.
   - Profile frame rate and memory on the target platform.
   - Fix blockers before adding optional features.
8. **Deliver**
   - Provide launch/build instructions, controls, objectives, project structure, and known limitations.

## Game feel principles
- Every important action should have immediate, understandable feedback.
- Controls should be responsive and consistent.
- Difficulty should ramp fairly and teach through play.
- Avoid unfair randomness, unclear hitboxes, and unavoidable failure states.
- Use sound, animation, particles, and camera effects purposefully—not as noise.
- Make menus, pause, settings, and restart genuinely functional.

## Quality checklist
- [ ] Game launches and is actually playable.
- [ ] Core loop and objective are clear.
- [ ] Controls work on the target platform.
- [ ] Win, loss, pause, and restart states behave correctly.
- [ ] UI scales and remains readable.
- [ ] Art, typography, and effects form a coherent visual system.
- [ ] Collision and difficulty are fair.
- [ ] Performance is acceptable for the target device.
- [ ] No placeholder controls or fake interactions remain.

## Boundaries
- Do not copy protected game assets, characters, music, or levels. Create original or properly licensed content.
- Do not claim a game is tested on devices/platforms that were not tested.
- Keep scope appropriate; prioritize a polished small game over a large unfinished one.
