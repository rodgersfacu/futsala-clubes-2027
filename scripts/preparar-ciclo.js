// Prepara una base vacía para el ciclo real: solo los parámetros y una identidad de
// Dirección provisoria para poder entrar. No carga clubes ni datos de ejemplo.
//
// La identidad provisoria usa un correo inventado con dominio .local, que no existe ni
// puede recibir nada. Está para reemplazarla por las personas reales de FUTSALA.
import { abrirBase, uno, ejecutar } from '../server/db.js';
import { nuevoId } from '../server/auth.js';
import { ahora } from '../server/lib/fechas.js';

abrirBase();

if (!uno(`SELECT id FROM parametros WHERE id = 'CICLO-2027'`)) {
  ejecutar(
    `INSERT INTO parametros (id, anio_cierre, anio_objetivo, inicio_reconfirmacion, fin_reconfirmacion,
                             zona_horaria, avisos_internos, avisos_externos)
     VALUES ('CICLO-2027', 2026, 2027, '2027-01-01', '2027-02-28', 'America/Argentina/Buenos_Aires', 0, 0)`,
  );
  console.log('Parámetros del ciclo 2026/2027 creados (ventana 01/01/2027 a 28/02/2027).');
}

if (uno('SELECT count(*) AS n FROM usuario').n === 0) {
  ejecutar(
    `INSERT INTO usuario (id, email, nombre, rol, activo, creado_en)
     VALUES (?, 'provisorio@futsala.local', 'PROVISORIO — reemplazar por las personas reales', 'Direccion', 1, ?)`,
    nuevoId(),
    ahora(),
  );
  console.log('Identidad de Dirección provisoria creada para poder entrar a la app.');
  console.log('Reemplazala en Administración cuando estén los correos reales.');
}

console.log('');
console.log(`Usuarios: ${uno('SELECT count(*) AS n FROM usuario').n} · Clubes: ${uno('SELECT count(*) AS n FROM club').n}`);
