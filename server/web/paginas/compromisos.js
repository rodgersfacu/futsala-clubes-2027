import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta, hoy } from '../../lib/fechas.js';

const FILTROS = [
  { clave: 'abiertos', texto: 'Abiertas' },
  { clave: 'vencidos', texto: 'Vencidas' },
  { clave: 'resueltos', texto: 'Resueltas' },
  { clave: 'todos', texto: 'Todas' },
];

export function render({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    <div class="acciones-fila" style="margin-bottom:1rem">
      ${FILTROS.map((f) =>
        ui.enlace(`/compromisos?filtro=${f.clave}${datos.soloMias ? '&mias=1' : ''}`, f.texto, {
          clase: `boton boton--chico ${datos.filtro === f.clave ? '' : 'boton--secundario'}`,
        }),
      )}
      ${usuario
        ? ui.enlace(`/compromisos?filtro=${datos.filtro}${datos.soloMias ? '' : '&mias=1'}`, datos.soloMias ? 'Ver de todo el equipo' : 'Ver solo mis tareas', {
            clase: 'boton boton--texto boton--chico',
          })
        : ''}
    </div>

    ${ui.tarjeta({
      titulo: `${datos.tareas.length} compromiso(s)`,
      subtitulo: 'Resolver una tarea no hace desaparecer las demás vencidas.',
      cuerpo:
        datos.tareas.length === 0
          ? ui.vacio('No hay compromisos con este filtro.', 'Los compromisos se crean desde el acta de cada reunión.')
          : html`<ul class="lista-limpia">${datos.tareas.map((t) => itemTarea({ t, csrf, usuario, datos }))}</ul>`,
    })}`;

  return pagina({
    titulo: 'Compromisos',
    subtitulo: 'Tareas asumidas en las reuniones, con responsable y vencimiento.',
    ruta: '/compromisos',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

function itemTarea({ t, csrf, usuario, datos }) {
  const puede = datos.permisos[t.id];
  const abierta = t.estado === 'Pendiente' || t.estado === 'En curso';

  return html`
    <li class="item ${t.vencido ? 'item--alerta' : abierta ? '' : 'item--exito'}" id="tarea-${t.id}">
      <div class="fila-entre">
        <span class="item__titulo">${t.descripcion}</span>
        <span class="acciones-fila">
          ${t.vencido ? ui.estado('Vencida', { tono: 'alerta' }) : ''}
          ${ui.estado(t.estado)}
        </span>
      </div>
      <span class="item__meta">
        ${ui.enlace(`/clubes/${t.club_id}`, t.club_nombre)} ·
        ${ui.enlace(`/reuniones/${t.reunion_id}#compromisos`, 'ver reunión')} ·
        vence ${fechaCorta(t.fecha_limite)} ·
        ${t.parte_responsable === 'Club' ? `gestiona con ${t.contacto_club}` : 'interna de FUTSALA'}
      </span>
      <span class="item__meta">Responsable: ${t.responsable_nombre}</span>
      ${t.resolucion ? html`<span class="item__meta">Resolución (${fechaCorta(t.fecha_resolucion)}): ${t.resolucion}</span>` : ''}
      ${t.evidencia_url ? html`<span class="item__meta">${ui.enlace(t.evidencia_url, 'Evidencia')}</span>` : ''}

      ${puede && abierta
        ? html`
            <div class="acciones-fila" style="margin-top:.4rem">
              ${t.estado === 'Pendiente'
                ? ui.formulario({
                    accion: `/compromisos/${t.id}/iniciar`,
                    csrf,
                    clase: 'en-linea',
                    cuerpo: ui.boton('Marcar en curso', { clase: 'boton boton--secundario boton--chico' }),
                  })
                : ''}
              ${ui.detalleAbrible({
                titulo: 'Resolver',
                cuerpo: ui.formulario({
                  accion: `/compromisos/${t.id}/cumplir`,
                  csrf,
                  version: t.version,
                  cuerpo: html`
                    ${ui.area({ nombre: 'resolucion', etiqueta: 'Cómo se resolvió', obligatorio: true, filas: 2 })}
                    ${ui.campo({ nombre: 'fecha_resolucion', etiqueta: 'Fecha de resolución', tipo: 'date', valor: hoy(), ayuda: 'No puede ser futura.' })}
                    ${ui.campo({ nombre: 'evidencia_url', etiqueta: 'Evidencia (enlace)', valor: t.evidencia_url })}
                    ${ui.boton('Marcar cumplido', { clase: 'boton boton--chico' })}`,
                }),
              })}
              ${ui.detalleAbrible({
                titulo: 'Editar',
                cuerpo: ui.formulario({
                  accion: `/compromisos/${t.id}`,
                  csrf,
                  version: t.version,
                  clase: 'formulario--filas',
                  cuerpo: html`
                    ${ui.campo({ nombre: 'descripcion', etiqueta: 'Descripción', valor: t.descripcion, obligatorio: true })}
                    ${ui.seleccion({
                      nombre: 'parte_responsable',
                      etiqueta: 'Parte responsable',
                      valor: t.parte_responsable,
                      opciones: [
                        { valor: 'FUTSALA', texto: 'FUTSALA' },
                        { valor: 'Club', texto: 'Club' },
                      ],
                    })}
                    ${ui.campo({ nombre: 'contacto_club', etiqueta: 'Contacto del club', valor: t.contacto_club })}
                    ${ui.campo({ nombre: 'fecha_limite', etiqueta: 'Vence', tipo: 'date', valor: t.fecha_limite, obligatorio: true })}
                    ${usuario.rol === 'Direccion'
                      ? ui.seleccion({
                          nombre: 'responsable_id',
                          etiqueta: 'Responsable interno',
                          valor: t.responsable_id,
                          opciones: ui.opcionesUsuarios(datos.usuariosActivos.filter((u) => u.rol !== 'Consulta'), { incluirVacio: false }),
                        })
                      : ui.campo({
                          nombre: 'responsable_fijo',
                          etiqueta: 'Responsable interno',
                          valor: t.responsable_nombre,
                          bloqueado: 'Solo Dirección reasigna una tarea.',
                        })}
                    ${ui.campo({ nombre: 'evidencia_url', etiqueta: 'Evidencia (enlace)', valor: t.evidencia_url })}
                    <div style="align-self:end">${ui.boton('Guardar', { clase: 'boton boton--chico' })}</div>`,
                }),
              })}
              ${usuario.rol === 'Direccion'
                ? ui.detalleAbrible({
                    titulo: 'Cancelar',
                    cuerpo: ui.formulario({
                      accion: `/compromisos/${t.id}/cancelar`,
                      csrf,
                      cuerpo: html`
                        ${ui.area({ nombre: 'motivo', etiqueta: 'Motivo de la cancelación', obligatorio: true, filas: 2 })}
                        ${ui.boton('Cancelar compromiso', { clase: 'boton boton--peligro boton--chico' })}`,
                    }),
                  })
                : ''}
            </div>`
        : ''}
    </li>`;
}
