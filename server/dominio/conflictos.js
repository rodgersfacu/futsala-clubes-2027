import { uno, todos, ejecutar, enTransaccion } from '../db.js';
import { nuevoId, exigirDireccion } from '../auth.js';
import { ahora } from '../lib/fechas.js';
import { ErrorNoEncontrado, ErrorNegocio } from '../lib/errores.js';
import * as v from '../lib/validar.js';
import { registrar } from './registro.js';

/**
 * Registra un conflicto detectado al importar datos. La base queda sin duplicados
 * (la unicidad es una restricción real) y la fila rechazada queda visible como conflicto,
 * bloqueando confirmar o cerrar ese plan hasta que alguien decida qué corresponde.
 */
export function registrarConflicto({ origen, entidad, clave, detalle, clubId = null, planId = null, datos }) {
  const id = nuevoId();
  ejecutar(
    `INSERT INTO conflicto (id, origen, entidad, clave, detalle, club_id, plan_id, datos, estado, detectado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Abierto', ?)`,
    id,
    origen,
    entidad,
    clave,
    detalle,
    clubId,
    planId,
    JSON.stringify(datos ?? {}),
    ahora(),
  );
  return id;
}

export function obtener(id) {
  return uno('SELECT * FROM conflicto WHERE id = ?', id);
}

export function listar({ soloAbiertos = false } = {}) {
  return todos(
    `SELECT k.*, c.nombre AS club_nombre, r.nombre AS resuelto_por_nombre
     FROM conflicto k
     LEFT JOIN club c ON c.id = k.club_id
     LEFT JOIN usuario r ON r.id = k.resuelto_por_id
     ${soloAbiertos ? `WHERE k.estado = 'Abierto'` : ''}
     ORDER BY CASE k.estado WHEN 'Abierto' THEN 0 ELSE 1 END, k.detectado_en DESC`,
  );
}

export function resolver(actor, conflictoId, datos) {
  exigirDireccion(actor, 'resolver conflictos de datos');
  const conflicto = obtener(conflictoId);
  if (!conflicto) throw new ErrorNoEncontrado('Ese conflicto no existe.');
  if (conflicto.estado === 'Resuelto') throw new ErrorNegocio('Ese conflicto ya está resuelto.');
  const resolucion = v.motivo(datos.resolucion, 'La resolución');

  return enTransaccion(() => {
    // El conflicto se cierra con explicación; la fila rechazada se conserva como dato.
    ejecutar(
      `UPDATE conflicto SET estado = 'Resuelto', resuelto_en = ?, resuelto_por_id = ?, resolucion = ?
       WHERE id = ? AND estado = 'Abierto'`,
      ahora(),
      actor.id,
      resolucion,
      conflictoId,
    );
    registrar({
      actor,
      tipo: 'conflicto.resuelto',
      entidad: 'conflicto',
      entidadId: conflictoId,
      planId: conflicto.plan_id,
      motivo: resolucion,
      estadoAnterior: 'Abierto',
      estadoPosterior: 'Resuelto',
      datosAnteriores: conflicto,
    });
    return obtener(conflictoId);
  });
}
