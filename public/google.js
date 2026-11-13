// Botón "Continuar con Google". Carga el SDK oficial de Firebase desde gstatic (sin
// instalar nada), abre la ventana de Google y manda el token con el formulario, igual
// que cualquier otro formulario de la aplicación: el servidor lo verifica.
// La sesión de Firebase vive solo en memoria y se cierra apenas se obtiene el token.
const formularios = [...document.querySelectorAll('form.google-ingreso')];
const mensajesError = {
  'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
  'auth/cancelled-popup-request': 'Cerraste la ventana de Google antes de terminar.',
  'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio y reintentá.',
  'auth/unauthorized-domain': 'Este dominio todavía no está autorizado para entrar con Google.',
  'auth/network-request-failed': 'No se pudo conectar con Google. Revisá tu conexión.',
};

let sdk = null;
function cargar(datos) {
  const base = `https://www.gstatic.com/firebasejs/${datos.sdk}/`;
  sdk ||= Promise.all([import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`)])
    .then(([app, A]) => ({
      A,
      auth: A.initializeAuth(
        app.initializeApp({ apiKey: datos.apiKey, authDomain: datos.authDomain, projectId: datos.projectId, appId: datos.appId }),
        { persistence: A.inMemoryPersistence, popupRedirectResolver: A.browserPopupRedirectResolver },
      ),
    }))
    .catch((error) => {
      sdk = null;
      throw error;
    });
  return sdk;
}

for (const formulario of formularios) {
  const datos = formulario.querySelector('.google-ingreso__datos').dataset;
  const boton = formulario.querySelector('.google-ingreso__boton');
  const mensaje = formulario.querySelector('.google-ingreso__mensaje');
  // Se carga antes del clic: así la ventana de Google sale del clic y el navegador no la bloquea.
  cargar(datos).catch(() => {
    mensaje.textContent = 'No se pudo conectar con Google. Podés entrar con correo y contraseña.';
  });

  boton.addEventListener('click', async () => {
    if (!formulario.reportValidity()) return;
    boton.disabled = true;
    mensaje.textContent = '';
    try {
      const { A, auth } = await cargar(datos);
      const proveedor = new A.GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: 'select_account' });
      const resultado = await A.signInWithPopup(auth, proveedor);
      formulario.querySelector('[name=credencial]').value = await resultado.user.getIdToken();
      await A.signOut(auth);
      mensaje.textContent = 'Verificando…';
      formulario.submit();
    } catch (error) {
      mensaje.textContent = mensajesError[error?.code] || 'No se pudo entrar con Google. Volvé a intentar.';
      boton.disabled = false;
    }
  });
}
