import { uno, todos } from '../db.js';
import { hoy, sumarDias, fechaCorta } from '../lib/fechas.js';
import * as planes from './planes.js';
import * as reuniones from './reuniones.js';
import * as compromisos from './compromisos.js';
import * as reconfirmaciones from './reconfirmaciones.js';

export const CICLO = 2027;

/**
 * Indicadores del ciclo. Se cuentan clubes únicos, nunca reuniones ni intentos.
 * Los conflictos de duplicados quedan visibles y fuera del total de confirmados.
 * La retención queda vacía si no hay clubes en el ciclo.
 */
export function indicadores(anioObjetivo = CICLO) {
  const clubesDelCiclo = uno(
    `SELECT count(DISTINCT p.club_id) AS n FROM plan p
     WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'`,
    anioObjetivo,
  ).n;

  const confirmados = uno(
    `SELECT count(DISTINCT p.club_id) AS n
     FROM plan p
     JOIN reconfirmacion r ON r.plan_id = p.id
     WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'
       AND r.estado = 'Confirmado' AND r.validada_en IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM conflicto k WHERE k.plan_id = p.id AND k.estado = 'Abierto')`,
    anioObjetivo,
  ).n;

  const noContinuan = uno(
    `SELECT count(DISTINCT p.club_id) AS n
     FROM plan p JOIN reconfirmacion r ON r.plan_id = p.id
     WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'
       AND r.estado = 'No continua' AND r.validada_en IS NOT NULL`,
    anioObjetivo,
  ).n;

  const actasPorRevisar = uno(
    `SELECT count(*) AS n FROM reunion WHERE acta_estado = 'Para revisar'`,
  ).n;

  const tareasVencidas = uno(
    `SELECT count(*) AS n FROM compromiso
     WHERE estado IN ('Pendiente','En curso') AND fecha_limite < ?`,
    hoy(),
  ).n;

  const reconfirmacionesAbiertas = uno(
    `SELECT count(*) AS n FROM reconfirmacion r JOIN plan p ON p.id = r.plan_id
     WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'
       AND r.estado IN ('Pendiente','Contactado','Condicional','Sin respuesta')`,
    anioObjetivo,
  ).n;

  const condicionales = uno(
    `SELECT count(*) AS n FROM reconfirmacion r JOIN plan p ON p.id = r.plan_id
     WHERE p.anio_objetivo = ? AND r.estado = 'Condicional'`,
    anioObjetivo,
  ).n;

  const sinRespuesta = uno(
    `SELECT count(*) AS n FROM reconfirmacion r JOIN plan p ON p.id = r.plan_id
     WHERE p.anio_objetivo = ? AND r.estado = 'Sin respuesta'`,
    anioObjetivo,
  ).n;

  const conflictos = uno(`SELECT count(*) AS n FROM conflicto WHERE estado = 'Abierto'`).n;

  const planesCerrados = uno(
    `SELECT count(*) AS n FROM plan WHERE anio_objetivo = ? AND estado = 'Cerrada'`,
    anioObjetivo,
  ).n;

  return {
    anioObjetivo,
    clubesDelCiclo,
    confirmados,
    noContinuan,
    condicionales,
    sinRespuesta,
    actasPorRevisar,
    tareasVencidas,
    reconfirmacionesAbiertas,
    conflictos,
    planesCerrados,
    // Sin clubes en el ciclo no hay retención que informar: queda vacía, no 0 %.
    retencion: clubesDelCiclo === 0 ? null : confirmados / clubesDelCiclo,
    tiras: tiras(anioObjetivo),
  };
}

/**
 * Métricas de tiras con cobertura explícita: la falta de una cantidad final no es un cero.
 * Propuesto, acordado y final nunca se suman entre sí.
 */
export function tiras(anioObjetivo = CICLO) {
  const fila = uno(
    `SELECT
       count(*) AS disciplinas,
       sum(CASE WHEN d.tiras_base IS NOT NULL THEN d.tiras_base ELSE 0 END) AS base,
       sum(CASE WHEN d.tiras_base IS NULL THEN 1 ELSE 0 END) AS base_faltan,
       sum(CASE WHEN d.tiras_propuestas IS NOT NULL THEN d.tiras_propuestas ELSE 0 END) AS propuestas,
       sum(CASE WHEN d.tiras_propuestas IS NULL THEN 1 ELSE 0 END) AS propuestas_faltan,
       sum(CASE WHEN d.tiras_acordadas IS NOT NULL THEN d.tiras_acordadas ELSE 0 END) AS acordadas,
       sum(CASE WHEN d.tiras_acordadas IS NULL THEN 1 ELSE 0 END) AS acordadas_faltan,
       sum(CASE WHEN d.divisiones_2026 IS NOT NULL THEN 1 ELSE 0 END) AS con_divisiones,
       sum(CASE WHEN d.intencion_2027 IS NOT NULL THEN 1 ELSE 0 END) AS con_intencion
     FROM plan_detalle d
     JOIN plan p ON p.id = d.plan_id
     WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'`,
    anioObjetivo,
  );

  // Las finales se suman solo sobre planes con resultado Confirmado y validado.
  const finales = uno(
    `SELECT
       count(*) AS disciplinas,
       sum(CASE WHEN d.tiras_reconfirmadas IS NOT NULL THEN d.tiras_reconfirmadas ELSE 0 END) AS total,
       sum(CASE WHEN d.tiras_reconfirmadas IS NULL THEN 1 ELSE 0 END) AS faltan
     FROM plan_detalle d
     JOIN plan p ON p.id = d.plan_id
     JOIN reconfirmacion r ON r.plan_id = p.id
     WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'
       AND r.estado = 'Confirmado' AND r.validada_en IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM conflicto k WHERE k.plan_id = p.id AND k.estado = 'Abierto')`,
    anioObjetivo,
  );

  return {
    disciplinas: fila.disciplinas || 0,
    base: fila.base || 0,
    baseFaltan: fila.base_faltan || 0,
    propuestas: fila.propuestas || 0,
    propuestasFaltan: fila.propuestas_faltan || 0,
    acordadas: fila.acordadas || 0,
    acordadasFaltan: fila.acordadas_faltan || 0,
    conDivisiones: fila.con_divisiones || 0,
    conIntencion: fila.con_intencion || 0,
    finales: finales.total || 0,
    finalesDisciplinas: finales.disciplinas || 0,
    finalesFaltan: finales.faltan || 0,
  };
}

/** Registros que explican cada indicador. */
export function registrosDeIndicador(clave, anioObjetivo = CICLO) {
  switch (clave) {
    case 'clubes':
      return {
        titulo: 'Clubes del ciclo',
        descripcion: 'Clubes únicos con plan del ciclo que no está archivado.',
        filas: todos(
          `SELECT c.id AS club_id, c.nombre AS club, p.estado AS plan_estado, c.prioridad,
                  r.estado AS resultado
           FROM plan p JOIN club c ON c.id = p.club_id
           LEFT JOIN reconfirmacion r ON r.plan_id = p.id
           WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada' ORDER BY c.nombre`,
          anioObjetivo,
        ),
      };
    case 'confirmados':
      return {
        titulo: 'Clubes confirmados',
        descripcion:
          'Clubes únicos con resultado final Confirmado y validado, sin conflictos de duplicados y con plan no archivado.',
        filas: todos(
          `SELECT c.id AS club_id, c.nombre AS club, r.estado AS resultado, r.validada_en AS sello,
                  u.nombre AS validado_por
           FROM plan p JOIN club c ON c.id = p.club_id
           JOIN reconfirmacion r ON r.plan_id = p.id
           LEFT JOIN usuario u ON u.id = r.validada_por_id
           WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'
             AND r.estado = 'Confirmado' AND r.validada_en IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM conflicto k WHERE k.plan_id = p.id AND k.estado = 'Abierto')
           ORDER BY c.nombre`,
          anioObjetivo,
        ),
      };
    case 'actas':
      return {
        titulo: 'Actas por revisar',
        descripcion: 'Actas enviadas a revisión que esperan la decisión de Dirección.',
        filas: todos(
          `SELECT c.id AS club_id, c.nombre AS club, m.id AS reunion_id, m.inicio, u.nombre AS toma_acta
           FROM reunion m JOIN plan p ON p.id = m.plan_id JOIN club c ON c.id = p.club_id
           LEFT JOIN usuario u ON u.id = m.acta_responsable_id
           WHERE m.acta_estado = 'Para revisar' ORDER BY m.inicio`,
        ),
      };
    case 'vencidas':
      return {
        titulo: 'Tareas vencidas',
        descripcion: 'Compromisos abiertos cuyo vencimiento ya pasó. Resolver otra tarea no los hace desaparecer.',
        filas: todos(
          `SELECT c.id AS club_id, c.nombre AS club, k.id AS compromiso_id, k.descripcion, k.fecha_limite,
                  k.estado, u.nombre AS responsable
           FROM compromiso k JOIN reunion m ON m.id = k.reunion_id
           JOIN plan p ON p.id = m.plan_id JOIN club c ON c.id = p.club_id
           JOIN usuario u ON u.id = k.responsable_id
           WHERE k.estado IN ('Pendiente','En curso') AND k.fecha_limite < ?
           ORDER BY k.fecha_limite`,
          hoy(),
        ),
      };
    case 'reconfirmaciones':
      return {
        titulo: 'Reconfirmaciones abiertas',
        descripcion:
          'Fichas sin resultado final. Condicional y Sin respuesta siguen abiertas: no son confirmación ni baja.',
        filas: todos(
          `SELECT c.id AS club_id, c.nombre AS club, r.id AS reconfirmacion_id, r.estado,
                  r.fecha_prevista, r.proximo_contacto
           FROM reconfirmacion r JOIN plan p ON p.id = r.plan_id JOIN club c ON c.id = p.club_id
           WHERE p.anio_objetivo = ? AND p.estado <> 'Archivada'
             AND r.estado IN ('Pendiente','Contactado','Condicional','Sin respuesta')
           ORDER BY IFNULL(r.proximo_contacto, r.fecha_prevista)`,
          anioObjetivo,
        ),
      };
    case 'conflictos':
      return {
        titulo: 'Conflictos de datos',
        descripcion:
          'Duplicados detectados al importar. Quedan a la vista y bloquean confirmar o cerrar el plan afectado.',
        filas: todos(
          `SELECT k.id AS conflicto_id, k.entidad, k.clave, k.detalle, k.estado, k.detectado_en,
                  c.id AS club_id, c.nombre AS club
           FROM conflicto k LEFT JOIN club c ON c.id = k.club_id
           ORDER BY CASE k.estado WHEN 'Abierto' THEN 0 ELSE 1 END, k.detectado_en DESC`,
        ),
      };
    default:
      return null;
  }
}

/** Qué conviene hacer ahora con este plan. Un solo próximo paso, en lenguaje llano. */
export function proximoPaso(plan) {
  if (!plan) return { texto: 'Crear el plan del ciclo 2026/2027.', destino: null };
  if (plan.estado === 'Archivada') return { texto: 'Plan archivado.', destino: null };
  if (plan.estado === 'Cerrada') return { texto: 'Plan cerrado. Nada pendiente.', destino: null };

  const detalles = planes.detalles(plan.id);
  if (detalles.length === 0) {
    return { texto: 'Cargar las disciplinas del club y lo que se pretende para 2027.', destino: 'tiras' };
  }

  const reunionesPlan = reuniones.porPlan(plan.id);
  const programada = reunionesPlan.find((m) => m.estado === 'Programada');
  if (!reunionesPlan.some((m) => m.estado !== 'Cancelada')) {
    return { texto: 'Agendar la reunión con el club.', destino: 'reuniones' };
  }
  const enBorrador = reunionesPlan.find((m) => m.estado === 'Borrador');
  if (enBorrador && !programada) {
    return {
      texto: 'Programar la reunión: quedó en borrador.',
      destino: 'reuniones',
      reunionId: enBorrador.id,
    };
  }
  if (programada) {
    return {
      texto: 'Registrar el acta de la reunión programada y marcarla como realizada.',
      destino: 'reuniones',
      reunionId: programada.id,
    };
  }
  const enRevision = reunionesPlan.find((m) => m.acta_estado === 'Para revisar');
  if (enRevision) {
    return { texto: 'Revisar y aprobar el acta enviada.', destino: 'reuniones', reunionId: enRevision.id };
  }
  const borradorActa = reunionesPlan.find((m) => m.estado === 'Realizada' && m.acta_estado === 'Borrador');
  if (borradorActa) {
    return { texto: 'Enviar el acta a revisión.', destino: 'reuniones', reunionId: borradorActa.id };
  }

  const tareasAbiertas = compromisos.porPlan(plan.id).filter((t) => compromisos.ABIERTOS.includes(t.estado));
  const ficha = reconfirmaciones.porPlan(plan.id);
  if (!ficha) {
    // La ficha reconfirma un acta aprobada: sin eso, el paso que falta es el acta.
    const acta = reunionesPlan.find((m) => m.acta_estado === 'Validada');
    if (!acta) {
      return { texto: 'Aprobar el acta de la reunión: de ahí sale la reconfirmación.', destino: 'reuniones' };
    }
    return {
      texto: acta.fecha_recontacto
        ? `Abrir la ficha de reconfirmación: el acta la dejó para el ${fechaCorta(acta.fecha_recontacto)}.`
        : 'Abrir la ficha de reconfirmación para enero-febrero.',
      destino: 'reconfirmacion',
    };
  }
  if (!ficha.validada_en) {
    if (ficha.estado === 'Pendiente') return { texto: 'Registrar el primer contacto de reconfirmación.', destino: 'reconfirmacion' };
    if (ficha.estado === 'Condicional') return { texto: 'Hacer seguimiento de las condiciones del club.', destino: 'reconfirmacion' };
    if (ficha.estado === 'Sin respuesta') return { texto: 'Reintentar el contacto: el caso sigue abierto.', destino: 'reconfirmacion' };
    return { texto: 'Completar cantidades finales y validar el resultado.', destino: 'reconfirmacion' };
  }
  if (tareasAbiertas.length > 0) {
    return { texto: `Resolver ${tareasAbiertas.length} compromiso(s) abierto(s).`, destino: 'compromisos' };
  }
  return { texto: 'Cerrar el plan: ya están todas las aprobaciones.', destino: 'plan' };
}

/** Todo lo que necesita la ficha integral del club. */
export function fichaClub(clubId, anioObjetivo = CICLO) {
  const club = uno(
    `SELECT c.*, u.nombre AS responsable_nombre, cp.nombre AS creado_por_nombre
     FROM club c
     LEFT JOIN usuario u ON u.id = c.responsable_id
     LEFT JOIN usuario cp ON cp.id = c.creado_por_id
     WHERE c.id = ?`,
    clubId,
  );
  if (!club) return null;

  const plan = uno('SELECT * FROM plan WHERE club_id = ? AND anio_objetivo = ?', clubId, anioObjetivo);
  if (!plan) {
    return { club, plan: null, proximoPaso: proximoPaso(null), historial: historialDeClub(clubId) };
  }

  return {
    club,
    plan,
    detalles: planes.detalles(plan.id),
    reuniones: reuniones.porPlan(plan.id),
    compromisos: compromisos.porPlan(plan.id),
    reconfirmacion: reconfirmaciones.porPlan(plan.id),
    bloqueos: planes.bloqueos(plan),
    faltantesParaCerrar: planes.faltantesParaCerrar(plan.id),
    faltantesParaConfirmar: reconfirmaciones.faltantesParaConfirmar(plan.id),
    proximoPaso: proximoPaso(plan),
    conflictos: todos(`SELECT * FROM conflicto WHERE plan_id = ? ORDER BY detectado_en DESC`, plan.id),
    historial: historialDeClub(clubId),
  };
}

export function historialDeClub(clubId, limite = 60) {
  return todos(
    `SELECT h.*, u.nombre AS actor_nombre
     FROM historial h
     LEFT JOIN usuario u ON u.id = h.actor_id
     WHERE h.plan_id IN (SELECT id FROM plan WHERE club_id = ?)
        OR (h.entidad = 'club' AND h.entidad_id = ?)
     ORDER BY h.ocurrido_en DESC
     LIMIT ?`,
    clubId,
    clubId,
    limite,
  );
}

export function historialGeneral({ limite = 200, tipo = '', planId = null } = {}) {
  return todos(
    `SELECT h.*, u.nombre AS actor_nombre, c.nombre AS club_nombre, c.id AS club_id
     FROM historial h
     LEFT JOIN usuario u ON u.id = h.actor_id
     LEFT JOIN plan p ON p.id = h.plan_id
     LEFT JOIN club c ON c.id = p.club_id
     WHERE (? = '' OR h.tipo = ?) AND (? IS NULL OR h.plan_id = ?)
     ORDER BY h.ocurrido_en DESC
     LIMIT ?`,
    tipo,
    tipo,
    planId,
    planId,
    limite,
  );
}

export function tiposDeEvento() {
  return todos('SELECT DISTINCT tipo FROM historial ORDER BY tipo').map((f) => f.tipo);
}

/** Contenido del tablero de inicio. */
export function inicio(usuario) {
  const fecha = hoy();
  const enSieteDias = sumarDias(fecha, 7);
  return {
    indicadores: indicadores(),
    proximasReuniones: todos(
      `SELECT m.*, c.nombre AS club_nombre, p.club_id, d1.nombre AS director1_nombre,
              d2.nombre AS director2_nombre, ar.nombre AS acta_responsable_nombre
       FROM reunion m JOIN plan p ON p.id = m.plan_id JOIN club c ON c.id = p.club_id
       LEFT JOIN usuario d1 ON d1.id = m.director1_id
       LEFT JOIN usuario d2 ON d2.id = m.director2_id
       LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
       WHERE m.estado = 'Programada' AND m.inicio IS NOT NULL
       ORDER BY m.inicio LIMIT 8`,
    ),
    actasPorRevisar: todos(
      `SELECT m.*, c.nombre AS club_nombre, p.club_id, ar.nombre AS acta_responsable_nombre
       FROM reunion m JOIN plan p ON p.id = m.plan_id JOIN club c ON c.id = p.club_id
       LEFT JOIN usuario ar ON ar.id = m.acta_responsable_id
       WHERE m.acta_estado = 'Para revisar' ORDER BY m.inicio LIMIT 8`,
    ),
    misTareas: usuario ? compromisos.listar({ filtro: 'abiertos', responsableId: usuario.id }).slice(0, 8) : [],
    tareasVencidas: compromisos.vencidos().slice(0, 8),
    reconfirmacionesAGestionar: reconfirmaciones.cola({ filtro: 'abiertas' }).slice(0, 8),
    ventana: reconfirmaciones.ventana(),
    dentroDeVentana: fecha >= reconfirmaciones.ventana().inicio && fecha <= reconfirmaciones.ventana().fin,
    proximaSemana: enSieteDias,
  };
}

export function conflictos({ soloAbiertos = false } = {}) {
  return todos(
    `SELECT k.*, c.nombre AS club_nombre
     FROM conflicto k LEFT JOIN club c ON c.id = k.club_id
     ${soloAbiertos ? `WHERE k.estado = 'Abierto'` : ''}
     ORDER BY CASE k.estado WHEN 'Abierto' THEN 0 ELSE 1 END, k.detectado_en DESC`,
  );
}
