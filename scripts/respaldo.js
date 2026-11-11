// Respaldo de la base, pensado para correr solo todos los días.
//
// Qué copia: el archivo de la base, que es lo que de verdad restaura todo. Antes vuelca
// el WAL, porque sin eso la copia se llevaría una parte y lo último escrito quedaría
// afuera; ya me pasó dos veces copiando a mano.
//
// Qué verifica: que la copia abra, pase el chequeo de integridad de SQLite y tenga las
// mismas filas que el original. Un respaldo que no se verifica no es un respaldo: es un
// archivo en el que uno confía sin motivo.
//
// Dónde: en `exportaciones/respaldos`, que está dentro de OneDrive. Para la base viva
// eso sería un riesgo; para una copia que nadie escribe, es lo contrario: queda fuera de
// esta máquina sin hacer nada.
//
// Uso:
//   npm run respaldo            copia, verifica y rota
//   npm run respaldo -- --ver   muestra qué respaldos hay, sin tocar nada
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, statSync, appendFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RUTA_DB, RAIZ } from '../server/db.js';
import { ahora, hoy } from '../server/lib/fechas.js';

/** Cuántos respaldos diarios se conservan. Los primeros de cada mes no se borran nunca. */
const DIARIOS_QUE_QUEDAN = 14;

const CARPETA = join(RAIZ, 'exportaciones', 'respaldos');
const REGISTRO = join(CARPETA, 'respaldos.log');

const soloVer = process.argv.includes('--ver');

mkdirSync(CARPETA, { recursive: true });

if (soloVer) {
  mostrar();
  process.exit(0);
}

try {
  const destino = respaldar();
  rotar();
  anotar(`ok       ${destino}`);
  console.log(`  Respaldo hecho y verificado: ${destino}`);
  mostrar();
} catch (error) {
  // Un respaldo que falla tiene que gritar: queda en el registro y el programador de
  // tareas de Windows lo marca como fallido por el código de salida.
  anotar(`FALLÓ    ${error.message}`);
  console.error(`  El respaldo FALLÓ: ${error.message}`);
  process.exit(1);
}

function respaldar() {
  if (!existsSync(RUTA_DB)) throw new Error(`No existe la base en ${RUTA_DB}`);

  // 1. Volcar el WAL dentro del archivo principal.
  const viva = new DatabaseSync(RUTA_DB);
  viva.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const antes = inventario(viva);
  viva.close();

  // 2. Copiar.
  const destino = join(CARPETA, `futsala-${hoy()}.db`);
  copyFileSync(RUTA_DB, destino);

  // 3. Verificar que la copia sirva: que abra, que esté íntegra y que esté completa.
  const copia = new DatabaseSync(destino, { readOnly: true });
  let integridad;
  let despues;
  try {
    integridad = Object.values(copia.prepare('PRAGMA integrity_check').get())[0];
    despues = inventario(copia);
  } finally {
    copia.close();
    // Abrir la copia para revisarla deja un -wal y un -shm al lado. No son parte del
    // respaldo y confunden al mirar la carpeta, así que se van.
    for (const sufijo of ['-wal', '-shm']) {
      const suelto = `${destino}${sufijo}`;
      if (existsSync(suelto)) rmSync(suelto);
    }
  }
  if (integridad !== 'ok') throw new Error(`la copia no pasa el chequeo de integridad: ${integridad}`);

  const diferencias = Object.keys(antes).filter((t) => antes[t] !== despues[t]);
  if (diferencias.length > 0) {
    throw new Error(`la copia no coincide con el original en: ${diferencias.join(', ')}`);
  }
  return destino;
}

/** Cuántas filas tiene cada tabla, para comparar original y copia. */
function inventario(base) {
  const tablas = base
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all()
    .map((t) => t.name);
  const conteo = {};
  for (const tabla of tablas) conteo[tabla] = base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n;
  return conteo;
}

/**
 * Deja los últimos días y el primero de cada mes. Así, de un año queda el detalle de las
 * últimas dos semanas y una foto mensual hacia atrás, sin que la carpeta crezca sin fin.
 */
function rotar() {
  const respaldos = listar();
  const porMes = new Set();
  const aConservar = new Set();

  for (const r of respaldos) {
    const mes = r.fecha.slice(0, 7);
    if (!porMes.has(mes)) {
      porMes.add(mes);
      aConservar.add(r.archivo); // el más viejo de cada mes que haya quedado
    }
  }
  for (const r of respaldos.slice(-DIARIOS_QUE_QUEDAN)) aConservar.add(r.archivo);

  for (const r of respaldos) {
    if (aConservar.has(r.archivo)) continue;
    rmSync(join(CARPETA, r.archivo));
    anotar(`rotado   ${r.archivo}`);
  }
}

function listar() {
  return readdirSync(CARPETA)
    .filter((n) => /^futsala-\d{4}-\d{2}-\d{2}\.db$/.test(n))
    .map((archivo) => ({ archivo, fecha: archivo.slice(8, 18) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function mostrar() {
  const respaldos = listar();
  if (respaldos.length === 0) {
    console.log('  Todavía no hay respaldos.');
    return;
  }
  console.log('');
  console.log(`  Respaldos en ${CARPETA}`);
  for (const r of respaldos) {
    const tamanio = Math.round(statSync(join(CARPETA, r.archivo)).size / 1024);
    console.log(`    ${r.fecha}   ${String(tamanio).padStart(5)} KB   ${r.archivo}`);
  }
  console.log(`  Total: ${respaldos.length}`);
  console.log('');
  console.log('  Para restaurar: parar la aplicación y copiar el archivo elegido sobre');
  console.log(`    ${RUTA_DB}`);
  console.log('');
}

function anotar(linea) {
  try {
    appendFileSync(REGISTRO, `${ahora()}  ${linea}\n`, 'utf8');
  } catch {
    // Que no se pueda anotar no invalida el respaldo.
  }
}
