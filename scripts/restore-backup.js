// Opens an encrypted full copy (.mcbackup) into a folder: ventas.db, files/ and id-documents/.
// Usage:  node scripts/restore-backup.js <copy.mcbackup> <empty-folder>
// The password is asked for, or read from the BACKUP_PASSPHRASE environment variable.
'use strict';
const fs = require('node:fs');
const readline = require('node:readline/promises');
const { restoreArchive } = require('../src/full-backup');

async function main() {
  const [, , file, destination] = process.argv;
  if (!file || !destination) {
    console.log('Uso: node scripts/restore-backup.js <copia.mcbackup> <carpeta-vacía>');
    process.exit(1);
  }
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) {
    console.log(`La carpeta "${destination}" no está vacía. Elige una carpeta nueva para no pisar datos.`);
    process.exit(1);
  }
  let passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    passphrase = await prompt.question('Contraseña de las copias: ');
    prompt.close();
  }
  try {
    const written = restoreArchive(file, passphrase, destination);
    console.log(`Restaurados ${written.length} archivos en "${destination}".`);
    console.log('Para usarlos: detén la aplicación y copia el contenido de esa carpeta a su carpeta de datos.');
  } catch (error) {
    console.log(error.message);
    process.exit(1);
  }
}
main();
