import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const password = process.argv[2];
if (!password) {
  console.error('用法：pnpm hash-password <password>');
  process.exit(1);
}
const salt = randomBytes(16);
const key = await promisify(scryptCallback)(password, salt, 64) as Buffer;
console.log(`${salt.toString('hex')}:${key.toString('hex')}`);
