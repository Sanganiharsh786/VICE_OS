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
import {
  buildCity,
  resolveCollisions,
  type City,
  type EvidenceTag,
} from "./city";
import { LANDMARK_SPOTS, districtAt, placeName, surfaceAt } from "./world/layout";
import { sfx } from "../audio";
import type { Evidence } from "../evidence";

export type Quality = "high" | "low";

export type CameraMode = "shoulder" | "wide" | "cinematic";

export type Stats = {
  speed: number;
  heading: string;
  aiming: boolean;
  /** Tagged subjects currently framed — drives the live viewfinder readout. */
  inFrame: Evidence[];
  fps: number;
  /** Where in Leonida the player is standing. */
  place: string;
  district: string;
  /** World position, for the minimap. */
  x: number;
  z: number;
  /** Which way the camera faces, radians — rotates the minimap. */
  camYaw: number;
  camera: CameraMode;
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
const _ray = new THREE.Vector3();
/** Roof height of whatever traffic the camera boom last ran into. */
const _carHit = { top: 0 };

/**
 * Height below which the third-person camera does not treat geometry as a wall.
 *
 * Street furniture, parked cars, palms and bus shelters are all shorter than
 * this: the lens passing through a hedge for a moment is nothing, being yanked
 * onto the player's shoulder every time they walk past a parked car is awful.
 * Anything that reads as an actual wall — buildings, lamp columns, containers,
 * the landmarks — stands well above it.
 *
 * This replaces the old trick of giving those props deliberately short
 * colliders to stay under the ray's threshold, which made them dishonest to
 * the jump as well as to the camera.
 */
const CAMERA_CLEAR = 2.6;

/**
 * Third-person framings. `dist` is how far the lens sits behind the player,
 * `focusY` how high it looks, `lift` how much it rides above the pivot.
 */
const CAMERA_MODES: Record<
  CameraMode,
  {
    dist: number;
    focusY: number;
    shoulder: number;
    lift: number;
    fov: number;
    speedPull: number;
    maxPull: number;
  }
> = {
  // close enough to read a face, far enough to see the far pavement
  shoulder: { dist: 6.2, focusY: 1.5, shoulder: 0.5, lift: 0.9, fov: 60, speedPull: 0.3, maxPull: 2.2 },
  // the default for actually looking at the city
  wide: { dist: 10.5, focusY: 2.1, shoulder: 0.2, lift: 2.4, fov: 66, speedPull: 0.42, maxPull: 3.6 },
  // up where you can see the skyline over the rooftops
  cinematic: { dist: 17, focusY: 3.0, shoulder: 0, lift: 6.5, fov: 70, speedPull: 0.5, maxPull: 5 },
};

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
  /** Seconds spent trying to walk and getting nowhere. */
  stuck: number;
  lastX: number;
  lastZ: number;
};

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Keys the browser would otherwise use to scroll the page out from under us. */
const NO_SCROLL = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** Things the engine wants the UI to know about the moment they happen. */
export type EngineEvent =
  | { kind: "travel"; place: string }
  | { kind: "camera"; camera: CameraMode };

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
  /** How far the boom is craned up to see over traffic crossing behind. */
  private camRise = 0;
  /** Height the lens is riding above the rig to clear a vehicle it is inside. */
  private camLift = 0;
  private fov = 58;
  private camMode: CameraMode = "shoulder";
  /** Extra yaw from the keyboard turn keys, applied per frame. */
  private turnKey = 0;
  private travelIdx = 0;
  private onEvent: (e: EngineEvent) => void = () => {};

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
    this.renderer.toneMappingExposure = 1.02;

    // The far plane has to clear the skyline ring and the sky dome, three and
    // four kilometres out — this is what lets the city read as continuing past
    // the playable grid instead of ending at a wall of fog.
    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.2, 9000);
    this.scene.add(this.camera);

    this.city = buildCity(this.scene, opts.quality);
    this.evidence = [...this.city.evidence];

    /* ---- the player ---- */
    const hero = createCharacter({
      height: 1.84,
      bulk: 1.03,
      palette: paletteFor(0),
    });
    this.scene.add(hero.group);
    this.player = new Actor(hero);
    // The player can end up on a kerb, a bench or the roof of a car; the crowd
    // only ever walks the pavement, so traffic is left out of their probe.
    this.player.setGroundProbe((x, z, top) => this.city.groundAt(x, z, top));
    /*
     * Footsteps come straight off the gait solver's heel strike rather than a
     * timer, so they stay locked to the feet at every speed, and the surface
     * is read at the foot rather than at the pelvis — which is the difference
     * between the sand starting when you cross the kerb and when your shoulder
     * does. The crowd is deliberately silent: seven people walking in step
     * with you is a much worse artefact than a quiet street.
     */
    this.player.onFootstep((_foot, pos, speed) => {
      sfx.footstep(surfaceAt(pos.x, pos.z, this.player.pos.y), speed);
    });
    this.player.teleport(this.city.spawn.x, this.city.spawn.z, this.city.spawn.yaw);
    this.camYaw = this.city.spawn.yaw;

    /*
     * The rigged crowd. These are the expensive ones — skinned meshes running
     * the full IK gait solve — so there are only a handful and they are kept
     * near the player, where the lens can actually identify a face. Density
     * everywhere else is the instanced crowd inside the city.
     */
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
      a.setGroundProbe((x, z, top) => this.city.walkableAt(x, z, top));
      const w = this.pickWaypoint(true);
      a.teleport(w.x, w.z, Math.random() * 7);
      this.peds.push({
        actor: a,
        target: this.pickWaypoint(),
        wait: 0,
        scared: 0,
        stuck: 0,
        lastX: a.pos.x,
        lastZ: a.pos.z,
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
      opts.quality === "high" ? 0.42 : 0.28,
      0.7,
      0.9,
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

  /**
   * Full keyboard. Everything the mouse can do has a key, because on a laptop
   * trackpad the drag-look is the worst part of the experience and the turn
   * keys let you play without ever touching it.
   *
   *   W A S D / arrows  walk          Shift  sprint      Space  jump
   *   Q E               turn camera   R F    look up/down
   *   C                 camera mode   F      raise the phone
   *   T                 fast travel   1-9    jump to a landmark
   *   X                 back to spawn
   */
  private onKeyDown = (e: KeyboardEvent) => {
    // don't steal keys from the editor, the caption box or anything focused
    const el = document.activeElement;
    if (
      el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        (el as HTMLElement).isContentEditable)
    )
      return;

    if (NO_SCROLL.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);

    /*
     * Movement is matched on `code`, because WASD is a shape on the keyboard
     * rather than four letters — it has to stay in the same place on AZERTY.
     * The action keys below match either, so they still work on a layout where
     * the physical KeyH is somewhere else entirely.
     */
    const ch = e.key.length === 1 ? e.key.toLowerCase() : "";
    const is = (code: string, letter: string) => e.code === code || ch === letter;

    if (e.code === "Space") this.wantJump = true;
    else if (is("KeyF", "f")) this.aiming = !this.aiming;
    else if (is("KeyC", "c")) this.cycleCameraMode();
    else if (is("KeyT", "t")) {
      this.travelIdx = (this.travelIdx + 1) % LANDMARK_SPOTS.length;
      this.travelTo(this.travelIdx);
    } else if (is("KeyX", "x")) {
      this.player.teleport(
        this.city.spawn.x,
        this.city.spawn.z,
        this.city.spawn.yaw,
      );
      this.camYaw = this.city.spawn.yaw;
      this.snapCamera();
    } else if (/^[1-9]$/.test(ch)) {
      this.travelIdx = Number(ch) - 1;
      this.travelTo(this.travelIdx);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

  cycleCameraMode() {
    const order: CameraMode[] = ["shoulder", "wide", "cinematic"];
    this.camMode = order[(order.indexOf(this.camMode) + 1) % order.length];
    this.onEvent({ kind: "camera", camera: this.camMode });
    return this.camMode;
  }

  /** Drops the player at a named place. A kilometre of city needs this. */
  travelTo(n: number) {
    const spot = LANDMARK_SPOTS[((n % LANDMARK_SPOTS.length) + LANDMARK_SPOTS.length) % LANDMARK_SPOTS.length];
    if (!spot) return;
    this.travelIdx = LANDMARK_SPOTS.indexOf(spot);
    this.player.teleport(spot.x, spot.z, this.camYaw);
    resolveCollisions(this.player.pos, 0.36, this.city.grid, this.player.clearTop);
    // pull the rigged crowd along so the new district isn't deserted
    for (const ped of this.peds) {
      const w = this.pickWaypoint(true);
      ped.actor.teleport(w.x, w.z, Math.random() * 7);
      ped.target = this.pickWaypoint();
    }
    this.snapCamera();
    this.onEvent({ kind: "travel", place: spot.name });
  }

  setEventSink(fn: (e: EngineEvent) => void) {
    this.onEvent = fn;
  }

  setCamera(mode: CameraMode) {
    this.camMode = mode;
  }

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

  /**
   * A pavement node, biased to the player's neighbourhood. The walk graph
   * spans the whole kilometre of city, so an unbiased pick would scatter the
   * seven expensive rigged pedestrians across districts the player will never
   * visit.
   */
  private pickWaypoint(close = false) {
    const w = this.city.waypoints;
    const p = this.player?.pos;
    const max = close ? 55 : 95;
    if (p) {
      for (let t = 0; t < 40; t++) {
        const n = w[Math.floor(Math.random() * w.length)];
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d > 6 && d < max) return n.clone();
      }
    }
    return w[Math.floor(Math.random() * w.length)].clone();
  }

  private playerInput(dt: number): ActorInput {
    const k = this.keys;
    let ix = this.stick.x;
    let iz = this.stick.y;
    if (k.has("KeyW") || k.has("ArrowUp")) iz -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) iz += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) ix -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) ix += 1;

    // keyboard look, for anyone who never wants to drag the mouse
    this.turnKey = 0;
    if (k.has("KeyQ")) this.turnKey += 1;
    if (k.has("KeyE")) this.turnKey -= 1;
    if (this.turnKey) this.camYaw += this.turnKey * 2.1 * dt;
    if (k.has("KeyR") || k.has("KeyV")) {
      const s = k.has("KeyR") ? -1 : 1;
      this.camPitch = Math.max(-0.6, Math.min(0.9, this.camPitch + s * 1.2 * dt));
    }

    /*
     * Camera-relative movement.
     *
     * The camera looks along F = (sin(camYaw), cos(camYaw)), so its right-hand
     * vector — the screen-right direction — is F x up = (-cos, sin). This used
     * to be written as (+cos, -sin), which is the same axis pointing the wrong
     * way: A and D, and the left and right arrows, drove the player in the
     * opposite direction to the one the key says. Both sign flips below are
     * that fix.
     */
    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    const moveX = -ix * cos - iz * sin;
    const moveZ = ix * sin - iz * cos;

    const run = this.running || k.has("ShiftLeft") || k.has("ShiftRight");
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

      // The city is a kilometre across and these seven are the only rigged
      // faces in it, so they get re-homed rather than left behind.
      if (Math.hypot(p.x - a.pos.x, p.z - a.pos.z) > 130) {
        const w = this.pickWaypoint(true);
        a.teleport(w.x, w.z, Math.random() * 7);
        ped.target = this.pickWaypoint();
        ped.scared = 0;
        continue;
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
      resolveCollisions(a.pos, 0.32, this.city.grid, a.clearTop);

      /*
       * The pavement furniture sits on the same line as the walk nodes, and
       * these pedestrians steer straight at their target with no avoidance. A
       * bench they happen to line up with would otherwise hold one of them
       * against it forever, so a walker that stops making ground picks
       * somewhere else to be.
       */
      const made = Math.hypot(a.pos.x - ped.lastX, a.pos.z - ped.lastZ);
      ped.lastX = a.pos.x;
      ped.lastZ = a.pos.z;
      if ((mx || mz) && made < 0.35 * dt) {
        ped.stuck += dt;
        if (ped.stuck > 1.2) {
          ped.target = this.pickWaypoint();
          ped.stuck = 0;
        }
      } else {
        ped.stuck = 0;
      }
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
      /*
       * The phone flattens whatever pitch the third-person camera was holding.
       * That camera rides above the player and therefore looks slightly down;
       * carrying that angle into the viewfinder put three quarters of tarmac
       * in every 4:5 photo, which is not what anyone frames.
       */
      const aimPitch = this.camPitch * 0.4 - 0.02;
      focus
        .copy(want)
        .add(
          new THREE.Vector3(
            sin * Math.cos(aimPitch),
            -Math.sin(aimPitch),
            cos * Math.cos(aimPitch),
          ).multiplyScalar(12),
        );
    } else {
      /*
       * Camera framing is what decides whether a city reads as big. The old
       * rig sat 4.3m behind the player's shoulder at head height, which put a
       * wall of building across the top of the frame and cropped the street
       * off at twenty metres — the single biggest reason the old block felt
       * like a corridor. Every mode here is further back and higher, and the
       * shoulder offset is small enough that the player isn't in the way.
       */
      const m = CAMERA_MODES[this.camMode];
      const dist =
        m.dist + Math.min(this.player.currentSpeed * m.speedPull, m.maxPull);
      focus.set(
        this.player.pos.x + cos * m.shoulder,
        this.player.pos.y + m.focusY,
        this.player.pos.z - sin * m.shoulder,
      );
      want.set(
        focus.x - sin * dist * cp,
        focus.y + Math.sin(this.camPitch) * dist + m.lift,
        focus.z - cos * dist * cp,
      );

      /*
       * Traffic needs the opposite answer to a wall, because it is a different
       * shape of problem.
       *
       * A building is taller than the boom can ever climb, so the only way
       * past it is to come in. A vehicle is two to four metres of box sitting
       * on a road the lens is already looking over — craning up until the
       * boom clears its roof keeps the entire shot, where coming in would jam
       * the lens against the player's back for as long as the thing takes to
       * pass, and a bus is eleven metres long. That is how the frame ended up
       * as a black slab: the rig had no answer for traffic at all, so an
       * articulated truck drove straight through the lens.
       *
       * The maths: the boom is a straight line from `focus` to `want` and the
       * blocker sits a known fraction `t` along it, so raising the far end by
       * R lifts the line at the blocker by t*R. Solve for the R that puts it
       * over the roof. A blocker very close to the player needs an absurd R —
       * that is capped, and past the cap we let the wall test below pull in,
       * which is what used to happen in every case.
       *
       * `want` is probed before it is raised, deliberately. Probing the raised
       * boom would report the road clear the moment the crane worked, drop the
       * rig back into the bus, and buzz at frame rate.
       */
      const reach = focus.distanceTo(want);
      const carHit = this.city.vehicleHit(focus, want, CAMERA_CLEAR, _carHit);
      let rise = 0;
      if (carHit >= 0 && carHit < reach) {
        const t = Math.max(carHit / reach, 1e-3);
        rise = Math.min(
          Math.max((_carHit.top + 0.55 - focus.y) / t + focus.y - want.y, 0),
          dist * 0.9,
        );
      }
      /*
       * Rate-limited rather than damped. A bus entering the boom — or the
       * traffic sim recycling one into it, which happens without warning —
       * steps this target from nothing to several metres between one frame
       * and the next, and an exponential chase turns that into a visible pop.
       * A ceiling in metres per second turns the same event into a crane.
       * Up faster than down, so the rig commits quickly and settles back
       * slowly rather than dropping the moment the tail clears. Anything that
       * outruns the crane is caught by the lift further down.
       */
      const rate = (rise > this.camRise ? 9 : 2.4) * dt;
      this.camRise += THREE.MathUtils.clamp(rise - this.camRise, -rate, rate);
      want.y += this.camRise;

      /*
       * Then the walls. This used to be a full-scene raycast, which at forty
       * objects was fine and at four thousand was the most expensive thing in
       * the frame — it is now a slab test against the collision grid, which
       * touches maybe a dozen boxes. It still asks the traffic sim too, for
       * whatever the crane above could not clear.
       */
      const hit = this.city.rayHit(focus, want, CAMERA_CLEAR);
      if (hit >= 0 && hit < focus.distanceTo(want)) {
        // the direction has to be taken before `want` is overwritten — doing it
        // inline collapses the camera onto its own look target
        _ray.copy(want).sub(focus).normalize();
        want.copy(focus).addScaledVector(_ray, Math.max(1.4, hit - 0.35));
      }
      // never let the lens end up under the pavement
      want.y = Math.max(want.y, this.player.pos.y + 0.7);
    }

    // Not the lever to reach for when something is arriving too fast: `want`
    // steps discontinuously the moment a pull-in engages, so winding this up
    // puts a jolt on every wall in the city. The crane above moves a
    // continuous quantity, which is why it can afford to be quick.
    const k = 1 - Math.exp(-(aim ? 16 : 9) * dt);
    this.camPos.lerp(want, k);
    this.camLook.lerp(focus, 1 - Math.exp(-14 * dt));

    /*
     * Last resort. Pulling in is the graceful fix, but it has a floor: at
     * 1.4m behind the player there is nowhere left to retreat to, and traffic
     * can cross into that gap faster than any damped rig can vacate it. When
     * the lens ends up inside a vehicle anyway, ride over its roof instead —
     * a high angle reads as a camera move, a black screen reads as a bug.
     *
     * It is held outside `camPos` so the rig underneath is untouched: the
     * lift goes up immediately (a frame spent inside a bus is a frame of
     * black) and eases back down over about half a second once the road is
     * clear, rather than dropping the moment the bumper passes.
     */
    const roof = aim ? -1 : this.city.vehicleRoofAt(this.camPos, 0.5);
    const need = roof > 0 ? roof + 0.6 - this.camPos.y : 0;
    /*
     * Fast, but not instant. The half-metre of padding in the test above is
     * headroom bought exactly so this can take a few frames without any of
     * the vehicle reaching the lens — and teleporting the lens a metre
     * upward in one frame is more jarring than the thing it is avoiding.
     */
    this.camLift = Math.min(
      Math.max(need, this.camLift * Math.exp(-2.5 * dt)),
      this.camLift + 14 * dt,
    );

    this.camera.position.copy(this.camPos);
    this.camera.position.y += this.camLift;
    this.camera.lookAt(this.camLook);

    // Hide the body once the lens is inside it, rather than the instant the
    // phone goes up — otherwise it pops out from under a still-moving camera.
    const head = this.player.pos.y + this.player.char.dims.hipY + 0.58;
    this.player.char.mesh.visible =
      this.camera.position.distanceTo(
        _head.set(this.player.pos.x, head, this.player.pos.z),
      ) > 1.15;

    const wantFov = aim
      ? 46
      : CAMERA_MODES[this.camMode].fov +
        Math.min(this.player.currentSpeed * 2.1, 12);
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

    this.player.update(dt, this.playerInput(dt));
    /*
     * Walls first, then vehicles, then walls again — so a bus that has pulled
     * up against you can't shove you through a shopfront.
     */
    const clear = this.player.clearTop;
    resolveCollisions(this.player.pos, 0.36, this.city.grid, clear);
    this.city.resolveVehicles(this.player.pos, 0.36, clear);
    resolveCollisions(this.player.pos, 0.36, this.city.grid, clear);
    this.stepCrowd(dt);
    this.updateCamera(dt);
    this.city.update(dt, this.elapsed, {
      x: this.player.pos.x,
      z: this.player.pos.z,
      heat: this.heat,
    });

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

    const p = this.player.pos;
    this.onStats({
      speed: this.player.currentSpeed,
      heading: this.headingLabel(),
      aiming: this.aiming,
      inFrame: this.framed(this.camera, 0.86),
      fps: this.fpsAvg,
      place: placeName(p.x, p.z),
      district: districtAt(p.x, p.z).name,
      x: p.x,
      z: p.z,
      camYaw: this.camYaw,
      camera: this.camMode,
    });
  }

  private headingLabel() {
    const deg = ((-this.camYaw * 180) / Math.PI + 360 * 4) % 360;
    return COMPASS[Math.round(deg / 45) % 8];
  }

  private locationLabel() {
    return placeName(this.player.pos.x, this.player.pos.z);
  }

  /**
   * Which tagged subjects the given camera can actually see. Frustum test
   * first, then a ray to confirm nothing is standing in the way.
   */
  private framed(cam: THREE.PerspectiveCamera, edge = 1): Evidence[] {
    const out: Evidence[] = [];
    const p = new THREE.Vector3();
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

      // Is anything standing in the way? Same slab test the camera uses —
      // a full-scene raycast per tag per frame is not affordable at this scale.
      if (d - tag.radius > 0.4 && this.city.blocked(cam.position, p)) continue;

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
