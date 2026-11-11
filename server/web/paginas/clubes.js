import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';

export function render({ usuario, csrf, avisos, datos }) {
  const puedeCrear = usuario && usuario.rol === 'Direccion' && usuario.activo === 1;

  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Buscar',
      cuerpo: html`
        <form method="get" action="/clubes" class="formulario formulario--filas">
          ${ui.campo({
            nombre: 'q',
            etiqueta: 'Nombre o localidad',
            valor: datos.busqueda,
            placeholder: 'Escribí para filtrar',
            atributos: 'data-buscador autocomplete="off"',
          })}
          ${ui.seleccion({
            nombre: 'estado',
            etiqueta: 'Estado del plan',
            valor: datos.estado,
            vacioTexto: 'Todos',
            opciones: ['Sin plan', 'Abierta', 'Cerrada', 'Archivada'].map((e) => ({ valor: e, texto: e })),
          })}
          <div class="acciones-fila" style="align-self:end">
            ${ui.boton('Filtrar', { clase: 'boton boton--secundario' })}
            ${ui.enlace('/clubes', 'Limpiar', { clase: 'boton boton--texto' })}
          </div>
        </form>`,
    })}

    ${ui.tarjeta({
      titulo: `Clubes (${datos.clubes.length})`,
      subtitulo: 'Avance del ciclo y próxima acción de cada club.',
      cuerpo:
        datos.clubes.length === 0
          ? ui.vacio(
              datos.busqueda || datos.estado ? 'Ningún club coincide con el filtro.' : 'Todavía no hay clubes cargados.',
              puedeCrear ? 'Usá el formulario de abajo para crear el primero.' : null,
            )
          : html`<ul class="lista-limpia">
              ${datos.clubes.map((c) => tarjetaClub(c))}
            </ul>`,
    })}

    ${puedeCrear
      ? ui.tarjeta({
          titulo: 'Nuevo club',
          subtitulo: 'Los nombres parecidos se avisan, no se bloquean: puede haber homónimos reales.',
          id: 'nuevo',
          cuerpo: ui.formulario({
            accion: '/clubes',
            csrf,
            clase: 'formulario--filas',
            cuerpo: html`
              ${ui.campo({ nombre: 'nombre', etiqueta: 'Nombre del club', obligatorio: true })}
              ${ui.campo({ nombre: 'localidad', etiqueta: 'Localidad' })}
              ${ui.campo({ nombre: 'contacto_nombre', etiqueta: 'Contacto del club' })}
              ${ui.campo({ nombre: 'contacto_email', etiqueta: 'Correo de contacto', tipo: 'email' })}
              ${ui.campo({ nombre: 'contacto_telefono', etiqueta: 'Teléfono' })}
              ${ui.seleccion({
                nombre: 'responsable_id',
                etiqueta: 'Responsable en FUTSALA',
                opciones: ui.opcionesUsuarios(datos.usuariosActivos),
              })}
              ${ui.campo({
                nombre: 'analisis_url',
                etiqueta: 'Análisis 2026 (enlace)',
                ayuda: 'Opcional. Enlace al material que ya existe.',
              })}
              <div style="align-self:end">
                ${ui.casilla({ nombre: 'contacto_directo', etiqueta: 'Lo contactan los directivos' })}
              </div>
              <div style="align-self:end">${ui.boton('Crear club')}</div>`,
          }),
        })
      : usuario
        ? ui.aviso('Solo Dirección crea clubes.', { tono: 'info' })
        : ''}`;

  return pagina({
    titulo: 'Clubes',
    subtitulo: 'Clientes del ciclo 2026/2027.',
    ruta: '/clubes',
    usuario,
    csrf,
    avisos,
    contenido,
    acciones: puedeCrear ? ui.enlace('/clubes#nuevo', 'Nuevo club', { clase: 'boton' }) : null,
  });
}

function tarjetaClub(c) {
  const tono = c.conflictos > 0 ? 'item--alerta' : c.tareas_abiertas > 0 ? 'item--aviso' : '';
  return html`
    <li class="item ${tono}">
      <div class="fila-entre">
        <span class="item__titulo">${ui.enlace(`/clubes/${c.id}`, c.nombre)}</span>
        <span class="acciones-fila">
          ${c.plan_estado ? ui.estado(c.plan_estado) : ui.estado('Sin plan del ciclo', { tono: 'aviso' })}
          ${ui.etiquetaPrioridad(c.prioridad)}
          ${ui.etiquetaContactoDirecto(c)}
          ${c.activo !== 1 ? ui.estado('Club inactivo', { tono: 'neutro' }) : ''}
        </span>
      </div>
      <span class="item__meta">
        ${c.localidad || 'sin localidad'} · responsable ${c.responsable_nombre || 'sin asignar'}
      </span>
      ${c.plan_id
        ? html`
            <span class="item__meta">
              ${c.disciplinas} disciplina(s) ·
              ${c.actas_validadas > 0 ? ui.estado('acta aprobada', { tono: 'exito' }) : ui.estado('sin acta aprobada', { tono: 'neutro' })}
              ${c.reuniones_programadas > 0 ? html`· ${c.reuniones_programadas} reunión(es) programada(s)` : ''}
              ${c.tareas_abiertas > 0 ? ui.estado(`${c.tareas_abiertas} tarea(s) abierta(s)`, { tono: 'aviso' }) : ''}
              ${c.recon_estado
                ? ui.estado(
                    c.recon_validada_en ? `Final: ${c.recon_estado}` : `Reconfirmación: ${c.recon_estado}`,
                    { tono: c.recon_validada_en && c.recon_estado === 'Confirmado' ? 'exito' : 'neutro' },
                  )
                : ui.estado('sin ficha final', { tono: 'neutro' })}
              ${c.conflictos > 0 ? ui.estado('conflicto de datos', { tono: 'alerta' }) : ''}
            </span>`
        : html`<span class="item__meta">Todavía no tiene plan del ciclo.</span>`}
    </li>`;
}
