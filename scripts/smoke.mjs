const baseUrl = (process.env.TARGET_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

for (const endpoint of ['/healthz', '/readyz']) {
  const response = await fetch(`${baseUrl}${endpoint}`);
  if (!response.ok) {
    throw new Error(`${endpoint} ha risposto con HTTP ${response.status}.`);
  }
  console.log(`${endpoint}: ${JSON.stringify(await response.json())}`);
}
