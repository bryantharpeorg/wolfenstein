# Constitution

Binding on every agent working in this repository. Read before writing code; a node
that violates one of these fails review even if its gates are green.

## I. Stack is fixed — do not substitute

Vite + TypeScript (strict mode) + three.js. Renderer is `WebGPURenderer` when
`navigator.gpu` exists, `WebGLRenderer` otherwise; both paths must initialize. Do not
introduce a game engine, a physics library, an ECS framework, or a second rendering
library. Adding any dependency requires the task that adds it to name the dependency
and the reason in its diff description.

## II. Zero binary assets — hard requirement

No `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.mp3`, `.wav`, `.ogg`, `.glb`, `.gltf`,
`.fbx`, `.ttf`, or `.woff` anywhere in the repository. Every texture, sprite, font
glyph and sound is generated at load time from code: canvas 2D drawing, noise
functions, WebAudio oscillators and buffers. This is the project's defining constraint,
not an aspiration — it is what makes the whole game buildable by a model with no art
pipeline. A task that "borrows" an asset to make a milestone pass has failed the
milestone.

## III. Test-first where the code is testable; smoke-tested always

Pure logic — grid parsing, collision resolution, pathing, door state machines, texture
pixel generation, damage math — lives in modules with no DOM and no three.js imports so
it runs under `npm run test`. Write its failing test first, then implement. Anything
that only exists inside the render loop is verified by the headless smoke harness
(`npm run smoke`) reading `window.__diag`; extend that harness's assertion surface when
a story needs a runtime fact it cannot yet report.

Never weaken a gate to make it pass. A failing gate blocks the commit, not the gate.
Deleting a test, relaxing a threshold, adding an `|| true`, or narrowing a smoke
assertion to accommodate broken code is a violation of this constitution and the change
will be reverted.

## IV. File size ceiling

No source file over 400 lines. Split before you exceed it, not after. When a task would
push a file past the ceiling, splitting that file is part of the task.

## V. Prefer editing to authoring

Grow existing files incrementally. Before creating a new module, check whether an
existing one is its home. This is a performance property of the build engine as much as
a style preference — edit-shaped work runs several times faster than novel generation.

## VI. Original work only

The game is in the *spirit* of Wolfenstein 3D E1M1: grid maze, right angles, locked
doors, secrets, elevator exit. Do not reproduce id Software's map layout, texture data,
sprite art, sounds, or names. Level geometry, textures, sprites and audio are original,
procedurally generated content.

## VII. Every task ends green and committed

After every task: `npm run typecheck`, `npm run build`, `npm run test` and
`npm run smoke` all pass, then commit with the task's specified message. Never leave
the working tree dirty across a task boundary. Never commit to `main` directly; never
force-push.

## VIII. Design forks are decided, not asked

When a design decision is genuinely open, append one line to `DECISIONS.md`: the
decision and a one-clause rationale. Then keep going. Do not stop work to ask a
question you can answer with a defensible default.
