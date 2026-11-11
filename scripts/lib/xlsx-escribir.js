// Escribe un libro de Excel (.xlsx) de una hoja, sin dependencias externas.
//
// Un .xlsx es un ZIP con unos pocos archivos XML adentro. Acá se arma el mínimo que
// Excel acepta: tipos de contenido, relaciones, el libro, la hoja y los estilos. El ZIP
// se comprime con `deflateRawSync`, que viene en Node.
//
// No pretende ser general: hace falta para sacar planillas de ida y vuelta (la de
// prioridades), no para reproducir Excel.
import { writeFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';

const escapar = (valor) =>
  String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** A, B, C… Z, AA, AB. */
export function letraDeColumna(indice) {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - resto) / 26);
  }
  return letras;
}

/**
 * Genera el .xlsx.
 *
 * - `columnas`: los encabezados, que van en negrita y quedan fijos al desplazarse.
 * - `filas`: cada una, un arreglo de valores. Un número entra como número (para que
 *   Excel lo trate como tal y la lista desplegable lo reconozca); lo demás, como texto.
 * - `anchos`: ancho de cada columna, en caracteres.
 * - `lista`: `{ columna, valores }` agrega una lista desplegable en esa columna, para
 *   que no haya que escribir el valor a mano ni se pueda escribir cualquier cosa.
 */
export function escribirHoja(ruta, { nombreHoja = 'Hoja1', columnas, filas, anchos = [], lista = null }) {
  const ultimaColumna = letraDeColumna(columnas.length - 1);
  const ultimaFila = filas.length + 1;

  const celda = (valor, columna, fila, estilo = 0) => {
    const ref = `${letraDeColumna(columna)}${fila}`;
    const atributoEstilo = estilo ? ` s="${estilo}"` : '';
    if (valor === null || valor === undefined || valor === '') return `<c r="${ref}"${atributoEstilo}/>`;
    // Un número escrito como número: si fuera texto, Excel lo marcaría con el triangulito
    // verde y la lista desplegable no lo daría por válido.
    if (typeof valor === 'number' || /^\d+$/.test(String(valor))) {
      return `<c r="${ref}"${atributoEstilo}><v>${escapar(valor)}</v></c>`;
    }
    return `<c r="${ref}"${atributoEstilo} t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
  };

  const filasXml = [
    `<row r="1">${columnas.map((c, i) => celda(c, i, 1, 1)).join('')}</row>`,
    ...filas.map((f, i) => `<row r="${i + 2}">${f.map((v, j) => celda(v, j, i + 2)).join('')}</row>`),
  ].join('');

  const colsXml =
    anchos.length > 0
      ? `<cols>${anchos.map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`).join('')}</cols>`
      : '';

  // El orden de los elementos de una hoja está fijado por el formato: cols, sheetData,
  // autoFilter y recién después dataValidations. Fuera de ese orden, Excel la rechaza.
  const validacionXml = lista
    ? `<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"` +
      ` errorTitle="Valor no válido" error="Elegí uno de la lista." sqref="${lista.columna}2:${lista.columna}${ultimaFila}">` +
      `<formula1>"${lista.valores.join(',')}"</formula1></dataValidation></dataValidations>`
    : '';

  const hoja =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${ultimaColumna}${ultimaFila}"/>` +
    `<sheetViews><sheetView tabSelected="1" workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    colsXml +
    `<sheetData>${filasXml}</sheetData>` +
    `<autoFilter ref="A1:${ultimaColumna}${ultimaFila}"/>` +
    validacionXml +
    `</worksheet>`;

  const estilos =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `</styleSheet>`;

  const archivos = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
        ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${escapar(nombreHoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ],
    ['xl/styles.xml', estilos],
    ['xl/worksheets/sheet1.xml', hoja],
  ];

  writeFileSync(ruta, armarZip(archivos));
  return ruta;
}

/** ZIP mínimo, con los archivos comprimidos. */
function armarZip(archivos) {
  const locales = [];
  const central = [];
  let desplazamiento = 0;

  for (const [nombre, contenido] of archivos) {
    const datos = Buffer.from(contenido, 'utf8');
    const comprimido = deflateRawSync(datos);
    const nombreBuffer = Buffer.from(nombre, 'utf8');
    const suma = crc32(datos);

    const encabezadoLocal = Buffer.alloc(30);
    encabezadoLocal.writeUInt32LE(0x04034b50, 0);
    encabezadoLocal.writeUInt16LE(20, 4); // versión necesaria
    encabezadoLocal.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    encabezadoLocal.writeUInt16LE(8, 8); // deflate
    encabezadoLocal.writeUInt32LE(suma, 14);
    encabezadoLocal.writeUInt32LE(comprimido.length, 18);
    encabezadoLocal.writeUInt32LE(datos.length, 22);
    encabezadoLocal.writeUInt16LE(nombreBuffer.length, 26);
    locales.push(encabezadoLocal, nombreBuffer, comprimido);

    const encabezadoCentral = Buffer.alloc(46);
    encabezadoCentral.writeUInt32LE(0x02014b50, 0);
    encabezadoCentral.writeUInt16LE(20, 4);
    encabezadoCentral.writeUInt16LE(20, 6);
    encabezadoCentral.writeUInt16LE(0x0800, 8);
    encabezadoCentral.writeUInt16LE(8, 10);
    encabezadoCentral.writeUInt32LE(suma, 16);
    encabezadoCentral.writeUInt32LE(comprimido.length, 20);
    encabezadoCentral.writeUInt32LE(datos.length, 24);
    encabezadoCentral.writeUInt16LE(nombreBuffer.length, 28);
    encabezadoCentral.writeUInt32LE(desplazamiento, 42);
    central.push(encabezadoCentral, nombreBuffer);

    desplazamiento += encabezadoLocal.length + nombreBuffer.length + comprimido.length;
  }

  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([...locales, directorio, fin]);
}
