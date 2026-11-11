// Genera un enlace de acceso desde la consola de la máquina que tiene los datos.
//
// Para qué: es la forma de entrar la primera vez, y la de no quedarse afuera nunca. Si
// no quedara ninguna Dirección con sesión, sin esto no habría manera de volver a entrar
// sin tocar la base a mano.
//
// Quien puede correr esto ya tiene la base entera en su disco, así que no agrega riesgo:
// no es una puerta trasera, es la llave de la casa en manos del dueño de la casa.
//
// Uso:
//   npm run acceso facundo@ejemplo.com
//   npm run acceso                       (lista a quién se le puede generar)
import { abrirBase, todos, uno } from '../server/db.js';
import * as accesos from '../server/dominio/accesos.js';

abrirBase();

const email = (process.argv[2] || '').trim().toLowerCase();
const puerto = process.env.PORT || 4310;
const base = process.env.FUTSALA_BASE_URL || `http://localhost:${puerto}`;

if (!email) {
  console.log('');
  console.log('  Indicá el correo de la persona. Por ejemplo:');
  console.log('    npm run acceso alguien@ejemplo.com');
  console.log('');
  console.log('  Usuarios cargados:');
  for (const u of todos('SELECT email, nombre, rol, activo FROM usuario ORDER BY nombre')) {
    console.log(`    ${u.activo === 1 ? ' ' : '·'} ${u.email.padEnd(32)} ${u.nombre} (${u.rol})${u.activo === 1 ? '' : '  INACTIVO'}`);
  }
  console.log('');
  process.exit(1);
}

const usuario = uno('SELECT * FROM usuario WHERE email = ?', email);
if (!usuario) {
  console.error(`  No hay ningún usuario con el correo ${email}.`);
  console.error('  Corré "npm run acceso" sin argumentos para ver la lista.');
  process.exit(1);
}

try {
  const { token, expiraEn } = accesos.generar(usuario.id, {
    motivo: 'Generado desde la consola del servidor.',
  });
  console.log('');
  console.log(`  Enlace de acceso para ${usuario.nombre} <${usuario.email}>  ·  ${usuario.rol}`);
  console.log(`  Vence en ${expiraEn} minutos y sirve una sola vez.`);
  console.log('');
  console.log(`  ${accesos.enlaceDe(token, base)}`);
  console.log('');
  if (!process.env.FUTSALA_BASE_URL) {
    console.log(`  (si entrás desde otra máquina, cambiá "localhost:${puerto}" por la dirección del servidor)`);
    console.log('');
  }
} catch (error) {
  console.error(`  ${error.message}`);
  if (error.ayuda) console.error(`  ${error.ayuda}`);
  process.exit(1);
}
