// Ingreso con correo y contraseña, ingreso con Google y pedidos de acceso.
//
// Reglas, las mismas que en Futsala Clubes:
// - Registrarse NO da permisos. Crea una solicitud pendiente; Dirección la aprueba
//   eligiendo el rol y recién ahí nace el usuario.
// - La contraseña se guarda como scrypt con sal individual. Nunca en claro.
// - Google entra solo a la cuenta ya vinculada a esa identidad Google. Si Dirección dio
//   de alta el correo y la persona todavía no tiene contraseña, el primer ingreso con
//   Google con ese mismo correo la vincula. Si ya tiene contraseña, coincidir el correo
//   NO alcanza: tiene que vincular Google desde Mi cuenta, confirmando su contraseña.
// - Los enlaces de un solo uso siguen andando, para recuperar el acceso.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion, exigirActivo, ROLES } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado, ErrorPermiso } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar } from './registro.js';

// --- Contraseñas ---------------------------------------------------------------

export function validarClave(clave) {
  if (typeof clave !== 'string' || clave.length < 8 || clave.length > 128) {
    throw new ErrorNegocio('Usá una contraseña de entre 8 y 128 caracteres.', { campo: 'clave' });
  }
  if (!/[\p{P}\p{S}]/u.test(clave)) {
    throw new ErrorNegocio('Agregá al menos un signo a tu contraseña, por ejemplo !, @ o #.', { campo: 'clave' });
  }
}

export function hashClave(clave) {
  validarClave(clave);
  const sal = randomBytes(16).toString('hex');
  return `scrypt$${sal}$${scryptSync(clave, sal, 64).toString('hex')}`;
}

// Hash de relleno: comparar contra algo aunque el correo no exista, para que la demora no
// delate qué correos tienen cuenta.
const RELLENO = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

export function claveCoincide(clave, guardado) {
  const [, sal, esperado] = String(guardado || RELLENO).split('$');
  const calculado = scryptSync(typeof clave === 'string' && clave.length <= 128 ? clave : '', sal || '', 64);
  return !!guardado && !!esperado && esperado.length === 128 && timingSafeEqual(calculado, Buffer.from(esperado, 'hex'));
}

function repetidaIgual(datos) {
  if (datos.clave !== datos.repetir) {
    throw new ErrorNegocio('Las contraseñas no coinciden.', { campo: 'repetir' });
  }
}

// --- Solicitudes -----------------------------------------------------------------

export function solicitudPendiente(email) {
  return uno(`SELECT * FROM solicitud_acceso WHERE email = ? AND estado = 'pendiente'`, email);
}

export function pendientes() {
  return todos(`SELECT * FROM solicitud_acceso WHERE estado = 'pendiente' ORDER BY creada_en`);
}

/** Alguien se registra con correo y contraseña. Queda pendiente, sin permisos. */
export function registrarse(datos) {
  const nombre = v.textoObligatorio(datos.nombre, 'El nombre', { minimo: 2 });
  const email = v.email(datos.email, 'El correo');
  if (!email) throw new ErrorNegocio('Escribí tu correo.', { campo: 'email' });
  repetidaIgual(datos);
  const claveHash = hashClave(datos.clave);
  if (uno('SELECT id FROM usuario WHERE email = ?', email)) {
    throw new ErrorNegocio('Ese correo ya tiene usuario.', {
      ayuda: 'Entrá con tu contraseña o con Google. Si nunca creaste contraseña, pedí un enlace de acceso y creala desde Mi cuenta.',
    });
  }
  if (solicitudPendiente(email)) {
    throw new ErrorNegocio('Ya hay una solicitud pendiente para ese correo.', {
      ayuda: 'Dirección tiene que aprobarla. Cuando lo haga, entrás con tu correo y contraseña.',
    });
  }
  const id = nuevoId();
  ejecutar(
    'INSERT INTO solicitud_acceso (id, email, nombre, clave_hash, creada_en) VALUES (?, ?, ?, ?, ?)',
    id,
    email,
    nombre,
    claveHash,
    ahora(),
  );
  return uno('SELECT * FROM solicitud_acceso WHERE id = ?', id);
}

const PENDIENTE = () =>
  new ErrorNegocio('Tu solicitud de acceso está pendiente.', {
    ayuda: 'Dirección tiene que aprobarla y asignarte un rol. Después vas a poder entrar.',
  });

/** Ingreso con correo y contraseña. Devuelve el usuario, o lanza un error claro. */
export function ingresarConClave(datos) {
  const email = v.texto(datos.email)?.toLowerCase() || '';
  const usuario = uno('SELECT * FROM usuario WHERE email = ?', email);
  if (usuario && claveCoincide(datos.clave, usuario.clave_hash)) {
    if (usuario.activo !== 1) throw new ErrorPermiso('Tu usuario está inactivo. Pedile a Dirección que lo habilite.');
    registrar({ actor: usuario, tipo: 'ingreso.clave', entidad: 'usuario', entidadId: usuario.id });
    return usuario;
  }
  const solicitud = !usuario && solicitudPendiente(email);
  if (solicitud && claveCoincide(datos.clave, solicitud.clave_hash)) throw PENDIENTE();
  throw new ErrorNegocio('Correo o contraseña incorrectos.', {
    ayuda: 'Si nunca creaste una contraseña, entrá con Google o con un enlace de acceso.',
  });
}

/**
 * Ingreso con Google. `identidad` viene de lib/firebase.js, ya verificada.
 * Devuelve { usuario } si entra, o { pendiente: true } si quedó (o ya estaba) pendiente.
 */
export function ingresarConGoogle(identidad) {
  return enTransaccion(() => {
    let usuario = uno('SELECT * FROM usuario WHERE google_sub = ?', identidad.sub);
    if (!usuario) {
      const porCorreo = uno('SELECT * FROM usuario WHERE email = ?', identidad.email);
      if (porCorreo && porCorreo.google_sub) {
        throw new ErrorPermiso('Ese correo ya está vinculado a otra cuenta Google.', {
          ayuda: 'Pedile a Dirección que revise tu acceso.',
        });
      }
      if (porCorreo && porCorreo.clave_hash) {
        throw new ErrorNegocio('Ese correo ya tiene contraseña.', {
          ayuda: 'Entrá con tu correo y contraseña y vinculá Google desde Mi cuenta.',
        });
      }
      if (porCorreo) {
        // Dirección ya dio de alta este correo y la persona demostró ser su dueña.
        ejecutar('UPDATE usuario SET google_sub = ? WHERE id = ?', identidad.sub, porCorreo.id);
        registrar({ actor: porCorreo, tipo: 'ingreso.google_vinculado', entidad: 'usuario', entidadId: porCorreo.id });
        usuario = uno('SELECT * FROM usuario WHERE id = ?', porCorreo.id);
      }
    }
    if (usuario) {
      if (usuario.activo !== 1) throw new ErrorPermiso('Tu usuario está inactivo. Pedile a Dirección que lo habilite.');
      registrar({ actor: usuario, tipo: 'ingreso.google', entidad: 'usuario', entidadId: usuario.id });
      return { usuario };
    }
    const previa = solicitudPendiente(identidad.email);
    if (previa) {
      if (!previa.google_sub) {
        ejecutar('UPDATE solicitud_acceso SET google_sub = ? WHERE id = ?', identidad.sub, previa.id);
      } else if (previa.google_sub !== identidad.sub) {
        throw new ErrorPermiso('Ese correo ya tiene una solicitud con otra cuenta Google.');
      }
      return { pendiente: true };
    }
    const nombre = identidad.nombre.length >= 2 ? identidad.nombre.slice(0, 80) : identidad.email.split('@')[0];
    ejecutar(
      'INSERT INTO solicitud_acceso (id, email, nombre, google_sub, creada_en) VALUES (?, ?, ?, ?, ?)',
      nuevoId(),
      identidad.email,
      nombre.length >= 2 ? nombre : identidad.email,
      identidad.sub,
      ahora(),
    );
    return { pendiente: true };
  });
}

// --- Mi cuenta -----------------------------------------------------------------

/** Crear o cambiar la propia contraseña. Si ya tiene una, exige la actual. */
export function cambiarClave(usuario, datos) {
  exigirActivo(usuario);
  const actual = uno('SELECT * FROM usuario WHERE id = ?', usuario.id);
  if (actual.clave_hash && !claveCoincide(datos.actual, actual.clave_hash)) {
    throw new ErrorNegocio('La contraseña actual no es correcta.', { campo: 'actual' });
  }
  repetidaIgual(datos);
  const claveHash = hashClave(datos.clave);
  enTransaccion(() => {
    ejecutar('UPDATE usuario SET clave_hash = ? WHERE id = ?', claveHash, usuario.id);
    registrar({
      actor: usuario,
      tipo: actual.clave_hash ? 'cuenta.clave_cambiada' : 'cuenta.clave_creada',
      entidad: 'usuario',
      entidadId: usuario.id,
    });
  });
}

/** Vincular la propia cuenta Google: mismo correo y, si tiene contraseña, confirmarla. */
export function vincularGoogle(usuario, identidad, clave) {
  exigirActivo(usuario);
  const actual = uno('SELECT * FROM usuario WHERE id = ?', usuario.id);
  if (identidad.email !== actual.email) {
    throw new ErrorNegocio('Elegí la cuenta Google con el mismo correo que usás acá.', {
      ayuda: `Tu correo en la aplicación es ${actual.email}.`,
    });
  }
  if (actual.clave_hash && !claveCoincide(clave, actual.clave_hash)) {
    throw new ErrorNegocio('Confirmá tu contraseña actual para vincular Google.', { campo: 'clave' });
  }
  const otro = uno('SELECT id FROM usuario WHERE google_sub = ? AND id <> ?', identidad.sub, actual.id);
  if (otro || (actual.google_sub && actual.google_sub !== identidad.sub)) {
    throw new ErrorPermiso('Esa cuenta Google ya pertenece a otro usuario. Consultá con Dirección.');
  }
  enTransaccion(() => {
    ejecutar('UPDATE usuario SET google_sub = ? WHERE id = ?', identidad.sub, actual.id);
    registrar({ actor: usuario, tipo: 'cuenta.google_vinculado', entidad: 'usuario', entidadId: actual.id });
  });
}

// --- Dirección resuelve --------------------------------------------------------

function solicitudParaResolver(actor, id) {
  exigirDireccion(actor, 'resolver solicitudes de acceso');
  const solicitud = uno('SELECT * FROM solicitud_acceso WHERE id = ?', id);
  if (!solicitud) throw new ErrorNoEncontrado('Esa solicitud no existe.');
  if (solicitud.estado !== 'pendiente') throw new ErrorNegocio('Esa solicitud ya se resolvió.');
  return solicitud;
}

/** Aprobar crea el usuario con el rol elegido y conserva su contraseña o su Google. */
export function aprobar(actor, id, datos) {
  const solicitud = solicitudParaResolver(actor, id);
  const rol = v.opcion(datos.rol, ROLES, 'El rol');
  if (uno('SELECT id FROM usuario WHERE email = ?', solicitud.email)) {
    throw new ErrorNegocio('Ya existe un usuario con ese correo.', { ayuda: 'Rechazá la solicitud: esa persona ya tiene acceso.' });
  }
  if (solicitud.google_sub && uno('SELECT id FROM usuario WHERE google_sub = ?', solicitud.google_sub)) {
    throw new ErrorNegocio('Esa cuenta Google ya pertenece a otro usuario.');
  }
  return enTransaccion(() => {
    const usuarioId = nuevoId();
    const sello = ahora();
    ejecutar(
      `INSERT INTO usuario (id, email, nombre, rol, activo, creado_en, clave_hash, google_sub)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      usuarioId,
      solicitud.email,
      solicitud.nombre,
      rol,
      sello,
      solicitud.clave_hash,
      solicitud.google_sub,
    );
    ejecutar(
      `UPDATE solicitud_acceso SET estado = 'aprobada', resuelta_en = ?, resuelta_por_id = ?, usuario_id = ? WHERE id = ?`,
      sello,
      actor.id,
      usuarioId,
      solicitud.id,
    );
    registrar({
      actor,
      tipo: 'usuario.creado',
      entidad: 'usuario',
      entidadId: usuarioId,
      motivo: 'Solicitud de acceso aprobada.',
      estadoPosterior: `${rol} activo`,
      datosPosteriores: {
        email: solicitud.email,
        nombre: solicitud.nombre,
        rol,
        ingresa_con: [solicitud.clave_hash ? 'contraseña' : null, solicitud.google_sub ? 'Google' : null].filter(Boolean).join(' y '),
      },
    });
    return uno('SELECT * FROM usuario WHERE id = ?', usuarioId);
  });
}

export function rechazar(actor, id) {
  const solicitud = solicitudParaResolver(actor, id);
  ejecutar(
    `UPDATE solicitud_acceso SET estado = 'rechazada', resuelta_en = ?, resuelta_por_id = ? WHERE id = ?`,
    ahora(),
    actor.id,
    solicitud.id,
  );
  return solicitud;
}
