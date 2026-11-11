import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta, fechaHoraCorta } from '../../lib/fechas.js';

/**
 * Darle acceso a alguien del equipo. El enlace recién generado se muestra una sola vez,
 * acá y a Dirección: en la base queda solo su hash, así que no se puede volver a leer.
 * Dirección se lo pasa a la persona por el medio que ya usa.
 */
function accesoDe({ csrf, u, datos }) {
  const recien = datos.enlaceGenerado && datos.enlaceGenerado.usuarioId === u.id ? datos.enlaceGenerado : null;
  const pendientes = datos.pendientesPorUsuario[u.id] || 0;

  return html`
    ${recien
      ? html`
          ${ui.aviso('', {
            tono: 'exito',
            titulo: `Enlace para ${u.nombre} — vence en ${recien.minutos} minutos y sirve una sola vez`,
          })}
          <p class="enlace-acceso mono">${recien.enlace}</p>
          <p class="menor">
            Pasáselo por donde ya hablan. No se vuelve a mostrar: si se pierde, generá otro.
          </p>`
      : ''}
    <div class="acciones-fila">
      ${u.activo === 1
        ? ui.formulario({
            accion: `/admin/usuarios/${u.id}/acceso`,
            csrf,
            clase: 'en-linea',
            cuerpo: ui.boton(pendientes > 0 ? 'Generar otro enlace' : 'Generar enlace de acceso', {
              clase: 'boton boton--secundario boton--chico',
            }),
          })
        : html`<span class="item__meta">Inactivo: no se le puede dar acceso.</span>`}
      ${pendientes > 0
        ? html`
            ${ui.estado(`${pendientes} enlace(s) sin usar`, { tono: 'aviso' })}
            ${ui.formulario({
              accion: `/admin/usuarios/${u.id}/acceso/anular`,
              csrf,
              clase: 'en-linea',
              confirmar: `Los enlaces sin usar de ${u.nombre} dejan de servir. ¿Confirmás?`,
              cuerpo: ui.boton('Anularlos', { clase: 'boton boton--texto boton--chico' }),
            })}`
        : ''}
      ${datos.ultimoAcceso[u.id]
        ? html`<span class="item__meta">Último ingreso: ${fechaHoraCorta(datos.ultimoAcceso[u.id])}</span>`
        : html`<span class="item__meta">Todavía no entró.</span>`}
    </div>`;
}

export function render({ usuario, csrf, avisos, datos }) {
  const esDireccion = usuario && usuario.rol === 'Direccion' && usuario.activo === 1;

  const contenido = html`
    ${esDireccion
      ? ''
      : ui.aviso('La administración de usuarios y parámetros es de solo lectura para tu rol.', { tono: 'info' })}

    ${ui.tarjeta({
      titulo: 'Usuarios y roles',
      id: 'usuarios',
      subtitulo: 'Nadie cambia su propio rol ni su propio acceso desde esta pantalla.',
      cuerpo: html`
        <ul class="lista-limpia">
          ${datos.usuarios.map(
            (u) => html`
              <li class="item ${u.activo === 1 ? '' : 'item--aviso'}">
                <div class="fila-entre">
                  <span class="item__titulo">${u.nombre}${u.id === usuario?.id ? ' (vos)' : ''}</span>
                  <span class="acciones-fila">
                    ${ui.etiquetaRol(u.rol)}
                    ${u.activo === 1 ? ui.estado('activo', { tono: 'exito' }) : ui.estado('inactivo', { tono: 'aviso' })}
                  </span>
                </div>
                <span class="item__meta mono">${u.email}</span>
                ${esDireccion ? accesoDe({ csrf, u, datos }) : ''}
                ${esDireccion && u.id !== usuario.id
                  ? ui.formulario({
                      accion: `/admin/usuarios/${u.id}`,
                      csrf,
                      version: u.version,
                      clase: 'formulario--filas',
                      cuerpo: html`
                        ${ui.campo({ nombre: 'nombre', etiqueta: 'Nombre', valor: u.nombre, obligatorio: true })}
                        ${ui.seleccion({
                          nombre: 'rol',
                          etiqueta: 'Rol',
                          valor: u.rol,
                          opciones: [
                            { valor: 'Direccion', texto: 'Dirección' },
                            { valor: 'Ayudante', texto: 'Ayudante' },
                            { valor: 'Consulta', texto: 'Consulta' },
                          ],
                        })}
                        <div style="align-self:end">
                          ${ui.casilla({ nombre: 'activo', etiqueta: 'Activo', marcada: u.activo === 1 })}
                        </div>
                        <div style="align-self:end">${ui.boton('Guardar acceso', { clase: 'boton boton--chico' })}</div>`,
                    })
                  : esDireccion
                    ? html`<span class="item__meta">Tu propio acceso lo cambia la otra Dirección.</span>`
                    : ''}
              </li>`,
          )}
        </ul>

        ${esDireccion
          ? html`
              <div class="separador"></div>
              ${ui.detalleAbrible({
                titulo: 'Agregar usuario',
                cuerpo: ui.formulario({
                  accion: '/admin/usuarios',
                  csrf,
                  clase: 'formulario--filas',
                  cuerpo: html`
                    ${ui.campo({ nombre: 'nombre', etiqueta: 'Nombre', obligatorio: true })}
                    ${ui.campo({ nombre: 'email', etiqueta: 'Correo', tipo: 'email', obligatorio: true })}
                    ${ui.seleccion({
                      nombre: 'rol',
                      etiqueta: 'Rol',
                      valor: 'Ayudante',
                      opciones: [
                        { valor: 'Direccion', texto: 'Dirección' },
                        { valor: 'Ayudante', texto: 'Ayudante' },
                        { valor: 'Consulta', texto: 'Consulta' },
                      ],
                    })}
                    <div style="align-self:end">${ui.casilla({ nombre: 'activo', etiqueta: 'Activo', marcada: true })}</div>
                    <div style="align-self:end">${ui.boton('Agregar usuario', { clase: 'boton boton--chico' })}</div>`,
                }),
              })}
              ${ui.aviso(
                'No cargues correos reales sin autorización. Mientras no haya autenticación real, estas identidades son solo de prueba.',
                { tono: 'aviso' },
              )}`
          : ''}`,
    })}

    ${ui.tarjeta({
      titulo: 'Parámetros del ciclo',
      id: 'parametros',
      cuerpo: html`
        ${ui.listaDatos(html`
          ${ui.dato('Ciclo', `${datos.parametros.anio_cierre} / ${datos.parametros.anio_objetivo}`)}
          ${ui.dato('Ventana de reconfirmación', `${fechaCorta(datos.parametros.inicio_reconfirmacion)} a ${fechaCorta(datos.parametros.fin_reconfirmacion)}`)}
          ${ui.dato('Zona horaria', datos.parametros.zona_horaria)}
          ${ui.dato('Avisos internos', datos.parametros.avisos_internos ? 'Encendidos' : 'Apagados')}
          ${ui.dato('Avisos a clubes', datos.parametros.avisos_externos ? 'Encendidos' : 'Apagados')}
        `)}
        ${ui.aviso(
          'No hay ningún envío construido todavía: no existe canal de correo ni mensajería en la aplicación. Los interruptores quedan apagados y el de avisos a clubes no se puede encender desde acá.',
          { tono: 'aviso', titulo: 'Comunicaciones desactivadas' },
        )}
        ${esDireccion
          ? ui.formulario({
              accion: '/admin/parametros',
              csrf,
              version: datos.parametros.version,
              clase: 'formulario--filas',
              cuerpo: html`
                ${ui.campo({
                  nombre: 'inicio_reconfirmacion',
                  etiqueta: 'Inicio de la ventana',
                  tipo: 'date',
                  valor: datos.parametros.inicio_reconfirmacion,
                  obligatorio: true,
                })}
                ${ui.campo({
                  nombre: 'fin_reconfirmacion',
                  etiqueta: 'Fin de la ventana',
                  tipo: 'date',
                  valor: datos.parametros.fin_reconfirmacion,
                  obligatorio: true,
                })}
                <div style="align-self:end">
                  ${ui.casilla({
                    nombre: 'avisos_internos',
                    etiqueta: 'Avisos internos (sin efecto hasta construir el canal)',
                    marcada: datos.parametros.avisos_internos === 1,
                  })}
                </div>
                <div style="align-self:end">${ui.boton('Guardar parámetros', { clase: 'boton boton--chico' })}</div>`,
            })
          : ''}`,
    })}

    ${ui.tarjeta({
      titulo: `Conflictos de datos (${datos.conflictos.filter((k) => k.estado === 'Abierto').length} abierto(s))`,
      id: 'conflictos',
      subtitulo: 'Duplicados detectados al importar. Bloquean confirmar y cerrar el plan afectado.',
      cuerpo:
        datos.conflictos.length === 0
          ? ui.vacio('No se detectaron conflictos.', 'La unicidad de plan por club/ciclo, disciplina por plan y ficha por plan es una restricción de la base.')
          : html`<ul class="lista-limpia">
              ${datos.conflictos.map(
                (k) => html`
                  <li class="item ${k.estado === 'Abierto' ? 'item--alerta' : 'item--exito'}">
                    <div class="fila-entre">
                      <span class="item__titulo">${k.detalle}</span>
                      ${ui.estado(k.estado, { tono: k.estado === 'Abierto' ? 'alerta' : 'exito' })}
                    </div>
                    <span class="item__meta">
                      ${k.entidad} · clave ${k.clave} · origen ${k.origen} · detectado ${fechaHoraCorta(k.detectado_en)}
                      ${k.club_id ? html`· ${ui.enlace(`/clubes/${k.club_id}`, k.club_nombre)}` : ''}
                    </span>
                    ${ui.detalleAbrible({
                      titulo: 'Ver fila rechazada',
                      cuerpo: html`<pre class="mono texto-largo">${k.datos}</pre>`,
                    })}
                    ${k.estado === 'Resuelto'
                      ? html`<span class="item__meta">Resuelto por ${k.resuelto_por_nombre || '—'}: ${k.resolucion}</span>`
                      : esDireccion
                        ? ui.detalleAbrible({
                            titulo: 'Resolver conflicto',
                            cuerpo: ui.formulario({
                              accion: `/admin/conflictos/${k.id}/resolver`,
                              csrf,
                              cuerpo: html`
                                ${ui.area({
                                  nombre: 'resolucion',
                                  etiqueta: 'Qué se decidió',
                                  obligatorio: true,
                                  filas: 2,
                                  ayuda: 'Queda en el historial. La fila rechazada se conserva como dato.',
                                })}
                                ${ui.boton('Marcar resuelto', { clase: 'boton boton--chico' })}`,
                            }),
                          })
                        : ''}
                  </li>`,
              )}
            </ul>`,
    })}`;

  return pagina({
    titulo: 'Administración',
    subtitulo: 'Usuarios, roles, parámetros del ciclo y conflictos de datos.',
    ruta: '/admin',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}
