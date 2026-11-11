/** Error de regla de negocio: se muestra al usuario tal cual, con 400/403. */
export class ErrorNegocio extends Error {
  constructor(mensaje, { estado = 400, campo = null, ayuda = null } = {}) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.estado = estado;
    this.campo = campo;
    this.ayuda = ayuda;
  }
}

export class ErrorPermiso extends ErrorNegocio {
  constructor(mensaje = 'No tenés permiso para esta operación.', opciones = {}) {
    super(mensaje, { ...opciones, estado: 403 });
    this.name = 'ErrorPermiso';
  }
}

export class ErrorNoEncontrado extends ErrorNegocio {
  constructor(mensaje = 'No encontramos ese registro.') {
    super(mensaje, { estado: 404 });
    this.name = 'ErrorNoEncontrado';
  }
}

/** Dos personas editaron la misma versión: la segunda escritura no pisa a la primera. */
export class ErrorConflictoVersion extends ErrorNegocio {
  constructor({ entidad, id, versionEnviada, versionActual, diferencias = [], volverA = '/' }) {
    super('Otra persona guardó cambios en este registro mientras lo editabas.', { estado: 409 });
    this.name = 'ErrorConflictoVersion';
    this.entidad = entidad;
    this.id = id;
    this.versionEnviada = versionEnviada;
    this.versionActual = versionActual;
    this.diferencias = diferencias;
    this.volverA = volverA;
  }
}

/** Traduce violaciones de restricción de SQLite a mensajes legibles. */
export function traducirErrorSqlite(error) {
  const texto = String(error?.message || '');
  if (!/constraint|SQLITE_/i.test(texto)) return null;

  if (/UNIQUE constraint failed: plan\.club_id/.test(texto)) {
    return 'Ese club ya tiene un plan para el ciclo. Hay uno por club y ciclo.';
  }
  if (/UNIQUE constraint failed: plan_detalle/.test(texto)) {
    return 'Esa disciplina ya existe en el plan. Hay una fila por disciplina.';
  }
  if (/UNIQUE constraint failed: reconfirmacion\.plan_id/.test(texto)) {
    return 'El plan ya tiene su ficha de reconfirmación. Hay una sola por plan.';
  }
  if (/UNIQUE constraint failed: usuario\.email/.test(texto)) {
    return 'Ese correo ya está registrado.';
  }
  const abort = texto.match(/(?:SqliteError: )?(.+)/);
  if (/CHECK constraint failed: (\w+)/.test(texto)) {
    return `La base rechazó el dato por una restricción de integridad (${texto.split('CHECK constraint failed: ')[1]}).`;
  }
  if (/FOREIGN KEY constraint failed/.test(texto)) {
    return 'El registro está relacionado con otros datos y no se puede dejar sin referencia.';
  }
  // Los RAISE(ABORT) del esquema ya traen un mensaje en español.
  return abort ? abort[1] : texto;
}
