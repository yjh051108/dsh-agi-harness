// tsdown.config.mjs — browser-panel 构建配置（2026-09 重建：原配置缺失）。
// host（index + invariant）：esm/node bundle，externals 走 package.json deps 自动外置。
// client：cjs/browser bundle，按注入器脚手架权威模板（SCAFFOLD_TSDOWN）产 lib/client.js，
//   banner/footer/intro 组成 __ModuleLoader__.load({ id }) 包装，id 必须等于 package.json name。
import { fileURLToPath } from 'node:url'

const PLUGIN_ID = '@dsh-external/dsh-browser-panel'

const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
]

const hostBundle = {
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  dts: false,
  sourcemap: false,
  clean: false,
  outputOptions: {
    // 强落 .js：package.json type=module 下 .js 即 esm；exports 映射指向 ./lib/index.js
    entryFileNames: '[name].js',
  },
}

const clientBundle = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (id) => !CLIENT_EXTERNALS.includes(id),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(PLUGIN_ID) + ', factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [hostBundle, clientBundle]
