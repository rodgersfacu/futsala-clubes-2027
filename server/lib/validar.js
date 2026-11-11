import { ErrorNegocio } from './errores.js';
import { esFecha, esFechaHora, hoy } from './fechas.js';

/** Texto limpio o null. Un campo vacío nunca se guarda como cadena vacía. */
export function texto(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).replace(/\r\n/g, '\n').trim();
  return limpio === '' ? null : limpio;
}

export function textoObligatorio(valor, etiqueta, { minimo = 1 } = {}) {
  const limpio = texto(valor);
  if (!limpio || limpio.length < minimo) {
    throw new ErrorNegocio(
      minimo > 1
        ? `${etiqueta} es obligatorio y necesita al menos ${minimo} caracteres.`
        : `${etiqueta} es obligatorio.`,
      { campo: etiqueta },
    );
  }
  return limpio;
}

/** Normaliza para comparar nombres y disciplinas: minúsculas, sin acentos ni espacios dobles. */
export function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function email(valor, etiqueta = 'Correo') {
  const limpio = texto(valor);
  if (!limpio) return null;
  const normalizado = limpio.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizado)) {
    throw new ErrorNegocio(`${etiqueta} no tiene un formato válido.`, { campo: etiqueta });
  }
  return normalizado;
}

/**
 * Cantidad de tiras. Vacío significa "desconocido" y se conserva como null:
 * nunca se convierte en cero.
 */
export function cantidad(valor, etiqueta) {
  const limpio = texto(valor);
  if (limpio === null) return null;
  if (!/^\d+$/.test(limpio)) {
    throw new ErrorNegocio(
      `${etiqueta} tiene que ser un número entero de 0 o más. Dejalo vacío si todavía no se conoce.`,
      { campo: etiqueta },
    );
  }
  const numero = Number(limpio);
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new ErrorNegocio(`${etiqueta} tiene que ser un número entero de 0 o más.`, { campo: etiqueta });
  }
  return numero;
}

export function fecha(valor, etiqueta, { obligatorio = false } = {}) {
  const limpio = texto(valor);
  if (!limpio) {
    if (obligatorio) throw new ErrorNegocio(`${etiqueta} es obligatoria.`, { campo: etiqueta });
    return null;
  }
  if (!esFecha(limpio)) {
    throw new ErrorNegocio(`${etiqueta} tiene que ser una fecha válida.`, { campo: etiqueta });
  }
  return limpio;
}

export function fechaHora(valor, etiqueta, { obligatorio = false } = {}) {
  const limpio = texto(valor);
  if (!limpio) {
    if (obligatorio) throw new ErrorNegocio(`${etiqueta} es obligatoria.`, { campo: etiqueta });
    return null;
  }
  if (!esFechaHora(limpio)) {
    throw new ErrorNegocio(`${etiqueta} tiene que ser una fecha y hora válidas.`, { campo: etiqueta });
  }
  return limpio.length === 16 ? `${limpio}:00` : limpio;
}

export function noFutura(valorFecha, etiqueta) {
  if (!valorFecha) return null;
  if (valorFecha > hoy()) {
    throw new ErrorNegocio(`${etiqueta} no puede ser posterior a hoy.`, { campo: etiqueta });
  }
  return valorFecha;
}

export function opcion(valor, permitidas, etiqueta, { obligatorio = true } = {}) {
  const limpio = texto(valor);
  if (!limpio) {
    if (obligatorio) throw new ErrorNegocio(`${etiqueta} es obligatorio.`, { campo: etiqueta });
    return null;
  }
  if (!permitidas.includes(limpio)) {
    throw new ErrorNegocio(`${etiqueta} tiene un valor no permitido.`, { campo: etiqueta });
  }
  return limpio;
}

export function booleano(valor) {
  return valor === '1' || valor === 'on' || valor === 'true' || valor === true ? 1 : 0;
}

export function entero(valor, etiqueta, { obligatorio = false } = {}) {
  const limpio = texto(valor);
  if (limpio === null) {
    if (obligatorio) throw new ErrorNegocio(`${etiqueta} es obligatorio.`, { campo: etiqueta });
    return null;
  }
  if (!/^-?\d+$/.test(limpio)) throw new ErrorNegocio(`${etiqueta} tiene que ser un número entero.`, { campo: etiqueta });
  return Number(limpio);
}

export const MOTIVO_MINIMO = 10;

/** Todo motivo de reapertura/devolución exige una explicación con contenido. */
export function motivo(valor, etiqueta = 'El motivo') {
  const limpio = texto(valor);
  if (!limpio || limpio.length < MOTIVO_MINIMO) {
    throw new ErrorNegocio(
      `${etiqueta} es obligatorio y necesita al menos ${MOTIVO_MINIMO} caracteres que expliquen el cambio.`,
      { campo: 'motivo' },
    );
  }
  return limpio;
}

export function url(valor, etiqueta = 'El enlace') {
  const limpio = texto(valor);
  if (!limpio) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(limpio)) {
    throw new ErrorNegocio(`${etiqueta} tiene que empezar con http:// o https://`, { campo: etiqueta });
  }
  return limpio;
}
