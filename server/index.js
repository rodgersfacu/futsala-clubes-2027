// Servidor HTTP de FUTSALA Reuniones 2027. Sin dependencias externas.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { abrirBase, RAIZ, RUTA_DB, uno } from './db.js';
import * as auth from './auth.js';
import { rutas } from './web/rutas.js';
import * as varias from './web/paginas/varias.js';
import { interfazDe } from './lib/tunel.js';
import {
  ErrorNegocio,
  ErrorConflictoVersion,
  ErrorNoEncontrado,
  traducirErrorSqlite,
} from './lib/errores.js';

const PUERTO = Number(process.env.PORT || process.env.FUTSALA_PUERTO || 4310);

// Para entrar hace falta un enlace de acceso de un solo uso, generado para esa persona.
// Aun así el servidor escucha SOLO en esta máquina por omisión: va por HTTP sin cifrar,
// así que en una red ajena el enlace y la cookie de sesión viajan a la vista. Abrirlo a
// la red local se pide a propósito con FUTSALA_RED=1, y conviene solo en una red propia.
// FUTSALA_PUBLICO=1 es para un servidor en internet, detrás de un proxy que pone el
// HTTPS. Exige lo que ahí no puede faltar, y no arranca si falta: un servidor expuesto
// mal configurado es peor que uno que no arranca, porque parece que anda.
const PUBLICO = process.env.FUTSALA_PUBLICO === '1';
const ABIERTO_A_LA_RED = PUBLICO || process.env.FUTSALA_RED === '1';
// Con Cloudflare Tunnel el proxy está en esta misma máquina, y FUTSALA_INTERFAZ=127.0.0.1
// deja el modo público escuchando solo acá (ver server/lib/tunel.js).
const INTERFAZ = interfazDe(process.env);

if (PUBLICO) {
  const faltan = [];
  // El secreto firma las sesiones. En un servidor que se recrea al desplegar, el archivo
  // puede nacer de nuevo en cada arranque y echar a todos; tiene que venir de afuera.
  if (!process.env.FUTSALA_SECRETO) faltan.push('FUTSALA_SECRETO (una cadena larga y secreta, siempre la misma)');
  // Sin esto la aplicación no sabe que el navegador habló por HTTPS, y los enlaces de
  // acceso saldrían apuntando a http.
  if (process.env.FUTSALA_PROXY !== '1') faltan.push('FUTSALA_PROXY=1 (hay un proxy que termina el HTTPS)');
  if (faltan.length > 0) {
    console.error('');
    console.error('  No arranco en modo público: falta configurar');
    for (const f of faltan) console.error(`    · ${f}`);
    console.error('');
    process.exit(1);
  }
}
const DIR_PUBLICO = join(RAIZ, 'public');
const COOKIE_AVISO = 'futsala_aviso';

const TIPOS = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

abrirBase();

const servidor = createServer(async (req, res) => {
  try {
    await atender(req, res);
  } catch (error) {
    console.error('Error no controlado:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('Error interno del servidor.');
  }
});

async function atender(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ruta = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && (await servirEstatico(ruta, res))) return;

  const cookies = auth.leerCookies(req.headers.cookie);
  const usuario = auth.usuarioDeSesion(cookies);
  const csrf = auth.tokenCsrf(usuario?.id);
  const avisos = leerAviso(cookies);

  const coincidencia = buscarRuta(req.method, ruta);
  if (!coincidencia) {
    return responder(res, 404, {
      html: varias.error({
        usuario,
        csrf,
        avisos,
        datos: { titulo: 'No encontramos esa pantalla', mensaje: `La dirección ${ruta} no existe.`, volverA: '/' },
      }),
    });
  }

  let cuerpo = {};
  if (req.method === 'POST') {
    cuerpo = await leerCuerpo(req);

    // Mismo origen: una petición POST desde otro sitio no se atiende.
    const sitio = req.headers['sec-fetch-site'];
    if (sitio && sitio !== 'same-origin' && sitio !== 'none') {
      return responder(res, 403, { texto: 'Petición rechazada: origen distinto.' });
    }
    if (!auth.validarCsrf(usuario?.id, cuerpo.csrf)) {
      return responder(res, 403, {
        html: varias.error({
          usuario,
          csrf,
          avisos,
          datos: {
            titulo: 'La sesión cambió',
            mensaje: 'El formulario venía de otra sesión. Volvé a cargar la pantalla e intentá de nuevo.',
            volverA: ruta,
          },
        }),
      });
    }
  }

  const ctx = {
    req,
    usuario,
    csrf,
    avisos,
    params: coincidencia.params,
    query: url.searchParams,
    cuerpo,
    ruta,
  };

  try {
    const resultado = await coincidencia.manejador(ctx);
    return responder(res, 200, resultado);
  } catch (error) {
    return manejarError({ error, res, ctx });
  }
}

function manejarError({ error, res, ctx }) {
  const { usuario, csrf, avisos, ruta } = ctx;

  if (error instanceof ErrorConflictoVersion) {
    return responder(res, 409, {
      html: varias.conflictoVersion({ usuario, csrf, avisos, datos: { error } }),
    });
  }

  if (error instanceof ErrorNegocio) {
    // En un POST se vuelve a la pantalla anterior con el mensaje; en un GET se muestra la página.
    if (ctx.req.method === 'POST') {
      const volver = destinoDeRetorno(ctx);
      return responder(res, 303, {
        redirect: volver,
        aviso: { tono: error.estado === 403 ? 'alerta' : 'aviso', texto: error.message, ayuda: error.ayuda },
      });
    }
    const esFaltante = error instanceof ErrorNoEncontrado;
    return responder(res, error.estado, {
      html: varias.error({
        usuario,
        csrf,
        avisos,
        datos: {
          titulo: esFaltante ? 'No encontramos ese registro' : error.estado === 403 ? 'Sin permiso' : 'No se pudo continuar',
          mensaje: error.message,
          ayuda: error.ayuda || (error.estado === 403 && !usuario ? 'Elegí una identidad en la pantalla de acceso.' : null),
          volverA: error.estado === 403 && !usuario ? '/sesion' : '/',
        },
      }),
    });
  }

  const traducido = traducirErrorSqlite(error);
  if (traducido) {
    console.warn('Restricción de base:', error.message);
    if (ctx.req.method === 'POST') {
      return responder(res, 303, {
        redirect: destinoDeRetorno(ctx),
        aviso: {
          tono: 'alerta',
          texto: traducido,
          ayuda: 'La regla la aplicó la base de datos, no solo la pantalla.',
        },
      });
    }
  }

  console.error('Error inesperado:', error);
  return responder(res, 500, {
    html: varias.error({
      usuario,
      csrf,
      avisos,
      datos: {
        titulo: 'Algo falló',
        mensaje: traducido || 'Ocurrió un error inesperado. El cambio no se guardó.',
        volverA: ruta,
      },
    }),
  });
}

function destinoDeRetorno(ctx) {
  const referer = ctx.req.headers.referer;
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === (ctx.req.headers.host || url.host)) return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      // referer inválido: se usa el destino por defecto
    }
  }
  return '/';
}

function buscarRuta(metodo, ruta) {
  const partes = ruta.replace(/\/+$/, '').split('/').filter(Boolean);
  for (const [metodoRuta, patron, manejador] of rutas) {
    if (metodoRuta !== metodo) continue;
    const partesPatron = patron.split('/').filter(Boolean);
    if (partesPatron.length !== partes.length) continue;
    const params = {};
    let coincide = true;
    for (let i = 0; i < partesPatron.length; i += 1) {
      const esperado = partesPatron[i];
      if (esperado.startsWith(':')) {
        params[esperado.slice(1)] = partes[i];
      } else if (esperado !== partes[i]) {
        coincide = false;
        break;
      }
    }
    if (coincide) return { manejador, params };
  }
  return null;
}

async function servirEstatico(ruta, res) {
  if (ruta === '/' || ruta.includes('..')) return false;
  const destino = join(DIR_PUBLICO, normalize(ruta));
  if (!destino.startsWith(DIR_PUBLICO)) return false;
  try {
    const informacion = await stat(destino);
    if (!informacion.isFile()) return false;
    const contenido = await readFile(destino);
    res.writeHead(200, {
      'content-type': TIPOS[extname(destino)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(contenido);
    return true;
  } catch {
    return false;
  }
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    const trozos = [];
    let total = 0;
    req.on('data', (trozo) => {
      total += trozo.length;
      if (total > 1_000_000) {
        rechazar(new ErrorNegocio('El contenido enviado es demasiado grande.'));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      const texto = Buffer.concat(trozos).toString('utf8');
      const parametros = new URLSearchParams(texto);
      const datos = {};
      for (const [clave, valor] of parametros.entries()) datos[clave] = valor;
      resolver(datos);
    });
    req.on('error', rechazar);
  });
}

function responder(res, estado, resultado = {}) {
  const cookies = [...(resultado.cookies || [])];

  if (resultado.aviso) {
    cookies.push(
      `${COOKIE_AVISO}=${encodeURIComponent(JSON.stringify(resultado.aviso))}; Path=/; SameSite=Lax; Max-Age=30`,
    );
  }

  if (resultado.redirect) {
    const cabeceras = { location: resultado.redirect };
    if (cookies.length) cabeceras['set-cookie'] = cookies;
    res.writeHead(303, cabeceras);
    res.end();
    return;
  }

  if (resultado.archivo) {
    res.writeHead(estado, {
      'content-type': resultado.archivo.tipo,
      'content-disposition': `attachment; filename="${resultado.archivo.nombre}"`,
      'cache-control': 'no-store',
    });
    res.end(resultado.archivo.contenido);
    return;
  }

  const cabeceras = {
    'content-type': resultado.texto ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  };
  // Se limpia el aviso ya mostrado.
  cookies.push(`${COOKIE_AVISO}=; Path=/; SameSite=Lax; Max-Age=0`);
  cabeceras['set-cookie'] = cookies;

  res.writeHead(estado, cabeceras);
  res.end(resultado.texto || resultado.html || '');
}

function leerAviso(cookies) {
  const bruto = cookies[COOKIE_AVISO];
  if (!bruto) return [];
  try {
    const aviso = JSON.parse(bruto);
    if (aviso && typeof aviso.texto === 'string') {
      return [{ tono: aviso.tono || 'info', texto: aviso.texto, ayuda: aviso.ayuda || null }];
    }
  } catch {
    // aviso corrupto: se descarta
  }
  return [];
}

/** Avisa si la base vive en una carpeta que sincroniza sola (OneDrive, Drive, Dropbox). */
function carpetaSincronizada(ruta) {
  return /[\\/](OneDrive|Google ?Drive|Dropbox|iCloudDrive)([\\/]|$)/i.test(ruta);
}

servidor.listen(PUERTO, INTERFAZ, () => {
  const hayUsuarios = uno('SELECT count(*) AS n FROM usuario').n;
  console.log('');
  console.log('  FUTSALA Reuniones 2027');
  console.log(`  Servidor:  http://localhost:${PUERTO}`);
  console.log(`  Base:      ${RUTA_DB}`);
  console.log(`  Usuarios:  ${hayUsuarios}${hayUsuarios === 0 ? '  (ejecutá: npm run seed)' : ''}`);
  console.log('  Uso interno. Se entra con enlace de acceso: npm run acceso <correo>');
  console.log('  Sin envíos ni publicación: el enlace lo reparte Dirección.');
  if (PUBLICO) {
    console.log('');
    if (INTERFAZ === '127.0.0.1') {
      console.log('  Modo público con túnel: escucha solo en esta máquina y cloudflared la');
      console.log(`  publica${process.env.FUTSALA_BASE_URL ? ` en ${process.env.FUTSALA_BASE_URL}` : ''}.`);
    } else {
      console.log(`  Modo público: escuchando en ${INTERFAZ === '0.0.0.0' ? 'todas las interfaces' : INTERFAZ}, detrás de un proxy`);
      console.log('  que pone el HTTPS.');
    }
    console.log('  Los enlaces de acceso se arman con el dominio real y la cookie de sesión');
    console.log('  va marcada como Secure.');
  } else if (ABIERTO_A_LA_RED) {
    console.log('');
    console.log('  ATENCIÓN: abierto a la red local (FUTSALA_RED=1), por HTTP sin cifrar.');
    console.log('  En una red propia es razonable; en una ajena, el enlace de acceso y la');
    console.log('  cookie de sesión viajan a la vista de cualquiera que escuche.');
  }
  if (carpetaSincronizada(RUTA_DB)) {
    console.log('');
    console.log('  ATENCIÓN: la base está en una carpeta que se sincroniza sola.');
    console.log('  Puede corromperse si se sincroniza mientras la app escribe. Movela con:');
    console.log('    npm run mover-datos C:\\FUTSALA\\datos');
    console.log('  (agregá --simular para ver qué haría sin tocar nada)');
  }
  console.log('');
});
