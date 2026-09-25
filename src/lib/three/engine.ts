/**
 * STREET MODE — the real-time half of VICE OS.
 *
 * Renders a third-person Leonida block, drives the player and the crowd
 * through the procedural locomotion solver, and — the part that matters for
 * this project — turns the viewfinder into a camera whose output goes
 * straight into the Image Lab.
 *
 * A capture is not a screenshot. It re-renders the frame at 1080x1350, runs
 * it through a film pass, stamps it like a phone would, and works out which
 * tagged subjects (faces, plates, the tower) were actually visible and
 * unoccluded at the moment the shutter fired. That evidence list is handed to
 * VICEGRAM, so the editor session afterwards has real stakes: you know
 * exactly what is in the frame and what it will cost you if you leave it
 * there.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { createCharacter, paletteFor } from "./rig";
import { Actor, type ActorInput } from "./locomotion";
import { buildCity, resolveCollisions, type City, type EvidenceTag } from "./city";
import type { Evidence } from "../evidence";

export type Quality = "high" | "low";

export type Stats = {
  speed: number;
  heading: string;
  aiming: boolean;
  /** Tagged subjects currently framed — drives the live viewfinder readout. */
  inFrame: Evidence[];
  fps: number;
};

export type CaptureResult = {
  dataUrl: string;
  evidence: Evidence[];
  title: string;
  location: string;
};

const CAPTURE_W = 1080;
const CAPTURE_H = 1350;

const _head = new THREE.Vector3();

/** Grain + vignette + a touch of chromatic fringing, matching the 2D art. */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    amount: { value: 1 },
    alarm: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time; uniform float amount; uniform float alarm;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d,d);
      // chromatic aberration grows toward the edge of the lens
      float ca = 0.0016 * amount;
      vec4 c;
      c.r = texture2D(tDiffuse, uv + d * ca).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - d * ca).b;
      c.a = 1.0;
      // police strobe bleeding in at the edges when you're wanted
      float pulse = sin(time * 9.0);
      vec3 strobe = pulse > 0.0 ? vec3(1.0,0.15,0.12) : vec3(0.15,0.35,1.0);
      c.rgb = mix(c.rgb, c.rgb + strobe * 0.5, alarm * smoothstep(0.08, 0.32, r2));
      // vignette
      c.rgb *= 1.0 - smoothstep(0.18, 0.82, r2) * 0.55 * amount;
      // grain
      float g = hash(uv * 900.0 + fract(time) * 100.0) - 0.5;
      c.rgb += g * 0.055 * amount;
      gl_FragColor = c;
    }
  `,
};

type Ped = {
  actor: Actor;
  target: THREE.Vector3;
  wait: number;
  scared: number;
};

const SPOTS: { z: number; name: string }[] = [
  { z: -60, name: "TOWER DISTRICT" },
  { z: -20, name: "OCEAN DRIVE" },
  { z: 20, name: "LITTLE HAVANA ROW" },
  { z: 60, name: "SOUTH CAUSEWAY" },
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export class StreetEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private film: ShaderPass;
  private city: City;
  private player: Actor;
  private peds: Ped[] = [];
  private evidence: EvidenceTag[] = [];
  private raycaster = new THREE.Raycaster();

  private keys = new Set<string>();
  private stick = { x: 0, y: 0 };
  private touchLook = { x: 0, y: 0 };
  private wantJump = false;
  private dragging = false;
  private dragLast = { x: 0, y: 0 };
  private lockDenied = false;
  private aiming = false;
  private running = false;
  private heat = 0;
  private reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  private camYaw = Math.PI;
  private camPitch = 0.12;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private fov = 58;

  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private fpsAvg = 60;
  private disposed = false;
  private quality: Quality;
  private onStats: (s: Stats) => void;
  private container: HTMLElement;
  private ro: ResizeObserver | null = null;

  constructor(opts: {
    canvas: HTMLCanvasElement;
    container: HTMLElement;
    quality: Quality;
    onStats: (s: Stats) => void;
  }) {
    this.container = opts.container;
    this.quality = opts.quality;
    this.onStats = opts.onStats;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: opts.quality === "high",
      powerPreference: "high-performance",
      // The shutter reads the drawing buffer back on the same tick it renders.
      // Without this the browser is free to have already discarded it.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, opts.quality === "high" ? 1.6 : 1),
    );
    this.renderer.shadowMap.enabled = opts.quality === "high";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;

    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.1, 500);
    this.scene.add(this.camera);

    this.city = buildCity(this.scene);
    this.evidence = [...this.city.evidence];

    /* ---- the player ---- */
    const hero = createCharacter({
      height: 1.84,
      bulk: 1.03,
      palette: paletteFor(0),
    });
    this.scene.add(hero.group);
    this.player = new Actor(hero);
    this.player.teleport(4.2, 18, Math.PI);

    /* ---- the crowd ---- */
    const count = opts.quality === "high" ? 7 : 4;
    for (let i = 0; i < count; i++) {
      const c = createCharacter({
        height: 1.62 + Math.random() * 0.28,
        bulk: 0.9 + Math.random() * 0.3,
        shoulder: 0.92 + Math.random() * 0.24,
        palette: paletteFor(i + 1),
      });
      this.scene.add(c.group);
      const a = new Actor(c);
      const w = this.city.waypoints[
        Math.floor(Math.random() * this.city.waypoints.length)
      ];
      a.teleport(w.x, w.z, Math.random() * 7);
      this.peds.push({
        actor: a,
        target: this.pickWaypoint(),
        wait: 0,
        scared: 0,
      });
      this.evidence.push({
        kind: "FACE",
        label: `SUBJECT ${String.fromCharCode(65 + i)}`,
        object: c.bones.head,
        offset: new THREE.Vector3(0, 0.06, 0),
        radius: 0.16,
      });
    }

    /* ---- post ---- */
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      opts.quality === "high" ? 0.72 : 0.45,
      0.7,
      0.78,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.film);

    this.resize();
    this.snapCamera();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    opts.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  /** True once a pointer-lock request has been refused by the browser. */
  get needsDragLook() {
    return this.lockDenied;
  }

  /* ---------------- public controls ---------------- */

  start() {
    this.last = performance.now();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  setStick(x: number, y: number) {
    this.stick.x = x;
    this.stick.y = y;
  }

  /** Touch look, in screen pixels. */
  addLook(dx: number, dy: number) {
    this.touchLook.x += dx;
    this.touchLook.y += dy;
  }

  setRun(v: boolean) {
    this.running = v;
  }

  setAim(v: boolean) {
    this.aiming = v;
  }

  toggleAim() {
    this.aiming = !this.aiming;
    return this.aiming;
  }

  jump() {
    this.wantJump = true;
  }

  setHeat(h: number) {
    this.heat = h;
  }

  get isAiming() {
    return this.aiming;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    if (document.pointerLockElement) document.exitPointerLock();
    this.ro?.disconnect();
    this.city.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.composer.dispose();
    this.renderer.dispose();
  }

  /* ---------------- input plumbing ---------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") e.preventDefault();
    this.keys.add(e.code);
    if (e.code === "Space") this.wantJump = true;
    if (e.code === "KeyF") this.aiming = !this.aiming;
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  /**
   * Pointer lock is the good experience, but it is refused outright in
   * sandboxed frames and by some browsers' permission settings. When the
   * request fails we fall back to drag-to-look rather than leaving the player
   * with a camera they can't move.
   */
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (document.pointerLockElement) return;
    const canvas = e.currentTarget as HTMLCanvasElement;
    try {
      const req = canvas.requestPointerLock?.();
      if (req && typeof (req as Promise<void>).catch === "function") {
        (req as unknown as Promise<void>).catch(() => {
          this.lockDenied = true;
        });
      }
    } catch {
      this.lockDenied = true;
    }
    this.dragging = true;
    this.dragLast.x = e.clientX;
    this.dragLast.y = e.clientY;
  };

  private onPointerUp = () => {
    this.dragging = false;
  };

  private onLockChange = () => {
    if (document.pointerLockElement) this.lockDenied = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    let dx: number;
    let dy: number;
    if (document.pointerLockElement) {
      dx = e.movementX;
      dy = e.movementY;
    } else if (this.dragging) {
      // movementX/Y is unreliable outside pointer lock (a synthetic click can
      // report the whole jump from the last cursor position), so the drag
      // path tracks client coordinates itself.
      dx = e.clientX - this.dragLast.x;
      dy = e.clientY - this.dragLast.y;
      this.dragLast.x = e.clientX;
      this.dragLast.y = e.clientY;
    } else {
      return;
    }
    this.camYaw -= dx * 0.0022;
    this.camPitch = Math.max(
      -0.55,
      Math.min(0.85, this.camPitch + dy * 0.0018),
    );
  };

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- simulation ---------------- */

  private pickWaypoint() {
    const w = this.city.waypoints;
    return w[Math.floor(Math.random() * w.length)].clone();
  }

  private playerInput(): ActorInput {
    const k = this.keys;
    let ix = this.stick.x;
    let iz = this.stick.y;
    if (k.has("KeyW") || k.has("ArrowUp")) iz -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) iz += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) ix -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) ix += 1;

    // Stick is in camera space — pushing "up" means away from the camera.
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    const moveX = ix * cos - iz * sin;
    const moveZ = -ix * sin - iz * cos;

    const run =
      this.running || k.has("ShiftLeft") || k.has("ShiftRight");
    const jump = this.wantJump;
    this.wantJump = false;

    return {
      moveX,
      moveZ,
      run: run && !this.aiming,
      jump,
      aim: this.aiming ? 1 : 0,
      look: null,
      faceYaw: this.aiming ? this.camYaw : null,
    };
  }

  private stepCrowd(dt: number) {
    const p = this.player.pos;
    for (const ped of this.peds) {
      const a = ped.actor;
      const dx = ped.target.x - a.pos.x;
      const dz = ped.target.z - a.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 1.1) {
        ped.wait -= dt;
        if (ped.wait <= 0) {
          ped.target = this.pickWaypoint();
          ped.wait = 0.6 + Math.random() * 3.4;
        }
      }

      // At high heat, anyone who gets close breaks away from you.
      const toPlayer = Math.hypot(p.x - a.pos.x, p.z - a.pos.z);
      const spooked = this.heat > 40 && toPlayer < 7 + (this.heat - 40) * 0.12;
      ped.scared = spooked
        ? Math.min(1, ped.scared + dt * 2)
        : Math.max(0, ped.scared - dt * 0.8);

      let mx = 0;
      let mz = 0;
      if (ped.scared > 0.2) {
        mx = (a.pos.x - p.x) / Math.max(toPlayer, 0.01);
        mz = (a.pos.z - p.z) / Math.max(toPlayer, 0.01);
      } else if (dist > 1.1) {
        mx = dx / dist;
        mz = dz / dist;
      }

      a.update(dt, {
        moveX: mx,
        moveZ: mz,
        run: ped.scared > 0.5,
        jump: false,
        aim: 0,
        /*
         * How the city reads you, straight off the heat bar. Below 20 nobody
         * cares; from 20 heads start turning at a distance that grows with
         * your heat; past 40 they break away entirely (see `spooked`).
         */
        look:
          ped.scared > 0.2 || toPlayer < 7 + Math.max(0, this.heat - 20) * 0.18
            ? p
            : null,
      });
      resolveCollisions(a.pos, 0.32, this.city.colliders);
    }
  }

  /** Snap the rig to the player so entering the street doesn't swoop in from the world origin. */
  private snapCamera() {
    this.updateCamera(1e6);
  }

  private updateCamera(dt: number) {
    // touch look, applied on the sim thread so it damps the same as the mouse
    if (this.touchLook.x || this.touchLook.y) {
      this.camYaw -= this.touchLook.x * 0.006;
      this.camPitch = Math.max(
        -0.55,
        Math.min(0.85, this.camPitch + this.touchLook.y * 0.005),
      );
      this.touchLook.x = 0;
      this.touchLook.y = 0;
    }

    const aim = this.aiming;
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    const cp = Math.cos(this.camPitch);

    const focus = new THREE.Vector3();
    const want = new THREE.Vector3();

    if (aim) {
      // Phone up = look through the phone. A third-person rig here would put
      // the player's own shoulder through the middle of every photo.
      want.set(
        this.player.pos.x + sin * 0.22,
        this.player.pos.y + this.player.char.dims.hipY + 0.58,
        this.player.pos.z + cos * 0.22,
      );
      focus
        .copy(want)
        .add(
          new THREE.Vector3(
            sin * cp,
            -Math.sin(this.camPitch),
            cos * cp,
          ).multiplyScalar(12),
        );
    } else {
      const dist = 4.3 + Math.min(this.player.currentSpeed * 0.16, 1.1);
      focus.set(
        this.player.pos.x + cos * 0.34,
        this.player.pos.y + 1.28,
        this.player.pos.z - sin * 0.34,
      );
      want.set(
        focus.x - sin * dist * cp,
        focus.y + Math.sin(this.camPitch) * dist + 0.35,
        focus.z - cos * dist * cp,
      );

      // don't let the camera swing through a building
      const ray = want.clone().sub(focus).normalize();
      this.raycaster.set(focus, ray);
      this.raycaster.far = focus.distanceTo(want);
      const hits = this.raycaster.intersectObject(this.city.group, true);
      if (hits.length && hits[0].distance < this.raycaster.far) {
        want.copy(focus).addScaledVector(ray, Math.max(0.6, hits[0].distance - 0.3));
      }
    }

    const k = 1 - Math.exp(-(aim ? 16 : 9) * dt);
    this.camPos.lerp(want, k);
    this.camLook.lerp(focus, 1 - Math.exp(-14 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // Hide the body once the lens is inside it, rather than the instant the
    // phone goes up — otherwise it pops out from under a still-moving camera.
    const head = this.player.pos.y + this.player.char.dims.hipY + 0.58;
    this.player.char.mesh.visible =
      this.camPos.distanceTo(
        _head.set(this.player.pos.x, head, this.player.pos.z),
      ) > 1.15;

    const wantFov = aim ? 46 : 56 + Math.min(this.player.currentSpeed * 2.1, 12);
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-7 * dt));
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }

  private frame() {
    const now = performance.now();
    // Clamped so a tab that was backgrounded doesn't teleport the player
    // across the block on the first frame back.
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    this.elapsed += dt;
    this.fpsAvg = this.fpsAvg * 0.9 + (1 / Math.max(dt, 1e-4)) * 0.1;

    this.player.update(dt, this.playerInput());
    resolveCollisions(this.player.pos, 0.36, this.city.colliders);
    this.stepCrowd(dt);
    this.updateCamera(dt);
    this.city.update(this.elapsed);

    // The wanted-level strobe is the one genuinely flashing thing in here, so
    // it goes away entirely for anyone who asked for reduced motion.
    const alarm = this.reducedMotion
      ? 0
      : this.heat > 72
        ? 1
        : this.heat > 50
          ? 0.5
          : 0;
    this.film.uniforms.time.value = this.elapsed;
    this.film.uniforms.alarm.value = alarm;
    this.film.uniforms.amount.value = this.aiming ? 0.55 : 1;
    this.bloom.strength = this.aiming ? 0.5 : this.quality === "high" ? 0.72 : 0.45;

    this.composer.render();

    this.onStats({
      speed: this.player.currentSpeed,
      heading: this.headingLabel(),
      aiming: this.aiming,
      inFrame: this.framed(this.camera, 0.86),
      fps: this.fpsAvg,
    });
  }

  private headingLabel() {
    const deg = ((-this.camYaw * 180) / Math.PI + 360 * 4) % 360;
    return COMPASS[Math.round(deg / 45) % 8];
  }

  private locationLabel() {
    let best = SPOTS[0];
    for (const s of SPOTS)
      if (Math.abs(s.z - this.player.pos.z) < Math.abs(best.z - this.player.pos.z))
        best = s;
    return best.name;
  }

  /**
   * Which tagged subjects the given camera can actually see. Frustum test
   * first, then a ray to confirm nothing is standing in the way.
   */
  private framed(cam: THREE.PerspectiveCamera, edge = 1): Evidence[] {
    const out: Evidence[] = [];
    const p = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    cam.updateMatrixWorld();
    cam.matrixWorld.extractBasis(right, up, new THREE.Vector3());

    for (const tag of this.evidence) {
      tag.object.getWorldPosition(p).add(tag.offset);
      const ndc = p.clone().project(cam);
      if (ndc.z < -1 || ndc.z > 1) continue;
      if (Math.abs(ndc.x) > edge || Math.abs(ndc.y) > edge) continue;

      const d = p.distanceTo(cam.position);
      if (d > 48) continue;
      // too small in frame to identify anything
      if (tag.radius / d < 0.0035) continue;

      dir.subVectors(p, cam.position).normalize();
      this.raycaster.set(cam.position, dir);
      this.raycaster.far = d - tag.radius;
      if (this.raycaster.far > 0.2) {
        const blocked = this.raycaster.intersectObject(this.city.group, true);
        if (blocked.length) continue;
      }

      /*
       * Screen-space footprint of the detail, measured by projecting a point
       * one radius to the camera's right and one radius up. This is the
       * rectangle the forensic pass will re-read in the exported image, so it
       * has to be the subject and not much else — a little padding only.
       */
      const PAD = 1.55;
      const ex = p
        .clone()
        .addScaledVector(right, tag.radius * PAD)
        .project(cam);
      const ey = p
        .clone()
        .addScaledVector(up, tag.radius * PAD)
        .project(cam);
      const hw = Math.min(0.5, Math.max(0.02, Math.abs(ex.x - ndc.x)));
      const hh = Math.min(0.5, Math.max(0.02, Math.abs(ey.y - ndc.y)));

      const cx = (ndc.x + 1) / 2;
      const cy = (1 - ndc.y) / 2;
      const x0 = Math.max(0, cx - hw);
      const y0 = Math.max(0, cy - hh);

      out.push({
        kind: tag.kind,
        label: tag.label,
        box: {
          x: x0,
          y: y0,
          w: Math.min(1 - x0, hw * 2),
          h: Math.min(1 - y0, hh * 2),
        },
      });
    }
    return out;
  }

  /* ---------------- the shutter ---------------- */

  capture(): CaptureResult {
    const prevRatio = this.renderer.getPixelRatio();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CAPTURE_W, CAPTURE_H, false);
    this.composer.setSize(CAPTURE_W, CAPTURE_H);
    this.camera.aspect = CAPTURE_W / CAPTURE_H;
    this.camera.updateProjectionMatrix();

    // a photo shouldn't carry the HUD's strobe or heavy vignette
    const amt = this.film.uniforms.amount.value;
    const alarm = this.film.uniforms.alarm.value;
    this.film.uniforms.amount.value = 0.45;
    this.film.uniforms.alarm.value = 0;

    this.composer.render();
    const evidence = this.framed(this.camera, 0.96);
    const raw = this.renderer.domElement.toDataURL("image/jpeg", 0.92);

    this.film.uniforms.amount.value = amt;
    this.film.uniforms.alarm.value = alarm;
    this.renderer.setPixelRatio(prevRatio);
    this.resize();

    const location = this.locationLabel();
    return {
      dataUrl: raw,
      evidence,
      title: `${location}, ${stampTime()}`,
      location,
    };
  }
}

function stampTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Finishes a capture the way the phone would: a little softening at the
 * edges, a date stamp, and the geotag you probably should have turned off.
 */
export function developPhoto(
  raw: string,
  label: string,
  location: string,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = CAPTURE_W;
      cv.height = CAPTURE_H;
      const c = cv.getContext("2d");
      if (!c) return resolve(raw);
      c.drawImage(img, 0, 0, CAPTURE_W, CAPTURE_H);

      const g = c.createRadialGradient(
        CAPTURE_W / 2,
        CAPTURE_H / 2,
        CAPTURE_W * 0.3,
        CAPTURE_W / 2,
        CAPTURE_H / 2,
        CAPTURE_W * 0.85,
      );
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.42)");
      c.fillStyle = g;
      c.fillRect(0, 0, CAPTURE_W, CAPTURE_H);

      c.font = "600 30px ui-monospace, monospace";
      c.fillStyle = "rgba(255,179,71,0.92)";
      c.textAlign = "left";
      c.fillText(label.toUpperCase(), 44, CAPTURE_H - 84);
      c.font = "600 24px ui-monospace, monospace";
      c.fillStyle = "rgba(255,255,255,0.6)";
      c.fillText(
        `GEO ${location} · VICE OS CAM · ${new Date().toLocaleDateString()}`,
        44,
        CAPTURE_H - 48,
      );

      resolve(cv.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}
