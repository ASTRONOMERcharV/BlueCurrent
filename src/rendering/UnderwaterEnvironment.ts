import {
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  PMREMGenerator,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * A tiny equirectangular water gradient baked into a PMREM environment map.
 * MeshStandardMaterial needs an environment map to give PBR surfaces believable
 * specular response; without one the fish and rocks look chalky.
 */
export function createUnderwaterEnvironment(renderer: WebGLRenderer): Texture {
  const width = 64;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  const top = [0.50, 0.82, 0.82];
  const mid = [0.10, 0.38, 0.42];
  const bottom = [0.012, 0.065, 0.085];
  const sunU = 0.24;
  const sunV = 0.10;

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);                 // 0 top .. 1 bottom
    const t = Math.min(1, v * 1.35);
    let r: number;
    let g: number;
    let b: number;
    if (t < 0.5) {
      const k = t / 0.5;
      r = top[0] + (mid[0] - top[0]) * k;
      g = top[1] + (mid[1] - top[1]) * k;
      b = top[2] + (mid[2] - top[2]) * k;
    } else {
      const k = (t - 0.5) / 0.5;
      r = mid[0] + (bottom[0] - mid[0]) * k;
      g = mid[1] + (bottom[1] - mid[1]) * k;
      b = mid[2] + (bottom[2] - mid[2]) * k;
    }
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const du = Math.min(Math.abs(u - sunU), 1 - Math.abs(u - sunU));
      const dv = v - sunV;
      const sun = Math.exp(-((du / 0.10) ** 2 + (dv / 0.13) ** 2)) * 1.1;
      const index = (y * width + x) * 4;
      data[index] = Math.min(255, Math.round((r + sun) * 255));
      data[index + 1] = Math.min(255, Math.round((g + sun) * 255));
      data[index + 2] = Math.min(255, Math.round((b + sun) * 255));
      data[index + 3] = 255;
    }
  }

  const source = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  source.colorSpace = SRGBColorSpace;
  source.mapping = EquirectangularReflectionMapping;
  source.magFilter = LinearFilter;
  source.minFilter = LinearFilter;
  source.needsUpdate = true;

  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(source).texture;
  pmrem.dispose();
  source.dispose();
  return environment;
}
