import { html, crudo, escapar } from './html.js';
import { fechaCorta, fechaHoraCorta, fechaLarga } from '../lib/fechas.js';

const TONOS = {
  Borrador: 'neutro',
  Lista: 'info',
  Abierta: 'info',
  Cerrada: 'exito',
  Archivada: 'neutro',
  Pendiente: 'neutro',
  Revisado: 'aviso',
  Validado: 'exito',
  Programada: 'info',
  Realizada: 'info',
  Cancelada: 'neutro',
  'Para revisar': 'aviso',
  Validada: 'exito',
  'En curso': 'info',
  Cumplido: 'exito',
  Cancelado: 'neutro',
  Contactado: 'info',
  Condicional: 'aviso',
  Confirmado: 'exito',
  'No continua': 'alerta',
  'Sin respuesta': 'aviso',
  Alta: 'alerta',
  Media: 'aviso',
  Baja: 'neutro',
  Direccion: 'info',
  Ayudante: 'neutro',
  Consulta: 'neutro',
};

/** Etiqueta de estado. Siempre lleva texto: el color no es la única señal. */
export function estado(valor, { tono = null, titulo = null } = {}) {
  if (!valor) return crudo('');
  const clase = tono || TONOS[valor] || 'neutro';
  return html`<span class="chip chip--${crudo(clase)}"${titulo ? crudo(` title="${escapar(titulo)}"`) : ''}>${valor}</span>`;
}

export function etiquetaRol(rol) {
  const texto = rol === 'Direccion' ? 'Dirección' : rol;
  return estado(texto, { tono: TONOS[rol] || 'neutro' });
}

export function tarjeta({ titulo, subtitulo = null, acciones = null, cuerpo, id = null, tono = null }) {
  return html`
    <section class="tarjeta${tono ? crudo(` tarjeta--${tono}`) : ''}"${id ? crudo(` id="${escapar(id)}"`) : ''}>
      <header class="tarjeta__cabecera">
        <div>
          <h2>${titulo}</h2>
          ${subtitulo ? html`<p class="tarjeta__subtitulo">${subtitulo}</p>` : ''}
        </div>
        ${acciones ? html`<div class="tarjeta__acciones">${acciones}</div>` : ''}
      </header>
      <div class="tarjeta__cuerpo">${cuerpo}</div>
    </section>`;
}

export function vacio(texto, ayuda = null) {
  return html`<div class="vacio"><p>${texto}</p>${ayuda ? html`<p class="vacio__ayuda">${ayuda}</p>` : ''}</div>`;
}

export function aviso(texto, { tono = 'info', titulo = null, lista = null } = {}) {
  if (!texto && !lista) return crudo('');
  return html`
    <div class="aviso aviso--${crudo(tono)}">
      ${titulo ? html`<strong>${titulo}</strong>` : ''}
      ${texto ? html`<p>${texto}</p>` : ''}
      ${lista && lista.length
        ? html`<ul>${lista.map((item) => html`<li>${item}</li>`)}</ul>`
        : ''}
    </div>`;
}

export function dato(etiqueta, valor, { ayuda = null } = {}) {
  return html`
    <div class="dato">
      <dt>${etiqueta}</dt>
      <dd>${valor === null || valor === undefined || valor === '' ? html`<span class="sin-dato">Sin cargar</span>` : valor}</dd>
      ${ayuda ? html`<p class="dato__ayuda">${ayuda}</p>` : ''}
    </div>`;
}

export function listaDatos(items) {
  return html`<dl class="datos">${items}</dl>`;
}

/**
 * Número que puede ser "desconocido". Sin dato se deja en blanco: un cero cargado sí
 * se muestra como 0, así que el blanco nunca se confunde con cero.
 */
export function cantidad(valor, { desconocido = '' } = {}) {
  if (valor === null || valor === undefined || valor === '') {
    return desconocido
      ? html`<span class="sin-dato" title="Sin dato cargado: no es cero">${desconocido}</span>`
      : html`<span class="sin-dato" title="Sin dato cargado: no es cero">&nbsp;</span>`;
  }
  return html`<span class="numero">${valor}</span>`;
}

export function fecha(valor, { largo = false } = {}) {
  if (!valor) return html`<span class="sin-dato">—</span>`;
  return html`<span title="${valor}">${largo ? fechaLarga(valor) : fechaCorta(valor)}</span>`;
}

export function fechaHora(valor) {
  if (!valor) return html`<span class="sin-dato">—</span>`;
  return html`<span title="${valor}">${fechaHoraCorta(valor)}</span>`;
}

export function tabla({ columnas, filas, vacioTexto = 'No hay registros.', clase = '' }) {
  if (!filas || filas.length === 0) return vacio(vacioTexto);
  return html`
    <div class="tabla-envoltorio">
      <table class="tabla ${crudo(clase)}">
        <thead><tr>${columnas.map((c) => html`<th>${c}</th>`)}</tr></thead>
        <tbody>${filas.map((fila) => html`<tr>${fila.map((celda) => html`<td>${celda}</td>`)}</tr>`)}</tbody>
      </table>
    </div>`;
}

export function enlace(href, texto, { clase = '' } = {}) {
  return html`<a class="${crudo(clase)}" href="${href}">${texto}</a>`;
}

export function boton(texto, { tipo = 'submit', clase = 'boton', nombre = null, valor = null, confirmar = null } = {}) {
  return html`<button class="${crudo(clase)}" type="${tipo}"${nombre ? crudo(` name="${escapar(nombre)}"`) : ''}${
    valor !== null ? crudo(` value="${escapar(valor)}"`) : ''
  }${confirmar ? crudo(` data-confirmar="${escapar(confirmar)}"`) : ''}>${texto}</button>`;
}

/** Formulario POST con token anti-CSRF y versión del registro para detectar conflictos. */
export function formulario({ accion, csrf, version = null, cuerpo, clase = '', id = null, confirmar = null }) {
  return html`
    <form method="post" action="${accion}" class="formulario ${crudo(clase)}"${id ? crudo(` id="${escapar(id)}"`) : ''}${
      confirmar ? crudo(` data-confirmar="${escapar(confirmar)}"`) : ''
    }>
      <input type="hidden" name="csrf" value="${csrf}">
      ${version !== null && version !== undefined ? html`<input type="hidden" name="version" value="${version}">` : ''}
      ${cuerpo}
    </form>`;
}

export function campo({
  nombre,
  etiqueta,
  valor = '',
  tipo = 'text',
  ayuda = null,
  obligatorio = false,
  placeholder = null,
  bloqueado = null,
  atributos = '',
}) {
  const desactivado = Boolean(bloqueado);
  return html`
    <label class="campo${desactivado ? crudo(' campo--bloqueado') : ''}">
      <span class="campo__etiqueta">${etiqueta}${obligatorio ? html`<abbr title="Obligatorio">*</abbr>` : ''}</span>
      <input
        type="${tipo}"
        name="${nombre}"
        value="${valor ?? ''}"
        ${crudo(obligatorio ? 'required' : '')}
        ${crudo(desactivado ? 'disabled' : '')}
        ${placeholder ? crudo(`placeholder="${escapar(placeholder)}"`) : ''}
        ${crudo(atributos)}>
      ${desactivado
        ? html`<input type="hidden" name="${nombre}" value="${valor ?? ''}"><span class="campo__candado">🔒 ${bloqueado}</span>`
        : ''}
      ${ayuda ? html`<span class="campo__ayuda">${ayuda}</span>` : ''}
    </label>`;
}

export function area({ nombre, etiqueta, valor = '', ayuda = null, obligatorio = false, filas = 4, bloqueado = null, placeholder = null }) {
  const desactivado = Boolean(bloqueado);
  return html`
    <label class="campo${desactivado ? crudo(' campo--bloqueado') : ''}">
      <span class="campo__etiqueta">${etiqueta}${obligatorio ? html`<abbr title="Obligatorio">*</abbr>` : ''}</span>
      <textarea
        name="${nombre}"
        rows="${filas}"
        ${crudo(obligatorio ? 'required' : '')}
        ${crudo(desactivado ? 'disabled' : '')}
        ${placeholder ? crudo(`placeholder="${escapar(placeholder)}"`) : ''}>${valor ?? ''}</textarea>
      ${desactivado
        ? html`<input type="hidden" name="${nombre}" value="${valor ?? ''}"><span class="campo__candado">🔒 ${bloqueado}</span>`
        : ''}
      ${ayuda ? html`<span class="campo__ayuda">${ayuda}</span>` : ''}
    </label>`;
}

/**
 * Campo sin etiqueta visible, para escribir dentro de una celda de tabla: ahí el
 * encabezado de la columna ya dice qué es. La etiqueta igual viaja como aria-label,
 * porque un lector de pantalla recorre la celda sin ver el encabezado al lado.
 */
export function entrada({ nombre, etiqueta, valor = '', tipo = 'text', atributos = '', placeholder = null }) {
  return html`<input
    type="${tipo}"
    name="${nombre}"
    value="${valor ?? ''}"
    aria-label="${etiqueta}"
    ${placeholder ? crudo(`placeholder="${escapar(placeholder)}"`) : ''}
    ${crudo(atributos)}>`;
}

/** Igual que `entrada`, para texto de varios renglones. */
export function entradaArea({ nombre, etiqueta, valor = '', filas = 2, placeholder = null }) {
  return html`<textarea
    name="${nombre}"
    rows="${filas}"
    aria-label="${etiqueta}"
    ${placeholder ? crudo(`placeholder="${escapar(placeholder)}"`) : ''}>${valor ?? ''}</textarea>`;
}

export function seleccion({ nombre, etiqueta, valor = '', opciones, ayuda = null, obligatorio = false, bloqueado = null, vacioTexto = null }) {
  const desactivado = Boolean(bloqueado);
  return html`
    <label class="campo${desactivado ? crudo(' campo--bloqueado') : ''}">
      <span class="campo__etiqueta">${etiqueta}${obligatorio ? html`<abbr title="Obligatorio">*</abbr>` : ''}</span>
      <select name="${nombre}" ${crudo(obligatorio ? 'required' : '')} ${crudo(desactivado ? 'disabled' : '')}>
        ${vacioTexto ? html`<option value="">${vacioTexto}</option>` : ''}
        ${opciones.map(
          (opcion) => html`<option value="${opcion.valor}" ${crudo(String(opcion.valor) === String(valor ?? '') ? 'selected' : '')}>${opcion.texto}</option>`,
        )}
      </select>
      ${desactivado
        ? html`<input type="hidden" name="${nombre}" value="${valor ?? ''}"><span class="campo__candado">🔒 ${bloqueado}</span>`
        : ''}
      ${ayuda ? html`<span class="campo__ayuda">${ayuda}</span>` : ''}
    </label>`;
}

const MESES_NOMBRE = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Fecha en tres listas: día, mes y año. Se usa en lugar del campo de fecha del
 * navegador, que exige escribir en el formato exacto y queda vacío si no se completa
 * entero. Con listas no hay forma de dejarla a medias.
 */
export function fechaElegible({ nombre, etiqueta, valor = '', anios = [], ayuda = null, obligatorio = false }) {
  const [anioActual = '', mesActual = '', diaActual = ''] = String(valor || '').split('-');
  const dias = [];
  for (let i = 1; i <= 31; i += 1) dias.push(String(i).padStart(2, '0'));
  const listaAnios = anios.length > 0 ? anios.map(String) : [String(new Date().getFullYear())];

  return html`
    <div class="campo">
      <span class="campo__etiqueta">${etiqueta}${obligatorio ? html`<abbr title="Obligatorio">*</abbr>` : ''}</span>
      <div class="fecha-partida">
        <select name="${nombre}_d" ${crudo(obligatorio ? 'required' : '')}>
          <option value="">día</option>
          ${dias.map((d) => html`<option value="${d}" ${crudo(d === diaActual ? 'selected' : '')}>${Number(d)}</option>`)}
        </select>
        <select name="${nombre}_m" ${crudo(obligatorio ? 'required' : '')}>
          <option value="">mes</option>
          ${MESES_NOMBRE.map(
            (nombreMes, i) => html`<option value="${String(i + 1).padStart(2, '0')}" ${crudo(
              String(i + 1).padStart(2, '0') === mesActual ? 'selected' : '',
            )}>${nombreMes}</option>`,
          )}
        </select>
        <select name="${nombre}_a" ${crudo(obligatorio ? 'required' : '')}>
          ${listaAnios.map((a) => html`<option value="${a}" ${crudo(a === anioActual ? 'selected' : '')}>${a}</option>`)}
        </select>
      </div>
      ${ayuda ? html`<span class="campo__ayuda">${ayuda}</span>` : ''}
    </div>`;
}

/**
 * Hora en dos listas: horas y minutos. Se usa en lugar del reloj del navegador porque
 * ese gira sin fin; acá la lista empieza y termina donde se agendan reuniones.
 */
export function hora({ nombre, etiqueta, valor = '', desde = 8, hasta = 22, ayuda = null, obligatorio = false, bloqueado = null }) {
  const [horaActual = '', minutoActual = ''] = String(valor || '').split(':');
  const horas = [];
  for (let i = desde; i <= hasta; i += 1) horas.push(String(i).padStart(2, '0'));
  const minutos = [];
  for (let i = 0; i < 60; i += 1) minutos.push(String(i).padStart(2, '0'));
  const desactivado = Boolean(bloqueado);

  return html`
    <div class="campo${desactivado ? crudo(' campo--bloqueado') : ''}">
      <span class="campo__etiqueta">${etiqueta}${obligatorio ? html`<abbr title="Obligatorio">*</abbr>` : ''}</span>
      <div class="hora">
        <select name="${nombre}_h" ${crudo(obligatorio ? 'required' : '')} ${crudo(desactivado ? 'disabled' : '')}>
          ${horas.map(
            (h) => html`<option value="${h}" ${crudo(h === horaActual ? 'selected' : '')}>${h}</option>`,
          )}
        </select>
        <span aria-hidden="true">:</span>
        <select name="${nombre}_m" ${crudo(obligatorio ? 'required' : '')} ${crudo(desactivado ? 'disabled' : '')}>
          ${minutos.map(
            (m) => html`<option value="${m}" ${crudo(m === minutoActual ? 'selected' : '')}>${m}</option>`,
          )}
        </select>
      </div>
      ${ayuda ? html`<span class="campo__ayuda">${ayuda}</span>` : ''}
    </div>`;
}

export function casilla({ nombre, etiqueta, marcada = false, bloqueado = null }) {
  return html`
    <label class="casilla${bloqueado ? crudo(' campo--bloqueado') : ''}">
      <input type="checkbox" name="${nombre}" value="1" ${crudo(marcada ? 'checked' : '')} ${crudo(bloqueado ? 'disabled' : '')}>
      ${bloqueado && marcada ? html`<input type="hidden" name="${nombre}" value="1">` : ''}
      <span>${etiqueta}</span>
    </label>`;
}

export function opcionesUsuarios(usuarios, { incluirVacio = true } = {}) {
  const lista = usuarios.map((u) => ({
    valor: u.id,
    texto: `${u.nombre}${u.rol === 'Direccion' ? ' · Dirección' : u.rol === 'Ayudante' ? ' · Ayudante' : ''}`,
  }));
  return incluirVacio ? [{ valor: '', texto: 'Sin asignar' }, ...lista] : lista;
}

/**
 * Dónde se hace la reunión. Ir al club se destaca aparte: ocupa el viaje de ida y
 * vuelta, así que no se encadena con otras reuniones como las de la liga.
 */
export function etiquetaModalidad(modalidad) {
  if (modalidad === 'En el club') {
    return html`<span class="chip chip--visita" title="Hay que viajar: ocupa alrededor de tres horas">↗ En el club</span>`;
  }
  return estado(modalidad, { tono: 'neutro' });
}

/** Clubes que contactan los directivos: los ayudantes no los llaman. */
export function etiquetaContactoDirecto(club) {
  if (!club || club.contacto_directo !== 1) return crudo('');
  return html`<span class="chip chip--directo" title="Lo contacta Dirección: no llamar desde la liga">★ Contacto de Dirección</span>`;
}

/** Dónde se hace la reunión. */
export const OPCIONES_MODALIDAD = [
  { valor: 'En la liga', texto: 'En la liga' },
  { valor: 'En el club', texto: 'En el club' },
  { valor: 'Llamada', texto: 'Llamada' },
];

/** Qué tan importante es el club para la liga. */
export const PRIORIDADES = {
  1: 'absoluta',
  2: 'importante',
  3: 'normal',
  4: 'baja',
};

export const OPCIONES_PRIORIDAD = Object.entries(PRIORIDADES).map(([valor, texto]) => ({
  valor,
  texto: `${valor} — ${texto}`,
}));

export function etiquetaPrioridad(valor) {
  if (!valor) return crudo('');
  const nombre = PRIORIDADES[valor];
  const tono = valor === '1' ? 'alerta' : valor === '2' ? 'aviso' : valor === '4' ? 'neutro' : 'neutro';
  return estado(nombre ? `Prioridad ${valor} · ${nombre}` : `Prioridad ${valor}`, { tono });
}

export function barraProgreso(etapas) {
  return html`
    <ol class="progreso">
      ${etapas.map(
        (etapa) => html`
          <li class="progreso__paso progreso__paso--${crudo(etapa.estado)}">
            <span class="progreso__marca" aria-hidden="true">${etapa.estado === 'hecho' ? '✓' : etapa.estado === 'actual' ? '•' : ''}</span>
            <span class="progreso__texto">${etapa.texto}</span>
          </li>`,
      )}
    </ol>`;
}

export function kpi({ titulo, valor, ayuda = null, href = null, tono = 'neutro' }) {
  const contenido = html`
    <span class="kpi__valor">${valor}</span>
    <span class="kpi__titulo">${titulo}</span>
    ${ayuda ? html`<span class="kpi__ayuda">${ayuda}</span>` : ''}`;
  return href
    ? html`<a class="kpi kpi--${crudo(tono)}" href="${href}">${contenido}</a>`
    : html`<div class="kpi kpi--${crudo(tono)}">${contenido}</div>`;
}

export function porcentaje(valor) {
  if (valor === null || valor === undefined) {
    return html`<span class="sin-dato" title="No hay clubes en el ciclo">sin datos</span>`;
  }
  return html`${Math.round(valor * 100)} %`;
}

export function detalleAbrible({ titulo, cuerpo, abierto = false, clase = '' }) {
  return html`
    <details class="plegable ${crudo(clase)}" ${crudo(abierto ? 'open' : '')}>
      <summary>${titulo}</summary>
      <div class="plegable__cuerpo">${cuerpo}</div>
    </details>`;
}
