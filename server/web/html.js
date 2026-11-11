// Plantillas HTML con escape por omisión: todo lo interpolado se escapa salvo que
// se marque explícitamente como HTML ya seguro.
const CRUDO = Symbol('html-crudo');

export function escapar(valor) {
  if (valor === null || valor === undefined || valor === false) return '';
  return String(valor).replace(/[&<>"']/g, (caracter) => {
    switch (caracter) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export function crudo(texto) {
  return { [CRUDO]: String(texto ?? '') };
}

function pintar(valor) {
  if (valor === null || valor === undefined || valor === false || valor === true) return '';
  if (typeof valor === 'object' && CRUDO in valor) return valor[CRUDO];
  if (Array.isArray(valor)) return valor.map(pintar).join('');
  return escapar(valor);
}

export function html(cadenas, ...valores) {
  let salida = cadenas[0];
  for (let i = 0; i < valores.length; i += 1) {
    salida += pintar(valores[i]) + cadenas[i + 1];
  }
  return crudo(salida);
}

export function aTexto(nodo) {
  return pintar(nodo);
}

/** Convierte saltos de línea en párrafos; el contenido se escapa. */
export function parrafos(texto) {
  const limpio = String(texto ?? '').trim();
  if (!limpio) return crudo('');
  return crudo(
    limpio
      .split(/\n{2,}/)
      .map((bloque) => `<p>${escapar(bloque).replace(/\n/g, '<br>')}</p>`)
      .join(''),
  );
}
