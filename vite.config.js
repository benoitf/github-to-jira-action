import { builtinModules } from 'node:module';
import { join } from 'node:path';

const PACKAGE_ROOT = __dirname;
const PACKAGE_NAME = 'main';
/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
const config = {
  mode: process.env.MODE,
  root: PACKAGE_ROOT,
  envDir: process.cwd(),
  resolve: {
    alias: {
      '/@/': `${join(PACKAGE_ROOT, 'src')}/`,
    },
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    sourcemap: 'inline',
    target: 'node20',
    outDir: 'lib',
    assetsDir: '.',
    minify: process.env.MODE === 'production' ? 'esbuild' : false,
    lib: {
      formats: ['es'],
      entry: 'src/index.ts',
    },
    rollupOptions: {
      external: [...builtinModules.flatMap((p) => [p, `node:${p}`])],
      output: {
        entryFileNames: '[name].mjs',
      },
    },
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  test: {},
};

export default config;
