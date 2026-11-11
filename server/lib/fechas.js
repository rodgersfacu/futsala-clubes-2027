// Zona de negocio: America/Argentina/Buenos_Aires.
// Los instantes de auditoría se guardan con desplazamiento explícito para que nadie
// los reinterprete como UTC. Las fechas sin hora se guardan como AAAA-MM-DD.
export const ZONA = 'America/Argentina/Buenos_Aires';

const partes = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function descomponer(fecha = new Date()) {
  const mapa = {};
  for (const parte of partes.formatToParts(fecha)) {
    if (parte.type !== 'literal') mapa[parte.type] = parte.value;
  }
  if (mapa.hour === '24') mapa.hour = '00';
  return mapa;
}

function desplazamiento(fecha = new Date()) {
  const p = descomponer(fecha);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const diferencia = Math.round((comoUtc - fecha.getTime()) / 60000);
  const signo = diferencia >= 0 ? '+' : '-';
  const abs = Math.abs(diferencia);
  return `${signo}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Instante actual del reloj del servidor, en zona de negocio, con desplazamiento. */
export function ahora(fecha = new Date()) {
  const p = descomponer(fecha);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${desplazamiento(fecha)}`;
}

/** Fecha de hoy en zona de negocio, AAAA-MM-DD. */
export function hoy(fecha = new Date()) {
  const p = descomponer(fecha);
  return `${p.year}-${p.month}-${p.day}`;
}

/** AAAA-MM-DDTHH:mm del momento actual, para valores por defecto de formularios. */
export function ahoraLocal(fecha = new Date()) {
  const p = descomponer(fecha);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function esFecha(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00`));
}

export function esFechaHora(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(valor);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** 2027-01-15 -> 15/01/2027 */
export function fechaCorta(valor) {
  if (!valor) return '';
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(valor);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** 2027-01-15 -> 15 ene 2027 */
export function fechaLarga(valor) {
  if (!valor) return '';
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(valor);
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

/** 2026-11-20T15:30 -> 20/11/2026 15:30 */
export function fechaHoraCorta(valor) {
  if (!valor) return '';
  const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return fechaCorta(valor);
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

export function soloFecha(valorFechaHora) {
  if (!valorFechaHora) return null;
  return String(valorFechaHora).slice(0, 10);
}

/** Diferencia en días entre dos AAAA-MM-DD (b - a). */
export function diasEntre(a, b) {
  if (!a || !b) return null;
  const ms = Date.parse(`${String(b).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`);
  return Math.round(ms / 86400000);
}

export function sumarDias(fechaIso, dias) {
  const base = Date.parse(`${String(fechaIso).slice(0, 10)}T00:00:00Z`);
  return new Date(base + dias * 86400000).toISOString().slice(0, 10);
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Día de la semana de una fecha: 0 domingo, 6 sábado. */
export function diaSemana(fechaIso) {
  return new Date(Date.parse(`${String(fechaIso).slice(0, 10)}T00:00:00Z`)).getUTCDay();
}

/** 2026-11-05 -> jueves */
export function nombreDiaDe(fechaIso) {
  return DIAS[diaSemana(fechaIso)];
}

/** El lunes de la semana de esa fecha. La semana del equipo arranca el lunes. */
export function lunesDe(fechaIso) {
  const dia = diaSemana(fechaIso);
  return sumarDias(fechaIso, dia === 0 ? -6 : 1 - dia);
}

/** El domingo de la semana de esa fecha. */
export function domingoDe(fechaIso) {
  return sumarDias(lunesDe(fechaIso), 6);
}

/** "Semana del 2 al 8 de noviembre", para encabezar un grupo de la agenda. */
export function rangoSemana(lunes) {
  const domingo = sumarDias(lunes, 6);
  return `${fechaLarga(lunes)} al ${fechaLarga(domingo)}`;
}

/** Primer y último día del mes de esa fecha. */
export function mesDe(fechaIso) {
  const [anio, mes] = String(fechaIso).slice(0, 10).split('-');
  const primero = `${anio}-${mes}-01`;
  const siguiente = mes === '12' ? `${Number(anio) + 1}-01-01` : `${anio}-${String(Number(mes) + 1).padStart(2, '0')}-01`;
  return { desde: primero, hasta: sumarDias(siguiente, -1) };
}
