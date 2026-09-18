/**
 * 桌面版主进程打包：electron/main.ts（+ server/apiCore.ts）→ dist-electron/main.cjs
 *
 * 用 esbuild 而不是 tsc：只产出一个自包含的 CJS 文件，Electron 主进程直接 require，
 * 不需要为 electron 目录单独维护 tsconfig / 产物目录结构。
 * electron 是外部依赖（运行时由 Electron 运行时提供），其余全部内联。
 */
import { build } from 'esbuild'

await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'dist-electron/main.cjs',
  external: ['electron'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
})
