// Mueve la base de datos a una carpeta que no se sincronice sola.
//
// Por qué: SQLite en modo WAL no es un archivo sino tres (futsala.db, -wal y -shm) que se
// escriben juntos. OneDrive, Drive y Dropbox los suben por separado y en cualquier orden,
// así que pueden subir una mitad vieja y otra nueva, o bloquear el archivo mientras la
// aplicación escribe. El resultado es una base corrupta, y se nota tarde.
//
// Uso:
//   node scripts/mover-datos.js C:\FUTSALA\datos
//   node scripts/mover-datos.js C:\FUTSALA\datos --simular   (no toca nada, solo informa)
//
// Deja la base en destino, anota la ruta en `datos.ubicacion` para que la aplicación la
// encuentre sola, y conserva una copia de respaldo del original. No borra nada.
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  statSync,
  renameSync,
} from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO_UBICACION = join(RAIZ, 'datos.ubicacion');
const SUFIJOS = ['', '-wal', '-shm'];

const argumentos = process.argv.slice(2);
const simular = argumentos.includes('--simular');
const destinoPedido = argumentos.find((a) => !a.startsWith('--'));

if (!destinoPedido) {
  console.error('Indicá la carpeta de destino. Por ejemplo:');
  console.error('  node scripts/mover-datos.js C:\\FUTSALA\\datos');
  console.error('Agregá --simular para ver qué haría sin tocar nada.');
  process.exit(1);
}

const destino = isAbsolute(destinoPedido) ? destinoPedido : resolve(destinoPedido);
const origenDir = ubicacionActual();
const origen = join(origenDir, 'futsala.db');
const nuevaDb = join(destino, 'futsala.db');

function ubicacionActual() {
  if (process.env.FUTSALA_DATOS) return process.env.FUTSALA_DATOS;
  try {
    const anotado = readFileSync(ARCHIVO_UBICACION, 'utf8').trim();
    if (anotado) return anotado;
  } catch {
    // Sin anotación previa: la base está donde está por defecto.
  }
  return join(RAIZ, 'data');
}

/** ¿Esta ruta vive en una carpeta que sincroniza sola? */
function seSincroniza(ruta) {
  return /[\\/](OneDrive|Google ?Drive|Dropbox|iCloudDrive)([\\/]|$)/i.test(ruta);
}

console.log('');
console.log('  Mover la base de datos');
console.log(`  Desde: ${origen}${seSincroniza(origen) ? '   (se sincroniza sola)' : ''}`);
console.log(`  Hacia: ${nuevaDb}${seSincroniza(destino) ? '   (¡también se sincroniza sola!)' : ''}`);
console.log('');

if (!existsSync(origen)) {
  console.error(`No hay ninguna base en ${origen}. Nada que mover.`);
  process.exit(1);
}
if (seSincroniza(destino)) {
  console.error('El destino también se sincroniza solo: elegí una carpeta fuera de OneDrive, Drive o Dropbox.');
  process.exit(1);
}
if (resolve(origenDir) === resolve(destino)) {
  console.error('El destino es la carpeta donde ya está la base. Nada que hacer.');
  process.exit(1);
}
if (existsSync(nuevaDb)) {
  console.error(`Ya hay una base en ${nuevaDb}. No la piso: movela o elegí otra carpeta.`);
  process.exit(1);
}

// Qué hay antes de mover, para comparar después. Sirve de prueba de que llegó entera.
const antes = inventario(origen);
console.log('  Lo que hay ahora:');
for (const [tabla, filas] of Object.entries(antes)) console.log(`    ${tabla.padEnd(16)} ${filas}`);
console.log('');

if (simular) {
  console.log('  --simular: no se tocó nada.');
  console.log(`  Sin --simular haría: volcar el WAL, copiar a ${destino}, verificar,`);
  console.log(`  anotar la ruta en ${ARCHIVO_UBICACION} y dejar el original como respaldo.`);
  process.exit(0);
}

// 1. Volcar el WAL dentro del archivo principal. Sin esto, copiar futsala.db solo se
//    lleva una parte: lo último escrito puede estar todavía en el -wal.
const conexion = new DatabaseSync(origen);
conexion.exec('PRAGMA wal_checkpoint(TRUNCATE)');
conexion.close();
console.log('  WAL volcado al archivo principal.');

// 2. Copiar (no mover): si algo sale mal, el original sigue donde estaba.
mkdirSync(destino, { recursive: true });
for (const sufijo of SUFIJOS) {
  const desde = `${origen}${sufijo}`;
  if (existsSync(desde)) copyFileSync(desde, `${nuevaDb}${sufijo}`);
}
console.log(`  Copiada a ${nuevaDb} (${Math.round(statSync(nuevaDb).size / 1024)} KB).`);

// El secreto que firma las sesiones vive en la misma carpeta. Si no viaja con la base,
// la aplicación genera uno nuevo y todos tienen que volver a entrar sin motivo.
// Los respaldos .db viejos se quedan donde están: una copia en la nube no molesta.
const secreto = join(origenDir, 'secreto-sesion.txt');
if (existsSync(secreto)) {
  copyFileSync(secreto, join(destino, 'secreto-sesion.txt'));
  console.log('  Secreto de sesión copiado: nadie tiene que volver a entrar.');
}

// 3. Verificar que la copia abre, pasa el chequeo de integridad y tiene lo mismo.
const copia = new DatabaseSync(nuevaDb, { readOnly: true });
const integridad = copia.prepare('PRAGMA integrity_check').get();
copia.close();
const resultadoIntegridad = Object.values(integridad)[0];
if (resultadoIntegridad !== 'ok') {
  console.error(`  La copia no pasa el chequeo de integridad: ${resultadoIntegridad}`);
  console.error('  No se anotó nada: la base original sigue siendo la que usa la aplicación.');
  process.exit(1);
}
const despues = inventario(nuevaDb);
const diferencias = Object.keys(antes).filter((t) => antes[t] !== despues[t]);
if (diferencias.length > 0) {
  console.error(`  La copia no coincide en: ${diferencias.join(', ')}`);
  console.error('  No se anotó nada: la base original sigue siendo la que usa la aplicación.');
  process.exit(1);
}
console.log('  Verificada: integridad ok y mismas filas en todas las tablas.');

// 4. Recién ahora la aplicación mira el destino.
writeFileSync(ARCHIVO_UBICACION, `${destino}\n`, 'utf8');
console.log(`  Ruta anotada en ${ARCHIVO_UBICACION}.`);

// 5. El original queda como respaldo con otro nombre, para que nadie lo confunda con la
//    base viva y para que no haya dos bases activas si alguien borra la anotación.
const sello = new Date().toISOString().slice(0, 10);
const respaldo = join(origenDir, `futsala.db.respaldo-${sello}`);
for (const sufijo of SUFIJOS) {
  const viejo = `${origen}${sufijo}`;
  if (existsSync(viejo)) renameSync(viejo, `${respaldo}${sufijo}`);
}
// El secreto viejo se renombra también: que no quede una copia viva de la firma de
// sesión en una carpeta sincronizada.
if (existsSync(secreto)) renameSync(secreto, join(origenDir, `secreto-sesion.txt.respaldo-${sello}`));
writeFileSync(
  join(origenDir, 'LEEME.txt'),
  [
    'La base de datos de FUTSALA ya no vive acá.',
    '',
    `Se movió el ${sello} a:`,
    `  ${destino}`,
    '',
    'Esta carpeta se sincroniza sola (OneDrive), y SQLite usa tres archivos que se',
    'escriben juntos; sincronizarlos por separado puede corromper la base.',
    '',
    `El archivo futsala.db.respaldo-${sello} es la copia de cómo quedó al mudarse.`,
    'Se puede borrar cuando ya no haga falta.',
    '',
  ].join('\n'),
  'utf8',
);
console.log(`  El original quedó como respaldo: ${respaldo}`);

console.log('');
console.log('  Listo. La aplicación ya usa la base nueva; "npm start" la encuentra sola.');
console.log('');

/** Cuántas filas tiene cada tabla, para comparar origen y destino. */
function inventario(ruta) {
  const base = new DatabaseSync(ruta, { readOnly: true });
  const tablas = base
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((t) => t.name);
  const conteo = {};
  for (const tabla of tablas) conteo[tabla] = base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n;
  base.close();
  return conteo;
}
