// Cambia la contraseña de un usuario desde la terminal (por si se olvida la del administrador).
// Uso:  node scripts/reset-password.js <usuario> <nueva-contraseña>
'use strict';
const [, , username, password] = process.argv;
if (!username || !password || password.length < 4) {
  console.log('Uso: node scripts/reset-password.js <usuario> <nueva-contraseña (mín. 4)>');
  process.exit(1);
}
const { get, run, all } = require('../src/db');
const { hashPassword } = require('../src/auth');
const u = get('SELECT id, role FROM users WHERE username = ?', username);
if (!u) {
  console.log(`No existe el usuario "${username}". Usuarios: ${all('SELECT username FROM users').map(x => x.username).join(', ')}`);
  process.exit(1);
}
run('UPDATE users SET password_hash = ?, active = 1 WHERE id = ?', hashPassword(password), u.id);
run('DELETE FROM sessions WHERE user_id = ?', u.id);
console.log(`Contraseña de "${username}" cambiada (${u.role === 'admin' ? 'administrador' : 'trabajador'}).`);
