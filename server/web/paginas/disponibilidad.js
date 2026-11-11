import { html, crudo } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta } from '../../lib/fechas.js';
import { DIAS } from '../../dominio/disponibilidad.js';

export function render({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.aviso(
      'Quien agenda ve estos horarios y recibe un aviso si elige otro momento. Es una guía: si hace falta, la reunión se agenda igual.',
      { tono: 'info' },
    )}

    ${datos.agendas.length === 0
      ? ui.tarjeta({
          titulo: 'Disponibilidad',
          cuerpo: ui.vacio('No hay Dirección activa cargada todavía.'),
        })
      : datos.agendas.map((agenda) => tarjetaPersona({ agenda, usuario, csrf, datos }))}`;

  return pagina({
    titulo: 'Disponibilidad',
    subtitulo: 'Días y horarios en que Dirección acepta reuniones.',
    ruta: '/disponibilidad',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

function tarjetaPersona({ agenda, usuario, csrf }) {
  const esPropia = usuario && usuario.id === agenda.usuario.id;
  const porDia = DIAS.map((dia) => ({
    dia,
    franjas: agenda.franjas.filter((f) => f.dia_semana === dia.numero),
  }));

  return ui.tarjeta({
    titulo: agenda.usuario.nombre,
    subtitulo: esPropia ? 'Tu disponibilidad' : 'Solo esta persona puede cambiar sus horarios.',
    acciones: agenda.franjas.length === 0 ? ui.estado('sin horarios', { tono: 'aviso' }) : '',
    cuerpo: html`
      <div class="semana">
        ${porDia.map(
          ({ dia, franjas }) => html`
            <div class="semana__dia${franjas.length === 0 ? crudo(' semana__dia--libre') : ''}">
              <span class="semana__nombre">${dia.corto}</span>
              ${franjas.length === 0
                ? html`<span class="semana__libre">—</span>`
                : franjas.map(
                    (f) => html`
                      <span class="franja">
                        ${f.desde}–${f.hasta}
                        ${f.nota ? html`<small>${f.nota}</small>` : ''}
                        ${esPropia
                          ? ui.formulario({
                              accion: `/disponibilidad/franjas/${f.id}/quitar`,
                              csrf,
                              clase: 'en-linea',
                              cuerpo: ui.boton('×', {
                                clase: 'boton boton--texto boton--chico',
                                confirmar: `¿Quitar ${f.desde} a ${f.hasta} de los ${dia.nombre.toLowerCase()}?`,
                              }),
                            })
                          : ''}
                      </span>`,
                  )}
            </div>`,
        )}
      </div>

      ${agenda.ausencias.length > 0
        ? html`
            <div class="separador"></div>
            <h3>No disponible</h3>
            <ul class="lista-limpia">
              ${agenda.ausencias.map(
                (a) => html`
                  <li class="item item--aviso">
                    <div class="fila-entre">
                      <span>
                        ${fechaCorta(a.desde)} a ${fechaCorta(a.hasta)}
                        ${a.motivo ? html`· ${a.motivo}` : ''}
                      </span>
                      ${esPropia
                        ? ui.formulario({
                            accion: `/disponibilidad/ausencias/${a.id}/quitar`,
                            csrf,
                            clase: 'en-linea',
                            cuerpo: ui.boton('Quitar', { clase: 'boton boton--texto boton--chico' }),
                          })
                        : ''}
                    </div>
                  </li>`,
              )}
            </ul>`
        : ''}

      ${esPropia
        ? html`
            <div class="separador"></div>
            ${ui.detalleAbrible({
              titulo: 'Agregar un horario',
              abierto: agenda.franjas.length === 0,
              cuerpo: ui.formulario({
                accion: '/disponibilidad/franjas',
                csrf,
                clase: 'formulario--filas',
                cuerpo: html`
                  ${ui.seleccion({
                    nombre: 'dia_semana',
                    etiqueta: 'Día',
                    opciones: DIAS.map((d) => ({ valor: String(d.numero), texto: d.nombre })),
                    obligatorio: true,
                  })}
                  ${ui.campo({ nombre: 'desde', etiqueta: 'Desde', tipo: 'time', valor: '18:00', obligatorio: true })}
                  ${ui.campo({ nombre: 'hasta', etiqueta: 'Hasta', tipo: 'time', valor: '21:00', obligatorio: true })}
                  ${ui.campo({ nombre: 'nota', etiqueta: 'Nota', ayuda: 'Opcional: "solo en la liga", por ejemplo.' })}
                  <div style="align-self:end">${ui.boton('Agregar horario', { clase: 'boton boton--chico' })}</div>`,
              }),
            })}
            ${ui.detalleAbrible({
              titulo: 'Avisar que no estoy (vacaciones, viaje)',
              cuerpo: ui.formulario({
                accion: '/disponibilidad/ausencias',
                csrf,
                clase: 'formulario--filas',
                cuerpo: html`
                  ${ui.campo({ nombre: 'desde', etiqueta: 'Desde', tipo: 'date', obligatorio: true })}
                  ${ui.campo({ nombre: 'hasta', etiqueta: 'Hasta', tipo: 'date', obligatorio: true })}
                  ${ui.campo({ nombre: 'motivo', etiqueta: 'Motivo', ayuda: 'Opcional.' })}
                  <div style="align-self:end">${ui.boton('Guardar', { clase: 'boton boton--chico' })}</div>`,
              }),
            })}`
        : ''}`,
  });
}

