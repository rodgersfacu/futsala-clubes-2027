// Lector mínimo de .xlsx, sin dependencias.
// Un .xlsx es un ZIP con XML adentro: se lee el directorio central del ZIP, se
// descomprime cada parte con zlib y se interpretan las celdas de la hoja pedida.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const FIRMA_DIRECTORIO = 0x02014b50;
const FIRMA_FIN = 0x06054b50;

function abrirZip(ruta) {
  const datos = readFileSync(ruta);

  // El registro de fin del directorio central está al final, con comentario variable.
  let fin = -1;
  for (let i = datos.length - 22; i >= 0 && i > datos.length - 66000; i -= 1) {
    if (datos.readUInt32LE(i) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin === -1) throw new Error('El archivo no parece un .xlsx válido (no se encontró el directorio del ZIP).');

  const cantidad = datos.readUInt16LE(fin + 10);
  let posicion = datos.readUInt32LE(fin + 16);
  const partes = new Map();

  for (let i = 0; i < cantidad; i += 1) {
    if (datos.readUInt32LE(posicion) !== FIRMA_DIRECTORIO) break;
    const metodo = datos.readUInt16LE(posicion + 10);
    const comprimido = datos.readUInt32LE(posicion + 20);
    const largoNombre = datos.readUInt16LE(posicion + 28);
    const largoExtra = datos.readUInt16LE(posicion + 30);
    const largoComentario = datos.readUInt16LE(posicion + 32);
    const desplazamiento = datos.readUInt32LE(posicion + 42);
    const nombre = datos.toString('utf8', posicion + 46, posicion + 46 + largoNombre);

    const nombreLocal = datos.readUInt16LE(desplazamiento + 26);
    const extraLocal = datos.readUInt16LE(desplazamiento + 28);
    const inicio = desplazamiento + 30 + nombreLocal + extraLocal;
    const crudo = datos.subarray(inicio, inicio + comprimido);

    partes.set(nombre, metodo === 0 ? crudo : inflateRawSync(crudo));
    posicion += 46 + largoNombre + largoExtra + largoComentario;
  }
  return partes;
}

function entidades(texto) {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

function textoDe(xml) {
  return entidades([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
}

export function columnaANumero(letras) {
  let n = 0;
  for (const letra of letras) n = n * 26 + (letra.charCodeAt(0) - 64);
  return n;
}

/**
 * Devuelve las filas de una hoja como objetos { A: valor, B: valor, ... }.
 * Los valores llegan como texto, con los saltos de línea de la celda conservados.
 */
export function leerHoja(rutaArchivo, nombreHoja) {
  const partes = abrirZip(rutaArchivo);
  const texto = (nombre) => {
    const parte = partes.get(nombre);
    return parte ? parte.toString('utf8') : null;
  };

  const libro = texto('xl/workbook.xml');
  if (!libro) throw new Error('El archivo no tiene xl/workbook.xml');

  const hojas = [...libro.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g)].map((m) => ({
    nombre: entidades(m[1]),
    rel: m[2],
  }));
  // Sin nombre, la primera hoja: es la que abre Excel y la única que tiene un libro
  // guardado desde una planilla de una sola hoja.
  const hoja = nombreHoja === undefined ? hojas[0] : hojas.find((h) => h.nombre === nombreHoja);
  if (!hoja) {
    throw new Error(`No existe la hoja "${nombreHoja}". Hojas disponibles: ${hojas.map((h) => h.nombre).join(', ')}`);
  }

  const relaciones = texto('xl/_rels/workbook.xml.rels') || '';
  const destino = [...relaciones.matchAll(/<Relationship Id="([^"]*)"[^>]*Target="([^"]*)"/g)].find(
    (m) => m[1] === hoja.rel,
  );
  if (!destino) throw new Error(`No se pudo ubicar el archivo de la hoja "${nombreHoja}".`);
  const rutaHoja = destino[2].startsWith('/') ? destino[2].slice(1) : `xl/${destino[2]}`;

  const compartidasXml = texto('xl/sharedStrings.xml');
  const compartidas = compartidasXml
    ? [...compartidasXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1]))
    : [];

  const hojaXml = texto(rutaHoja);
  if (!hojaXml) throw new Error(`No se encontró ${rutaHoja} dentro del archivo.`);

  const filas = [];
  for (const fila of hojaXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = { _fila: Number(fila[1]) };
    // El grupo de atributos es perezoso: si fuera codicioso se comería la barra de "/>".
    for (const celda of fila[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const columna = celda[1];
      const tipo = (celda[2].match(/t="([^"]+)"/) || [])[1];
      const cuerpo = celda[3] || '';
      let valor = '';
      if (tipo === 'inlineStr') {
        valor = textoDe(cuerpo);
      } else {
        const bruto = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (bruto !== undefined) {
          valor = tipo === 's' ? compartidas[Number(bruto)] ?? '' : entidades(bruto);
        }
      }
      if (valor !== '') celdas[columna] = valor;
    }
    if (Object.keys(celdas).length > 1) filas.push(celdas);
  }
  return filas;
}
