// Cómo le llega el enlace de acceso a su dueño.
//
// Por omisión la aplicación NO MANDA NADA. El enlace se escribe en la consola del
// servidor y en un archivo que solo ve quien tiene la máquina, y Dirección se lo pasa a
// la persona por el medio que ya usa (WhatsApp, en persona). Para un equipo de cinco
// alcanza, y no activa ninguna comunicación sin que alguien lo decida.
//
// Cuando se quiera enviar por correo, se agrega un modo acá. Es el único lugar que habría
// que tocar: el resto de la aplicación solo llama a `entregar`.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_DATOS } from '../db.js';
import { fechaHoraCorta } from './fechas.js';
import { interfazDe } from './tunel.js';

export const MODO = process.env.FUTSALA_ENVIO || 'apagado';

/** Dónde queda anotado cada enlace generado, para poder recuperarlo. */
export const REGISTRO = join(DIR_DATOS, 'enlaces-de-acceso.log');

/**
 * Deja el enlace donde su dueño pueda recibirlo. Devuelve cómo se entregó, para que la
 * pantalla diga la verdad sobre lo que pasó.
 */
export function entregar({ usuario, enlace, expiraEn, pedidoPor = null }) {
  if (MODO !== 'apagado') {
    // Ningún otro modo está implementado todavía. Antes que inventar un envío que no
    // existe, se avisa y se cae al modo que sí funciona.
    console.log(`  AVISO: FUTSALA_ENVIO="${MODO}" no existe. El enlace no se envió por ningún lado.`);
  }

  const linea = [
    fechaHoraCorta(new Date().toISOString()),
    usuario.email,
    usuario.nombre,
    pedidoPor ? `generado por ${pedidoPor}` : 'pedido por la persona',
    `vence en ${expiraEn} min`,
    enlace,
  ].join('  |  ');

  console.log('');
  console.log(`  ENLACE DE ACCESO para ${usuario.nombre} <${usuario.email}>`);
  console.log(`  Vence en ${expiraEn} minutos y sirve una sola vez.`);
  console.log(`  ${enlace}`);
  console.log('');

  try {
    mkdirSync(DIR_DATOS, { recursive: true });
    appendFileSync(REGISTRO, `${linea}\n`, { mode: 0o600 });
  } catch (error) {
    // Que no se pueda anotar no impide entrar: el enlace ya salió por la consola.
    console.log(`  (no se pudo anotar en ${REGISTRO}: ${error.message})`);
  }

  return { modo: 'apagado', registro: REGISTRO };
}

/**
 * Si la aplicación solo la puede usar quien está sentado en esta máquina: ni publicada
 * ni abierta a la red local. Ahí quien pide el enlace es el mismo que tiene la consola, y
 * decirle "Dirección te lo pasa" lo manda a esperar algo que nunca llega.
 */
export function soloEnEstaMaquina(env = process.env) {
  return env.FUTSALA_PUBLICO !== '1' && interfazDe(env) === '127.0.0.1';
}

/**
 * Lo que la pantalla le dice a quien pidió el enlace. Nunca muestra el enlace, y dice lo
 * mismo exista o no el correo: el texto es fijo, no depende del pedido.
 */
export function comoLlega(env = process.env) {
  if (soloEnEstaMaquina(env)) {
    return (
      'Estás usando la aplicación en esta máquina: el enlace aparece en la ventana donde corre ' +
      `la aplicación y queda anotado en ${REGISTRO}. Si no aparece, ese correo no tiene ` +
      'usuario: "npm run acceso" muestra la lista.'
    );
  }
  return 'Dirección te lo pasa: la aplicación todavía no manda correos.';
}
