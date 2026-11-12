/** @deprecated Use UnderwaterMedium.ts. Kept for existing preview/import compatibility. */
export {
  installUnderwaterMedium as installUnderwaterScattering,
  isUnderwaterMediumInstalled as isUnderwaterScatteringInstalled,
} from './UnderwaterMedium';
export { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';
import { UNDERWATER_LIGHTING_CONFIG } from './lighting/UnderwaterLightingConfig';

export const UNDERWATER_WATER_COLOR = UNDERWATER_LIGHTING_CONFIG.water.color;
export const UNDERWATER_FOG_DENSITY = UNDERWATER_LIGHTING_CONFIG.water.fogDensity;
