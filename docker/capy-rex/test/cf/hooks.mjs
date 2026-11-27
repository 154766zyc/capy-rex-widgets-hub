const stub = new URL('./cloudflare-workers-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
