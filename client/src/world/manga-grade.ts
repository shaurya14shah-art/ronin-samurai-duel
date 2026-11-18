import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Vagabond Manga Post: cinematic grade — inky vignette, film grain,
 *  chromatic aberration, cool desaturated night palette, damage & deflect flashes.
 *  Directly inspired by GLM realism sample.
 * ------------------------------------------------------------------ */

export const MangaGradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.15 },
    uGrain: { value: 0.025 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uFocus: { value: 0 },
    uSat: { value: 0.82 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uDamage, uFlash, uFocus, uSat;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // Linear HDR in (OutputPass tone-maps afterwards): keep everything finite and positive.
      vec3 col = max(texture2D(tDiffuse, uv).rgb, vec3(0.0));

      // Restrained grade: a little desaturation, cool shadows, warm highlights.
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uSat);
      col *= mix(vec3(0.9, 0.96, 1.06), vec3(1.05, 1.01, 0.95), smoothstep(0.05, 0.9, lum));

      // Vignette
      float v = 1.0 - smoothstep(0.22, 0.95, r2 * uVignette * 2.0);
      col *= mix(0.45, 1.0, v);

      // Damage: dark red creeping from the edges
      if (uDamage > 0.001) {
        float edge = smoothstep(0.02, 0.42, r2);
        col = mix(col, vec3(0.25, 0.015, 0.02), edge * uDamage * 0.8);
      }

      // Parry / clash flash
      col += vec3(0.85, 0.95, 1.1) * uFlash * 0.6 * (0.35 + 0.65 * (1.0 - r2 * 2.0));

      // Fine film grain
      float g = hash(uv * vec2(1920.0, 1080.0) + uTime);
      col += (g - 0.5) * uGrain * (0.3 + lum);

      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `,
};
