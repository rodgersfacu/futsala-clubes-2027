// Da de alta al equipo y desactiva la identidad provisoria.
//
// Es idempotente: si una persona ya está cargada, la deja como está y lo informa.
// No envía ningún correo: las direcciones son solo el identificador de cada persona.
//
// Las personas se leen de `equipo.json`, en la raíz del proyecto, que NO se versiona:
// son nombres y correos de personas reales y no tienen por qué estar en un repositorio.
// `equipo.ejemplo.json` muestra el formato.
//
// Uso: node scripts/cargar-equipo.js
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { abrirBase, uno, todos, RAIZ } from '../server/db.js';
import * as usuarios from '../server/dominio/usuarios.js';

const ARCHIVO_EQUIPO = join(RAIZ, 'equipo.json');

if (!existsSync(ARCHIVO_EQUIPO)) {
  console.error('');
  console.error(`  Falta ${ARCHIVO_EQUIPO}`);
  console.error('  Copiá equipo.ejemplo.json como equipo.json y poné las personas reales.');
  console.error('  Ese archivo no se versiona: los correos son datos de personas.');
  console.error('');
  process.exit(1);
}

let EQUIPO;
try {
  EQUIPO = JSON.parse(readFileSync(ARCHIVO_EQUIPO, 'utf8'));
} catch (error) {
  console.error(`  No pude leer equipo.json: ${error.message}`);
  process.exit(1);
}
if (!Array.isArray(EQUIPO) || EQUIPO.length === 0) {
  console.error('  equipo.json tiene que ser una lista con al menos una persona.');
  process.exit(1);
}
if (!EQUIPO.some((p) => p.rol === 'Direccion')) {
  console.error('  Hace falta al menos una persona con rol "Direccion".');
  process.exit(1);
}

abrirBase();

// El alta exige rol Dirección: la hace la identidad provisoria, que es la única que hay
// la primera vez. Si ya no está o quedó desactivada (después de la primera carga), la
// hace la primera Dirección activa.
const provisorio = usuarios.porEmail('provisorio@futsala.local');
const actor = provisorio?.activo === 1 ? provisorio : todos("SELECT * FROM usuario WHERE rol = 'Direccion' AND activo = 1").at(0);
if (!actor) {
  console.error('No hay ninguna Dirección activa que pueda dar de alta al equipo.');
  process.exit(1);
}

for (const persona of EQUIPO) {
  const existente = usuarios.porEmail(persona.email);
  if (existente) {
    console.log(`  ya estaba   ${persona.nombre} (${existente.rol})`);
    continue;
  }
  usuarios.crear(actor, { ...persona, activo: '1' });
  console.log(`  alta        ${persona.nombre} — ${persona.rol}`);
}

// Recién ahora se desactiva la provisoria: con el equipo cargado queda más de una
// Dirección activa, así que la regla de "al menos una Dirección" no se interpone.
// Nadie puede cambiar su propio acceso, así que lo hace otra Dirección.
if (provisorio && provisorio.activo === 1) {
  const otra = todos(
    "SELECT * FROM usuario WHERE rol = 'Direccion' AND activo = 1 AND id <> ?",
    provisorio.id,
  ).at(0);
  if (otra) {
    usuarios.cambiarAcceso(otra, provisorio.id, { rol: 'Direccion', activo: '0' });
    console.log(`  baja        identidad provisoria (la desactivó ${otra.nombre})`);
  }
}

console.log('');
for (const u of usuarios.listar()) {
  console.log(`  ${u.activo ? 'activo  ' : 'inactivo'}  ${u.rol.padEnd(10)}  ${u.nombre}`);
}
console.log('');
console.log(`  Total: ${uno('SELECT count(*) AS n FROM usuario WHERE activo = 1').n} personas activas.`);
console.log('  No se envió ningún correo.');
