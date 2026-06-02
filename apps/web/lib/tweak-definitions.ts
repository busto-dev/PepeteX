export interface TweakCategoryDefinition {
  key: string;
  label: string;
  options: string[];
}

export const TWEAK_CATEGORY_DEFINITIONS: TweakCategoryDefinition[] = [
  { key: 'color_scheme', label: 'Color Scheme', options: ['warm', 'cool', 'neutral', 'vibrant', 'monochrome'] },
  { key: 'spacing_scale', label: 'Spacing Scale', options: ['compact', 'balanced', 'spacious'] },
  { key: 'headline_tone', label: 'Headline Tone', options: ['bold', 'clean', 'serif', 'playful'] },
  { key: 'visual_density', label: 'Visual Density', options: ['minimal', 'balanced', 'rich'] },
  { key: 'border_radius', label: 'Border Radius', options: ['sharp', 'subtle', 'rounded', 'pill'] },
  { key: 'shadow_intensity', label: 'Shadow Intensity', options: ['flat', 'subtle', 'medium', 'strong'] },
  { key: 'background_style', label: 'Background Style', options: ['solid', 'gradient', 'textured'] },
  { key: 'image_style', label: 'Image Style', options: ['photographic', 'illustrated', 'abstract'] },
  { key: 'chart_style', label: 'Chart Style', options: ['minimal', 'business', 'colorful'] },
  { key: 'typography_mood', label: 'Typography Mood', options: ['modern', 'classic', 'editorial', 'friendly'] },
  { key: 'formality', label: 'Formality', options: ['casual', 'professional', 'executive'] },
  { key: 'brand_strictness', label: 'Brand Strictness', options: ['flexible', 'guided', 'strict'] },
  { key: 'content_density', label: 'Content Density', options: ['concise', 'balanced', 'detailed'] }
] as const;
