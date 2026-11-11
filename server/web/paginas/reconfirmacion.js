import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta, fechaHoraCorta, hoy } from '../../lib/fechas.js';

const FILTROS = [
  { clave: 'agestionar', texto: 'A gestionar hoy' },
  { clave: 'abiertas', texto: 'Abiertas' },
  { clave: 'cerradas', texto: 'Con resultado final' },
  { clave: 'todas', texto: 'Todas' },
];

export function renderCola({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.aviso(
      `Ventana prevista: ${fechaCorta(datos.ventana.inicio)} a ${fechaCorta(datos.ventana.fin)}. ${
        datos.dentroDeVentana
          ? 'Hoy estamos dentro de la ventana.'
          : 'Hoy estamos fuera de la ventana: registrar un contacto real exige motivo de excepción.'
      }`,
      { tono: datos.dentroDeVentana ? 'info' : 'aviso' },
    )}

    <div class="acciones-fila" style="margin-bottom:1rem">
      ${FILTROS.map((f) =>
        ui.enlace(`/reconfirmacion?filtro=${f.clave}`, f.texto, {
          clase: `boton boton--chico ${datos.filtro === f.clave ? '' : 'boton--secundario'}`,
        }),
      )}
    </div>

    ${ui.tarjeta({
      titulo: `${datos.fichas.length} ficha(s)`,
      subtitulo: 'Una ficha final por plan. Condicional y Sin respuesta siguen abiertas.',
      cuerpo:
        datos.fichas.length === 0
          ? ui.vacio('No hay fichas con este filtro.', 'Las fichas se abren desde el plan de cada club.')
          : html`<ul class="lista-limpia">
              ${datos.fichas.map(
                (r) => html`
                  <li class="item ${r.estado === 'Confirmado' ? 'item--exito' : r.estado === 'Condicional' || r.estado === 'Sin respuesta' ? 'item--aviso' : ''}">
                    <div class="fila-entre">
                      <span class="item__titulo">${ui.enlace(`/reconfirmacion/${r.id}`, r.club_nombre)}</span>
                      <span class="acciones-fila">
                        ${ui.estado(r.estado)}
                        ${r.validada_en ? ui.estado('validada', { tono: 'exito' }) : ''}
                        ${r.conflictos > 0 ? ui.estado('conflicto', { tono: 'alerta' }) : ''}
                      </span>
                    </div>
                    <span class="item__meta">
                      prevista ${fechaCorta(r.fecha_prevista)}
                      ${r.proximo_contacto ? html`· próximo contacto ${fechaCorta(r.proximo_contacto)}` : ''}
                      · responsable ${r.responsable_nombre || '—'}
                    </span>
                    <span class="item__meta">
                      cantidades finales: ${r.disciplinas_con_final} de ${r.disciplinas}
                      ${r.actas_validadas > 0 ? '· acta aprobada' : '· sin acta aprobada'}
                    </span>
                  </li>`,
              )}
            </ul>`,
    })}`;

  return pagina({
    titulo: 'Reconfirmación 2027',
    subtitulo: 'Enero-febrero: contacto, respuesta, cantidades finales y resultado.',
    ruta: '/reconfirmacion',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

/** Qué acta está reconfirmando esta ficha. Lo que el club confirma salió de ahí. */
function actaDeLaFicha(ficha) {
  if (!ficha.reunion_id) return null;
  return html`${ui.enlace(
    `/reuniones/${ficha.reunion_id}#acordado`,
    ficha.acta_inicio ? `Reunión del ${fechaCorta(ficha.acta_inicio)}` : 'Reunión sin fecha',
  )} ${ui.estado(`Acta: ${ficha.acta_estado}`, { tono: ficha.acta_estado === 'Validada' ? 'exito' : 'neutro' })}`;
}

/**
 * Volver a poner fecha. El club pide más tiempo, o no se lo pudo ubicar: se corre la
 * fecha sin registrar un contacto ni cambiar el estado, las veces que haga falta.
 */
function reprogramar({ csrf, ficha, ventana }) {
  return ui.detalleAbrible({
    titulo: 'Volver a poner fecha para reconfirmar',
    cuerpo: ui.formulario({
      accion: `/reconfirmacion/${ficha.id}/reprogramar`,
      csrf,
      version: ficha.version,
      clase: 'formulario--filas',
      cuerpo: html`
        ${ui.campo({
          nombre: 'fecha_prevista',
          etiqueta: 'Nueva fecha',
          tipo: 'date',
          obligatorio: true,
          valor: ficha.fecha_prevista,
          ayuda: `Ventana: ${fechaCorta(ventana.inicio)} a ${fechaCorta(ventana.fin)}.`,
        })}
        ${ui.campo({
          nombre: 'motivo',
          etiqueta: 'Por qué se corre',
          ayuda: 'Opcional, pero queda en el historial: sirve para ver cuántas veces se corrió y por qué.',
        })}
        ${ui.campo({
          nombre: 'motivo_excepcion',
          etiqueta: 'Motivo de excepción',
          valor: ficha.motivo_excepcion,
          ayuda: 'Solo si la nueva fecha queda fuera de la ventana.',
        })}
        <div style="align-self:end">${ui.boton('Reprogramar', { clase: 'boton boton--secundario boton--chico' })}</div>`,
    }),
  });
}

export function renderFicha({ usuario, csrf, avisos, datos }) {
  const { ficha, detalles, esDireccion, faltantes } = datos;
  const editable = !ficha.validada_en && ficha.plan_estado !== 'Cerrada' && ficha.plan_estado !== 'Archivada';
  const fueraDeVentana = ficha.fecha_contacto && (ficha.fecha_contacto < datos.ventana.inicio || ficha.fecha_contacto > datos.ventana.fin);

  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Ficha de reconfirmación',
      tono: 'acento',
      subtitulo: html`${ui.enlace(`/clubes/${ficha.club_id}`, ficha.club_nombre)} · plan ${ficha.anio_objetivo}`,
      acciones: html`${ui.estado(ficha.estado)}${ficha.validada_en ? ui.estado('validada', { tono: 'exito' }) : ''}`,
      cuerpo: html`
        ${ui.listaDatos(html`
          ${ui.dato('Reconfirma el acta', actaDeLaFicha(ficha))}
          ${ui.dato('Fecha para reconfirmar', ui.fecha(ficha.fecha_prevista, { largo: true }), {
            ayuda:
              ficha.acta_fecha_recontacto && ficha.acta_fecha_recontacto !== ficha.fecha_prevista
                ? `El acta había fijado el ${fechaCorta(ficha.acta_fecha_recontacto)}; se reprogramó.`
                : ficha.acta_fecha_recontacto
                  ? 'La fijó el acta de la reunión.'
                  : null,
          })}
          ${ui.dato('Responsable', ficha.responsable_nombre)}
          ${ui.dato('Último contacto', ficha.fecha_contacto ? ui.fecha(ficha.fecha_contacto) : null)}
          ${ui.dato('Canal', ficha.canal)}
          ${ui.dato('Interlocutor', ficha.interlocutor)}
          ${ui.dato('Próximo contacto', ficha.proximo_contacto ? ui.fecha(ficha.proximo_contacto) : null)}
        `)}
        ${editable ? reprogramar({ csrf, ficha, ventana: datos.ventana }) : ''}
        ${ficha.respuesta_club ? ui.aviso(ficha.respuesta_club, { tono: 'info', titulo: 'Respuesta del club' }) : ''}
        ${ficha.condiciones ? ui.aviso(ficha.condiciones, { tono: 'aviso', titulo: 'Condiciones planteadas' }) : ''}
        ${ficha.motivo_excepcion ? ui.aviso(ficha.motivo_excepcion, { tono: 'aviso', titulo: 'Motivo de excepción registrado' }) : ''}
        ${fueraDeVentana ? ui.aviso('El contacto registrado quedó fuera de la ventana de reconfirmación.', { tono: 'aviso' }) : ''}
        ${ficha.evidencia_url ? html`<p>${ui.enlace(ficha.evidencia_url, 'Abrir evidencia')}</p>` : ''}
        ${ficha.validada_en
          ? ui.aviso(
              `Resultado ${ficha.estado}, validado por ${ficha.validada_por_nombre || '—'} el ${fechaHoraCorta(ficha.validada_en)}. La ficha y las cantidades finales están bloqueadas.`,
              { tono: ficha.estado === 'Confirmado' ? 'exito' : 'alerta' },
            )
          : ''}
        ${ficha.estado === 'Sin respuesta'
          ? ui.aviso('Sin respuesta mantiene el caso abierto: no es una baja.', { tono: 'info' })
          : ''}
        ${ficha.estado === 'Condicional'
          ? ui.aviso('Una respuesta condicional no es una confirmación: no suma al total confirmado.', { tono: 'info' })
          : ''}`,
    })}

    ${ui.tarjeta({
      titulo: 'Qué tiene que confirmar el club',
      subtitulo: 'Lo acordado es lo que dice el acta; Final es lo que el club terminó confirmando. Vacío significa que todavía no se sabe.',
      cuerpo: html`
        ${ui.tabla({
          clase: 'tabla--numeros comparacion',
          columnas: ['Disciplina', 'Lo acordado en el acta', 'Final'],
          filas: detalles.map((d) => [
            html`<strong>${d.disciplina}</strong>`,
            d.acordado_texto
              ? html`<span class="texto-largo">${d.acordado_texto}</span>`
              : html`<span class="sin-dato">no se acordó nada</span>`,
            ui.cantidad(d.tiras_reconfirmadas),
          ]),
          vacioTexto: 'El plan no tiene disciplinas cargadas.',
        })}
        ${ui.enlace(`/clubes/${ficha.club_id}#tiras`, 'Editar cantidades en la ficha del club', {
          clase: 'boton boton--secundario boton--chico',
        })}`,
    })}

    ${editable && esDireccion
      ? html`
          ${ui.tarjeta({
            titulo: 'Registrar gestión',
            subtitulo: 'Cada contacto queda registrado. Ninguno de estos estados cierra el caso.',
            cuerpo: html`
              ${ui.detalleAbrible({
                titulo: 'Registrar contacto realizado',
                abierto: ficha.estado === 'Pendiente',
                cuerpo: formularioSeguimiento({ csrf, ficha, accion: 'contacto', textoBoton: 'Registrar contacto' }),
              })}
              ${ui.detalleAbrible({
                titulo: 'Registrar respuesta condicional',
                cuerpo: formularioSeguimiento({
                  csrf,
                  ficha,
                  accion: 'condicional',
                  textoBoton: 'Registrar condicional',
                  exigeCondiciones: true,
                }),
              })}
              ${ui.detalleAbrible({
                titulo: 'Registrar intento sin respuesta',
                cuerpo: formularioSeguimiento({
                  csrf,
                  ficha,
                  accion: 'sin-respuesta',
                  textoBoton: 'Registrar sin respuesta',
                  sinInterlocutor: true,
                }),
              })}`,
          })}

          ${ui.tarjeta({
            titulo: 'Resultado final',
            subtitulo: 'Una sola operación registra el resultado y su sello de aprobación.',
            cuerpo: html`
              ${faltantes.length > 0
                ? ui.aviso('', { tono: 'aviso', titulo: 'Falta para poder confirmar', lista: faltantes })
                : ui.aviso('Están las condiciones para confirmar.', { tono: 'exito' })}
              ${ui.detalleAbrible({
                titulo: 'Confirmar continuidad 2027',
                cuerpo: formularioResultado({ csrf, ficha, resultado: 'Confirmado', textoBoton: 'Confirmar continuidad' }),
              })}
              ${ui.detalleAbrible({
                titulo: 'Registrar que no continúa',
                cuerpo: formularioResultado({ csrf, ficha, resultado: 'No continua', textoBoton: 'Registrar no continuidad' }),
              })}`,
          })}`
      : ''}

    ${ficha.validada_en && esDireccion
      ? ui.tarjeta({
          titulo: 'Reapertura',
          subtitulo: 'Dirección, con motivo. Queda copia íntegra de lo aprobado en el historial.',
          cuerpo: ui.formulario({
            accion: `/reconfirmacion/${ficha.id}/reabrir`,
            csrf,
            confirmar: 'Se guardará copia del resultado aprobado y de las cantidades finales. ¿Confirmás?',
            cuerpo: html`
              ${ficha.plan_estado === 'Cerrada' || ficha.plan_estado === 'Archivada'
                ? ui.aviso('Primero hay que reabrir el plan. Después se reabre la reconfirmación.', { tono: 'alerta' })
                : ''}
              ${ui.area({ nombre: 'motivo', etiqueta: 'Motivo de la reapertura', obligatorio: true, filas: 2 })}
              ${ui.boton('Reabrir reconfirmación', { clase: 'boton boton--peligro boton--chico' })}`,
          }),
        })
      : ''}

    ${ui.tarjeta({
      titulo: 'Historial de la ficha',
      cuerpo:
        datos.historial.length === 0
          ? ui.vacio('Todavía no hay eventos.')
          : ui.tabla({
              clase: 'tabla--compacta',
              columnas: ['Cuándo', 'Evento', 'Quién', 'Motivo'],
              filas: datos.historial.map((h) => [
                ui.fechaHora(h.ocurrido_en),
                html`${h.tipo}${h.estado_anterior ? html`<br><span class="menor">${h.estado_anterior} → ${h.estado_posterior || '—'}</span>` : ''}`,
                h.actor_nombre || '—',
                h.motivo || '—',
              ]),
            }),
    })}`;

  return pagina({
    titulo: `Reconfirmación · ${ficha.club_nombre}`,
    ruta: '/reconfirmacion',
    usuario,
    csrf,
    avisos,
    contenido,
    acciones: ui.enlace('/reconfirmacion', 'Volver a la cola', { clase: 'boton boton--texto' }),
  });
}

function formularioSeguimiento({ csrf, ficha, accion, textoBoton, exigeCondiciones = false, sinInterlocutor = false }) {
  return ui.formulario({
    accion: `/reconfirmacion/${ficha.id}/${accion}`,
    csrf,
    version: ficha.version,
    clase: 'formulario--filas',
    cuerpo: html`
      ${ui.campo({
        nombre: 'fecha_contacto',
        etiqueta: 'Fecha del contacto',
        tipo: 'date',
        valor: ficha.fecha_contacto || hoy(),
        obligatorio: true,
        ayuda: 'No puede ser futura.',
      })}
      ${ui.seleccion({
        nombre: 'canal',
        etiqueta: 'Canal',
        valor: ficha.canal || 'Telefono',
        opciones: ['Telefono', 'WhatsApp', 'Email', 'Presencial'].map((c) => ({ valor: c, texto: c === 'Telefono' ? 'Teléfono' : c })),
        obligatorio: true,
      })}
      ${ui.campo({
        nombre: 'interlocutor',
        etiqueta: 'Con quién se habló',
        valor: ficha.interlocutor,
        obligatorio: !sinInterlocutor,
        ayuda: sinInterlocutor ? 'Opcional cuando no hubo respuesta.' : null,
      })}
      ${ui.campo({
        nombre: 'proximo_contacto',
        etiqueta: 'Próximo contacto',
        tipo: 'date',
        valor: ficha.proximo_contacto,
        obligatorio: true,
        ayuda: 'El caso sigue abierto: hay que fijar la próxima gestión.',
      })}
      ${ui.area({ nombre: 'respuesta_club', etiqueta: 'Qué dijo el club', valor: ficha.respuesta_club, filas: 2 })}
      ${exigeCondiciones
        ? ui.area({ nombre: 'condiciones', etiqueta: 'Condiciones planteadas', valor: ficha.condiciones, obligatorio: true, filas: 2 })
        : ''}
      ${ui.campo({ nombre: 'evidencia_url', etiqueta: 'Evidencia (enlace)', valor: ficha.evidencia_url })}
      ${ui.campo({
        nombre: 'motivo_excepcion',
        etiqueta: 'Motivo de excepción',
        valor: ficha.motivo_excepcion,
        ayuda: 'Solo si el contacto quedó fuera de la ventana.',
      })}
      <div style="align-self:end">${ui.boton(textoBoton, { clase: 'boton boton--chico' })}</div>`,
  });
}

function formularioResultado({ csrf, ficha, resultado, textoBoton }) {
  return ui.formulario({
    accion: `/reconfirmacion/${ficha.id}/${resultado === 'Confirmado' ? 'confirmar' : 'no-continua'}`,
    csrf,
    version: ficha.version,
    confirmar:
      resultado === 'Confirmado'
        ? 'Confirmar deja la ficha y las cantidades finales bloqueadas. ¿Confirmás?'
        : 'Registrar que el club no continúa deja la ficha bloqueada. ¿Confirmás?',
    cuerpo: html`
      ${ui.campo({
        nombre: 'fecha_contacto',
        etiqueta: 'Fecha del contacto',
        tipo: 'date',
        valor: ficha.fecha_contacto || hoy(),
        obligatorio: true,
      })}
      ${ui.seleccion({
        nombre: 'canal',
        etiqueta: 'Canal',
        valor: ficha.canal || 'Telefono',
        opciones: ['Telefono', 'WhatsApp', 'Email', 'Presencial'].map((c) => ({ valor: c, texto: c === 'Telefono' ? 'Teléfono' : c })),
        obligatorio: true,
      })}
      ${ui.campo({ nombre: 'interlocutor', etiqueta: 'Con quién se habló', valor: ficha.interlocutor, obligatorio: true })}
      ${ui.area({
        nombre: 'respuesta_club',
        etiqueta: 'Respuesta del club',
        valor: ficha.respuesta_club,
        obligatorio: true,
        filas: 3,
        ayuda: resultado === 'No continua' ? 'Qué dijo el club al no continuar.' : null,
      })}
      ${ui.campo({
        nombre: 'evidencia_url',
        etiqueta: 'Evidencia (enlace)',
        valor: ficha.evidencia_url,
        obligatorio: true,
        ayuda: 'Acta, correo o archivo que respalde la respuesta.',
      })}
      ${ui.campo({ nombre: 'motivo_excepcion', etiqueta: 'Motivo de excepción', valor: ficha.motivo_excepcion })}
      ${ui.boton(textoBoton, { clase: 'boton boton--chico' })}`,
  });
}
