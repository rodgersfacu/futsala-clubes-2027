// Carga `.env` de la raíz del proyecto, si existe. Ahí queda la configuración de la
// máquina que publica la aplicación con el túnel (la crea `npm run preparar-tunel`).
//
// Hay que importarlo ANTES que cualquier módulo del servidor: los módulos se evalúan en
// el orden en que se importan, y db.js lee FUTSALA_DATOS en el momento de cargarse.
//
// `npm start` no lo usa a propósito: en una máquina de desarrollo con un `.env` olvidado,
// arrancar en modo público sin pedirlo sería una sorpresa.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ARCHIVO_ENTORNO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
export const hayEntorno = existsSync(ARCHIVO_ENTORNO);

// Lo que ya venga en el entorno gana sobre el archivo: así se puede probar algo puntual
// sin editarlo.
if (hayEntorno) process.loadEnvFile(ARCHIVO_ENTORNO);
