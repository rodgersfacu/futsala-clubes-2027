import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirActivo } from '../auth.js';
import { ahora, hoy } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado, ErrorPermiso } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar, actualizar } from './registro.js';

export const ESTADOS = ['Pendiente', 'En curso', 'Cumplido', 'Cancelado'];
export const PARTES = ['FUTSALA', 'Club'];
export const ABIERTOS = ['Pendiente', 'En curso'];

const SELECCION = `
  SELECT c.*, u.nombre AS responsable_nombre, u.activo AS responsable_activo,
         m.plan_id, m.inicio AS reunion_inicio, m.acta_estado,
         p.club_id, p.estado AS plan_estado, cl.nombre AS club_nombre,
         (c.estado IN ('Pendiente','En curso') AND c.fecha_limite < ?) AS vencido
  FROM compromiso c
  JOIN usuario u ON u.id = c.responsable_id
  JOIN reunion m ON m.id = c.reunion_id
  JOIN plan p ON p.id = m.plan_id
  JOIN club cl ON cl.id = p.club_id`;

export function obtener(id) {
  return uno(`${SELECCION} WHERE c.id = ?`, hoy(), id);
}

export function exigir(id) {
  const tarea = obtener(id);
  if (!tarea) throw new ErrorNoEncontrado('Ese compromiso no existe.');
  return tarea;
}

export function porReunion(reunionId) {
  return todos(`${SELECCION} WHERE c.reunion_id = ? ORDER BY c.fecha_limite`, hoy(), reunionId);
}

export function porPlan(planId) {
  return todos(`${SELECCION} WHERE m.plan_id = ? ORDER BY c.fecha_limite`, hoy(), planId);
}

export function listar({ filtro = 'abiertos', responsableId = null } = {}) {
  const fecha = hoy();
  let condicion = '';
  if (filtro === 'abiertos') condicion = `AND c.estado IN ('Pendiente','En curso')`;
  if (filtro === 'vencidos') condicion = `AND c.estado IN ('Pendiente','En curso') AND c.fecha_limite < '${fecha}'`;
  if (filtro === 'resueltos') condicion = `AND c.estado IN ('Cumplido','Cancelado')`;
  const porResponsable = responsableId ? 'AND c.responsable_id = ?' : '';
  const params = responsableId ? [fecha, responsableId] : [fecha];
  return todos(
    `${SELECCION} WHERE 1 = 1 ${condicion} ${porResponsable}
     ORDER BY CASE WHEN c.estado IN ('Pendiente','En curso') THEN 0 ELSE 1 END, c.fecha_limite`,
    ...params,
  );
}

export function vencidos(responsableId = null) {
  return listar({ filtro: 'vencidos', responsableId });
}

/**
 * Permiso de escritura sobre un compromiso.
 * Dirección: todo. Ayudante: solo tareas propias abiertas, con usuario activo.
 * Consulta: nada. Esta restricción se aplica en servidor, no en los botones.
 */
export function puedeEditar(usuario, tarea) {
  if (!usuario || usuario.activo !== 1) return false;
  if (usuario.rol === 'Direccion') return true;
  if (usuario.rol !== 'Ayudante') return false;
  return tarea.responsable_id === usuario.id && ABIERTOS.includes(tarea.estado);
}

function exigirPlanAbierto(planEstado) {
  if (planEstado === 'Cerrada' || planEstado === 'Archivada') {
    throw new ErrorNegocio('El plan está cerrado: reabrilo con motivo para cambiar sus compromisos.');
  }
}

export function crear(actor, reunionId, datos) {
  exigirActivo(actor);
  const reunion = uno(
    `SELECT m.*, p.estado AS plan_estado FROM reunion m JOIN plan p ON p.id = m.plan_id WHERE m.id = ?`,
    reunionId,
  );
  if (!reunion) throw new ErrorNoEncontrado('Esa reunión no existe.');
  exigirPlanAbierto(reunion.plan_estado);

  const esDireccion = actor.rol === 'Direccion';
  const esAyudanteAsignado =
    actor.rol === 'Ayudante' && reunion.acta_responsable_id === actor.id && reunion.acta_estado !== 'Validada';
  if (!esDireccion && !esAyudanteAsignado) {
    throw new ErrorPermiso(
      actor.rol === 'Ayudante'
        ? 'Podés crear compromisos solo desde las actas que te asignaron y mientras no estén aprobadas.'
        : 'Tu rol no puede crear compromisos.',
    );
  }

  const descripcion = v.textoObligatorio(datos.descripcion, 'La descripción', { minimo: 3 });
  const parte = v.opcion(datos.parte_responsable, PARTES, 'La parte responsable');
  const contacto = v.texto(datos.contacto_club);
  if (parte === 'Club' && !contacto) {
    throw new ErrorNegocio('Si el compromiso es del club, hace falta indicar con quién se gestiona.', {
      campo: 'contacto_club',
    });
  }
  const fechaLimite = v.fecha(datos.fecha_limite, 'El vencimiento', { obligatorio: true });

  // Un ayudante solo se asigna tareas a sí mismo.
  let responsableId = esDireccion ? v.texto(datos.responsable_id) : actor.id;
  if (!responsableId) responsableId = actor.id;
  const responsable = uno('SELECT * FROM usuario WHERE id = ?', responsableId);
  if (!responsable) throw new ErrorNegocio('El responsable interno no existe.');
  if (responsable.activo !== 1) throw new ErrorNegocio('El responsable interno tiene que estar activo.');
  if (responsable.rol === 'Consulta') {
    throw new ErrorNegocio('Un usuario de consulta no puede quedar como responsable de una tarea.');
  }

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO compromiso (id, reunion_id, descripcion, parte_responsable, responsable_id, contacto_club,
                               fecha_limite, estado, evidencia_url, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?)`,
      id,
      reunionId,
      descripcion,
      parte,
      responsableId,
      contacto,
      fechaLimite,
      v.url(datos.evidencia_url, 'El enlace de evidencia'),
      ahora(),
      actor.id,
    );
    registrar({
      actor,
      tipo: 'compromiso.creado',
      entidad: 'compromiso',
      entidadId: id,
      planId: reunion.plan_id,
      reunionId,
      estadoPosterior: 'Pendiente',
      datosPosteriores: { descripcion, parte, responsableId, fechaLimite },
    });
    return obtener(id);
  });
}

export function editar(actor, compromisoId, datos) {
  exigirActivo(actor);
  const tarea = exigir(compromisoId);
  exigirPlanAbierto(tarea.plan_estado);
  if (!puedeEditar(actor, tarea)) {
    throw new ErrorPermiso(
      actor.rol === 'Ayudante'
        ? 'Solo podés editar tus propias tareas mientras estén abiertas.'
        : 'Tu rol no puede editar compromisos.',
    );
  }
  if (!ABIERTOS.includes(tarea.estado)) {
    throw new ErrorNegocio('Un compromiso resuelto no se edita: queda como registro.');
  }

  const parte = v.opcion(datos.parte_responsable, PARTES, 'La parte responsable');
  const contacto = v.texto(datos.contacto_club);
  if (parte === 'Club' && !contacto) {
    throw new ErrorNegocio('Si el compromiso es del club, hace falta indicar con quién se gestiona.');
  }

  const campos = {
    descripcion: v.textoObligatorio(datos.descripcion, 'La descripción', { minimo: 3 }),
    parte_responsable: parte,
    contacto_club: contacto,
    fecha_limite: v.fecha(datos.fecha_limite, 'El vencimiento', { obligatorio: true }),
    evidencia_url: v.url(datos.evidencia_url, 'El enlace de evidencia'),
  };

  // Reasignar una tarea es facultad de Dirección.
  if (actor.rol === 'Direccion') {
    const responsableId = v.texto(datos.responsable_id) || tarea.responsable_id;
    const responsable = uno('SELECT * FROM usuario WHERE id = ?', responsableId);
    if (!responsable || responsable.activo !== 1 || responsable.rol === 'Consulta') {
      throw new ErrorNegocio('El responsable interno tiene que ser un usuario activo con rol que pueda ejecutar tareas.');
    }
    campos.responsable_id = responsableId;
  } else if (v.texto(datos.responsable_id) && v.texto(datos.responsable_id) !== tarea.responsable_id) {
    throw new ErrorPermiso('Solo Dirección reasigna un compromiso a otra persona.');
  }

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'compromiso',
      id: compromisoId,
      campos,
      version: datos.version ?? null,
      etiquetas: {
        descripcion: 'Descripción',
        fecha_limite: 'Vencimiento',
        responsable_id: 'Responsable',
        parte_responsable: 'Parte responsable',
      },
      volverA: '/compromisos',
    });
    registrar({
      actor,
      tipo: 'compromiso.editado',
      entidad: 'compromiso',
      entidadId: compromisoId,
      planId: tarea.plan_id,
      reunionId: tarea.reunion_id,
      datosAnteriores: {
        descripcion: tarea.descripcion,
        fecha_limite: tarea.fecha_limite,
        responsable_id: tarea.responsable_id,
      },
      datosPosteriores: campos,
    });
    return guardado;
  });
}

export function iniciar(actor, compromisoId, datos = {}) {
  exigirActivo(actor);
  const tarea = exigir(compromisoId);
  exigirPlanAbierto(tarea.plan_estado);
  if (!puedeEditar(actor, tarea)) throw new ErrorPermiso('No podés cambiar el estado de este compromiso.');
  if (tarea.estado !== 'Pendiente') throw new ErrorNegocio('Solo un compromiso pendiente pasa a "en curso".');
  return cambiarEstado(actor, tarea, { estado: 'En curso' }, 'compromiso.en_curso', datos.version);
}

export function cumplir(actor, compromisoId, datos) {
  exigirActivo(actor);
  const tarea = exigir(compromisoId);
  exigirPlanAbierto(tarea.plan_estado);
  if (!puedeEditar(actor, tarea)) throw new ErrorPermiso('No podés resolver este compromiso.');
  if (!ABIERTOS.includes(tarea.estado)) throw new ErrorNegocio('Ese compromiso ya está resuelto.');

  const resolucion = v.textoObligatorio(datos.resolucion, 'La resolución', { minimo: 3 });
  const fechaResolucion = v.noFutura(
    v.fecha(datos.fecha_resolucion || hoy(), 'La fecha de resolución', { obligatorio: true }),
    'La fecha de resolución',
  );

  return cambiarEstado(
    actor,
    tarea,
    {
      estado: 'Cumplido',
      resolucion,
      fecha_resolucion: fechaResolucion,
      evidencia_url: v.url(datos.evidencia_url, 'El enlace de evidencia') || tarea.evidencia_url,
    },
    'compromiso.cumplido',
    datos.version,
  );
}

export function cancelarTarea(actor, compromisoId, datos) {
  exigirActivo(actor);
  const tarea = exigir(compromisoId);
  exigirPlanAbierto(tarea.plan_estado);
  if (actor.rol !== 'Direccion') throw new ErrorPermiso('Solo Dirección cancela un compromiso.');
  if (!ABIERTOS.includes(tarea.estado)) throw new ErrorNegocio('Ese compromiso ya está resuelto.');
  const motivo = v.motivo(datos.motivo, 'El motivo de la cancelación');

  return cambiarEstado(
    actor,
    tarea,
    { estado: 'Cancelado', resolucion: motivo },
    'compromiso.cancelado',
    datos.version,
    motivo,
  );
}

function cambiarEstado(actor, tarea, campos, tipo, version = null, motivo = null) {
  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'compromiso',
      id: tarea.id,
      campos,
      version: version ?? null,
      volverA: '/compromisos',
    });
    registrar({
      actor,
      tipo,
      entidad: 'compromiso',
      entidadId: tarea.id,
      planId: tarea.plan_id,
      reunionId: tarea.reunion_id,
      motivo,
      estadoAnterior: tarea.estado,
      estadoPosterior: campos.estado,
      datosPosteriores: campos,
    });
    return guardado;
  });
}
