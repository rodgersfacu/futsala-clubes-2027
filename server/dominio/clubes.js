import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNoEncontrado } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar, actualizar } from './registro.js';

/** Qué tan importante es el club para la liga: 1 absoluta, 2 importante, 3 normal, 4 baja. */
export const PRIORIDADES = ['1', '2', '3', '4'];

const ETIQUETAS = {
  nombre: 'Nombre',
  localidad: 'Localidad',
  contacto_nombre: 'Contacto',
  contacto_email: 'Correo de contacto',
  contacto_telefono: 'Teléfono',
  responsable_id: 'Responsable',
  prioridad: 'Prioridad',
  analisis_url: 'Análisis 2026',
  notas: 'Notas',
  activo: 'Activo',
  contacto_directo: 'Contacto de Dirección',
};

export function obtener(id) {
  return uno('SELECT * FROM club WHERE id = ?', id);
}

export function exigir(id) {
  const club = obtener(id);
  if (!club) throw new ErrorNoEncontrado('Ese club no existe.');
  return club;
}

/** Listado con el plan del ciclo, avance y próxima acción ya resueltos. */
export function listar({ busqueda = '', estado = '', soloActivos = false, anioObjetivo = 2027 } = {}) {
  const termino = v.normalizar(busqueda);
  const filas = todos(
    `SELECT c.*,
            p.id            AS plan_id,
            p.estado        AS plan_estado,
            u.nombre        AS responsable_nombre,
            r.estado        AS recon_estado,
            r.validada_en   AS recon_validada_en,
            (SELECT count(*) FROM plan_detalle d WHERE d.plan_id = p.id) AS disciplinas,
            (SELECT count(*) FROM reunion m WHERE m.plan_id = p.id AND m.acta_estado = 'Validada') AS actas_validadas,
            (SELECT count(*) FROM reunion m WHERE m.plan_id = p.id AND m.estado = 'Programada') AS reuniones_programadas,
            (SELECT count(*) FROM compromiso k JOIN reunion m2 ON m2.id = k.reunion_id
              WHERE m2.plan_id = p.id AND k.estado IN ('Pendiente','En curso')) AS tareas_abiertas,
            (SELECT count(*) FROM conflicto f WHERE f.plan_id = p.id AND f.estado = 'Abierto') AS conflictos
     FROM club c
     LEFT JOIN plan p ON p.club_id = c.id AND p.anio_objetivo = ?
     LEFT JOIN usuario u ON u.id = c.responsable_id
     LEFT JOIN reconfirmacion r ON r.plan_id = p.id
     ORDER BY c.nombre`,
    anioObjetivo,
  );

  return filas
    .filter((f) => (soloActivos ? f.activo === 1 : true))
    .filter((f) => (termino ? f.nombre_norm.includes(termino) || v.normalizar(f.localidad).includes(termino) : true))
    .filter((f) => (estado ? (f.plan_estado || 'Sin plan') === estado : true));
}

/** Clubes con nombre parecido: aviso, no bloqueo. Los homónimos son posibles. */
export function similares(nombre, exceptoId = null) {
  const norma = v.normalizar(nombre);
  if (!norma) return [];
  return todos('SELECT id, nombre, localidad FROM club WHERE id IS NOT ?', exceptoId).filter((c) => {
    const otra = v.normalizar(c.nombre);
    return otra === norma || otra.includes(norma) || norma.includes(otra);
  });
}

export function crear(actor, datos) {
  exigirDireccion(actor, 'crear clubes');
  const campos = leerCampos(datos);

  return enTransaccion(() => {
    const id = nuevoId();
    ejecutar(
      `INSERT INTO club (id, nombre, nombre_norm, localidad, contacto_nombre, contacto_email,
                         contacto_telefono, responsable_id, prioridad, analisis_url, activo,
                         contacto_directo, notas, creado_en, creado_por_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      campos.nombre,
      v.normalizar(campos.nombre),
      campos.localidad,
      campos.contacto_nombre,
      campos.contacto_email,
      campos.contacto_telefono,
      campos.responsable_id,
      campos.prioridad,
      campos.analisis_url,
      campos.activo,
      campos.contacto_directo,
      campos.notas,
      ahora(),
      actor.id,
    );
    registrar({
      actor,
      tipo: 'club.creado',
      entidad: 'club',
      entidadId: id,
      datosPosteriores: campos,
    });
    return obtener(id);
  });
}

export function editar(actor, clubId, datos) {
  exigirDireccion(actor, 'editar datos del club');
  const club = exigir(clubId);
  const campos = leerCampos(datos);

  return enTransaccion(() => {
    const guardado = actualizar({
      tabla: 'club',
      id: club.id,
      campos: { ...campos, nombre_norm: v.normalizar(campos.nombre) },
      version: datos.version ?? null,
      etiquetas: ETIQUETAS,
      volverA: `/clubes/${club.id}`,
    });
    registrar({
      actor,
      tipo: 'club.editado',
      entidad: 'club',
      entidadId: club.id,
      datosAnteriores: soloCampos(club),
      datosPosteriores: soloCampos(guardado),
    });
    return guardado;
  });
}

function leerCampos(datos) {
  return {
    nombre: v.textoObligatorio(datos.nombre, 'El nombre del club', { minimo: 2 }),
    localidad: v.texto(datos.localidad),
    contacto_nombre: v.texto(datos.contacto_nombre),
    contacto_email: v.email(datos.contacto_email, 'El correo de contacto'),
    contacto_telefono: v.texto(datos.contacto_telefono),
    responsable_id: v.texto(datos.responsable_id),
    prioridad: v.opcion(datos.prioridad || '3', PRIORIDADES, 'La prioridad'),
    analisis_url: v.url(datos.analisis_url, 'El enlace del análisis 2026'),
    activo: datos.activo === undefined ? 1 : v.booleano(datos.activo),
    // A estos clubes los contactan los directivos: los ayudantes no los llaman.
    contacto_directo: v.booleano(datos.contacto_directo),
    notas: v.texto(datos.notas),
  };
}

function soloCampos(club) {
  const copia = {};
  for (const clave of Object.keys(ETIQUETAS)) copia[clave] = club[clave];
  return copia;
}
