// Pruebas de aceptación. Crean su propia base temporal y aislada: no tocan los datos
// de la instalación ni usan servicios externos. Ningún mensaje se envía.
//
// Uso: node scripts/pruebas.js
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = mkdtempSync(join(tmpdir(), 'futsala-pruebas-'));
process.env.FUTSALA_DATOS = carpeta;
process.env.FUTSALA_DB = join(carpeta, 'pruebas.db');
process.env.FUTSALA_SECRETO = 'secreto-de-prueba-no-usar-en-produccion';

const { abrirBase, uno, todos, ejecutar, enTransaccion, cerrarBase } = await import('../server/db.js');
const { nuevoId } = await import('../server/auth.js');
const { ahora, hoy, sumarDias, lunesDe } = await import('../server/lib/fechas.js');
const { ErrorConflictoVersion } = await import('../server/lib/errores.js');
const usuarios = await import('../server/dominio/usuarios.js');
const clubes = await import('../server/dominio/clubes.js');
const planes = await import('../server/dominio/planes.js');
const reuniones = await import('../server/dominio/reuniones.js');
const compromisos = await import('../server/dominio/compromisos.js');
const reconfirmaciones = await import('../server/dominio/reconfirmaciones.js');
const consultas = await import('../server/dominio/consultas.js');
const exportar = await import('../server/dominio/exportar.js');
const { registrar } = await import('../server/dominio/registro.js');
const { registrarConflicto } = await import('../server/dominio/conflictos.js');
const accesos = await import('../server/dominio/accesos.js');
const disponibilidad = await import('../server/dominio/disponibilidad.js');
const tunel = await import('../server/lib/tunel.js');
const entrega = await import('../server/lib/entrega.js');

abrirBase();

let correctas = 0;
let fallidas = 0;
let seccionActual = '';

function seccion(titulo) {
  seccionActual = titulo;
  console.log(`\n${titulo}`);
}

function ok(descripcion, condicion, detalle = '') {
  if (condicion) {
    correctas += 1;
    console.log(`  ✓ ${descripcion}`);
  } else {
    fallidas += 1;
    console.log(`  ✗ ${descripcion}${detalle ? ` — ${detalle}` : ''}`);
  }
}

/** Comprueba que una operación sea rechazada. */
function rechaza(descripcion, fn, textoEsperado = null) {
  try {
    fn();
    ok(descripcion, false, 'no fue rechazada');
  } catch (error) {
    // El detalle de lo que falta puede venir en el mensaje o en la ayuda del error.
    const texto = `${error.message} ${error.ayuda || ''}`;
    const coincide = !textoEsperado || new RegExp(textoEsperado, 'i').test(texto);
    ok(descripcion, coincide, coincide ? '' : `mensaje inesperado: ${texto.trim()}`);
  }
}

/**
 * Deja un plan con un acta aprobada, que es lo que la ficha de reconfirmación necesita
 * para existir: el club reconfirma lo que se acordó en una reunión concreta.
 */
function conActaAprobada(plan, { fechaRecontacto = null } = {}) {
  const m = reuniones.crear(dir1, plan.id, {
    fecha: hoy(),
    hora: '09:00',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
  });
  reuniones.programar(dir1, m.id);
  reuniones.guardarActa(colab, m.id, {
    delegados_presentes: 'Delegado',
    acta: 'Acta.',
    devolucion_club: 'Devolución.',
    proximo_paso: 'Paso.',
    fecha_recontacto: fechaRecontacto,
  });
  reuniones.marcarRealizada(dir1, m.id);
  reuniones.enviarActaARevision(colab, m.id);
  reuniones.aprobarActa(dir1, m.id);
  return reuniones.obtener(m.id);
}

function acepta(descripcion, fn) {
  try {
    const resultado = fn();
    ok(descripcion, true);
    return resultado;
  } catch (error) {
    ok(descripcion, false, error.message);
    return null;
  }
}

// --- Preparación -------------------------------------------------------------

ejecutar(
  `INSERT INTO parametros (id, anio_cierre, anio_objetivo, inicio_reconfirmacion, fin_reconfirmacion,
                           zona_horaria, avisos_internos, avisos_externos)
   VALUES ('CICLO-2027', 2026, 2027, '2027-01-01', '2027-02-28', 'America/Argentina/Buenos_Aires', 0, 0)`,
);

const dir1 = crearUsuario('dir1@example.invalid', 'Dirección 1', 'Direccion', 1);
const dir2 = crearUsuario('dir2@example.invalid', 'Dirección 2', 'Direccion', 1);
const colab = crearUsuario('colab@example.invalid', 'Ayudante', 'Ayudante', 1);
const colab2 = crearUsuario('colab2@example.invalid', 'Ayudante 2', 'Ayudante', 1);
const consulta = crearUsuario('consulta@example.invalid', 'Consulta', 'Consulta', 1);
const inactivo = crearUsuario('inactivo@example.invalid', 'Inactivo', 'Direccion', 0);

function crearUsuario(email, nombre, rol, activo) {
  const id = nuevoId();
  ejecutar(
    'INSERT INTO usuario (id, email, nombre, rol, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    email,
    nombre,
    rol,
    activo,
    ahora(),
  );
  return uno('SELECT * FROM usuario WHERE id = ?', id);
}

// --- 1. Circuito completo ----------------------------------------------------

seccion('1. Circuito completo');

const club = clubes.crear(dir1, {
  nombre: 'Club de prueba Norte',
  localidad: 'Prueba',
  responsable_id: dir1.id,
  prioridad: '1',
});
const plan = planes.crear(dir1, club.id, {});
ok('Dirección crea club y plan del ciclo', Boolean(plan) && plan.anio_objetivo === 2027);
ok('La prioridad es del club, no del ciclo', clubes.obtener(club.id).prioridad === '1');

const catA = planes.agregarDisciplina(dir1, plan.id, { disciplina: 'Formativas', tiras_base: '1', tiras_propuestas: '2' });
const catB = planes.agregarDisciplina(dir1, plan.id, { disciplina: 'Primera', tiras_base: '1', tiras_propuestas: '1' });
ok('Agrega dos disciplinas con base y propuesta', planes.detalles(plan.id).length === 2);


const reunion = reuniones.crear(dir1, plan.id, {
  fecha: sumarDias(hoy(), -5),
  hora: '18:00',
  lugar: 'Sede de prueba',
  modalidad: 'En el club',
  director1_id: dir1.id,
  director2_id: dir2.id,
  acta_responsable_id: colab.id,
});
acepta('Programa la reunión con dos direcciones y quien toma el acta', () => reuniones.programar(dir1, reunion.id));

acepta('El ayudante asignado carga el acta', () =>
  reuniones.guardarActa(colab, reunion.id, {
    delegados_presentes: 'Delegado de prueba',
    acta: 'Acta de prueba.',
    devolucion_club: 'Devolución de prueba.',
    proximo_paso: 'Próximo paso de prueba.',
  }),
);
acepta('Dirección marca la reunión como realizada', () => reuniones.marcarRealizada(dir1, reunion.id));

acepta('Lo acordado se carga desde el acta, en una sola operación', () => {
  reuniones.guardarAcuerdos(dir1, reunion.id, {
    [`acordado_${catA.id}`]: 'Mantiene las dos de Liga de Honor B',
    [`acordado_${catB.id}`]: 'Suma una',
  });
});
ok(
  'Lo acordado queda atado a esa reunión sin elegirlo a mano',
  planes.detalle(catA.id).reunion_acuerdo_id === reunion.id &&
    planes.detalle(catA.id).acordado_texto === 'Mantiene las dos de Liga de Honor B',
);
rechaza(
  'Lo acordado ya no se edita desde la ficha del club',
  () => planes.editarDisciplina(dir1, catA.id, { tiras_acordadas: '7' }),
  'se carga en el acta',
);

const tarea = compromisos.crear(colab, reunion.id, {
  descripcion: 'Confirmar disponibilidad',
  parte_responsable: 'Club',
  contacto_club: 'Delegado de prueba',
  fecha_limite: sumarDias(hoy(), -2),
});
ok('El ayudante crea un compromiso desde su acta', Boolean(tarea));

acepta('Envía el acta a revisión', () => reuniones.enviarActaARevision(colab, reunion.id));
acepta('Dirección devuelve el acta con motivo', () =>
  reuniones.devolverActa(dir1, reunion.id, { motivo: 'Falta detallar la devolución del club.' }),
);
ok(
  'La devolución queda visible para quien tomó el acta',
  reuniones.obtener(reunion.id).motivo_devolucion?.includes('Falta detallar'),
);
acepta('El ayudante corrige y reenvía', () => {
  reuniones.guardarActa(colab, reunion.id, {
    delegados_presentes: 'Delegado de prueba',
    acta: 'Acta de prueba corregida.',
    devolucion_club: 'Devolución de prueba ampliada.',
    proximo_paso: 'Próximo paso de prueba.',
  });
  reuniones.enviarActaARevision(colab, reunion.id);
});
ok(
  'Un envío nuevo limpia el motivo anterior: la próxima devolución exige explicación nueva',
  reuniones.obtener(reunion.id).motivo_devolucion === null,
);
acepta('Dirección aprueba el acta', () => reuniones.aprobarActa(dir1, reunion.id));


const ficha = reconfirmaciones.crear(dir1, plan.id, { fecha_prevista: '2027-01-15', responsable_id: dir1.id });
ok('Abre la ficha de reconfirmación dentro de la ventana', ficha.estado === 'Pendiente');

acepta('Resuelve el compromiso', () =>
  compromisos.cumplir(dir1, tarea.id, { resolucion: 'Confirmado por el club.', fecha_resolucion: hoy() }),
);

planes.editarDisciplina(dir1, catA.id, { tiras_reconfirmadas: '2' });
planes.editarDisciplina(dir1, catB.id, { tiras_reconfirmadas: '1' });

acepta('Valida el resultado final Confirmado', () =>
  reconfirmaciones.validarResultado(dir1, ficha.id, 'Confirmado', {
    fecha_contacto: hoy(),
    canal: 'Telefono',
    interlocutor: 'Delegado de prueba',
    respuesta_club: 'El club confirma.',
    evidencia_url: 'https://example.invalid/evidencia',
    motivo_excepcion: 'Contacto de prueba fuera de la ventana.',
  }),
);
acepta('Cierra el plan con todas las condiciones cumplidas', () => planes.cerrar(dir1, plan.id));
ok('El plan queda cerrado', planes.obtener(plan.id).estado === 'Cerrada');

// --- 2. Permisos -------------------------------------------------------------

seccion('2. Permisos (aplicados en servidor, no en los botones)');

const club2 = clubes.crear(dir1, { nombre: 'Club de prueba Sur', responsable_id: dir2.id, prioridad: '2' });
const plan2 = planes.crear(dir1, club2.id, {});
const catSur = planes.agregarDisciplina(dir1, plan2.id, { disciplina: 'Formativas', tiras_base: '2', tiras_propuestas: '3' });
const reunionSur = reuniones.crear(dir1, plan2.id, {
  fecha: sumarDias(hoy(), -3),
  hora: '10:00',
  lugar: null,
  modalidad: 'En la liga',
  director1_id: dir1.id,
  director2_id: dir2.id,
  acta_responsable_id: colab.id,
});
reuniones.programar(dir1, reunionSur.id);

rechaza(
  'Un ayudante no escribe un acta ajena',
  () =>
    reuniones.guardarActa(colab2, reunionSur.id, {
      delegados_presentes: 'x',
      acta: 'x',
      devolucion_club: 'x',
      proximo_paso: 'x',
    }),
  'asignaron|no puede',
);
acepta('Un ayudante sí coordina la agenda: es su tarea', () =>
  reuniones.editarAgenda(colab, reunionSur.id, {
    fecha: sumarDias(hoy(), -3),
    hora: '10:00',
    modalidad: 'En el club',
    lugar: 'Sede del club de prueba',
    director1_id: dir1.id,
    director2_id: dir2.id,
    acta_responsable_id: colab.id,
  }),
);
rechaza(
  'Un ayudante no cambia la prioridad del club',
  () => clubes.editar(colab, club2.id, { nombre: 'Club de prueba Sur', prioridad: '1' }),
  'Solo Dirección',
);
rechaza(
  'Un ayudante no valida el resultado final',
  () =>
    reconfirmaciones.validarResultado(colab, 'cualquiera', 'Confirmado', {
      fecha_contacto: hoy(),
      canal: 'Telefono',
      interlocutor: 'x',
      respuesta_club: 'x',
      evidencia_url: 'https://example.invalid/x',
    }),
  'Solo Dirección',
);
rechaza(
  'Un ayudante no aprueba un acta',
  () => reuniones.aprobarActa(colab, reunionSur.id),
  'Solo Dirección',
);
rechaza(
  'Consulta no escribe nada',
  () =>
    reuniones.guardarActa(consulta, reunionSur.id, {
      delegados_presentes: 'x',
      acta: 'x',
      devolucion_club: 'x',
      proximo_paso: 'x',
    }),
  'no puede escribir|consulta',
);
rechaza(
  'Un usuario inactivo no opera',
  () => clubes.editar(inactivo, club2.id, { nombre: 'Club de prueba Sur' }),
  'inactivo',
);
rechaza(
  'Sin sesión no se opera',
  () => clubes.editar(null, club2.id, { nombre: 'Club de prueba Sur' }),
  'iniciar sesión',
);
rechaza(
  'Nadie eleva su propio rol',
  () => usuarios.cambiarAcceso(dir1, dir1.id, { rol: 'Direccion', activo: '1' }),
  'tu propio rol',
);
rechaza(
  'No queda la organización sin Dirección activa',
  () => {
    usuarios.cambiarAcceso(dir1, dir2.id, { rol: 'Consulta', activo: '1' });
    usuarios.cambiarAcceso(dir2, dir1.id, { rol: 'Consulta', activo: '1' });
  },
  'al menos una Dirección',
);
// Se restaura el rol de la segunda dirección para el resto de las pruebas.
usuarios.cambiarAcceso(dir1, dir2.id, { rol: 'Direccion', activo: '1' });
const dir2Actual = usuarios.obtener(dir2.id);
ok('La dirección restaurada vuelve a tener su rol', dir2Actual.rol === 'Direccion');

reuniones.guardarActa(colab, reunionSur.id, {
  delegados_presentes: 'Delegada de prueba',
  acta: 'Acta Sur.',
  devolucion_club: 'Devolución Sur.',
  proximo_paso: 'Próximo paso Sur.',
});
reuniones.marcarRealizada(dir1, reunionSur.id);
reuniones.guardarAcuerdos(dir1, reunionSur.id, {
  [`acordado_${catSur.id}`]: 'Mantiene',
});
reuniones.enviarActaARevision(colab, reunionSur.id);
rechaza('Un ayudante no aprueba su propia acta', () => reuniones.aprobarActa(colab, reunionSur.id), 'Solo Dirección');
reuniones.aprobarActa(dir1, reunionSur.id);
rechaza(
  'Nadie escribe sobre un acta aprobada',
  () =>
    reuniones.guardarActa(dir1, reunionSur.id, {
      delegados_presentes: 'cambio',
      acta: 'cambio',
      devolucion_club: 'cambio',
      proximo_paso: 'cambio',
    }),
  'aprobada',
);

const tareaAjena = compromisos.crear(dir1, reunionSur.id, {
  descripcion: 'Tarea de otra persona',
  parte_responsable: 'FUTSALA',
  responsable_id: dir2.id,
  fecha_limite: sumarDias(hoy(), 5),
});
rechaza(
  'Un ayudante no edita una tarea ajena (restricción de servidor)',
  () => compromisos.editar(colab, tareaAjena.id, { descripcion: 'cambiada', parte_responsable: 'FUTSALA', fecha_limite: hoy() }),
  'propias tareas',
);
rechaza(
  'Un ayudante no resuelve una tarea ajena',
  () => compromisos.cumplir(colab, tareaAjena.id, { resolucion: 'listo' }),
  'No podés',
);
const tareaPropia = compromisos.crear(dir1, reunionSur.id, {
  descripcion: 'Tarea del ayudante',
  parte_responsable: 'FUTSALA',
  responsable_id: colab.id,
  fecha_limite: sumarDias(hoy(), 5),
});
acepta('Un ayudante sí resuelve su propia tarea abierta', () =>
  compromisos.cumplir(colab, tareaPropia.id, { resolucion: 'Resuelta por el responsable.' }),
);
rechaza(
  'Un ayudante no reabre ni reedita una tarea ya resuelta',
  () => compromisos.editar(colab, tareaPropia.id, { descripcion: 'otra', parte_responsable: 'FUTSALA', fecha_limite: hoy() }),
  'propias tareas|resuelto',
);

// --- 3. Inmutabilidad y cierre ----------------------------------------------

// --- 2 bis. El circuito tal como lo trabaja el equipo ------------------------

seccion('2 bis. El ayudante coordina, agenda y vuelca la nota');

const clubProceso = clubes.crear(dir1, { nombre: 'Club de prueba Proceso' });
const planProceso = planes.crear(dir1, clubProceso.id, {});
planes.agregarDisciplina(dir1, planProceso.id, { disciplina: 'Masculino', tiras_base: '1', tiras_propuestas: '2' });

const reunionProceso = acepta('El ayudante agenda la reunión con el club', () =>
  reuniones.crear(colab, planProceso.id, {
    fecha: sumarDias(hoy(), -1),
    hora: '19:00',
    modalidad: 'En la liga',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
  }),
);
ok(
  'Una reunión en la liga no necesita dirección cargada',
  reunionProceso !== null && reunionProceso.lugar === null && reunionProceso.modalidad === 'En la liga',
);
ok('Queda una sola Dirección a cargo', reunionProceso.director1_id === dir1.id && reunionProceso.director2_id === null);
acepta('El ayudante la programa, con una sola Dirección', () => reuniones.programar(colab, reunionProceso.id));

acepta('El ayudante vuelca la nota de la reunión', () =>
  reuniones.guardarActa(colab, reunionProceso.id, {
    delegados_presentes: 'Delegado del club de prueba',
    acta: 'Se presentó lo pretendido para 2027 y se entregaron las revistas.',
    devolucion_club: 'El club lo va a tratar en comisión.',
    proximo_paso: 'Volver a contactar en enero.',
  }),
);
acepta('El ayudante marca que la reunión se hizo', () => reuniones.marcarRealizada(colab, reunionProceso.id));
acepta('El ayudante manda el acta a revisión', () => reuniones.enviarActaARevision(colab, reunionProceso.id));
rechaza(
  'Un ayudante que no toma nota no marca la reunión como realizada',
  () => reuniones.marcarRealizada(colab2, reunionProceso.id),
  'quien toma nota',
);
acepta('Dirección aprueba el acta', () => reuniones.aprobarActa(dir1, reunionProceso.id));

const fichaProceso = acepta('El ayudante abre la ficha de reconfirmación', () =>
  reconfirmaciones.crear(colab, planProceso.id, { fecha_prevista: '2027-01-10' }),
);
acepta('El ayudante registra el contacto de reconfirmación', () =>
  reconfirmaciones.registrarContacto(colab, fichaProceso.id, {
    fecha_contacto: hoy(),
    canal: 'Telefono',
    interlocutor: 'Delegado del club de prueba',
    proximo_contacto: sumarDias(hoy(), 15),
    motivo_excepcion: 'Contacto de prueba antes de la ventana.',
  }),
);
rechaza(
  'El resultado final lo valida Dirección, no el ayudante',
  () =>
    reconfirmaciones.validarResultado(colab, fichaProceso.id, 'Confirmado', {
      fecha_contacto: hoy(),
      canal: 'Telefono',
      interlocutor: 'Delegado del club de prueba',
      respuesta_club: 'Confirma',
      evidencia_url: 'https://example.invalid/proceso',
    }),
  'Solo Dirección',
);
rechaza(
  'Consulta no agenda reuniones',
  () =>
    reuniones.crear(consulta, planProceso.id, {
      fecha: hoy(),
      hora: '10:00',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'consulta',
);

seccion('3. Inmutabilidad y bloqueos (también por petición directa a la base)');

// El plan Sur queda abierto: así cada bloqueo se prueba por separado, sin que lo tape
// el bloqueo general de un plan cerrado.

rechaza(
  'No se puede mover un plan a otro club',
  () => ejecutar('UPDATE plan SET club_id = ? WHERE id = ?', club2.id, plan.id),
  'no se pueden cambiar',
);
rechaza(
  'No se puede cambiar el año de un plan',
  () => ejecutar('UPDATE plan SET anio_objetivo = 2028 WHERE id = ?', plan.id),
  'no se pueden cambiar',
);
rechaza(
  'No se puede mover una reunión a otro plan',
  () => ejecutar('UPDATE reunion SET plan_id = ? WHERE id = ?', plan.id, reunionSur.id),
  'otro plan',
);
rechaza(
  'No se puede mover una disciplina a otro plan',
  () => ejecutar('UPDATE plan_detalle SET plan_id = ? WHERE id = ?', plan.id, catSur.id),
  'otro plan',
);
rechaza(
  'No se puede alterar el contenido de un acta aprobada',
  () => ejecutar(`UPDATE reunion SET acta = 'reescrita' WHERE id = ?`, reunionSur.id),
  'aprobada',
);
rechaza(
  'Con un acta aprobada, lo de 2026 queda fijo',
  () => ejecutar('UPDATE plan_detalle SET tiras_base = 99 WHERE id = ?', catSur.id),
  'quedo fijo|bloquead',
);
rechaza(
  'La interfaz tampoco deja tocar lo de 2026 después del acta',
  () => planes.editarDisciplina(dir1, catSur.id, { tiras_base: '9' }),
  'quedó fijo',
);
rechaza(
  'No se puede alterar una cantidad acordada respaldada por acta aprobada',
  () => ejecutar('UPDATE plan_detalle SET tiras_acordadas = 99 WHERE id = ?', catSur.id),
  'bloquead',
);
// El bloqueo tiene que valer también para el alta: si no, una disciplina nueva cuela
// cantidades de 2026 o pretendidas que ya se conversaron con el club.
rechaza(
  'Con un acta aprobada no se agrega una disciplina nueva con base 2026',
  () => planes.agregarDisciplina(dir1, plan2.id, { disciplina: 'Colada base', tiras_base: '7' }),
  'quedó fijo',
);
rechaza(
  'Con un acta aprobada no se agrega una disciplina nueva con lo pretendido',
  () => planes.agregarDisciplina(dir1, plan2.id, { disciplina: 'Colada propuesta', tiras_propuestas: '7' }),
  'quedó fija',
);
rechaza(
  'La base tampoco deja colar el alta por SQL directo',
  () =>
    ejecutar(
      `INSERT INTO plan_detalle (id, plan_id, disciplina, disciplina_norm, tiras_base, creado_en)
       VALUES (?, ?, 'Colada SQL', 'colada sql', 7, ?)`,
      nuevoId(),
      plan2.id,
      ahora(),
    ),
  'quedaron fijos',
);
// El bloqueo no tiene que pasarse de largo: una disciplina nueva SIN cantidades sigue
// permitida. Se comprueba dentro de una transacción que se deshace, para no alterar las
// cantidades del plan que usan las pruebas de reapertura más abajo.
ok(
  'Pero sí se agrega una disciplina nueva sin cantidades',
  (() => {
    try {
      enTransaccion(() => {
        planes.agregarDisciplina(dir1, plan2.id, { disciplina: 'Agregada después del acta' });
        throw new Error('DESHACER');
      });
    } catch (error) {
      return error.message === 'DESHACER';
    }
    return false;
  })(),
);
rechaza(
  'No se puede editar el historial',
  () => ejecutar(`UPDATE historial SET motivo = 'otro' WHERE id = (SELECT id FROM historial LIMIT 1)`),
  'no se modifica',
);
rechaza(
  'No se puede borrar el historial',
  () => ejecutar('DELETE FROM historial WHERE id = (SELECT id FROM historial LIMIT 1)'),
  'no se borra',
);

// Resultado final del plan Sur, para probar el bloqueo de las cantidades finales.
const fichaSur = reconfirmaciones.crear(dir1, plan2.id, { fecha_prevista: '2027-02-01' });
planes.editarDisciplina(dir1, catSur.id, { tiras_reconfirmadas: '2' });
reconfirmaciones.validarResultado(dir1, fichaSur.id, 'Confirmado', {
  fecha_contacto: hoy(),
  canal: 'Email',
  interlocutor: 'Delegada de prueba',
  respuesta_club: 'Confirma.',
  evidencia_url: 'https://example.invalid/sur',
  motivo_excepcion: 'Prueba fuera de ventana.',
});
rechaza(
  'No se pueden alterar las cantidades finales con reconfirmación aprobada',
  () => ejecutar('UPDATE plan_detalle SET tiras_reconfirmadas = 99 WHERE id = ?', catSur.id),
  'bloquead',
);
rechaza(
  'No se puede mover la ficha final a otro plan',
  () => ejecutar('UPDATE reconfirmacion SET plan_id = ? WHERE id = ?', plan.id, fichaSur.id),
  'otro plan',
);
rechaza(
  'Con una tarea abierta el plan no cierra, y dice qué falta',
  () => planes.cerrar(dir1, plan2.id),
  'condiciones de cierre',
);
const faltan = planes.faltantesParaCerrar(plan2.id);
ok('La lista de faltantes nombra el compromiso pendiente', faltan.some((f) => f.includes('Tarea de otra persona')));
compromisos.cumplir(dir2, tareaAjena.id, { resolucion: 'Resuelta.' });
acepta('Resueltas todas las condiciones, el plan cierra', () => planes.cerrar(dir1, plan2.id));

// --- 4. Reapertura y auditoría ----------------------------------------------

seccion('4. Reapertura y auditoría');

rechaza('Reabrir sin motivo se rechaza', () => planes.reabrirPlan(dir1, plan2.id, { motivo: '' }), 'motivo');
rechaza('Reabrir con un motivo demasiado corto se rechaza', () => planes.reabrirPlan(dir1, plan2.id, { motivo: 'error' }), 'motivo');
rechaza(
  'Un ayudante no reabre un plan',
  () => planes.reabrirPlan(colab, plan2.id, { motivo: 'Quiero corregir el balance.' }),
  'Solo Dirección',
);
rechaza(
  'No se reabre el acta antes que el plan',
  () => reuniones.reabrirActa(dir1, reunionSur.id, { motivo: 'Corrección del acta aprobada.' }),
  'primero',
);

const eventosAntes = uno('SELECT count(*) AS n FROM historial').n;
acepta('Dirección reabre el plan con motivo', () =>
  planes.reabrirPlan(dir1, plan2.id, { motivo: 'Hay que corregir la cantidad acordada de formativas.' }),
);
const eventoReapertura = uno(
  `SELECT * FROM historial WHERE plan_id = ? AND tipo = 'plan.reabierto' ORDER BY ocurrido_en DESC LIMIT 1`,
  plan2.id,
);
ok('La reapertura queda registrada con actor y sello', eventoReapertura.actor_id === dir1.id && Boolean(eventoReapertura.ocurrido_en));
ok('Guarda el motivo', eventoReapertura.motivo.includes('corregir la cantidad'));
const copia = JSON.parse(eventoReapertura.datos_anteriores);
ok(
  'Guarda copia íntegra: plan, disciplinas con lo acordado, reuniones y ficha final',
  copia.plan.estado === 'Cerrada' &&
    copia.disciplinas.length === 1 &&
    copia.disciplinas[0].acordado_texto === 'Mantiene' &&
    copia.reconfirmacion.estado === 'Confirmado' &&
    copia.reuniones.length === 1,
);
ok('El historial creció exactamente un evento', uno('SELECT count(*) AS n FROM historial').n === eventosAntes + 1);

rechaza(
  'Con el plan reabierto, el acta sigue protegida hasta reabrir la reconfirmación',
  () => reuniones.reabrirActa(dir1, reunionSur.id, { motivo: 'Corrección del acta aprobada.' }),
  'reconfirmación',
);
acepta('Reabre la reconfirmación aprobada con motivo', () =>
  reconfirmaciones.reabrir(dir1, fichaSur.id, { motivo: 'El club corrigió la cantidad informada.' }),
);
const fichaReabierta = reconfirmaciones.obtener(fichaSur.id);
ok('La ficha vuelve a Pendiente y pierde los sellos', fichaReabierta.estado === 'Pendiente' && !fichaReabierta.validada_en);
const eventoFicha = uno(
  `SELECT * FROM historial WHERE reconfirmacion_id = ? AND tipo = 'reconfirmacion.reabierta'`,
  fichaSur.id,
);
const copiaFicha = JSON.parse(eventoFicha.datos_anteriores);
ok(
  'Se puede reconstruir la respuesta, la evidencia y las cantidades anteriores',
  copiaFicha.reconfirmacion.respuesta_club === 'Confirma.' &&
    copiaFicha.reconfirmacion.evidencia_url === 'https://example.invalid/sur' &&
    copiaFicha.cantidadesFinales[0].tiras_reconfirmadas === 2,
);
acepta('Ahora sí reabre el acta con motivo', () =>
  reuniones.reabrirActa(dir1, reunionSur.id, { motivo: 'Corregir la cantidad acordada registrada en el acta.' }),
);
ok('El acta reabierta vuelve a borrador sin sellos', (() => {
  const r = reuniones.obtener(reunionSur.id);
  return r.acta_estado === 'Borrador' && !r.acta_validada_en && !r.acta_validada_por_id;
})());
acepta('Con el acta reabierta, lo acordado vuelve a ser editable desde el acta', () =>
  reuniones.guardarAcuerdos(dir1, reunionSur.id, {
    [`acordado_${catSur.id}`]: 'Mantiene y suma una',
  }),
);

// Fallo parcial: si algo falla en el medio, no queda cambio sin auditoría ni auditoría sin cambio.
const antesDeFallo = uno('SELECT count(*) AS n FROM historial').n;
const balanceAntes = planes.obtener(plan.id).balance;
try {
  enTransaccion(() => {
    registrar({
      actor: dir1,
      tipo: 'prueba.fallo_parcial',
      entidad: 'plan',
      entidadId: plan.id,
      planId: plan.id,
      motivo: 'Evento que no debe quedar si el cambio falla.',
    });
    // Este cambio viola el bloqueo del acta aprobada y aborta la transacción.
    ejecutar(`UPDATE reunion SET acta = 'cambio ilegal' WHERE id = ?`, reunion.id);
  });
} catch {
  // se espera el fallo
}
ok(
  'Un fallo en el medio deshace también el evento de auditoría',
  uno('SELECT count(*) AS n FROM historial').n === antesDeFallo &&
    planes.obtener(plan.id).balance === balanceAntes &&
    reuniones.obtener(reunion.id).acta !== 'cambio ilegal',
);

// --- 5. Unicidad y concurrencia ---------------------------------------------

seccion('5. Unicidad y concurrencia');

rechaza(
  'No hay dos planes para el mismo club y ciclo (interfaz)',
  () => planes.crear(dir1, club.id, {}),
  'ya tiene un plan',
);
rechaza(
  'Tampoco por inserción directa: lo impide la base',
  () =>
    ejecutar(
      `INSERT INTO plan (id, club_id, anio_cierre, anio_objetivo, estado, creado_en)
       VALUES (?, ?, 2026, 2027, 'Abierta', ?)`,
      nuevoId(),
      club.id,
      ahora(),
    ),
  'UNIQUE|ya tiene',
);
rechaza(
  'No hay dos disciplinas iguales en un plan',
  () => planes.agregarDisciplina(dir1, plan2.id, { disciplina: 'formativas', tiras_base: '1' }),
  'ya está en el plan',
);
rechaza(
  'No hay dos fichas finales para un plan (interfaz)',
  () => reconfirmaciones.crear(dir1, plan2.id, { fecha_prevista: '2027-01-05' }),
  'ya tiene su ficha',
);
rechaza(
  'Tampoco por inserción directa',
  () =>
    ejecutar(
      `INSERT INTO reconfirmacion (id, plan_id, fecha_prevista, estado, creado_en)
       VALUES (?, ?, '2027-01-05', 'Pendiente', ?)`,
      nuevoId(),
      plan2.id,
      ahora(),
    ),
  'UNIQUE|ya tiene',
);

// Dos direcciones abren la misma ficha de club y guardan sobre la misma versión.
const clubSurActual = clubes.obtener(club2.id);
const versionCompartida = clubSurActual.version;
const comunes = { nombre: clubSurActual.nombre, responsable_id: clubSurActual.responsable_id };
acepta('La primera dirección guarda su cambio', () =>
  clubes.editar(dir1, club2.id, {
    ...comunes,
    prioridad: '1',
    notas: 'Nota de la dirección 1.',
    version: versionCompartida,
  }),
);
let conflictoDetectado = null;
try {
  clubes.editar(dir2, club2.id, {
    ...comunes,
    prioridad: '3',
    notas: 'Nota de la dirección 2.',
    version: versionCompartida,
  });
} catch (error) {
  conflictoDetectado = error;
}
ok(
  'La segunda escritura sobre la misma versión informa conflicto y no pisa la primera',
  conflictoDetectado instanceof ErrorConflictoVersion &&
    clubes.obtener(club2.id).notas === 'Nota de la dirección 1.',
);
ok(
  'El conflicto muestra las diferencias para revisarlas',
  Boolean(conflictoDetectado?.diferencias?.some((d) => d.campo === 'notas' && d.enviado.includes('dirección 2'))),
);

// --- 6. Cantidades y fechas -------------------------------------------------

seccion('6. Cantidades y fechas');

const planFechas = planes.crear(dir1, clubes.crear(dir1, { nombre: 'Club de prueba Fechas' }).id, {});
const catCero = planes.agregarDisciplina(dir1, planFechas.id, { disciplina: 'Prueba', tiras_base: '0' });
ok('Cero es un valor aceptado', planes.detalle(catCero.id).tiras_base === 0);
ok('Vacío se conserva como desconocido, no como cero', planes.detalle(catCero.id).tiras_propuestas === null);
rechaza(
  'Una cantidad negativa se rechaza',
  () => planes.editarDisciplina(dir1, catCero.id, { tiras_base: '-1' }),
  'entero de 0 o más',
);
rechaza(
  'Una cantidad con decimales se rechaza',
  () => planes.editarDisciplina(dir1, catCero.id, { tiras_base: '1.5' }),
  'entero de 0 o más',
);
rechaza(
  'Tampoco entra un negativo por inserción directa',
  () => ejecutar('UPDATE plan_detalle SET tiras_base = -5 WHERE id = ?', catCero.id),
  'CHECK|integridad',
);
rechaza(
  'Una cantidad acordada sin acta que la respalde no entra ni por inserción directa',
  () => ejecutar('UPDATE plan_detalle SET tiras_acordadas = 2 WHERE id = ?', catCero.id),
  'CHECK|integridad',
);
rechaza(
  'Un acuerdo en palabras sin acta que lo respalde tampoco entra',
  () => ejecutar(`UPDATE plan_detalle SET acordado_texto = 'Mantiene' WHERE id = ?`, catCero.id),
  'en que reunion',
);

ok(
  'El fin no se carga a mano: lo calcula el sistema y queda después del inicio',
  (() => {
    const r = reuniones.crear(dir1, planFechas.id, {
      fecha: hoy(),
      hora: '10:00',
      fin: `${hoy()}T09:00`, // dato enviado de más: se ignora
      director1_id: dir1.id,
      director2_id: dir2.id,
      acta_responsable_id: colab.id,
    });
    return r.fin > r.inicio && r.fin.startsWith(`${hoy()}T10:45`);
  })(),
);
rechaza(
  'Sin fecha no se puede agendar una hora suelta',
  () =>
    reuniones.crear(dir1, planFechas.id, {
      hora: '10:00',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'la fecha y la hora',
);
rechaza(
  'La Dirección que acompaña no puede ser la misma que la tiene',
  () =>
    reuniones.crear(dir1, planFechas.id, {
      fecha: hoy(),
      hora: '10:00',
      lugar: 'x',
      director1_id: dir1.id,
      director2_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'otra persona',
);
rechaza(
  'Si la reunión es en el club, hace falta la dirección',
  () =>
    reuniones.crear(dir1, planFechas.id, {
      fecha: hoy(),
      hora: '10:00',
      modalidad: 'En el club',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'indicá la dirección',
);
rechaza(
  'Un usuario de consulta no puede tomar el acta',
  () =>
    reuniones.crear(dir1, planFechas.id, {
      fecha: hoy(),
      hora: '10:00',
      lugar: 'x',
      director1_id: dir1.id,
      director2_id: dir2.id,
      acta_responsable_id: consulta.id,
    }),
  'rol',
);

conActaAprobada(planFechas);
acepta('Fecha prevista 01/01/2027 se acepta', () =>
  reconfirmaciones.crear(dir1, planFechas.id, { fecha_prevista: '2027-01-01' }),
);
const planFechas2 = planes.crear(dir1, clubes.crear(dir1, { nombre: 'Club de prueba Fechas 2' }).id, {});
conActaAprobada(planFechas2);
acepta('Fecha prevista 28/02/2027 se acepta', () =>
  reconfirmaciones.crear(dir1, planFechas2.id, { fecha_prevista: '2027-02-28' }),
);
const planFechas3 = planes.crear(dir1, clubes.crear(dir1, { nombre: 'Club de prueba Fechas 3' }).id, {});
conActaAprobada(planFechas3);
rechaza(
  'Fecha prevista fuera de ventana sin motivo se rechaza y explica la excepción',
  () => reconfirmaciones.crear(dir1, planFechas3.id, { fecha_prevista: '2027-03-15' }),
  'fuera de la ventana',
);
acepta('Fuera de ventana con motivo de excepción se acepta', () =>
  reconfirmaciones.crear(dir1, planFechas3.id, {
    fecha_prevista: '2027-03-15',
    motivo_excepcion: 'El club pidió retomar el tema en marzo.',
  }),
);

const fichaFechas = reconfirmaciones.porPlan(planFechas.id);
rechaza(
  'Una fecha de contacto futura se rechaza',
  () =>
    reconfirmaciones.registrarContacto(dir1, fichaFechas.id, {
      fecha_contacto: sumarDias(hoy(), 3),
      canal: 'Telefono',
      interlocutor: 'x',
      proximo_contacto: sumarDias(hoy(), 10),
    }),
  'posterior a hoy',
);
rechaza(
  'Un contacto real fuera de ventana exige motivo de excepción',
  () =>
    reconfirmaciones.registrarContacto(dir1, fichaFechas.id, {
      fecha_contacto: hoy(),
      canal: 'Telefono',
      interlocutor: 'x',
      proximo_contacto: sumarDias(hoy(), 10),
    }),
  'fuera de la ventana',
);
acepta('Con motivo de excepción y validación de Dirección se registra', () =>
  reconfirmaciones.registrarContacto(dir1, fichaFechas.id, {
    fecha_contacto: hoy(),
    canal: 'Telefono',
    interlocutor: 'Delegado de prueba',
    proximo_contacto: sumarDias(hoy(), 10),
    motivo_excepcion: 'Contacto adelantado a pedido del club.',
  }),
);
rechaza(
  'El próximo contacto no puede ser anterior al contacto',
  () =>
    reconfirmaciones.registrarContacto(dir1, fichaFechas.id, {
      fecha_contacto: hoy(),
      canal: 'Telefono',
      interlocutor: 'x',
      proximo_contacto: sumarDias(hoy(), -5),
      motivo_excepcion: 'Prueba.',
    }),
  'anterior a la fecha de contacto',
);

// --- 7. Resultados e indicadores --------------------------------------------

seccion('7. Resultados e indicadores');

rechaza(
  'Confirmar sin evidencia se rechaza',
  () =>
    reconfirmaciones.validarResultado(dir1, fichaFechas.id, 'Confirmado', {
      fecha_contacto: hoy(),
      canal: 'Telefono',
      interlocutor: 'x',
      respuesta_club: 'Confirma',
      motivo_excepcion: 'Prueba.',
    }),
  'evidencia',
);
rechaza(
  'Confirmar sin acta aprobada ni cantidades finales se rechaza',
  () =>
    reconfirmaciones.validarResultado(dir1, fichaFechas.id, 'Confirmado', {
      fecha_contacto: hoy(),
      canal: 'Telefono',
      interlocutor: 'x',
      respuesta_club: 'Confirma',
      evidencia_url: 'https://example.invalid/x',
      motivo_excepcion: 'Prueba.',
    }),
  'acta aprobada|cantidad',
);
acepta('Una respuesta condicional se registra sin cerrar el caso', () =>
  reconfirmaciones.registrarCondicional(dir1, fichaFechas.id, {
    fecha_contacto: hoy(),
    canal: 'WhatsApp',
    interlocutor: 'Delegado de prueba',
    condiciones: 'Confirma si consigue entrenador.',
    proximo_contacto: sumarDias(hoy(), 20),
    motivo_excepcion: 'Prueba.',
  }),
);
ok(
  'Condicional no lleva sello de resultado final',
  reconfirmaciones.obtener(fichaFechas.id).validada_en === null,
);

const indicadores1 = consultas.indicadores(2027);
const confirmadosAntes = indicadores1.confirmados;
acepta('Un intento sin respuesta se registra y mantiene el caso abierto', () =>
  reconfirmaciones.registrarSinRespuesta(dir1, fichaFechas.id, {
    fecha_contacto: hoy(),
    canal: 'Telefono',
    proximo_contacto: sumarDias(hoy(), 7),
    motivo_excepcion: 'Prueba.',
  }),
);
ok(
  'Sin respuesta no aumenta los confirmados ni se convierte en baja',
  consultas.indicadores(2027).confirmados === confirmadosAntes &&
    reconfirmaciones.obtener(fichaFechas.id).estado === 'Sin respuesta',
);

// Varias reuniones de un mismo club no inflan el conteo de clubes.
const clubesAntes = consultas.indicadores(2027).clubesDelCiclo;
reuniones.crear(dir1, planFechas.id, {
  fecha: sumarDias(hoy(), 2),
  hora: '10:00',
  lugar: 'Segunda reunión',
  director1_id: dir1.id,
  director2_id: dir2.id,
  acta_responsable_id: colab.id,
});
ok('Varias reuniones de un club no aumentan el número de clubes', consultas.indicadores(2027).clubesDelCiclo === clubesAntes);

// Retención: sin clubes en el ciclo queda vacía; con datos es confirmados/clubes.
ok('Retención vacía cuando no hay clubes del ciclo', consultas.indicadores(2030).retencion === null);
const ind = consultas.indicadores(2027);
ok(
  `Retención calculada sobre clubes únicos (${ind.confirmados} de ${ind.clubesDelCiclo})`,
  Math.abs(ind.retencion - ind.confirmados / ind.clubesDelCiclo) < 1e-9,
);

// Un conflicto de duplicados deja al plan fuera del total confirmado y bloquea su cierre.
const confirmadosPrevios = consultas.indicadores(2027).confirmados;
enTransaccion(() =>
  registrarConflicto({
    origen: 'prueba',
    entidad: 'reconfirmacion',
    clave: `plan ${plan.id}`,
    detalle: 'Dos fichas finales importadas para el mismo plan.',
    clubId: club.id,
    planId: plan.id,
    datos: { fila: 'rechazada' },
  }),
);
ok(
  'Un conflicto importado no queda contado como confirmación válida',
  consultas.indicadores(2027).confirmados === confirmadosPrevios - 1,
);
ok('El conflicto queda visible como indicador propio', consultas.indicadores(2027).conflictos === 1);
ok(
  'El indicador de confirmados se puede abrir y comparar con sus registros',
  consultas.registrosDeIndicador('confirmados', 2027).filas.length === consultas.indicadores(2027).confirmados,
);

// La cobertura distingue cantidades faltantes de ceros.
const tiras = consultas.indicadores(2027).tiras;
ok('Las métricas de tiras informan cobertura además del total', tiras.propuestasFaltan >= 1 && tiras.disciplinas >= 3);

// --- 8. Portabilidad --------------------------------------------------------

seccion('8. Portabilidad');

const respaldo = exportar.respaldoCompleto();
ok(
  'El respaldo JSON incluye las diez tablas y el historial',
  Object.keys(respaldo.tablas).length === exportar.TABLAS.length && respaldo.tablas.historial.length > 0,
);
const csv = exportar.aCsv(exportar.datosDeTabla('club'));
ok('La exportación CSV trae encabezados y una línea por club', csv.split('\r\n').filter(Boolean).length === todos('SELECT id FROM club').length + 1);
ok('Las comillas y comas del contenido se escapan en el CSV', exportar.aCsv([{ a: 'con "comillas", y coma' }]).includes('"con ""comillas"", y coma"'));

// --- 9. Disponibilidad de Dirección -----------------------------------------

seccion('9. Disponibilidad para que le agenden');

// El lunes siguiente, para que las pruebas no dependan del día en que corran.
const lunes = (() => {
  let fecha = hoy();
  while (disponibilidad.diaSemanaDe(fecha) !== 1) fecha = sumarDias(fecha, 1);
  return fecha;
})();

acepta('Dirección carga un horario propio', () =>
  disponibilidad.agregarFranja(dir1, { dia_semana: '1', desde: '18:00', hasta: '21:00' }),
);
rechaza(
  'Una franja que se pisa con otra del mismo día se rechaza',
  () => disponibilidad.agregarFranja(dir1, { dia_semana: '1', desde: '20:00', hasta: '22:00' }),
  'se pise|Ya tenés',
);
rechaza(
  'La hora de fin tiene que ser posterior a la de inicio',
  () => disponibilidad.agregarFranja(dir1, { dia_semana: '2', desde: '21:00', hasta: '19:00' }),
  'posterior',
);
rechaza(
  'Nadie carga la disponibilidad de otra persona',
  () => disponibilidad.agregarFranja(dir1, { usuario_id: dir2.id, dia_semana: '3', desde: '10:00', hasta: '12:00' }),
  'su propia disponibilidad',
);
rechaza(
  'Un ayudante no carga disponibilidad',
  () => disponibilidad.agregarFranja(colab, { dia_semana: '1', desde: '10:00', hasta: '12:00' }),
  'Solo Dirección',
);

ok(
  'Un horario dentro de la franja queda disponible',
  disponibilidad.revisar(dir1.id, `${lunes}T19:00`, `${lunes}T20:00`).disponible === true,
);
ok(
  'Un horario fuera de la franja avisa qué días atiende',
  disponibilidad.revisar(dir1.id, `${lunes}T09:00`, `${lunes}T10:00`).motivo?.includes('18:00 a 21:00'),
);
ok(
  'Un día sin horarios cargados también avisa',
  disponibilidad.revisar(dir1.id, `${sumarDias(lunes, 1)}T19:00`, `${sumarDias(lunes, 1)}T20:00`).disponible === false,
);

acepta('Dirección avisa que no está (vacaciones)', () =>
  disponibilidad.agregarAusencia(dir1, { desde: lunes, hasta: sumarDias(lunes, 14), motivo: 'Vacaciones' }),
);
ok(
  'Durante las vacaciones no está disponible, aunque el horario encaje',
  disponibilidad.revisar(dir1.id, `${lunes}T19:00`, `${lunes}T20:00`).motivo?.includes('Vacaciones'),
);

const avisoFuera = disponibilidad.avisoDeAgenda({
  director1_id: dir1.id,
  inicio: `${lunes}T19:00`,
  fin: `${lunes}T20:00`,
});
ok('El aviso para quien agenda nombra a la persona y el motivo', Boolean(avisoFuera && avisoFuera.includes('Vacaciones')));

acepta('Se puede agendar igual: el horario avisa, no bloquea', () =>
  reuniones.crear(colab, planProceso.id, {
    fecha: lunes,
    hora: '19:00',
    modalidad: 'En la liga',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
  }),
);

// --- 10. Duración según dónde se hace --------------------------------------

seccion('10. Ir al club ocupa la tarde');

const martes = (() => {
  let fecha = hoy();
  while (disponibilidad.diaSemanaDe(fecha) !== 2) fecha = sumarDias(fecha, 1);
  return fecha;
})();

const enLaLiga = acepta('Una reunión en la liga dura 45 minutos', () =>
  reuniones.crear(dir1, planProceso.id, {
    fecha: martes,
    hora: '18:00',
    modalidad: 'En la liga',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
  }),
);
ok('El fin se calculó solo', enLaLiga.inicio.startsWith(`${martes}T18:00`) && enLaLiga.fin.startsWith(`${martes}T18:45`));

const visita = acepta('Una reunión en el club dura tres horas', () =>
  reuniones.crear(dir1, planProceso.id, {
    fecha: sumarDias(martes, 7),
    hora: '18:00',
    modalidad: 'En el club',
    lugar: 'Sede del club de prueba',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
  }),
);
ok('Tres horas desde el inicio', visita.fin.startsWith(`${sumarDias(martes, 7)}T21:00`));

rechaza(
  'No se agenda antes de las 08:00',
  () =>
    reuniones.crear(dir1, planProceso.id, {
      fecha: martes,
      hora: '07:30',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'entre las 08:00',
);
rechaza(
  'Ni después de las 22:00',
  () =>
    reuniones.crear(dir1, planProceso.id, {
      fecha: martes,
      hora: '22:30',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'entre las 08:00',
);
rechaza(
  'La videollamada ya no es una opción',
  () =>
    reuniones.crear(dir1, planProceso.id, {
      fecha: martes,
      hora: '10:00',
      modalidad: 'Videollamada',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'no permitido',
);

const pegadaAlClub = reuniones.superposiciones({
  inicio: `${sumarDias(martes, 7)}T20:00`,
  fin: `${sumarDias(martes, 7)}T20:45`,
  director1_id: dir1.id,
});
ok('Una reunión dentro de las tres horas del club se marca como superpuesta', pegadaAlClub.some((o) => o.id === visita.id));

const despues = reuniones.superposiciones({
  inicio: `${sumarDias(martes, 7)}T21:15`,
  fin: `${sumarDias(martes, 7)}T22:00`,
  director1_id: dir1.id,
});
ok('Una reunión posterior a las tres horas no se marca', !despues.some((o) => o.id === visita.id));

const encadenada = reuniones.superposiciones({
  inicio: `${martes}T19:00`,
  fin: `${martes}T19:45`,
  director1_id: dir1.id,
});
ok('En la liga se encadenan dos reuniones con 15 minutos entre una y otra', !encadenada.some((o) => o.id === enLaLiga.id));

// --- 11. Clubes que contactan los directivos --------------------------------

seccion('11. Clubes que contacta Dirección');

const clubDirecto = clubes.crear(dir1, { nombre: 'Club de prueba Directivos', contacto_directo: '1' });
const planDirecto = planes.crear(dir1, clubDirecto.id, {});
ok('El club queda marcado', clubes.obtener(clubDirecto.id).contacto_directo === 1);
rechaza(
  'Un ayudante no agenda reuniones con un club de Dirección',
  () =>
    reuniones.crear(colab, planDirecto.id, {
      fecha: martes,
      hora: '18:00',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }),
  'lo contacta Dirección',
);
acepta('Dirección sí agenda con ese club', () =>
  reuniones.crear(dir1, planDirecto.id, {
    fecha: martes,
    hora: '09:00',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
  }),
);

// --- 12. Lo acordado se carga en el acta ------------------------------------

seccion('12. Lo acordado se carga en el acta');

const clubAcuerdo = clubes.crear(dir1, { nombre: 'Club de prueba Acuerdos', responsable_id: dir1.id });
const planAcuerdo = planes.crear(dir1, clubAcuerdo.id, {});
const discMasc = planes.agregarDisciplina(dir1, planAcuerdo.id, {
  disciplina: 'Masculino',
  divisiones_2026: 'Liga de Honor B\n1ra a 5ta BAFI',
  intencion_2027: 'Mantener',
});
const discFem = planes.agregarDisciplina(dir1, planAcuerdo.id, { disciplina: 'Femenino' });
const discVet = planes.agregarDisciplina(dir1, planAcuerdo.id, { disciplina: 'Veteranos' });

const reunionAcuerdo = reuniones.crear(dir1, planAcuerdo.id, {
  fecha: martes,
  hora: '10:00',
  director1_id: dir1.id,
  acta_responsable_id: colab.id,
});
reuniones.programar(dir1, reunionAcuerdo.id);

rechaza(
  'Sin programar no habría acuerdos: primero la reunión',
  () =>
    reuniones.guardarAcuerdos(dir1, reuniones.crear(dir1, planAcuerdo.id, {
      fecha: martes,
      hora: '11:00',
      director1_id: dir1.id,
      acta_responsable_id: colab.id,
    }).id, { [`acordado_${discFem.id}`]: 'Mantiene' }),
  'programar',
);

acepta('El ayudante que toma el acta carga lo acordado', () =>
  reuniones.guardarAcuerdos(colab, reunionAcuerdo.id, {
    [`acordado_${discMasc.id}`]: 'Mantiene Liga de Honor B y sube una a 1ra BAFI',
    [`acordado_${discFem.id}`]: 'No arma femenino en 2027',
    [`acordado_${discVet.id}`]: '',
  }),
);
ok(
  'Un acuerdo en palabras vale sin número',
  (() => {
    const d = planes.detalle(discMasc.id);
    return d.acordado_texto.startsWith('Mantiene Liga de Honor B') && d.tiras_acordadas === null &&
      d.reunion_acuerdo_id === reunionAcuerdo.id;
  })(),
);
ok(
  'El acta no guarda cantidades: lo acordado es solo lo que se escribió',
  planes.detalle(discFem.id).acordado_texto === 'No arma femenino en 2027' &&
    planes.detalle(discFem.id).tiras_acordadas === null,
);
ok(
  'Una disciplina de la que no se habló no queda atada al acta',
  (() => {
    const d = planes.detalle(discVet.id);
    return d.reunion_acuerdo_id === null && d.acordado_texto === null && d.tiras_acordadas === null;
  })(),
);

reuniones.guardarActa(colab, reunionAcuerdo.id, {
  delegados_presentes: 'Delegado de prueba',
  acta: 'Se repasó disciplina por disciplina.',
  devolucion_club: 'Conformes.',
  proximo_paso: 'Esperar la reconfirmación.',
});
reuniones.marcarRealizada(dir1, reunionAcuerdo.id);
reuniones.enviarActaARevision(colab, reunionAcuerdo.id);
acepta('El acta se aprueba con acuerdos en palabras y sin números', () =>
  reuniones.aprobarActa(dir1, reunionAcuerdo.id),
);
rechaza(
  'Con el acta aprobada, lo acordado en palabras queda bloqueado',
  () =>
    reuniones.guardarAcuerdos(dir1, reunionAcuerdo.id, {
      [`acordado_${discMasc.id}`]: 'otra cosa',
    }),
  'aprobada',
);
rechaza(
  'Ni por inserción directa sobre la base',
  () => ejecutar(`UPDATE plan_detalle SET acordado_texto = 'otra cosa' WHERE id = ?`, discMasc.id),
  'bloquead',
);

// Una disciplina atada al acta y en blanco sí traba la aprobación: es un olvido, no un
// "no se habló". Se arma a mano para probar el disparador de la base.
const planTrabado = planes.crear(dir1, clubes.crear(dir1, { nombre: 'Club de prueba Trabado' }).id, {});
const discTrabada = planes.agregarDisciplina(dir1, planTrabado.id, { disciplina: 'Masculino' });
const reunionTrabada = reuniones.crear(dir1, planTrabado.id, {
  fecha: martes,
  hora: '12:00',
  director1_id: dir1.id,
  acta_responsable_id: colab.id,
});
reuniones.programar(dir1, reunionTrabada.id);
reuniones.guardarActa(colab, reunionTrabada.id, {
  delegados_presentes: 'Delegado',
  acta: 'Acta.',
  devolucion_club: 'Devolución.',
  proximo_paso: 'Paso.',
});
reuniones.marcarRealizada(dir1, reunionTrabada.id);
ejecutar('UPDATE plan_detalle SET reunion_acuerdo_id = ? WHERE id = ?', reunionTrabada.id, discTrabada.id);
reuniones.enviarActaARevision(colab, reunionTrabada.id);
rechaza(
  'Una disciplina atada al acta y sin acuerdo no deja aprobarla',
  () => reuniones.aprobarActa(dir1, reunionTrabada.id),
  'Falta decir qué se acordó',
);

// --- 13. Observaciones de la reunión y prioridad del club -------------------

seccion('13. Observaciones de la reunión y prioridad del club');

const reunionConNota = acepta('Se anota una observación al agendar', () =>
  reuniones.crear(dir1, planAcuerdo.id, {
    fecha: martes,
    hora: '16:00',
    director1_id: dir1.id,
    acta_responsable_id: colab.id,
    nota: 'Llamar antes de ir: el delegado trabaja hasta las 18.',
  }),
);
ok(
  'La observación queda guardada con la reunión',
  reuniones.obtener(reunionConNota.id).nota.startsWith('Llamar antes de ir'),
);

// La reunión con el acta ya aprobada: la observación tiene que seguir escribiéndose.
ok('El acta de la reunión de acuerdos está aprobada', reuniones.obtener(reunionAcuerdo.id).acta_estado === 'Validada');
acepta('Con el acta aprobada igual se anota una observación', () =>
  reuniones.guardarNota(dir1, reunionAcuerdo.id, { nota: 'Quedó pendiente mandarles el reglamento.' }),
);
ok(
  'La observación se guardó sin tocar el acta',
  reuniones.obtener(reunionAcuerdo.id).nota === 'Quedó pendiente mandarles el reglamento.' &&
    reuniones.obtener(reunionAcuerdo.id).acta_estado === 'Validada',
);
rechaza(
  'El acta aprobada sigue bloqueada',
  () => reuniones.guardarActa(dir1, reunionAcuerdo.id, { acta: 'otra cosa' }),
  'aprobada',
);
acepta('El ayudante que coordina también anota', () =>
  reuniones.guardarNota(colab, reunionAcuerdo.id, { nota: 'Reglamento enviado.' }),
);
rechaza(
  'Consulta no anota',
  () => reuniones.guardarNota(consulta, reunionAcuerdo.id, { nota: 'x' }),
  'no puede escribir|consulta',
);

// La prioridad vive en el club: sobrevive al ciclo y no se carga por plan.
acepta('Dirección cambia la prioridad del club', () =>
  clubes.editar(dir1, clubAcuerdo.id, { nombre: clubAcuerdo.nombre, prioridad: '1' }),
);
ok('Queda guardada en el club', clubes.obtener(clubAcuerdo.id).prioridad === '1');
rechaza(
  'Una prioridad inventada no entra',
  () => clubes.editar(dir1, clubAcuerdo.id, { nombre: clubAcuerdo.nombre, prioridad: '9' }),
  'prioridad',
);
rechaza(
  'Ni por inserción directa sobre la base',
  () => ejecutar(`UPDATE club SET prioridad = '9' WHERE id = ?`, clubAcuerdo.id),
  'CHECK|integridad',
);
ok(
  'El plan ya no guarda prioridad ni notas de preparación',
  todos(`SELECT name FROM pragma_table_info('plan')`)
    .map((c) => c.name)
    .every((n) => !['prioridad', 'balance', 'objetivo', 'riesgos', 'responsable_id', 'fecha_objetivo'].includes(n)),
);

// --- 14. La reconfirmación sale del acta ------------------------------------

seccion('14. La reconfirmación sale del acta');

const clubRecon = clubes.crear(dir1, { nombre: 'Club de prueba Reconfirmar', responsable_id: dir2.id });
const planRecon = planes.crear(dir1, clubRecon.id, {});
const discRecon = planes.agregarDisciplina(dir1, planRecon.id, { disciplina: 'Masculino', tiras_base: '2' });

rechaza(
  'Sin acta aprobada no hay ficha de reconfirmación',
  () => reconfirmaciones.crear(dir1, planRecon.id, { fecha_prevista: '2027-01-15' }),
  'acta aprobada que reconfirmar',
);

const actaRecon = conActaAprobada(planRecon, { fechaRecontacto: '2027-01-20' });
ok('El acta guarda cuándo se reconfirma', actaRecon.fecha_recontacto === '2027-01-20');

const fichaRecon = acepta('La ficha se abre sin volver a escribir la fecha', () =>
  reconfirmaciones.crear(dir1, planRecon.id, {}),
);
ok('La fecha la puso el acta', fichaRecon.fecha_prevista === '2027-01-20');
ok('La ficha queda atada a esa acta', fichaRecon.reunion_id === actaRecon.id);
ok('El responsable sale del club', fichaRecon.responsable_id === dir2.id);

rechaza(
  'El acta aprobada ya no cambia la fecha: para eso se reprograma la ficha',
  () => reuniones.guardarActa(dir1, actaRecon.id, { fecha_recontacto: '2027-02-10' }),
  'aprobada',
);

// Volver a poner fecha, las veces que haga falta.
acepta('Se reprograma a una fecha nueva', () =>
  reconfirmaciones.reprogramar(dir1, fichaRecon.id, {
    fecha_prevista: '2027-02-05',
    motivo: 'El club pidió llamarlo después del torneo de verano.',
  }),
);
ok('La ficha tomó la fecha nueva', reconfirmaciones.obtener(fichaRecon.id).fecha_prevista === '2027-02-05');
acepta('Y se vuelve a reprogramar', () =>
  reconfirmaciones.reprogramar(dir1, fichaRecon.id, { fecha_prevista: '2027-02-20' }),
);
ok('Queda la última', reconfirmaciones.obtener(fichaRecon.id).fecha_prevista === '2027-02-20');
ok(
  'Cada movida queda en el historial, con la fecha de la que venía',
  (() => {
    const movidas = todos(
      `SELECT * FROM historial WHERE reconfirmacion_id = ? AND tipo = 'reconfirmacion.reprogramada'
       ORDER BY ocurrido_en`,
      fichaRecon.id,
    );
    if (movidas.length !== 2) return false;
    const primera = JSON.parse(movidas[0].datos_anteriores);
    return primera.fecha_prevista === '2027-01-20' && movidas[0].motivo.includes('torneo de verano');
  })(),
);
rechaza(
  'Reprogramar a la misma fecha no es reprogramar',
  () => reconfirmaciones.reprogramar(dir1, fichaRecon.id, { fecha_prevista: '2027-02-20' }),
  'ya es la fecha',
);
rechaza(
  'Fuera de la ventana hace falta el motivo de excepción',
  () => reconfirmaciones.reprogramar(dir1, fichaRecon.id, { fecha_prevista: '2027-04-10' }),
  'fuera de la ventana',
);
acepta('Con motivo de excepción sí se corre fuera de la ventana', () =>
  reconfirmaciones.reprogramar(dir1, fichaRecon.id, {
    fecha_prevista: '2027-04-10',
    motivo_excepcion: 'El club arranca su temporada en abril.',
  }),
);
rechaza(
  'Consulta no reprograma',
  () => reconfirmaciones.reprogramar(consulta, fichaRecon.id, { fecha_prevista: '2027-02-02' }),
  'no puede escribir|consulta',
);
rechaza(
  'Una ficha no puede colgar de un acta de otro plan',
  () => ejecutar('UPDATE reconfirmacion SET reunion_id = ? WHERE id = ?', reunionAcuerdo.id, fichaRecon.id),
  'mismo plan',
);

// --- 15. El próximo paso no manda a una puerta cerrada ----------------------

seccion('15. El próximo paso no manda a una puerta cerrada');

const clubPaso = clubes.crear(dir1, { nombre: 'Club de prueba Proximo Paso' });
const planPaso = planes.crear(dir1, clubPaso.id, {});
ok(
  'Sin disciplinas, el paso es cargarlas',
  consultas.proximoPaso(planes.obtener(planPaso.id)).texto.includes('disciplinas'),
);
planes.agregarDisciplina(dir1, planPaso.id, { disciplina: 'Masculino', tiras_base: '1' });
ok(
  'Con disciplinas y sin reunión, el paso es agendar',
  consultas.proximoPaso(planes.obtener(planPaso.id)).texto.includes('Agendar'),
);

const reunionPaso = reuniones.crear(dir1, planPaso.id, {
  fecha: hoy(),
  hora: '15:00',
  director1_id: dir1.id,
  acta_responsable_id: colab.id,
});
ok(
  'Una reunión en borrador pide programarla, no abrir la reconfirmación',
  consultas.proximoPaso(planes.obtener(planPaso.id)).texto.includes('Programar'),
);

reuniones.programar(dir1, reunionPaso.id);
reuniones.guardarActa(colab, reunionPaso.id, {
  delegados_presentes: 'Delegado',
  acta: 'Acta.',
  devolucion_club: 'Devolución.',
  proximo_paso: 'Paso.',
});
reuniones.marcarRealizada(dir1, reunionPaso.id);
reuniones.enviarActaARevision(colab, reunionPaso.id);
reuniones.aprobarActa(dir1, reunionPaso.id);
ok(
  'Con el acta aprobada y sin fecha, el paso es abrir la ficha',
  consultas.proximoPaso(planes.obtener(planPaso.id)).texto.includes('Abrir la ficha'),
);

// Un plan cuya acta quedó cancelada no tiene de dónde reconfirmar.
const planSinActa = planes.crear(dir1, clubes.crear(dir1, { nombre: 'Club de prueba Sin Acta' }).id, {});
planes.agregarDisciplina(dir1, planSinActa.id, { disciplina: 'Masculino' });
const reunionCaida = reuniones.crear(dir1, planSinActa.id, {
  fecha: hoy(),
  hora: '16:30',
  director1_id: dir1.id,
  acta_responsable_id: colab.id,
});
reuniones.programar(dir1, reunionCaida.id);
reuniones.guardarActa(colab, reunionCaida.id, {
  delegados_presentes: 'Delegado',
  acta: 'Acta.',
  devolucion_club: 'Devolución.',
  proximo_paso: 'Paso.',
});
reuniones.marcarRealizada(dir1, reunionCaida.id);
ok(
  'Un acta en borrador pide enviarla, no abrir la reconfirmación',
  consultas.proximoPaso(planes.obtener(planSinActa.id)).texto.includes('revisión'),
);

// --- 16. Vistas y filtros de la agenda --------------------------------------

seccion('16. Vistas y filtros de la agenda');

const lunesAgenda = lunesDe(hoy());
const clubAgenda = clubes.crear(dir1, { nombre: 'Club de prueba Agenda' });
const planAgenda = planes.crear(dir1, clubAgenda.id, {});
const clubAgenda2 = clubes.crear(dir1, { nombre: 'Club de prueba Agenda 2' });
const planAgenda2 = planes.crear(dir1, clubAgenda2.id, {});

// Dos reuniones esta semana (una visita al club) y una la semana que viene.
const agEnLiga = reuniones.crear(dir1, planAgenda.id, {
  fecha: sumarDias(lunesAgenda, 1),
  hora: '18:00',
  director1_id: dir1.id,
  acta_responsable_id: colab.id,
});
const agVisita = reuniones.crear(dir2, planAgenda2.id, {
  fecha: sumarDias(lunesAgenda, 2),
  hora: '19:00',
  modalidad: 'En el club',
  lugar: 'Calle de prueba 1',
  director1_id: dir2.id,
  acta_responsable_id: colab2.id,
});
const agProxima = reuniones.crear(dir1, planAgenda.id, {
  fecha: sumarDias(lunesAgenda, 8),
  hora: '18:00',
  director1_id: dir1.id,
  acta_responsable_id: colab2.id,
});

const enRango = (desde, hasta, extra = {}) =>
  reuniones.agenda({ desde, hasta, ...extra }).map((m) => m.id);

const estaSemana = enRango(lunesAgenda, sumarDias(lunesAgenda, 6));
ok(
  'Por semana: entra lo de esta semana y no lo de la próxima',
  estaSemana.includes(agEnLiga.id) && estaSemana.includes(agVisita.id) && !estaSemana.includes(agProxima.id),
);

const unDia = enRango(sumarDias(lunesAgenda, 2), sumarDias(lunesAgenda, 2));
ok(
  'Por día: el filtro toma el día entero, no hasta medianoche en punto',
  unDia.includes(agVisita.id) && !unDia.includes(agEnLiga.id),
);

const dePersona = reuniones.agenda({ persona: colab2.id }).map((m) => m.id);
ok(
  'Por persona: aparece tanto donde toma nota como donde la tiene',
  dePersona.includes(agVisita.id) && dePersona.includes(agProxima.id) && !dePersona.includes(agEnLiga.id),
);
const deDireccion2 = reuniones.agenda({ persona: dir2.id }).map((m) => m.id);
ok('Por persona: la Dirección que la tiene también cuenta', deDireccion2.includes(agVisita.id));

const deClub = reuniones.agenda({ clubId: clubAgenda.id }).map((m) => m.id);
ok(
  'Por club: solo las de ese club',
  deClub.includes(agEnLiga.id) && deClub.includes(agProxima.id) && !deClub.includes(agVisita.id),
);

const visitas = reuniones.agenda({ modalidad: 'En el club' }).map((m) => m.id);
ok('Solo visitas al club: deja afuera las de la liga', visitas.includes(agVisita.id) && !visitas.includes(agEnLiga.id));

// Pendientes de acta: la reunión ya se hizo y el acta todavía no está aprobada.
reuniones.programar(dir1, agEnLiga.id);
reuniones.guardarActa(colab, agEnLiga.id, {
  delegados_presentes: 'Delegado',
  acta: 'Acta.',
  devolucion_club: 'Devolución.',
  proximo_paso: 'Paso.',
});
reuniones.marcarRealizada(dir1, agEnLiga.id);
const pendientes = reuniones.agenda({ pendientesDeActa: true }).map((m) => m.id);
ok(
  'Pendientes de acta: la realizada sin aprobar entra; la que no se hizo, no',
  pendientes.includes(agEnLiga.id) && !pendientes.includes(agProxima.id),
);
reuniones.enviarActaARevision(colab, agEnLiga.id);
reuniones.aprobarActa(dir1, agEnLiga.id);
ok(
  'Al aprobar el acta sale de pendientes',
  !reuniones.agenda({ pendientesDeActa: true }).map((m) => m.id).includes(agEnLiga.id),
);

ok(
  'Los filtros se combinan entre sí',
  reuniones
    .agenda({ desde: lunesAgenda, hasta: sumarDias(lunesAgenda, 6), persona: colab2.id, modalidad: 'En el club' })
    .map((m) => m.id)
    .join() === agVisita.id,
);

const clubSinReuniones = clubes.crear(dir1, { nombre: 'Club de prueba Sin Reuniones' });
planes.crear(dir1, clubSinReuniones.id, {});
ok(
  'Los clubes que se ofrecen como filtro son los que tienen reuniones',
  (() => {
    const ids = reuniones.clubesConReuniones().map((c) => c.id);
    return ids.includes(clubAgenda.id) && ids.includes(clubAgenda2.id) && !ids.includes(clubSinReuniones.id);
  })(),
);

// La semana del equipo arranca el lunes, también cuando hoy es domingo.
ok('La semana empieza el lunes', lunesDe('2026-11-05') === '2026-11-02');
ok('Un domingo pertenece a la semana que termina', lunesDe('2026-11-08') === '2026-11-02');
ok('Un lunes es su propio lunes', lunesDe('2026-11-02') === '2026-11-02');

// --- 17. El acta es un solo documento ---------------------------------------

seccion('17. El acta es un solo documento');

const clubUno = clubes.crear(dir1, { nombre: 'Club de prueba Acta Unica' });
const planUno = planes.crear(dir1, clubUno.id, {});
const discUno = planes.agregarDisciplina(dir1, planUno.id, {
  disciplina: 'Masculino',
  divisiones_2026: 'Liga de Honor B',
  intencion_2027: 'Mantener',
});
const reunionUno = reuniones.crear(dir1, planUno.id, {
  fecha: hoy(),
  hora: '14:00',
  director1_id: dir1.id,
  acta_responsable_id: colab.id,
});
reuniones.programar(dir1, reunionUno.id);

// Lo que escribe el formulario del acta: el contenido y lo acordado, en un solo envío.
const envio = {
  delegados_presentes: 'Delegado del club.',
  acta: 'Se repasó disciplina por disciplina.',
  devolucion_club: 'Conformes.',
  proximo_paso: 'Esperar la reconfirmación.',
  fecha_recontacto: '2027-01-15',
  [`acordado_${discUno.id}`]: 'Mantiene Liga de Honor B.',
};
acepta('El acta se guarda entera en un envío', () => {
  reuniones.guardarActa(colab, reunionUno.id, envio);
  return reuniones.guardarAcuerdos(colab, reunionUno.id, envio);
});
ok(
  'Quedaron el contenido, la fecha y lo acordado',
  (() => {
    const m = reuniones.obtener(reunionUno.id);
    const d = planes.detalle(discUno.id);
    return (
      m.acta === 'Se repasó disciplina por disciplina.' &&
      m.fecha_recontacto === '2027-01-15' &&
      d.acordado_texto === 'Mantiene Liga de Honor B.' &&
      d.reunion_acuerdo_id === reunionUno.id
    );
  })(),
);

// El acta no toma cantidades: aunque alguien las mande, no entran.
reuniones.guardarAcuerdos(colab, reunionUno.id, {
  [`acordado_${discUno.id}`]: 'Mantiene Liga de Honor B.',
  [`tiras_${discUno.id}`]: '3',
});
ok(
  'Una cantidad enviada al acta se ignora: lo acordado es texto',
  planes.detalle(discUno.id).tiras_acordadas === null,
);

// Borrar el texto desata la disciplina del acta, igual que antes.
reuniones.guardarAcuerdos(colab, reunionUno.id, { [`acordado_${discUno.id}`]: '' });
ok(
  'Vaciar lo acordado desata la disciplina de esta acta',
  planes.detalle(discUno.id).acordado_texto === null && planes.detalle(discUno.id).reunion_acuerdo_id === null,
);

// --- 18. Entrar: enlaces de un solo uso -------------------------------------

seccion('18. Entrar: enlaces de un solo uso');

const enlace1 = acepta('Dirección genera un enlace para el ayudante', () =>
  accesos.generarParaOtro(dir1, colab.id),
);
ok('Devuelve el token una sola vez', typeof enlace1.token === 'string' && enlace1.token.length >= 40);
ok(
  'En la base queda el hash, no el token',
  (() => {
    const fila = uno('SELECT * FROM acceso WHERE id = ?', enlace1.acceso.id);
    return fila.token_hash !== enlace1.token && !JSON.stringify(fila).includes(enlace1.token);
  })(),
);
ok('El enlace todavía no se usó', uno('SELECT usado_en FROM acceso WHERE id = ?', enlace1.acceso.id).usado_en === null);

ok('Leer el enlace no lo gasta', accesos.leer(enlace1.token)?.usuario.id === colab.id);
ok('Sigue sin usarse', uno('SELECT usado_en FROM acceso WHERE id = ?', enlace1.acceso.id).usado_en === null);

const entro = acepta('Se entra con el enlace', () => accesos.usar(enlace1.token));
ok('Entra la persona correcta', entro.id === colab.id);
rechaza('El mismo enlace no sirve dos veces', () => accesos.usar(enlace1.token), 'no sirve');
ok('Queda registrado cuándo entró', uno('SELECT usado_en FROM acceso WHERE id = ?', enlace1.acceso.id).usado_en !== null);
rechaza(
  'Ni reabriéndolo por inserción directa',
  () => ejecutar('UPDATE acceso SET usado_en = NULL WHERE id = ?', enlace1.acceso.id),
  'no se reabre',
);

rechaza('Un token inventado no entra', () => accesos.usar('no-existo-' + 'x'.repeat(40)), 'no sirve');
rechaza('Un token vacío no entra', () => accesos.usar(''), 'no sirve');

// Entrar deja sin efecto lo que quedaba pendiente de esa persona.
const a1 = accesos.generarParaOtro(dir1, colab2.id);
const a2 = accesos.generarParaOtro(dir1, colab2.id);
ok('Dos enlaces pendientes conviven', accesos.pendientesDe(colab2.id).length === 2);
accesos.usar(a1.token);
ok('Entrar con uno anula el otro', accesos.pendientesDe(colab2.id).length === 0);
rechaza('Y el otro ya no sirve', () => accesos.usar(a2.token), 'no sirve');

// Un enlace vencido no sirve, aunque nunca se haya usado.
const vencido = accesos.generarParaOtro(dir1, colab.id);
ejecutar(
  'UPDATE acceso SET creado_en = ?, expira_en = ? WHERE id = ?',
  '2020-01-01T00:00:00-03:00',
  '2020-01-01T00:15:00-03:00',
  vencido.acceso.id,
);
rechaza('Un enlace vencido no entra', () => accesos.usar(vencido.token), 'no sirve');
rechaza(
  'La base no acepta un enlace que venza antes de existir',
  () =>
    ejecutar(
      'UPDATE acceso SET expira_en = ? WHERE id = ?',
      '2019-01-01T00:00:00-03:00',
      vencido.acceso.id,
    ),
  'CHECK|constraint',
);

// Un usuario inactivo no entra ni con enlace en la mano.
const aInactivo = accesos.generarParaOtro(dir1, consulta.id);
usuarios.cambiarAcceso(dir1, consulta.id, { rol: 'Consulta', activo: '0' });
rechaza('Un usuario desactivado no entra con el enlace que ya tenía', () => accesos.usar(aInactivo.token), 'no sirve');
usuarios.cambiarAcceso(dir1, consulta.id, { rol: 'Consulta', activo: '1' });
rechaza(
  'Tampoco se le genera uno nuevo mientras está inactivo',
  () => {
    usuarios.cambiarAcceso(dir1, consulta.id, { rol: 'Consulta', activo: '0' });
    return accesos.generarParaOtro(dir1, consulta.id);
  },
  'inactivo',
);
usuarios.cambiarAcceso(dir1, consulta.id, { rol: 'Consulta', activo: '1' });

// Quién puede dar acceso.
rechaza('Un ayudante no genera enlaces para otros', () => accesos.generarParaOtro(colab, dir2.id), 'Solo Dirección');
rechaza('Consulta tampoco', () => accesos.generarParaOtro(consulta, dir2.id), 'Solo Dirección');

// Pedir el enlace desde la pantalla no revela quién tiene cuenta.
ok('Un correo que no existe no genera nada', accesos.solicitar('nadie@example.invalid') === null);
const pedido = accesos.solicitar(colab.email);
ok('Un correo del equipo sí genera su enlace', pedido !== null && pedido.usuario.id === colab.id);
ok('El correo no distingue mayúsculas', accesos.solicitar(colab.email.toUpperCase()) !== null);

// No se puede inundar a alguien de enlaces.
accesos.solicitar(colab.email);
ok('Más allá del tope no se generan más', accesos.solicitar(colab.email) === null);
ok('El tope es el que dice el dominio', accesos.pendientesDe(colab.id).length === 3);

// Dirección puede cortar el acceso pendiente.
const cuantos = acepta('Dirección anula los enlaces pendientes', () => accesos.anular(dir1, colab.id, 'Prueba'));
ok('Anuló los que había', cuantos === 3 && accesos.pendientesDe(colab.id).length === 0);
rechaza('Un ayudante no anula enlaces', () => accesos.anular(colab, dir2.id), 'Solo Dirección');

// El historial deja ver quién entró.
ok(
  'Cada ingreso queda en el historial',
  todos(`SELECT * FROM historial WHERE tipo = 'acceso.usado'`).length >= 2,
);

// --- 19. Renombrar, y por qué un usuario no se borra ------------------------

seccion('19. Renombrar, y por qué un usuario no se borra');

const aRenombrar = crearUsuario('renombrar@example.invalid', 'Nombre Con Error', 'Ayudante', 1);
acepta('Dirección corrige un nombre mal escrito', () =>
  usuarios.cambiarAcceso(dir1, aRenombrar.id, { nombre: 'Nombre Corregido', rol: 'Ayudante', activo: '1' }),
);
ok('Quedó el nombre nuevo', usuarios.obtener(aRenombrar.id).nombre === 'Nombre Corregido');
ok(
  'El correo no cambió: es la identidad con la que se entra',
  usuarios.obtener(aRenombrar.id).email === 'renombrar@example.invalid',
);
ok(
  'El cambio queda en el historial con el nombre anterior',
  (() => {
    const evento = todos(
      `SELECT * FROM historial WHERE entidad_id = ? AND tipo = 'usuario.acceso' ORDER BY ocurrido_en DESC`,
      aRenombrar.id,
    )[0];
    return JSON.parse(evento.datos_anteriores).nombre === 'Nombre Con Error';
  })(),
);
rechaza(
  'Un nombre vacío se rechaza',
  () => usuarios.cambiarAcceso(dir1, aRenombrar.id, { nombre: '', rol: 'Ayudante', activo: '1' }),
  'obligatorio',
);
rechaza(
  'Un ayudante no renombra a nadie',
  () => usuarios.cambiarAcceso(colab, aRenombrar.id, { nombre: 'Otro', rol: 'Ayudante', activo: '1' }),
  'Solo Dirección',
);

// Quien figura como autor de algo no se puede borrar: el historial lo necesita. Es la
// razón por la que una cuenta vieja se renombra y se desactiva en lugar de borrarse.
rechaza(
  'Un usuario con historial no se borra ni por SQL directo',
  () => ejecutar('DELETE FROM usuario WHERE id = ?', dir1.id),
  'FOREIGN KEY|constraint',
);
rechaza(
  'Y el historial tampoco se borra para dejarlo huérfano',
  () => ejecutar('DELETE FROM historial WHERE actor_id = ?', dir1.id),
  'no se borra',
);

// --- 20. Prioridad en cuatro niveles ----------------------------------------

seccion('20. Prioridad en cuatro niveles');

const clubPrio = clubes.crear(dir1, { nombre: 'Club de prueba Prioridad' });
ok('Sin indicar nada, el club queda en normal', clubes.obtener(clubPrio.id).prioridad === '3');

for (const [valor, nombre] of [['1', 'absoluta'], ['2', 'importante'], ['3', 'normal'], ['4', 'baja']]) {
  acepta(`Se puede poner prioridad ${valor} (${nombre})`, () =>
    clubes.editar(dir1, clubPrio.id, { nombre: clubPrio.nombre, prioridad: valor }),
  );
  ok(`Quedó guardada la ${valor}`, clubes.obtener(clubPrio.id).prioridad === valor);
}

rechaza(
  'Una prioridad fuera de escala se rechaza',
  () => clubes.editar(dir1, clubPrio.id, { nombre: clubPrio.nombre, prioridad: '5' }),
  'prioridad',
);
rechaza(
  'Ni por inserción directa: lo impide la base',
  () => ejecutar(`UPDATE club SET prioridad = '9' WHERE id = ?`, clubPrio.id),
  'CHECK|constraint',
);
rechaza(
  'Tampoco una prioridad vacía',
  () => ejecutar(`UPDATE club SET prioridad = '' WHERE id = ?`, clubPrio.id),
  'CHECK|constraint',
);

seccion('21. Publicar con Cloudflare Tunnel desde una máquina propia');

ok('Sin nada, escucha solo en esta máquina', tunel.interfazDe({}) === '127.0.0.1');
ok('En modo público sin más, escucha en todas (Docker)', tunel.interfazDe({ FUTSALA_PUBLICO: '1' }) === '0.0.0.0');
ok(
  'En modo público con túnel, escucha solo en esta máquina',
  tunel.interfazDe({ FUTSALA_PUBLICO: '1', FUTSALA_INTERFAZ: '127.0.0.1' }) === '127.0.0.1',
);

ok('El dominio solo se completa con https', tunel.direccionPublica('reuniones.ejemplo.com.ar') === 'https://reuniones.ejemplo.com.ar');
ok('La barra final se descarta', tunel.direccionPublica('https://reuniones.ejemplo.com.ar/') === 'https://reuniones.ejemplo.com.ar');
ok('Por http no sirve: el enlace de acceso viajaría sin cifrar', tunel.direccionPublica('http://reuniones.ejemplo.com.ar') === null);
ok('Con una ruta no sirve', tunel.direccionPublica('https://ejemplo.com.ar/reuniones') === null);
ok('localhost no es una dirección pública', tunel.direccionPublica('https://localhost') === null);
ok('Una IP suelta tampoco', tunel.direccionPublica('https://192.168.0.10') === null);
ok('Vacío tampoco', tunel.direccionPublica('') === null);

const entornoTunel = {
  FUTSALA_PUBLICO: '1',
  FUTSALA_PROXY: '1',
  FUTSALA_INTERFAZ: '127.0.0.1',
  FUTSALA_BASE_URL: 'https://reuniones.ejemplo.com.ar',
  FUTSALA_SECRETO: 'x'.repeat(64),
};
ok('La configuración completa del túnel no tiene problemas', tunel.problemasDelTunel(entornoTunel).length === 0);
for (const [quitar, tema] of [
  ['FUTSALA_PUBLICO', 'PUBLICO'],
  ['FUTSALA_PROXY', 'PROXY'],
  ['FUTSALA_SECRETO', 'SECRETO'],
  ['FUTSALA_BASE_URL', 'BASE_URL'],
]) {
  const sin = { ...entornoTunel };
  delete sin[quitar];
  const problemas = tunel.problemasDelTunel(sin);
  ok(`Sin ${quitar} no arranca, y dice qué falta`, problemas.length === 1 && problemas[0].includes(tema));
}
ok(
  'Un secreto corto no alcanza',
  tunel.problemasDelTunel({ ...entornoTunel, FUTSALA_SECRETO: 'corto' }).some((p) => p.includes('SECRETO')),
);
ok(
  'Escuchando en todas las interfaces no arranca detrás del túnel',
  tunel.problemasDelTunel({ ...entornoTunel, FUTSALA_INTERFAZ: '0.0.0.0' }).some((p) => p.includes('INTERFAZ')),
);
ok(
  'Ni sin decir dónde escuchar: en modo público eso sería todas',
  tunel.problemasDelTunel({ ...entornoTunel, FUTSALA_INTERFAZ: '' }).some((p) => p.includes('INTERFAZ')),
);

seccion('22. La pantalla de acceso dice dónde aparece el enlace');

ok('En esta máquina sola, la pantalla lo sabe', entrega.soloEnEstaMaquina({}) === true);
ok('Abierta a la red local, no', entrega.soloEnEstaMaquina({ FUTSALA_RED: '1' }) === false);
ok('Publicada en un servidor, no', entrega.soloEnEstaMaquina({ FUTSALA_PUBLICO: '1' }) === false);
ok(
  'Publicada con túnel tampoco, aunque escuche en 127.0.0.1',
  entrega.soloEnEstaMaquina({ FUTSALA_PUBLICO: '1', FUTSALA_INTERFAZ: '127.0.0.1' }) === false,
);
ok(
  'En esta máquina dice que el enlace aparece en la ventana de la aplicación',
  /ventana donde corre/.test(entrega.comoLlega({})) && entrega.comoLlega({}).includes(entrega.REGISTRO),
);
ok('En esta máquina no manda a esperar a Dirección', !/Dirección te lo pasa/.test(entrega.comoLlega({})));
ok('Publicada, Dirección sigue siendo quien lo pasa', /Dirección te lo pasa/.test(entrega.comoLlega({ FUTSALA_PUBLICO: '1' })));
ok('Publicada, no muestra dónde está el registro', !entrega.comoLlega({ FUTSALA_PUBLICO: '1' }).includes(entrega.REGISTRO));

seccion('23. La sesión dura 30 días, y lo controla el servidor');

{
  const auth = await import('../server/auth.js');
  const alguien = uno('SELECT * FROM usuario WHERE activo = 1 LIMIT 1');
  const valorDe = (cookie) => cookie.split(';')[0].split('=').slice(1).join('=');
  const conCookie = (cookie) => auth.usuarioDeSesion({ [cookie.split('=')[0]]: valorDe(cookie) });
  const firmadaHace = (dias) => {
    const real = Date.now;
    Date.now = () => real() - dias * 24 * 60 * 60 * 1000;
    try {
      return auth.cookieSesion(alguien.id, { seguro: true });
    } finally {
      Date.now = real;
    }
  };

  ok('El navegador la guarda 30 días', auth.cookieSesion(alguien.id).includes(`Max-Age=${60 * 60 * 24 * 30}`));
  ok('Recién firmada, entra', conCookie(auth.cookieSesion(alguien.id))?.id === alguien.id);
  ok('A los 29 días todavía entra', conCookie(firmadaHace(29))?.id === alguien.id);
  ok('A los 31 días no entra, aunque el navegador la siga mandando', conCookie(firmadaHace(31)) === null);
  ok('Con fecha futura no entra', conCookie(firmadaHace(-1)) === null);
  const cuerpoFalso = valorDe(auth.cookieSesion(alguien.id)).split('.');
  cuerpoFalso[1] = String(Date.now() + 1);
  ok('Cambiarle la fecha a mano rompe la firma', auth.usuarioDeSesion({ futsala_sesion: cuerpoFalso.join('.') }) === null);
}

// --- 24. Correo y contraseña, Google y solicitudes de acceso -----------------

seccion('24. Correo y contraseña, Google (Firebase) y solicitudes de acceso');
{
  const ingreso = await import('../server/dominio/ingreso.js');
  const firebase = await import('../server/lib/firebase.js');
  const { generateKeyPairSync, sign: firmarRsa } = await import('node:crypto');
  const auth = await import('../server/auth.js');
  const clave = 'Piloto123!';

  // Registro: queda pendiente y no crea usuario.
  const antes = uno('SELECT count(*) AS n FROM usuario').n;
  const s1 = ingreso.registrarse({ nombre: 'Persona Nueva', email: 'Nueva@Example.invalid', clave, repetir: clave });
  ok('Registrarse deja una solicitud pendiente', s1.estado === 'pendiente' && s1.email === 'nueva@example.invalid');
  ok('Registrarse no crea usuario ni da permisos', uno('SELECT count(*) AS n FROM usuario').n === antes);
  ok('La contraseña no se guarda en claro', s1.clave_hash.startsWith('scrypt$') && !s1.clave_hash.includes(clave));
  rechaza('Dos solicitudes pendientes con el mismo correo', () =>
    ingreso.registrarse({ nombre: 'Otra', email: 'nueva@example.invalid', clave, repetir: clave }), 'pendiente');
  rechaza('No se registra un correo que ya tiene usuario', () =>
    ingreso.registrarse({ nombre: 'Copia', email: colab.email, clave, repetir: clave }), 'ya tiene usuario');
  rechaza('Contraseña sin signo', () =>
    ingreso.registrarse({ nombre: 'Débil', email: 'debil@example.invalid', clave: 'Piloto123', repetir: 'Piloto123' }), 'signo');
  rechaza('Contraseña corta', () =>
    ingreso.registrarse({ nombre: 'Corta', email: 'corta@example.invalid', clave: 'P1!', repetir: 'P1!' }), '8');
  rechaza('Las dos contraseñas tienen que coincidir', () =>
    ingreso.registrarse({ nombre: 'Distinta', email: 'distinta@example.invalid', clave, repetir: 'Otra123!' }), 'no coinciden');

  rechaza('Pendiente: con su contraseña no entra todavía', () =>
    ingreso.ingresarConClave({ email: 'nueva@example.invalid', clave }), 'pendiente');
  rechaza('Contraseña equivocada', () =>
    ingreso.ingresarConClave({ email: 'nueva@example.invalid', clave: 'Otra123!' }), 'incorrectos');
  rechaza('Correo inexistente: mismo mensaje que contraseña equivocada', () =>
    ingreso.ingresarConClave({ email: 'nadie@example.invalid', clave }), 'incorrectos');

  // Aprobación.
  rechaza('Solo Dirección aprueba', () => ingreso.aprobar(colab, s1.id, { rol: 'Ayudante' }), 'Dirección');
  rechaza('El rol tiene que ser válido', () => ingreso.aprobar(dir1, s1.id, { rol: 'Admin' }), 'rol');
  const aprobado = ingreso.aprobar(dir1, s1.id, { rol: 'Ayudante' });
  ok('Aprobar crea el usuario activo con el rol elegido', aprobado.rol === 'Ayudante' && aprobado.activo === 1);
  ok('La solicitud queda aprobada y apunta al usuario', uno('SELECT * FROM solicitud_acceso WHERE id = ?', s1.id).usuario_id === aprobado.id);
  ok('Aprobado, entra con su correo y contraseña', ingreso.ingresarConClave({ email: 'NUEVA@example.invalid', clave }).id === aprobado.id);
  rechaza('Una solicitud resuelta no se vuelve a resolver', () => ingreso.rechazar(dir1, s1.id), 'ya se resolvió');
  ok('La aprobación queda en el historial', !!uno(`SELECT id FROM historial WHERE entidad_id = ? AND tipo = 'usuario.creado'`, aprobado.id));

  const s2 = ingreso.registrarse({ nombre: 'Rechazable', email: 'rechazo@example.invalid', clave, repetir: clave });
  ingreso.rechazar(dir1, s2.id);
  rechaza('Rechazada, no entra', () => ingreso.ingresarConClave({ email: 'rechazo@example.invalid', clave }), 'incorrectos');

  // Mi cuenta: contraseña.
  rechaza('Cambiar la contraseña exige la actual', () =>
    ingreso.cambiarClave(aprobado, { actual: 'Mala123!', clave: 'Nueva456!', repetir: 'Nueva456!' }), 'actual');
  ingreso.cambiarClave(aprobado, { actual: clave, clave: 'Nueva456!', repetir: 'Nueva456!' });
  ok('Con la actual, la cambia', ingreso.ingresarConClave({ email: aprobado.email, clave: 'Nueva456!' }).id === aprobado.id);
  ingreso.cambiarClave(colab2, { clave, repetir: clave });
  ok('Quien entró por enlace crea su primera contraseña', ingreso.ingresarConClave({ email: colab2.email, clave }).id === colab2.id);
  rechaza('Usuario inactivo no entra aunque la contraseña sea correcta', () => {
    ejecutar('UPDATE usuario SET clave_hash = ? WHERE id = ?', ingreso.hashClave(clave), inactivo.id);
    ingreso.ingresarConClave({ email: inactivo.email, clave });
  }, 'inactivo');

  // Firebase: token firmado con una clave de prueba.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  firebase.usarClavesDePrueba(new Map([['k1', publicKey]]));
  const proyecto = 'futsala-prueba';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = ({ email, sub, aud = proyecto, proveedor = 'google.com', clavePrivada = privateKey }) => {
    const s = Math.floor(Date.now() / 1000);
    const cuerpo = `${b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })}.${b64({
      iss: `https://securetoken.google.com/${aud}`, aud, sub: `uid-${sub}`, iat: s, exp: s + 3600,
      auth_time: s, email, email_verified: true, name: 'Persona Google',
      firebase: { sign_in_provider: proveedor, identities: { 'google.com': [sub], email: [email] } },
    })}`;
    return `${cuerpo}.${firmarRsa('RSA-SHA256', Buffer.from(cuerpo), clavePrivada).toString('base64url')}`;
  };
  const ident = await firebase.verificarToken(token({ email: 'g@example.invalid', sub: 'g-1' }), proyecto);
  ok('Token de Firebase válido: devuelve la identidad Google', ident?.sub === 'g-1' && ident.email === 'g@example.invalid');
  ok('Token de otro proyecto: no sirve', (await firebase.verificarToken(token({ email: 'g@example.invalid', sub: 'g-1', aud: 'otro' }), proyecto)) === null);
  const otraClave = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  ok('Token firmado con otra clave: no sirve', (await firebase.verificarToken(token({ email: 'g@example.invalid', sub: 'g-1', clavePrivada: otraClave }), proyecto)) === null);
  ok('Token de otro proveedor (no Google): no sirve', (await firebase.verificarToken(token({ email: 'g@example.invalid', sub: 'g-1', proveedor: 'password' }), proyecto)) === null);
  ok('Basura en lugar de token: no sirve', (await firebase.verificarToken('a.b.c', proyecto)) === null);

  // Desafío de un solo uso.
  const valorCookie = (c) => c.split(';')[0].slice(c.indexOf('=') + 1);
  const cookies = { futsala_google: valorCookie(firebase.cookieDesafio()) };
  ok('Ingreso posterior al desafío: vale', firebase.desafioCumplido(cookies, { ingresoEn: Date.now() }));
  ok('El mismo desafío no sirve dos veces', !firebase.desafioCumplido(cookies, { ingresoEn: Date.now() }));
  const otra = { futsala_google: valorCookie(firebase.cookieDesafio()) };
  ok('Ingreso en Google anterior al desafío (token viejo): no vale', !firebase.desafioCumplido(otra, { ingresoEn: Date.now() - 30 * 60000 }));
  const [marca, azar] = otra.futsala_google.split('.');
  ok('Desafío con firma falsa: no vale', !firebase.desafioCumplido({ futsala_google: `${marca}.${azar}.falsa` }, { ingresoEn: Date.now() }));

  // Ingreso con Google.
  const g = (email, sub) => ({ sub, email, nombre: 'Persona Google', ingresoEn: Date.now() });
  ok('Correo desconocido: queda como solicitud pendiente', ingreso.ingresarConGoogle(g('g@example.invalid', 'g-1')).pendiente === true);
  ok('Volver a intentar no duplica la solicitud', ingreso.ingresarConGoogle(g('g@example.invalid', 'g-1')).pendiente === true
    && uno(`SELECT count(*) AS n FROM solicitud_acceso WHERE email = 'g@example.invalid'`).n === 1);
  const sg = ingreso.solicitudPendiente('g@example.invalid');
  const ug = ingreso.aprobar(dir1, sg.id, { rol: 'Consulta' });
  ok('Aprobado, entra con Google', ingreso.ingresarConGoogle(g('g@example.invalid', 'g-1')).usuario?.id === ug.id);
  ok('Dado de alta por Dirección y sin contraseña: Google con su correo lo vincula',
    ingreso.ingresarConGoogle(g(consulta.email, 'c-1')).usuario?.id === consulta.id
      && uno('SELECT google_sub FROM usuario WHERE id = ?', consulta.id).google_sub === 'c-1');
  rechaza('Con contraseña creada, coincidir el correo no alcanza', () => ingreso.ingresarConGoogle(g(colab2.email, 'x-1')), 'contraseña');
  rechaza('Otra cuenta Google con un correo ya vinculado', () => ingreso.ingresarConGoogle(g(consulta.email, 'otra-cuenta')), 'otra cuenta');
  ejecutar('UPDATE usuario SET activo = 0 WHERE id = ?', ug.id);
  rechaza('Inactivo no entra con Google', () => ingreso.ingresarConGoogle(g('g@example.invalid', 'g-1')), 'inactivo');

  // Vincular desde Mi cuenta.
  rechaza('Vincular exige la contraseña actual', () => ingreso.vincularGoogle(colab2, g(colab2.email, 'x-1'), 'Mala123!'), 'contraseña');
  rechaza('Vincular exige el mismo correo', () => ingreso.vincularGoogle(colab2, g('otro@example.invalid', 'x-1'), clave), 'mismo correo');
  rechaza('Una cuenta Google ya usada no se vincula a otro', () => ingreso.vincularGoogle(colab2, g(colab2.email, 'c-1'), clave), 'otro usuario');
  ingreso.vincularGoogle(colab2, g(colab2.email, 'x-1'), clave);
  ok('Vinculado, entra con Google y conserva su contraseña',
    ingreso.ingresarConGoogle(g(colab2.email, 'x-1')).usuario?.id === colab2.id
      && ingreso.ingresarConClave({ email: colab2.email, clave }).id === colab2.id);

  ok('Sin variables FUTSALA_FIREBASE_*, Google queda apagado', firebase.configuracion({}) === null);
  ok('La sesión sigue siendo la misma cookie firmada',
    auth.usuarioDeSesion({ futsala_sesion: valorCookie(auth.cookieSesion(colab2.id)) })?.id === colab2.id);
}

// --- Cierre -----------------------------------------------------------------

cerrarBase();
rmSync(carpeta, { recursive: true, force: true });

console.log('');
console.log(`Resultado: ${correctas} correctas, ${fallidas} fallidas.`);
console.log('Base de prueba eliminada. No se enviaron mensajes ni se usaron servicios externos.');
process.exit(fallidas > 0 ? 1 : 0);
