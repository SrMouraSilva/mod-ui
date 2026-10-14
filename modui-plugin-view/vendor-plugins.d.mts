import type { Plugin } from 'esbuild';

export const aliases: Record<string, string>;
export const esbuildVendor: Plugin;
export function viteVendor(): { name: string; enforce: 'pre'; transform(code: string, id: string): { code: string; map: null } | null };
