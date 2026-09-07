import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp({ config });

app.listen(config.port, () => {
  console.log(`PDF Table Extractor ${config.version}: http://localhost:${config.port}`);
});
