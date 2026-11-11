// El orden en que FUTSALA lee las disciplinas es el de la planilla de venta, no el
// alfabético: Masculino, Promocionales, Femenino, Veteranos. Las pantallas tienen que
// respetarlo para que la grilla de un club se pueda comparar de un vistazo con el Excel.
// Cualquier disciplina que no sea una de esas cuatro va después, ordenada por nombre.

export const ORDEN_PLANILLA = ['masculino', 'promocionales', 'femenino', 'veteranos'];

/**
 * Fragmento de ORDER BY que ordena como la planilla. Se le pasa el alias de la tabla
 * ("d" para plan_detalle) o nada si la consulta no usa alias.
 */
export function ordenPorPlanilla(alias = '') {
  const campo = alias ? `${alias}.disciplina_norm` : 'disciplina_norm';
  const nombre = alias ? `${alias}.disciplina` : 'disciplina';
  const casos = ORDEN_PLANILLA.map((c, i) => `WHEN '${c}' THEN ${i + 1}`).join(' ');
  return `CASE ${campo} ${casos} ELSE ${ORDEN_PLANILLA.length + 1} END, ${nombre}`;
}
