// Historial de auditoría y escritura con control de versión.
import { uno, todos, ejecutar } from '../db.js';
import { nuevoId } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNoEncontrado, ErrorConflictoVersion } from '../lib/errores.js';
import { ordenPorPlanilla } from '../lib/disciplinas.js';

/**
 * Agrega un evento al historial. Pensado para usarse siempre dentro de enTransaccion:
 * si la operación de negocio falla, el evento se deshace con ella, y si el evento
 * falla, el cambio de negocio no queda sin auditoría.
 */
export function registrar({
  actor,
  tipo,
  entidad,
  entidadId,
  planId = null,
  reunionId = null,
  reconfirmacionId = null,
  motivo = null,
  estadoAnterior = null,
  estadoPosterior = null,
  datosAnteriores = null,
  datosPosteriores = null,
}) {
  const id = nuevoId();
  ejecutar(
    `INSERT INTO historial (id, ocurrido_en, actor_id, tipo, entidad, entidad_id, plan_id, reunion_id,
                            reconfirmacion_id, motivo, estado_anterior, estado_posterior,
                            datos_anteriores, datos_posteriores)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    ahora(),
    actor.id,
    tipo,
    entidad,
    entidadId,
    planId,
    reunionId,
    reconfirmacionId,
    motivo,
    estadoAnterior,
    estadoPosterior,
    datosAnteriores ? JSON.stringify(datosAnteriores) : null,
    datosPosteriores ? JSON.stringify(datosPosteriores) : null,
  );
  return id;
}

/** Copia íntegra de un plan y todo lo que cuelga de él, para guardar antes de reabrir. */
export function instantaneaPlan(planId) {
  const plan = uno('SELECT * FROM plan WHERE id = ?', planId);
  if (!plan) return null;
  return {
    plan,
    club: uno('SELECT id, nombre, localidad FROM club WHERE id = ?', plan.club_id),
    disciplinas: todos(
      `SELECT disciplina, divisiones_2026, intencion_2027, tiras_base, tiras_propuestas,
              acordado_texto, tiras_reconfirmadas, observaciones, reunion_acuerdo_id
       FROM plan_detalle WHERE plan_id = ? ORDER BY ${ordenPorPlanilla()}`,
      planId,
    ),
    reuniones: todos(
      `SELECT id, inicio, fin, estado, acta_estado, acta, devolucion_club, proximo_paso,
              delegados_presentes, acta_validada_por_id, acta_validada_en
       FROM reunion WHERE plan_id = ? ORDER BY IFNULL(inicio, creado_en)`,
      planId,
    ),
    reconfirmacion: uno('SELECT * FROM reconfirmacion WHERE plan_id = ?', planId),
    compromisos: todos(
      `SELECT c.id, c.descripcion, c.estado, c.fecha_limite, c.resolucion
       FROM compromiso c JOIN reunion m ON m.id = c.reunion_id
       WHERE m.plan_id = ? ORDER BY c.fecha_limite`,
      planId,
    ),
  };
}

export function instantaneaReunion(reunionId) {
  const reunion = uno('SELECT * FROM reunion WHERE id = ?', reunionId);
  if (!reunion) return null;
  return {
    reunion,
    disciplinasAcordadas: todos(
      `SELECT disciplina, acordado_texto FROM plan_detalle WHERE reunion_acuerdo_id = ? ORDER BY ${ordenPorPlanilla()}`,
      reunionId,
    ),
    compromisos: todos('SELECT id, descripcion, estado FROM compromiso WHERE reunion_id = ?', reunionId),
  };
}

export function instantaneaReconfirmacion(reconfirmacionId) {
  const ficha = uno('SELECT * FROM reconfirmacion WHERE id = ?', reconfirmacionId);
  if (!ficha) return null;
  return {
    reconfirmacion: ficha,
    cantidadesFinales: todos(
      `SELECT disciplina, tiras_reconfirmadas FROM plan_detalle WHERE plan_id = ? ORDER BY ${ordenPorPlanilla()}`,
      ficha.plan_id,
    ),
  };
}

/**
 * UPDATE con control de versión optimista. Si otra persona guardó antes, la segunda
 * escritura no pisa la primera: devuelve conflicto con las diferencias.
 * Los nombres de tabla y columna son literales internos, nunca entrada del usuario.
 */
export function actualizar({ tabla, id, campos, version = null, etiquetas = {}, volverA = '/' }) {
  const actual = uno(`SELECT * FROM ${tabla} WHERE id = ?`, id);
  if (!actual) throw new ErrorNoEncontrado();

  if (version !== null && Number(actual.version) !== Number(version)) {
    throw conflicto({ tabla, actual, campos, version, etiquetas, volverA });
  }

  const columnas = Object.keys(campos);
  if (columnas.length === 0) return actual;
  const asignaciones = columnas.map((c) => `${c} = ?`).join(', ');
  const resultado = ejecutar(
    `UPDATE ${tabla} SET ${asignaciones}, version = version + 1 WHERE id = ? AND version = ?`,
    ...columnas.map((c) => campos[c]),
    id,
    actual.version,
  );
  if (resultado.changes === 0) {
    throw conflicto({ tabla, actual, campos, version, etiquetas, volverA });
  }
  return uno(`SELECT * FROM ${tabla} WHERE id = ?`, id);
}

function conflicto({ tabla, actual, campos, version, etiquetas, volverA }) {
  const diferencias = [];
  for (const [campo, valor] of Object.entries(campos)) {
    const enBase = actual[campo];
    if (String(enBase ?? '') !== String(valor ?? '')) {
      diferencias.push({
        campo,
        etiqueta: etiquetas[campo] || campo,
        enviado: valor,
        actual: enBase,
      });
    }
  }
  return new ErrorConflictoVersion({
    entidad: tabla,
    id: actual.id,
    versionEnviada: version,
    versionActual: actual.version,
    diferencias,
    volverA,
  });
}
