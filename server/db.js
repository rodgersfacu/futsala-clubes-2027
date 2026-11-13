// Acceso a la base SQLite integrada de Node (node:sqlite). Sin dependencias externas.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(aqui, '..');

/**
 * Dónde viven los datos. En orden: la variable de entorno, lo que haya anotado
 * `npm run mover-datos`, y si no la carpeta `data` del proyecto.
 *
 * El archivo de ubicación existe para que mover la base no obligue a acordarse de una
 * variable de entorno cada vez que se arranca: quien mueve los datos lo hace una vez y
 * la aplicación se acuerda. No se versiona, porque la ruta es de esta instalación.
 */
export const ARCHIVO_UBICACION = join(RAIZ, 'datos.ubicacion');

function dirAnotado() {
  try {
    const anotado = readFileSync(ARCHIVO_UBICACION, 'utf8').trim();
    return anotado || null;
  } catch {
    return null;
  }
}

export const DIR_DATOS = process.env.FUTSALA_DATOS || dirAnotado() || join(RAIZ, 'data');
export const RUTA_DB = process.env.FUTSALA_DB || join(DIR_DATOS, 'futsala.db');

let db = null;

export function abrirBase({ ruta = RUTA_DB } = {}) {
  if (db) return db;
  if (ruta !== ':memory:') {
    mkdirSync(dirname(ruta), { recursive: true });
  }
  db = new DatabaseSync(ruta);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  // Reconstruir una tabla exige las claves foráneas apagadas y fuera de transacción, así
  // que va antes que nada. Si no hay nada que reconstruir, no toca la base.
  reconstruirTablas(db);
  db.exec('PRAGMA foreign_keys = ON');
  aplicarEsquema(db);
  return db;
}

/**
 * Cambios que no se pueden hacer con ALTER TABLE, como ampliar un CHECK. SQLite obliga a
 * copiar la tabla entera; el procedimiento es el que documenta el propio SQLite.
 *
 * Cada reconstrucción dice cómo reconocer que hace falta, para que no se repita en cada
 * arranque, y copia los datos con una transformación explícita.
 */
function reconstruirTablas(conexion) {
  const definicion = (tabla) =>
    conexion.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(tabla)?.sql || '';

  // La prioridad pasó de tres niveles a cuatro: 1 absoluta, 2 importante, 3 normal,
  // 4 baja. Los valores viejos se trasladan a su equivalente en la escala nueva: la más
  // alta sigue siendo la más alta, la del medio pasa a "normal" y la más baja a "baja".
  const club = definicion('club');
  if (club && club.includes("prioridad IN ('1', '2', '3')") && !club.includes("'4'")) {
    conexion.exec('PRAGMA foreign_keys = OFF');
    conexion.exec('BEGIN IMMEDIATE');
    try {
      const columnas = conexion
        .prepare(`SELECT name FROM pragma_table_info('club')`)
        .all()
        .map((c) => c.name);
      const lista = columnas.join(', ');
      const origen = columnas
        .map((c) => (c === 'prioridad' ? `CASE prioridad WHEN '1' THEN '1' WHEN '2' THEN '3' ELSE '4' END` : c))
        .join(', ');

      conexion.exec(`CREATE TABLE club_nuevo (${cuerpoDeClub(columnas)})`);
      conexion.exec(`INSERT INTO club_nuevo (${lista}) SELECT ${origen} FROM club`);
      conexion.exec('DROP TABLE club');
      conexion.exec('ALTER TABLE club_nuevo RENAME TO club');
      const rotas = conexion.prepare('PRAGMA foreign_key_check').all();
      if (rotas.length > 0) throw new Error(`La reconstrucción de club dejó ${rotas.length} referencias rotas`);
      conexion.exec('COMMIT');
      console.log('  Prioridad de clubes ampliada a cuatro niveles (1 absoluta a 4 baja).');
    } catch (error) {
      conexion.exec('ROLLBACK');
      throw error;
    } finally {
      conexion.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/** Las columnas de `club` tal como quedan después de reconstruirla. */
function cuerpoDeClub(columnas) {
  const tipos = {
    id: 'TEXT PRIMARY KEY',
    nombre: 'TEXT NOT NULL CHECK (length(trim(nombre)) >= 2)',
    nombre_norm: 'TEXT NOT NULL',
    localidad: 'TEXT',
    contacto_nombre: 'TEXT',
    contacto_email: 'TEXT',
    contacto_telefono: 'TEXT',
    responsable_id: 'TEXT REFERENCES usuario(id) ON DELETE RESTRICT',
    analisis_url: 'TEXT',
    contacto_directo: 'INTEGER NOT NULL DEFAULT 0 CHECK (contacto_directo IN (0, 1))',
    activo: 'INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))',
    notas: 'TEXT',
    creado_en: 'TEXT NOT NULL',
    creado_por_id: 'TEXT REFERENCES usuario(id) ON DELETE RESTRICT',
    version: 'INTEGER NOT NULL DEFAULT 1',
    prioridad: `TEXT NOT NULL DEFAULT '3' CHECK (prioridad IN ('1', '2', '3', '4'))`,
  };
  const faltan = columnas.filter((c) => !tipos[c]);
  if (faltan.length > 0) throw new Error(`No sé reconstruir club con estas columnas: ${faltan.join(', ')}`);
  return columnas.map((c) => `${c} ${tipos[c]}`).join(', ');
}

export function base() {
  return db || abrirBase();
}

function aplicarEsquema(conexion) {
  const yaCreada = conexion
    .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'usuario'`)
    .get().n;
  const sql = readFileSync(join(aqui, 'esquema.sql'), 'utf8');
  if (yaCreada) {
    // El esquema es idempotente: volver a aplicarlo crea lo que falte (tablas o índices
    // nuevos) sin tocar lo que ya existe. Cambiar una restricción sigue necesitando
    // recrear la base.
    conexion.exec('BEGIN IMMEDIATE');
    try {
      // El orden importa: primero están las columnas nuevas, después se mudan los datos
      // que las necesitan, recién entonces se sueltan los disparadores que miran las
      // columnas viejas (SQLite no deja borrar una columna que un disparador nombra) y
      // por último se borran esas columnas. El esquema cierra creando lo que falte.
      migrar(conexion);
      mudarDatos(conexion);
      refrescarDisparadores(conexion, sql);
      quitarColumnas(conexion);
      conexion.exec(sql);
      conexion.exec('COMMIT');
    } catch (error) {
      conexion.exec('ROLLBACK');
      throw error;
    }
    return;
  }
  conexion.exec('BEGIN IMMEDIATE');
  try {
    conexion.exec(sql);
    conexion.exec('COMMIT');
  } catch (error) {
    conexion.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Agrega columnas nuevas a bases ya creadas. Solo se agregan columnas opcionales:
 * ninguna migración borra ni reescribe datos existentes.
 */
const COLUMNAS_AGREGADAS = [
  ['plan_detalle', 'divisiones_2026', 'TEXT'],
  ['plan_detalle', 'intencion_2027', 'TEXT'],
  ['plan_detalle', 'acordado_texto', 'TEXT'],
  ['reunion', 'nota', 'TEXT'],
  ['reunion', 'fecha_recontacto', 'TEXT'],
  ['club', 'prioridad', `TEXT NOT NULL DEFAULT '3' CHECK (prioridad IN ('1', '2', '3', '4'))`],
  ['reconfirmacion', 'reunion_id', 'TEXT REFERENCES reunion(id) ON DELETE RESTRICT'],
  // Ingreso con contraseña y con Google (Firebase).
  ['usuario', 'clave_hash', 'TEXT'],
  ['usuario', 'google_sub', 'TEXT'],
];

/**
 * Columnas que dejaron de usarse. Se quitan recién cuando nada las lee: el valor que
 * tuvieran ya se mudó en `mudarDatos`, y el respaldo previo al cambio lo conserva.
 */
const COLUMNAS_QUITADAS = [
  // La prioridad pasó a ser del club: no cambia porque empiece un ciclo nuevo.
  ['plan', 'prioridad'],
  // Quién atiende al club ya estaba en el club; tenerlo dos veces invitaba a que
  // dijeran cosas distintas.
  ['plan', 'responsable_id'],
  // Las notas de preparación ahora son notas de la reunión, donde se usan.
  ['plan', 'balance'],
  ['plan', 'objetivo'],
  ['plan', 'riesgos'],
  ['plan', 'fecha_objetivo'],
];

/** Mudanzas de datos entre columnas, antes de que la vieja desaparezca. */
function mudarDatos(conexion) {
  if (tiene(conexion, 'plan', 'prioridad') && tiene(conexion, 'club', 'prioridad')) {
    // Un club tiene un plan por ciclo; si hubiera más de uno, gana la prioridad más
    // alta, que es la que no conviene perder de vista.
    conexion.exec(`
      UPDATE club SET prioridad = (
        SELECT min(p.prioridad) FROM plan p WHERE p.club_id = club.id
      ) WHERE EXISTS (SELECT 1 FROM plan p WHERE p.club_id = club.id)`);
  }
}

function quitarColumnas(conexion) {
  for (const [tabla, columna] of COLUMNAS_QUITADAS) {
    if (tiene(conexion, tabla, columna)) {
      conexion.exec(`ALTER TABLE ${tabla} DROP COLUMN ${columna}`);
    }
  }
}

function tiene(conexion, tabla, columna) {
  return (
    conexion.prepare(`SELECT count(*) AS n FROM pragma_table_info(?) WHERE name = ?`).get(tabla, columna).n > 0
  );
}

/**
 * Los disparadores se crean con IF NOT EXISTS, así que cambiarle el cuerpo a uno que ya
 * existe no tendría efecto: la base seguiría aplicando la regla vieja en silencio, que es
 * la peor forma de equivocarse. Acá se compara el texto guardado contra el del archivo y
 * se borra el que cambió, para que el esquema lo vuelva a crear enseguida.
 *
 * El archivo manda: un disparador que ya no está en él también se borra, porque si no
 * una regla retirada seguiría aplicándose para siempre en las bases viejas.
 *
 * Solo toca disparadores: son reglas sin datos propios, recrearlos no pierde nada.
 */
function refrescarDisparadores(conexion, sql) {
  const enArchivo = new Map();
  for (const bloque of sql.matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)[\s\S]*?\nEND;/g)) {
    enArchivo.set(bloque[1], normalizarSql(bloque[0]));
  }
  const guardados = conexion
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger'`)
    .all();
  for (const { name, sql: guardado } of guardados) {
    const esperado = enArchivo.get(name);
    if (!esperado || esperado !== normalizarSql(guardado)) {
      conexion.exec(`DROP TRIGGER ${name}`);
    }
  }
}

/**
 * Deja dos textos SQL comparables. SQLite guarda el disparador sin el "IF NOT EXISTS" que
 * sí está en el archivo, y sin el punto y coma final: sin quitarlos, cada arranque
 * creería que todos cambiaron y los recrearía a todos.
 */
function normalizarSql(texto) {
  return String(texto)
    .replace(/--[^\n]*/g, ' ')
    .replace(/CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS/i, 'CREATE TRIGGER')
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .trim();
}

function migrar(conexion) {
  for (const [tabla, columna, tipo] of COLUMNAS_AGREGADAS) {
    const existe = conexion
      .prepare(`SELECT count(*) AS n FROM pragma_table_info(?) WHERE name = ?`)
      .get(tabla, columna).n;
    if (!existe) {
      conexion.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${tipo}`);
    }
  }
}

export function uno(sql, ...params) {
  const fila = base().prepare(sql).get(...params);
  return fila === undefined ? null : normalizar(fila);
}

export function todos(sql, ...params) {
  return base().prepare(sql).all(...params).map(normalizar);
}

export function ejecutar(sql, ...params) {
  return base().prepare(sql).run(...params);
}

function normalizar(fila) {
  // node:sqlite devuelve objetos sin prototipo; conviene uno normal para el resto del codigo.
  return fila ? { ...fila } : fila;
}

let profundidad = 0;

/** Ejecuta fn dentro de una transaccion. Anidar reutiliza la transaccion abierta. */
export function enTransaccion(fn) {
  const conexion = base();
  if (profundidad > 0) {
    profundidad += 1;
    try {
      return fn();
    } finally {
      profundidad -= 1;
    }
  }
  conexion.exec('BEGIN IMMEDIATE');
  profundidad = 1;
  try {
    const resultado = fn();
    conexion.exec('COMMIT');
    return resultado;
  } catch (error) {
    try {
      conexion.exec('ROLLBACK');
    } catch {
      // si la transaccion ya se deshizo, el error original es el relevante
    }
    throw error;
  } finally {
    profundidad = 0;
  }
}

export function cerrarBase() {
  if (db) {
    db.close();
    db = null;
  }
}

export function baseExiste() {
  return existsSync(RUTA_DB);
}
