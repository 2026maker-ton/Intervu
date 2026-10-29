// 호환 진입점(WP-A1): 기존 import { createApp } from '../src/server.js'와 `npm start`를 유지한다.
// 코어는 src/app/(플랫폼 중립), Node 어댑터는 src/node/server.js.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, startServer } from './node/server.js';

export { createApp };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
