// Carga masiva de la prioridad de cada club, con una planilla de ida y vuelta.
//
//   npm run prioridades                             saca la planilla con los clubes
//   npm run prioridades <archivo>                   dice qué cambiaría, sin tocar nada
//   npm run prioridades -- <archivo> --aplicar      aplica los cambios
//
// Por omisión NO escribe: hay que pedirlo con --aplicar. Es al revés de lo que parece
// natural, y a propósito. npm se queda con los "--loquesea" que no reconoce como suyos,
// así que una bandera puede no llegar nunca al script; si la bandera fuera "--simular",
// perderla significaría aplicar sin querer. Perdiendo "--aplicar" no pasa nada.
// Por eso también hace falta el "--" antes del archivo: le dice a npm que lo que sigue
// es del script y no suyo.
//
// La planilla sale como libro de Excel (.xlsx), con la columna PRIORIDAD como lista
// desplegable de 1 a 4: no hay que escribir el número ni se puede escribir otra cosa.
// Al volver se acepta lo que Excel haya guardado: .xlsx o .csv.
//
// Qué se lee: la columna PRIORIDAD. Las demás están para reconocer al club y se ignoran,
// así que se pueden ordenar, filtrar o pintar sin romper nada. Lo que identifica cada
// fila es el ID, no el nombre: renombrar un club en la planilla no lo despareja.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBase, todos, uno, ejecutar, enTransaccion, RAIZ } from '../server/db.js';
import { PRIORIDADES } from '../server/dominio/clubes.js';
import { registrar } from '../server/dominio/registro.js';
import { hoy } from '../server/lib/fechas.js';
import { leerHoja } from './lib/xlsx.js';
import { escribirHoja } from './lib/xlsx-escribir.js';

const NOMBRES = { 1: 'absoluta', 2: 'importante', 3: 'normal', 4: 'baja' };
const COLUMNAS = ['ID', 'CLUB', 'LOCALIDAD', 'PRIORIDAD', 'SIGNIFICA'];

abrirBase();

const argumentos = process.argv.slice(2);
// Escribir se pide; leer es lo que pasa si no se pide nada.
const aplicar = argumentos.includes('--aplicar');
const archivo = argumentos.find((a) => !a.startsWith('--'));

if (!archivo) sacarPlanilla();
else aplicarPlanilla(resolve(archivo));

// --- Ida ---------------------------------------------------------------------

function sacarPlanilla() {
  const clubes = todos(
    `SELECT c.id, c.nombre, c.localidad, c.prioridad FROM club c
     WHERE c.activo = 1 ORDER BY c.nombre`,
  );
  const filas = clubes.map((c) => [c.id, c.nombre, c.localidad || '', c.prioridad, NOMBRES[c.prioridad] || '']);

  const carpeta = join(RAIZ, 'exportaciones', hoy());
  mkdirSync(carpeta, { recursive: true });
  const destino = join(carpeta, 'prioridades.xlsx');

  escribirHoja(destino, {
    nombreHoja: 'Prioridades',
    columnas: COLUMNAS,
    filas,
    anchos: [38, 34, 22, 11, 14],
    lista: { columna: 'D', valores: PRIORIDADES },
  });

  console.log('');
  console.log(`  Planilla de prioridades: ${clubes.length} clubes activos`);
  console.log(`  ${destino}`);
  console.log('');
  console.log('  Abrila con Excel y elegí el número en la columna PRIORIDAD.');
  console.log('    1 = absoluta    2 = importante    3 = normal    4 = baja');
  console.log('  La columna tiene lista desplegable: no hace falta escribirlo.');
  console.log('');
  console.log('  Después, para cargarla:');
  console.log(`    npm run prioridades -- "${destino}"              (muestra qué cambiaría)`);
  console.log(`    npm run prioridades -- "${destino}" --aplicar    (lo aplica)`);
  console.log('');
  console.log('  Reparto actual:');
  for (const valor of PRIORIDADES) {
    const n = clubes.filter((c) => c.prioridad === valor).length;
    if (n) console.log(`    ${valor} ${String(NOMBRES[valor]).padEnd(12)} ${n}`);
  }
  console.log('');
}


// --- Vuelta ------------------------------------------------------------------

function aplicarPlanilla(ruta) {
  if (!existsSync(ruta)) {
    console.error(`  No existe el archivo ${ruta}`);
    process.exit(1);
  }
  const filas = extname(ruta).toLowerCase() === '.xlsx' ? leerXlsx(ruta) : leerCsv(ruta);
  if (filas.length === 0) {
    console.error('  La planilla no tiene filas. ¿Es la que sacó "npm run prioridades"?');
    process.exit(1);
  }

  const cambios = [];
  const sinCambio = [];
  const problemas = [];

  for (const fila of filas) {
    const id = String(fila.ID ?? '').trim();
    const pedida = String(fila.PRIORIDAD ?? '').trim();
    const comoFigura = String(fila.CLUB ?? '').trim();
    if (!id && !pedida) continue;

    const club = id ? uno('SELECT * FROM club WHERE id = ?', id) : null;
    if (!club) {
      problemas.push(`${comoFigura || '(sin nombre)'}: no encontré ese club. ¿Se borró la columna ID?`);
      continue;
    }
    if (!pedida) {
      sinCambio.push(club);
      continue;
    }
    if (!PRIORIDADES.includes(pedida)) {
      problemas.push(`${club.nombre}: "${pedida}" no es una prioridad. Tiene que ser 1, 2, 3 o 4.`);
      continue;
    }
    if (pedida === club.prioridad) sinCambio.push(club);
    else cambios.push({ club, de: club.prioridad, a: pedida });
  }

  console.log('');
  console.log(`  Planilla: ${ruta}`);
  console.log(`  Filas leídas: ${filas.length}`);
  console.log('');

  if (problemas.length > 0) {
    console.log(`  ${problemas.length} fila(s) con problemas. Ninguna se aplica:`);
    for (const p of problemas.slice(0, 15)) console.log(`    · ${p}`);
    if (problemas.length > 15) console.log(`    … y ${problemas.length - 15} más`);
    console.log('');
    console.log('  Corregí esas filas y volvé a intentar. No se tocó nada.');
    console.log('');
    process.exit(1);
  }

  console.log(`  Cambian: ${cambios.length}    Quedan igual: ${sinCambio.length}`);
  if (cambios.length > 0) {
    console.log('');
    console.log('  Cómo queda el reparto:');
    for (const valor of PRIORIDADES) {
      const antes = sinCambio.filter((c) => c.prioridad === valor).length + cambios.filter((c) => c.de === valor).length;
      const despues = sinCambio.filter((c) => c.prioridad === valor).length + cambios.filter((c) => c.a === valor).length;
      console.log(`    ${valor} ${String(NOMBRES[valor]).padEnd(12)} ${String(antes).padStart(4)} → ${String(despues).padStart(4)}`);
    }
    console.log('');
    const muestra = cambios.slice(0, 12);
    console.log(`  ${cambios.length > 12 ? 'Primeros cambios' : 'Cambios'}:`);
    for (const c of muestra) {
      console.log(`    · ${c.club.nombre.padEnd(34)} ${c.de} ${NOMBRES[c.de]} → ${c.a} ${NOMBRES[c.a]}`);
    }
    if (cambios.length > 12) console.log(`    … y ${cambios.length - 12} más`);
  }
  console.log('');

  if (cambios.length === 0) {
    console.log('  No hay nada que cambiar.');
    console.log('');
    return;
  }
  if (!aplicar) {
    console.log('  No se tocó nada. Para aplicarlo:');
    console.log(`    npm run prioridades -- "${ruta}" --aplicar`);
    console.log('');
    return;
  }

  // Todo junto: o entran los 245 o no entra ninguno. Una carga masiva a medias sería
  // peor que no haberla hecho, porque no se sabría dónde quedó.
  const actor = uno(`SELECT * FROM usuario WHERE rol = 'Direccion' AND activo = 1 ORDER BY creado_en LIMIT 1`);
  if (!actor) {
    console.error('  No hay ninguna Dirección activa para registrar el cambio.');
    process.exit(1);
  }

  enTransaccion(() => {
    for (const { club, a } of cambios) {
      ejecutar('UPDATE club SET prioridad = ?, version = version + 1 WHERE id = ?', a, club.id);
    }
    registrar({
      actor,
      tipo: 'clubes.prioridades',
      entidad: 'club',
      entidadId: cambios[0].club.id,
      motivo: `Carga masiva desde ${ruta}`,
      datosPosteriores: {
        cambiados: cambios.length,
        reparto: Object.fromEntries(
          PRIORIDADES.map((v) => [`${v} ${NOMBRES[v]}`, cambios.filter((c) => c.a === v).length]),
        ),
      },
    });
  });

  console.log(`  Listo: ${cambios.length} club(es) actualizados. Queda registrado en el historial.`);
  console.log('');
}

/** CSV con punto y coma o con coma, con o sin BOM, con comillas al estilo Excel. */
function leerCsv(ruta) {
  const texto = readFileSync(ruta, 'utf8').replace(/^﻿/, '');
  const separador = (texto.split('\n')[0].match(/;/g) || []).length >= 1 ? ';' : ',';
  const lineas = partir(texto, separador);
  if (lineas.length === 0) return [];
  const encabezado = lineas[0].map((c) => c.trim().toUpperCase());
  return lineas.slice(1).map((valores) => Object.fromEntries(encabezado.map((c, i) => [c, valores[i] ?? ''])));
}

function partir(texto, separador) {
  const filas = [];
  let fila = [];
  let celdaActual = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        celdaActual += '"';
        i += 1;
      } else if (c === '"') entreComillas = false;
      else celdaActual += c;
      continue;
    }
    if (c === '"') entreComillas = true;
    else if (c === separador) {
      fila.push(celdaActual);
      celdaActual = '';
    } else if (c === '\n') {
      fila.push(celdaActual.replace(/\r$/, ''));
      if (fila.some((x) => x !== '')) filas.push(fila);
      fila = [];
      celdaActual = '';
    } else celdaActual += c;
  }
  fila.push(celdaActual.replace(/\r$/, ''));
  if (fila.some((x) => x !== '')) filas.push(fila);
  return filas;
}

/** Si lo guardaron como libro de Excel, se lee la primera hoja por letra de columna. */
function leerXlsx(ruta) {
  const crudas = leerHoja(ruta);
  if (crudas.length === 0) return [];
  const encabezado = crudas[0];
  const letraDe = {};
  for (const [letra, valor] of Object.entries(encabezado)) {
    if (letra === '_fila') continue;
    letraDe[String(valor).trim().toUpperCase()] = letra;
  }
  return crudas.slice(1).map((f) =>
    Object.fromEntries(COLUMNAS.map((c) => [c, letraDe[c] ? String(f[letraDe[c]] ?? '').trim() : ''])),
  );
}
