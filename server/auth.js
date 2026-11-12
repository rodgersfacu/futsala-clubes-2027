// Identidad y autorización.
//
// AUTENTICACIÓN: no hay contraseñas. Se entra con un enlace de un solo uso generado para
// esa persona, que vence a los 15 minutos (ver `dominio/accesos.js`). Usado el enlace,
// el servidor firma una cookie de sesión con el id del usuario y la cookie vale 30 días.
// Son 30 días y no 12 horas porque, sin envío de correos, cada enlace nuevo lo tiene que
// generar alguien a mano. Si alguien pierde el teléfono, se lo desactiva y queda afuera:
// cada pedido vuelve a leer el usuario de la base.
//
// Lo que esto NO resuelve, y conviene tener presente: la aplicación va por HTTP sin
// cifrar. En la máquina de uno no importa; en una red compartida, el enlace y la cookie
// viajan a la vista. Por eso el servidor escucha solo en esta máquina salvo que se pida
// lo contrario a propósito.
//
// AUTORIZACIÓN: real y de servidor. Cada operación vuelve a leer el usuario de la base,
// comprueba que esté activo y evalúa su rol antes de escribir. Ocultar un botón no es un
// permiso; los permisos están en el dominio.
import { randomUUID, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { uno, DIR_DATOS } from './db.js';
import { ErrorPermiso } from './lib/errores.js';

const COOKIE_SESION = 'futsala_sesion';
let secreto = null;

function secretoFirma() {
  if (secreto) return secreto;
  if (process.env.FUTSALA_SECRETO) {
    secreto = process.env.FUTSALA_SECRETO;
    return secreto;
  }
  mkdirSync(DIR_DATOS, { recursive: true });
  const ruta = join(DIR_DATOS, 'secreto-sesion.txt');
  if (!existsSync(ruta)) {
    writeFileSync(ruta, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  secreto = readFileSync(ruta, 'utf8').trim();
  return secreto;
}

function firmar(valor) {
  return createHmac('sha256', secretoFirma()).update(valor).digest('base64url');
}

/**
 * `seguro` agrega la marca Secure, que le prohíbe al navegador mandar la cookie por una
 * conexión sin cifrar. Se pone cuando la petición llegó por HTTPS: si se pusiera siempre,
 * la aplicación dejaría de funcionar en la máquina de uno, donde no hay certificado.
 */
/** Cuánto dura una sesión, en segundos. Lo controla también el servidor, no solo el navegador. */
export const DURACION_SESION = 60 * 60 * 24 * 30;

export function cookieSesion(usuarioId, { seguro = false } = {}) {
  const cuerpo = `${usuarioId}.${Date.now()}`;
  return `${COOKIE_SESION}=${cuerpo}.${firmar(cuerpo)}; Path=/; HttpOnly; SameSite=Lax;${
    seguro ? ' Secure;' : ''
  } Max-Age=${DURACION_SESION}`;
}

/**
 * De dónde cuelga la aplicación para quien la está mirando. Importa porque el enlace de
 * acceso se arma con esto: en un servidor detrás de un proxy, la petición llega por HTTP
 * aunque el navegador haya hablado HTTPS, y el enlace saldría apuntando al lugar
 * equivocado.
 *
 * Solo se cree lo que diga el proxy cuando se declaró que hay uno (FUTSALA_PROXY=1). Si
 * no, cualquiera podría mandar esas cabeceras y hacer que el enlace de acceso de otra
 * persona apunte a un sitio suyo.
 */
export function origenDe(req) {
  const tras = process.env.FUTSALA_PROXY === '1';
  const protocolo = tras ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() : '';
  const anfitrion = tras ? String(req.headers['x-forwarded-host'] || '').split(',')[0].trim() : '';
  const esquema = protocolo || (req.socket?.encrypted ? 'https' : 'http');
  const host = anfitrion || req.headers.host || 'localhost';
  return { esquema, host, seguro: esquema === 'https', base: `${esquema}://${host}` };
}

export function cookieSalir() {
  return `${COOKIE_SESION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function leerCookies(cabecera = '') {
  const mapa = {};
  for (const trozo of String(cabecera).split(';')) {
    const i = trozo.indexOf('=');
    if (i === -1) continue;
    mapa[trozo.slice(0, i).trim()] = decodeURIComponent(trozo.slice(i + 1).trim());
  }
  return mapa;
}

/** Devuelve el usuario de la sesión leyéndolo siempre de la base, o null. */
export function usuarioDeSesion(cookies) {
  const bruto = cookies[COOKIE_SESION];
  if (!bruto) return null;
  const partes = bruto.split('.');
  if (partes.length !== 3) return null;
  const [id, marca, firma] = partes;
  const esperada = firmar(`${id}.${marca}`);
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // El navegador debería tirar la cookie al vencer, pero no se confía en eso.
  const edad = Date.now() - Number(marca);
  if (!Number.isFinite(edad) || edad < 0 || edad > DURACION_SESION * 1000) return null;
  const usuario = uno('SELECT * FROM usuario WHERE id = ?', id);
  if (!usuario) return null;
  return usuario;
}

/** Token anti-CSRF ligado a la sesión; se valida en cada POST. */
export function tokenCsrf(usuarioId) {
  return firmar(`csrf:${usuarioId ?? 'anonimo'}`);
}

export function validarCsrf(usuarioId, token) {
  const esperado = tokenCsrf(usuarioId);
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const ROLES = ['Direccion', 'Ayudante', 'Consulta'];

export function esDireccion(usuario) {
  return !!usuario && usuario.activo === 1 && usuario.rol === 'Direccion';
}

export function esAyudante(usuario) {
  return !!usuario && usuario.activo === 1 && usuario.rol === 'Ayudante';
}

export function puedeEscribir(usuario) {
  return esDireccion(usuario) || esAyudante(usuario);
}

/** Exige sesión activa. Usuario inactivo o inexistente: acceso denegado. */
export function exigirActivo(usuario) {
  if (!usuario) {
    throw new ErrorPermiso('Necesitás iniciar sesión.', {
      ayuda: 'Pedí tu enlace de acceso en la pantalla de acceso, o pedíselo a Dirección.',
    });
  }
  if (usuario.activo !== 1) {
    throw new ErrorPermiso('Tu usuario está inactivo. Pedile a Dirección que lo habilite.');
  }
  return usuario;
}

export function exigirDireccion(usuario, accion = 'esta operación') {
  exigirActivo(usuario);
  if (usuario.rol !== 'Direccion') {
    throw new ErrorPermiso(`Solo Dirección puede ${accion}.`);
  }
  return usuario;
}

export function exigirEscritura(usuario, accion = 'modificar datos') {
  exigirActivo(usuario);
  if (usuario.rol === 'Consulta') {
    throw new ErrorPermiso(`Tu rol es de consulta: no podés ${accion}.`);
  }
  return usuario;
}

export function nuevoId() {
  return randomUUID();
}
