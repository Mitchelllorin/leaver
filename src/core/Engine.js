import * as THREE from 'three';
import { settings } from './Settings.js';
import { bus } from './EventBus.js';
import { FloatingOrigin } from './FloatingOrigin.js';

/**
 * Engine owns the renderer, the scene graph root, the camera and the frame
 * loop. It knows nothing about planets — systems register `update(dt)` callbacks.
 */
export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.get('quality') !== 'low',
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true, // mandatory: true scale spans 10^10
      stencil: false,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, settings.get('quality') === 'high' ? 2 : 1.5)
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    /** Root group. All bodies are direct children (flat) so the floating origin
     *  can rebase transforms without parent-chain complications. */
    this.world = new THREE.Group();
    this.world.name = 'world';
    this.scene.add(this.world);

    this.camera = new THREE.PerspectiveCamera(
      settings.get('fov'),
      1,
      0.001,
      2e7
    );
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);

    this.origin = new FloatingOrigin();

    /** @type {Array<{name:string, update:(dt:number, ctx:object)=>void, priority?:number}>} */
    this.systems = [];

    this.clock = new THREE.Clock();
    this.elapsed = 0;         // real seconds since boot
    this.simTime = 0;         // simulated days since J2000
    this.frame = 0;
    this._fpsSamples = [];
    this.fps = 0;
    this._running = false;
    /** Optional render override (post-processing). Set by PostFX. */
    this.postRender = null;

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();
  }

  /** Register a per-frame system. Lower priority runs first. */
  addSystem(system) {
    this.systems.push(system);
    this.systems.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return system;
  }

  removeSystem(system) {
    this.systems = this.systems.filter((s) => s !== system);
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this.renderer.setAnimationLoop(() => this._tick());
  }

  stop() {
    this._running = false;
    /** Optional render override (post-processing). Set by PostFX. */
    this.postRender = null;
    this.renderer.setAnimationLoop(null);
  }

  _tick() {
    // Cap dt so tab-switches don't teleport the ship across the system.
    const raw = Math.min(this.clock.getDelta(), 0.1);
    // Reduced motion: keep physics polite rather than literally freezing.
    const dt = settings.get('reducedMotion') ? Math.min(raw, 0.033) : raw;
    this.elapsed += dt;
    this.frame++;

    if (!settings.get('paused')) {
      this.simTime += (dt * settings.get('timeScale')) / 86400;
    }

    const ctx = {
      engine: this,
      dt,
      realDt: raw,
      simTime: this.simTime,
      camera: this.camera,
      origin: this.origin,
    };

    for (const system of this.systems) {
      try {
        system.update(dt, ctx);
      } catch (err) {
        console.error(`[engine] system "${system.name}" failed:`, err);
        // A broken module must not take the whole sim down.
        this.removeSystem(system);
      }
    }

    this.origin.update();
    if (this.postRender) this.postRender();
    else this.renderer.render(this.scene, this.camera);

    this._trackFps(raw);
  }

  _trackFps(raw) {
    this._fpsSamples.push(raw);
    if (this._fpsSamples.length > 60) this._fpsSamples.shift();
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    this.fps = avg > 0 ? 1 / avg : 0;
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
