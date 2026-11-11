import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion, ROLES } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar, actualizar } from './registro.js';

export function listar({ incluirInactivos = true } = {}) {
  return todos(
    `SELECT * FROM usuario ${incluirInactivos ? '' : 'WHERE activo = 1'}
     ORDER BY CASE rol WHEN 'Direccion' THEN 0 WHEN 'Ayudante' THEN 1 ELSE 2 END, nombre`,
  );
}

export function activos(rol = null) {
  return rol
    ? todos('SELECT * FROM usuario WHERE activo = 1 AND rol = ? ORDER BY nombre', rol)
    : todos('SELECT * FROM usuario WHERE activo = 1 ORDER BY nombre');
}

export function obtener(id) {
  return id ? uno('SELECT * FROM usuario WHERE id = ?', id) : null;
}

export function porEmail(correo) {
  const limpio = v.email(correo);
  return limpio ? uno('SELECT * FROM usuario WHERE email = ?', limpio) : null;
}

export function nombreDe(id) {
  const u = obtener(id);
  return u ? u.nombre : '—';
}

export function crear(actor, datos) {
  exigirDireccion(actor, 'dar de alta usuarios');
  const nombre = v.textoObligatorio(datos.nombre, 'El nombre', { minimo: 2 });
  const correo = v.email(datos.email, 'El correo');
  if (!correo) throw new ErrorNegocio('El correo es obligatorio.', { campo: 'email' });
  const rol = v.opcion(datos.rol, ROLES, 'El rol');
  const activo = v.booleano(datos.activo);

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      'INSERT INTO usuario (id, email, nombre, rol, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      correo,
      nombre,
      rol,
      activo,
      ahora(),
    );
    registrar({
      actor,
      tipo: 'usuario.creado',
      entidad: 'usuario',
      entidadId: id,
      estadoPosterior: `${rol}${activo ? ' activo' : ' inactivo'}`,
      datosPosteriores: { email: correo, nombre, rol, activo },
    });
    return obtener(id);
  });
}

/**
 * Cambio de rol o de estado. Nadie puede elevar su propio rol ni desactivarse a sí
 * mismo desde los formularios ordinarios, y siempre tiene que quedar una Dirección activa.
 */
export function cambiarAcceso(actor, usuarioId, datos) {
  exigirDireccion(actor, 'administrar usuarios y roles');
  const objetivo = obtener(usuarioId);
  if (!objetivo) throw new ErrorNoEncontrado('Ese usuario no existe.');

  const rol = v.opcion(datos.rol, ROLES, 'El rol');
  const activo = v.booleano(datos.activo);

  // Nadie toca su propio acceso desde los formularios ordinarios, ni para dejarlo igual:
  // así no hay ninguna vía por la que alguien se eleve el rol a sí mismo.
  if (objetivo.id === actor.id) {
    throw new ErrorNegocio(
      'No podés cambiar tu propio rol ni tu propio acceso desde esta pantalla. Pedíselo a la otra Dirección.',
      { estado: 403 },
    );
  }

  if (objetivo.rol === 'Direccion' && (rol !== 'Direccion' || activo === 0)) {
    const otras = uno(
      `SELECT count(*) AS n FROM usuario WHERE rol = 'Direccion' AND activo = 1 AND id <> ?`,
      objetivo.id,
    ).n;
    if (otras === 0) {
      throw new ErrorNegocio('Tiene que quedar al menos una Dirección activa.');
    }
  }

  // El nombre se puede corregir: se escribe mal, la gente cambia de apellido, y una
  // cuenta de sistema conviene que diga qué es. El correo no, porque es la identidad con
  // la que se entra y por la que el historial la reconoce.
  const nombre = datos.nombre === undefined ? objetivo.nombre : v.textoObligatorio(datos.nombre, 'El nombre', { minimo: 2 });

  return enTransaccion(() => {
    const anterior = { nombre: objetivo.nombre, rol: objetivo.rol, activo: objetivo.activo };
    const actualizado = actualizar({
      tabla: 'usuario',
      id: objetivo.id,
      campos: { nombre, rol, activo },
      version: datos.version ?? null,
      etiquetas: { nombre: 'Nombre', rol: 'Rol', activo: 'Activo' },
      volverA: '/admin',
    });
    registrar({
      actor,
      tipo: 'usuario.acceso',
      entidad: 'usuario',
      entidadId: objetivo.id,
      estadoAnterior: `${anterior.rol}${anterior.activo ? ' activo' : ' inactivo'}`,
      estadoPosterior: `${rol}${activo ? ' activo' : ' inactivo'}`,
      datosAnteriores: anterior,
      datosPosteriores: { nombre, rol, activo },
    });
    return actualizado;
  });
}

export function parametros() {
  return uno(`SELECT * FROM parametros WHERE id = 'CICLO-2027'`);
}

export function guardarParametros(actor, datos) {
  exigirDireccion(actor, 'cambiar los parámetros del ciclo');
  const actualParam = parametros();
  if (!actualParam) throw new ErrorNoEncontrado('No hay parámetros cargados.');

  const inicio = v.fecha(datos.inicio_reconfirmacion, 'El inicio de la ventana', { obligatorio: true });
  const fin = v.fecha(datos.fin_reconfirmacion, 'El fin de la ventana', { obligatorio: true });
  if (fin < inicio) throw new ErrorNegocio('El fin de la ventana no puede ser anterior al inicio.');

  // Los envíos quedan apagados en esta versión: el interruptor existe, pero encenderlo
  // requiere autorización explícita y todavía no hay canal de envío construido.
  const avisosInternos = v.booleano(datos.avisos_internos);
  const avisosExternos = v.booleano(datos.avisos_externos);
  if (avisosExternos) {
    throw new ErrorNegocio(
      'Los avisos a clubes no están disponibles en esta versión y no se pueden activar desde la app.',
    );
  }

  return enTransaccion(() => {
    const anterior = { ...actualParam };
    const guardado = actualizar({
      tabla: 'parametros',
      id: 'CICLO-2027',
      campos: {
        inicio_reconfirmacion: inicio,
        fin_reconfirmacion: fin,
        avisos_internos: avisosInternos,
        avisos_externos: 0,
      },
      version: datos.version ?? null,
      volverA: '/admin',
    });
    registrar({
      actor,
      tipo: 'parametros.actualizados',
      entidad: 'parametros',
      entidadId: 'CICLO-2027',
      datosAnteriores: anterior,
      datosPosteriores: guardado,
    });
    return guardado;
  });
}
