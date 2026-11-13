// Pantallas de ingreso con contraseña y Google: el bloque de Google, el registro y Mi cuenta.
import { html } from '../html.js';
import * as ui from '../ui.js';
import { pagina } from '../layout.js';
import { VERSION_SDK } from '../../lib/firebase.js';

const LOGO_GOOGLE = html`<svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-5 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>`;

/**
 * Formulario que se completa con el token de Google y se envía solo. `/google.js` abre la
 * ventana de Google, pone el token en el campo oculto y lo manda: el servidor lo verifica.
 */
export function bloqueGoogle({ firebase, csrf, accion, texto = 'Continuar con Google', extra = '' }) {
  if (!firebase) return '';
  return html`
    ${ui.formulario({
      accion,
      csrf,
      clase: 'google-ingreso',
      cuerpo: html`
        <span hidden class="google-ingreso__datos" data-api-key="${firebase.apiKey}" data-auth-domain="${firebase.authDomain}"
          data-project-id="${firebase.projectId}" data-app-id="${firebase.appId}" data-sdk="${VERSION_SDK}"></span>
        <input type="hidden" name="credencial" value="">
        ${extra}
        <button type="button" class="boton boton--secundario google-ingreso__boton">${LOGO_GOOGLE} ${texto}</button>
        <p class="menor google-ingreso__mensaje" role="status" aria-live="polite"></p>`,
    })}
    <script type="module" src="/google.js"></script>`;
}

const ayudaClave = 'Entre 8 y 128 caracteres, con al menos un signo (por ejemplo !, @ o #).';
const campoClave = (nombre, etiqueta, nueva = false) =>
  ui.campo({
    nombre,
    etiqueta,
    tipo: 'password',
    obligatorio: true,
    atributos: `autocomplete="${nueva ? 'new-password' : 'current-password'}" maxlength="128"${nueva ? ' minlength="8"' : ''}`,
  });

export function registro({ usuario, csrf, avisos, datos }) {
  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Crear cuenta',
      tono: 'acento',
      subtitulo: 'Para el equipo de FUTSALA. Tu cuenta queda pendiente hasta que Dirección la apruebe y te asigne un rol.',
      cuerpo: html`
        ${ui.formulario({
          accion: '/registrarse',
          csrf,
          clase: 'formulario--filas',
          cuerpo: html`
            ${ui.campo({ nombre: 'nombre', etiqueta: 'Nombre y apellido', obligatorio: true, atributos: 'autocomplete="name" maxlength="80"' })}
            ${ui.campo({ nombre: 'email', etiqueta: 'Tu correo', tipo: 'email', obligatorio: true, atributos: 'autocomplete="username" maxlength="100"' })}
            ${campoClave('clave', 'Contraseña', true)}
            ${campoClave('repetir', 'Repetí la contraseña', true)}
            <p class="menor">${ayudaClave}</p>
            <div style="align-self:end">${ui.boton('Crear cuenta', { clase: 'boton' })}</div>`,
        })}
        ${datos.firebase
          ? html`<div class="separador"></div>
              <p class="menor">O pedí acceso con tu cuenta Google:</p>
              ${bloqueGoogle({ firebase: datos.firebase, csrf, accion: '/sesion/google' })}`
          : ''}
        <div class="separador"></div>
        <p class="menor">${ui.enlace('/sesion', 'Ya tengo cuenta')}</p>`,
    })}`;
  return pagina({ titulo: 'Crear cuenta', ruta: '/sesion', usuario, csrf, avisos, contenido });
}

export function cuenta({ usuario, csrf, avisos, datos }) {
  const { tieneClave, tieneGoogle, firebase } = datos;
  const contenido = html`
    ${ui.tarjeta({
      titulo: 'Mi cuenta',
      tono: 'acento',
      cuerpo: html`
        ${ui.listaDatos(html`
          ${ui.dato('Nombre', usuario.nombre)}
          ${ui.dato('Correo', html`<span class="mono">${usuario.email}</span>`)}
          ${ui.dato('Rol', ui.etiquetaRol(usuario.rol))}
          ${ui.dato('Contraseña', tieneClave ? 'Creada' : 'Todavía no creaste una')}
          ${ui.dato('Google', tieneGoogle ? 'Vinculado' : 'Sin vincular')}
        `)}`,
    })}

    ${ui.tarjeta({
      titulo: tieneClave ? 'Cambiar contraseña' : 'Crear contraseña',
      id: 'clave',
      subtitulo: tieneClave ? null : 'Así podés entrar con tu correo y contraseña, sin pedir enlaces.',
      cuerpo: ui.formulario({
        accion: '/cuenta/clave',
        csrf,
        clase: 'formulario--filas',
        cuerpo: html`
          ${tieneClave ? campoClave('actual', 'Contraseña actual') : ''}
          ${campoClave('clave', 'Nueva contraseña', true)}
          ${campoClave('repetir', 'Repetí la nueva contraseña', true)}
          <p class="menor">${ayudaClave}</p>
          <div style="align-self:end">${ui.boton('Guardar contraseña', { clase: 'boton' })}</div>`,
      }),
    })}

    ${firebase
      ? ui.tarjeta({
          titulo: 'Cuenta Google',
          id: 'google',
          cuerpo: tieneGoogle
            ? html`<p>Tu cuenta Google está vinculada: podés entrar con el botón de Google.</p>`
            : html`
                <p>Elegí la cuenta Google con tu mismo correo (<span class="mono">${usuario.email}</span>).
                  ${tieneClave ? 'Para vincularla, confirmá tu contraseña.' : ''}</p>
                ${bloqueGoogle({
                  firebase,
                  csrf,
                  accion: '/cuenta/google',
                  texto: 'Vincular Google',
                  extra: tieneClave ? campoClave('clave', 'Contraseña actual') : '',
                })}`,
        })
      : ''}`;
  return pagina({ titulo: 'Mi cuenta', ruta: '/cuenta', usuario, csrf, avisos, contenido });
}
