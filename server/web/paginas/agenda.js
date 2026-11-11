import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import {
  fechaHoraCorta,
  fechaLarga,
  soloFecha,
  lunesDe,
  rangoSemana,
  nombreDiaDe,
  diasEntre,
} from '../../lib/fechas.js';

/** Los rangos que se eligen con un clic. El servidor los resuelve a fechas concretas. */
const RANGOS = [
  { valor: '', texto: 'Todo' },
  { valor: 'hoy', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'proxima', texto: 'Próxima semana' },
  { valor: 'mes', texto: 'Este mes' },
  { valor: 'porvenir', texto: 'De hoy en adelante' },
];

/** Cómo se agrupa lo que se está mirando. Los filtros no cambian: solo el agrupado. */
const VISTAS = [
  { valor: 'dia', texto: 'Por día' },
  { valor: 'semana', texto: 'Por semana' },
  { valor: 'persona', texto: 'Por persona' },
  { valor: 'club', texto: 'Por club' },
];

export function render({ usuario, csrf, avisos, datos }) {
  const grupos = agrupar(datos);

  const contenido = html`
    ${barraDeVistas({ datos, usuario })}
    ${filtros({ datos })}
    ${resumen(datos)}

    ${datos.cruces.length > 0
      ? ui.aviso('', {
          tono: 'aviso',
          titulo: 'Reuniones que se superponen y comparten personas (aviso, no bloquea)',
          lista: datos.cruces.map(
            (c) => `${c.a.club_nombre} y ${c.b.club_nombre}: ${fechaHoraCorta(c.a.inicio)} / ${fechaHoraCorta(c.b.inicio)}`,
          ),
        })
      : ''}

    ${grupos.length === 0
      ? ui.tarjeta({
          titulo: 'Agenda',
          cuerpo: ui.vacio(
            hayFiltros(datos) ? 'Ninguna reunión entra en este filtro.' : 'No hay reuniones todavía.',
            hayFiltros(datos)
              ? 'Probá con "Todo" arriba, o limpiá los filtros.'
              : 'Se agendan desde la ficha de cada club.',
          ),
        })
      : grupos.map((grupo) =>
          ui.tarjeta({
            titulo: grupo.titulo,
            subtitulo: grupo.subtitulo,
            tono: grupo.tono || null,
            cuerpo: html`<ul class="lista-limpia">
              ${grupo.reuniones.map((m) => item(m, { datos, mostrarFecha: grupo.mostrarFecha }))}
            </ul>`,
          }),
        )}`;

  return pagina({
    titulo: 'Agenda',
    subtitulo: 'Encuentros con los clubes del ciclo.',
    ruta: '/agenda',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

/**
 * Rangos y vistas como enlaces, no como un formulario: así cada combinación tiene su
 * dirección y se puede guardar en favoritos o pasar por mensaje.
 */
function barraDeVistas({ datos, usuario }) {
  const enlace = (cambios, texto, activo) => {
    const q = consulta(datos, cambios);
    return html`<a class="pestana ${activo ? 'pestana--activa' : ''}" href="/agenda${q}">${texto}</a>`;
  };

  return ui.tarjeta({
    titulo: 'Qué período y cómo verlo',
    cuerpo: html`
      <div class="pestanas">
        ${RANGOS.map((r) => enlace({ rango: r.valor, desde: '', hasta: '' }, r.texto, datos.rango === r.valor))}
      </div>
      <div class="separador"></div>
      <div class="pestanas">
        ${VISTAS.map((v) => enlace({ vista: v.valor }, v.texto, datos.vista === v.valor))}
      </div>
      <div class="separador"></div>
      <div class="pestanas">
        ${enlace(
          { pendientes: datos.pendientesDeActa ? '' : '1' },
          'Pendientes de acta',
          datos.pendientesDeActa,
        )}
        ${enlace(
          { modalidad: datos.modalidad === 'En el club' ? '' : 'En el club' },
          '↗ Solo visitas al club',
          datos.modalidad === 'En el club',
        )}
        ${enlace(
          { persona: datos.persona === usuario?.id ? '' : usuario?.id },
          'Solo lo mío',
          Boolean(usuario) && datos.persona === usuario.id,
        )}
      </div>`,
  });
}

function filtros({ datos }) {
  return ui.detalleAbrible({
    titulo: 'Filtrar por persona, club, estado o fechas',
    // Se abre solo si hay un filtro puesto a mano. Las fechas que resolvió un rango
    // rápido no cuentan: ya se ven en la pestaña marcada arriba.
    abierto: Boolean(
      datos.persona || datos.clubId || datos.estado || (!datos.rango && (datos.desde || datos.hasta)),
    ),
    cuerpo: html`
      <form method="get" action="/agenda" class="formulario formulario--filas">
        <input type="hidden" name="vista" value="${datos.vista}">
        ${datos.pendientesDeActa ? html`<input type="hidden" name="pendientes" value="1">` : ''}
        ${ui.seleccion({
          nombre: 'persona',
          etiqueta: 'Persona',
          valor: datos.persona,
          vacioTexto: 'Cualquiera',
          opciones: ui.opcionesUsuarios(datos.usuariosActivos, { incluirVacio: false }),
          ayuda: 'La tiene, acompaña o toma nota: los tres papeles cuentan.',
        })}
        ${ui.seleccion({
          nombre: 'club',
          etiqueta: 'Club',
          valor: datos.clubId,
          vacioTexto: 'Todos',
          opciones: datos.clubesConReuniones.map((c) => ({ valor: c.id, texto: c.nombre })),
        })}
        ${ui.seleccion({
          nombre: 'estado',
          etiqueta: 'Estado',
          valor: datos.estado,
          vacioTexto: 'Todos',
          opciones: ['Borrador', 'Programada', 'Realizada', 'Cancelada'].map((e) => ({ valor: e, texto: e })),
        })}
        ${ui.seleccion({
          nombre: 'modalidad',
          etiqueta: 'Dónde',
          valor: datos.modalidad,
          vacioTexto: 'Donde sea',
          opciones: ui.OPCIONES_MODALIDAD,
        })}
        ${ui.campo({ nombre: 'desde', etiqueta: 'Desde', tipo: 'date', valor: datos.desde })}
        ${ui.campo({ nombre: 'hasta', etiqueta: 'Hasta', tipo: 'date', valor: datos.hasta })}
        <div class="acciones-fila" style="align-self:end">
          ${ui.boton('Filtrar', { clase: 'boton boton--secundario' })}
          ${ui.enlace('/agenda', 'Limpiar todo', { clase: 'boton boton--texto' })}
        </div>
      </form>`,
  });
}

/**
 * Lo que hay que saber antes de leer la lista: cuántas reuniones, cuántas son viajes al
 * club y cuántas horas ocupan. Las visitas se cuentan aparte porque ocupan la tarde.
 */
function resumen(datos) {
  const vivas = datos.reuniones.filter((m) => m.estado !== 'Cancelada');
  if (vivas.length === 0) return '';
  const visitas = vivas.filter((m) => m.modalidad === 'En el club').length;
  const minutos = vivas.reduce((total, m) => total + duracion(m), 0);
  const sinActa = vivas.filter((m) => m.estado === 'Realizada' && m.acta_estado !== 'Validada').length;

  return html`
    <p class="menor resumen-agenda">
      ${vivas.length} reunión(es)${datos.reuniones.length !== vivas.length
        ? ` (y ${datos.reuniones.length - vivas.length} cancelada(s))`
        : ''}
      · ${visitas} visita(s) al club
      · ${Math.round((minutos / 60) * 10) / 10} h en total
      ${sinActa > 0 ? html`· ${ui.estado(`${sinActa} sin acta aprobada`, { tono: 'aviso' })}` : ''}
    </p>`;
}

function duracion(m) {
  if (!m.inicio || !m.fin) return 0;
  const a = Date.parse(`${m.inicio.slice(0, 16)}:00Z`);
  const b = Date.parse(`${m.fin.slice(0, 16)}:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, (b - a) / 60000);
}

function item(m, { datos, mostrarFecha = true }) {
  const esHoy = soloFecha(m.inicio) === datos.hoy;
  const pasada = m.inicio && soloFecha(m.inicio) < datos.hoy;
  const sinActa = m.estado === 'Realizada' && m.acta_estado !== 'Validada';

  return html`
    <li class="item ${m.estado === 'Cancelada'
      ? 'item--cancelada'
      : m.modalidad === 'En el club'
        ? 'item--visita'
        : m.acta_estado === 'Para revisar'
          ? 'item--aviso'
          : ''}">
      <div class="fila-entre">
        <span class="item__titulo">
          ${ui.enlace(`/reuniones/${m.id}`, m.club_nombre)}
          ${esHoy ? ui.estado('hoy', { tono: 'info' }) : ''}
        </span>
        <span class="acciones-fila">
          ${ui.estado(m.estado)}
          ${ui.estado(`Acta: ${m.acta_estado}`, {
            tono: m.acta_estado === 'Validada' ? 'exito' : m.acta_estado === 'Para revisar' ? 'aviso' : 'neutro',
          })}
        </span>
      </div>
      <span class="item__meta">
        ${m.inicio
          ? `${mostrarFecha ? fechaHoraCorta(m.inicio) : m.inicio.slice(11, 16)} a ${fechaHoraCorta(m.fin).slice(-5)}`
          : 'horario a definir'}
        ${ui.etiquetaModalidad(m.modalidad)}${m.lugar ? html` ${m.lugar}` : ''}
      </span>
      <span class="item__meta">
        ${m.director1_nombre || '—'}${m.director2_nombre ? ` y ${m.director2_nombre}` : ''} ·
        nota: ${m.acta_responsable_nombre || 'sin asignar'}
      </span>
      ${m.nota ? html`<span class="item__meta item__nota">${m.nota}</span>` : ''}
      ${sinActa && pasada
        ? html`<span class="item__meta">
            ${ui.estado(`se hizo hace ${diasEntre(soloFecha(m.inicio), datos.hoy)} día(s) y el acta sigue en ${m.acta_estado}`, { tono: 'aviso' })}
          </span>`
        : ''}
    </li>`;
}

// --- Agrupado ----------------------------------------------------------------

function agrupar(datos) {
  if (datos.vista === 'semana') return porSemana(datos);
  if (datos.vista === 'persona') return porPersona(datos);
  if (datos.vista === 'club') return porClub(datos);
  return porDia(datos);
}

function porDia(datos) {
  const mapa = agruparPor(datos.reuniones, (m) => soloFecha(m.inicio) || 'sin-fecha');
  return ordenarClaves(mapa).map(([dia, reuniones]) => ({
    titulo: dia === 'sin-fecha' ? 'Sin fecha asignada' : `${capitalizar(nombreDiaDe(dia))} ${fechaLarga(dia)}`,
    subtitulo: `${reuniones.length} reunión(es)`,
    tono: dia === datos.hoy ? 'acento' : null,
    mostrarFecha: false,
    reuniones,
  }));
}

function porSemana(datos) {
  const mapa = agruparPor(datos.reuniones, (m) => (m.inicio ? lunesDe(soloFecha(m.inicio)) : 'sin-fecha'));
  return ordenarClaves(mapa).map(([lunes, reuniones]) => ({
    titulo: lunes === 'sin-fecha' ? 'Sin fecha asignada' : `Semana del ${rangoSemana(lunes)}`,
    subtitulo: resumenDeGrupo(reuniones),
    tono: lunes !== 'sin-fecha' && lunes === lunesDe(datos.hoy) ? 'acento' : null,
    reuniones,
  }));
}

/**
 * Una reunión aparece bajo cada persona que tiene algo que hacer en ella: la Dirección
 * que la tiene, la que acompaña y quien toma nota. Por eso una misma reunión puede
 * figurar en dos o tres grupos; es a propósito, cada uno mira el suyo.
 */
function porPersona(datos) {
  const mapa = new Map();
  const sumar = (nombre, m) => {
    if (!nombre) return;
    if (!mapa.has(nombre)) mapa.set(nombre, []);
    if (!mapa.get(nombre).includes(m)) mapa.get(nombre).push(m);
  };
  for (const m of datos.reuniones) {
    sumar(m.director1_nombre, m);
    sumar(m.director2_nombre, m);
    sumar(m.acta_responsable_nombre, m);
    if (!m.director1_nombre && !m.director2_nombre && !m.acta_responsable_nombre) sumar('Sin asignar', m);
  }
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([nombre, reuniones]) => ({
      titulo: nombre,
      subtitulo: `${resumenDeGrupo(reuniones)} · aparece en todas las que tiene, acompaña o toma nota`,
      reuniones,
    }));
}

function porClub(datos) {
  const mapa = agruparPor(datos.reuniones, (m) => m.club_nombre);
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([club, reuniones]) => ({
      titulo: club,
      subtitulo: resumenDeGrupo(reuniones),
      reuniones,
    }));
}

function resumenDeGrupo(reuniones) {
  const visitas = reuniones.filter((m) => m.modalidad === 'En el club' && m.estado !== 'Cancelada').length;
  return `${reuniones.length} reunión(es)${visitas > 0 ? ` · ${visitas} en el club` : ''}`;
}

function agruparPor(lista, clave) {
  const mapa = new Map();
  for (const elemento of lista) {
    const k = clave(elemento);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(elemento);
  }
  return mapa;
}

/** Las fechas en orden, y "sin fecha" siempre al final. */
function ordenarClaves(mapa) {
  return [...mapa.entries()].sort(([a], [b]) =>
    a === 'sin-fecha' ? 1 : b === 'sin-fecha' ? -1 : a.localeCompare(b),
  );
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// --- Enlaces -----------------------------------------------------------------

/** Arma la dirección conservando los filtros puestos y cambiando solo lo que se pide. */
function consulta(datos, cambios) {
  // Con un rango elegido, las fechas que se ven son las que ese rango resolvió: no se
  // arrastran en el enlace, o diría dos veces lo mismo y "esta semana" quedaría
  // congelada en las fechas de hoy.
  const actual = {
    rango: datos.rango,
    desde: datos.rango ? '' : datos.desde,
    hasta: datos.rango ? '' : datos.hasta,
    estado: datos.estado,
    persona: datos.persona,
    club: datos.clubId,
    modalidad: datos.modalidad,
    pendientes: datos.pendientesDeActa ? '1' : '',
    vista: datos.vista === 'dia' ? '' : datos.vista,
  };
  const partes = [];
  for (const [clave, valor] of Object.entries({ ...actual, ...cambios })) {
    if (valor) partes.push(`${clave}=${encodeURIComponent(valor)}`);
  }
  return partes.length > 0 ? `?${partes.join('&')}` : '';
}

function hayFiltros(datos) {
  return Boolean(
    datos.rango ||
      datos.desde ||
      datos.hasta ||
      datos.estado ||
      datos.persona ||
      datos.clubId ||
      datos.modalidad ||
      datos.pendientesDeActa,
  );
}
