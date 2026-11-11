import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion, exigirActivo } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { ordenPorPlanilla } from '../lib/disciplinas.js';
import { registrar, actualizar, instantaneaPlan } from './registro.js';

export const ESTADOS = ['Abierta', 'Cerrada', 'Archivada'];

export function obtener(id) {
  return uno('SELECT * FROM plan WHERE id = ?', id);
}

export function exigir(id) {
  const plan = obtener(id);
  if (!plan) throw new ErrorNoEncontrado('Ese plan no existe.');
  return plan;
}

export function porClub(clubId, anioObjetivo = 2027) {
  return uno('SELECT * FROM plan WHERE club_id = ? AND anio_objetivo = ?', clubId, anioObjetivo);
}

export function detalles(planId) {
  return todos(
    `SELECT d.*, m.inicio AS acuerdo_inicio, m.acta_estado AS acuerdo_acta_estado
     FROM plan_detalle d
     LEFT JOIN reunion m ON m.id = d.reunion_acuerdo_id
     WHERE d.plan_id = ?
     ORDER BY ${ordenPorPlanilla('d')}`,
    planId,
  );
}

export function detalle(id) {
  return uno('SELECT * FROM plan_detalle WHERE id = ?', id);
}

/** Qué está bloqueado y por qué. La interfaz lo explica; el servidor lo aplica. */
export function bloqueos(plan) {
  const actaValidada = uno(
    `SELECT count(*) AS n FROM reunion WHERE plan_id = ? AND acta_estado = 'Validada'`,
    plan.id,
  ).n > 0;
  const reconValidada = uno(
    'SELECT count(*) AS n FROM reconfirmacion WHERE plan_id = ? AND validada_en IS NOT NULL',
    plan.id,
  ).n > 0;
  const planCerrado = plan.estado === 'Cerrada' || plan.estado === 'Archivada';

  return {
    planCerrado,
    actaValidada,
    reconValidada,
    // Lo de 2026 y lo pretendido quedan fijos cuando hay un acta aprobada: a partir de
    // ahí es lo que se conversó con el club.
    base: planCerrado
      ? 'El plan está cerrado.'
      : actaValidada
        ? 'Lo de 2026 quedó fijo al aprobar el acta.'
        : null,
    propuesta: planCerrado
      ? 'El plan está cerrado.'
      : actaValidada
        ? 'Ya hay un acta aprobada: lo pretendido quedó fijo.'
        : null,
    finales: planCerrado
      ? 'El plan está cerrado.'
      : reconValidada
        ? 'La reconfirmación está aprobada: las cantidades finales quedaron fijas.'
        : null,
  };
}

/** Lista legible de lo que falta para cerrar el plan. */
export function faltantesParaCerrar(planId) {
  const plan = exigir(planId);
  const faltan = [];
  const actas = uno(`SELECT count(*) AS n FROM reunion WHERE plan_id = ? AND acta_estado = 'Validada'`, planId).n;
  if (actas === 0) faltan.push('Aprobar el acta de la reunión.');
  const recon = uno(
    `SELECT * FROM reconfirmacion WHERE plan_id = ? AND validada_en IS NOT NULL
      AND estado IN ('Confirmado','No continua')`,
    planId,
  );
  if (!recon) faltan.push('Validar el resultado final de la reconfirmación (Confirmado o No continúa).');
  const abiertas = todos(
    `SELECT c.descripcion FROM compromiso c JOIN reunion m ON m.id = c.reunion_id
     WHERE m.plan_id = ? AND c.estado IN ('Pendiente','En curso') ORDER BY c.fecha_limite`,
    planId,
  );
  for (const tarea of abiertas) faltan.push(`Resolver el compromiso: ${tarea.descripcion}`);
  const conflictos = uno(
    `SELECT count(*) AS n FROM conflicto WHERE plan_id = ? AND estado = 'Abierto'`,
    planId,
  ).n;
  if (conflictos > 0) faltan.push('Resolver el conflicto de datos duplicados del plan.');
  return faltan;
}

export function crear(actor, clubId, datos = {}) {
  exigirDireccion(actor, 'crear planes del ciclo');
  const club = uno('SELECT * FROM club WHERE id = ?', clubId);
  if (!club) throw new ErrorNoEncontrado('Ese club no existe.');

  const param = uno(`SELECT * FROM parametros WHERE id = 'CICLO-2027'`);
  const anioObjetivo = param ? param.anio_objetivo : 2027;
  const anioCierre = param ? param.anio_cierre : anioObjetivo - 1;

  if (porClub(club.id, anioObjetivo)) {
    throw new ErrorNegocio(`${club.nombre} ya tiene un plan para el ciclo ${anioCierre}/${anioObjetivo}.`);
  }

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO plan (id, club_id, anio_cierre, anio_objetivo, estado, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, 'Abierta', ?, ?)`,
      id,
      club.id,
      anioCierre,
      anioObjetivo,
      ahora(),
      actor.id,
    );
    registrar({
      actor,
      tipo: 'plan.creado',
      entidad: 'plan',
      entidadId: id,
      planId: id,
      estadoPosterior: 'Abierta',
      datosPosteriores: { club: club.nombre, anio_cierre: anioCierre, anio_objetivo: anioObjetivo },
    });
    return obtener(id);
  });
}

// El plan no se edita: no tiene datos propios. Lo que se prepara va a la nota de la
// reunión, lo que se acuerda al acta, y la prioridad y el responsable son del club.

// --- Disciplinas y tiras ------------------------------------------------------

export function agregarDisciplina(actor, planId, datos) {
  exigirDireccion(actor, 'agregar disciplinas');
  const plan = exigir(planId);
  const cerrojos = bloqueos(plan);
  if (cerrojos.planCerrado) throw new ErrorNegocio('El plan está cerrado: no se agregan disciplinas.');

  const disciplina = v.textoObligatorio(datos.disciplina, 'La disciplina', { minimo: 2 });
  const norma = v.normalizar(disciplina);
  if (uno('SELECT id FROM plan_detalle WHERE plan_id = ? AND disciplina_norm = ?', planId, norma)) {
    throw new ErrorNegocio(`La disciplina "${disciplina}" ya está en el plan.`);
  }
  const base = v.cantidad(datos.tiras_base, 'La base 2026');
  const propuestas = v.cantidad(datos.tiras_propuestas, 'La propuesta 2027');
  // Lo de 2026 queda fijo con el acta aprobada, igual que al editar una disciplina que ya
  // existe: si no, se colaba una base nueva por el alta.
  if (cerrojos.actaValidada && base !== null) {
    throw new ErrorNegocio('Ya hay un acta aprobada: lo de 2026 quedó fijo y no se carga base nueva.');
  }
  if (cerrojos.actaValidada && propuestas !== null) {
    throw new ErrorNegocio('Ya hay un acta aprobada: la propuesta del plan quedó fija.');
  }

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO plan_detalle (id, plan_id, disciplina, disciplina_norm, tiras_base, tiras_propuestas,
                                 observaciones, divisiones_2026, intencion_2027, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      planId,
      disciplina,
      norma,
      base,
      propuestas,
      v.texto(datos.observaciones),
      v.texto(datos.divisiones_2026),
      v.texto(datos.intencion_2027),
      ahora(),
    );
    registrar({
      actor,
      tipo: 'disciplina.creada',
      entidad: 'plan_detalle',
      entidadId: id,
      planId,
      datosPosteriores: { disciplina, tiras_base: base, tiras_propuestas: propuestas },
    });
    return detalle(id);
  });
}

/**
 * Guarda cantidades de una disciplina respetando qué etapa está aprobada.
 * Cada cantidad acordada queda vinculada al acta que la aprobó.
 */
export function editarDisciplina(actor, detalleId, datos) {
  exigirActivo(actor);
  const fila = detalle(detalleId);
  if (!fila) throw new ErrorNoEncontrado('Esa disciplina no existe.');
  const plan = exigir(fila.plan_id);
  const cerrojos = bloqueos(plan);
  if (cerrojos.planCerrado) throw new ErrorNegocio('El plan está cerrado: las disciplinas están bloqueadas.');

  const esDireccion = actor.rol === 'Direccion';
  if (!esDireccion) throw new ErrorNegocio('Solo Dirección edita las cantidades del plan.', { estado: 403 });

  // Un campo ausente del envío significa "sin cambios"; una cadena vacía sí borra el dato.
  const leer = (clave, etiqueta) =>
    datos[clave] === undefined ? fila[clave] : v.cantidad(datos[clave], etiqueta);

  const campos = {};
  if (datos.observaciones !== undefined) campos.observaciones = v.texto(datos.observaciones);

  // Lo que jugó en 2026 y lo que se pretende para 2027, en palabras.
  // Lo que jugó en 2026 y lo que se pretende para 2027, en palabras. Quedan fijos al aprobar el acta.
  if (datos.divisiones_2026 !== undefined) {
    const divisiones = v.texto(datos.divisiones_2026);
    if (divisiones !== fila.divisiones_2026) {
      if (cerrojos.base) throw new ErrorNegocio(cerrojos.base);
      campos.divisiones_2026 = divisiones;
    }
  }
  if (datos.intencion_2027 !== undefined) {
    const intencion = v.texto(datos.intencion_2027);
    if (intencion !== fila.intencion_2027) {
      if (cerrojos.propuesta) throw new ErrorNegocio(cerrojos.propuesta);
      campos.intencion_2027 = intencion;
    }
  }

  const base = leer('tiras_base', 'La base 2026');
  if (base !== fila.tiras_base) {
    if (cerrojos.base) throw new ErrorNegocio(cerrojos.base);
    campos.tiras_base = base;
  }

  const propuestas = leer('tiras_propuestas', 'La propuesta 2027');
  if (propuestas !== fila.tiras_propuestas) {
    if (cerrojos.propuesta) throw new ErrorNegocio(cerrojos.propuesta);
    campos.tiras_propuestas = propuestas;
  }

  // Lo acordado no se carga desde acá: es contenido del acta de la reunión donde se
  // acordó, y se escribe ahí mismo, junto con el resto de lo que se conversó. Esta
  // pantalla lo muestra, no lo edita; así no hay dos lugares donde cargar lo mismo.
  const pidenAcordado =
    (datos.tiras_acordadas !== undefined && v.cantidad(datos.tiras_acordadas, 'Lo acordado') !== fila.tiras_acordadas) ||
    (datos.acordado_texto !== undefined && v.texto(datos.acordado_texto) !== fila.acordado_texto) ||
    (datos.reunion_acuerdo_id !== undefined && v.texto(datos.reunion_acuerdo_id) !== fila.reunion_acuerdo_id);
  if (pidenAcordado) {
    throw new ErrorNegocio('Lo acordado se carga en el acta de la reunión donde se acordó.', {
      ayuda: 'Abrí la reunión y completá "Lo que se acordó". Desde acá se ve, no se edita.',
    });
  }

  const finales = leer('tiras_reconfirmadas', 'La cantidad final');
  if (finales !== fila.tiras_reconfirmadas) {
    if (cerrojos.finales) throw new ErrorNegocio(cerrojos.finales);
    campos.tiras_reconfirmadas = finales;
  }

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'plan_detalle',
      id: detalleId,
      campos,
      version: datos.version ?? null,
      etiquetas: {
        tiras_base: 'Base 2026',
        tiras_propuestas: 'Propuesta 2027',
        tiras_reconfirmadas: 'Finales',
        observaciones: 'Observaciones',
      },
      volverA: `/clubes/${plan.club_id}`,
    });
    registrar({
      actor,
      tipo: 'disciplina.editada',
      entidad: 'plan_detalle',
      entidadId: detalleId,
      planId: plan.id,
      datosAnteriores: fila,
      datosPosteriores: guardado,
    });
    return guardado;
  });
}

// --- Estado del plan ---------------------------------------------------------

export function cerrar(actor, planId, datos = {}) {
  exigirDireccion(actor, 'cerrar el plan');
  const plan = exigir(planId);
  if (plan.estado === 'Cerrada') return plan;
  if (plan.estado === 'Archivada') throw new ErrorNegocio('El plan está archivado.');
  const faltan = faltantesParaCerrar(planId);
  if (faltan.length > 0) {
    throw new ErrorNegocio('El plan todavía no cumple las condiciones de cierre.', {
      ayuda: faltan.join(' · '),
    });
  }
  return cambiarEstado(actor, plan, 'Cerrada', { tipo: 'plan.cerrado', version: datos.version });
}

export function archivar(actor, planId, datos = {}) {
  exigirDireccion(actor, 'archivar el plan');
  const plan = exigir(planId);
  if (plan.estado === 'Archivada') return plan;
  const motivo = v.motivo(datos.motivo, 'El motivo para archivar');
  return cambiarEstado(actor, plan, 'Archivada', {
    tipo: 'plan.archivado',
    motivo,
    version: datos.version,
  });
}

function cambiarEstado(actor, plan, nuevoEstado, { tipo, motivo = null, version = null } = {}) {
  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'plan',
      id: plan.id,
      campos: { estado: nuevoEstado },
      version: version ?? null,
      etiquetas: { estado: 'Estado del plan' },
      volverA: `/clubes/${plan.club_id}`,
    });
    registrar({
      actor,
      tipo,
      entidad: 'plan',
      entidadId: plan.id,
      planId: plan.id,
      motivo,
      estadoAnterior: plan.estado,
      estadoPosterior: nuevoEstado,
      datosAnteriores: tipo === 'plan.cerrado' || tipo === 'plan.archivado' ? instantaneaPlan(plan.id) : null,
    });
    return guardado;
  });
}

// --- Reaperturas -------------------------------------------------------------

/** Aprobaciones posteriores que una reapertura deja en revisión. */
export function aprobacionesPosteriores(planId) {
  return {
    actas: todos(
      `SELECT id, inicio, acta_validada_en FROM reunion
       WHERE plan_id = ? AND acta_estado = 'Validada' ORDER BY IFNULL(inicio, creado_en)`,
      planId,
    ),
    reconfirmacion: uno(
      'SELECT * FROM reconfirmacion WHERE plan_id = ? AND validada_en IS NOT NULL',
      planId,
    ),
  };
}

/** Reabre un plan cerrado o archivado. Vuelve a seguimiento; las demás aprobaciones se revisan aparte. */
export function reabrirPlan(actor, planId, datos) {
  exigirDireccion(actor, 'reabrir un plan');
  const plan = exigir(planId);
  if (plan.estado !== 'Cerrada' && plan.estado !== 'Archivada') {
    throw new ErrorNegocio('Solo se reabre un plan cerrado o archivado.');
  }
  const motivo = v.motivo(datos.motivo);

  return enTransaccion(() => {
    const copia = instantaneaPlan(plan.id);
    registrar({
      actor,
      tipo: 'plan.reabierto',
      entidad: 'plan',
      entidadId: plan.id,
      planId: plan.id,
      motivo,
      estadoAnterior: plan.estado,
      estadoPosterior: 'Abierta',
      datosAnteriores: copia,
    });
    return actualizar({
      tabla: 'plan',
      id: plan.id,
      campos: { estado: 'Abierta' },
      version: datos.version ?? null,
      volverA: `/clubes/${plan.club_id}`,
    });
  });
}
