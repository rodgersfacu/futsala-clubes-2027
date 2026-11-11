// Días y horarios en que cada Dirección acepta que le agenden reuniones, y los tramos
// en que no está (vacaciones). Es una guía para quien agenda: avisa, no bloquea.
import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion, exigirActivo } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado, ErrorPermiso } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar } from './registro.js';

export const DIAS = [
  { numero: 1, nombre: 'Lunes', corto: 'Lun' },
  { numero: 2, nombre: 'Martes', corto: 'Mar' },
  { numero: 3, nombre: 'Miércoles', corto: 'Mié' },
  { numero: 4, nombre: 'Jueves', corto: 'Jue' },
  { numero: 5, nombre: 'Viernes', corto: 'Vie' },
  { numero: 6, nombre: 'Sábado', corto: 'Sáb' },
  { numero: 7, nombre: 'Domingo', corto: 'Dom' },
];

export function nombreDia(numero) {
  return DIAS.find((d) => d.numero === Number(numero))?.nombre || '—';
}

/** 1 = lunes … 7 = domingo, para una fecha AAAA-MM-DD. */
export function diaSemanaDe(fecha) {
  const dia = new Date(`${String(fecha).slice(0, 10)}T00:00:00Z`).getUTCDay();
  return ((dia + 6) % 7) + 1;
}

export function franjasDe(usuarioId) {
  return todos(
    'SELECT * FROM disponibilidad WHERE usuario_id = ? ORDER BY dia_semana, desde',
    usuarioId,
  );
}

export function ausenciasDe(usuarioId) {
  return todos('SELECT * FROM ausencia WHERE usuario_id = ? ORDER BY desde', usuarioId);
}

/** Agenda de todas las direcciones activas, para la pantalla de disponibilidad. */
export function porDireccion() {
  return todos(`SELECT * FROM usuario WHERE rol = 'Direccion' AND activo = 1 ORDER BY nombre`).map((usuario) => ({
    usuario,
    franjas: franjasDe(usuario.id),
    ausencias: ausenciasDe(usuario.id),
  }));
}

// --- Franjas semanales -------------------------------------------------------

export function agregarFranja(actor, datos) {
  exigirDireccion(actor, 'cargar su disponibilidad');
  const usuarioId = propio(actor, datos.usuario_id);
  const diaSemana = v.entero(datos.dia_semana, 'El día', { obligatorio: true });
  if (diaSemana < 1 || diaSemana > 7) throw new ErrorNegocio('El día no es válido.');
  const desde = hora(datos.desde, 'La hora de inicio');
  const hasta = hora(datos.hasta, 'La hora de fin');
  if (hasta <= desde) throw new ErrorNegocio('La hora de fin tiene que ser posterior a la de inicio.');

  const solapada = todos(
    'SELECT * FROM disponibilidad WHERE usuario_id = ? AND dia_semana = ?',
    usuarioId,
    diaSemana,
  ).find((f) => f.desde < hasta && f.hasta > desde);
  if (solapada) {
    throw new ErrorNegocio(
      `Ya tenés una franja ese día de ${solapada.desde} a ${solapada.hasta}. Borrala antes de cargar otra que se pise.`,
    );
  }

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO disponibilidad (id, usuario_id, dia_semana, desde, hasta, nota, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      usuarioId,
      diaSemana,
      desde,
      hasta,
      v.texto(datos.nota),
      ahora(),
    );
    registrar({
      actor,
      tipo: 'disponibilidad.agregada',
      entidad: 'disponibilidad',
      entidadId: id,
      datosPosteriores: { dia: nombreDia(diaSemana), desde, hasta },
    });
    return uno('SELECT * FROM disponibilidad WHERE id = ?', id);
  });
}

export function quitarFranja(actor, franjaId) {
  exigirDireccion(actor, 'cambiar su disponibilidad');
  const franja = uno('SELECT * FROM disponibilidad WHERE id = ?', franjaId);
  if (!franja) throw new ErrorNoEncontrado('Esa franja no existe.');
  propio(actor, franja.usuario_id);

  return enTransaccion(() => {
    registrar({
      actor,
      tipo: 'disponibilidad.quitada',
      entidad: 'disponibilidad',
      entidadId: franjaId,
      datosAnteriores: franja,
    });
    ejecutar('DELETE FROM disponibilidad WHERE id = ?', franjaId);
    return franja;
  });
}

// --- Ausencias ---------------------------------------------------------------

export function agregarAusencia(actor, datos) {
  exigirDireccion(actor, 'cargar sus ausencias');
  const usuarioId = propio(actor, datos.usuario_id);
  const desde = v.fecha(datos.desde, 'El desde', { obligatorio: true });
  const hasta = v.fecha(datos.hasta, 'El hasta', { obligatorio: true });
  if (hasta < desde) throw new ErrorNegocio('El hasta no puede ser anterior al desde.');

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      'INSERT INTO ausencia (id, usuario_id, desde, hasta, motivo, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      usuarioId,
      desde,
      hasta,
      v.texto(datos.motivo),
      ahora(),
    );
    registrar({
      actor,
      tipo: 'ausencia.agregada',
      entidad: 'ausencia',
      entidadId: id,
      datosPosteriores: { desde, hasta, motivo: v.texto(datos.motivo) },
    });
    return uno('SELECT * FROM ausencia WHERE id = ?', id);
  });
}

export function quitarAusencia(actor, ausenciaId) {
  exigirDireccion(actor, 'cambiar sus ausencias');
  const ausencia = uno('SELECT * FROM ausencia WHERE id = ?', ausenciaId);
  if (!ausencia) throw new ErrorNoEncontrado('Esa ausencia no existe.');
  propio(actor, ausencia.usuario_id);

  return enTransaccion(() => {
    registrar({
      actor,
      tipo: 'ausencia.quitada',
      entidad: 'ausencia',
      entidadId: ausenciaId,
      datosAnteriores: ausencia,
    });
    ejecutar('DELETE FROM ausencia WHERE id = ?', ausenciaId);
    return ausencia;
  });
}

// --- Consulta ----------------------------------------------------------------

/**
 * ¿Esta persona acepta una reunión en ese horario?
 * Devuelve { disponible, motivo }. Es informativo: nadie queda bloqueado por esto.
 */
export function revisar(usuarioId, inicio, fin) {
  if (!usuarioId || !inicio) return { disponible: true, motivo: null };
  const fecha = String(inicio).slice(0, 10);
  const horaInicio = String(inicio).slice(11, 16);
  const horaFin = fin ? String(fin).slice(11, 16) : horaInicio;

  const ausencia = todos(
    'SELECT * FROM ausencia WHERE usuario_id = ? AND desde <= ? AND hasta >= ?',
    usuarioId,
    fecha,
    fecha,
  )[0];
  if (ausencia) {
    return {
      disponible: false,
      motivo: ausencia.motivo ? `no está (${ausencia.motivo})` : 'no está esos días',
    };
  }

  const franjas = todos(
    'SELECT * FROM disponibilidad WHERE usuario_id = ? AND dia_semana = ? ORDER BY desde',
    usuarioId,
    diaSemanaDe(fecha),
  );
  if (franjas.length === 0) {
    return { disponible: false, motivo: `no tiene horarios cargados para los ${nombreDia(diaSemanaDe(fecha)).toLowerCase()}` };
  }
  const entra = franjas.some((f) => horaInicio >= f.desde && horaFin <= f.hasta);
  if (!entra) {
    const horarios = franjas.map((f) => `${f.desde} a ${f.hasta}`).join(', ');
    return { disponible: false, motivo: `ese día atiende ${horarios}` };
  }
  return { disponible: true, motivo: null };
}

/** Aviso en una línea para mostrar al agendar. Null si no hay nada que avisar. */
export function avisoDeAgenda({ director1_id, director2_id, inicio, fin }) {
  if (!inicio) return null;
  const problemas = [];
  for (const id of [director1_id, director2_id].filter(Boolean)) {
    const { disponible, motivo } = revisar(id, inicio, fin);
    if (!disponible) {
      const nombre = uno('SELECT nombre FROM usuario WHERE id = ?', id)?.nombre || 'esa Dirección';
      problemas.push(`${nombre}: ${motivo}`);
    }
  }
  return problemas.length > 0 ? `Fuera de la disponibilidad cargada — ${problemas.join(' · ')}` : null;
}

// --- Auxiliares --------------------------------------------------------------

function propio(actor, usuarioId) {
  const pedido = v.texto(usuarioId) || actor.id;
  if (pedido !== actor.id) {
    throw new ErrorPermiso('Cada Dirección carga su propia disponibilidad.');
  }
  exigirActivo(actor);
  return actor.id;
}

function hora(valor, etiqueta) {
  const limpio = v.texto(valor);
  if (!limpio) throw new ErrorNegocio(`${etiqueta} es obligatoria.`, { campo: etiqueta });
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(limpio)) {
    throw new ErrorNegocio(`${etiqueta} tiene que tener formato HH:MM.`, { campo: etiqueta });
  }
  return limpio;
}
