import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { settings } from '../core/Settings.js';
import { bus } from '../core/EventBus.js';

/**
 * Bloom.
 *
 * A star, a comet tail and a sunlit ice moon are all genuinely brighter than
 * a monitor can show, and the way a camera renders that is spill. Bloom is the
 * single biggest contributor to the "splendor" half of this project.
 *
 * It is optional and failure-tolerant: if the post-processing chain cannot be
 * built (old driver, no float render targets), the sim quietly falls back to
 * direct rendering rather than showing a black screen.
 */
export class PostFX {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.composer = null;
    this._unsubscribe = bus.on('settings:change', (e) => {
      if (e.key === 'bloom' || e.key === '*' || e.key === 'quality') this.apply();
    });
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.apply();
  }

  apply() {
    const want = settings.get('bloom') && settings.get('quality') !== 'low';
    if (want && !this.composer) this._build();
    const on = want && !!this.composer;
    this.enabled = on;
    // Steer the engine's render call through the composer when it is live.
    this.engine.postRender = on ? () => this.render() : null;
  }

  _build() {
    try {
      const { renderer, scene, camera } = this.engine;
      const size = new THREE.Vector2();
      renderer.getSize(size);
      const composer = new EffectComposer(renderer);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.x, size.y);

      this.renderPass = new RenderPass(scene, camera);
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        BLOOM.strength,
        BLOOM.radius,
        BLOOM.threshold
      );
      composer.addPass(this.renderPass);
      composer.addPass(this.bloomPass);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch (err) {
      console.warn('[postfx] bloom unavailable, rendering directly:', err);
      this.composer = null;
    }
  }

  resize() {
    if (!this.composer) return;
    const size = new THREE.Vector2();
    this.engine.renderer.getSize(size);
    this.composer.setSize(size.x, size.y);
    this.bloomPass?.setSize?.(size.x, size.y);
  }

  render() {
    // Surface mode swaps the scene out from under us; keep the pass pointed at
    // whatever the engine is currently rendering.
    if (this.renderPass.scene !== this.engine.scene) {
      this.renderPass.scene = this.engine.scene;
    }
    this.renderPass.camera = this.engine.camera;
    this.composer.render();
  }

  dispose() {
    this._unsubscribe();
    window.removeEventListener('resize', this._onResize);
    this.composer?.dispose?.();
    this.engine.postRender = null;
  }
}

// Tuned so bright objects spill without turning the whole frame to soup.
const BLOOM = {
  strength: 0.72,
  radius: 0.85,
  threshold: 0.82,
};
