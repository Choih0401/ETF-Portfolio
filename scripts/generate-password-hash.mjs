import { hashPassword } from "../auth.js";

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run make:hash -- \"your-password\"");
  process.exit(1);
}

const encoded = hashPassword(password);
console.log(encoded);
