import { html, parrafos } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { fechaCorta, fechaHoraCorta } from '../../lib/fechas.js';
import { etiquetaEvento } from './club.js';
import { bloqueGoogle } from './ingreso.js';

// --- Historial ---------------------------------------------------------------

export function historial({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.aviso(
      'El historial solo admite altas: la aplicación no ofrece ninguna forma de editarlo o borrarlo, y la base lo impide con un disparador propio.',
      { tono: 'info' },
    )}
    ${ui.tarjeta({
      titulo: 'Filtrar',
      cuerpo: html`
        <form method="get" action="/historial" class="formulario formulario--filas">
          ${ui.seleccion({
            nombre: 'tipo',
            etiqueta: 'Tipo de evento',
            valor: datos.tipo,
            vacioTexto: 'Todos',
            opciones: datos.tipos.map((t) => ({ valor: t, texto: etiquetaEvento(t) })),
          })}
          <div class="acciones-fila" style="align-self:end">
            ${ui.boton('Filtrar', { clase: 'boton boton--secundario' })}
            ${ui.enlace('/historial', 'Limpiar', { clase: 'boton boton--texto' })}
          </div>
        </form>`,
    })}
    ${ui.tarjeta({
      titulo: `${datos.eventos.length} evento(s)`,
      cuerpo:
        datos.eventos.length === 0
          ? ui.vacio('Todavía no hay eventos registrados.')
          : html`<ul class="lista-limpia">
              ${datos.eventos.map(
                (h) => html`
                  <li class="item">
                    <div class="fila-entre">
                      <span class="item__titulo">${etiquetaEvento(h.tipo)}</span>
                      <span class="menor">${fechaHoraCorta(h.ocurrido_en)}</span>
                    </div>
                    <span class="item__meta">
                      ${h.club_id ? ui.enlace(`/clubes/${h.club_id}`, h.club_nombre) : h.entidad}
                      · ${h.actor_nombre || 'usuario eliminado'}
                      ${h.estado_anterior || h.estado_posterior ? html`· ${h.estado_anterior || '—'} → ${h.estado_posterior || '—'}` : ''}
                    </span>
                    ${h.motivo ? html`<span class="item__meta">Motivo: ${h.motivo}</span>` : ''}
                    ${h.datos_anteriores
                      ? ui.detalleAbrible({
                          titulo: 'Ver copia anterior guardada',
                          cuerpo: html`<pre class="mono texto-largo">${formatearJson(h.datos_anteriores)}</pre>`,
                        })
                      : ''}
                  </li>`,
              )}
            </ul>`,
    })}`;

  return pagina({
    titulo: 'Historial',
    subtitulo: 'Auditoría de aprobaciones, reaperturas y cambios de estado.',
    ruta: '/historial',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

function formatearJson(texto) {
  try {
    return JSON.stringify(JSON.parse(texto), null, 2);
  } catch {
    return texto;
  }
}

// --- Indicador ---------------------------------------------------------------

export function indicador({ usuario, csrf, avisos, datos }) {
  const { titulo, descripcion, filas } = datos.detalle;
  // Las columnas de identificador solo se muestran cuando sirven para abrir el registro.
  const enlazables = ['club_id', 'reunion_id', 'reconfirmacion_id', 'compromiso_id', 'conflicto_id'];
  const columnas =
    filas.length > 0 ? Object.keys(filas[0]).filter((c) => !c.endsWith('_id') || enlazables.includes(c)) : [];

  const contenido = html`
    ${ui.aviso(descripcion, { tono: 'info' })}
    ${ui.tarjeta({
      titulo: `${filas.length} registro(s)`,
      cuerpo:
        filas.length === 0
          ? ui.vacio('No hay registros detrás de este número.')
          : ui.tabla({
              clase: 'tabla--compacta',
              columnas: columnas.map(encabezado),
              filas: filas.map((fila) =>
                columnas.map((columna) => celda(columna, fila[columna], fila)),
              ),
            }),
    })}`;

  return pagina({
    titulo,
    subtitulo: 'Registros que componen el indicador.',
    ruta: '/',
    usuario,
    csrf,
    avisos,
    contenido,
    acciones: ui.enlace('/', 'Volver al inicio', { clase: 'boton boton--texto' }),
  });
}

const ENCABEZADOS = {
  club: 'Club',
  club_id: 'Ficha',
  plan_estado: 'Estado del plan',
  resultado: 'Resultado final',
  sello: 'Aprobado el',
  validado_por: 'Aprobado por',
  reunion_id: 'Reunión',
  inicio: 'Inicio',
  toma_acta: 'Toma el acta',
  compromiso_id: 'Tarea',
  descripcion: 'Compromiso',
  fecha_limite: 'Vence',
  estado: 'Estado',
  responsable: 'Responsable',
  reconfirmacion_id: 'Ficha',
  fecha_prevista: 'Prevista',
  proximo_contacto: 'Próximo contacto',
  prioridad: 'Prioridad',
  entidad: 'Entidad',
  clave: 'Clave',
  detalle: 'Detalle',
  detectado_en: 'Detectado',
  conflicto_id: 'Conflicto',
};

function encabezado(columna) {
  return ENCABEZADOS[columna] || columna;
}

function celda(columna, valor, fila) {
  if (valor === null || valor === undefined || valor === '') return html`<span class="sin-dato">—</span>`;
  if (columna === 'club_id') return ui.enlace(`/clubes/${valor}`, 'Abrir ficha');
  if (columna === 'reunion_id') return ui.enlace(`/reuniones/${valor}`, 'Abrir reunión');
  if (columna === 'reconfirmacion_id') return ui.enlace(`/reconfirmacion/${valor}`, 'Abrir ficha');
  if (columna === 'compromiso_id') return ui.enlace(`/compromisos#tarea-${valor}`, 'Ver tarea');
  if (columna === 'conflicto_id') return ui.enlace('/admin#conflictos', 'Ver conflicto');
  if (columna === 'estado' || columna === 'resultado' || columna === 'plan_estado' || columna === 'prioridad') {
    return ui.estado(String(valor));
  }
  if (/^fecha|_en$|^inicio$|contacto$|prevista$/.test(columna)) {
    return String(valor).includes('T') ? ui.fechaHora(valor) : ui.fecha(valor);
  }
  return String(valor);
}

// --- Sesión ------------------------------------------------------------------

/**
 * Pantalla de acceso. No hay lista de personas ni contraseñas: se escribe el correo y,
 * si corresponde a alguien del equipo, se genera un enlace de un solo uso.
 *
 * La respuesta es siempre la misma, exista o no ese correo. Si contestara distinto, esta
 * pantalla serviría para averiguar quién tiene cuenta.
 */
export function sesion({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Entrar',
      tono: 'acento',
      subtitulo: 'Uso interno de FUTSALA.',
      cuerpo: html`
        ${ui.formulario({
          accion: '/sesion/clave',
          csrf,
          clase: 'formulario--filas',
          cuerpo: html`
            ${ui.campo({ nombre: 'email', etiqueta: 'Tu correo', tipo: 'email', obligatorio: true, atributos: 'autocomplete="username" maxlength="100"' })}
            ${ui.campo({ nombre: 'clave', etiqueta: 'Contraseña', tipo: 'password', obligatorio: true, atributos: 'autocomplete="current-password" maxlength="128"' })}
            <div style="align-self:end">${ui.boton('Entrar', { clase: 'boton' })}</div>`,
        })}
        ${datos.firebase
          ? html`<div class="separador"></div>${bloqueGoogle({ firebase: datos.firebase, csrf, accion: '/sesion/google' })}`
          : ''}
        <div class="separador"></div>
        <p class="menor">¿Primera vez? ${ui.enlace('/registrarse', 'Creá tu cuenta')}: queda pendiente hasta que
          Dirección la apruebe.</p>`,
    })}

    ${ui.tarjeta({
      titulo: 'Entrar con un enlace de acceso',
      subtitulo: 'Si todavía no creaste contraseña, o la olvidaste. Escribí el correo con el que estás cargado.',
      cuerpo: html`
        ${ui.formulario({
          accion: '/sesion',
          csrf,
          clase: 'formulario--filas',
          cuerpo: html`
            ${ui.campo({
              nombre: 'email',
              etiqueta: 'Tu correo',
              tipo: 'email',
              obligatorio: true,
              placeholder: 'nombre@ejemplo.com',
            })}
            <div style="align-self:end">${ui.boton('Pedir enlace de acceso', { clase: 'boton' })}</div>`,
        })}
        <div class="separador"></div>
        <p class="menor">
          Se genera un enlace que sirve <strong>una sola vez</strong> y vence a los ${datos.minutos}
          minutos. ${datos.comoLlega} Una vez adentro, creá tu contraseña desde Mi cuenta.
        </p>`,
    })}

    ${ui.tarjeta({
      titulo: 'Si no podés entrar',
      cuerpo: html`
        <ul>
          ${datos.local
            ? html`<li>En esta máquina lo generás vos: <code>npm run acceso tu@correo</code> en la
                carpeta de la aplicación.</li>`
            : html`<li>Pedile el enlace a Dirección: lo genera desde Administración.</li>`}
          <li>Si el enlace venció o ya lo usaste, pedí uno nuevo: no se reciclan.</li>
          <li>Si tu usuario está inactivo, la aplicación no te deja entrar aunque tengas enlace.</li>
        </ul>`,
    })}`;

  return pagina({
    titulo: 'Acceso',
    ruta: '/sesion',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

/**
 * Confirmación antes de gastar el enlace. Se pide un clic en lugar de entrar al abrir la
 * dirección porque los navegadores y los mensajeros abren los enlaces por su cuenta para
 * previsualizarlos: si entrar fuera parte de abrirlo, el enlace se gastaría solo antes de
 * que la persona lo toque.
 */
export function entrar({ usuario, csrf, avisos, datos }) {
  const contenido = datos.valido
    ? ui.tarjeta({
        titulo: 'Entrar como',
        tono: 'acento',
        cuerpo: html`
          ${ui.listaDatos(html`
            ${ui.dato('Nombre', datos.valido.usuario.nombre)}
            ${ui.dato('Correo', html`<span class="mono">${datos.valido.usuario.email}</span>`)}
            ${ui.dato('Rol', ui.etiquetaRol(datos.valido.usuario.rol))}
          `)}
          ${ui.formulario({
            accion: '/entrar',
            csrf,
            cuerpo: html`
              <input type="hidden" name="token" value="${datos.token}">
              ${ui.boton('Entrar', { clase: 'boton' })}`,
          })}
          <p class="menor">Este enlace se gasta al entrar.</p>`,
      })
    : html`
        ${ui.aviso('Ese enlace no sirve: ya se usó, venció, o no es válido.', {
          tono: 'alerta',
          titulo: 'No se puede entrar con este enlace',
        })}
        ${ui.tarjeta({
          titulo: 'Pedí uno nuevo',
          cuerpo: html`
            <p>Los enlaces duran ${datos.minutos} minutos y sirven una sola vez.</p>
            ${ui.enlace('/sesion', 'Ir a la pantalla de acceso', { clase: 'boton' })}`,
        })}`;

  return pagina({ titulo: 'Entrar', ruta: '/sesion', usuario, csrf, avisos, contenido });
}

function descripcionRol(rol, activo) {
  if (activo !== 1) return 'Usuario inactivo: la aplicación le niega el acceso.';
  if (rol === 'Direccion') return 'Prepara planes, agenda, aprueba actas y resultados, y reabre con motivo.';
  if (rol === 'Ayudante') return 'Carga el acta de las reuniones que le asignaron y sus propias tareas.';
  return 'Solo lectura: no escribe ni por pantalla ni por petición directa.';
}

// --- Exportar ----------------------------------------------------------------

export function exportar({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Respaldo completo',
      subtitulo: 'Un archivo JSON con todas las tablas, apto para restaurar en otra instalación.',
      cuerpo: html`
        <p>
          La información es propia de la aplicación: no depende de Google Sheets ni de AppSheet.
          El respaldo incluye el historial de auditoría y los conflictos registrados.
        </p>
        <div class="acciones-fila">
          ${ui.enlace('/exportar/json', 'Descargar JSON completo', { clase: 'boton' })}
        </div>
        <p class="menor">
          Para restaurar: <span class="mono">node scripts/importar-paquete.js --json archivo.json</span>
          sobre una base vacía. Las fechas sin zona corresponden a America/Argentina/Buenos_Aires.
        </p>`,
    })}
    ${ui.tarjeta({
      titulo: 'Tablas en CSV',
      subtitulo: 'Una descarga por tabla, con encabezados.',
      cuerpo: html`
        <ul class="lista-limpia">
          ${datos.tablas.map(
            (t) => html`
              <li class="item">
                <div class="fila-entre">
                  <span class="item__titulo">${t.nombre}</span>
                  <span class="acciones-fila">
                    <span class="menor">${t.filas} fila(s)</span>
                    ${ui.enlace(`/exportar/csv/${t.nombre}`, 'CSV', { clase: 'boton boton--secundario boton--chico' })}
                  </span>
                </div>
              </li>`,
          )}
        </ul>`,
    })}
    ${ui.tarjeta({
      titulo: 'Copia del archivo de base',
      cuerpo: html`
        <p>
          Toda la información vive en un único archivo SQLite:
          <span class="mono">${datos.rutaBase}</span>. Copiarlo con la aplicación detenida
          es un respaldo completo; restaurarlo es volver a ponerlo en su lugar.
        </p>`,
    })}`;

  return pagina({
    titulo: 'Exportar datos',
    subtitulo: 'Portabilidad: la información sale de la app sin intermediarios.',
    ruta: '/exportar',
    usuario,
    csrf,
    avisos,
    contenido,
  });
}

// --- Errores -----------------------------------------------------------------

export function conflictoVersion({ usuario, csrf, avisos, datos }) {
  const { error } = datos;
  const contenido = html`
    ${ui.aviso(
      'Dos personas editaron el mismo registro. No se sobrescribió nada: tu cambio no se guardó y el de la otra persona quedó intacto.',
      { tono: 'alerta', titulo: 'Conflicto de edición' },
    )}
    ${ui.tarjeta({
      titulo: 'Diferencias',
      subtitulo: `Tu formulario venía de la versión ${error.versionEnviada ?? '—'}; en la base ya está la versión ${error.versionActual}.`,
      cuerpo:
        error.diferencias.length === 0
          ? ui.vacio('No hay diferencias de contenido: alguien guardó el mismo registro justo antes.')
          : html`<div class="diferencias">
              ${error.diferencias.map(
                (d) => html`
                  <div class="diferencia">
                    <strong>${d.etiqueta}</strong>
                    <div class="diferencia__fila"><span>Guardado</span><span>${d.actual ?? '—'}</span></div>
                    <div class="diferencia__fila"><span>Tu cambio</span><span>${d.enviado ?? '—'}</span></div>
                  </div>`,
              )}
            </div>`,
    })}
    ${ui.tarjeta({
      titulo: 'Qué hacer',
      cuerpo: html`
        <p>Volvé a abrir el registro, revisá lo que guardó la otra persona y aplicá tu cambio sobre esa versión.</p>
        <div class="acciones-fila">${ui.enlace(error.volverA || '/', 'Volver y recargar', { clase: 'boton' })}</div>`,
    })}`;

  return pagina({ titulo: 'Conflicto de edición', ruta: '/', usuario, csrf, avisos, contenido });
}

export function error({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.tarjeta({
      titulo: datos.titulo,
      cuerpo: html`
        ${parrafos(datos.mensaje)}
        ${datos.ayuda ? ui.aviso(datos.ayuda, { tono: 'info' }) : ''}
        <div class="acciones-fila">${ui.enlace(datos.volverA || '/', 'Volver', { clase: 'boton' })}</div>`,
    })}`;
  return pagina({ titulo: datos.titulo, ruta: '/', usuario, csrf, avisos, contenido });
}
