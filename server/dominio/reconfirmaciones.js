import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion, exigirEscritura } from '../auth.js';
import { ahora, hoy } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { ordenPorPlanilla } from '../lib/disciplinas.js';
import { registrar, actualizar, instantaneaReconfirmacion } from './registro.js';

export const ESTADOS = ['Pendiente', 'Contactado', 'Condicional', 'Confirmado', 'No continua', 'Sin respuesta'];
export const CANALES = ['Telefono', 'WhatsApp', 'Email', 'Presencial'];
export const RESULTADOS_FINALES = ['Confirmado', 'No continua'];
export const ABIERTOS = ['Pendiente', 'Contactado', 'Condicional', 'Sin respuesta'];

export function ventana() {
  const p = uno(`SELECT * FROM parametros WHERE id = 'CICLO-2027'`);
  return {
    inicio: p ? p.inicio_reconfirmacion : '2027-01-01',
    fin: p ? p.fin_reconfirmacion : '2027-02-28',
  };
}

export function dentroDeVentana(fecha) {
  if (!fecha) return true;
  const { inicio, fin } = ventana();
  return fecha >= inicio && fecha <= fin;
}

/**
 * El acta que corresponde reconfirmar: la última aprobada del plan. Es la que tiene lo
 * que se acordó con el club, así que es lo que el club viene a confirmar.
 */
export function actaAReconfirmar(planId) {
  return uno(
    `SELECT * FROM reunion WHERE plan_id = ? AND acta_estado = 'Validada'
     ORDER BY IFNULL(inicio, creado_en) DESC LIMIT 1`,
    planId,
  );
}

const SELECCION = `
  SELECT r.*, p.club_id, p.estado AS plan_estado, p.anio_objetivo, c.nombre AS club_nombre,
         u.nombre AS responsable_nombre, vp.nombre AS validada_por_nombre,
         m.inicio AS acta_inicio, m.acta_estado AS acta_estado, m.fecha_recontacto AS acta_fecha_recontacto,
         m.proximo_paso AS acta_proximo_paso,
         (SELECT count(*) FROM plan_detalle d WHERE d.plan_id = r.plan_id) AS disciplinas,
         (SELECT count(*) FROM plan_detalle d WHERE d.plan_id = r.plan_id AND d.tiras_reconfirmadas IS NOT NULL) AS disciplinas_con_final,
         (SELECT count(*) FROM reunion m WHERE m.plan_id = r.plan_id AND m.acta_estado = 'Validada') AS actas_validadas,
         (SELECT count(*) FROM conflicto k WHERE k.plan_id = r.plan_id AND k.estado = 'Abierto') AS conflictos
  FROM reconfirmacion r
  JOIN plan p ON p.id = r.plan_id
  JOIN club c ON c.id = p.club_id
  LEFT JOIN usuario u ON u.id = r.responsable_id
  LEFT JOIN usuario vp ON vp.id = r.validada_por_id
  LEFT JOIN reunion m ON m.id = r.reunion_id`;

export function obtener(id) {
  return uno(`${SELECCION} WHERE r.id = ?`, id);
}

export function exigir(id) {
  const ficha = obtener(id);
  if (!ficha) throw new ErrorNoEncontrado('Esa ficha de reconfirmación no existe.');
  return ficha;
}

export function porPlan(planId) {
  return uno(`${SELECCION} WHERE r.plan_id = ?`, planId);
}

export function cola({ filtro = 'abiertas' } = {}) {
  let condicion = '';
  if (filtro === 'abiertas') condicion = `AND r.estado IN ('Pendiente','Contactado','Condicional','Sin respuesta')`;
  if (filtro === 'agestionar') {
    condicion = `AND r.estado IN ('Pendiente','Contactado','Condicional','Sin respuesta')
                 AND (IFNULL(r.proximo_contacto, r.fecha_prevista) <= '${hoy()}')`;
  }
  if (filtro === 'cerradas') condicion = `AND r.estado IN ('Confirmado','No continua')`;
  return todos(
    `${SELECCION} WHERE p.estado <> 'Archivada' ${condicion}
     ORDER BY CASE r.estado WHEN 'Pendiente' THEN 0 WHEN 'Contactado' THEN 1 WHEN 'Condicional' THEN 2
                            WHEN 'Sin respuesta' THEN 3 ELSE 4 END,
              IFNULL(r.proximo_contacto, r.fecha_prevista)`,
  );
}

/** Qué falta para poder validar un resultado final. */
export function faltantesParaConfirmar(planId) {
  const faltan = [];
  const actas = uno(`SELECT count(*) AS n FROM reunion WHERE plan_id = ? AND acta_estado = 'Validada'`, planId).n;
  if (actas === 0) faltan.push('Un acta aprobada del plan.');
  const sinFinal = todos(
    `SELECT disciplina FROM plan_detalle WHERE plan_id = ? AND tiras_reconfirmadas IS NULL ORDER BY ${ordenPorPlanilla()}`,
    planId,
  );
  const disciplinas = uno('SELECT count(*) AS n FROM plan_detalle WHERE plan_id = ?', planId).n;
  if (disciplinas === 0) faltan.push('Al menos una disciplina con cantidades.');
  for (const fila of sinFinal) faltan.push(`Cantidad final de ${fila.disciplina}.`);
  const conflictos = uno(`SELECT count(*) AS n FROM conflicto WHERE plan_id = ? AND estado = 'Abierto'`, planId).n;
  if (conflictos > 0) faltan.push('Resolver el conflicto de duplicados del plan.');
  return faltan;
}

export function crear(actor, planId, datos) {
  exigirEscritura(actor, 'abrir la ficha de reconfirmación');
  const plan = uno('SELECT * FROM plan WHERE id = ?', planId);
  if (!plan) throw new ErrorNoEncontrado('Ese plan no existe.');
  if (plan.estado === 'Cerrada' || plan.estado === 'Archivada') {
    throw new ErrorNegocio('El plan está cerrado.');
  }
  if (porPlan(planId)) throw new ErrorNegocio('El plan ya tiene su ficha de reconfirmación.');

  // Se reconfirma un acta concreta: la que tiene lo que se acordó con el club.
  const acta = actaAReconfirmar(planId);
  if (!acta) {
    throw new ErrorNegocio('Todavía no hay un acta aprobada que reconfirmar.', {
      ayuda: 'Primero se aprueba el acta de la reunión donde se acordó; la ficha final sale de ahí.',
    });
  }

  // La fecha sale del acta, que es donde se decidió cuándo volver a hablar. Se puede
  // indicar otra al abrir la ficha, y después reprogramarla las veces que haga falta.
  const fechaPrevista = v.fecha(datos.fecha_prevista, 'La fecha prevista') || acta.fecha_recontacto;
  if (!fechaPrevista) {
    throw new ErrorNegocio('Falta la fecha para reconfirmar.', {
      ayuda: 'Se carga en el acta de la reunión, en "Cuándo reconfirmamos". Desde ahí sale esta ficha.',
    });
  }
  const motivoExcepcion = v.texto(datos.motivo_excepcion);
  if (!dentroDeVentana(fechaPrevista) && !motivoExcepcion) {
    const { inicio, fin } = ventana();
    throw new ErrorNegocio(
      `La fecha prevista está fuera de la ventana de reconfirmación (${inicio} a ${fin}).`,
      { ayuda: 'Si hace falta planificarla fuera de la ventana, explicá el motivo de excepción.' },
    );
  }

  const club = uno('SELECT * FROM club WHERE id = ?', plan.club_id);
  const responsableId = v.texto(datos.responsable_id) || club?.responsable_id || actor.id;

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO reconfirmacion (id, plan_id, reunion_id, fecha_prevista, responsable_id, estado,
                                   motivo_excepcion, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?)`,
      id,
      planId,
      acta.id,
      fechaPrevista,
      responsableId,
      motivoExcepcion,
      ahora(),
      actor.id,
    );
    registrar({
      actor,
      tipo: 'reconfirmacion.creada',
      entidad: 'reconfirmacion',
      entidadId: id,
      planId,
      reunionId: acta.id,
      reconfirmacionId: id,
      estadoPosterior: 'Pendiente',
      datosPosteriores: { fecha_prevista: fechaPrevista, motivo_excepcion: motivoExcepcion },
    });
    return obtener(id);
  });
}

/**
 * Vuelve a poner fecha para reconfirmar. Es la instancia que falta cuando el club pide
 * más tiempo o no se lo pudo ubicar: no cambia el estado ni registra un contacto, solo
 * mueve la fecha. Se puede hacer todas las veces que haga falta y cada movida queda en
 * el historial con su motivo, así se ve cuántas veces se corrió.
 */
export function reprogramar(actor, fichaId, datos) {
  exigirEscritura(actor, 'reprogramar la reconfirmación');
  const ficha = exigir(fichaId);
  exigirEditable(ficha);

  const nueva = v.fecha(datos.fecha_prevista, 'La nueva fecha para reconfirmar', { obligatorio: true });
  if (nueva === ficha.fecha_prevista) {
    throw new ErrorNegocio('Esa ya es la fecha de la ficha: elegí otra.', { campo: 'fecha_prevista' });
  }
  const motivoExcepcion = v.texto(datos.motivo_excepcion) || ficha.motivo_excepcion;
  if (!dentroDeVentana(nueva) && !motivoExcepcion) {
    const { inicio, fin } = ventana();
    throw new ErrorNegocio(
      `La nueva fecha está fuera de la ventana de reconfirmación (${inicio} a ${fin}).`,
      { ayuda: 'Si hace falta correrla fuera de la ventana, explicá el motivo de excepción.' },
    );
  }
  const motivo = v.texto(datos.motivo);

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reconfirmacion',
      id: ficha.id,
      campos: { fecha_prevista: nueva, motivo_excepcion: motivoExcepcion },
      version: datos.version ?? null,
      etiquetas: { fecha_prevista: 'Fecha para reconfirmar', motivo_excepcion: 'Motivo de excepción' },
      volverA: `/reconfirmacion/${ficha.id}`,
    });
    registrar({
      actor,
      tipo: 'reconfirmacion.reprogramada',
      entidad: 'reconfirmacion',
      entidadId: ficha.id,
      planId: ficha.plan_id,
      reunionId: ficha.reunion_id,
      reconfirmacionId: ficha.id,
      motivo,
      datosAnteriores: { fecha_prevista: ficha.fecha_prevista },
      datosPosteriores: { fecha_prevista: nueva },
    });
    return guardado;
  });
}

function exigirEditable(ficha) {
  if (ficha.validada_en) {
    throw new ErrorNegocio('El resultado final está aprobado y bloqueado. Dirección puede reabrirlo con motivo.');
  }
  if (ficha.plan_estado === 'Cerrada' || ficha.plan_estado === 'Archivada') {
    throw new ErrorNegocio('El plan está cerrado: reabrilo con motivo.');
  }
}

/** Datos del contacto realizado, comunes a Contactado, Condicional y Sin respuesta. */
function leerContacto(datos, { exigeInterlocutor = true } = {}) {
  const fechaContacto = v.noFutura(
    v.fecha(datos.fecha_contacto, 'La fecha de contacto', { obligatorio: true }),
    'La fecha de contacto',
  );
  const canal = v.opcion(datos.canal, CANALES, 'El canal');
  const interlocutor = v.texto(datos.interlocutor);
  if (exigeInterlocutor && !interlocutor) {
    throw new ErrorNegocio('Hace falta registrar con quién se habló.', { campo: 'interlocutor' });
  }
  const proximoContacto = v.fecha(datos.proximo_contacto, 'El próximo contacto', { obligatorio: true });
  if (proximoContacto < fechaContacto) {
    throw new ErrorNegocio('El próximo contacto no puede ser anterior a la fecha de contacto.');
  }
  return {
    fecha_contacto: fechaContacto,
    canal,
    interlocutor,
    proximo_contacto: proximoContacto,
    respuesta_club: v.texto(datos.respuesta_club),
    evidencia_url: v.url(datos.evidencia_url, 'El enlace de evidencia'),
  };
}

export function registrarContacto(actor, fichaId, datos) {
  exigirEscritura(actor, 'registrar contactos de reconfirmación');
  const ficha = exigir(fichaId);
  exigirEditable(ficha);
  const campos = { ...leerContacto(datos), estado: 'Contactado' };
  return guardarSeguimiento(actor, ficha, campos, 'reconfirmacion.contactado', datos);
}

export function registrarCondicional(actor, fichaId, datos) {
  exigirEscritura(actor, 'registrar respuestas condicionales');
  const ficha = exigir(fichaId);
  exigirEditable(ficha);
  const condiciones = v.textoObligatorio(datos.condiciones, 'Las condiciones del club', { minimo: 3 });
  const campos = { ...leerContacto(datos), condiciones, estado: 'Condicional' };
  return guardarSeguimiento(actor, ficha, campos, 'reconfirmacion.condicional', datos);
}

export function registrarSinRespuesta(actor, fichaId, datos) {
  exigirEscritura(actor, 'registrar intentos sin respuesta');
  const ficha = exigir(fichaId);
  exigirEditable(ficha);
  // Sin respuesta mantiene el caso abierto: no es una baja ni una confirmación.
  const campos = { ...leerContacto(datos, { exigeInterlocutor: false }), estado: 'Sin respuesta' };
  return guardarSeguimiento(actor, ficha, campos, 'reconfirmacion.sin_respuesta', datos);
}

function guardarSeguimiento(actor, ficha, campos, tipo, datos) {
  const motivoExcepcion = v.texto(datos.motivo_excepcion) || ficha.motivo_excepcion;
  if (!dentroDeVentana(campos.fecha_contacto) && !motivoExcepcion) {
    const { inicio, fin } = ventana();
    throw new ErrorNegocio(
      `El contacto ocurrió fuera de la ventana de reconfirmación (${inicio} a ${fin}).`,
      { ayuda: 'Se puede registrar igual, pero hace falta explicar el motivo de excepción.' },
    );
  }
  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reconfirmacion',
      id: ficha.id,
      campos: { ...campos, motivo_excepcion: motivoExcepcion },
      version: datos.version ?? null,
      etiquetas: {
        estado: 'Estado',
        fecha_contacto: 'Fecha de contacto',
        canal: 'Canal',
        interlocutor: 'Interlocutor',
        respuesta_club: 'Respuesta del club',
        condiciones: 'Condiciones',
        proximo_contacto: 'Próximo contacto',
      },
      volverA: `/reconfirmacion/${ficha.id}`,
    });
    registrar({
      actor,
      tipo,
      entidad: 'reconfirmacion',
      entidadId: ficha.id,
      planId: ficha.plan_id,
      reconfirmacionId: ficha.id,
      estadoAnterior: ficha.estado,
      estadoPosterior: campos.estado,
      datosPosteriores: campos,
    });
    return guardado;
  });
}

/**
 * Valida el resultado final en una sola operación: resultado + sello.
 * Confirmar exige evidencia, acta aprobada y todas las cantidades finales.
 */
export function validarResultado(actor, fichaId, resultado, datos) {
  exigirDireccion(actor, 'validar el resultado final');
  const ficha = exigir(fichaId);
  exigirEditable(ficha);
  if (!RESULTADOS_FINALES.includes(resultado)) {
    throw new ErrorNegocio('El resultado final solo puede ser Confirmado o No continúa.');
  }

  const contacto = leerContactoFinal(datos, ficha);
  const respuesta = v.textoObligatorio(datos.respuesta_club, 'La respuesta del club', { minimo: 3 });
  const evidencia = v.url(datos.evidencia_url, 'El enlace de evidencia');
  if (!evidencia) {
    throw new ErrorNegocio('Un resultado final necesita evidencia: acta, correo o archivo con el enlace.', {
      campo: 'evidencia_url',
    });
  }

  const faltan = resultado === 'Confirmado' ? faltantesParaConfirmar(ficha.plan_id) : [];
  if (resultado === 'No continua') {
    const actas = uno(
      `SELECT count(*) AS n FROM reunion WHERE plan_id = ? AND acta_estado = 'Validada'`,
      ficha.plan_id,
    ).n;
    if (actas === 0) faltan.push('Un acta aprobada del plan.');
    const conflictos = uno(
      `SELECT count(*) AS n FROM conflicto WHERE plan_id = ? AND estado = 'Abierto'`,
      ficha.plan_id,
    ).n;
    if (conflictos > 0) faltan.push('Resolver el conflicto de duplicados del plan.');
  }
  if (faltan.length > 0) {
    throw new ErrorNegocio(`No se puede registrar "${resultado}" todavía.`, { ayuda: faltan.join(' · ') });
  }

  const motivoExcepcion = v.texto(datos.motivo_excepcion) || ficha.motivo_excepcion;
  if (!dentroDeVentana(contacto.fecha_contacto) && !motivoExcepcion) {
    const { inicio, fin } = ventana();
    throw new ErrorNegocio(
      `El contacto ocurrió fuera de la ventana (${inicio} a ${fin}): hace falta motivo de excepción.`,
    );
  }

  return enTransaccion(() => {
    const sello = ahora();
    const campos = {
      ...contacto,
      respuesta_club: respuesta,
      evidencia_url: evidencia,
      condiciones: v.texto(datos.condiciones) || ficha.condiciones,
      estado: resultado,
      motivo_excepcion: motivoExcepcion,
      validada_por_id: actor.id,
      validada_en: sello,
    };
    const guardado = actualizar({
      tabla: 'reconfirmacion',
      id: ficha.id,
      campos,
      version: datos.version ?? null,
      volverA: `/reconfirmacion/${ficha.id}`,
    });
    registrar({
      actor,
      tipo: resultado === 'Confirmado' ? 'reconfirmacion.confirmada' : 'reconfirmacion.no_continua',
      entidad: 'reconfirmacion',
      entidadId: ficha.id,
      planId: ficha.plan_id,
      reconfirmacionId: ficha.id,
      estadoAnterior: ficha.estado,
      estadoPosterior: resultado,
      datosPosteriores: instantaneaReconfirmacion(ficha.id),
    });
    return guardado;
  });
}

function leerContactoFinal(datos, ficha) {
  const fechaContacto = v.noFutura(
    v.fecha(datos.fecha_contacto || ficha.fecha_contacto, 'La fecha de contacto', { obligatorio: true }),
    'La fecha de contacto',
  );
  const canal = v.opcion(datos.canal || ficha.canal, CANALES, 'El canal');
  const interlocutor = v.texto(datos.interlocutor) || ficha.interlocutor;
  if (!interlocutor) throw new ErrorNegocio('Hace falta registrar con quién se habló.', { campo: 'interlocutor' });
  const proximo = v.fecha(datos.proximo_contacto, 'El próximo contacto');
  return {
    fecha_contacto: fechaContacto,
    canal,
    interlocutor,
    proximo_contacto: proximo && proximo >= fechaContacto ? proximo : null,
  };
}

/** Reabre un resultado final aprobado: copia íntegra, vuelve a Pendiente y borra los sellos. */
export function reabrir(actor, fichaId, datos) {
  exigirDireccion(actor, 'reabrir una reconfirmación aprobada');
  const ficha = exigir(fichaId);
  if (!ficha.validada_en) throw new ErrorNegocio('Esa ficha no tiene un resultado aprobado.');
  if (ficha.plan_estado === 'Cerrada' || ficha.plan_estado === 'Archivada') {
    throw new ErrorNegocio('Primero hay que reabrir el plan y después la reconfirmación.');
  }
  const motivo = v.motivo(datos.motivo, 'El motivo de la reapertura');

  return enTransaccion(() => {
    registrar({
      actor,
      tipo: 'reconfirmacion.reabierta',
      entidad: 'reconfirmacion',
      entidadId: ficha.id,
      planId: ficha.plan_id,
      reconfirmacionId: ficha.id,
      motivo,
      estadoAnterior: ficha.estado,
      estadoPosterior: 'Pendiente',
      datosAnteriores: instantaneaReconfirmacion(ficha.id),
    });
    return actualizar({
      tabla: 'reconfirmacion',
      id: ficha.id,
      campos: { estado: 'Pendiente', validada_por_id: null, validada_en: null },
      version: datos.version ?? null,
      volverA: `/reconfirmacion/${ficha.id}`,
    });
  });
}
