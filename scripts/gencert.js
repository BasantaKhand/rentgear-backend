// Generates a self-signed certificate for local HTTPS development.
// Output: certs/key.pem and certs/cert.pem (git-ignored).
// Run with: npm run gen-certs
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const certsDir = path.join(__dirname, '..', 'certs');
if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });

const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');

async function main() {
  if (
    fs.existsSync(keyPath) &&
    fs.existsSync(certPath) &&
    !process.argv.includes('--force')
  ) {
    console.log('Certificates already exist. Use --force to regenerate.');
    return;
  }

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  // selfsigned.generate returns a Promise in this version.
  const pems = await selfsigned.generate(attrs, {
    algorithm: 'sha256',
    days: 825,
    keySize: 2048,
  });

  if (!pems || !pems.private || !pems.cert) {
    console.error('Certificate generation failed.');
    process.exit(1);
  }

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  console.log('Generated self-signed certificate:');
  console.log(`  ${keyPath}`);
  console.log(`  ${certPath}`);
}

main().catch((err) => {
  console.error('Certificate generation error:', err.message);
  process.exit(1);
});
