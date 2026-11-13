// Lo que hace falta para publicar la aplicación con Cloudflare Tunnel desde una máquina
// propia (camino A de docs/DESPLIEGUE.md).
//
// Con el túnel, el único que habla con internet es `cloudflared`, que corre en la misma
// máquina y le pasa los pedidos a la aplicación por 127.0.0.1. Por eso la aplicación
// tiene que escuchar SOLO en esta máquina: si escuchara en todas las interfaces, cualquiera
// de la red local podría hablarle por HTTP sin cifrar y, como en modo público se le cree
// al proxy, mandarle cabeceras inventadas para desviar un enlace de acceso.
//
// En un servidor con Docker es al revés: el proxy del proveedor está en otra máquina y la
// aplicación tiene que escuchar en todas las interfaces. Por eso es un parámetro y no un
// cambio del modo público.

/** En qué interfaz escucha el servidor. */
export function interfazDe(env) {
  if (env.FUTSALA_INTERFAZ) return env.FUTSALA_INTERFAZ;
  return env.FUTSALA_PUBLICO === '1' || env.FUTSALA_RED === '1' ? '0.0.0.0' : '127.0.0.1';
}

/** La dirección pública normalizada (https://dominio), o null si no sirve. */
export function direccionPublica(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(bruto) ? bruto : `https://${bruto}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes('.') || host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[')) return null;
  return url.origin;
}

/**
 * Qué le falta a la configuración para arrancar detrás del túnel. Lista vacía: está bien.
 * Cada problema dice qué poner, para que quien lo lea en el registro sepa qué hacer.
 */
export function problemasDelTunel(env) {
  const problemas = [];
  if (env.FUTSALA_PUBLICO !== '1') problemas.push('FUTSALA_PUBLICO=1');
  if (env.FUTSALA_PROXY !== '1') problemas.push('FUTSALA_PROXY=1 (cloudflared pone el HTTPS)');
  if (!env.FUTSALA_SECRETO || env.FUTSALA_SECRETO.length < 32) {
    problemas.push('FUTSALA_SECRETO de al menos 32 caracteres, siempre el mismo');
  }
  if (interfazDe(env) !== '127.0.0.1') {
    problemas.push('FUTSALA_INTERFAZ=127.0.0.1 (solo cloudflared, en esta misma máquina, le habla)');
  }
  if (!direccionPublica(env.FUTSALA_BASE_URL)) {
    problemas.push('FUTSALA_BASE_URL=https://el-dominio-publico (sin ruta ni barra al final)');
  }
  return problemas;
}
