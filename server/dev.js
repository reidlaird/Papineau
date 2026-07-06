// Dev launcher: pins the API to 3020, where vite.config.js proxies /api.
// Preview harnesses inject PORT for the whole `npm run dev` process tree,
// which would otherwise send the API to vite's own port.
process.env.PORT = '3020';
await import('./index.js');
