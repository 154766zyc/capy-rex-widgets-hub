// 重新生成 single-file/index.js（改过源码后运行：npm install && npm run build:single）。
// 和 wrangler 部署时的打包方式一样：ES 模块、PNG/ICO 内嵌、Cloudflare/Node 内置模块不打包。
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const esbuild = await import(process.argv[2] || 'esbuild');
await esbuild.build({ entryPoints: [root + 'cf/index.js'], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  outfile: root + 'single-file/index.js', loader: { '.png': 'binary', '.ico': 'binary' }, external: ['node:*', 'cloudflare:workers'],
  legalComments: 'none', banner: { js: '// Rex Widgets Hub ' + (await import(root + 'package.json', { with: { type: 'json' } })).default.version +
    ' · Cloudflare 单文件版（由 cf/index.js 打包生成，不要手动修改）' } });
console.log('已生成 single-file/index.js');
