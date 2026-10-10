'use strict';
// A full copy of the shop in one encrypted file: the database, the uploaded files and the identity
// documents. It is a tar archive, gzipped and encrypted with AES-256-GCM, so it can be kept anywhere.
//
// File layout:  MAGIC | salt (16) | iv (12) | encrypted gzip of the tar | auth tag (16)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable, pipeline } = require('node:stream');

const MAGIC = Buffer.from('MCBACKUP1\n');
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const BLOCK = 512;

const keyFrom = (passphrase, salt) => crypto.scryptSync(passphrase, salt, 32);

// ---- tar (ustar): a 512-byte header per file, then its content padded to 512 bytes
function tarHeader(name, size, modifiedAt) {
  if (Buffer.byteLength(name) > 100) throw new Error(`Nombre demasiado largo para la copia: ${name}`);
  const header = Buffer.alloc(BLOCK);
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  header.write(name, 0);
  header.write(octal(0o600, 8), 100);
  header.write(octal(0, 8), 108);
  header.write(octal(0, 8), 116);
  header.write(octal(size, 12), 124);
  header.write(octal(Math.floor(modifiedAt / 1000), 12), 136);
  header.write('        ', 148); // the checksum is computed with its own field as spaces
  header.write('0', 156);
  header.write('ustar\0' + '00', 257);
  header.write(octal(header.reduce((sum, byte) => sum + byte, 0), 7) + ' ', 148);
  return header;
}

async function* tarOf(entries) {
  for (const { name, file } of entries) {
    const { size, mtimeMs } = fs.statSync(file);
    yield tarHeader(name, size, mtimeMs);
    yield* fs.createReadStream(file);
    if (size % BLOCK) yield Buffer.alloc(BLOCK - (size % BLOCK));
  }
  yield Buffer.alloc(BLOCK * 2);
}

const filesIn = (folder, prefix) => (fs.existsSync(folder) ? fs.readdirSync(folder) : [])
  .filter(name => fs.statSync(path.join(folder, name)).isFile())
  .map(name => ({ name: `${prefix}/${name}`, file: path.join(folder, name) }));

// folders: { 'files': FILES_DIR, 'id-documents': ID_DOCUMENTS_DIR }. Returns a readable stream.
function encryptedArchive({ database, folders, passphrase }) {
  const entries = [{ name: 'ventas.db', file: database }, ...Object.entries(folders).flatMap(([prefix, folder]) => filesIn(folder, prefix))];
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(passphrase, salt), iv);
  // pipeline, not pipe: a file that cannot be read must end the copy with an error instead of hanging it.
  const encrypted = pipeline(Readable.from(tarOf(entries)), zlib.createGzip(), cipher, () => {});
  return Readable.from((async function* archive() {
    yield Buffer.concat([MAGIC, salt, iv]);
    yield* encrypted;
    yield cipher.getAuthTag();
  })());
}

// ---- reading it back (used by scripts/restore-backup.js)
function untar(archive, destination) {
  const written = [];
  for (let offset = 0; offset + BLOCK <= archive.length;) {
    const header = archive.subarray(offset, offset + BLOCK);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString(), 8);
    const target = path.join(destination, name);
    if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error(`Ruta no válida en la copia: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, archive.subarray(offset + BLOCK, offset + BLOCK + size));
    written.push(name);
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return written;
}

function restoreArchive(file, passphrase, destination) {
  const content = fs.readFileSync(file);
  if (!content.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('El archivo no es una copia completa de esta aplicación');
  const salt = content.subarray(MAGIC.length, MAGIC.length + SALT_LENGTH);
  const iv = content.subarray(MAGIC.length + SALT_LENGTH, MAGIC.length + SALT_LENGTH + IV_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(passphrase, salt), iv);
  decipher.setAuthTag(content.subarray(content.length - TAG_LENGTH));
  let tar;
  try {
    const body = content.subarray(MAGIC.length + SALT_LENGTH + IV_LENGTH, content.length - TAG_LENGTH);
    tar = zlib.gunzipSync(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado');
  }
  return untar(tar, path.resolve(destination));
}

module.exports = { encryptedArchive, restoreArchive };
