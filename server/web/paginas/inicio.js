import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta } from '../../lib/fechas.js';

export function render({ usuario, csrf, avisos, datos }) {
  const i = datos.indicadores;

  const contenido = html`
    ${usuario && usuario.rol === 'Consulta'
      ? ui.aviso('Tu rol es de consulta: ves todo el ciclo y no modificás registros.', { tono: 'info' })
      : ''}

    ${ui.tarjeta({
      titulo: 'Indicadores del ciclo 2026/2027',
      subtitulo: 'Cada número abre los registros que lo componen.',
      cuerpo: html`
        <div class="kpis">
          ${ui.kpi({ titulo: 'Clubes del ciclo', valor: i.clubesDelCiclo, href: '/indicadores/clubes', ayuda: 'Clubes únicos con plan activo' })}
          ${ui.kpi({ titulo: 'Confirmados', valor: i.confirmados, href: '/indicadores/confirmados', tono: 'exito', ayuda: 'Resultado final validado' })}
          ${ui.kpi({ titulo: 'Retención', valor: ui.porcentaje(i.retencion), ayuda: i.clubesDelCiclo === 0 ? 'Sin clubes en el ciclo' : `${i.confirmados} de ${i.clubesDelCiclo}` })}
          ${ui.kpi({ titulo: 'Actas por revisar', valor: i.actasPorRevisar, href: '/indicadores/actas', tono: i.actasPorRevisar ? 'aviso' : 'neutro' })}
          ${ui.kpi({ titulo: 'Tareas vencidas', valor: i.tareasVencidas, href: '/indicadores/vencidas', tono: i.tareasVencidas ? 'alerta' : 'neutro' })}
          ${ui.kpi({ titulo: 'Reconfirmaciones abiertas', valor: i.reconfirmacionesAbiertas, href: '/indicadores/reconfirmaciones' })}
          ${i.conflictos > 0
            ? ui.kpi({ titulo: 'Conflictos de datos', valor: i.conflictos, href: '/indicadores/conflictos', tono: 'alerta', ayuda: 'Bloquean confirmar y cerrar' })
            : ''}
        </div>
        <div class="separador"></div>
        <div class="pila pila--chica">
          <p class="menor">
            Condicional (${i.condicionales}) y Sin respuesta (${i.sinRespuesta}) siguen abiertas:
            no cuentan como confirmación ni como baja. No continúa: ${i.noContinuan}.
          </p>
          ${tirasResumen(i.tiras)}
        </div>`,
    })}

    <div class="rejilla rejilla--2">
      ${ui.tarjeta({
        titulo: 'Próximas reuniones',
        acciones: ui.enlace('/agenda', 'Ver agenda', { clase: 'boton boton--secundario boton--chico' }),
        cuerpo:
          datos.proximasReuniones.length === 0
            ? ui.vacio('No hay reuniones programadas.', 'Se agendan desde la ficha del club.')
            : html`<ul class="lista-limpia">
                ${datos.proximasReuniones.map(
                  (m) => html`
                    <li class="item ${m.modalidad === 'En el club' ? 'item--visita' : ''}">
                      <span class="item__titulo">
                        ${ui.enlace(`/reuniones/${m.id}`, m.club_nombre)}
                      </span>
                      <span class="item__meta">
                        ${ui.fechaHora(m.inicio)} ${ui.etiquetaModalidad(m.modalidad)}${m.lugar ? ` ${m.lugar}` : ''}
                        ${ui.estado(m.estado)}
                      </span>
                      <span class="item__meta">
                        La tiene: ${m.director1_nombre || '—'}${m.director2_nombre ? ` y ${m.director2_nombre}` : ''} ·
                        Acta: ${m.acta_responsable_nombre || 'sin asignar'}
                      </span>
                    </li>`,
                )}
              </ul>`,
      })}

      ${ui.tarjeta({
        titulo: 'Actas por revisar',
        subtitulo: 'Esperan la decisión de Dirección: aprobar o devolver con motivo.',
        cuerpo:
          datos.actasPorRevisar.length === 0
            ? ui.vacio('No hay actas esperando revisión.')
            : html`<ul class="lista-limpia">
                ${datos.actasPorRevisar.map(
                  (m) => html`
                    <li class="item item--aviso">
                      <span class="item__titulo">${ui.enlace(`/reuniones/${m.id}`, m.club_nombre)}</span>
                      <span class="item__meta">
                        Reunión del ${fechaCorta(m.inicio)} · la cargó ${m.acta_responsable_nombre || '—'}
                      </span>
                    </li>`,
                )}
              </ul>`,
      })}

      ${ui.tarjeta({
        titulo: usuario ? 'Mis tareas abiertas' : 'Tareas abiertas',
        acciones: ui.enlace('/compromisos', 'Ver todas', { clase: 'boton boton--secundario boton--chico' }),
        cuerpo:
          !usuario || datos.misTareas.length === 0
            ? ui.vacio('No tenés tareas abiertas asignadas.')
            : html`<ul class="lista-limpia">
                ${datos.misTareas.map((t) => itemTarea(t))}
              </ul>`,
      })}

      ${ui.tarjeta({
        titulo: 'Tareas vencidas del equipo',
        cuerpo:
          datos.tareasVencidas.length === 0
            ? ui.vacio('No hay tareas vencidas.')
            : html`<ul class="lista-limpia">${datos.tareasVencidas.map((t) => itemTarea(t))}</ul>`,
      })}
    </div>

    ${ui.tarjeta({
      titulo: 'Reconfirmación enero-febrero 2027',
      subtitulo: `Ventana prevista: ${fechaCorta(datos.ventana.inicio)} a ${fechaCorta(datos.ventana.fin)}.${
        datos.dentroDeVentana ? ' Estamos dentro de la ventana.' : ' Hoy estamos fuera de la ventana.'
      }`,
      acciones: ui.enlace('/reconfirmacion', 'Abrir la cola', { clase: 'boton boton--secundario boton--chico' }),
      cuerpo:
        datos.reconfirmacionesAGestionar.length === 0
          ? ui.vacio('No hay fichas abiertas.', 'Las fichas se abren desde el plan de cada club.')
          : html`<ul class="lista-limpia">
              ${datos.reconfirmacionesAGestionar.map(
                (r) => html`
                  <li class="item">
                    <span class="item__titulo">${ui.enlace(`/reconfirmacion/${r.id}`, r.club_nombre)}</span>
                    <span class="item__meta">
                      ${ui.estado(r.estado)} · prevista ${fechaCorta(r.fecha_prevista)}
                      ${r.proximo_contacto ? html`· próximo contacto ${fechaCorta(r.proximo_contacto)}` : ''}
                      · responsable ${r.responsable_nombre || '—'}
                    </span>
                  </li>`,
              )}
            </ul>`,
    })}`;

  return pagina({
    titulo: 'Inicio',
    subtitulo: 'Reuniones, acuerdos y reconfirmación de clubes para 2027.',
    ruta: '/',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

function itemTarea(t) {
  return html`
    <li class="item ${t.vencido ? 'item--alerta' : ''}">
      <span class="item__titulo">${ui.enlace(`/compromisos#tarea-${t.id}`, t.descripcion)}</span>
      <span class="item__meta">
        ${t.club_nombre} · vence ${fechaCorta(t.fecha_limite)}
        ${t.vencido ? ui.estado('Vencida', { tono: 'alerta' }) : ui.estado(t.estado)}
        · ${t.parte_responsable === 'Club' ? `gestiona con ${t.contacto_club}` : 'interna'}
      </span>
      <span class="item__meta">Responsable: ${t.responsable_nombre}</span>
    </li>`;
}

function tirasResumen(t) {
  // Una fila sin ninguna cantidad cargada no dice nada: mostraría un cero que no existe.
  // Cada etapa aparece recién cuando tiene algo cargado, y el plan 2027 aparece también
  // cuando está escrito en palabras, que es como viene de la planilla de venta.
  const cargadas = (total, faltan) => (total ? total - faltan : 0);

  const filas = [];
  if (cargadas(t.disciplinas, t.baseFaltan) > 0) {
    filas.push(['Tiras 2026', ui.cantidad(t.base), cobertura(t.disciplinas, t.baseFaltan)]);
  }
  if (t.conIntencion > 0 || cargadas(t.disciplinas, t.propuestasFaltan) > 0) {
    filas.push([
      'Pretendido 2027',
      ui.cantidad(t.propuestas > 0 ? t.propuestas : null),
      t.conIntencion > 0
        ? html`plan escrito en ${t.conIntencion} de ${t.disciplinas} ${ui.estado('en palabras', { tono: 'info' })}`
        : cobertura(t.disciplinas, t.propuestasFaltan),
    ]);
  }
  if (cargadas(t.disciplinas, t.acordadasFaltan) > 0) {
    filas.push(['Acordado en acta', ui.cantidad(t.acordadas), cobertura(t.disciplinas, t.acordadasFaltan)]);
  }
  if (cargadas(t.finalesDisciplinas, t.finalesFaltan) > 0) {
    filas.push(['Final reconfirmado', ui.cantidad(t.finales), cobertura(t.finalesDisciplinas, t.finalesFaltan)]);
  }

  if (filas.length === 0) {
    return html`
      <p class="menor">
        Todavía no hay cantidades de tiras cargadas. Se van sumando acá a medida que se acuerden
        en las reuniones.
      </p>`;
  }

  return html`
    ${ui.tabla({
      clase: 'tabla--compacta tabla--numeros comparacion',
      columnas: ['Tiras del ciclo', 'Total', 'Cobertura'],
      filas,
    })}
    <p class="menor">
      Las cifras no se mezclan: pretendido, acordado y final son columnas distintas. Una disciplina sin
      cantidad cargada queda en blanco y no se cuenta como cero.
    </p>`;
}

function cobertura(total, faltan) {
  if (!total) return html`<span class="sin-dato">sin cargar</span>`;
  const cargadas = total - faltan;
  if (cargadas === 0) return html`<span class="sin-dato">sin cargar</span>`;
  if (faltan === 0) return html`${cargadas} de ${total} ${ui.estado('completo', { tono: 'exito' })}`;
  return html`${cargadas} de ${total} ${ui.estado(`faltan ${faltan}`, { tono: 'aviso' })}`;
}
