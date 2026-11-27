// node --import ./test/cf/register.mjs : resolve `cloudflare:workers` to a local stub.
import { register } from 'node:module';
register(new URL('./hooks.mjs', import.meta.url));
