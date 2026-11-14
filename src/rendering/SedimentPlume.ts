import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  Scene,
  ShaderMaterial,
} from 'three';
import type { SedimentField } from '../environment/SedimentField';

/**
 * One-draw renderer for the Phase E4 sediment pool. It only copies the field's
 * already-computed particles into GPU attributes; no simulation reads or writes.
 */
export class SedimentPlume {
  private readonly points: Points;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly geometry: BufferGeometry;
  private visible = true;

  constructor(scene: Scene, capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.alphas = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity);
    this.geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(this.positions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    const alphaAttribute = new BufferAttribute(this.alphas, 1);
    alphaAttribute.setUsage(DynamicDrawUsage);
    const sizeAttribute = new BufferAttribute(this.sizes, 1);
    sizeAttribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttribute);
    this.geometry.setAttribute('aAlpha', alphaAttribute);
    this.geometry.setAttribute('aSize', sizeAttribute);
    const material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(0xb9a27c) } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * 620.0 / max(1.0, -mv.z);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 centered = gl_PointCoord - vec2(0.5);
          float distanceSquared = dot(centered, centered);
          if (distanceSquared > 0.25) discard;
          float soft = smoothstep(0.25, 0.0, distanceSquared);
          gl_FragColor = vec4(uColor, vAlpha * soft * 0.45);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = false;
    scene.add(this.points);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.points.visible = visible;
  }

  update(field: SedimentField): void {
    if (!this.visible) return;
    const capacity = Math.min(field.capacity, this.alphas.length);
    for (let index = 0; index < capacity; index += 1) {
      const offset = index * 3;
      const active = field.alive[index] !== 0;
      this.positions[offset] = active ? field.positions[offset] : 0;
      this.positions[offset + 1] = active ? field.positions[offset + 1] : 0;
      this.positions[offset + 2] = active ? field.positions[offset + 2] : 0;
      this.alphas[index] = active ? field.alpha[index] : 0;
      this.sizes[index] = active ? field.sizes[index] : 0;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aAlpha').needsUpdate = true;
    this.geometry.getAttribute('aSize').needsUpdate = true;
  }

  get object(): Points {
    return this.points;
  }
}
