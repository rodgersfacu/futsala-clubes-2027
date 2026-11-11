// Exporta la base a JSON y CSV desde la línea de comandos, para respaldos programados.
// Uso: node scripts/exportar.js [carpeta-destino]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { abrirBase, RAIZ } from '../server/db.js';
import { hoy } from '../server/lib/fechas.js';
import { respaldoCompleto, datosDeTabla, aCsv, TABLAS } from '../server/dominio/exportar.js';

abrirBase();

const destino = process.argv[2] || join(RAIZ, 'exportaciones', hoy());
mkdirSync(destino, { recursive: true });

const respaldo = respaldoCompleto();
writeFileSync(join(destino, 'respaldo.json'), JSON.stringify(respaldo, null, 2), 'utf8');

for (const tabla of TABLAS) {
  const filas = datosDeTabla(tabla);
  writeFileSync(join(destino, `${tabla}.csv`), filas.length === 0 ? '' : aCsv(filas), 'utf8');
}

console.log(`Exportación completa en ${destino}`);
for (const [tabla, filas] of Object.entries(respaldo.tablas)) {
  console.log(`  ${tabla}: ${filas.length} fila(s)`);
}
console.log('');
console.log('Para restaurar en una instalación vacía:');
console.log(`  node scripts/importar-paquete.js --json ${join(destino, 'respaldo.json')}`);
