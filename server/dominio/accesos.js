// Enlaces de acceso de un solo uso: la forma de entrar a la aplicación.
//
// No hay contraseñas. Para entrar hace falta un enlace generado para esa persona, que
// vence a los 15 minutos y sirve una sola vez. Es el mismo mecanismo que usan los bancos
// y los servicios para "entrar sin contraseña", y tiene dos ventajas acá: nadie tiene que
// administrar ni recordar contraseñas, y no hay nada que robar guardado en la base.
//
// Lo que se guarda es el HASH del token. Quien pueda leer la base no puede entrar como
// nadie: el texto del enlace solo existe mientras viaja hasta su dueño.
import { randomBytes, createHash } from 'node:crypto';
import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNegocio, ErrorNoEncontrado } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar } from './registro.js';

/** Cuánto vive un enlace. Corto: se pide y se usa en el momento. */
export const MINUTOS_VALIDO = 15;

/** Cuántos enlaces sin usar puede tener una persona a la vez. */
const MAXIMO_PENDIENTES = 3;

function hash(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Un instante futuro en el mismo formato que el resto de los sellos de la aplicación.
 * Importa que sea el mismo: las fechas se comparan como texto, y mezclar formatos haría
 * que un enlace venciera antes o después de lo que dice.
 */
function enMinutos(minutos) {
  return ahora(new Date(Date.now() + minutos * 60000));
}

export function obtener(id) {
  return uno('SELECT * FROM acceso WHERE id = ?', id);
}

/** Los enlaces que todavía sirven para esta persona. */
export function pendientesDe(usuarioId) {
  return todos(
    `SELECT * FROM acceso
     WHERE usuario_id = ? AND usado_en IS NULL AND anulado_en IS NULL AND expira_en > ?
     ORDER BY creado_en DESC`,
    usuarioId,
    ahora(),
  );
}

/** Los últimos accesos de una persona, para ver quién entró y cuándo. */
export function historialDe(usuarioId, limite = 10) {
  return todos(
    'SELECT * FROM acceso WHERE usuario_id = ? ORDER BY creado_en DESC LIMIT ?',
    usuarioId,
    limite,
  );
}

/**
 * Genera un enlace para una persona. Devuelve el token en claro una sola vez: no se
 * vuelve a poder leer, porque en la base queda solo su hash.
 *
 * `actor` es quien lo genera desde Administración; va en null cuando lo pidió la propia
 * persona desde la pantalla de acceso, o cuando lo generó la consola.
 */
export function generar(usuarioId, { actor = null, motivo = null } = {}) {
  const usuario = uno('SELECT * FROM usuario WHERE id = ?', usuarioId);
  if (!usuario) throw new ErrorNoEncontrado('Ese usuario no existe.');
  if (usuario.activo !== 1) {
    throw new ErrorNegocio(`${usuario.nombre} está inactivo: no se le puede dar acceso.`, {
      ayuda: 'Primero habilitalo en Administración.',
    });
  }

  const pendientes = pendientesDe(usuarioId);
  if (pendientes.length >= MAXIMO_PENDIENTES) {
    throw new ErrorNegocio(
      `${usuario.nombre} ya tiene ${pendientes.length} enlaces sin usar.`,
      { ayuda: `Esperá a que venzan (${MINUTOS_VALIDO} minutos) o que use alguno.` },
    );
  }

  const token = randomBytes(32).toString('base64url');
  const id = nuevoId();

  enTransaccion(() => {
    ejecutar(
      `INSERT INTO acceso (id, usuario_id, token_hash, creado_en, expira_en, creado_por_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      usuarioId,
      hash(token),
      ahora(),
      enMinutos(MINUTOS_VALIDO),
      actor ? actor.id : null,
    );
    registrar({
      actor: actor || usuario,
      tipo: 'acceso.generado',
      entidad: 'acceso',
      entidadId: id,
      motivo,
      datosPosteriores: {
        para: usuario.nombre,
        lo_pidio: actor ? `${actor.nombre} (Dirección)` : 'la propia persona',
      },
    });
  });

  return { acceso: obtener(id), usuario, token, expiraEn: MINUTOS_VALIDO };
}

/** Dirección genera un enlace para alguien del equipo. */
export function generarParaOtro(actor, usuarioId) {
  exigirDireccion(actor, 'generar enlaces de acceso');
  return generar(usuarioId, { actor, motivo: 'Generado desde Administración.' });
}

/**
 * Alguien pide su propio enlace desde la pantalla de acceso.
 *
 * Devuelve siempre la misma forma, exista o no ese correo: si contestara distinto, esta
 * pantalla serviría para averiguar quién tiene cuenta. Cuando el correo no corresponde a
 * nadie activo, no se genera nada y no se avisa.
 */
/**
 * Cuántos pedidos tolera una misma procedencia por minuto. En la red de uno no se nota;
 * expuesto a internet es lo primero que alguien golpea, probando correos a ver cuál
 * contesta distinto. Como la respuesta es siempre igual no averigua nada, pero sí podría
 * llenarle la casilla a alguien o cargar el servidor.
 *
 * Vive en memoria a propósito: si el servidor se reinicia, el límite se olvida, y eso
 * está bien. No es un registro, es un freno.
 */
const PEDIDOS_POR_MINUTO = 10;
const pedidosRecientes = new Map();

export function demasiadosPedidos(procedencia) {
  const ahoraMs = Date.now();
  const minuto = 60000;
  const previos = (pedidosRecientes.get(procedencia) || []).filter((t) => ahoraMs - t < minuto);
  previos.push(ahoraMs);
  pedidosRecientes.set(procedencia, previos);

  // Limpieza ocasional, para que el mapa no crezca con procedencias que no vuelven.
  if (pedidosRecientes.size > 1000) {
    for (const [clave, marcas] of pedidosRecientes) {
      if (marcas.every((t) => ahoraMs - t >= minuto)) pedidosRecientes.delete(clave);
    }
  }
  return previos.length > PEDIDOS_POR_MINUTO;
}

export function solicitar(email) {
  const limpio = v.texto(email);
  if (!limpio) throw new ErrorNegocio('Escribí tu correo.', { campo: 'email' });
  const usuario = uno('SELECT * FROM usuario WHERE email = ?', limpio.toLowerCase());
  if (!usuario || usuario.activo !== 1) return null;
  if (pendientesDe(usuario.id).length >= MAXIMO_PENDIENTES) return null;
  return generar(usuario.id, { motivo: 'Pedido desde la pantalla de acceso.' });
}

/**
 * Lee un enlace sin consumirlo, para poder mostrar "entrar como X" antes de gastarlo.
 * Devuelve null si no sirve, sin decir por qué: un enlace que no anda es un enlace que
 * no anda.
 */
export function leer(token) {
  if (!token) return null;
  const fila = uno('SELECT * FROM acceso WHERE token_hash = ?', hash(String(token)));
  if (!fila) return null;
  if (fila.usado_en || fila.anulado_en) return null;
  if (fila.expira_en <= ahora()) return null;
  const usuario = uno('SELECT * FROM usuario WHERE id = ?', fila.usuario_id);
  if (!usuario || usuario.activo !== 1) return null;
  return { acceso: fila, usuario };
}

/**
 * Consume el enlace y devuelve a quién deja entrar. Entrar anula los demás enlaces
 * pendientes de esa persona: si pidió tres porque el primero no le llegaba, los otros
 * dos dejan de servir en cuanto entra con uno.
 */
export function usar(token) {
  const valido = leer(token);
  if (!valido) {
    throw new ErrorNegocio('Ese enlace no sirve: ya se usó, venció, o no es válido.', {
      ayuda: `Los enlaces duran ${MINUTOS_VALIDO} minutos y sirven una sola vez. Pedí uno nuevo.`,
    });
  }
  const { acceso, usuario } = valido;
  const sello = ahora();

  return enTransaccion(() => {
    ejecutar('UPDATE acceso SET usado_en = ? WHERE id = ? AND usado_en IS NULL', sello, acceso.id);
    // Que haya entrado deja sin efecto lo que quedaba pendiente.
    ejecutar(
      `UPDATE acceso SET anulado_en = ?, motivo_anulado = 'Entró con otro enlace'
       WHERE usuario_id = ? AND id <> ? AND usado_en IS NULL AND anulado_en IS NULL`,
      sello,
      usuario.id,
      acceso.id,
    );
    registrar({
      actor: usuario,
      tipo: 'acceso.usado',
      entidad: 'acceso',
      entidadId: acceso.id,
      datosPosteriores: { entro: usuario.nombre, rol: usuario.rol },
    });
    return usuario;
  });
}

/** Dirección corta los enlaces pendientes de alguien. */
export function anular(actor, usuarioId, motivo = 'Anulado por Dirección') {
  exigirDireccion(actor, 'anular enlaces de acceso');
  const pendientes = pendientesDe(usuarioId);
  if (pendientes.length === 0) throw new ErrorNegocio('Esa persona no tiene enlaces pendientes.');
  const sello = ahora();
  return enTransaccion(() => {
    ejecutar(
      `UPDATE acceso SET anulado_en = ?, motivo_anulado = ?
       WHERE usuario_id = ? AND usado_en IS NULL AND anulado_en IS NULL`,
      sello,
      motivo,
      usuarioId,
    );
    registrar({
      actor,
      tipo: 'acceso.anulado',
      entidad: 'usuario',
      entidadId: usuarioId,
      motivo,
      datosPosteriores: { anulados: pendientes.length },
    });
    return pendientes.length;
  });
}

/** La dirección completa que se le pasa a la persona. */
export function enlaceDe(token, base) {
  return `${String(base).replace(/\/+$/, '')}/entrar/${token}`;
}
