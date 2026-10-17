// Screen-space fluid rendering (SSFR): liquid particles are splatted as spheres into a depth buffer,
// smoothed with a bilateral filter, and shaded as a continuous surface with refraction, Beer–Lambert
// absorption, Fresnel environment reflections, sun glints and wind-driven micro ripples.
(function (PC) {
  'use strict';

  const FS_VERT = /* glsl */`
    out vec2 vUv;
    void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  class FluidFX {
    constructor(view, opts) {
      const THREE = view.THREE;
      this.view = view;
      this.mode = (opts && opts.mode) || 'liquid';
      this.grain = this.mode === 'grain';
      this.T = THREE;
      this.cap = view.sim.fluid.cap;
      this.n = 0;
      const geo = new THREE.BufferGeometry();
      this.pos = new Float32Array(this.cap * 3);
      this.col = new Float32Array(this.cap * 4);
      this.prop = new Float32Array(this.cap * 2);
      geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aProp', new THREE.BufferAttribute(this.prop, 2).setUsage(THREE.DynamicDrawUsage));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      this.geo = geo;

      const common = {
        uRadius: { value: view.sim.fluid.r * (this.grain ? 1.9 : 2.05) }, uScale: { value: 1 }, uProj: { value: new THREE.Matrix4() },
        uSceneDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      };
      const sphereVert = /* glsl */`
        uniform float uRadius; uniform float uScale;
        in vec4 aColor; in vec2 aProp;
        out vec3 vView; out vec4 vColor; out vec2 vProp;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = mv.xyz; vColor = aColor; vProp = aProp;
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, uRadius * 2.0 * uScale / -mv.z);
        }`;
      // 1) Linear depth of the nearest sphere surface, occluded by the opaque scene.
      this.depthMat = new THREE.ShaderMaterial({
        uniforms: common, vertexShader: sphereVert,
        fragmentShader: /* glsl */`
          uniform float uRadius; uniform mat4 uProj; uniform sampler2D uSceneDepth; uniform vec2 uRes;
          in vec3 vView; in vec4 vColor; in vec2 vProp;
          void main() {
            vec2 c = gl_PointCoord * 2.0 - 1.0; c.y = -c.y;
            float r2 = dot(c, c);
            if (r2 > 1.0) discard;
            vec3 p = vView + vec3(c, sqrt(1.0 - r2)) * uRadius;
            float d = -p.z;
            float sd = texture(uSceneDepth, gl_FragCoord.xy / uRes).r;
            // Hide the splat if either its surface or its centre is behind scene geometry (no poking through thin walls).
            if (d > sd + 0.004 || -vView.z > sd + 0.004) discard;
            vec4 clip = uProj * vec4(p, 1.0);
            gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
            gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
          }`,
      });
      // 2) Accumulated thickness and material properties (additive).
      this.thickMat = new THREE.ShaderMaterial({
        uniforms: common, vertexShader: sphereVert, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        fragmentShader: /* glsl */`
          uniform float uRadius; uniform sampler2D uSceneDepth; uniform vec2 uRes;
          in vec3 vView; in vec4 vColor; in vec2 vProp;
          layout(location = 1) out vec4 outColor2;
          void main() {
            vec2 c = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(c, c);
            if (r2 > 1.0) discard;
            float z = sqrt(1.0 - r2);
            float sd = texture(uSceneDepth, gl_FragCoord.xy / uRes).r;
            if (-vView.z - z * uRadius > sd + 0.004 || -vView.z > sd + 0.004) discard;
            float w = z;
            gl_FragColor = vec4(2.0 * z * uRadius, vColor.a * w, vProp.x * w, w);
            outColor2 = vec4(vColor.rgb * w, vProp.y * w);
          }`,
      });
      this.points = new THREE.Points(geo, this.depthMat);
      this.points.frustumCulled = false;
      this.pointScene = new THREE.Scene();
      this.pointScene.add(this.points);

      // Bilateral depth smoothing.
      this.blurMat = new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false,
        uniforms: { tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uScale: { value: 1 }, uFalloff: { value: 1 }, uMaxPx: { value: 40 } },
        vertexShader: FS_VERT,
        fragmentShader: /* glsl */`
          uniform sampler2D tDepth; uniform vec2 uDir; uniform float uRadius; uniform float uScale; uniform float uFalloff; uniform float uMaxPx;
          in vec2 vUv;
          void main() {
            float d0 = texture(tDepth, vUv).r;
            if (d0 <= 0.0) { gl_FragColor = vec4(0.0); return; }
            float px = clamp(uRadius * uScale / d0, 1.0, uMaxPx) * 0.5;
            float sum = 0.0, wsum = 0.0;
            for (int i = -8; i <= 8; i++) {
              float t = float(i) / 8.0;
              vec2 uv = vUv + uDir * px * t;
              float d = texture(tDepth, uv).r;
              if (d <= 0.0) continue;
              float dd = (d - d0) / (uRadius * uFalloff);
              float w = exp(-t * t * 2.0) * exp(-dd * dd);
              sum += d * w; wsum += w;
            }
            gl_FragColor = vec4(sum / max(wsum, 1e-5), 0.0, 0.0, 1.0);
          }`,
      });

      // Linearise the scene depth buffer.
      this.linMat = new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false,
        uniforms: { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 } },
        vertexShader: FS_VERT,
        fragmentShader: /* glsl */`
          #include <packing>
          uniform sampler2D tDepth; uniform float uNear; uniform float uFar;
          in vec2 vUv;
          void main() {
            float z = texture(tDepth, vUv).r;
            gl_FragColor = vec4(z >= 1.0 ? 1e6 : -perspectiveDepthToViewZ(z, uNear, uFar), 0.0, 0.0, 1.0);
          }`,
      });

      this.copyMat = new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false, uniforms: { tMap: { value: null } }, vertexShader: FS_VERT,
        fragmentShader: `uniform sampler2D tMap; in vec2 vUv; void main() { gl_FragColor = texture(tMap, vUv); }`,
      });

      // Final shading.
      this.compMat = new THREE.ShaderMaterial({
        depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
        defines: Object.assign({ ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: '0.0', CUBEUV_TEXEL_HEIGHT: '0.0', CUBEUV_MAX_MIP: '0.0' }, this.grain ? { GRAIN: '' } : {}),
        uniforms: {
          tGrain: { value: null }, tGrainN: { value: null }, uGrainScale: { value: 2.2 }, shadowMap: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowTexel: { value: 1 / 2048 },
          tScene: { value: null }, tDepth: { value: null }, tThick: { value: null }, tColor: { value: null }, tSceneDepth: { value: null },
          envMap: { value: null }, uHasEnv: { value: 0 }, uEnvIntensity: { value: 1 },
          uProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() }, uView: { value: new THREE.Matrix4() },
          uTexel: { value: new THREE.Vector2() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) },
          uAmbient: { value: new THREE.Color(0.4, 0.45, 0.5) }, uTime: { value: 0 }, uRipple: { value: 0.2 }, uWindDir: { value: new THREE.Vector2(1, 0) },
          uRefract: { value: 0.035 }, uCam: { value: new THREE.Vector3() }, uThermal: { value: 0 },
          tRipple: { value: null }, uRippleBox: { value: new THREE.Vector4(30, 8, 1, 1) }, uRippleTexel: { value: new THREE.Vector2(0.001, 0.001) },
        },
        vertexShader: FS_VERT,
        fragmentShader: /* glsl */`
          uniform sampler2D envMap;
          #include <common>
          #include <packing>
          #include <cube_uv_reflection_fragment>
          uniform sampler2D tGrain, tGrainN, shadowMap; uniform float uGrainScale, uShadowOn, uShadowTexel; uniform mat4 uShadowMatrix;
          uniform sampler2D tScene, tDepth, tThick, tColor, tSceneDepth, tRipple;
          uniform vec4 uRippleBox; uniform vec2 uRippleTexel;
          uniform float uHasEnv, uEnvIntensity, uTime, uRipple, uRefract, uThermal;
          uniform mat4 uProj, uInvView, uView;
          uniform vec2 uTexel, uWindDir;
          uniform vec3 uSunDir, uSunColor, uAmbient, uCam;
          in vec2 vUv;

          vec3 viewPos(vec2 uv, float d) {
            vec2 ndc = uv * 2.0 - 1.0;
            return vec3(ndc.x * d / uProj[0][0], ndc.y * d / uProj[1][1], -d);
          }
          float depthAt(vec2 uv) {
            // Bilinear depth, but fall back to the nearest texel at silhouettes (where a neighbour is empty).
            float d = texture(tDepth, uv).r;
            vec2 ts = uTexel;
            vec2 f = uv / ts - 0.5, b = (floor(f) + 0.5) * ts;
            float a0 = texture(tDepth, b).r, a1 = texture(tDepth, b + vec2(ts.x, 0.0)).r, a2 = texture(tDepth, b + vec2(0.0, ts.y)).r, a3 = texture(tDepth, b + ts).r;
            if (a0 <= 0.0 || a1 <= 0.0 || a2 <= 0.0 || a3 <= 0.0) {
              vec2 n = (floor(uv / ts) + 0.5) * ts;
              return texture(tDepth, n).r;
            }
            return d;
          }
          vec3 env(vec3 dirW, float rough) {
            if (uHasEnv < 0.5) return mix(vec3(0.35, 0.4, 0.45), vec3(0.6, 0.75, 0.95), clamp(dirW.y * 0.5 + 0.5, 0.0, 1.0));
            return textureCubeUV(envMap, dirW, rough).rgb * uEnvIntensity;
          }
          // Small animated capillary/gravity ripples; stronger with wind.
          vec2 ripple(vec2 p) {
            vec2 g = vec2(0.0);
            vec2 w = normalize(uWindDir + vec2(1e-4));
            float t = uTime;
            for (int i = 0; i < 6; i++) {
              float fi = float(i);
              float ang = (fi - 2.5) * 0.45;
              vec2 dir = vec2(w.x * cos(ang) - w.y * sin(ang), w.x * sin(ang) + w.y * cos(ang));
              float k = 6.0 + fi * 5.3;
              float amp = 1.0 / (k * 0.9);
              float ph = dot(dir, p) * k - t * sqrt(9.81 * k) * 0.6 + fi * 1.7;
              g += dir * cos(ph) * amp * k;
            }
            return g;
          }
          vec2 hash22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
          // Cellular pattern: x = distance to nearest cell centre, y = gap to the second nearest (small on cracks).
          vec2 voronoi(vec2 p) {
            vec2 g = floor(p), f = fract(p);
            float d1 = 8.0, d2 = 8.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 o = vec2(float(i), float(j)), r = o + hash22(g + o) - f;
              float d = dot(r, r);
              if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
            }
            return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
          }
          float vnoise(vec2 p) {
            vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
            float a = hash22(i).x, b = hash22(i + vec2(1.0, 0.0)).x, c = hash22(i + vec2(0.0, 1.0)).x, d = hash22(i + vec2(1.0, 1.0)).x;
            return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
          }
          float sunShadow(vec3 Pw, vec3 Nw) {
            if (uShadowOn < 0.5) return 1.0;
            vec4 sc = uShadowMatrix * vec4(Pw + Nw * 0.05, 1.0);
            sc.xyz /= sc.w;
            if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0) return 1.0;
            float s = 0.0;
            for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
              s += step(sc.z - 0.008, unpackRGBAToDepth(texture(shadowMap, sc.xy + vec2(float(i), float(j)) * uShadowTexel * 1.5)));
            return s / 9.0;
          }
          void main() {
            float d = depthAt(vUv);
            if (d <= 0.0) discard;
            vec3 P = viewPos(vUv, d);
            // Normal from the smoothed depth using the smaller one-sided difference (keeps silhouettes crisp).
            vec3 px1 = viewPos(vUv + vec2(uTexel.x, 0.0), depthAt(vUv + vec2(uTexel.x, 0.0)));
            vec3 px0 = viewPos(vUv - vec2(uTexel.x, 0.0), depthAt(vUv - vec2(uTexel.x, 0.0)));
            vec3 py1 = viewPos(vUv + vec2(0.0, uTexel.y), depthAt(vUv + vec2(0.0, uTexel.y)));
            vec3 py0 = viewPos(vUv - vec2(0.0, uTexel.y), depthAt(vUv - vec2(0.0, uTexel.y)));
            vec3 ddx = px1 - P, ddx2 = P - px0;
            if (depthAt(vUv + vec2(uTexel.x, 0.0)) <= 0.0 || abs(ddx2.z) < abs(ddx.z)) ddx = ddx2;
            vec3 ddy = py1 - P, ddy2 = P - py0;
            if (depthAt(vUv + vec2(0.0, uTexel.y)) <= 0.0 || abs(ddy2.z) < abs(ddy.z)) ddy = ddy2;
            vec3 N = normalize(cross(ddx, ddy));
            #ifdef GRAIN
              // Piles: wide central differences over the smoothed depth — no per-texel facets on steep slopes.
              {
                vec2 o = uTexel * 2.5;
                float dl = depthAt(vUv - vec2(o.x, 0.0)), dr = depthAt(vUv + vec2(o.x, 0.0)), dd = depthAt(vUv - vec2(0.0, o.y)), du = depthAt(vUv + vec2(0.0, o.y));
                if (dl > 0.0 && dr > 0.0 && dd > 0.0 && du > 0.0)
                  N = normalize(cross(viewPos(vUv + vec2(o.x, 0.0), dr) - viewPos(vUv - vec2(o.x, 0.0), dl), viewPos(vUv + vec2(0.0, o.y), du) - viewPos(vUv - vec2(0.0, o.y), dd)));
              }
            #endif
            if (dot(N, -P) < 0.0) N = -N;

            vec3 Pw = (uInvView * vec4(P, 1.0)).xyz;
            vec3 Nw = normalize((uInvView * vec4(N, 0.0)).xyz);
            // Micro ripples (wind) + simulated ripples (cursor, splashes, rain) on up-facing surfaces.
            #ifdef GRAIN
            if (false) {
            #else
            if (Nw.y > 0.3) {
            #endif
              float up = smoothstep(0.3, 0.9, Nw.y);
              vec2 g = ripple(Pw.xz) * uRipple * up * 0.08;
              vec2 ruv = (Pw.xz + uRippleBox.xy * 0.5) / uRippleBox.xy;
              float hx = texture(tRipple, ruv + vec2(uRippleTexel.x, 0.0)).r - texture(tRipple, ruv - vec2(uRippleTexel.x, 0.0)).r;
              float hz = texture(tRipple, ruv + vec2(0.0, uRippleTexel.y)).r - texture(tRipple, ruv - vec2(0.0, uRippleTexel.y)).r;
              g += vec2(hx, hz) * uRippleBox.z * up;
              Nw = normalize(Nw + vec3(-g.x, 0.0, -g.y));
              N = normalize((uView * vec4(Nw, 0.0)).xyz);
            }
            vec4 th = texture(tThick, vUv);
            vec4 cc = texture(tColor, vUv);
            float wsum = max(th.a, 1e-4);
            float thick = th.r;
            float opacity = clamp(th.g / wsum, 0.0, 1.0);
            float metalRaw = th.b / wsum, rockAmt = max(-metalRaw, 0.0), melt = clamp(rockAmt - 1.0, 0.0, 1.0);
            float metal = clamp(metalRaw, 0.0, 1.0);
            vec3 col = cc.rgb / wsum;
            float emisRaw = cc.a / wsum, crustFrac = clamp(-emisRaw, 0.0, 1.0);
            float emis = max(emisRaw, 0.0);
            vec3 albedo = clamp(col, 0.0, 1.0);

            vec3 V = normalize(uCam - Pw);
            float NdV = max(dot(Nw, V), 0.0);
            // Refraction with Beer–Lambert absorption (albedo defines what the liquid lets through).
            vec2 ruv = vUv + N.xy * uRefract * clamp(thick * 3.0, 0.0, 1.0);
            if (texture(tSceneDepth, ruv).r < d) ruv = vUv;
            vec3 behind = texture(tScene, ruv).rgb;
            vec3 absorb = (vec3(1.0) - albedo) * 4.0 + 0.05;
            vec3 transmit = exp(-absorb * thick * 1.6);
            vec3 refracted = behind * transmit;
            // Diffuse look for opaque liquids (mud, oil, lava, molten metal).
            float ndl = max(dot(Nw, uSunDir), 0.0);
            vec3 diffuse = albedo * (uAmbient + uSunColor * ndl);
            vec3 body = mix(refracted + albedo * uAmbient * 0.12 * (1.0 - opacity), diffuse, opacity);
            // Fresnel reflections.
            vec3 F0 = mix(vec3(0.02), albedo, metal);
            vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdV, 5.0);
            vec3 R = reflect(-V, Nw);
            vec3 refl = env(R, mix(0.02, 0.18, metal));
            vec3 H = normalize(uSunDir + V);
            float spec = pow(max(dot(Nw, H), 0.0), 1400.0) * 6.0 + pow(max(dot(Nw, H), 0.0), 120.0) * 0.12;
            // Thin silhouettes (single particles at the edge) get no glints — avoids sparkly "beads".
            float edge = smoothstep(0.03, 0.12, thick);
            vec3 color = body * (1.0 - F) + refl * F * mix(0.6, 1.0, edge) + uSunColor * spec * edge * (0.3 + 0.7 * (1.0 - opacity * (1.0 - metal)));
            color += max(col - 1.0, 0.0) * 1.5 + albedo * emis;
            #ifndef GRAIN
            // Lava (incandescent, opaque, non-metallic): a dark cooling crust broken into plates by glowing cracks.
            // The hotter the melt, the thinner the crust and the wider the cracks.
            vec3 heatC = max(col - 1.0, 0.0);
            float heat = max(heatC.r, max(heatC.g, heatC.b));
            // Only where the surface is mostly rock (water touching a lava flow keeps looking like water).
            if (rockAmt > 0.8 && opacity > 0.5 && uThermal < 0.5) {
              float hot = clamp(melt, 0.0, 1.0);
              vec2 fp = Pw.xz * 7.0 + vec2(uTime * 0.02, uTime * 0.013);
              vec2 v1 = voronoi(fp), v2 = voronoi(fp * 2.3 + 5.1);
              float crack = 1.0 - smoothstep(0.0, 0.05 + 0.25 * hot, v1.y);
              float fine = 1.0 - smoothstep(0.0, 0.04 + 0.1 * hot, v2.y);
              // Molten lava glows broadly (more the hotter it is); solidified crust only shows thin glowing cracks.
              // Even very hot lava wears a thin dark skin; only cracks (wider when hotter) and torn patches blaze.
              float tear = smoothstep(0.66, 0.9, vnoise(fp * 0.35) * 0.65 + vnoise(fp * 0.9) * 0.35) * smoothstep(0.5, 1.0, hot);
              float molten = clamp(max(crack, fine * 0.45) + tear * (1.0 - crustFrac), 0.0, 1.0);
              molten *= 1.0 - crustFrac * (1.0 - crack) * 0.9;
              vec3 crustAlb = vec3(0.045, 0.036, 0.034) * (0.7 + 0.6 * v2.x);
              // Incandescent rock at 1300–1500 K glows orange-red, not yellow.
              // Incandescent rock: deep red when barely molten, orange-yellow when very hot.
              // Cold crust (stone, obsidian) has no glow left in its cracks.
              vec3 glow = mix(vec3(0.95, 0.1, 0.01), vec3(1.45, 0.36, 0.04), hot) * smoothstep(0.006, 0.15, hot) * (0.75 + 0.5 * (1.0 - v1.x));
              vec3 crust = crustAlb * (uAmbient * 1.5 + uSunColor * ndl) + refl * 0.012 + glow * 0.02 * (1.0 - v1.x);
              color = mix(crust, glow, molten);
            }
            #endif
            #ifdef GRAIN
              // Granular surface: triplanar photo-scanned grain detail, diffuse sun + sky light, real shadows.
              vec3 bw = pow(abs(Nw), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
              vec3 tp = Pw * uGrainScale;
              float gd = texture(tGrain, tp.zy).r * bw.x + texture(tGrain, tp.xz).r * bw.y + texture(tGrain, tp.xy).r * bw.z;
              vec3 nd = texture(tGrainN, tp.xz).xyz * 2.0 - 1.0;
              vec3 Nd = normalize(Nw + vec3(nd.x, 0.0, -nd.y) * 0.55 * bw.y + vec3(0.0, (texture(tGrainN, tp.zy).y * 2.0 - 1.0) * 0.4, 0.0) * (bw.x + bw.z));
              vec3 alb = albedo * (0.6 + 0.55 * gd);
              float sh = sunShadow(Pw, Nw);
              vec3 sky = uHasEnv > 0.5 ? textureCubeUV(envMap, Nd, 1.0).rgb * uEnvIntensity : uAmbient * 2.0;
              float cav = 1.0;
              // Sand scatters light between grains: wrapped diffuse, and dents mostly see the same sky as the pile around them.
              float wrapL = max(dot(Nd, uSunDir) * 0.6 + 0.4, 0.0);
              color = alb * 0.74 * (sky * cav + uSunColor * (3.0 / 3.14159) * wrapL * sh) + max(col - 1.0, 0.0) * 1.5;
            #endif
            if (uThermal > 0.5) color = col;
            // Thin edges fade into what is underneath: soft, natural puddle/meniscus borders.
            #ifdef GRAIN
              float alpha = smoothstep(0.0, 0.012, thick); // a pile's rim is opaque sand, just softly anti-aliased
            #else
              float alpha = smoothstep(0.004, 0.045, thick);
            #endif
            color = mix(texture(tScene, vUv).rgb, color, alpha);
            gl_FragColor = vec4(color, 1.0);
            vec4 clip = uProj * vec4(P, 1.0);
            gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
          }`,
      });

      this.quad = new THREE.Mesh(new THREE.BufferGeometry(), null);
      this.quad.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
      this.quad.frustumCulled = false;
      this.quadScene = new THREE.Scene();
      this.quadScene.add(this.quad);
      this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this.w = 0; this.h = 0;
    }

    resize(w, h, scale) {
      const THREE = this.T;
      this.w = w; this.h = h;
      const fw = Math.max(64, Math.round(w * scale)), fh = Math.max(64, Math.round(h * scale));
      const mk = (ww, hh, depth, count, type) => {
        const rt = new THREE.WebGLRenderTarget(ww, hh, { type: type || THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: !!depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, count: count || 1 });
        return rt;
      };
      for (const k of ['depthRT', 'blurA', 'blurB', 'thickRT', 'sceneDepthRT']) if (this[k]) this[k].dispose();
      this.depthRT = mk(fw, fh, true);
      this.blurA = mk(fw, fh); this.blurB = mk(fw, fh);
      // Linear filtering of the smoothed depth avoids blocky silhouettes when upsampling (needs float-linear support).
      const lin = this.view.renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;
      this.depthRT.texture.minFilter = this.depthRT.texture.magFilter = THREE.NearestFilter;
      this.blurA.texture.minFilter = this.blurA.texture.magFilter = THREE.NearestFilter;
      this.blurB.texture.minFilter = this.blurB.texture.magFilter = lin;
      const tw = Math.max(32, Math.round(fw * 0.6)), thh = Math.max(32, Math.round(fh * 0.6));
      this.thickRT = mk(tw, thh, false, 2, THREE.HalfFloatType);
      this.sceneDepthRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      this.fw = fw; this.fh = fh;
    }

    fs(renderer, material, target) {
      this.quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(this.quadScene, this.quadCam);
    }

    // Gathers liquid particles; returns count.
    gather(colorFn, filter) {
      const f = this.view.sim.fluid, pos = this.pos, col = this.col, prop = this.prop;
      let n = 0;
      const c = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k];
        if (!f.alive[i] || (filter ? !filter(i) : f.phase[i] !== 2)) continue;
        pos[n * 3] = f.x[i]; pos[n * 3 + 1] = f.y[i]; pos[n * 3 + 2] = f.z[i];
        colorFn(i, c);
        col[n * 4] = c[0]; col[n * 4 + 1] = c[1]; col[n * 4 + 2] = c[2]; col[n * 4 + 3] = c[3];
        prop[n * 2] = c[4]; prop[n * 2 + 1] = c[5];
        n++;
      }
      this.n = n;
      const g = this.geo;
      g.attributes.position.needsUpdate = true; g.attributes.aColor.needsUpdate = true; g.attributes.aProp.needsUpdate = true;
      g.attributes.position.updateRanges = [{ start: 0, count: n * 3 }];
      g.attributes.aColor.updateRanges = [{ start: 0, count: n * 4 }];
      g.attributes.aProp.updateRanges = [{ start: 0, count: n * 2 }];
      g.setDrawRange(0, n);
      return n;
    }

    linearizeSceneDepth(renderer, sceneRT, camera) {
      this.linMat.uniforms.tDepth.value = sceneRT.depthTexture;
      this.linMat.uniforms.uNear.value = camera.near;
      this.linMat.uniforms.uFar.value = camera.far;
      this.fs(renderer, this.linMat, this.sceneDepthRT);
    }

    // Renders liquids over sceneRT into outRT (which shares sceneRT's depth texture).
    render(renderer, camera, sceneRT, outRT, opts) {
      const THREE = this.T;
      const s = this.view.s;
      const u = this.depthMat.uniforms;
      u.uScale.value = this.fh * camera.projectionMatrix.elements[5] * 0.5;
      u.uProj.value.copy(camera.projectionMatrix);
      u.uSceneDepth.value = this.sceneDepthRT.texture;
      u.uRes.value.set(this.fw, this.fh);
      this.points.material = this.depthMat;
      const prevClear = new THREE.Color(); renderer.getClearColor(prevClear); const prevA = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.depthRT);
      renderer.clear(true, true, false);
      renderer.render(this.pointScene, camera);

      // Smooth.
      const bu = this.blurMat.uniforms;
      bu.uRadius.value = u.uRadius.value * (this.grain ? 4.5 : 3.4);
      bu.uScale.value = u.uScale.value;
      bu.uFalloff.value = this.grain ? 4.0 : 3.2;
      bu.uMaxPx.value = 24; // taps stay ≤1.5 px apart (no aliasing pattern); smoothness comes from passes
      let src = this.depthRT;
      const iters = this.grain ? 10 : Math.max(0, Math.round(s.fluidSmoothing * 1.75) | 0);
      for (let k = 0; k < iters; k++) {
        bu.tDepth.value = src.texture; bu.uDir.value.set(1 / this.fw, 0); this.fs(renderer, this.blurMat, this.blurA);
        bu.tDepth.value = this.blurA.texture; bu.uDir.value.set(0, 1 / this.fh); this.fs(renderer, this.blurMat, this.blurB);
        src = this.blurB;
      }

      // Thickness + colour (MRT, additive).
      const tu = this.thickMat.uniforms;
      tu.uRes.value.set(this.thickRT.width, this.thickRT.height);
      this.points.material = this.thickMat;
      renderer.setRenderTarget(this.thickRT);
      renderer.clear(true, false, false);
      const scale0 = u.uScale.value;
      u.uScale.value = this.thickRT.height * camera.projectionMatrix.elements[5] * 0.5;
      renderer.render(this.pointScene, camera);
      u.uScale.value = scale0;
      renderer.setClearColor(prevClear, prevA);

      // Composite: scene colour first, then shaded fluid with depth.
      this.copyMat.uniforms.tMap.value = sceneRT.texture;
      renderer.setRenderTarget(outRT);
      this.quad.material = this.copyMat;
      renderer.render(this.quadScene, this.quadCam);
      const cu = this.compMat.uniforms;
      cu.tScene.value = sceneRT.texture;
      cu.tDepth.value = src.texture;
      cu.tThick.value = this.thickRT.textures[0];
      cu.tColor.value = this.thickRT.textures[1];
      cu.tSceneDepth.value = this.sceneDepthRT.texture;
      cu.uProj.value.copy(camera.projectionMatrix);
      cu.uInvView.value.copy(camera.matrixWorld);
      cu.uView.value.copy(camera.matrixWorldInverse);
      cu.uTexel.value.set(1 / this.fw, 1 / this.fh);
      cu.uCam.value.copy(camera.position);
      cu.uTime.value = opts.time;
      cu.uRipple.value = s.ripples ? opts.ripple : 0;
      cu.uWindDir.value.copy(opts.windDir);
      cu.uSunDir.value.copy(opts.sunDir);
      cu.uSunColor.value.copy(opts.sunColor);
      cu.uAmbient.value.copy(opts.ambient);
      cu.uThermal.value = opts.thermal ? 1 : 0;
      if (this.grain) {
        cu.tGrain.value = opts.grainMap || null; cu.tGrainN.value = opts.grainNormal || null;
        const sun = opts.sun;
        if (sun && sun.castShadow && sun.shadow.map) { cu.shadowMap.value = sun.shadow.map.texture; cu.uShadowMatrix.value.copy(sun.shadow.matrix); cu.uShadowOn.value = 1; cu.uShadowTexel.value = 1 / sun.shadow.mapSize.x; }
        else cu.uShadowOn.value = 0;
      }
      if (opts.ripples) {
        const rp = opts.ripples;
        cu.tRipple.value = rp.a.texture;
        cu.uRippleBox.value.set(rp.Lx, rp.Lz, 0.9 / (2 * rp.Lx / rp.w), 1);
        cu.uRippleTexel.value.set(1 / rp.w, 1 / rp.h);
      }
      const env = opts.env;
      if (env && env.image && env.image.height) {
        const hgt = env.image.height, maxMip = Math.log2(hgt) - 2;
        const defs = this.compMat.defines;
        const tw = String(1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))), th = String(1 / hgt), mm = maxMip.toFixed(1);
        if (defs.CUBEUV_TEXEL_WIDTH !== tw || defs.CUBEUV_TEXEL_HEIGHT !== th || defs.CUBEUV_MAX_MIP !== mm) {
          defs.CUBEUV_TEXEL_WIDTH = tw; defs.CUBEUV_TEXEL_HEIGHT = th; defs.CUBEUV_MAX_MIP = mm;
          this.compMat.needsUpdate = true;
        }
        cu.envMap.value = env; cu.uHasEnv.value = 1; cu.uEnvIntensity.value = opts.envIntensity;
      } else cu.uHasEnv.value = 0;
      this.quad.material = this.compMat;
      renderer.render(this.quadScene, this.quadCam);
    }
  }

  // GPU wave equation over the whole workspace (height + velocity). Cursor strokes, floating objects,
  // splashes and raindrops add drops; the fluid shader reads its gradient as fine surface normals.
  class RippleSim {
    constructor(view) {
      const THREE = view.THREE;
      this.view = view; this.T = THREE;
      this.drops = [];
      this.resize();
      const vert = FS_VERT;
      this.updMat = new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false, uniforms: { tMap: { value: null }, uTexel: { value: new THREE.Vector2() }, uDamp: { value: 0.992 } },
        vertexShader: vert,
        fragmentShader: `uniform sampler2D tMap; uniform vec2 uTexel; uniform float uDamp; in vec2 vUv;
          void main() {
            vec4 c = texture(tMap, vUv);
            float avg = (texture(tMap, vUv + vec2(uTexel.x, 0.0)).r + texture(tMap, vUv - vec2(uTexel.x, 0.0)).r +
                         texture(tMap, vUv + vec2(0.0, uTexel.y)).r + texture(tMap, vUv - vec2(0.0, uTexel.y)).r) * 0.25;
            c.g += (avg - c.r) * 2.0;
            c.g *= uDamp;
            c.r += c.g;
            c.r *= 0.9995;
            gl_FragColor = c;
          }`,
      });
      this.dropMat = new THREE.ShaderMaterial({
        depthTest: false, depthWrite: false, uniforms: { tMap: { value: null }, uDrops: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) }, uN: { value: 0 }, uAspect: { value: 1 } },
        vertexShader: vert,
        fragmentShader: `uniform sampler2D tMap; uniform vec4 uDrops[24]; uniform int uN; uniform float uAspect; in vec2 vUv;
          void main() {
            vec4 c = texture(tMap, vUv);
            for (int i = 0; i < 24; i++) {
              if (i >= uN) break;
              vec4 d = uDrops[i];
              vec2 dv = (vUv - d.xy) * vec2(uAspect, 1.0);
              float k = max(0.0, 1.0 - length(dv) / d.z);
              k = 0.5 - cos(k * 3.14159265) * 0.5;
              c.r += k * d.w;
            }
            gl_FragColor = c;
          }`,
      });
    }
    resize() {
      const THREE = this.T, s = this.view.s;
      this.Lx = s.worldWidth + 4; this.Lz = s.worldDepth + 4;
      const res = 34; // texels per metre (~3 cm)
      const w = Math.min(2048, Math.round(this.Lx * res)), h = Math.min(1024, Math.round(this.Lz * res));
      const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
      if (this.a) { this.a.dispose(); this.b.dispose(); }
      this.a = mk(); this.b = mk();
      this.w = w; this.h = h;
    }
    // World (x, z) → uv; radius in metres; strength in metres of displacement.
    addDrop(x, z, radius, strength) {
      if (this.drops.length >= 24) return;
      this.drops.push([(x + this.Lx / 2) / this.Lx, (z + this.Lz / 2) / this.Lz, radius / this.Lz, strength]);
    }
    step(renderer, fx) {
      const swap = () => { const t = this.a; this.a = this.b; this.b = t; };
      if (this.drops.length) {
        const u = this.dropMat.uniforms;
        this.drops.forEach((d, k) => u.uDrops.value[k].set(d[0], d[1], d[2], d[3]));
        u.uN.value = this.drops.length; u.uAspect.value = this.Lx / this.Lz; u.tMap.value = this.a.texture;
        fx.fs(renderer, this.dropMat, this.b); swap();
        this.drops.length = 0;
      }
      const uu = this.updMat.uniforms;
      uu.uTexel.value.set(1 / this.w, 1 / this.h);
      for (let k = 0; k < 2; k++) { uu.tMap.value = this.a.texture; fx.fs(renderer, this.updMat, this.b); swap(); }
    }
  }

  PC.FluidFX = FluidFX;
  PC.RippleSim = RippleSim;
})(window.PC);
