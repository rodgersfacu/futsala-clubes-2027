import { html, crudo, aTexto } from './html.js';
import { etiquetaRol } from './ui.js';

// Los íconos toman el color del texto, así sirven igual en la barra clara y en la oscura.
const ESCUDO = crudo(`
  <svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
       stroke-linejoin="round" aria-hidden="true">
    <path d="M12 2.8 3.8 5.7v6.4c0 4.7 3.4 8.3 8.2 9.5 4.8-1.2 8.2-4.8 8.2-9.5V5.7L12 2.8z"/>
    <path d="M12 5.6 6.4 7.6v4.5c0 3.3 2.3 5.8 5.6 6.8 3.3-1 5.6-3.5 5.6-6.8V7.6L12 5.6z" fill="currentColor" stroke="none"/>
  </svg>`);

const CALENDARIO = crudo(`
  <svg class="icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3.2" y="5.2" width="17.6" height="15.6" rx="2.6"/>
    <path d="M8 2.9v4.2M16 2.9v4.2M3.2 10.2h17.6"/>
    <path d="M7.2 13.6h1.9M11.1 13.6H13M14.9 13.6h1.9M7.2 17.2h1.9M11.1 17.2H13M14.9 17.2h1.9"/>
  </svg>`);

const PRINCIPALES = [
  { href: '/', texto: 'Inicio', icono: '◧' },
  { href: '/clubes', texto: 'Clubes', icono: ESCUDO },
  { href: '/agenda', texto: 'Agenda', icono: CALENDARIO },
  { href: '/compromisos', texto: 'Tareas', icono: '✓' },
  { href: '/reconfirmacion', texto: 'Reconfirmar', icono: '↻' },
];

const SECUNDARIAS = [
  { href: '/disponibilidad', texto: 'Disponibilidad' },
  { href: '/historial', texto: 'Historial' },
  { href: '/admin', texto: 'Administración' },
  { href: '/exportar', texto: 'Exportar datos' },
  { href: '/acerca', texto: 'Estado de la app' },
];

function activa(ruta, href) {
  if (href === '/') return ruta === '/';
  return ruta === href || ruta.startsWith(`${href}/`);
}

const MARCA = html`
  <span class="marca">
    <img class="marca__logo" src="/marca.webp" alt="FUTSALA" width="2000" height="1767">
    <span class="marca__texto">
      <small>Reuniones 2027</small>
    </span>
  </span>`;

/**
 * Cascarón de la aplicación. En escritorio hay columna lateral; en teléfono,
 * barra inferior con las cinco pantallas principales.
 */
export function pagina({
  titulo,
  ruta = '/',
  usuario = null,
  csrf = '',
  avisos = [],
  contenido,
  subtitulo = null,
  acciones = null,
  anchoCompleto = false,
}) {
  const cuerpo = html`<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${titulo ? `${titulo} · FUTSALA` : 'FUTSALA Reuniones 2027'}</title>
  <link rel="stylesheet" href="/estilos.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <a class="salto" href="#principal">Ir al contenido</a>
  <header class="encabezado">
    <a class="encabezado__marca" href="/">${MARCA}</a>
    <div class="encabezado__ciclo">Temporada 2027</div>
    <div class="encabezado__usuario">
      ${usuario
        ? html`
            <span class="usuario">
              <a class="usuario__nombre" href="/cuenta" title="Mi cuenta">${usuario.nombre}</a>
              ${etiquetaRol(usuario.rol)}
              ${usuario.activo !== 1 ? html`<span class="chip chip--alerta">inactivo</span>` : ''}
            </span>
            <form method="post" action="/sesion/salir" class="en-linea">
              <input type="hidden" name="csrf" value="${csrf}">
              <button class="boton boton--texto" type="submit">Salir</button>
            </form>`
        : html`<a class="boton boton--texto" href="/sesion">Acceder</a>`}
    </div>
  </header>

  <div class="disposicion">
    <nav class="lateral" aria-label="Secciones">
      <ul class="lateral__lista">
        ${PRINCIPALES.map(
          (item) => html`
            <li>
              <a class="lateral__enlace${activa(ruta, item.href) ? crudo(' es-activa') : ''}" href="${item.href}">
                <span class="lateral__icono" aria-hidden="true">${item.icono}</span>${item.texto}
              </a>
            </li>`,
        )}
      </ul>
      <p class="lateral__titulo">Más</p>
      <ul class="lateral__lista lateral__lista--secundaria">
        ${SECUNDARIAS.map(
          (item) => html`
            <li>
              <a class="lateral__enlace${activa(ruta, item.href) ? crudo(' es-activa') : ''}" href="${item.href}">
                ${item.texto}
              </a>
            </li>`,
        )}
      </ul>
      <p class="lateral__nota">
        Uso interno. Se entra con enlace de un solo uso.
        <a href="/acerca">Qué funciona y qué falta</a>
      </p>
    </nav>

    <main class="principal${anchoCompleto ? crudo(' principal--ancho') : ''}" id="principal">
      ${titulo
        ? html`
            <div class="titulo-pagina">
              <div>
                <h1>${titulo}</h1>
                ${subtitulo ? html`<p class="titulo-pagina__subtitulo">${subtitulo}</p>` : ''}
              </div>
              ${acciones ? html`<div class="titulo-pagina__acciones">${acciones}</div>` : ''}
            </div>`
        : ''}
      ${avisos.map(
        (item) => html`
          <div class="franja franja--${crudo(item.tono || 'info')}" role="status">
            <span>${item.texto}</span>
            ${item.ayuda ? html`<small>${item.ayuda}</small>` : ''}
          </div>`,
      )}
      ${contenido}
    </main>
  </div>

  <nav class="barra-inferior" aria-label="Secciones principales">
    ${PRINCIPALES.map(
      (item) => html`
        <a class="barra-inferior__enlace${activa(ruta, item.href) ? crudo(' es-activa') : ''}" href="${item.href}">
          <span aria-hidden="true">${item.icono}</span>
          <small>${item.texto}</small>
        </a>`,
    )}
  </nav>

  <script src="/app.js" defer></script>
</body>
</html>`;
  return aTexto(cuerpo);
}
