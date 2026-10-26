import 'dotenv/config';
import { loadConfig } from '../config.js';
import { ensureSeeded } from './seed.js';

await ensureSeeded(loadConfig().databaseUrl);
