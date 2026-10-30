import 'dotenv/config';
import { openDatabase, migrate } from '../packages/database/index';
const db = await openDatabase(process.env.DATABASE_URL, process.env.DATA_DIR || '.data/pixup');
await migrate(db);
await db.close();
console.log('Database migrations applied.');
