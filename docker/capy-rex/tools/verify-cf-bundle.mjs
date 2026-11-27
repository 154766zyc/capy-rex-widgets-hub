// Bundle cf/index.js the way wrangler does (esbuild, ES modules, PNG/ICO as
// binary data) and check it only imports what Cloudflare Workers provides.
// Usage: node tools/verify-cf-bundle.mjs [path-to-esbuild-package]
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const esbuildPath = process.argv[2] || 'esbuild';
const esbuild = await import(esbuildPath.startsWith('/') ? pathToFileURL(require.resolve(esbuildPath)).href : esbuildPath);
// Built-ins available in workerd with the nodejs_compat flag that this build uses.
const allowed = new Set(['cloudflare:workers', 'node:crypto', 'node:zlib', 'node:async_hooks']);
const imports = new Set();
const result = await esbuild.build({
  entryPoints: [root + 'cf/index.js'], bundle: true, format: 'esm', platform: 'neutral', write: false,
  target: 'es2022', loader: { '.png': 'binary', '.ico': 'binary' }, metafile: true, logLevel: 'silent',
  plugins: [{ name: 'externals', setup(b) {
    b.onResolve({ filter: /^(node:|cloudflare:)/ }, a => { imports.add(a.path); return { path: a.path, external: true }; });
  } }],
});
const inputs = Object.keys(result.metafile.inputs).map(p => p.replace(/^.*?Hub\//, ''));
const bad = [...imports].filter(i => !allowed.has(i));
const dockerOnly = inputs.filter(p => /(^|\/)(server|kv|storage|network|restore-snapshot)\.js$/.test(p));
console.log('打包文件数：', inputs.length, '| 大小：', result.outputFiles[0].contents.length, '字节');
console.log('运行时依赖：', [...imports].sort().join(', '));
if (bad.length || dockerOnly.length) {
  console.error('不通过：不支持的依赖', bad, '不该打包的文件', dockerOnly);
  process.exit(1);
}
console.log('通过：CF 打包只用到 Cloudflare 支持的模块');
