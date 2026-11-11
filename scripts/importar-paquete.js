// Importa datos a la aplicación desde:
//   a) el paquete de AppSheet  (03_Base_actual.json, o la carpeta CSV/ del paquete)
//   b) un respaldo propio      (lo que descarga /exportar/json)
//
// Uso:
//   node scripts/importar-paquete.js --json ruta/03_Base_actual.json
//   node scripts/importar-paquete.js --csv  ruta/CSV
//   node scripts/importar-paquete.js --json archivo.json --simular   (no escribe nada)
//
// Lo que no se puede cargar sin romper una regla queda registrado como conflicto
// visible en la aplicación, en lugar de entrar silenciosamente.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { abrirBase, uno, todos, ejecutar, enTransaccion } from '../server/db.js';
import { nuevoId } from '../server/auth.js';
import { ahora } from '../server/lib/fechas.js';
import { normalizar } from '../server/lib/validar.js';
import { registrarConflicto } from '../server/dominio/conflictos.js';
import { registrar } from '../server/dominio/registro.js';

const argumentos = process.argv.slice(2);
const simular = argumentos.includes('--simular');
const rutaJson = valorDe('--json');
const rutaCsv = valorDe('--csv');

function valorDe(bandera) {
  const i = argumentos.indexOf(bandera);
  return i === -1 ? null : argumentos[i + 1];
}

if (!rutaJson && !rutaCsv) {
  console.error('Indicá --json <archivo> o --csv <carpeta>. Agregá --simular para no escribir.');
  process.exit(1);
}

abrirBase();

const informe = { creados: {}, conflictos: [], rechazadas: [], avisos: [] };
const origen = basename(rutaJson || rutaCsv);
const porEmail = new Map();

const fuente = rutaJson ? leerJson(rutaJson) : leerCsv(rutaCsv);

try {
  enTransaccion(() => {
    const actor = actorDeImportacion();
    importarUsuarios(fuente.Usuarios);
    importarParametros(fuente.Parametros);
    importarClubes(fuente.Clubes);
    importarPlanes(fuente.Proyecciones);
    importarReuniones(fuente.Reuniones);
    importarDetalles(fuente.DetalleProyeccion);
    importarCompromisos(fuente.Compromisos);
    importarReconfirmaciones(fuente.Reconfirmaciones);

    registrar({
      actor,
      tipo: 'importacion.realizada',
      entidad: 'importacion',
      entidadId: origen,
      motivo: `Importación desde ${origen}`,
      datosPosteriores: { creados: informe.creados, conflictos: informe.conflictos.length, rechazadas: informe.rechazadas.length },
    });

    if (simular) throw new Error('__SIMULACION__');
  });
} catch (error) {
  if (error.message !== '__SIMULACION__') throw error;
}

imprimirInforme();

// --- Lectura de la fuente ----------------------------------------------------

function leerJson(ruta) {
  const contenido = JSON.parse(readFileSync(ruta, 'utf8'));

  // Respaldo propio: tablas en minúscula con filas como objetos.
  if (contenido.tablas && contenido.tablas.club) {
    informe.avisos.push('Detectado un respaldo propio de la aplicación: se restauran las tablas tal cual.');
    restaurarRespaldoPropio(contenido.tablas);
    process.exit(0);
  }

  const tablas = contenido.tablas || contenido;
  const salida = {};
  for (const [nombre, tabla] of Object.entries(tablas)) {
    if (Array.isArray(tabla)) {
      salida[nombre] = tabla;
    } else if (tabla && Array.isArray(tabla.columnas)) {
      salida[nombre] = (tabla.filas || []).map((fila) =>
        Object.fromEntries(tabla.columnas.map((columna, i) => [columna, fila[i]])),
      );
    }
  }
  return salida;
}

function leerCsv(carpeta) {
  if (!existsSync(carpeta)) {
    console.error(`No existe la carpeta ${carpeta}`);
    process.exit(1);
  }
  const salida = {};
  for (const archivo of readdirSync(carpeta).filter((n) => n.toLowerCase().endsWith('.csv'))) {
    const nombre = archivo.replace(/\.csv$/i, '');
    salida[nombre] = filasDeCsv(readFileSync(join(carpeta, archivo), 'utf8'));
  }
  return salida;
}

function filasDeCsv(texto) {
  const lineas = partirCsv(texto);
  if (lineas.length === 0) return [];
  const columnas = lineas[0];
  return lineas.slice(1).map((valores) =>
    Object.fromEntries(columnas.map((columna, i) => [columna, valores[i] === '' ? null : valores[i]])),
  );
}

function partirCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (entreComillas) {
      if (caracter === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          entreComillas = false;
        }
      } else {
        campo += caracter;
      }
    } else if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === ',') {
      fila.push(campo);
      campo = '';
    } else if (caracter === '\n') {
      fila.push(campo.replace(/\r$/, ''));
      if (fila.some((valor) => valor !== '')) filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += caracter;
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo.replace(/\r$/, ''));
    if (fila.some((valor) => valor !== '')) filas.push(fila);
  }
  return filas;
}

// --- Importadores ------------------------------------------------------------

function actorDeImportacion() {
  const existente = uno(`SELECT * FROM usuario WHERE rol = 'Direccion' AND activo = 1 ORDER BY creado_en LIMIT 1`);
  if (existente) return existente;
  // Sin Dirección activa se crea una identidad de servicio para poder auditar la importación.
  const id = nuevoId();
  ejecutar(
    `INSERT INTO usuario (id, email, nombre, rol, activo, creado_en)
     VALUES (?, 'importacion@example.invalid', 'Importación de datos', 'Direccion', 0, ?)`,
    id,
    ahora(),
  );
  informe.avisos.push(
    'No había Dirección activa: se creó el usuario inactivo "Importación de datos" solo para firmar la auditoría.',
  );
  contar('usuario');
  return uno('SELECT * FROM usuario WHERE id = ?', id);
}

function importarUsuarios(filas = []) {
  for (const fila of filas) {
    const email = texto(fila.Email)?.toLowerCase();
    if (!email) continue;
    const existente = uno('SELECT * FROM usuario WHERE email = ?', email);
    if (existente) {
      porEmail.set(email, existente.id);
      continue;
    }
    const id = nuevoId();
    intentar('usuario', fila, () => {
      ejecutar(
        'INSERT INTO usuario (id, email, nombre, rol, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
        id,
        email,
        texto(fila.Nombre) || email,
        ['Direccion', 'Ayudante', 'Consulta'].includes(texto(fila.Rol)) ? texto(fila.Rol) : 'Consulta',
        booleano(fila.Activo),
        ahora(),
      );
      porEmail.set(email, id);
      contar('usuario');
    });
  }
}

/** Resuelve un correo del origen a un id de usuario de la aplicación nueva. */
function usuarioDe(valorEmail) {
  const email = texto(valorEmail)?.toLowerCase();
  if (!email) return null;
  if (porEmail.has(email)) return porEmail.get(email);
  const existente = uno('SELECT id FROM usuario WHERE email = ?', email);
  if (existente) {
    porEmail.set(email, existente.id);
    return existente.id;
  }
  const id = nuevoId();
  ejecutar(
    'INSERT INTO usuario (id, email, nombre, rol, activo, creado_en) VALUES (?, ?, ?, ?, 0, ?)',
    id,
    email,
    email,
    'Consulta',
    ahora(),
  );
  porEmail.set(email, id);
  contar('usuario');
  informe.avisos.push(`El correo ${email} aparecía en los datos pero no en Usuarios: se creó inactivo y sin permisos.`);
  return id;
}

function importarParametros(filas = []) {
  const fila = filas[0];
  if (!fila) return;
  if (uno(`SELECT id FROM parametros WHERE id = 'CICLO-2027'`)) return;
  intentar('parametros', fila, () => {
    ejecutar(
      `INSERT INTO parametros (id, anio_cierre, anio_objetivo, inicio_reconfirmacion, fin_reconfirmacion,
                               zona_horaria, avisos_internos, avisos_externos)
       VALUES ('CICLO-2027', ?, ?, ?, ?, ?, 0, 0)`,
      numero(fila.AnioCierre) ?? 2026,
      numero(fila.AnioObjetivo) ?? 2027,
      texto(fila.InicioReconfirmacion) || '2027-01-01',
      texto(fila.FinReconfirmacion) || '2027-02-28',
      texto(fila.ZonaHoraria) || 'America/Argentina/Buenos_Aires',
    );
    contar('parametros');
    if (booleano(fila.AvisosInternos) || booleano(fila.AvisosExternos)) {
      informe.avisos.push('El origen traía avisos encendidos: se importaron apagados, como pide esta entrega.');
    }
  });
}

function importarClubes(filas = []) {
  for (const fila of filas) {
    const id = texto(fila.ClubID) || nuevoId();
    if (uno('SELECT id FROM club WHERE id = ?', id)) continue;
    const nombre = texto(fila.Nombre);
    if (!nombre) {
      rechazar('club', 'Club sin nombre', fila);
      continue;
    }
    intentar('club', fila, () => {
      ejecutar(
        `INSERT INTO club (id, nombre, nombre_norm, localidad, contacto_nombre, contacto_email, contacto_telefono,
                           responsable_id, analisis_url, activo, creado_en, creado_por_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        nombre,
        normalizar(nombre),
        texto(fila.Localidad),
        texto(fila.ContactoNombre),
        texto(fila.ContactoEmail)?.toLowerCase() || null,
        texto(fila.ContactoTelefono),
        usuarioDe(fila.ResponsableEmail),
        texto(fila.Analisis2026URL),
        booleano(fila.Activo, 1),
        texto(fila.CreadoEn) || ahora(),
        usuarioDe(fila.CreadoPor),
      );
      contar('club');
    });
  }
}

function importarPlanes(filas = []) {
  for (const fila of filas) {
    const id = texto(fila.ProyeccionID) || nuevoId();
    if (uno('SELECT id FROM plan WHERE id = ?', id)) continue;
    const clubId = texto(fila.ClubID);
    if (!clubId || !uno('SELECT id FROM club WHERE id = ?', clubId)) {
      rechazar('plan', `Plan ${id} sin club conocido`, fila);
      continue;
    }
    const anioObjetivo = numero(fila.AnioObjetivo) ?? 2027;

    // Un plan por club y ciclo: el duplicado no entra y queda visible como conflicto.
    const existente = uno('SELECT id FROM plan WHERE club_id = ? AND anio_objetivo = ?', clubId, anioObjetivo);
    if (existente) {
      conflicto({
        entidad: 'plan',
        clave: `club ${clubId} / ciclo ${anioObjetivo}`,
        detalle: `El origen traía más de un plan para el mismo club y ciclo. Se conservó ${existente.id} y se rechazó ${id}.`,
        clubId,
        planId: existente.id,
        datos: fila,
      });
      continue;
    }

    intentar('plan', fila, () => {
      ejecutar(
        `INSERT INTO plan (id, club_id, anio_cierre, anio_objetivo, estado, creado_en, creado_por_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        clubId,
        numero(fila.AnioCierre) ?? anioObjetivo - 1,
        anioObjetivo,
        opcion(fila.Estado, ['Abierta', 'Cerrada', 'Archivada'], 'Abierta'),
        texto(fila.CreadoEn) || ahora(),
        usuarioDe(fila.CreadoPor),
      );
      contar('plan');

      // El origen traía estos datos colgando del ciclo. Ahora son del club: la prioridad
      // y quién lo atiende no cambian porque empiece un año nuevo. Las notas de
      // preparación no tienen lugar propio y se guardan como notas internas del club,
      // que es donde alguien las va a volver a leer.
      const preparacion = [
        ['Balance 2026', texto(fila.Balance2026)],
        ['Objetivo 2027', texto(fila.Objetivo2027)],
        ['Riesgos', texto(fila.Riesgos)],
      ].filter(([, valor]) => valor);
      mudarAlClub(clubId, {
        prioridad: opcion(fila.Prioridad, ['1', '2', '3'], null),
        responsable_id: usuarioDe(fila.ResponsableEmail),
        notas: preparacion.map(([etiqueta, valor]) => `${etiqueta}: ${valor}`).join('\n') || null,
      });
    });
  }
}

function importarReuniones(filas = []) {
  for (const fila of filas) {
    const id = texto(fila.ReunionID) || nuevoId();
    if (uno('SELECT id FROM reunion WHERE id = ?', id)) continue;
    const planId = texto(fila.ProyeccionID);
    if (!planId || !uno('SELECT id FROM plan WHERE id = ?', planId)) {
      rechazar('reunion', `Reunión ${id} sin plan conocido`, fila);
      continue;
    }
    intentar('reunion', fila, () => {
      const validadaEn = texto(fila.ValidadaEn);
      ejecutar(
        `INSERT INTO reunion (id, plan_id, inicio, fin, lugar, modalidad, estado, director1_id, director2_id,
                              acta_responsable_id, delegados_presentes, agenda, acta, devolucion_club, proximo_paso,
                              revista_entregada, regalo_entregado, acta_estado, acta_validada_por_id, acta_validada_en,
                              motivo_cancelacion, motivo_devolucion, creado_en, creado_por_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        planId,
        fechaHora(fila.Inicio),
        fechaHora(fila.Fin),
        texto(fila.Lugar),
        opcion(fila.Modalidad, ['En la liga', 'En el club', 'Llamada'], 'En la liga'),
        opcion(fila.Estado, ['Borrador', 'Programada', 'Realizada', 'Cancelada'], 'Borrador'),
        usuarioDe(fila.Director1Email),
        usuarioDe(fila.Director2Email),
        usuarioDe(fila.ActaEmail),
        texto(fila.DelegadosPresentes),
        texto(fila.Agenda),
        texto(fila.Acta),
        texto(fila.DevolucionClub),
        texto(fila.ProximoPaso),
        booleano(fila.RevistaEntregada),
        booleano(fila.RegaloEntregado),
        opcion(fila.EstadoActa, ['Borrador', 'Para revisar', 'Validada'], 'Borrador'),
        validadaEn ? usuarioDe(fila.ValidadaPor) : null,
        validadaEn,
        texto(fila.MotivoCancelacion),
        texto(fila.MotivoDevolucion),
        texto(fila.CreadoEn) || ahora(),
        usuarioDe(fila.CreadoPor),
      );
      contar('reunion');
    });
  }
}

function importarDetalles(filas = []) {
  for (const fila of filas) {
    const id = texto(fila.DetalleID) || nuevoId();
    if (uno('SELECT id FROM plan_detalle WHERE id = ?', id)) continue;
    const planId = texto(fila.ProyeccionID);
    const disciplina = texto(fila.Disciplina);
    if (!planId || !uno('SELECT id FROM plan WHERE id = ?', planId) || !disciplina) {
      rechazar('plan_detalle', `Disciplina ${id} sin plan conocido o sin nombre`, fila);
      continue;
    }
    const norma = normalizar(disciplina);
    const existente = uno('SELECT id FROM plan_detalle WHERE plan_id = ? AND disciplina_norm = ?', planId, norma);
    if (existente) {
      conflicto({
        entidad: 'plan_detalle',
        clave: `plan ${planId} / disciplina ${disciplina}`,
        detalle: `El origen traía la disciplina "${disciplina}" repetida en el mismo plan. Se rechazó la segunda fila.`,
        planId,
        clubId: uno('SELECT club_id FROM plan WHERE id = ?', planId)?.club_id,
        datos: fila,
      });
      continue;
    }
    intentar('plan_detalle', fila, () => {
      const reunionAcuerdo = texto(fila.ReunionAcuerdoID);
      const acuerdoValido = reunionAcuerdo && uno('SELECT id FROM reunion WHERE id = ? AND plan_id = ?', reunionAcuerdo, planId);
      const acordadas = numero(fila.TirasAcordadas2027);
      if (acordadas !== null && !acuerdoValido) {
        conflicto({
          entidad: 'plan_detalle',
          clave: `plan ${planId} / disciplina ${disciplina}`,
          detalle:
            `La disciplina "${disciplina}" traía una cantidad acordada sin un acta de este plan que la respalde. ` +
            'Se importó sin la cantidad acordada.',
          planId,
          clubId: uno('SELECT club_id FROM plan WHERE id = ?', planId)?.club_id,
          datos: fila,
        });
      }
      ejecutar(
        `INSERT INTO plan_detalle (id, plan_id, disciplina, disciplina_norm, tiras_base, tiras_propuestas,
                                   tiras_acordadas, tiras_reconfirmadas, observaciones, reunion_acuerdo_id, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        planId,
        disciplina,
        norma,
        cantidad(fila.Tiras2026),
        cantidad(fila.TirasPropuestas2027),
        acuerdoValido ? cantidad(fila.TirasAcordadas2027) : null,
        cantidad(fila.TirasReconfirmadas2027),
        texto(fila.Observaciones),
        acuerdoValido ? reunionAcuerdo : null,
        ahora(),
      );
      contar('plan_detalle');
    });
  }
}

function importarCompromisos(filas = []) {
  for (const fila of filas) {
    const id = texto(fila.CompromisoID) || nuevoId();
    if (uno('SELECT id FROM compromiso WHERE id = ?', id)) continue;
    const reunionId = texto(fila.ReunionID);
    if (!reunionId || !uno('SELECT id FROM reunion WHERE id = ?', reunionId)) {
      rechazar('compromiso', `Compromiso ${id} sin reunión conocida`, fila);
      continue;
    }
    const responsable = usuarioDe(fila.ResponsableEmail);
    if (!responsable) {
      rechazar('compromiso', `Compromiso ${id} sin responsable interno`, fila);
      continue;
    }
    intentar('compromiso', fila, () => {
      ejecutar(
        `INSERT INTO compromiso (id, reunion_id, descripcion, parte_responsable, responsable_id, contacto_club,
                                 fecha_limite, estado, evidencia_url, resolucion, fecha_resolucion, creado_en, creado_por_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        reunionId,
        texto(fila.Descripcion) || 'Compromiso importado sin descripción',
        opcion(fila.ParteResponsable, ['FUTSALA', 'Club'], 'FUTSALA'),
        responsable,
        texto(fila.ContactoClub),
        texto(fila.FechaLimite) || ahora().slice(0, 10),
        opcion(fila.Estado, ['Pendiente', 'En curso', 'Cumplido', 'Cancelado'], 'Pendiente'),
        texto(fila.EvidenciaURL),
        texto(fila.Resolucion),
        texto(fila.FechaResolucion),
        texto(fila.CreadoEn) || ahora(),
        usuarioDe(fila.CreadoPor),
      );
      contar('compromiso');
    });
  }
}

function importarReconfirmaciones(filas = []) {
  for (const fila of filas) {
    const id = texto(fila.ReconfirmacionID) || nuevoId();
    if (uno('SELECT id FROM reconfirmacion WHERE id = ?', id)) continue;
    const planId = texto(fila.ProyeccionID);
    if (!planId || !uno('SELECT id FROM plan WHERE id = ?', planId)) {
      rechazar('reconfirmacion', `Ficha ${id} sin plan conocido`, fila);
      continue;
    }
    const existente = uno('SELECT id, estado FROM reconfirmacion WHERE plan_id = ?', planId);
    if (existente) {
      conflicto({
        entidad: 'reconfirmacion',
        clave: `plan ${planId}`,
        detalle:
          `El origen traía más de una ficha de reconfirmación para el mismo plan. Se conservó ${existente.id} ` +
          `y se rechazó ${id}. No se eligió un resultado final de forma arbitraria.`,
        planId,
        clubId: uno('SELECT club_id FROM plan WHERE id = ?', planId)?.club_id,
        datos: fila,
      });
      continue;
    }
    intentar('reconfirmacion', fila, () => {
      const validadaEn = texto(fila.ValidadaEn);
      ejecutar(
        `INSERT INTO reconfirmacion (id, plan_id, fecha_prevista, responsable_id, estado, fecha_contacto, canal,
                                     interlocutor, respuesta_club, condiciones, evidencia_url, proximo_contacto,
                                     validada_por_id, validada_en, motivo_excepcion, creado_en, creado_por_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        planId,
        texto(fila.FechaPrevista) || '2027-01-01',
        usuarioDe(fila.ResponsableEmail),
        opcion(
          fila.Estado,
          ['Pendiente', 'Contactado', 'Condicional', 'Confirmado', 'No continua', 'Sin respuesta'],
          'Pendiente',
        ),
        texto(fila.FechaContacto),
        opcion(fila.Canal, ['Telefono', 'WhatsApp', 'Email', 'Presencial'], null),
        texto(fila.Interlocutor),
        texto(fila.RespuestaClub),
        texto(fila.Condiciones),
        texto(fila.EvidenciaURL),
        texto(fila.ProximoContacto),
        validadaEn ? usuarioDe(fila.ValidadaPor) : null,
        validadaEn,
        texto(fila.MotivoExcepcion),
        texto(fila.CreadoEn) || ahora(),
        usuarioDe(fila.CreadoPor),
      );
      contar('reconfirmacion');
    });
  }
}

/**
 * Restaura un respaldo propio.
 *
 * Los planes entran primero en borrador y recién al final se les devuelve su estado real.
 * Si entraran ya cerrados, los bloqueos de la base rechazarían sus propias disciplinas:
 * esas reglas protegen la operación diaria, no la carga inicial. Como efecto secundario,
 * la restauración vuelve a comprobar que los datos cumplen las condiciones de cada estado.
 */
function restaurarRespaldoPropio(tablas) {
  const planes = tablas.plan || [];
  const estadosFinales = planes.map((fila) => ({
    id: fila.id,
    estado: fila.estado,
    version: fila.version,
  }));

  enTransaccion(() => {
    insertarFilas('usuario', tablas.usuario);
    insertarFilas('parametros', tablas.parametros);
    insertarFilas('club', tablas.club);
    insertarFilas(
      'plan',
      planes.map((fila) => ({
        ...fila,
        estado: 'Abierta',
      })),
    );
    // Un respaldo anterior al cambio guardaba la prioridad y el responsable en el plan.
    // Se mudan al club, que es donde viven ahora.
    for (const fila of planes) {
      if (fila.prioridad || fila.responsable_id) {
        mudarAlClub(fila.club_id, { prioridad: fila.prioridad, responsable_id: fila.responsable_id });
      }
    }
    insertarFilas('reunion', tablas.reunion);
    insertarFilas('plan_detalle', tablas.plan_detalle);
    insertarFilas('compromiso', tablas.compromiso);
    insertarFilas('reconfirmacion', tablas.reconfirmacion);

    for (const plan of estadosFinales) {
      try {
        ejecutar(
          `UPDATE plan SET estado = ?, version = ? WHERE id = ?`,
          plan.estado,
          plan.version,
          plan.id,
        );
      } catch (error) {
        rechazar('plan', `No se pudo devolver el plan ${plan.id} al estado "${plan.estado}": ${error.message}`, plan);
      }
    }

    insertarFilas('historial', tablas.historial);
    insertarFilas('conflicto', tablas.conflicto);
  });
  imprimirInforme();
}

/**
 * Completa en el club lo que el origen traía colgando del plan, sin pisar lo que el club
 * ya tenga cargado: el dato del club manda sobre el que venía del ciclo.
 */
function mudarAlClub(clubId, valores) {
  const club = uno('SELECT * FROM club WHERE id = ?', clubId);
  if (!club) return;
  const campos = {};
  if (valores.prioridad && club.prioridad === '2') campos.prioridad = valores.prioridad;
  if (valores.responsable_id && !club.responsable_id) campos.responsable_id = valores.responsable_id;
  if (valores.notas && !club.notas) campos.notas = valores.notas;
  const columnas = Object.keys(campos);
  if (columnas.length === 0) return;
  ejecutar(
    `UPDATE club SET ${columnas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...columnas.map((c) => campos[c]),
    clubId,
  );
}

/** Columnas que esa tabla tiene hoy. Un respaldo viejo puede traer otras. */
function columnasDe(tabla) {
  return new Set(todos(`SELECT name FROM pragma_table_info(?)`, tabla).map((c) => c.name));
}

function insertarFilas(tabla, filas = []) {
  if (filas.length === 0) return;
  // Un respaldo anterior a un cambio de esquema trae columnas que ya no existen. Se
  // dejan de lado con un aviso, en lugar de hacer fallar la restauración entera.
  const existentes = columnasDe(tabla);
  const sobrantes = [...new Set(filas.flatMap((f) => Object.keys(f)))].filter((c) => !existentes.has(c));
  if (sobrantes.length > 0) {
    informe.avisos.push(
      `La tabla ${tabla} del respaldo trae columnas que ya no existen y se omiten: ${sobrantes.join(', ')}.`,
    );
  }

  for (const fila of filas) {
    const columnas = Object.keys(fila).filter((c) => existentes.has(c));
    try {
      ejecutar(
        `INSERT OR IGNORE INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
        ...columnas.map((c) => fila[c]),
      );
      contar(tabla);
    } catch (error) {
      rechazar(tabla, error.message, fila);
    }
  }
}

// --- Utilidades --------------------------------------------------------------

function intentar(tabla, fila, fn) {
  try {
    fn();
  } catch (error) {
    rechazar(tabla, error.message, fila);
  }
}

function rechazar(tabla, motivo, fila) {
  informe.rechazadas.push({ tabla, motivo });
  try {
    registrarConflicto({
      origen,
      entidad: tabla,
      clave: 'fila rechazada',
      detalle: `No se pudo importar una fila de ${tabla}: ${motivo}`,
      datos: fila,
    });
  } catch {
    // si tampoco se puede registrar el conflicto, queda en el informe de consola
  }
}

function conflicto(datos) {
  informe.conflictos.push(datos.detalle);
  registrarConflicto({ origen, ...datos });
}

function contar(tabla) {
  informe.creados[tabla] = (informe.creados[tabla] || 0) + 1;
}

function texto(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).trim();
  return limpio === '' ? null : limpio;
}

function numero(valor) {
  const limpio = texto(valor);
  if (limpio === null) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

function cantidad(valor) {
  const n = numero(valor);
  if (n === null) return null;
  // Vacío sigue siendo desconocido; un valor inválido no se convierte en cero.
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function booleano(valor, porOmision = 0) {
  const limpio = texto(valor);
  if (limpio === null) return porOmision;
  return /^(1|true|si|sí|yes|y)$/i.test(limpio) ? 1 : 0;
}

function opcion(valor, permitidas, porOmision) {
  const limpio = texto(valor);
  return permitidas.includes(limpio) ? limpio : porOmision;
}

function fechaHora(valor) {
  const limpio = texto(valor);
  if (!limpio) return null;
  // Se conserva tal cual: las fechas sin zona no se reinterpretan como UTC.
  return limpio.replace(' ', 'T').slice(0, 19);
}

function imprimirInforme() {
  console.log('');
  console.log(`Importación desde ${origen}${simular ? ' (simulación: no se escribió nada)' : ''}`);
  const creados = Object.entries(informe.creados);
  if (creados.length === 0) {
    console.log('  No se creó ningún registro nuevo.');
  } else {
    for (const [tabla, cantidadFilas] of creados) console.log(`  ${tabla}: ${cantidadFilas}`);
  }
  if (informe.conflictos.length > 0) {
    console.log('');
    console.log(`  Conflictos registrados (${informe.conflictos.length}) — quedan visibles en Administración:`);
    for (const detalle of informe.conflictos) console.log(`    · ${detalle}`);
  }
  if (informe.rechazadas.length > 0) {
    console.log('');
    console.log(`  Filas rechazadas (${informe.rechazadas.length}):`);
    for (const fila of informe.rechazadas) console.log(`    · ${fila.tabla}: ${fila.motivo}`);
  }
  if (informe.avisos.length > 0) {
    console.log('');
    for (const aviso of informe.avisos) console.log(`  Aviso: ${aviso}`);
  }
  console.log('');
}
