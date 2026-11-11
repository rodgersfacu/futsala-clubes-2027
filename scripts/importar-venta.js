// Importa la hoja de venta (PROYECCION 27) a la aplicación.
//
// La hoja tiene, por club, cuatro disciplinas fijas (Masculino, Promocionales, Femenino,
// Veteranos) con lo que jugó en 2026 (divisiones, una por línea) y lo que FUTSALA
// pretende para 2027, escrito en palabras ("Mantener", "Armar", "Traer de…").
//
// Por eso:
//   · "Tiras 2026" se cuenta como cantidad de divisiones listadas en la celda.
//   · La cantidad pretendida para 2027 queda VACÍA: la planilla no trae números,
//     y vacío significa "todavía no se sabe", nunca cero.
//   · El texto completo de ambas columnas se guarda tal cual, sin interpretarlo.
//
// Uso:
//   node scripts/importar-venta.js --archivo "ruta/VENTA.xlsx"               (simulación)
//   node scripts/importar-venta.js --archivo "ruta/VENTA.xlsx" --confirmar   (escribe)
//
// Opciones:
//   --hoja "PROYECCION 27"     nombre de la hoja (por omisión, esa)
//   --responsable correo@…     responsable de FUTSALA para los clubes y planes creados
//   --limite 10                importa solo los primeros N clubes (para probar)
import { abrirBase, uno, todos, ejecutar, enTransaccion } from '../server/db.js';
import { nuevoId } from '../server/auth.js';
import { ahora } from '../server/lib/fechas.js';
import { normalizar } from '../server/lib/validar.js';
import { registrar } from '../server/dominio/registro.js';
import { leerHoja } from './lib/xlsx.js';

const argumentos = process.argv.slice(2);
const valorDe = (bandera, porOmision = null) => {
  const i = argumentos.indexOf(bandera);
  return i === -1 ? porOmision : argumentos[i + 1];
};

const archivo = valorDe('--archivo');
const nombreHoja = valorDe('--hoja', 'PROYECCION 27');
const confirmar = argumentos.includes('--confirmar');
const correoResponsable = valorDe('--responsable');
const limite = Number(valorDe('--limite', '0')) || 0;

if (!archivo) {
  console.error('Falta --archivo "ruta/VENTA.xlsx". Agregá --confirmar para escribir de verdad.');
  process.exit(1);
}

// Columnas de la hoja: B = club; D a G = 2026; I a L = 2027.
const DISCIPLINAS = [
  { nombre: 'Masculino', col2026: 'D', col2027: 'I' },
  { nombre: 'Promocionales', col2026: 'E', col2027: 'J' },
  { nombre: 'Femenino', col2026: 'F', col2027: 'K' },
  { nombre: 'Veteranos', col2026: 'G', col2027: 'L' },
];
const COLUMNA_CLUB = 'B';
const PRIMERA_FILA = 3;
// Columna opcional para marcar los clubes que contactan los directivos. Se busca por
// su encabezado en la fila 2: alcanza con escribir "Directivos" y poner una x debajo.
const ENCABEZADO_DIRECTIVOS = /directiv|contacto directo|^directo$/i;

abrirBase();

const todasLasFilas = leerHoja(archivo, nombreHoja);
const columnaDirectivos = ubicarColumnaDirectivos(todasLasFilas);
const filas = todasLasFilas.filter((f) => f._fila >= PRIMERA_FILA && limpiar(f[COLUMNA_CLUB]));
const clubes = limite > 0 ? filas.slice(0, limite) : filas;

const informe = {
  clubesCreados: 0,
  directivos: 0,
  clubesExistentes: 0,
  planesCreados: 0,
  planesExistentes: 0,
  disciplinasCreadas: 0,
  disciplinasActualizadas: 0,
  parecidos: [],
  omitidos: [],
};

try {
  enTransaccion(() => {
    const actor = actorDeImportacion();
    const responsableId = resolverResponsable();
    const parametros = uno(`SELECT * FROM parametros WHERE id = 'CICLO-2027'`) || {
      anio_cierre: 2026,
      anio_objetivo: 2027,
    };

    for (const fila of clubes) {
      importarClub(fila, { actor, responsableId, parametros });
    }

    registrar({
      actor,
      tipo: 'importacion.realizada',
      entidad: 'importacion',
      entidadId: `${nombreHoja}`,
      motivo: `Importación de la planilla de venta (${nombreHoja})`,
      datosPosteriores: {
        clubes: informe.clubesCreados,
        planes: informe.planesCreados,
        disciplinas: informe.disciplinasCreadas,
      },
    });

    if (!confirmar) throw new Error('__SIMULACION__');
  });
} catch (error) {
  if (error.message !== '__SIMULACION__') throw error;
}

imprimirInforme();

// --- Importación -------------------------------------------------------------

function importarClub(fila, { actor, responsableId, parametros }) {
  const nombre = limpiar(fila[COLUMNA_CLUB]);
  const norma = normalizar(nombre);
  const directo = columnaDirectivos && limpiar(fila[columnaDirectivos]) ? 1 : 0;

  let club = uno('SELECT * FROM club WHERE nombre_norm = ?', norma);
  if (club) {
    informe.clubesExistentes += 1;
    if (columnaDirectivos && club.contacto_directo !== directo) {
      ejecutar('UPDATE club SET contacto_directo = ?, version = version + 1 WHERE id = ?', directo, club.id);
      informe.directivos += directo === 1 ? 1 : 0;
    }
  } else {
    const parecido = todos('SELECT nombre FROM club').find((otro) => {
      const otraNorma = normalizar(otro.nombre);
      return otraNorma !== norma && (otraNorma.includes(norma) || norma.includes(otraNorma));
    });
    if (parecido) informe.parecidos.push(`${nombre} se parece a ${parecido.nombre}`);

    const id = nuevoId();
    ejecutar(
      `INSERT INTO club (id, nombre, nombre_norm, responsable_id, activo, contacto_directo, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      id,
      nombre,
      norma,
      responsableId,
      directo,
      ahora(),
      actor.id,
    );
    club = uno('SELECT * FROM club WHERE id = ?', id);
    informe.clubesCreados += 1;
    if (directo === 1) informe.directivos += 1;
    registrar({
      actor,
      tipo: 'club.creado',
      entidad: 'club',
      entidadId: id,
      motivo: `Importado de la planilla de venta, fila ${fila._fila}`,
      datosPosteriores: { nombre },
    });
  }

  let plan = uno('SELECT * FROM plan WHERE club_id = ? AND anio_objetivo = ?', club.id, parametros.anio_objetivo);
  if (plan) {
    informe.planesExistentes += 1;
  } else {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO plan (id, club_id, anio_cierre, anio_objetivo, estado, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, 'Abierta', ?, ?)`,
      id,
      club.id,
      parametros.anio_cierre,
      parametros.anio_objetivo,
      ahora(),
      actor.id,
    );
    plan = uno('SELECT * FROM plan WHERE id = ?', id);
    informe.planesCreados += 1;
    registrar({
      actor,
      tipo: 'plan.creado',
      entidad: 'plan',
      entidadId: id,
      planId: id,
      estadoPosterior: 'Borrador',
      motivo: `Importado de la planilla de venta, fila ${fila._fila}`,
    });
  }

  if (plan.estado === 'Cerrada' || plan.estado === 'Archivada') {
    informe.omitidos.push(`${nombre}: el plan está ${plan.estado.toLowerCase()} y no se toca.`);
    return;
  }

  // Con un acta aprobada, lo de 2026 y lo pretendido ya se conversaron con el club y la
  // base los tiene bloqueados. Volver a importar la planilla no puede pisarlos: el club
  // se omite y se informa, en lugar de que la importación entera se caiga contra el
  // disparador. Para corregirlos hay que reabrir el acta, que es una decisión de Dirección.
  const actaAprobada = uno(
    `SELECT count(*) AS n FROM reunion WHERE plan_id = ? AND acta_estado = 'Validada'`,
    plan.id,
  ).n > 0;
  if (actaAprobada) {
    informe.omitidos.push(`${nombre}: tiene un acta aprobada; sus cantidades quedaron fijas.`);
    return;
  }

  for (const disciplina of DISCIPLINAS) {
    const divisiones = limpiar(fila[disciplina.col2026]);
    const intencion = limpiar(fila[disciplina.col2027]);
    if (!divisiones && !intencion) continue;

    // La planilla es la fuente: su texto entra tal cual, con los saltos de línea y los
    // números que tenga escritos. Ninguna cantidad se deduce acá. "Liga de Honor B / 1ra a
    // 5ta BAFI" no son "2 tiras" hasta que alguien lo decida, y "4 Categorías" tampoco son
    // 4. Las cantidades se cargan desde la app, cuando se habló con el club.
    const base = leerCelda(divisiones);
    const pretendido = leerCelda(intencion);

    const norma = normalizar(disciplina.nombre);
    const existente = uno('SELECT * FROM plan_detalle WHERE plan_id = ? AND disciplina_norm = ?', plan.id, norma);

    if (!existente) {
      ejecutar(
        `INSERT INTO plan_detalle (id, plan_id, disciplina, disciplina_norm, tiras_base, tiras_propuestas,
                                   divisiones_2026, intencion_2027, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nuevoId(),
        plan.id,
        disciplina.nombre,
        norma,
        base.tiras,
        pretendido.tiras,
        base.texto,
        pretendido.texto,
        ahora(),
      );
      informe.disciplinasCreadas += 1;
    } else if (
      existente.divisiones_2026 !== base.texto ||
      existente.intencion_2027 !== pretendido.texto ||
      existente.tiras_base !== base.tiras ||
      existente.tiras_propuestas !== pretendido.tiras
    ) {
      // Solo se completa lo que la planilla trae; nunca se pisa una cantidad ya acordada.
      ejecutar(
        `UPDATE plan_detalle
         SET divisiones_2026 = ?, intencion_2027 = ?, tiras_base = ?, tiras_propuestas = ?, version = version + 1
         WHERE id = ?`,
        base.texto,
        pretendido.texto,
        base.tiras,
        pretendido.tiras,
        existente.id,
      );
      informe.disciplinasActualizadas += 1;
    }
  }
}

/**
 * Lee una celda de la planilla sin interpretarla. El texto que escribió FUTSALA es el
 * dato: entra tal cual, con sus saltos de línea y con los números que tenga adentro.
 *
 *   "2 (Elite A, Liga de Honor B)"       → se guarda así, entero
 *   "Liga de Honor B" + "1ra a 5ta BAFI" → se guarda así, en dos líneas
 *   "4 Categorías"                       → se guarda así; no son 4 tiras
 *   "Mantener"                           → se guarda así
 *   vacía                                → sin dato
 *
 * Lo único que se toca es el espacio sobrante al principio y al final de cada línea, y
 * las líneas en blanco, que en la planilla son formato y no información.
 *
 * La cantidad de tiras nunca se deduce de acá: se carga desde la app cuando se habló con
 * el club, y queda en blanco mientras tanto.
 */
function leerCelda(celda) {
  if (!celda) return { tiras: null, texto: null };
  const texto = celda
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .join('\n');
  return { tiras: null, texto: texto || null };
}

/** Busca en la fila de encabezados una columna que marque el contacto de Dirección. */
function ubicarColumnaDirectivos(filas) {
  const encabezado = filas.find((f) => f._fila === 2);
  if (!encabezado) return null;
  for (const [columna, valor] of Object.entries(encabezado)) {
    if (columna === '_fila') continue;
    if (ENCABEZADO_DIRECTIVOS.test(limpiar(valor))) return columna;
  }
  return null;
}

function limpiar(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).replace(/\r/g, '').trim();
}

function resolverResponsable() {
  if (!correoResponsable) return null;
  const usuario = uno('SELECT * FROM usuario WHERE email = ?', correoResponsable.toLowerCase().trim());
  if (!usuario) {
    console.error(`No existe un usuario con el correo ${correoResponsable}. Cargalo antes de usar --responsable.`);
    process.exit(1);
  }
  return usuario.id;
}

function actorDeImportacion() {
  const existente = uno(`SELECT * FROM usuario WHERE rol = 'Direccion' AND activo = 1 ORDER BY creado_en LIMIT 1`);
  if (existente) return existente;
  const id = nuevoId();
  ejecutar(
    `INSERT INTO usuario (id, email, nombre, rol, activo, creado_en)
     VALUES (?, 'importacion@example.invalid', 'Importación de datos', 'Direccion', 0, ?)`,
    id,
    ahora(),
  );
  return uno('SELECT * FROM usuario WHERE id = ?', id);
}

function imprimirInforme() {
  console.log('');
  console.log(`Planilla: ${archivo}`);
  console.log(`Hoja: ${nombreHoja}${limite ? ` (limitado a ${limite} clubes)` : ''}`);
  console.log(confirmar ? 'Modo: ESCRITURA' : 'Modo: SIMULACIÓN — no se escribió nada');
  console.log('');
  console.log(`  Clubes en la planilla:        ${clubes.length}`);
  console.log(`  Clubes creados:               ${informe.clubesCreados}`);
  console.log(`  Clubes que ya existían:       ${informe.clubesExistentes}`);
  console.log(`  Planes 2026/2027 creados:     ${informe.planesCreados} (abiertos)`);
  console.log(`  Planes que ya existían:       ${informe.planesExistentes}`);
  console.log(`  Disciplinas creadas:          ${informe.disciplinasCreadas}`);
  console.log(`  Disciplinas actualizadas:     ${informe.disciplinasActualizadas}`);
  console.log(
    `  Contacto de Dirección:        ${
      columnaDirectivos ? `${informe.directivos} club(es), columna ${columnaDirectivos}` : 'sin columna en la planilla'
    }`,
  );
  console.log('');
  console.log('  Las cantidades de tiras no se importan: la planilla guarda lo que FUTSALA');
  console.log('  escribió, tal cual, y el número se carga desde la app al hablar con el club.');
  if (informe.parecidos.length > 0) {
    console.log('');
    console.log(`  Nombres parecidos (aviso, se importaron igual): ${informe.parecidos.length}`);
    for (const item of informe.parecidos.slice(0, 10)) console.log(`    · ${item}`);
  }
  if (informe.omitidos.length > 0) {
    console.log('');
    console.log('  Omitidos:');
    for (const item of informe.omitidos) console.log(`    · ${item}`);
  }
  console.log('');
  if (!confirmar) console.log('Para escribir de verdad, repetí el comando con --confirmar.');
  console.log('');
}
