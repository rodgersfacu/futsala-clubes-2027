import { html, parrafos } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta, fechaHoraCorta } from '../../lib/fechas.js';

export function render({ usuario, csrf, avisos, datos }) {
  const { club, plan } = datos;
  const esDireccion = usuario && usuario.rol === 'Direccion' && usuario.activo === 1;
  const puedeEscribir = usuario && usuario.activo === 1 && usuario.rol !== 'Consulta';

  const contenido = plan
    ? conPlan({ usuario, csrf, datos, esDireccion, puedeEscribir })
    : sinPlan({ csrf, datos, esDireccion });

  return pagina({
    titulo: club.nombre,
    subtitulo: `${club.localidad || 'Sin localidad'} · responsable ${club.responsable_nombre || 'sin asignar'}`,
    ruta: '/clubes',
    usuario,
    csrf,
    avisos,
    contenido,
    acciones: ui.enlace('/clubes', 'Volver a clubes', { clase: 'boton boton--texto' }),
  });
}

function sinPlan({ csrf, datos, esDireccion }) {
  return html`
    ${ui.aviso('Este club todavía no tiene plan del ciclo 2026/2027.', {
      tono: 'aviso',
      titulo: 'Próximo paso',
    })}
    ${datosDelClub({ csrf, datos, esDireccion })}
    ${esDireccion
      ? ui.tarjeta({
          titulo: 'Crear el plan del ciclo 2026/2027',
          subtitulo: 'Un plan por club y ciclo. El club y los años quedan fijos después del alta.',
          cuerpo: ui.formulario({
            accion: `/clubes/${datos.club.id}/plan`,
            csrf,
            clase: 'formulario--filas',
            cuerpo: html`
              ${ui.seleccion({
                nombre: 'prioridad',
                etiqueta: 'Prioridad',
                valor: '2',
                opciones: ui.OPCIONES_PRIORIDAD,
              })}
              ${ui.seleccion({
                nombre: 'responsable_id',
                etiqueta: 'Responsable del plan',
                valor: datos.club.responsable_id || '',
                opciones: ui.opcionesUsuarios(datos.usuariosActivos),
              })}
              ${ui.campo({ nombre: 'fecha_objetivo', etiqueta: 'Fecha objetivo', tipo: 'date' })}
              <div style="align-self:end">${ui.boton('Crear plan 2026/2027')}</div>`,
          }),
        })
      : ''}
    ${tarjetaHistorial(datos.historial)}`;
}

function conPlan({ usuario, csrf, datos, esDireccion, puedeEscribir }) {
  const { club, plan, detalles, reuniones, compromisos, reconfirmacion, bloqueos, proximoPaso } = datos;

  return html`
    ${club.contacto_directo === 1
      ? ui.aviso(
          'A este club lo contactan los directivos. Los ayudantes no lo llaman ni le agendan reuniones.',
          { tono: 'aviso', titulo: '★ Contacto de Dirección' },
        )
      : ''}
    ${ui.tarjeta({
      titulo: 'Estado del ciclo',
      tono: 'acento',
      subtitulo: `Plan ${plan.anio_cierre}/${plan.anio_objetivo} · creado ${fechaHoraCorta(plan.creado_en)}`,
      acciones: html`
        ${ui.estado(plan.estado)}
        ${ui.etiquetaPrioridad(club.prioridad)}
        ${ui.enlace(`/clubes/${club.id}/imprimir`, 'Imprimir / PDF', {
          clase: 'boton boton--secundario boton--chico',
        })}`,
      cuerpo: html`
        ${ui.barraProgreso(etapas(datos))}
        <div class="separador"></div>
        ${ui.aviso(proximoPaso.texto, { tono: 'info', titulo: 'Próximo paso' })}
        ${datos.conflictos.some((k) => k.estado === 'Abierto')
          ? ui.aviso(
              'Hay un conflicto de datos duplicados en este plan. Confirmar y cerrar están bloqueados hasta resolverlo.',
              { tono: 'alerta', titulo: 'Conflicto de datos', lista: datos.conflictos.filter((k) => k.estado === 'Abierto').map((k) => k.detalle) },
            )
          : ''}
        ${datos.faltantesParaCerrar.length > 0
          ? ui.aviso('', { tono: 'aviso', titulo: 'Falta para cerrar el año con este club', lista: datos.faltantesParaCerrar })
          : ui.aviso('Están todas las condiciones para cerrar.', { tono: 'exito' })}
        ${esDireccion ? accionesDelPlan({ csrf, plan, datos }) : ''}`,
    })}

    ${tarjetaReuniones({ csrf, datos, puedeEscribir, usuario })}

    ${tarjetaTiras({ csrf, datos, esDireccion })}

    ${tarjetaReconfirmacion({ csrf, datos, esDireccion, puedeEscribir })}

    ${tarjetaCompromisos({ datos })}

    ${datosDelClub({ csrf, datos, esDireccion })}

    ${tarjetaHistorial(datos.historial)}`;
}

/** Los pasos del circuito, en el orden en que pasan de verdad. */
function etapas(datos) {
  const { plan, detalles, reuniones, reconfirmacion } = datos;
  const vivas = reuniones.filter((m) => m.estado !== 'Cancelada');

  const pasos = [
    { texto: 'Plan cargado', hecho: detalles.length > 0 },
    { texto: 'Reunión agendada', hecho: vivas.some((m) => m.estado === 'Programada' || m.estado === 'Realizada') },
    { texto: 'Reunión realizada', hecho: vivas.some((m) => m.estado === 'Realizada') },
    { texto: 'Acta aprobada', hecho: reuniones.some((m) => m.acta_estado === 'Validada') },
    { texto: 'Reconfirmado', hecho: Boolean(reconfirmacion && reconfirmacion.validada_en) },
    { texto: 'Cerrado', hecho: plan.estado === 'Cerrada' },
  ];
  let actualMarcado = false;
  return pasos.map((paso) => {
    if (paso.hecho) return { texto: paso.texto, estado: 'hecho' };
    if (!actualMarcado) {
      actualMarcado = true;
      return { texto: paso.texto, estado: 'actual' };
    }
    return { texto: paso.texto, estado: 'pendiente' };
  });
}

function accionesDelPlan({ csrf, plan, datos }) {
  const abierto = plan.estado !== 'Cerrada' && plan.estado !== 'Archivada';
  return html`
    <div class="acciones-fila">
      ${abierto && datos.faltantesParaCerrar.length === 0
        ? ui.formulario({
            accion: `/planes/${plan.id}/cerrar`,
            csrf,
            clase: 'en-linea',
            confirmar: 'Cerrar el plan deja bloqueado todo su contenido. ¿Confirmás?',
            cuerpo: ui.boton('Cerrar el plan', { clase: 'boton boton--chico' }),
          })
        : ''}
      ${plan.estado === 'Cerrada' || plan.estado === 'Archivada'
        ? ui.detalleAbrible({
            titulo: 'Reabrir el plan (Dirección, con motivo)',
            cuerpo: ui.formulario({
              accion: `/planes/${plan.id}/reabrir`,
              csrf,
              confirmar: 'Se guardará una copia íntegra de lo cerrado y el plan volverá a quedar abierto. ¿Confirmás?',
              cuerpo: html`
                ${ui.aviso(
                  'La reapertura guarda copia de todo lo aprobado y queda en el historial con tu nombre y la fecha. Las actas y el resultado final mantienen su propia aprobación hasta reabrirlos aparte.',
                  { tono: 'aviso' },
                )}
                ${ui.area({
                  nombre: 'motivo',
                  etiqueta: 'Motivo de la reapertura',
                  obligatorio: true,
                  filas: 2,
                  ayuda: 'Al menos 10 caracteres. Queda registrado.',
                })}
                ${ui.boton('Reabrir plan', { clase: 'boton boton--peligro boton--chico' })}`,
            }),
          })
        : ''}
      ${abierto
        ? ui.detalleAbrible({
            titulo: 'Archivar',
            cuerpo: ui.formulario({
              accion: `/planes/${plan.id}/archivar`,
              csrf,
              confirmar: 'El plan archivado sale de los indicadores del ciclo. ¿Confirmás?',
              cuerpo: html`
                ${ui.area({ nombre: 'motivo', etiqueta: 'Motivo', obligatorio: true, filas: 2 })}
                ${ui.boton('Archivar plan', { clase: 'boton boton--peligro boton--chico' })}`,
            }),
          })
        : ''}
    </div>`;
}

function tarjetaTiras({ csrf, datos, esDireccion }) {
  const { plan, detalles, bloqueos } = datos;

  // Las columnas 2026 y 2027 son la planilla de venta tal cual se escribió: el texto manda.
  // El número no se deduce de ahí; aparece solo si alguien lo cargó a mano en la app.
  const celda2026 = (d) =>
    html`${d.tiras_base !== null && d.tiras_base !== undefined
      ? html`<span class="numero">${d.tiras_base}</span>${d.divisiones_2026 ? ' · ' : ''}`
      : ''}${d.divisiones_2026 ? html`<span class="texto-largo">${d.divisiones_2026}</span>` : ''}`;

  const celda2027 = (d) =>
    html`${d.tiras_propuestas !== null && d.tiras_propuestas !== undefined
      ? html`<span class="numero">${d.tiras_propuestas}</span>${d.intencion_2027 ? ' · ' : ''}`
      : ''}${d.intencion_2027 ? html`<span class="texto-largo">${d.intencion_2027}</span>` : ''}`;

  // Lo acordado se escribe en el acta de la reunión donde se acordó, en palabras y sin
  // cantidades. Acá se lee, con el enlace a esa acta.
  const celdaAcordado = (d) =>
    html`${d.acordado_texto ? html`<span class="texto-largo">${d.acordado_texto}</span>` : ''}${
      d.reunion_acuerdo_id
        ? html`<br><span class="menor">${ui.enlace(`/reuniones/${d.reunion_acuerdo_id}#acta`, `acta del ${fechaCorta(d.acuerdo_inicio)}`)} ${d.acuerdo_acta_estado === 'Validada' ? '· aprobada' : '· sin aprobar'}</span>`
        : ''
    }`;

  const filas = detalles.map((d) => [
    html`<strong>${d.disciplina}</strong>${d.observaciones ? html`<br><span class="menor">${d.observaciones}</span>` : ''}`,
    celda2026(d),
    celda2027(d),
    celdaAcordado(d),
    ui.cantidad(d.tiras_reconfirmadas),
  ]);

  // Acordado no suma: es texto, no una cantidad.
  const totales = [
    html`<strong>Total</strong>`,
    html`<strong>${suma(detalles, 'tiras_base')}</strong>`,
    html`<strong>${suma(detalles, 'tiras_propuestas')}</strong>`,
    '',
    html`<strong>${suma(detalles, 'tiras_reconfirmadas')}</strong>`,
  ];

  return ui.tarjeta({
    titulo: 'Disciplinas y tiras',
    id: 'tiras',
    subtitulo: 'El ciclo entero en una fila: 2026 y 2027 son la planilla de venta tal cual, Acordado sale del acta de cada reunión y Final lo reconfirma el club.',
    cuerpo: html`
      ${ui.tabla({
        clase: 'tabla--numeros comparacion',
        columnas: ['Disciplina', '2026', '2027', 'Acordado', 'Final'],
        filas: detalles.length > 0 ? [...filas, totales] : [],
        vacioTexto: 'Todavía no hay disciplinas cargadas.',
      })}
      <div class="leyenda">
        <span class="es-propuesto">Pretendido: iniciativa de FUTSALA, no es acuerdo</span>
        <span class="es-acordado">Acordado: aprobado con un acta concreta</span>
        <span class="es-final">Final: reconfirmado por el club</span>
      </div>
      ${detalles.some((d) => d.divisiones_2026 || d.intencion_2027)
        ? ui.aviso(
            'Las columnas 2026 y 2027 muestran la planilla de venta sin interpretarla: ni "Liga de Honor B / 1ra a 5ta BAFI" ni "4 Categorías" son una cantidad de tiras.',
            { tono: 'info' },
          )
        : ''}
      ${ui.aviso('Lo acordado se escribe en el acta de la reunión donde se acordó, no acá. Desde esta tabla se ve, con el enlace al acta que lo respalda.', {
        tono: 'info',
      })}

      ${esDireccion && plan.estado !== 'Cerrada' && plan.estado !== 'Archivada'
        ? html`
            <div class="separador"></div>
            ${detalles.map((d) =>
              ui.detalleAbrible({
                titulo: `Editar ${d.disciplina}`,
                cuerpo: ui.formulario({
                  accion: `/detalles/${d.id}`,
                  csrf,
                  version: d.version,
                  clase: 'formulario--filas',
                  cuerpo: html`
                    ${ui.campo({
                      nombre: 'tiras_base',
                      etiqueta: 'Tiras 2026',
                      tipo: 'number',
                      valor: d.tiras_base,
                      atributos: 'min="0" step="1"',
                      bloqueado: bloqueos.base,
                      ayuda: 'Vacío = sin dato. Cero es un valor válido.',
                    })}
                    ${ui.area({
                      nombre: 'divisiones_2026',
                      etiqueta: 'Divisiones 2026',
                      valor: d.divisiones_2026,
                      filas: 2,
                      bloqueado: bloqueos.base,
                      ayuda: 'Una división por línea, como figura en la planilla de venta.',
                    })}
                    ${ui.campo({
                      nombre: 'tiras_propuestas',
                      etiqueta: 'Tiras pretendidas 2027',
                      tipo: 'number',
                      valor: d.tiras_propuestas,
                      atributos: 'min="0" step="1"',
                      bloqueado: bloqueos.propuesta,
                      ayuda: 'Dejalo vacío mientras no haya un número decidido.',
                    })}
                    ${ui.area({
                      nombre: 'intencion_2027',
                      etiqueta: 'Qué pretendemos en 2027',
                      valor: d.intencion_2027,
                      filas: 2,
                      bloqueado: bloqueos.propuesta,
                      ayuda: 'En palabras: mantener, armar, traer de otra liga, tantear…',
                    })}
                    ${ui.campo({
                      nombre: 'tiras_reconfirmadas',
                      etiqueta: 'Final reconfirmado',
                      tipo: 'number',
                      valor: d.tiras_reconfirmadas,
                      atributos: 'min="0" step="1"',
                      bloqueado: bloqueos.finales,
                    })}
                    ${ui.campo({ nombre: 'observaciones', etiqueta: 'Observaciones', valor: d.observaciones })}
                    <div style="align-self:end">${ui.boton('Guardar disciplina', { clase: 'boton boton--chico' })}</div>`,
                }),
              }),
            )}
            ${ui.detalleAbrible({
              titulo: 'Agregar disciplina',
              abierto: detalles.length === 0,
              cuerpo: ui.formulario({
                accion: `/planes/${plan.id}/detalles`,
                csrf,
                clase: 'formulario--filas',
                cuerpo: html`
                  ${ui.campo({
                    nombre: 'disciplina',
                    etiqueta: 'Disciplina',
                    obligatorio: true,
                    ayuda: 'Una fila por disciplina. No se repite dentro del plan.',
                  })}
                  ${ui.campo({
                    nombre: 'tiras_base',
                    etiqueta: 'Tiras 2026',
                    tipo: 'number',
                    atributos: 'min="0" step="1"',
                    bloqueado: bloqueos.base,
                  })}
                  ${ui.campo({ nombre: 'divisiones_2026', etiqueta: 'Divisiones 2026' })}
                  ${ui.campo({
                    nombre: 'tiras_propuestas',
                    etiqueta: 'Tiras pretendidas 2027',
                    tipo: 'number',
                    atributos: 'min="0" step="1"',
                    bloqueado: bloqueos.propuesta,
                  })}
                  ${ui.campo({ nombre: 'intencion_2027', etiqueta: 'Qué pretendemos en 2027' })}
                  ${ui.campo({ nombre: 'observaciones', etiqueta: 'Observaciones' })}
                  <div style="align-self:end">${ui.boton('Agregar', { clase: 'boton boton--chico' })}</div>`,
              }),
            })}`
        : ''}`,
  });
}

function suma(detalles, campo) {
  const cargados = detalles.filter((d) => d[campo] !== null && d[campo] !== undefined);
  if (cargados.length === 0) return '—';
  const total = cargados.reduce((acumulado, d) => acumulado + d[campo], 0);
  return cargados.length === detalles.length ? String(total) : `${total} (faltan ${detalles.length - cargados.length})`;
}

/**
 * Observaciones de una reunión, escritas donde se la ve. No son el acta: sirven para
 * anotar lo que haga falta antes y después, y se pueden corregir aunque el acta ya esté
 * aprobada. Mientras no haya nada escrito queda plegado para no ocupar lugar.
 */
function notaDeReunion({ csrf, reunion, plan, puedeEscribir }) {
  const planAbierto = plan.estado !== 'Cerrada' && plan.estado !== 'Archivada';
  if (!puedeEscribir || !planAbierto) {
    return reunion.nota ? html`<span class="item__nota">${reunion.nota}</span>` : '';
  }
  return ui.detalleAbrible({
    titulo: reunion.nota ? 'Observaciones' : 'Anotar algo de esta reunión',
    abierto: Boolean(reunion.nota),
    clase: 'plegable--nota',
    cuerpo: ui.formulario({
      accion: `/reuniones/${reunion.id}/nota`,
      csrf,
      cuerpo: html`
        <input type="hidden" name="volver_a" value="club">
        ${ui.area({
          nombre: 'nota',
          etiqueta: 'Observaciones',
          valor: reunion.nota,
          filas: 2,
          placeholder: 'Lo que convenga tener a mano: a qué hora les queda bien, qué quedó pendiente, con quién hablar.',
        })}
        ${ui.boton('Guardar observaciones', { clase: 'boton boton--secundario boton--chico' })}`,
    }),
  });
}

function tarjetaReuniones({ csrf, datos, puedeEscribir, usuario }) {
  const { plan, reuniones } = datos;
  return ui.tarjeta({
    titulo: 'Reuniones y actas',
    id: 'reuniones',
    subtitulo: 'Una reunión realizada no confirma la continuidad del club.',
    cuerpo: html`
      ${reuniones.length === 0
        ? ui.vacio('Todavía no hay reuniones.', 'Las coordina y agenda el ayudante, con la Dirección que la tiene y quién toma nota.')
        : html`<ul class="lista-limpia">
            ${reuniones.map(
              (m) => html`
                <li class="item ${m.modalidad === 'En el club' ? 'item--visita' : m.acta_estado === 'Para revisar' ? 'item--aviso' : m.acta_estado === 'Validada' ? 'item--exito' : ''}">
                  <div class="fila-entre">
                    <span class="item__titulo">
                      ${ui.enlace(`/reuniones/${m.id}`, m.inicio ? fechaHoraCorta(m.inicio) : 'Reunión sin fecha')}
                    </span>
                    <span class="acciones-fila">
                      ${ui.estado(m.estado)}
                      ${ui.estado(`Acta: ${m.acta_estado}`, {
                        tono: m.acta_estado === 'Validada' ? 'exito' : m.acta_estado === 'Para revisar' ? 'aviso' : 'neutro',
                      })}
                    </span>
                  </div>
                  <span class="item__meta">
                    ${ui.etiquetaModalidad(m.modalidad)}${m.lugar ? ` ${m.lugar}` : ''} ·
                    ${m.director1_nombre || '—'} y ${m.director2_nombre || '—'} ·
                    acta: ${m.acta_responsable_nombre || 'sin asignar'}
                    ${m.compromisos > 0 ? html`· ${m.compromisos} compromiso(s)` : ''}
                  </span>
                  ${m.estado === 'Cancelada' ? html`<span class="item__meta">Cancelada: ${m.motivo_cancelacion}</span>` : ''}
                  ${m.motivo_devolucion && m.acta_estado === 'Borrador'
                    ? html`<span class="item__meta">Devuelta para corregir: ${m.motivo_devolucion}</span>`
                    : ''}
                  ${notaDeReunion({ csrf, reunion: m, plan, puedeEscribir })}
                </li>`,
            )}
          </ul>`}

      ${puedeEscribir && plan.estado !== 'Cerrada' && plan.estado !== 'Archivada'
        ? html`
            <div class="separador"></div>
            ${ui.detalleAbrible({
              titulo: 'Agendar reunión',
              abierto: reuniones.length === 0,
              cuerpo: ui.formulario({
                accion: `/planes/${plan.id}/reuniones`,
                csrf,
                clase: 'formulario--filas',
                cuerpo: html`
                  ${ui.fechaElegible({
                    nombre: 'fecha',
                    etiqueta: 'Fecha',
                    anios: datos.aniosAgenda,
                    obligatorio: true,
                  })}
                  ${ui.hora({
                    nombre: 'hora',
                    etiqueta: 'Hora de inicio',
                    valor: '18:00',
                    obligatorio: true,
                    ayuda: 'De 08 a 22.',
                  })}
                  ${ui.seleccion({
                    nombre: 'modalidad',
                    etiqueta: 'Dónde',
                    valor: 'En la liga',
                    opciones: ui.OPCIONES_MODALIDAD,
                    ayuda: 'El fin se calcula solo: 45 minutos en la liga, 3 horas si vamos al club.',
                  })}
                  ${ui.campo({
                    nombre: 'lugar',
                    etiqueta: 'Dirección del club',
                    ayuda: 'Solo si la reunión es en el club.',
                  })}
                  ${ui.seleccion({
                    nombre: 'director1_id',
                    etiqueta: 'Quién la tiene',
                    opciones: ui.opcionesUsuarios(datos.directoresActivos, { incluirVacio: false }),
                    obligatorio: true,
                  })}
                  ${ui.seleccion({
                    nombre: 'director2_id',
                    etiqueta: 'Acompaña (opcional)',
                    opciones: ui.opcionesUsuarios(datos.directoresActivos),
                    ayuda: 'Solo si van las dos direcciones.',
                  })}
                  ${ui.seleccion({
                    nombre: 'acta_responsable_id',
                    etiqueta: 'Quién toma nota',
                    opciones: ui.opcionesUsuarios(datos.usuariosActivos.filter((u) => u.rol !== 'Consulta'), {
                      incluirVacio: false,
                    }),
                    obligatorio: true,
                  })}
                  ${ui.campo({
                    nombre: 'nota',
                    etiqueta: 'Observaciones (opcional)',
                    ayuda: 'Se puede escribir y corregir después, desde acá o desde la reunión.',
                  })}
                  <div style="align-self:end">${ui.boton('Agendar', { clase: 'boton boton--chico' })}</div>`,
              }),
            })}`
        : ''}`,
  });
}

function tarjetaCompromisos({ datos }) {
  const abiertos = datos.compromisos.filter((t) => t.estado === 'Pendiente' || t.estado === 'En curso');
  const resueltos = datos.compromisos.filter((t) => t.estado === 'Cumplido' || t.estado === 'Cancelado');
  return ui.tarjeta({
    titulo: `Compromisos (${abiertos.length} abierto(s))`,
    id: 'compromisos',
    subtitulo: 'Se crean desde el acta de cada reunión.',
    acciones: ui.enlace('/compromisos', 'Ver todas las tareas', { clase: 'boton boton--secundario boton--chico' }),
    cuerpo: html`
      ${datos.compromisos.length === 0
        ? ui.vacio('No hay compromisos registrados.')
        : ui.tabla({
            clase: 'tabla--compacta',
            columnas: ['Compromiso', 'Parte', 'Responsable', 'Vence', 'Estado'],
            filas: [...abiertos, ...resueltos].map((t) => [
              html`${ui.enlace(`/reuniones/${t.reunion_id}#compromisos`, t.descripcion)}${
                t.resolucion ? html`<br><span class="menor">Resolución: ${t.resolucion}</span>` : ''
              }`,
              t.parte_responsable === 'Club' ? html`Club · ${t.contacto_club}` : 'FUTSALA',
              t.responsable_nombre,
              ui.fecha(t.fecha_limite),
              t.vencido ? ui.estado('Vencida', { tono: 'alerta' }) : ui.estado(t.estado),
            ]),
          })}`,
  });
}

function tarjetaReconfirmacion({ csrf, datos, esDireccion, puedeEscribir }) {
  const { club, plan, reconfirmacion, faltantesParaConfirmar } = datos;
  // La ficha final reconfirma un acta: la última aprobada del plan. Si no hay ninguna,
  // todavía no hay nada que el club pueda confirmar.
  const acta = datos.reuniones
    .filter((m) => m.acta_estado === 'Validada')
    .sort((a, b) => String(b.inicio || '').localeCompare(String(a.inicio || '')))[0];

  return ui.tarjeta({
    titulo: 'Reconfirmación 2027',
    id: 'reconfirmacion',
    subtitulo: 'Enero-febrero. Una respuesta condicional no es una confirmación.',
    acciones: reconfirmacion
      ? html`${ui.estado(reconfirmacion.estado)}${reconfirmacion.validada_en ? ui.estado('validada', { tono: 'exito' }) : ''}`
      : ui.estado('sin ficha', { tono: 'neutro' }),
    cuerpo: reconfirmacion
      ? html`
          ${ui.listaDatos(html`
            ${ui.dato(
              'Reconfirma el acta',
              reconfirmacion.reunion_id
                ? ui.enlace(
                    `/reuniones/${reconfirmacion.reunion_id}#acordado`,
                    reconfirmacion.acta_inicio ? `Reunión del ${fechaCorta(reconfirmacion.acta_inicio)}` : 'Reunión sin fecha',
                  )
                : null,
            )}
            ${ui.dato('Fecha para reconfirmar', ui.fecha(reconfirmacion.fecha_prevista, { largo: true }))}
            ${ui.dato('Responsable', reconfirmacion.responsable_nombre)}
            ${ui.dato('Último contacto', reconfirmacion.fecha_contacto ? ui.fecha(reconfirmacion.fecha_contacto) : null)}
            ${ui.dato('Canal', reconfirmacion.canal)}
            ${ui.dato('Interlocutor', reconfirmacion.interlocutor)}
            ${ui.dato('Próximo contacto', reconfirmacion.proximo_contacto ? ui.fecha(reconfirmacion.proximo_contacto) : null)}
          `)}
          ${reconfirmacion.respuesta_club ? ui.aviso(reconfirmacion.respuesta_club, { tono: 'info', titulo: 'Respuesta del club' }) : ''}
          ${reconfirmacion.condiciones ? ui.aviso(reconfirmacion.condiciones, { tono: 'aviso', titulo: 'Condiciones' }) : ''}
          ${reconfirmacion.validada_en
            ? ui.aviso(
                `Resultado ${reconfirmacion.estado}, validado por ${reconfirmacion.validada_por_nombre || '—'} el ${fechaHoraCorta(reconfirmacion.validada_en)}.`,
                { tono: reconfirmacion.estado === 'Confirmado' ? 'exito' : 'alerta' },
              )
            : faltantesParaConfirmar.length > 0
              ? ui.aviso('', { tono: 'aviso', titulo: 'Falta para poder confirmar', lista: faltantesParaConfirmar })
              : ui.aviso('Están las condiciones para validar el resultado final.', { tono: 'exito' })}
          <div class="acciones-fila">
            ${ui.enlace(`/reconfirmacion/${reconfirmacion.id}`, 'Abrir la ficha de reconfirmación', { clase: 'boton boton--secundario boton--chico' })}
          </div>`
      : !acta
        ? ui.vacio(
            'Todavía no hay un acta aprobada que reconfirmar.',
            'El club reconfirma lo que se acordó en una reunión: primero se aprueba esa acta.',
          )
        : html`
            ${ui.aviso(
              acta.fecha_recontacto
                ? `El acta del ${fechaCorta(acta.inicio)} dejó fijado reconfirmar el ${fechaCorta(acta.fecha_recontacto)}.`
                : `El acta del ${fechaCorta(acta.inicio)} no dejó fecha para reconfirmar: indicá una acá.`,
              { tono: acta.fecha_recontacto ? 'info' : 'aviso' },
            )}
            ${puedeEscribir && plan.estado !== 'Cerrada' && plan.estado !== 'Archivada'
              ? ui.formulario({
                  accion: `/planes/${plan.id}/reconfirmacion`,
                  csrf,
                  clase: 'formulario--filas',
                  cuerpo: html`
                    ${ui.campo({
                      nombre: 'fecha_prevista',
                      etiqueta: 'Fecha para reconfirmar',
                      tipo: 'date',
                      obligatorio: !acta.fecha_recontacto,
                      valor: acta.fecha_recontacto || '',
                      ayuda: acta.fecha_recontacto
                        ? 'Viene del acta. Se puede cambiar acá, y después reprogramar las veces que haga falta.'
                        : `Ventana: ${fechaCorta(datos.ventana.inicio)} a ${fechaCorta(datos.ventana.fin)}.`,
                    })}
                    ${ui.seleccion({
                      nombre: 'responsable_id',
                      etiqueta: 'Responsable',
                      valor: club.responsable_id || '',
                      opciones: ui.opcionesUsuarios(datos.usuariosActivos),
                    })}
                    ${ui.campo({
                      nombre: 'motivo_excepcion',
                      etiqueta: 'Motivo de excepción',
                      ayuda: 'Solo si la fecha queda fuera de la ventana.',
                    })}
                    <div style="align-self:end">${ui.boton('Abrir ficha', { clase: 'boton boton--chico' })}</div>`,
                })
              : ''}`,
  });
}

function datosDelClub({ csrf, datos, esDireccion }) {
  const { club } = datos;
  return ui.detalleAbrible({
    titulo: 'Datos del club',
    clase: 'plegable--datos',
    cuerpo: html`
      ${datos.similares && datos.similares.length > 0
        ? ui.aviso('', {
            tono: 'aviso',
            titulo: 'Hay clubes con nombre parecido',
            lista: datos.similares.map((s) => `${s.nombre}${s.localidad ? ` (${s.localidad})` : ''}`),
          })
        : ''}
      ${esDireccion
        ? ui.formulario({
            accion: `/clubes/${club.id}`,
            csrf,
            version: club.version,
            clase: 'formulario--filas',
            cuerpo: html`
              ${ui.campo({ nombre: 'nombre', etiqueta: 'Nombre', valor: club.nombre, obligatorio: true })}
              ${ui.campo({ nombre: 'localidad', etiqueta: 'Localidad', valor: club.localidad })}
              ${ui.campo({ nombre: 'contacto_nombre', etiqueta: 'Contacto', valor: club.contacto_nombre })}
              ${ui.campo({ nombre: 'contacto_email', etiqueta: 'Correo', tipo: 'email', valor: club.contacto_email })}
              ${ui.campo({ nombre: 'contacto_telefono', etiqueta: 'Teléfono', valor: club.contacto_telefono })}
              ${ui.seleccion({
                nombre: 'responsable_id',
                etiqueta: 'Responsable',
                valor: club.responsable_id || '',
                opciones: ui.opcionesUsuarios(datos.usuariosActivos),
              })}
              ${ui.seleccion({
                nombre: 'prioridad',
                etiqueta: 'Prioridad',
                valor: club.prioridad,
                opciones: ui.OPCIONES_PRIORIDAD,
                ayuda: 'Qué tan importante es el club para la liga. No cambia de un ciclo a otro.',
              })}
              ${ui.campo({ nombre: 'analisis_url', etiqueta: 'Análisis 2026 (enlace)', valor: club.analisis_url })}
              ${ui.campo({ nombre: 'notas', etiqueta: 'Notas internas', valor: club.notas })}
              ${ui.casilla({ nombre: 'activo', etiqueta: 'Club activo', marcada: club.activo === 1 })}
              ${ui.casilla({
                nombre: 'contacto_directo',
                etiqueta: 'Lo contactan los directivos (los ayudantes no lo llaman)',
                marcada: club.contacto_directo === 1,
              })}
              <div style="align-self:end">${ui.boton('Guardar datos del club', { clase: 'boton boton--chico' })}</div>`,
          })
        : ui.listaDatos(html`
            ${ui.dato('Localidad', club.localidad)}
            ${ui.dato('Contacto', club.contacto_nombre)}
            ${ui.dato('Correo', club.contacto_email)}
            ${ui.dato('Teléfono', club.contacto_telefono)}
            ${ui.dato('Responsable', club.responsable_nombre)}
            ${ui.dato('Prioridad', ui.etiquetaPrioridad(club.prioridad))}
            ${ui.dato('Análisis 2026', club.analisis_url ? ui.enlace(club.analisis_url, 'Abrir enlace') : null)}
          `)}`,
  });
}

function tarjetaHistorial(historial) {
  return ui.tarjeta({
    titulo: 'Historial',
    id: 'historial',
    subtitulo: 'Solo se agrega: nadie edita ni borra eventos desde la aplicación.',
    cuerpo:
      historial.length === 0
        ? ui.vacio('Todavía no hay eventos registrados para este club.')
        : html`
            ${ui.tabla({
              clase: 'tabla--compacta',
              columnas: ['Cuándo', 'Qué pasó', 'Quién', 'Motivo'],
              filas: historial.slice(0, 25).map((h) => [
                ui.fechaHora(h.ocurrido_en),
                html`${etiquetaEvento(h.tipo)}${
                  h.estado_anterior || h.estado_posterior
                    ? html`<br><span class="menor">${h.estado_anterior || '—'} → ${h.estado_posterior || '—'}</span>`
                    : ''
                }`,
                h.actor_nombre || '—',
                h.motivo ? html`<span class="menor">${h.motivo}</span>` : '—',
              ]),
            })}
            ${historial.length > 25 ? ui.enlace('/historial', 'Ver historial completo', { clase: 'boton boton--texto boton--chico' }) : ''}`,
  });
}

const EVENTOS = {
  'club.creado': 'Club creado',
  'club.editado': 'Datos del club editados',
  'plan.creado': 'Plan del ciclo creado',
  'plan.editado': 'Plan editado',
  'plan.cerrado': 'Plan cerrado',
  'plan.archivado': 'Plan archivado',
  'plan.reabierto': 'Plan reabierto',
  'disciplina.creada': 'Disciplina agregada',
  'disciplina.editada': 'Disciplina editada',
  'reunion.creada': 'Reunión creada',
  'reunion.agenda': 'Agenda de la reunión editada',
  'reunion.programada': 'Reunión programada',
  'reunion.realizada': 'Reunión marcada como realizada',
  'reunion.cancelada': 'Reunión cancelada',
  'acta.guardada': 'Acta guardada',
  'acta.enviada': 'Acta enviada a revisión',
  'acta.devuelta': 'Acta devuelta para corregir',
  'acta.aprobada': 'Acta aprobada',
  'acta.reabierta': 'Acta reabierta',
  'compromiso.creado': 'Compromiso creado',
  'compromiso.editado': 'Compromiso editado',
  'compromiso.en_curso': 'Compromiso en curso',
  'compromiso.cumplido': 'Compromiso cumplido',
  'compromiso.cancelado': 'Compromiso cancelado',
  'reconfirmacion.creada': 'Ficha de reconfirmación abierta',
  'reconfirmacion.contactado': 'Contacto registrado',
  'reconfirmacion.condicional': 'Respuesta condicional registrada',
  'reconfirmacion.sin_respuesta': 'Intento sin respuesta',
  'reconfirmacion.confirmada': 'Continuidad confirmada',
  'reconfirmacion.no_continua': 'No continúa',
  'reconfirmacion.reabierta': 'Reconfirmación reabierta',
  'usuario.creado': 'Usuario creado',
  'usuario.acceso': 'Rol o acceso de usuario cambiado',
  'parametros.actualizados': 'Parámetros del ciclo actualizados',
  'conflicto.resuelto': 'Conflicto de datos resuelto',
  'importacion.realizada': 'Importación de datos',
};

export function etiquetaEvento(tipo) {
  return EVENTOS[tipo] || tipo;
}
