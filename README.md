# PhysicsCraft

A 3D physics and chemistry sandbox set in a Japanese garden. Drag any of the 118 elements, everyday materials (water, fire, wood, lava, TNT…) or containers onto the stone terrace and watch them fall, float, flow, burn, react and explode.

## Running

Open `index.html` in Chrome, Edge or Firefox. An internet connection is needed: Three.js and cannon-es come from the jsDelivr CDN, and the garden HDRI, textures and plant/rock models come from [Poly Haven](https://polyhaven.com) (CC0).

If your browser blocks the page when opened as a file, serve the folder instead:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Controls

| Action | Input |
| --- | --- |
| Spawn something | drag a card from the sidebar into the view |
| Edit a material before spawning | click its card |
| Inspect / edit a live object | click it (Stir or Grab tool) |
| Orbit camera | right-drag |
| Pan along the workspace | middle-drag, `W` `A` `S` `D`, or the overview strip |
| Zoom | scroll, `+` / `−` |
| Tools | `1` Stir · `2` Grab · `3` Wind · `4` Heat · `5` Cool · `6` Blast · `7` Erase · `8` Pour |
| Pause / step | `Space` · `.` |
| Delete / focus selected | `Del` · `F` |

Wind is off by default, so water stays perfectly still. Use the Wind slider in the toolbar or the Wind tool to raise ripples and waves.

## How it works

- `js/core/fluid.js`: 3D particle engine. Liquids use Position Based Fluids with density-driven buoyancy (oil floats, mercury sinks). The engine also handles granular contacts, buoyant gases and fire, frozen spring networks, heat transfer, phase changes, combustion, radioactive decay, fission and fusion.
- `js/core/bodies.js`: rigid bodies on cannon-es (rocks, planks, ingots, ice, TNT, containers). Covers buoyancy from the liquid surface, wind drag, latent-heat melting, burning, surface chemistry (e.g. sodium in water), fracture and critical mass.
- `js/core/sim.js`: wind field, explosions, spawning and interactive tools.
- `js/render/view3d.js`: HDRI lighting, sun and soft shadows, PBR materials, instanced grains, smoke and flame sprites, firelight, explosion lights and shockwaves, bloom and SMAA.
- `js/render/fluidfx.js`: screen-space fluid rendering with bilateral smoothing, refraction, Beer–Lambert absorption, Fresnel reflections, sun glints and wind ripples.
- `js/core/elements.js`, `materials.js`, `reactions.js`: element data, materials and the reaction table.
