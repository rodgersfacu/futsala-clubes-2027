// Mejoras mínimas de interfaz. La aplicación funciona sin JavaScript:
// todo se envía con formularios normales y se valida en el servidor.

// Confirmación dentro de la página. No se usa el cuadro de diálogo del navegador
// porque, si está bloqueado o alguien marcó "no mostrar más diálogos", devuelve que
// no y la acción se cancela sin decir nada: parece que el botón no funciona.
document.addEventListener('submit', (evento) => {
  const formulario = evento.target;
  if (formulario.dataset.confirmado === 'si') return;
  const boton = evento.submitter;
  const mensaje = boton?.dataset.confirmar || formulario.dataset.confirmar;
  if (!mensaje) return;
  evento.preventDefault();
  pedirConfirmacion(formulario, mensaje, boton);
});

function pedirConfirmacion(formulario, mensaje, boton) {
  formulario.querySelector('.confirmacion')?.remove();

  const caja = document.createElement('div');
  caja.className = 'confirmacion';
  const texto = document.createElement('p');
  texto.textContent = mensaje;
  const acciones = document.createElement('div');
  acciones.className = 'acciones-fila';

  const si = document.createElement('button');
  si.type = 'button';
  si.className = 'boton boton--chico';
  si.textContent = 'Sí, confirmar';
  si.addEventListener('click', () => {
    formulario.dataset.confirmado = 'si';
    caja.remove();
    if (typeof formulario.requestSubmit === 'function') formulario.requestSubmit(boton || undefined);
    else formulario.submit();
  });

  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'boton boton--secundario boton--chico';
  no.textContent = 'Cancelar';
  no.addEventListener('click', () => caja.remove());

  acciones.append(si, no);
  caja.append(texto, acciones);
  formulario.append(caja);
  caja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  si.focus();
}

// Cuando falta completar un campo obligatorio, el navegador frena el envío y muestra un
// globito que puede quedar fuera de la pantalla. Acá se abre la sección que lo contiene,
// se lleva el campo a la vista y se lo marca, para que no parezca que no pasó nada.
document.addEventListener(
  'invalid',
  (evento) => {
    const campo = evento.target;
    campo.closest('details')?.setAttribute('open', '');
    campo.classList.add('campo--error');
    if (!document.querySelector('.campo--error:not(:scope)')) {
      campo.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  },
  true,
);

document.addEventListener('input', (evento) => evento.target.classList?.remove('campo--error'));
document.addEventListener('change', (evento) => evento.target.classList?.remove('campo--error'));

// Buscador de clubes: envía al soltar la tecla, sin perder el funcionamiento sin JS.
const buscador = document.querySelector('[data-buscador]');
if (buscador) {
  let temporizador;
  buscador.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => buscador.form.requestSubmit(), 350);
  });
}

// Abre la sección indicada en el enlace (#tiras, #reuniones, ...) si está plegada.
if (location.hash) {
  const destino = document.querySelector(location.hash);
  if (destino && destino.tagName === 'DETAILS') destino.open = true;
}
