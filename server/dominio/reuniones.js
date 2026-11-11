import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion, exigirActivo, exigirEscritura } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado, ErrorPermiso } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { ordenPorPlanilla } from '../lib/disciplinas.js';
import { registrar, actualizar, instantaneaReunion } from './registro.js';

export const MODALIDADES = ['En la liga', 'En el club', 'Llamada'];

/**
 * Cuánto dura cada tipo de reunión. En la liga se encadenan una atrás de otra; ir a un
 * club ocupa la tarde, porque incluye el viaje de ida y de vuelta.
 * El fin se calcula con esto: no se carga a mano.
 */
export const MINUTOS_POR_MODALIDAD = {
  'En la liga': 45,
  'En el club': 180,
  Llamada: 45,
};

/** Horario en que se pueden agendar reuniones. */
export const HORA_MINIMA = '08:00';
export const HORA_MAXIMA = '22:00';

export function esVisitaAlClub(reunion) {
  return reunion?.modalidad === 'En el club';
}

export function duracionDe(modalidad) {
  return MINUTOS_POR_MODALIDAD[modalidad] ?? 45;
}

/** Suma minutos a un "AAAA-MM-DDTHH:mm" y devuelve el mismo formato. */
export function correrMinutos(fechaHora, minutos) {
  const [fecha, hora] = String(fechaHora).slice(0, 16).split('T');
  const base = Date.parse(`${fecha}T${hora}:00Z`) + minutos * 60000;
  return new Date(base).toISOString().slice(0, 16);
}
export const ESTADOS = ['Borrador', 'Programada', 'Realizada', 'Cancelada'];
export const ESTADOS_ACTA = ['Borrador', 'Para revisar', 'Validada'];

export function obtener(id) {
  return uno('SELECT * FROM reunion WHERE id = ?', id);
}

export function exigir(id) {
  const reunion = obtener(id);
  if (!reunion) throw new ErrorNoEncontrado('Esa reunión no existe.');
  return reunion;
}

export function conContexto(id) {
  return uno(
    `SELECT m.*, p.club_id, p.estado AS plan_estado, p.anio_objetivo, c.nombre AS club_nombre,
            d1.nombre AS director1_nombre, d2.nombre AS director2_nombre,
            ar.nombre AS acta_responsable_nombre, va.nombre AS validada_por_nombre
     FROM reunion m
     JOIN plan p ON p.id = m.plan_id
     JOIN club c ON c.id = p.club_id
     LEFT JOIN usuario d1 ON d1.id = m.director1_id
     LEFT JOIN usuario d2 ON d2.id = m.director2_id
     LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
     LEFT JOIN usuario va ON va.id = m.acta_validada_por_id
     WHERE m.id = ?`,
    id,
  );
}

export function porPlan(planId) {
  return todos(
    `SELECT m.*, d1.nombre AS director1_nombre, d2.nombre AS director2_nombre,
            ar.nombre AS acta_responsable_nombre,
            (SELECT count(*) FROM compromiso k WHERE k.reunion_id = m.id) AS compromisos
     FROM reunion m
     LEFT JOIN usuario d1 ON d1.id = m.director1_id
     LEFT JOIN usuario d2 ON d2.id = m.director2_id
     LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
     WHERE m.plan_id = ?
     ORDER BY IFNULL(m.inicio, m.creado_en) DESC`,
    planId,
  );
}

/**
 * Las reuniones que la agenda muestra, con los filtros que se pueden combinar entre sí.
 *
 * `persona` cubre los tres papeles de una reunión: la Dirección que la tiene, la que
 * acompaña y quien toma nota. Si se filtra por alguien, aparece todo lo que esa persona
 * tiene que atender, sin importar en cuál de los tres está.
 *
 * `pendientesDeActa` son las reuniones que ya se hicieron y cuya acta todavía no está
 * aprobada: es la cola de trabajo real después de una semana de reuniones.
 */
export function agenda({
  desde = null,
  hasta = null,
  estado = '',
  persona = '',
  clubId = '',
  modalidad = '',
  pendientesDeActa = false,
} = {}) {
  const condiciones = [];
  const valores = [];
  if (desde) {
    condiciones.push('m.inicio >= ?');
    valores.push(desde);
  }
  if (hasta) {
    condiciones.push('m.inicio <= ?');
    valores.push(`${hasta}T23:59`);
  }
  if (estado) {
    condiciones.push('m.estado = ?');
    valores.push(estado);
  }
  if (persona) {
    condiciones.push('(m.director1_id = ? OR m.director2_id = ? OR m.acta_responsable_id = ?)');
    valores.push(persona, persona, persona);
  }
  if (clubId) {
    condiciones.push('p.club_id = ?');
    valores.push(clubId);
  }
  if (modalidad) {
    condiciones.push('m.modalidad = ?');
    valores.push(modalidad);
  }
  if (pendientesDeActa) {
    condiciones.push(`m.estado = 'Realizada' AND m.acta_estado <> 'Validada'`);
  }

  return todos(
    `SELECT m.*, c.nombre AS club_nombre, p.club_id,
            d1.nombre AS director1_nombre, d2.nombre AS director2_nombre,
            ar.nombre AS acta_responsable_nombre
     FROM reunion m
     JOIN plan p ON p.id = m.plan_id
     JOIN club c ON c.id = p.club_id
     LEFT JOIN usuario d1 ON d1.id = m.director1_id
     LEFT JOIN usuario d2 ON d2.id = m.director2_id
     LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
     ${condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : ''}
     ORDER BY IFNULL(m.inicio, m.creado_en)`,
    ...valores,
  );
}

/** Los clubes que tienen alguna reunión, para ofrecerlos como filtro de la agenda. */
export function clubesConReuniones() {
  return todos(
    `SELECT DISTINCT c.id, c.nombre FROM reunion m
     JOIN plan p ON p.id = m.plan_id JOIN club c ON c.id = p.club_id
     ORDER BY c.nombre`,
  );
}

/**
 * Reuniones no canceladas que se cruzan con este horario y comparten alguna persona.
 * La comparación usa el bloque con traslado, así una visita a un club no se encadena
 * con otra reunión pegada.
 */
export function superposiciones({
  inicio,
  fin,
  modalidad = 'En la liga',
  director1_id,
  director2_id,
  acta_responsable_id,
  exceptoId = null,
}) {
  if (!inicio || !fin) return [];
  const personas = [director1_id, director2_id, acta_responsable_id].filter(Boolean);
  if (personas.length === 0) return [];

  // Se buscan candidatas del mismo día; el cruce exacto se calcula después.
  const desdeDia = `${String(inicio).slice(0, 10)}T00:00`;
  const hastaDia = `${String(fin).slice(0, 10)}T23:59`;

  return todos(
    `SELECT m.id, m.inicio, m.fin, m.estado, m.modalidad, m.director1_id, m.director2_id,
            m.acta_responsable_id, c.nombre AS club_nombre,
            d1.nombre AS director1_nombre, d2.nombre AS director2_nombre, ar.nombre AS acta_responsable_nombre
     FROM reunion m
     JOIN plan p ON p.id = m.plan_id
     JOIN club c ON c.id = p.club_id
     LEFT JOIN usuario d1 ON d1.id = m.director1_id
     LEFT JOIN usuario d2 ON d2.id = m.director2_id
     LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
     WHERE m.estado <> 'Cancelada'
       AND (? IS NULL OR m.id <> ?)
       AND m.inicio IS NOT NULL AND m.fin IS NOT NULL
       AND m.fin >= ? AND m.inicio <= ?`,
    exceptoId,
    exceptoId,
    desdeDia,
    hastaDia,
  )
    .filter((otra) =>
      personas.some((persona) =>
        [otra.director1_id, otra.director2_id, otra.acta_responsable_id].includes(persona),
      ),
    )
    .filter((otra) => String(inicio).slice(0, 16) < otra.fin && String(fin).slice(0, 16) > otra.inicio);
}

/**
 * A los clubes marcados como "contacto de Dirección" los llaman los directivos.
 * Un ayudante no agenda ni cambia la agenda de esos clubes.
 */
export function exigirContactoPermitido(actor, clubId) {
  const club = uno('SELECT nombre, contacto_directo FROM club WHERE id = ?', clubId);
  if (club && club.contacto_directo === 1 && actor.rol !== 'Direccion') {
    throw new ErrorPermiso(
      `A ${club.nombre} lo contacta Dirección. Avisales a ellos en lugar de llamar al club.`,
    );
  }
  return club;
}

function exigirPlanAbierto(reunion) {
  const plan = uno('SELECT * FROM plan WHERE id = ?', reunion.plan_id);
  if (plan.estado === 'Cerrada' || plan.estado === 'Archivada') {
    throw new ErrorNegocio('El plan está cerrado: reabrilo con motivo antes de tocar sus reuniones.');
  }
  return plan;
}

/** Permiso sobre el contenido del acta: Dirección, o el ayudante asignado a esa acta. */
export function puedeEditarActa(usuario, reunion) {
  if (!usuario || usuario.activo !== 1) return false;
  if (reunion.acta_estado === 'Validada') return false;
  if (usuario.rol === 'Direccion') return true;
  if (usuario.rol === 'Ayudante') return reunion.acta_responsable_id === usuario.id;
  return false;
}

export function crear(actor, planId, datos) {
  // Los ayudantes coordinan con el club y agendan; Dirección también puede.
  exigirEscritura(actor, 'agendar reuniones');
  const plan = uno('SELECT * FROM plan WHERE id = ?', planId);
  if (!plan) throw new ErrorNoEncontrado('Ese plan no existe.');
  if (plan.estado === 'Cerrada' || plan.estado === 'Archivada') {
    throw new ErrorNegocio('El plan está cerrado: no se agendan reuniones nuevas.');
  }
  exigirContactoPermitido(actor, plan.club_id);

  const campos = leerAgenda(datos);

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO reunion (id, plan_id, inicio, fin, lugar, modalidad, estado, director1_id, director2_id,
                            acta_responsable_id, nota, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, 'Borrador', ?, ?, ?, ?, ?, ?)`,
      id,
      planId,
      campos.inicio,
      campos.fin,
      campos.lugar,
      campos.modalidad,
      campos.director1_id,
      campos.director2_id,
      campos.acta_responsable_id,
      v.texto(datos.nota),
      ahora(),
      actor.id,
    );
    registrar({
      actor,
      tipo: 'reunion.creada',
      entidad: 'reunion',
      entidadId: id,
      planId,
      reunionId: id,
      estadoPosterior: 'Borrador',
      datosPosteriores: campos,
    });
    return obtener(id);
  });
}

/**
 * Observaciones de la reunión: lo que conviene tener a mano antes, y lo que quede por
 * anotar después. No es el acta y no se aprueba, así que no la bloquea el acta aprobada
 * ni el estado de la reunión: siempre tiene que haber dónde escribir algo.
 *
 * Mientras el plan esté abierto la puede escribir cualquiera que pueda escribir, igual
 * que agendar: es coordinación, no un registro de lo que se acordó.
 */
export function guardarNota(actor, reunionId, datos = {}) {
  exigirEscritura(actor, 'anotar observaciones de una reunión');
  const reunion = exigir(reunionId);
  const plan = exigirPlanAbierto(reunion);
  exigirContactoPermitido(actor, plan.club_id);

  const nota = v.texto(datos.nota);
  if (nota === reunion.nota) return reunion;

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { nota },
      etiquetas: { nota: 'Observaciones' },
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'reunion.nota',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      datosAnteriores: { nota: reunion.nota },
      datosPosteriores: { nota },
    });
    return guardado;
  });
}

export function editarAgenda(actor, reunionId, datos) {
  exigirEscritura(actor, 'cambiar la agenda de una reunión');
  const reunion = exigir(reunionId);
  const planDeLaReunion = exigirPlanAbierto(reunion);
  exigirContactoPermitido(actor, planDeLaReunion.club_id);
  if (reunion.acta_estado === 'Validada') {
    throw new ErrorNegocio('El acta de esta reunión está aprobada: reabrila con motivo para cambiar sus datos.');
  }
  if (reunion.estado === 'Cancelada') {
    throw new ErrorNegocio('La reunión está cancelada. Se conserva como registro; agendá una nueva.');
  }
  const campos = leerAgenda(datos);

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos,
      version: datos.version ?? null,
      etiquetas: {
        inicio: 'Inicio',
        fin: 'Fin',
        lugar: 'Lugar',
        modalidad: 'Modalidad',
        director1_id: 'Dirección 1',
        director2_id: 'Dirección 2',
        acta_responsable_id: 'Quién toma nota',
      },
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'reunion.agenda',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      datosAnteriores: {
        inicio: reunion.inicio,
        fin: reunion.fin,
        lugar: reunion.lugar,
        modalidad: reunion.modalidad,
        director1_id: reunion.director1_id,
        director2_id: reunion.director2_id,
        acta_responsable_id: reunion.acta_responsable_id,
      },
      datosPosteriores: campos,
    });
    return guardado;
  });
}

function leerAgenda(datos) {
  // La reunión se agenda con fecha y hora de inicio; el fin sale de cuánto dura según
  // dónde se haga, así nadie tiene que calcularlo a mano.
  const modalidadElegida = v.opcion(datos.modalidad || 'En la liga', MODALIDADES, 'El lugar de la reunión');
  const fecha = v.fecha(leerFechaPartida(datos, 'fecha'), 'La fecha');
  const horaInicio = leerHora(datos);
  let inicio = null;
  let fin = null;
  if (fecha && horaInicio) {
    inicio = `${fecha}T${horaInicio}:00`;
    fin = `${correrMinutos(inicio, duracionDe(modalidadElegida))}:00`;
  } else if (fecha || horaInicio) {
    throw new ErrorNegocio('Para agendar hacen falta la fecha y la hora de inicio.', { campo: 'fecha' });
  }

  // La reunión la tiene una Dirección; la segunda es opcional, por si van las dos.
  const director1 = v.texto(datos.director1_id);
  const director2 = v.texto(datos.director2_id);
  if (director1 && director2 && director1 === director2) {
    throw new ErrorNegocio('Si acompaña una segunda Dirección tiene que ser otra persona.', {
      campo: 'director2_id',
    });
  }
  if (!director1 && director2) {
    throw new ErrorNegocio('Elegí primero quién tiene la reunión.', { campo: 'director1_id' });
  }
  for (const [id, etiqueta, rolesPermitidos] of [
    [director1, 'Quien tiene la reunión', ['Direccion']],
    [director2, 'La Dirección que acompaña', ['Direccion']],
    [v.texto(datos.acta_responsable_id), 'Quien toma nota', ['Direccion', 'Ayudante']],
  ]) {
    if (!id) continue;
    const usuario = uno('SELECT * FROM usuario WHERE id = ?', id);
    if (!usuario) throw new ErrorNegocio(`${etiqueta} no corresponde a un usuario existente.`);
    if (usuario.activo !== 1) throw new ErrorNegocio(`${etiqueta} tiene que ser un usuario activo.`);
    if (!rolesPermitidos.includes(usuario.rol)) {
      throw new ErrorNegocio(`${etiqueta} tiene que tener rol ${rolesPermitidos.join(' o ')}.`);
    }
  }
  const lugar = v.texto(datos.lugar);
  if (modalidadElegida === 'En el club' && inicio && !lugar) {
    throw new ErrorNegocio('Si la reunión es en el club, indicá la dirección.', { campo: 'lugar' });
  }
  return {
    inicio,
    fin,
    lugar,
    modalidad: modalidadElegida,
    director1_id: director1,
    director2_id: director2,
    acta_responsable_id: v.texto(datos.acta_responsable_id),
  };
}

/**
 * Fecha armada con las tres listas (día, mes, año) o escrita como AAAA-MM-DD.
 * Si se eligieron día y mes pero la combinación no existe, lo dice en lugar de
 * acomodarla sola.
 */
function leerFechaPartida(datos, nombre) {
  const entera = v.texto(datos[nombre]);
  if (entera) return entera;
  const dia = v.texto(datos[`${nombre}_d`]);
  const mes = v.texto(datos[`${nombre}_m`]);
  const anio = v.texto(datos[`${nombre}_a`]);
  if (!dia && !mes) return null;
  if (!dia || !mes || !anio) throw new ErrorNegocio('Elegí el día, el mes y el año.', { campo: nombre });
  const armada = `${anio}-${mes}-${dia}`;
  const control = new Date(`${armada}T00:00:00Z`);
  if (Number.isNaN(control.getTime()) || control.toISOString().slice(0, 10) !== armada) {
    throw new ErrorNegocio(`El ${Number(dia)} no existe en ese mes.`, { campo: nombre });
  }
  return armada;
}

/**
 * Hora de inicio dentro del horario en que se agendan reuniones.
 * Llega como "HH:MM" o como dos listas separadas (hora_h y hora_m).
 */
function leerHora(datos) {
  const partida = v.texto(datos.hora_h) && v.texto(datos.hora_m)
    ? `${v.texto(datos.hora_h)}:${v.texto(datos.hora_m)}`
    : null;
  const limpio = v.texto(datos.hora) || partida;
  if (!limpio) return null;
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(limpio)) {
    throw new ErrorNegocio('La hora tiene que tener formato HH:MM.', { campo: 'hora' });
  }
  if (limpio < HORA_MINIMA || limpio > HORA_MAXIMA) {
    throw new ErrorNegocio(`Las reuniones se agendan entre las ${HORA_MINIMA} y las ${HORA_MAXIMA}.`, {
      campo: 'hora',
    });
  }
  return limpio;
}

export function programar(actor, reunionId, datos = {}) {
  exigirEscritura(actor, 'programar reuniones');
  const reunion = exigir(reunionId);
  exigirPlanAbierto(reunion);
  if (reunion.estado !== 'Borrador') throw new ErrorNegocio('Solo se programa una reunión en borrador.');

  const faltan = [];
  if (!reunion.inicio) faltan.push('inicio');
  if (!reunion.fin) faltan.push('fin');
  if (reunion.modalidad === 'En el club' && !reunion.lugar) faltan.push('la dirección del club');
  if (!reunion.director1_id) faltan.push('quién tiene la reunión');
  if (!reunion.acta_responsable_id) faltan.push('quién toma nota');
  if (faltan.length > 0) {
    throw new ErrorNegocio(`Para programar la reunión faltan: ${faltan.join(', ')}.`);
  }

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { estado: 'Programada' },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'reunion.programada',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      estadoAnterior: reunion.estado,
      estadoPosterior: 'Programada',
    });
    return guardado;
  });
}

export function marcarRealizada(actor, reunionId, datos = {}) {
  // La marca quien volcó la nota: Dirección o el ayudante asignado a esa acta.
  exigirEscritura(actor, 'marcar una reunión como realizada');
  const reunion = exigir(reunionId);
  if (actor.rol !== 'Direccion' && reunion.acta_responsable_id !== actor.id) {
    throw new ErrorPermiso('Solo Dirección o quien toma nota de esa reunión puede marcarla como realizada.');
  }
  exigirPlanAbierto(reunion);
  if (reunion.estado !== 'Programada') {
    throw new ErrorNegocio('Se marca como realizada una reunión programada.');
  }
  const faltan = [];
  if (!reunion.delegados_presentes) faltan.push('quiénes participaron');
  if (!reunion.acta) faltan.push('el acta');
  if (!reunion.devolucion_club) faltan.push('la devolución del club');
  if (!reunion.proximo_paso) faltan.push('el próximo paso');
  if (faltan.length > 0) {
    throw new ErrorNegocio(`Antes de marcarla como realizada hay que completar: ${faltan.join(', ')}.`, {
      ayuda: 'El contenido del acta se guarda desde la misma pantalla de la reunión.',
    });
  }

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { estado: 'Realizada' },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'reunion.realizada',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      estadoAnterior: reunion.estado,
      estadoPosterior: 'Realizada',
    });
    return guardado;
  });
}

export function cancelar(actor, reunionId, datos) {
  // Quien coordinó con el club puede cancelar, igual que Dirección. Siempre con motivo,
  // y la reunión cancelada se conserva como registro.
  exigirEscritura(actor, 'cancelar reuniones');
  const reunion = exigir(reunionId);
  if (actor.rol !== 'Direccion' && reunion.acta_responsable_id !== actor.id && reunion.creado_por_id !== actor.id) {
    throw new ErrorPermiso('Podés cancelar las reuniones que agendaste o en las que tomás nota.');
  }
  exigirPlanAbierto(reunion);
  if (reunion.estado === 'Cancelada') throw new ErrorNegocio('La reunión ya está cancelada.');
  if (reunion.acta_estado === 'Validada') {
    throw new ErrorNegocio('Esta reunión tiene un acta aprobada: no se cancela.');
  }
  const motivo = v.motivo(datos.motivo, 'El motivo de cancelación');

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { estado: 'Cancelada', motivo_cancelacion: motivo },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'reunion.cancelada',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      motivo,
      estadoAnterior: reunion.estado,
      estadoPosterior: 'Cancelada',
    });
    return guardado;
  });
}

// --- Acta --------------------------------------------------------------------

export function guardarActa(actor, reunionId, datos) {
  exigirActivo(actor);
  const reunion = exigir(reunionId);
  exigirPlanAbierto(reunion);

  if (reunion.acta_estado === 'Validada') {
    throw new ErrorNegocio('El acta está aprobada y bloqueada. Dirección puede reabrirla con motivo.');
  }
  if (!puedeEditarActa(actor, reunion)) {
    throw new ErrorPermiso(
      actor.rol === 'Ayudante'
        ? 'Solo podés escribir el acta de las reuniones que te asignaron.'
        : 'Tu rol no puede escribir actas.',
    );
  }
  if (reunion.estado === 'Cancelada') throw new ErrorNegocio('La reunión está cancelada.');
  if (reunion.estado === 'Borrador') {
    throw new ErrorNegocio('Primero hay que programar la reunión.');
  }

  const campos = {
    delegados_presentes: v.texto(datos.delegados_presentes),
    acta: v.texto(datos.acta),
    devolucion_club: v.texto(datos.devolucion_club),
    proximo_paso: v.texto(datos.proximo_paso),
    // Cuándo se vuelve a hablar para que el club confirme. Se decide en la reunión, así
    // que se escribe acá; la ficha de reconfirmación arranca con esta fecha.
    fecha_recontacto: v.fecha(datos.fecha_recontacto, 'La fecha para reconfirmar'),
  };
  if (campos.fecha_recontacto && reunion.inicio && campos.fecha_recontacto < reunion.inicio.slice(0, 10)) {
    throw new ErrorNegocio('La fecha para reconfirmar no puede ser anterior a la reunión.', {
      campo: 'fecha_recontacto',
    });
  }

  // Una reunión ya marcada como realizada no puede quedarse sin contenido del acta.
  if (reunion.estado === 'Realizada') {
    for (const [clave, etiqueta] of [
      ['delegados_presentes', 'quiénes participaron'],
      ['acta', 'el acta'],
      ['devolucion_club', 'la devolución del club'],
      ['proximo_paso', 'el próximo paso'],
    ]) {
      if (!campos[clave]) {
        throw new ErrorNegocio(`La reunión ya está marcada como realizada: no puede quedar sin ${etiqueta}.`);
      }
    }
  }

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos,
      version: datos.version ?? null,
      etiquetas: {
        delegados_presentes: 'Participantes',
        acta: 'Acta',
        devolucion_club: 'Devolución del club',
        proximo_paso: 'Próximo paso',
        fecha_recontacto: 'Fecha para reconfirmar',
      },
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'acta.guardada',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      estadoAnterior: reunion.acta_estado,
      estadoPosterior: guardado.acta_estado,
    });
    return guardado;
  });
}

/**
 * Lo que se acordó por disciplina, cargado desde el acta de esta reunión.
 *
 * Es el mismo acto que escribir el acta: quien toma nota anota, disciplina por disciplina,
 * qué se acordó con el club. Vale en palabras ("mantiene Liga de Honor B", "baja
 * Femenino", "lo define en diciembre") y, si hay un número de tiras cerrado, va al lado.
 * La disciplina queda atada a esta reunión sola: no hay que ir a buscarla a otra pantalla
 * ni elegir a mano de qué acta salió.
 *
 * Dejar una disciplina en blanco no es un olvido: significa que en esta reunión no se
 * habló de ella, y entonces se desvincula del acta en lugar de quedar atada y vacía.
 *
 * Espera un campo por disciplina: acordado_<id>. No hay cantidades: en la reunión se
 * acuerda qué pasa con cada disciplina, no cuántas tiras.
 */
export function guardarAcuerdos(actor, reunionId, datos = {}) {
  exigirActivo(actor);
  const reunion = exigir(reunionId);
  exigirPlanAbierto(reunion);

  if (reunion.acta_estado === 'Validada') {
    throw new ErrorNegocio('El acta está aprobada: lo acordado quedó bloqueado. Dirección puede reabrirla con motivo.');
  }
  if (!puedeEditarActa(actor, reunion)) {
    throw new ErrorPermiso(
      actor.rol === 'Ayudante'
        ? 'Solo podés cargar lo acordado en las reuniones cuya acta te asignaron.'
        : 'Tu rol no puede escribir actas.',
    );
  }
  if (reunion.estado === 'Cancelada') throw new ErrorNegocio('La reunión está cancelada.');
  if (reunion.estado === 'Borrador') throw new ErrorNegocio('Primero hay que programar la reunión.');

  const disciplinas = todos('SELECT * FROM plan_detalle WHERE plan_id = ?', reunion.plan_id);
  const cambios = [];

  for (const fila of disciplinas) {
    // Una disciplina que no vino en el envío se deja como está: nadie la tocó.
    if (datos[`acordado_${fila.id}`] === undefined) continue;

    // Lo acordado de otra acta no se toca desde esta: cada acta responde por lo suyo.
    if (fila.reunion_acuerdo_id && fila.reunion_acuerdo_id !== reunionId) continue;

    const texto = v.texto(datos[`acordado_${fila.id}`]);
    const campos = {
      acordado_texto: texto,
      reunion_acuerdo_id: texto === null ? null : reunionId,
    };
    if (
      campos.acordado_texto === fila.acordado_texto &&
      campos.reunion_acuerdo_id === fila.reunion_acuerdo_id
    ) {
      continue;
    }
    cambios.push({ fila, campos });
  }

  if (cambios.length === 0) return { reunion, cambiadas: 0 };

  return enTransaccion(() => {
    for (const { fila, campos } of cambios) {
      actualizar({
        tabla: 'plan_detalle',
        id: fila.id,
        campos,
        etiquetas: {
          acordado_texto: `Lo acordado en ${fila.disciplina}`,
          reunion_acuerdo_id: 'Acta que lo respalda',
        },
        volverA: `/reuniones/${reunionId}`,
      });
      registrar({
        actor,
        tipo: 'acuerdo.cargado',
        entidad: 'plan_detalle',
        entidadId: fila.id,
        planId: reunion.plan_id,
        reunionId,
        datosAnteriores: { disciplina: fila.disciplina, acordado_texto: fila.acordado_texto },
        datosPosteriores: { disciplina: fila.disciplina, ...campos },
      });
    }
    return { reunion, cambiadas: cambios.length };
  });
}

/** Las disciplinas del plan con lo acordado, para mostrarlas y cargarlas en el acta. */
export function disciplinasParaActa(reunionId) {
  const reunion = exigir(reunionId);
  return todos(
    `SELECT d.*, m.inicio AS acuerdo_inicio, m.acta_estado AS acuerdo_acta_estado
     FROM plan_detalle d
     LEFT JOIN reunion m ON m.id = d.reunion_acuerdo_id
     WHERE d.plan_id = ?
     ORDER BY ${ordenPorPlanilla('d')}`,
    reunion.plan_id,
  );
}

export function enviarActaARevision(actor, reunionId, datos = {}) {
  exigirActivo(actor);
  const reunion = exigir(reunionId);
  exigirPlanAbierto(reunion);
  if (!puedeEditarActa(actor, reunion)) {
    throw new ErrorPermiso('Solo Dirección o el ayudante asignado envían esta acta a revisión.');
  }
  if (reunion.acta_estado !== 'Borrador') {
    throw new ErrorNegocio(
      reunion.acta_estado === 'Para revisar'
        ? 'El acta ya está en revisión.'
        : 'El acta ya está aprobada.',
    );
  }
  if (reunion.estado !== 'Realizada') {
    throw new ErrorNegocio('Dirección tiene que marcar la reunión como realizada antes de enviar el acta.');
  }
  const faltan = [];
  if (!reunion.delegados_presentes) faltan.push('participantes');
  if (!reunion.acta) faltan.push('acta');
  if (!reunion.devolucion_club) faltan.push('devolución del club');
  if (!reunion.proximo_paso) faltan.push('próximo paso');
  if (faltan.length > 0) throw new ErrorNegocio(`Falta completar: ${faltan.join(', ')}.`);

  return enTransaccion(() => {
    // Un envío nuevo limpia el motivo de devolución anterior: una devolución
    // posterior necesita una explicación nueva.
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { acta_estado: 'Para revisar', motivo_devolucion: null },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'acta.enviada',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      estadoAnterior: 'Borrador',
      estadoPosterior: 'Para revisar',
    });
    return guardado;
  });
}

export function devolverActa(actor, reunionId, datos) {
  exigirDireccion(actor, 'devolver un acta');
  const reunion = exigir(reunionId);
  exigirPlanAbierto(reunion);
  if (reunion.acta_estado !== 'Para revisar') {
    throw new ErrorNegocio('Se devuelve un acta que está en revisión.');
  }
  const motivo = v.motivo(datos.motivo, 'El motivo de la devolución');

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { acta_estado: 'Borrador', motivo_devolucion: motivo },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'acta.devuelta',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      motivo,
      estadoAnterior: 'Para revisar',
      estadoPosterior: 'Borrador',
    });
    return guardado;
  });
}

/** Aprueba el acta: sello de sesión y reloj del servidor, y bloqueo de su contenido. */
export function aprobarActa(actor, reunionId, datos = {}) {
  exigirDireccion(actor, 'aprobar actas');
  const reunion = exigir(reunionId);
  const plan = exigirPlanAbierto(reunion);
  if (reunion.acta_estado !== 'Para revisar') {
    throw new ErrorNegocio('Se aprueba un acta que está en revisión.');
  }
  // Una disciplina atada a esta acta tiene que decir qué se acordó con ella.
  const sinAcordar = todos(
    `SELECT disciplina FROM plan_detalle
     WHERE reunion_acuerdo_id = ? AND acordado_texto IS NULL AND tiras_acordadas IS NULL`,
    reunionId,
  );
  if (sinAcordar.length > 0) {
    throw new ErrorNegocio(
      `Falta decir qué se acordó en: ${sinAcordar.map((d) => d.disciplina).join(', ')}.`,
      { ayuda: 'Se escribe en el acta, en "Lo que se acordó".' },
    );
  }
  const reconValidada = uno(
    'SELECT id FROM reconfirmacion WHERE plan_id = ? AND validada_en IS NOT NULL',
    reunion.plan_id,
  );
  if (reconValidada) {
    throw new ErrorNegocio(
      'El resultado final del plan ya está aprobado: reabrí la reconfirmación antes de aprobar un acta nueva.',
    );
  }

  return enTransaccion(() => {
    const sello = ahora();
    const guardado = actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: { acta_estado: 'Validada', acta_validada_por_id: actor.id, acta_validada_en: sello },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
    registrar({
      actor,
      tipo: 'acta.aprobada',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      estadoAnterior: 'Para revisar',
      estadoPosterior: 'Validada',
      datosPosteriores: instantaneaReunion(reunionId),
    });

    return guardado;
  });
}

/** Reabre un acta aprobada: guarda copia íntegra, libera el contenido y borra los sellos. */
export function reabrirActa(actor, reunionId, datos) {
  exigirDireccion(actor, 'reabrir un acta aprobada');
  const reunion = exigir(reunionId);
  const plan = uno('SELECT * FROM plan WHERE id = ?', reunion.plan_id);
  if (reunion.acta_estado !== 'Validada') throw new ErrorNegocio('Esa acta no está aprobada.');
  if (plan.estado === 'Cerrada' || plan.estado === 'Archivada') {
    throw new ErrorNegocio('Primero hay que reabrir el plan, después la reconfirmación y por último el acta.');
  }
  const reconValidada = uno(
    'SELECT id FROM reconfirmacion WHERE plan_id = ? AND validada_en IS NOT NULL',
    reunion.plan_id,
  );
  if (reconValidada) {
    throw new ErrorNegocio('Primero hay que reabrir la reconfirmación aprobada, después el acta.');
  }
  const motivo = v.motivo(datos.motivo, 'El motivo de la reapertura');

  return enTransaccion(() => {
    registrar({
      actor,
      tipo: 'acta.reabierta',
      entidad: 'reunion',
      entidadId: reunionId,
      planId: reunion.plan_id,
      reunionId,
      motivo,
      estadoAnterior: 'Validada',
      estadoPosterior: 'Borrador',
      datosAnteriores: instantaneaReunion(reunionId),
    });
    return actualizar({
      tabla: 'reunion',
      id: reunionId,
      campos: {
        acta_estado: 'Borrador',
        acta_validada_por_id: null,
        acta_validada_en: null,
        motivo_devolucion: null,
      },
      version: datos.version ?? null,
      volverA: `/reuniones/${reunionId}`,
    });
  });
}
