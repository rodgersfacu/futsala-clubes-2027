import { html, parrafos } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta, fechaHoraCorta } from '../../lib/fechas.js';
import { nombreDia } from '../../dominio/disponibilidad.js';

export function render({ usuario, csrf, avisos, datos }) {
  const { reunion, compromisos, puedeEditarActa, esDireccion, superposiciones, disciplinas } = datos;
  const planAbierto = reunion.plan_estado !== 'Cerrada' && reunion.plan_estado !== 'Archivada';
  const actaBloqueada = reunion.acta_estado === 'Validada';
  const puedeAgendar = datos.puedeAgendar;

  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Reunión',
      tono: reunion.modalidad === 'En el club' ? 'visita' : 'acento',
      subtitulo: html`${ui.enlace(`/clubes/${reunion.club_id}`, reunion.club_nombre)} · plan ${reunion.anio_objetivo}`,
      acciones: html`
        ${ui.estado(reunion.estado)}
        ${ui.estado(`Acta: ${reunion.acta_estado}`, {
          tono: actaBloqueada ? 'exito' : reunion.acta_estado === 'Para revisar' ? 'aviso' : 'neutro',
        })}
        ${ui.enlace(`/clubes/${reunion.club_id}/imprimir`, 'Imprimir / PDF', {
          clase: 'boton boton--secundario boton--chico',
        })}`,
      cuerpo: html`
        ${ui.listaDatos(html`
          ${ui.dato('Inicio', ui.fechaHora(reunion.inicio))}
          ${ui.dato('Fin', ui.fechaHora(reunion.fin))}
          ${ui.dato(
            'Dónde',
            html`${ui.etiquetaModalidad(reunion.modalidad)}${reunion.lugar ? html` ${reunion.lugar}` : ''}`,
            {
              ayuda:
                reunion.modalidad === 'En el club'
                  ? 'Hay que viajar: la reunión reserva tres horas.'
                  : null,
            },
          )}
          ${ui.dato(
            'La tiene',
            html`${reunion.director1_nombre || '—'}${reunion.director2_nombre ? html` y ${reunion.director2_nombre}` : ''}`,
          )}
          ${ui.dato('Toma nota', reunion.acta_responsable_nombre)}
        `)}
        ${reunion.estado === 'Cancelada'
          ? ui.aviso(reunion.motivo_cancelacion, { tono: 'alerta', titulo: 'Reunión cancelada' })
          : ''}
        ${datos.avisoDisponibilidad
          ? ui.aviso(datos.avisoDisponibilidad, {
              tono: 'aviso',
              titulo: 'Fuera de los horarios cargados (no bloquea)',
            })
          : ''}
        ${superposiciones.length > 0
          ? ui.aviso('', {
              tono: 'aviso',
              titulo: 'Aviso de superposición de agenda (no bloquea)',
              lista: superposiciones.map(
                (o) => `${o.club_nombre}: ${fechaHoraCorta(o.inicio)} a ${fechaHoraCorta(o.fin)} (${o.estado})`,
              ),
            })
          : ''}
        ${!planAbierto ? ui.aviso('El plan está cerrado: la reunión queda como registro.', { tono: 'info' }) : ''}
        ${puedeAgendar && planAbierto ? accionesReunion({ csrf, reunion }) : ''}`,
    })}

    ${tarjetaNota({ csrf, reunion, puedeEscribir: puedeAgendar, planAbierto })}

    ${puedeAgendar && planAbierto && reunion.estado !== 'Cancelada' && !actaBloqueada
      ? ui.tarjeta({
          titulo: 'Editar agenda',
          subtitulo: 'Horario, dónde se hace, quién la tiene y quién toma nota.',
          cuerpo: ui.formulario({
            accion: `/reuniones/${reunion.id}/agenda`,
            csrf,
            version: reunion.version,
            clase: 'formulario--filas',
            cuerpo: html`
              ${ui.fechaElegible({
                nombre: 'fecha',
                etiqueta: 'Fecha',
                valor: (reunion.inicio || '').slice(0, 10),
                anios: datos.aniosAgenda,
              })}
              ${ui.hora({
                nombre: 'hora',
                etiqueta: 'Hora de inicio',
                valor: (reunion.inicio || '18:00').slice(11, 16) || '18:00',
                ayuda: 'De 08 a 22.',
              })}
              ${ui.seleccion({
                nombre: 'modalidad',
                etiqueta: 'Dónde',
                valor: reunion.modalidad,
                opciones: ui.OPCIONES_MODALIDAD,
                ayuda: 'El fin se calcula solo: 45 minutos en la liga, 3 horas si vamos al club.',
              })}
              ${ui.campo({
                nombre: 'lugar',
                etiqueta: 'Dirección del club',
                valor: reunion.lugar,
                ayuda: 'Solo si la reunión es en el club.',
              })}
              ${ui.seleccion({
                nombre: 'director1_id',
                etiqueta: 'Quién la tiene',
                valor: reunion.director1_id || '',
                opciones: ui.opcionesUsuarios(datos.directoresActivos),
                ayuda:
                  datos.franjasDirector.length > 0
                    ? `Atiende ${datos.franjasDirector
                        .map((f) => `${nombreDia(f.dia_semana).toLowerCase()} ${f.desde}–${f.hasta}`)
                        .join(', ')}`
                    : 'Sin horarios cargados todavía.',
              })}
              ${ui.seleccion({
                nombre: 'director2_id',
                etiqueta: 'Acompaña (opcional)',
                valor: reunion.director2_id || '',
                opciones: ui.opcionesUsuarios(datos.directoresActivos),
              })}
              ${ui.seleccion({
                nombre: 'acta_responsable_id',
                etiqueta: 'Quién toma nota',
                valor: reunion.acta_responsable_id || '',
                opciones: ui.opcionesUsuarios(datos.usuariosActivos.filter((u) => u.rol !== 'Consulta')),
              })}
              <div style="align-self:end">${ui.boton('Guardar agenda', { clase: 'boton boton--chico' })}</div>`,
          }),
        })
      : ''}

    ${ui.tarjeta({
      titulo: 'Acta',
      id: 'acta',
      subtitulo: actaBloqueada
        ? `Aprobada por ${reunion.validada_por_nombre || '—'} el ${fechaHoraCorta(reunion.acta_validada_en)}.`
        : 'Lo que se conversó, la devolución del club y lo que sigue.',
      acciones: ui.estado(reunion.acta_estado, {
        tono: actaBloqueada ? 'exito' : reunion.acta_estado === 'Para revisar' ? 'aviso' : 'neutro',
      }),
      cuerpo: html`
        ${reunion.motivo_devolucion && reunion.acta_estado === 'Borrador'
          ? ui.aviso(reunion.motivo_devolucion, { tono: 'aviso', titulo: 'Dirección devolvió el acta con este motivo' })
          : ''}
        ${actaBloqueada
          ? ui.aviso('El contenido del acta está bloqueado. Dirección puede reabrirla con motivo; queda copia en el historial.', { tono: 'exito' })
          : ''}
        ${puedeEditarActa
          ? ui.formulario({
              accion: `/reuniones/${reunion.id}/acta`,
              csrf,
              version: reunion.version,
              cuerpo: html`
                ${ui.area({
                  nombre: 'delegados_presentes',
                  etiqueta: 'Quiénes participaron',
                  valor: reunion.delegados_presentes,
                  filas: 2,
                  placeholder: 'Personas del club y de FUTSALA presentes.',
                })}
                ${ui.area({
                  nombre: 'acta',
                  etiqueta: 'Acta de la reunión',
                  valor: reunion.acta,
                  filas: 7,
                  placeholder: 'Temas tratados y acuerdos alcanzados.',
                })}
                ${ui.area({
                  nombre: 'devolucion_club',
                  etiqueta: 'Devolución del club',
                  valor: reunion.devolucion_club,
                  filas: 4,
                  ayuda: 'Lo que dijo el club, en sus términos.',
                })}
                ${ui.area({ nombre: 'proximo_paso', etiqueta: 'Próximo paso', valor: reunion.proximo_paso, filas: 2 })}
                ${ui.campo({
                  nombre: 'fecha_recontacto',
                  etiqueta: 'Cuándo reconfirmamos',
                  tipo: 'date',
                  valor: reunion.fecha_recontacto,
                  ayuda: 'La fecha en que se vuelve a hablar para que el club confirme. Con esta fecha arranca la ficha de reconfirmación.',
                })}
                ${acordado({ reunion, disciplinas, editable: true })}
                ${ui.boton('Guardar acta', { clase: 'boton' })}`,
            })
          : html`
              ${ui.listaDatos(html`
                ${ui.dato('Participantes', parrafos(reunion.delegados_presentes))}
                ${ui.dato('Acta', parrafos(reunion.acta))}
                ${ui.dato('Devolución del club', parrafos(reunion.devolucion_club))}
                ${ui.dato('Próximo paso', parrafos(reunion.proximo_paso))}
                ${ui.dato('Cuándo reconfirmamos', ui.fecha(reunion.fecha_recontacto))}
              `)}
              ${acordado({ reunion, disciplinas, editable: false })}`}
        ${actaBloqueada && !reunion.fecha_recontacto
          ? ui.aviso(
              'Esta acta no dejó fecha para reconfirmar. La ficha de reconfirmación va a pedir una a mano.',
              { tono: 'aviso' },
            )
          : ''}
        ${planAbierto ? accionesActa({ csrf, reunion, usuario, puedeEditarActa, esDireccion }) : ''}`,
    })}

    ${ui.tarjeta({
      titulo: `Compromisos de la reunión (${compromisos.length})`,
      id: 'compromisos',
      subtitulo: 'Cada tarea con su responsable interno y su vencimiento.',
      cuerpo: html`
        ${compromisos.length === 0
          ? ui.vacio('Todavía no hay compromisos de esta reunión.')
          : ui.tabla({
              clase: 'tabla--compacta',
              columnas: ['Compromiso', 'Parte', 'Responsable', 'Vence', 'Estado'],
              filas: compromisos.map((t) => [
                html`${t.descripcion}${t.resolucion ? html`<br><span class="menor">Resolución: ${t.resolucion}</span>` : ''}`,
                t.parte_responsable === 'Club' ? html`Club · ${t.contacto_club}` : 'FUTSALA',
                t.responsable_nombre,
                ui.fecha(t.fecha_limite),
                t.vencido ? ui.estado('Vencida', { tono: 'alerta' }) : ui.estado(t.estado),
              ]),
            })}
        ${datos.puedeCrearCompromisos && planAbierto
          ? html`
              <div class="separador"></div>
              ${ui.detalleAbrible({
                titulo: 'Agregar compromiso',
                cuerpo: ui.formulario({
                  accion: `/reuniones/${reunion.id}/compromisos`,
                  csrf,
                  clase: 'formulario--filas',
                  cuerpo: html`
                    ${ui.campo({ nombre: 'descripcion', etiqueta: 'Qué hay que hacer', obligatorio: true })}
                    ${ui.seleccion({
                      nombre: 'parte_responsable',
                      etiqueta: 'Parte responsable',
                      valor: 'FUTSALA',
                      opciones: [
                        { valor: 'FUTSALA', texto: 'FUTSALA' },
                        { valor: 'Club', texto: 'Club' },
                      ],
                    })}
                    ${ui.campo({
                      nombre: 'contacto_club',
                      etiqueta: 'Con quién se gestiona en el club',
                      ayuda: 'Obligatorio si la parte responsable es el club.',
                    })}
                    ${esDireccion
                      ? ui.seleccion({
                          nombre: 'responsable_id',
                          etiqueta: 'Responsable interno',
                          opciones: ui.opcionesUsuarios(datos.usuariosActivos.filter((u) => u.rol !== 'Consulta'), { incluirVacio: false }),
                          obligatorio: true,
                        })
                      : ui.campo({
                          nombre: 'responsable_nombre_fijo',
                          etiqueta: 'Responsable interno',
                          valor: usuario.nombre,
                          bloqueado: 'Un ayudante solo se asigna tareas a sí mismo.',
                        })}
                    ${ui.campo({ nombre: 'fecha_limite', etiqueta: 'Vence', tipo: 'date', obligatorio: true })}
                    <div style="align-self:end">${ui.boton('Agregar compromiso', { clase: 'boton boton--chico' })}</div>`,
                }),
              })}`
          : ''}`,
    })}`;

  return pagina({
    titulo: reunion.inicio ? `Reunión del ${fechaCorta(reunion.inicio)}` : 'Reunión sin fecha',
    subtitulo: reunion.club_nombre,
    ruta: '/agenda',
    usuario,
    csrf,
    avisos,
    contenido,
    acciones: ui.enlace(`/clubes/${reunion.club_id}`, 'Volver a la ficha del club', { clase: 'boton boton--texto' }),
  });
}

/**
 * Observaciones de esta reunión: lo que convenga tener a mano antes y lo que quede por
 * anotar después. No es el acta, así que sigue escribiéndose aunque el acta esté
 * aprobada; lo único que la cierra es el cierre del plan.
 */
function tarjetaNota({ csrf, reunion, puedeEscribir, planAbierto }) {
  if (!puedeEscribir || !planAbierto) {
    if (!reunion.nota) return '';
    return ui.tarjeta({
      titulo: 'Observaciones',
      cuerpo: html`<div class="texto-largo">${reunion.nota}</div>`,
    });
  }
  return ui.tarjeta({
    titulo: 'Observaciones',
    id: 'nota',
    subtitulo: 'Para anotar lo que haga falta. No es el acta: se puede corregir siempre.',
    cuerpo: ui.formulario({
      accion: `/reuniones/${reunion.id}/nota`,
      csrf,
      cuerpo: html`
        ${ui.area({
          nombre: 'nota',
          etiqueta: 'Observaciones de esta reunión',
          valor: reunion.nota,
          filas: 3,
          placeholder: 'A qué hora les queda bien, qué conviene llevar, con quién hablar, qué quedó dando vueltas.',
        })}
        ${ui.boton('Guardar observaciones', { clase: 'boton' })}`,
    }),
  });
}

/**
 * Lo que se acordó, disciplina por disciplina, dentro del acta.
 *
 * Va acá y no en un cuadro aparte porque es parte del acta: se escribe de una sola vez y
 * se guarda con el mismo botón. Cada fila tiene la conversación entera: lo que el club
 * tuvo en 2026, lo que le íbamos a plantear, y lo que quedó.
 *
 * No hay cantidades de tiras. Lo acordado se escribe en palabras ("mantiene Liga de
 * Honor B", "baja Femenino", "lo define en diciembre"), que es como se acuerda de
 * verdad; el número, si alguna vez hay uno, lo confirma el club en la reconfirmación.
 */
function acordado({ reunion, disciplinas, editable }) {
  const deOtraActa = (d) => d.reunion_acuerdo_id && d.reunion_acuerdo_id !== reunion.id;

  const celda = (d) => {
    if (deOtraActa(d)) {
      return html`<span class="texto-largo">${d.acordado_texto ?? ''}</span>
        <span class="menor">🔒 lo acordó el acta del ${fechaCorta(d.acuerdo_inicio)}</span>`;
    }
    if (editable) {
      return ui.entradaArea({
        nombre: `acordado_${d.id}`,
        valor: d.acordado_texto,
        etiqueta: `Lo acordado en ${d.disciplina}`,
        placeholder: 'Mantiene, baja, lo define en diciembre…',
      });
    }
    return d.acordado_texto
      ? html`<span class="texto-largo">${d.acordado_texto}</span>`
      : html`<span class="sin-dato">sin cargar</span>`;
  };

  return html`
    <div class="separador"></div>
    <h3>Lo que se acordó</h3>
    <p class="menor">
      Una fila por disciplina, con lo de 2026 y lo que le planteamos al lado. Se escribe en
      palabras: acá no se cargan cantidades de tiras.
    </p>
    ${ui.tabla({
      clase: 'comparacion acordado',
      columnas: ['Disciplina', 'Tuvo en 2026', 'Le planteamos', 'Lo acordado en esta reunión'],
      filas: disciplinas.map((d) => [
        html`<strong>${d.disciplina}</strong>`,
        d.divisiones_2026 ? html`<span class="texto-largo">${d.divisiones_2026}</span>` : '',
        d.intencion_2027 ? html`<span class="texto-largo">${d.intencion_2027}</span>` : '',
        celda(d),
      ]),
      vacioTexto: 'El plan todavía no tiene disciplinas cargadas.',
    })}
    ${editable
      ? html`<p class="menor">
          Una disciplina que quede en blanco es una de la que no se habló: no se cuenta como
          acuerdo y no traba la aprobación del acta.
        </p>`
      : ''}`;
}

function accionesReunion({ csrf, reunion }) {
  return html`
    <div class="separador"></div>
    <div class="acciones-fila">
      ${reunion.estado === 'Borrador'
        ? ui.formulario({
            accion: `/reuniones/${reunion.id}/programar`,
            csrf,
            clase: 'en-linea',
            cuerpo: ui.boton('Programar', { clase: 'boton boton--chico' }),
          })
        : ''}
      ${reunion.estado === 'Programada'
        ? ui.formulario({
            accion: `/reuniones/${reunion.id}/realizada`,
            csrf,
            clase: 'en-linea',
            cuerpo: ui.boton('Marcar como realizada', { clase: 'boton boton--chico' }),
          })
        : ''}
      ${reunion.estado !== 'Cancelada' && reunion.acta_estado !== 'Validada'
        ? ui.detalleAbrible({
            titulo: 'Cancelar la reunión',
            cuerpo: ui.formulario({
              accion: `/reuniones/${reunion.id}/cancelar`,
              csrf,
              confirmar: 'La reunión cancelada se conserva como registro. ¿Confirmás?',
              cuerpo: html`
                ${ui.area({ nombre: 'motivo', etiqueta: 'Motivo de la cancelación', obligatorio: true, filas: 2 })}
                ${ui.boton('Cancelar reunión', { clase: 'boton boton--peligro boton--chico' })}`,
            }),
          })
        : ''}
    </div>`;
}

function accionesActa({ csrf, reunion, puedeEditarActa, esDireccion }) {
  return html`
    <div class="separador"></div>
    <div class="acciones-fila">
      ${reunion.acta_estado === 'Borrador' && puedeEditarActa
        ? ui.formulario({
            accion: `/reuniones/${reunion.id}/acta/enviar`,
            csrf,
            clase: 'en-linea',
            cuerpo: ui.boton('Enviar a revisión', { clase: 'boton boton--chico' }),
          })
        : ''}
      ${reunion.acta_estado === 'Para revisar' && esDireccion
        ? html`
            ${ui.formulario({
              accion: `/reuniones/${reunion.id}/acta/aprobar`,
              csrf,
              clase: 'en-linea',
              confirmar: 'Aprobar el acta bloquea su contenido y lo acordado que respalda. ¿Confirmás?',
              cuerpo: ui.boton('Aprobar acta', { clase: 'boton boton--chico' }),
            })}
            ${ui.detalleAbrible({
              titulo: 'Devolver para corregir',
              cuerpo: ui.formulario({
                accion: `/reuniones/${reunion.id}/acta/devolver`,
                csrf,
                cuerpo: html`
                  ${ui.area({
                    nombre: 'motivo',
                    etiqueta: 'Qué hay que corregir',
                    obligatorio: true,
                    filas: 2,
                    ayuda: 'Cada devolución necesita una explicación nueva. La ve quien tomó el acta.',
                  })}
                  ${ui.boton('Devolver acta', { clase: 'boton boton--secundario boton--chico' })}`,
              }),
            })}`
        : ''}
      ${reunion.acta_estado === 'Validada' && esDireccion
        ? ui.detalleAbrible({
            titulo: 'Reabrir el acta aprobada (con motivo)',
            cuerpo: ui.formulario({
              accion: `/reuniones/${reunion.id}/acta/reabrir`,
              csrf,
              confirmar: 'Se guarda copia íntegra del acta aprobada y de lo acordado que respalda. ¿Confirmás?',
              cuerpo: html`
                ${ui.aviso(
                  'Orden para corregir un caso cerrado: primero el plan, después la reconfirmación y por último el acta.',
                  { tono: 'aviso' },
                )}
                ${ui.area({ nombre: 'motivo', etiqueta: 'Motivo de la reapertura', obligatorio: true, filas: 2 })}
                ${ui.boton('Reabrir acta', { clase: 'boton boton--peligro boton--chico' })}`,
            }),
          })
        : ''}
    </div>`;
}
