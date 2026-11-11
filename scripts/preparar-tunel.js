// Deja lista la configuración para publicar la aplicación con Cloudflare Tunnel desde
// esta máquina. Se corre UNA vez, en la máquina que queda prendida.
//
// Uso:
//   npm run preparar-tunel reuniones.ejemplo.com.ar
//
// Escribe `.env` en la raíz del proyecto (no se versiona). El secreto que firma las
// sesiones es el mismo que la aplicación ya venía usando en esta máquina, si había uno,
// así nadie queda afuera por el cambio. Si `.env` ya existe no lo toca: cambiar el
// secreto echa a todos, y eso tiene que ser una decisión, no un efecto de volver a
// correr esto.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DIR_DATOS } from '../server/db.js';
import { direccionPublica } from '../server/lib/tunel.js';
import { ARCHIVO_ENTORNO } from './lib/entorno.js';

const pedido = process.argv[2];
const base = direccionPublica(pedido);

if (!base) {
  console.error('');
  console.error('  Indicá el dominio público con el que se va a entrar. Por ejemplo:');
  console.error('    npm run preparar-tunel reuniones.ejemplo.com.ar');
  if (pedido) console.error(`\n  "${pedido}" no sirve: tiene que ser un dominio con HTTPS, sin ruta.`);
  console.error('');
  process.exit(1);
}

if (existsSync(ARCHIVO_ENTORNO)) {
  console.log('');
  console.log(`  Ya existe ${ARCHIVO_ENTORNO}: no lo toco.`);
  console.log('  Si querés cambiar el dominio, editá FUTSALA_BASE_URL a mano.');
  console.log('  No cambies FUTSALA_SECRETO: si cambia, todos quedan afuera.');
  console.log('');
  process.exit(0);
}

const archivoSecreto = join(DIR_DATOS, 'secreto-sesion.txt');
let secreto = existsSync(archivoSecreto) ? readFileSync(archivoSecreto, 'utf8').trim() : '';
const reutilizado = secreto.length >= 32;
if (!reutilizado) secreto = randomBytes(32).toString('hex');

const contenido = [
  '# Configuración para publicar con Cloudflare Tunnel desde esta máquina.',
  '# La creó `npm run preparar-tunel`. NO se versiona: tiene el secreto de las sesiones.',
  '# Si FUTSALA_SECRETO cambia, todos quedan afuera y hay que volver a pasarles enlace.',
  'FUTSALA_PUBLICO=1',
  'FUTSALA_PROXY=1',
  '# Solo cloudflared, que corre en esta misma máquina, le habla a la aplicación.',
  'FUTSALA_INTERFAZ=127.0.0.1',
  `FUTSALA_BASE_URL=${base}`,
  `FUTSALA_SECRETO=${secreto}`,
  '',
].join('\n');

writeFileSync(ARCHIVO_ENTORNO, contenido, { mode: 0o600 });

console.log('');
console.log(`  Listo: ${ARCHIVO_ENTORNO}`);
console.log(`  Dirección pública: ${base}`);
console.log(
  reutilizado
    ? '  Secreto: el que ya usaba esta máquina, así las sesiones abiertas siguen valiendo.'
    : '  Secreto: uno nuevo, generado al azar.',
);
console.log('');
console.log('  Siguiente paso: probarlo con   npm run tunel');
console.log('  y después dejarlo fijo con     scripts\\instalar-tareas.ps1  (como administrador)');
console.log('');
