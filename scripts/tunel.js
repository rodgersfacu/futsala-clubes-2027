// Arranca la aplicación para que la publique Cloudflare Tunnel desde esta máquina.
//
// La configuración sale de `.env` (no se versiona: tiene el secreto que firma las
// sesiones). Se crea una sola vez con:
//   npm run preparar-tunel reuniones.ejemplo.com.ar
//
// Uso: npm run tunel
// Es lo que corre la tarea programada al prender la máquina (scripts/instalar-tareas.ps1).
//
// Todo lo que el servidor escribe en la consola queda también en `servidor.log`, junto a
// la base: la tarea programada no tiene consola, y sin eso un arranque fallido no dejaría
// rastro. Va junto a la base y no en `exportaciones/` porque la consola muestra los
// enlaces de acceso, y esa carpeta se sincroniza.
import { hayEntorno, ARCHIVO_ENTORNO } from './lib/entorno.js';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIR_DATOS } from '../server/db.js';
import { problemasDelTunel } from '../server/lib/tunel.js';

const REGISTRO = join(DIR_DATOS, 'servidor.log');

mkdirSync(DIR_DATOS, { recursive: true });
for (const flujo of [process.stdout, process.stderr]) {
  const escribir = flujo.write.bind(flujo);
  flujo.write = (trozo, ...resto) => {
    try {
      appendFileSync(REGISTRO, trozo, { mode: 0o600 });
    } catch {
      // Si no se puede anotar, que por lo menos salga por la consola.
    }
    return escribir(trozo, ...resto);
  };
}

console.log(`\n--- ${new Date().toISOString()}  arranque con túnel ---`);

if (!hayEntorno) {
  console.error('');
  console.error(`  No encuentro ${ARCHIVO_ENTORNO}.`);
  console.error('  Se crea una vez, en esta máquina, con:');
  console.error('    npm run preparar-tunel reuniones.ejemplo.com.ar');
  console.error('');
  process.exit(1);
}

const problemas = problemasDelTunel(process.env);
if (problemas.length > 0) {
  console.error('');
  console.error(`  No arranco detrás del túnel: falta o está mal en ${ARCHIVO_ENTORNO}`);
  for (const p of problemas) console.error(`    · ${p}`);
  console.error('');
  process.exit(1);
}

await import('../server/index.js');
