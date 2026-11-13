// Ingreso con Google a través de Firebase Authentication. Sin dependencias: la firma del
// token se verifica con node:crypto contra las claves públicas que publica Google.
//
// Es el único servicio de terceros de la aplicación, y es optativo: si no están las
// variables FUTSALA_FIREBASE_*, el botón de Google no aparece y todo lo demás funciona
// igual (correo y contraseña, y enlaces de un solo uso).
//
// Qué se le cree a Firebase: que esa persona demostró ser dueña de esa cuenta Google y de
// ese correo. Nada más. Los permisos los sigue dando Dirección.
import { createPublicKey, verify as verificarFirma, randomBytes, timingSafeEqual } from 'node:crypto';
import { firmarValor } from '../auth.js';

const URL_CLAVES = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const VERSION_SDK = '12.19.0';
const COOKIE_DESAFIO = 'futsala_google';
const MINUTOS_DESAFIO = 10;

/** Configuración pública del proyecto Firebase, o null si Google no está habilitado. */
export function configuracion(env = process.env) {
  const c = {
    apiKey: env.FUTSALA_FIREBASE_API_KEY || '',
    authDomain: env.FUTSALA_FIREBASE_AUTH_DOMAIN || '',
    projectId: env.FUTSALA_FIREBASE_PROJECT_ID || '',
    appId: env.FUTSALA_FIREBASE_APP_ID || '',
  };
  if (!c.projectId) return null;
  if (
    !/^[a-z0-9-]{4,40}$/.test(c.projectId) ||
    !/^[A-Za-z0-9_-]{20,60}$/.test(c.apiKey) ||
    !/^[a-z0-9.-]+$/.test(c.authDomain) ||
    !/^[0-9]+:[0-9]+:web:[a-f0-9]+$/.test(c.appId)
  ) {
    throw new Error('La configuración FUTSALA_FIREBASE_* no es válida.');
  }
  return c;
}

// --- Claves públicas -----------------------------------------------------------

let claves = null; // { porKid: Map, vencen: ms }

async function clavesPublicas(buscar = fetch) {
  if (claves && claves.vencen > Date.now()) return claves.porKid;
  const respuesta = await buscar(URL_CLAVES);
  if (!respuesta.ok) throw new Error('No se pudieron leer las claves de Google.');
  const { keys } = await respuesta.json();
  const edad = Number(/max-age=(\d+)/.exec(respuesta.headers.get('cache-control') || '')?.[1] || 3600);
  const porKid = new Map(keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]));
  claves = { porKid, vencen: Date.now() + Math.min(edad, 6 * 3600) * 1000 };
  return porKid;
}

/** Para las pruebas: claves fijas en lugar de las de Google. */
export function usarClavesDePrueba(porKid) {
  claves = { porKid, vencen: Number.MAX_SAFE_INTEGER };
}

const decodificar = (parte) => JSON.parse(Buffer.from(parte, 'base64url').toString('utf8'));

/**
 * Verifica el ID token que entrega Firebase y devuelve la identidad Google, o null si no
 * sirve. No dice por qué: un token que no anda es un token que no anda.
 */
export async function verificarToken(token, projectId) {
  if (typeof token !== 'string' || token.length > 16000) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  let cabecera, datos;
  try {
    cabecera = decodificar(partes[0]);
    datos = decodificar(partes[1]);
  } catch {
    return null;
  }
  if (cabecera.alg !== 'RS256' || !cabecera.kid) return null;
  let clave;
  try {
    clave = (await clavesPublicas()).get(cabecera.kid);
  } catch {
    return null;
  }
  if (!clave) return null;
  const firmaValida = verificarFirma(
    'RSA-SHA256',
    Buffer.from(`${partes[0]}.${partes[1]}`),
    clave,
    Buffer.from(partes[2], 'base64url'),
  );
  if (!firmaValida) return null;

  const ahoraS = Date.now() / 1000;
  const subGoogle = datos.firebase?.identities?.['google.com']?.[0];
  if (
    datos.iss !== `https://securetoken.google.com/${projectId}` ||
    datos.aud !== projectId ||
    !(datos.exp > ahoraS) ||
    !(datos.iat <= ahoraS + 60) ||
    !Number.isFinite(datos.auth_time) ||
    datos.firebase?.sign_in_provider !== 'google.com' ||
    typeof subGoogle !== 'string' ||
    !subGoogle ||
    datos.email_verified !== true ||
    typeof datos.email !== 'string'
  ) {
    return null;
  }
  return {
    sub: subGoogle,
    email: datos.email.trim().toLowerCase(),
    nombre: typeof datos.name === 'string' ? datos.name.trim() : '',
    ingresoEn: datos.auth_time * 1000,
  };
}

// --- Desafío de un solo uso ------------------------------------------------------
//
// Firebase no deja meter un valor propio dentro del token. Para que un token robado o
// viejo no sirva, la pantalla de acceso entrega una cookie firmada con la hora; al volver
// de Google se exige que el ingreso en Google sea posterior a esa hora y que la cookie no
// se haya usado antes.

const usados = new Map();

export function cookieDesafio({ seguro = false } = {}) {
  const cuerpo = `${Date.now()}.${randomBytes(16).toString('hex')}`;
  return `${COOKIE_DESAFIO}=${cuerpo}.${firmarValor(`google:${cuerpo}`)}; Path=/; HttpOnly; SameSite=Lax;${
    seguro ? ' Secure;' : ''
  } Max-Age=${MINUTOS_DESAFIO * 60}`;
}

export function cookieDesafioBorrar() {
  return `${COOKIE_DESAFIO}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Consume el desafío y confirma que la identidad sea posterior a él. */
export function desafioCumplido(cookies, identidad) {
  const bruto = cookies[COOKIE_DESAFIO];
  if (!bruto || !identidad) return false;
  const partes = bruto.split('.');
  if (partes.length !== 3) return false;
  const [marca, azar, firma] = partes;
  const a = Buffer.from(firma);
  const b = Buffer.from(firmarValor(`google:${marca}.${azar}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const emitido = Number(marca);
  const ahoraMs = Date.now();
  if (!Number.isFinite(emitido) || ahoraMs - emitido > MINUTOS_DESAFIO * 60000 || emitido > ahoraMs + 60000) return false;
  if (usados.has(azar)) return false;
  // Un minuto de tolerancia por relojes desparejos entre esta máquina y Google.
  if (identidad.ingresoEn < emitido - 60000 || identidad.ingresoEn > ahoraMs + 60000) return false;
  usados.set(azar, emitido);
  for (const [clave, cuando] of usados) if (ahoraMs - cuando > MINUTOS_DESAFIO * 60000) usados.delete(clave);
  return true;
}
