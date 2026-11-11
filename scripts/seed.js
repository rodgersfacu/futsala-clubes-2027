// Carga un juego de datos FICTICIOS para probar la aplicación.
// Ningún dato es real: los clubes están inventados y los correos usan example.invalid.
// Uso:  node scripts/seed.js            (carga si la base está vacía)
//       node scripts/seed.js --reiniciar (borra el archivo de base y la vuelve a crear)
import { unlinkSync, existsSync } from 'node:fs';
import { abrirBase, uno, ejecutar, enTransaccion, RUTA_DB, cerrarBase } from '../server/db.js';
import { nuevoId } from '../server/auth.js';
import { ahora, hoy, sumarDias } from '../server/lib/fechas.js';
import * as usuarios from '../server/dominio/usuarios.js';
import * as clubes from '../server/dominio/clubes.js';
import * as planes from '../server/dominio/planes.js';
import * as reuniones from '../server/dominio/reuniones.js';
import * as compromisos from '../server/dominio/compromisos.js';
import * as reconfirmaciones from '../server/dominio/reconfirmaciones.js';
import { registrarConflicto } from '../server/dominio/conflictos.js';

const reiniciar = process.argv.includes('--reiniciar');

if (reiniciar) {
  cerrarBase();
  for (const sufijo of ['', '-wal', '-shm']) {
    const ruta = `${RUTA_DB}${sufijo}`;
    if (existsSync(ruta)) unlinkSync(ruta);
  }
  console.log(`Base borrada: ${RUTA_DB}`);
}

abrirBase();

if (uno('SELECT count(*) AS n FROM usuario').n > 0 && !reiniciar) {
  console.log('La base ya tiene datos. Usá "npm run reiniciar" para recrear el juego de prueba.');
  process.exit(0);
}

const equipo = crearEquipoDePrueba();
crearParametros();

const direccion = equipo.direccion1;

clubCompleto();
clubEnSeguimiento();
clubConActaEnRevision();
clubEnBorrador();
clubSinPlan();

console.log('');
console.log('Datos ficticios cargados.');
console.log(`  Usuarios:        ${uno('SELECT count(*) AS n FROM usuario').n}`);
console.log(`  Clubes:          ${uno('SELECT count(*) AS n FROM club').n}`);
console.log(`  Planes:          ${uno('SELECT count(*) AS n FROM plan').n}`);
console.log(`  Reuniones:       ${uno('SELECT count(*) AS n FROM reunion').n}`);
console.log(`  Compromisos:     ${uno('SELECT count(*) AS n FROM compromiso').n}`);
console.log(`  Reconfirmaciones:${uno('SELECT count(*) AS n FROM reconfirmacion').n}`);
console.log(`  Eventos:         ${uno('SELECT count(*) AS n FROM historial').n}`);
console.log('');
console.log('Arrancá con: npm start   y entrá en http://localhost:4310');
console.log('');

// --- Equipo y parámetros -----------------------------------------------------

function crearEquipoDePrueba() {
  // La primera Dirección se inserta directamente: todavía no hay nadie que pueda darla de alta.
  const direccion1 = { id: nuevoId(), email: 'direccion1@example.invalid', nombre: 'DEMO — Dirección 1', rol: 'Direccion' };
  ejecutar(
    'INSERT INTO usuario (id, email, nombre, rol, activo, creado_en) VALUES (?, ?, ?, ?, 1, ?)',
    direccion1.id,
    direccion1.email,
    direccion1.nombre,
    direccion1.rol,
    ahora(),
  );
  const actor = uno('SELECT * FROM usuario WHERE id = ?', direccion1.id);

  const direccion2 = usuarios.crear(actor, {
    nombre: 'DEMO — Dirección 2',
    email: 'direccion2@example.invalid',
    rol: 'Direccion',
    activo: '1',
  });
  const ayudante = usuarios.crear(actor, {
    nombre: 'DEMO — Ayudante de actas',
    email: 'actas@example.invalid',
    rol: 'Ayudante',
    activo: '1',
  });
  const consulta = usuarios.crear(actor, {
    nombre: 'DEMO — Consulta',
    email: 'consulta@example.invalid',
    rol: 'Consulta',
    activo: '1',
  });
  usuarios.crear(actor, {
    nombre: 'DEMO — Ayudante inactivo',
    email: 'inactivo@example.invalid',
    rol: 'Ayudante',
    activo: '0',
  });

  return { direccion1: actor, direccion2, ayudante, consulta };
}

function crearParametros() {
  ejecutar(
    `INSERT INTO parametros (id, anio_cierre, anio_objetivo, inicio_reconfirmacion, fin_reconfirmacion,
                             zona_horaria, avisos_internos, avisos_externos)
     VALUES ('CICLO-2027', 2026, 2027, '2027-01-01', '2027-02-28', 'America/Argentina/Buenos_Aires', 0, 0)`,
  );
}

// --- Clubes de ejemplo -------------------------------------------------------

function clubCompleto() {
  const club = clubes.crear(direccion, {
    nombre: 'DEMO — Deportivo Ejemplo Norte',
    localidad: 'Localidad ficticia Norte',
    contacto_nombre: 'Delegado ficticio Norte',
    contacto_email: 'delegado.norte@example.invalid',
    contacto_telefono: '+54 9 11 0000 0001',
    responsable_id: direccion.id,
    prioridad: '1',
  });

  const plan = planes.crear(direccion, club.id, {});

  const formativas = planes.agregarDisciplina(direccion, plan.id, {
    disciplina: 'Formativas',
    tiras_base: '1',
    tiras_propuestas: '2',
    observaciones: 'DEMO',
  });
  const primera = planes.agregarDisciplina(direccion, plan.id, {
    disciplina: 'Primera',
    tiras_base: '1',
    tiras_propuestas: '1',
  });

  const reunion = reuniones.crear(direccion, plan.id, {
    fecha: sumarDias(hoy(), -12),
    hora: '18:00',
    lugar: 'Sede del club (ficticia)',
    modalidad: 'En el club',
    director1_id: direccion.id,
    director2_id: equipo.direccion2.id,
    acta_responsable_id: equipo.ayudante.id,
    agenda: 'Balance 2026, propuesta 2027 y próximos pasos.',
  });
  reuniones.programar(direccion, reunion.id);
  reuniones.guardarActa(equipo.ayudante, reunion.id, {
    delegados_presentes: 'DEMO — Delegado ficticio Norte y coordinador formativo.',
    acta: 'DEMO — Se repasó el año y se presentó la propuesta de una tira adicional en formativas. El club pidió confirmar días de cancha.',
    devolucion_club: 'DEMO — El club valoró el acompañamiento y se mostró predispuesto a sumar la tira.',
    proximo_paso: 'DEMO — Confirmar disponibilidad de cancha antes de fin de año.',
    
    
  });
  reuniones.marcarRealizada(direccion, reunion.id);

  // Lo acordado se carga en el acta de la reunión, y queda atado a ella.
  planes.editarDisciplina(direccion, formativas.id, { tiras_base: '1', tiras_propuestas: '2' });
  planes.editarDisciplina(direccion, primera.id, { tiras_base: '1', tiras_propuestas: '1' });
  reuniones.guardarAcuerdos(direccion, reunion.id, {
    ['acordado_' + formativas.id]: 'DEMO — Suma la segunda tira de formativas.',
    ['acordado_' + primera.id]: 'DEMO — Mantiene la tira de primera.',
  });

  const tarea = compromisos.crear(equipo.ayudante, reunion.id, {
    descripcion: 'DEMO — Confirmar disponibilidad de días de cancha',
    parte_responsable: 'Club',
    contacto_club: 'Delegado ficticio Norte',
    fecha_limite: sumarDias(hoy(), -4),
  });

  reuniones.enviarActaARevision(equipo.ayudante, reunion.id);
  reuniones.aprobarActa(direccion, reunion.id);


  compromisos.cumplir(direccion, tarea.id, {
    resolucion: 'DEMO — El club confirmó los días disponibles.',
    fecha_resolucion: sumarDias(hoy(), -2),
  });

  const ficha = reconfirmaciones.crear(direccion, plan.id, {
    fecha_prevista: '2027-01-15',
    responsable_id: direccion.id,
  });
  planes.editarDisciplina(direccion, formativas.id, { tiras_reconfirmadas: '2', observaciones: 'DEMO — Acordado en la reunión.' });
  planes.editarDisciplina(direccion, primera.id, { tiras_reconfirmadas: '1' });

  // El contacto de ejemplo ocurre antes de la ventana: se registra con motivo de excepción,
  // igual que exigiría un caso real fuera de enero-febrero.
  reconfirmaciones.validarResultado(direccion, ficha.id, 'Confirmado', {
    fecha_contacto: sumarDias(hoy(), -1),
    canal: 'Telefono',
    interlocutor: 'Delegado ficticio Norte',
    respuesta_club: 'DEMO — El club confirma continuidad con dos tiras en formativas y una en primera.',
    evidencia_url: 'https://example.invalid/evidencia/demo-norte',
    motivo_excepcion: 'DEMO — Dato de ejemplo cargado fuera de la ventana para poder probar el circuito completo.',
  });

  planes.cerrar(direccion, plan.id);
  console.log('Club de ejemplo con circuito completo y plan cerrado.');
}

function clubEnSeguimiento() {
  const club = clubes.crear(direccion, {
    nombre: 'DEMO — Atlético Ejemplo Sur',
    localidad: 'Localidad ficticia Sur',
    contacto_nombre: 'Delegada ficticia Sur',
    contacto_email: 'delegada.sur@example.invalid',
    responsable_id: equipo.direccion2.id,
    prioridad: '2',
  });
  const plan = planes.crear(equipo.direccion2, club.id, {});
  const disciplina = planes.agregarDisciplina(equipo.direccion2, plan.id, {
    disciplina: 'Formativas',
    tiras_base: '1',
    tiras_propuestas: '2',
  });

  const reunion = reuniones.crear(equipo.direccion2, plan.id, {
    fecha: sumarDias(hoy(), -8),
    hora: '10:00',
    lugar: null,
    modalidad: 'Llamada',
    director1_id: equipo.direccion2.id,
    director2_id: direccion.id,
    acta_responsable_id: equipo.ayudante.id,
    agenda: 'Balance y propuesta.',
  });
  reuniones.programar(equipo.direccion2, reunion.id);
  reuniones.guardarActa(equipo.ayudante, reunion.id, {
    delegados_presentes: 'DEMO — Delegada ficticia Sur.',
    acta: 'DEMO — Se presentó la propuesta. El club quedó en responder en enero.',
    devolucion_club: 'DEMO — Interés, con dudas por disponibilidad de entrenadores.',
    proximo_paso: 'DEMO — Volver a contactar en enero.',
  });
  reuniones.marcarRealizada(equipo.direccion2, reunion.id);
  planes.editarDisciplina(equipo.direccion2, disciplina.id, { tiras_base: '1', tiras_propuestas: '2' });
  reuniones.guardarAcuerdos(equipo.direccion2, reunion.id, {
    ['acordado_' + disciplina.id]: 'DEMO — Mantiene una tira; la segunda queda a confirmar.',
  });

  compromisos.crear(equipo.ayudante, reunion.id, {
    descripcion: 'DEMO — Enviar propuesta por escrito a la delegada',
    parte_responsable: 'FUTSALA',
    fecha_limite: sumarDias(hoy(), -3),
  });
  compromisos.crear(direccion, reunion.id, {
    descripcion: 'DEMO — Revisar disponibilidad de entrenadores con el club',
    parte_responsable: 'Club',
    contacto_club: 'Delegada ficticia Sur',
    responsable_id: equipo.direccion2.id,
    fecha_limite: sumarDias(hoy(), 10),
  });

  reuniones.enviarActaARevision(equipo.ayudante, reunion.id);
  reuniones.aprobarActa(direccion, reunion.id);

  const ficha = reconfirmaciones.crear(direccion, plan.id, {
    fecha_prevista: '2027-01-20',
    responsable_id: equipo.direccion2.id,
  });
  reconfirmaciones.registrarCondicional(direccion, ficha.id, {
    fecha_contacto: hoy(),
    canal: 'WhatsApp',
    interlocutor: 'Delegada ficticia Sur',
    respuesta_club: 'DEMO — Depende de cerrar el cuerpo técnico.',
    condiciones: 'DEMO — Confirma si consigue entrenador para la segunda tira antes de marzo.',
    proximo_contacto: sumarDias(hoy(), 14),
    motivo_excepcion: 'DEMO — Gestión de ejemplo registrada antes de la ventana.',
  });
  console.log('Club de ejemplo en seguimiento, con respuesta condicional y una tarea vencida.');
}

function clubConActaEnRevision() {
  const club = clubes.crear(direccion, {
    nombre: 'DEMO — Club Social Ejemplo Oeste',
    localidad: 'Localidad ficticia Oeste',
    contacto_nombre: 'Delegado ficticio Oeste',
    responsable_id: direccion.id,
    prioridad: '3',
  });
  const plan = planes.crear(direccion, club.id, {});
  planes.agregarDisciplina(direccion, plan.id, { disciplina: 'Formativas', tiras_base: '0', tiras_propuestas: '1' });

  const reunion = reuniones.crear(direccion, plan.id, {
    fecha: sumarDias(hoy(), -2),
    hora: '19:00',
    lugar: 'Sede del club (ficticia)',
    modalidad: 'En el club',
    director1_id: direccion.id,
    director2_id: equipo.direccion2.id,
    acta_responsable_id: equipo.ayudante.id,
  });
  reuniones.programar(direccion, reunion.id);
  reuniones.guardarActa(equipo.ayudante, reunion.id, {
    delegados_presentes: 'DEMO — Comisión directiva ficticia.',
    acta: 'DEMO — Presentación de FUTSALA y propuesta inicial.',
    devolucion_club: 'DEMO — Buena recepción; quieren consultar a la comisión.',
    proximo_paso: 'DEMO — Esperar respuesta de la comisión.',
  });
  reuniones.marcarRealizada(direccion, reunion.id);
  reuniones.enviarActaARevision(equipo.ayudante, reunion.id);

  // Conflicto de ejemplo: así se ve un duplicado detectado en una importación.
  enTransaccion(() =>
    registrarConflicto({
      origen: 'DEMO — importación de ejemplo',
      entidad: 'reconfirmacion',
      clave: `plan ${plan.id}`,
      detalle: 'DEMO — La importación traía dos fichas de reconfirmación para este plan. Se rechazó la segunda.',
      clubId: club.id,
      planId: plan.id,
      datos: { nota: 'Fila rechazada de ejemplo', estado: 'Confirmado', origen: 'planilla vieja' },
    }),
  );
  console.log('Club de ejemplo con acta esperando revisión y un conflicto de datos abierto.');
}

function clubEnBorrador() {
  const club = clubes.crear(direccion, {
    nombre: 'DEMO — Ejemplo Este',
    localidad: 'Localidad ficticia Este',
    responsable_id: equipo.direccion2.id,
  });
  const plan = planes.crear(equipo.direccion2, club.id, {});
  planes.agregarDisciplina(equipo.direccion2, plan.id, { disciplina: 'Primera', tiras_base: '1' });
  console.log('Club de ejemplo con plan en borrador y datos incompletos.');
}

function clubSinPlan() {
  clubes.crear(direccion, {
    nombre: 'DEMO — Club Ejemplo Centro',
    localidad: 'Localidad ficticia Centro',
    contacto_nombre: 'Contacto ficticio Centro',
    responsable_id: direccion.id,
  });
  console.log('Club de ejemplo sin plan del ciclo.');
}
