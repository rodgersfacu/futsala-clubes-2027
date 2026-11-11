// Exportación propia: la información sale de la app sin depender de ningún proveedor.
import { todos } from '../db.js';
import { ahora } from '../lib/fechas.js';

export const TABLAS = [
  'usuario',
  'club',
  'plan',
  'plan_detalle',
  'reunion',
  'compromiso',
  'reconfirmacion',
  'parametros',
  'historial',
  'conflicto',
];

export function datosDeTabla(tabla) {
  if (!TABLAS.includes(tabla)) return null;
  return todos(`SELECT * FROM ${tabla}`);
}

/** Respaldo completo en JSON, apto para restaurar en otra instalación. */
export function respaldoCompleto() {
  const tablas = {};
  for (const tabla of TABLAS) {
    tablas[tabla] = todos(`SELECT * FROM ${tabla}`);
  }
  return {
    aplicacion: 'FUTSALA Reuniones 2027',
    version_esquema: 1,
    exportado_en: ahora(),
    zona_horaria: 'America/Argentina/Buenos_Aires',
    nota:
      'Exportación propia de la aplicación FUTSALA. Las fechas sin zona corresponden a la zona de negocio; ' +
      'no se deben reinterpretar como UTC.',
    tablas,
  };
}

export function aCsv(filas) {
  if (!filas || filas.length === 0) return '';
  const columnas = Object.keys(filas[0]);
  const lineas = [columnas.join(',')];
  for (const fila of filas) {
    lineas.push(columnas.map((c) => celda(fila[c])).join(','));
  }
  return `${lineas.join('\r\n')}\r\n`;
}

function celda(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/[",\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}
