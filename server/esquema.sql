-- Esquema FUTSALA 2027.
-- Las reglas estructurales viven aca: claves, unicidad, rangos, relaciones fijas,
-- bloqueos posteriores a una aprobacion e historial de solo-agregado.
-- Lo que depende de estado cruzado tambien se refuerza con triggers, de modo que
-- una peticion directa al backend encuentre las mismas restricciones que el formulario.

CREATE TABLE IF NOT EXISTS usuario (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) >= 5),
  nombre        TEXT NOT NULL CHECK (length(trim(nombre)) >= 2),
  rol           TEXT NOT NULL CHECK (rol IN ('Direccion', 'Ayudante', 'Consulta')),
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  -- Ingreso con contraseña propia (scrypt con sal individual; nunca la contraseña).
  clave_hash    TEXT,
  -- Identificador de la cuenta Google vinculada (verificada por Firebase).
  google_sub    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_google_sub ON usuario(google_sub) WHERE google_sub IS NOT NULL;

-- Pedidos de acceso de personas que se registraron solas (correo y contraseña, o Google).
-- No dan ningún permiso: Dirección los aprueba eligiendo el rol, y recién ahí nace el
-- usuario. Las filas no se borran: quedan como registro de quién pidió y quién resolvió.
CREATE TABLE IF NOT EXISTS solicitud_acceso (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL CHECK (email = lower(trim(email)) AND length(email) >= 5),
  nombre          TEXT NOT NULL CHECK (length(trim(nombre)) >= 2),
  clave_hash      TEXT,
  google_sub      TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  creada_en       TEXT NOT NULL,
  resuelta_en     TEXT,
  resuelta_por_id TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  usuario_id      TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  CHECK (clave_hash IS NOT NULL OR google_sub IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS solicitud_pendiente_email ON solicitud_acceso(email) WHERE estado = 'pendiente';

-- Enlaces de acceso de un solo uso. Reemplazan a la lista de identidades de prueba: para
-- entrar hace falta un enlace que se generó para esa persona y que todavía no se usó.
--
-- Se guarda el HASH del token, nunca el token. Quien pueda leer la base no puede entrar
-- como nadie: el texto del enlace solo existe mientras viaja hasta su dueño.
--
-- Las filas no se borran: son el registro de quién entró y cuándo.
CREATE TABLE IF NOT EXISTS acceso (
  id            TEXT PRIMARY KEY,
  usuario_id    TEXT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  token_hash    TEXT NOT NULL UNIQUE,
  creado_en     TEXT NOT NULL,
  expira_en     TEXT NOT NULL,
  usado_en      TEXT,
  -- Quién lo generó: una Dirección desde Administración, o nadie si lo pidió la persona.
  creado_por_id TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  -- Por qué dejó de servir, cuando no fue porque se usó: lo reemplazó otro, o la persona
  -- entró con otro enlace.
  anulado_en    TEXT,
  motivo_anulado TEXT,
  CHECK (expira_en > creado_en),
  CHECK (usado_en IS NULL OR anulado_en IS NULL)
);

CREATE INDEX IF NOT EXISTS acceso_usuario_idx ON acceso (usuario_id, usado_en);

CREATE TABLE IF NOT EXISTS club (
  id                TEXT PRIMARY KEY,
  nombre            TEXT NOT NULL CHECK (length(trim(nombre)) >= 2),
  nombre_norm       TEXT NOT NULL,
  localidad         TEXT,
  contacto_nombre   TEXT,
  contacto_email    TEXT,
  contacto_telefono TEXT,
  responsable_id    TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  analisis_url      TEXT,
  -- Qué tan importante es este club para la liga:
  --   1 absoluta · 2 importante · 3 normal · 4 baja
  -- Es del club, no del ciclo: no cambia porque empiece un año nuevo. Un club de
  -- prioridad 1 suele ameritar que la reunión sea en el club y no en la liga.
  prioridad         TEXT NOT NULL DEFAULT '3' CHECK (prioridad IN ('1', '2', '3', '4')),
  -- A estos clubes los contactan los directivos: los ayudantes no los llaman.
  contacto_directo  INTEGER NOT NULL DEFAULT 0 CHECK (contacto_directo IN (0, 1)),
  activo            INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  notas             TEXT,
  creado_en         TEXT NOT NULL,
  creado_por_id     TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS club_nombre_norm_idx ON club (nombre_norm);

-- Un plan por club y ciclo: restriccion de base, no solo de interfaz.
CREATE TABLE IF NOT EXISTS plan (
  id                      TEXT PRIMARY KEY,
  club_id                 TEXT NOT NULL REFERENCES club(id) ON DELETE RESTRICT,
  anio_cierre             INTEGER NOT NULL,
  anio_objetivo           INTEGER NOT NULL,
  -- El plan no tiene datos propios para escribir: es el hilo que ata un club con un
  -- ciclo, sus disciplinas y sus reuniones. Lo que se prepara se escribe como nota de
  -- la reunión; lo que se acuerda, en el acta. Quién atiende al club y qué prioridad
  -- tiene son del club, no del ciclo.
  -- El plan está abierto hasta que se cierra el año con ese club. Los pasos del
  -- circuito (reunión, acta, reconfirmación) se leen de sus propios registros.
  estado                  TEXT NOT NULL DEFAULT 'Abierta'
                            CHECK (estado IN ('Abierta', 'Cerrada', 'Archivada')),
  creado_en               TEXT NOT NULL,
  creado_por_id           TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  version                 INTEGER NOT NULL DEFAULT 1,
  UNIQUE (club_id, anio_objetivo),
  CHECK (anio_objetivo = anio_cierre + 1)
);

CREATE TABLE IF NOT EXISTS reunion (
  id                   TEXT PRIMARY KEY,
  plan_id              TEXT NOT NULL REFERENCES plan(id) ON DELETE RESTRICT,
  inicio               TEXT,
  fin                  TEXT,
  -- Dónde se hace: en la sede de la liga, en el club, o a distancia.
  lugar                TEXT,
  modalidad            TEXT NOT NULL DEFAULT 'En la liga'
                         CHECK (modalidad IN ('En la liga', 'En el club', 'Llamada')),
  estado               TEXT NOT NULL DEFAULT 'Borrador'
                         CHECK (estado IN ('Borrador', 'Programada', 'Realizada', 'Cancelada')),
  -- La reunión la tiene una Dirección. La segunda es opcional, por si van las dos.
  director1_id         TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  director2_id         TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  acta_responsable_id  TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  -- Observaciones sueltas de esta reunión: lo que hay que tener en cuenta antes y
  -- cualquier cosa que convenga anotar después. No es el acta y no se aprueba, así que
  -- sigue siendo editable aunque el acta ya esté aprobada.
  nota                 TEXT,
  delegados_presentes  TEXT,
  acta                 TEXT,
  devolucion_club      TEXT,
  proximo_paso         TEXT,
  -- Cuándo se vuelve a hablar con el club para que confirme lo acordado. Sale del acta,
  -- que es donde se decide: "nos hablamos en febrero". De ahí toma su fecha la ficha de
  -- reconfirmación, en vez de que alguien la vuelva a escribir de memoria.
  fecha_recontacto     TEXT,
  acta_estado          TEXT NOT NULL DEFAULT 'Borrador'
                         CHECK (acta_estado IN ('Borrador', 'Para revisar', 'Validada')),
  acta_validada_por_id TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  acta_validada_en     TEXT,
  motivo_cancelacion   TEXT,
  motivo_devolucion    TEXT,
  creado_en            TEXT NOT NULL,
  creado_por_id        TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  version              INTEGER NOT NULL DEFAULT 1,
  CHECK (inicio IS NULL OR fin IS NULL OR fin > inicio),
  CHECK (director1_id IS NULL OR director2_id IS NULL OR director1_id <> director2_id),
  CHECK ((acta_estado = 'Validada') = (acta_validada_en IS NOT NULL)),
  CHECK ((acta_validada_en IS NOT NULL) = (acta_validada_por_id IS NOT NULL)),
  CHECK (estado <> 'Cancelada' OR motivo_cancelacion IS NOT NULL),
  -- Para programar: horario, quién la tiene y quién toma nota. El lugar solo hace
  -- falta cuando la reunión es en el club.
  CHECK (estado NOT IN ('Programada', 'Realizada')
         OR (inicio IS NOT NULL AND fin IS NOT NULL
             AND director1_id IS NOT NULL AND acta_responsable_id IS NOT NULL)),
  CHECK (estado NOT IN ('Programada', 'Realizada') OR modalidad <> 'En el club' OR lugar IS NOT NULL),
  CHECK (estado <> 'Realizada'
         OR (delegados_presentes IS NOT NULL AND acta IS NOT NULL
             AND devolucion_club IS NOT NULL AND proximo_paso IS NOT NULL)),
  -- Un acta solo avanza si la reunion ocurrio.
  CHECK (acta_estado = 'Borrador' OR estado = 'Realizada')
);

CREATE INDEX IF NOT EXISTS reunion_plan_idx ON reunion (plan_id);
CREATE INDEX IF NOT EXISTS reunion_inicio_idx ON reunion (inicio);

-- Una disciplina por plan. Cada cantidad acordada queda atada al acta que la aprobo.
CREATE TABLE IF NOT EXISTS plan_detalle (
  id                  TEXT PRIMARY KEY,
  plan_id             TEXT NOT NULL REFERENCES plan(id) ON DELETE RESTRICT,
  disciplina           TEXT NOT NULL CHECK (length(trim(disciplina)) >= 2),
  disciplina_norm      TEXT NOT NULL,
  tiras_base          INTEGER CHECK (tiras_base IS NULL OR (tiras_base >= 0 AND tiras_base = CAST(tiras_base AS INTEGER))),
  tiras_propuestas    INTEGER CHECK (tiras_propuestas IS NULL OR (tiras_propuestas >= 0 AND tiras_propuestas = CAST(tiras_propuestas AS INTEGER))),
  tiras_acordadas     INTEGER CHECK (tiras_acordadas IS NULL OR (tiras_acordadas >= 0 AND tiras_acordadas = CAST(tiras_acordadas AS INTEGER))),
  -- Lo acordado, en palabras: lo que se habló con el club en esa reunión ("mantiene Liga
  -- de Honor B", "baja Femenino", "lo define en diciembre"). Es contenido del acta, se
  -- carga desde ahí y vale por sí solo: muchos acuerdos no son un número.
  acordado_texto      TEXT,
  tiras_reconfirmadas INTEGER CHECK (tiras_reconfirmadas IS NULL OR (tiras_reconfirmadas >= 0 AND tiras_reconfirmadas = CAST(tiras_reconfirmadas AS INTEGER))),
  observaciones       TEXT,
  -- Lo que el club jugó en 2026 (divisiones, una por línea) y lo que FUTSALA pretende
  -- para 2027 en palabras. La cantidad de tiras vive aparte y puede quedar desconocida.
  divisiones_2026     TEXT,
  intencion_2027      TEXT,
  reunion_acuerdo_id  TEXT REFERENCES reunion(id) ON DELETE RESTRICT,
  creado_en           TEXT NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  UNIQUE (plan_id, disciplina_norm),
  CHECK (tiras_acordadas IS NULL OR reunion_acuerdo_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS compromiso (
  id                TEXT PRIMARY KEY,
  reunion_id        TEXT NOT NULL REFERENCES reunion(id) ON DELETE RESTRICT,
  descripcion       TEXT NOT NULL CHECK (length(trim(descripcion)) >= 3),
  parte_responsable TEXT NOT NULL CHECK (parte_responsable IN ('FUTSALA', 'Club')),
  responsable_id    TEXT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  contacto_club     TEXT,
  fecha_limite      TEXT NOT NULL,
  estado            TEXT NOT NULL DEFAULT 'Pendiente'
                      CHECK (estado IN ('Pendiente', 'En curso', 'Cumplido', 'Cancelado')),
  evidencia_url     TEXT,
  resolucion        TEXT,
  fecha_resolucion  TEXT,
  creado_en         TEXT NOT NULL,
  creado_por_id     TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL DEFAULT 1,
  CHECK (parte_responsable <> 'Club' OR contacto_club IS NOT NULL),
  CHECK (estado <> 'Cumplido' OR (resolucion IS NOT NULL AND fecha_resolucion IS NOT NULL)),
  CHECK (estado <> 'Cancelado' OR resolucion IS NOT NULL),
  CHECK (estado IN ('Cumplido', 'Cancelado') OR (resolucion IS NULL AND fecha_resolucion IS NULL))
);

CREATE INDEX IF NOT EXISTS compromiso_reunion_idx ON compromiso (reunion_id);
CREATE INDEX IF NOT EXISTS compromiso_responsable_idx ON compromiso (responsable_id, estado);

-- Una ficha final por plan: restriccion de base.
CREATE TABLE IF NOT EXISTS reconfirmacion (
  id               TEXT PRIMARY KEY,
  plan_id          TEXT NOT NULL UNIQUE REFERENCES plan(id) ON DELETE RESTRICT,
  -- El acta que se está reconfirmando: lo que el club confirma es lo que se acordó en
  -- esa reunión, no una lista suelta de cantidades.
  reunion_id       TEXT REFERENCES reunion(id) ON DELETE RESTRICT,
  -- Cuándo se vuelve a hablar. Empieza con la fecha que fijó el acta y se puede
  -- reprogramar las veces que haga falta; cada cambio queda en el historial.
  fecha_prevista   TEXT NOT NULL,
  responsable_id   TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  estado           TEXT NOT NULL DEFAULT 'Pendiente'
                     CHECK (estado IN ('Pendiente', 'Contactado', 'Condicional', 'Confirmado', 'No continua', 'Sin respuesta')),
  fecha_contacto   TEXT,
  canal            TEXT CHECK (canal IS NULL OR canal IN ('Telefono', 'WhatsApp', 'Email', 'Presencial')),
  interlocutor     TEXT,
  respuesta_club   TEXT,
  condiciones      TEXT,
  evidencia_url    TEXT,
  proximo_contacto TEXT,
  validada_por_id  TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  validada_en      TEXT,
  motivo_excepcion TEXT,
  creado_en        TEXT NOT NULL,
  creado_por_id    TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  version          INTEGER NOT NULL DEFAULT 1,
  CHECK (proximo_contacto IS NULL OR fecha_contacto IS NULL OR proximo_contacto >= fecha_contacto),
  CHECK (validada_en IS NULL OR estado IN ('Confirmado', 'No continua')),
  CHECK ((validada_en IS NOT NULL) = (validada_por_id IS NOT NULL)),
  CHECK (estado <> 'Contactado'
         OR (fecha_contacto IS NOT NULL AND canal IS NOT NULL AND interlocutor IS NOT NULL AND proximo_contacto IS NOT NULL)),
  CHECK (estado <> 'Condicional'
         OR (fecha_contacto IS NOT NULL AND canal IS NOT NULL AND interlocutor IS NOT NULL
             AND condiciones IS NOT NULL AND proximo_contacto IS NOT NULL)),
  CHECK (estado <> 'Sin respuesta'
         OR (fecha_contacto IS NOT NULL AND canal IS NOT NULL AND proximo_contacto IS NOT NULL)),
  CHECK (estado NOT IN ('Confirmado', 'No continua')
         OR (fecha_contacto IS NOT NULL AND canal IS NOT NULL AND interlocutor IS NOT NULL
             AND respuesta_club IS NOT NULL AND evidencia_url IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS parametros (
  id                    TEXT PRIMARY KEY CHECK (id = 'CICLO-2027'),
  anio_cierre           INTEGER NOT NULL,
  anio_objetivo         INTEGER NOT NULL,
  inicio_reconfirmacion TEXT NOT NULL,
  fin_reconfirmacion    TEXT NOT NULL,
  zona_horaria          TEXT NOT NULL,
  avisos_internos       INTEGER NOT NULL DEFAULT 0 CHECK (avisos_internos IN (0, 1)),
  avisos_externos       INTEGER NOT NULL DEFAULT 0 CHECK (avisos_externos IN (0, 1)),
  version               INTEGER NOT NULL DEFAULT 1,
  CHECK (fin_reconfirmacion >= inicio_reconfirmacion)
);

-- Historial de solo-agregado. Guarda copia integra de lo aprobado antes del cambio.
CREATE TABLE IF NOT EXISTS historial (
  id                 TEXT PRIMARY KEY,
  ocurrido_en        TEXT NOT NULL,
  actor_id           TEXT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  tipo               TEXT NOT NULL,
  entidad            TEXT NOT NULL,
  entidad_id         TEXT NOT NULL,
  plan_id            TEXT REFERENCES plan(id) ON DELETE RESTRICT,
  reunion_id         TEXT REFERENCES reunion(id) ON DELETE RESTRICT,
  reconfirmacion_id  TEXT REFERENCES reconfirmacion(id) ON DELETE RESTRICT,
  motivo             TEXT,
  estado_anterior    TEXT,
  estado_posterior   TEXT,
  datos_anteriores   TEXT,
  datos_posteriores  TEXT
);

CREATE INDEX IF NOT EXISTS historial_plan_idx ON historial (plan_id, ocurrido_en);
CREATE INDEX IF NOT EXISTS historial_entidad_idx ON historial (entidad, entidad_id);

-- Conflictos detectados al importar: la base queda limpia y el conflicto queda visible.
CREATE TABLE IF NOT EXISTS conflicto (
  id             TEXT PRIMARY KEY,
  origen         TEXT NOT NULL,
  entidad        TEXT NOT NULL,
  clave          TEXT NOT NULL,
  detalle        TEXT NOT NULL,
  club_id        TEXT REFERENCES club(id) ON DELETE RESTRICT,
  plan_id        TEXT REFERENCES plan(id) ON DELETE RESTRICT,
  datos          TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'Abierto' CHECK (estado IN ('Abierto', 'Resuelto')),
  detectado_en   TEXT NOT NULL,
  resuelto_en    TEXT,
  resuelto_por_id TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  resolucion     TEXT
);

-- ---------------------------------------------------------------------------
-- Relaciones fijas despues del alta.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS plan_relacion_fija BEFORE UPDATE ON plan
WHEN NEW.club_id <> OLD.club_id OR NEW.anio_objetivo <> OLD.anio_objetivo OR NEW.anio_cierre <> OLD.anio_cierre
BEGIN
  SELECT RAISE(ABORT, 'El club y el ciclo de un plan no se pueden cambiar despues del alta');
END;

CREATE TRIGGER IF NOT EXISTS reunion_relacion_fija BEFORE UPDATE ON reunion
WHEN NEW.plan_id <> OLD.plan_id
BEGIN
  SELECT RAISE(ABORT, 'Una reunion no se puede mover a otro plan');
END;

CREATE TRIGGER IF NOT EXISTS detalle_relacion_fija BEFORE UPDATE ON plan_detalle
WHEN NEW.plan_id <> OLD.plan_id
BEGIN
  SELECT RAISE(ABORT, 'Una disciplina no se puede mover a otro plan');
END;

CREATE TRIGGER IF NOT EXISTS reconfirmacion_relacion_fija BEFORE UPDATE ON reconfirmacion
WHEN NEW.plan_id <> OLD.plan_id
BEGIN
  SELECT RAISE(ABORT, 'Una ficha final no se puede mover a otro plan');
END;

CREATE TRIGGER IF NOT EXISTS compromiso_relacion_fija BEFORE UPDATE ON compromiso
WHEN NEW.reunion_id <> OLD.reunion_id
BEGIN
  SELECT RAISE(ABORT, 'Un compromiso no se puede mover a otra reunion');
END;

-- La ficha final reconfirma un acta de su mismo plan, y solo una ya aprobada: lo que el
-- club confirma tiene que estar acordado y validado antes.
CREATE TRIGGER IF NOT EXISTS reconfirmacion_acta_valida BEFORE UPDATE OF reunion_id ON reconfirmacion
WHEN NEW.reunion_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM reunion m
                 WHERE m.id = NEW.reunion_id AND m.plan_id = NEW.plan_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'La ficha final reconfirma un acta aprobada del mismo plan');
END;

CREATE TRIGGER IF NOT EXISTS reconfirmacion_alta_acta_valida BEFORE INSERT ON reconfirmacion
WHEN NEW.reunion_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM reunion m
                 WHERE m.id = NEW.reunion_id AND m.plan_id = NEW.plan_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'La ficha final reconfirma un acta aprobada del mismo plan');
END;

-- El detalle de acuerdo debe pertenecer al mismo plan que la reunion que lo aprueba.
CREATE TRIGGER IF NOT EXISTS detalle_acuerdo_mismo_plan BEFORE UPDATE OF reunion_acuerdo_id ON plan_detalle
WHEN NEW.reunion_acuerdo_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM reunion m WHERE m.id = NEW.reunion_acuerdo_id AND m.plan_id = NEW.plan_id)
BEGIN
  SELECT RAISE(ABORT, 'El acta de acuerdo debe pertenecer al mismo plan que la disciplina');
END;

-- ---------------------------------------------------------------------------
-- Historial inmutable.
-- ---------------------------------------------------------------------------

-- Un enlace usado no vuelve atras: si se pudiera, un enlace viejo serviria dos veces.
CREATE TRIGGER IF NOT EXISTS acceso_un_solo_uso BEFORE UPDATE ON acceso
WHEN OLD.usado_en IS NOT NULL AND (NEW.usado_en IS NULL OR NEW.usado_en <> OLD.usado_en)
BEGIN
  SELECT RAISE(ABORT, 'Un enlace de acceso ya usado no se reabre');
END;

-- Tampoco cambia de dueño ni de token.
CREATE TRIGGER IF NOT EXISTS acceso_relacion_fija BEFORE UPDATE ON acceso
WHEN NEW.usuario_id <> OLD.usuario_id OR NEW.token_hash <> OLD.token_hash
BEGIN
  SELECT RAISE(ABORT, 'Un enlace de acceso no cambia de persona ni de token');
END;

CREATE TRIGGER IF NOT EXISTS historial_sin_modificar BEFORE UPDATE ON historial
BEGIN
  SELECT RAISE(ABORT, 'El historial no se modifica');
END;

CREATE TRIGGER IF NOT EXISTS historial_sin_borrar BEFORE DELETE ON historial
BEGIN
  SELECT RAISE(ABORT, 'El historial no se borra');
END;

-- ---------------------------------------------------------------------------
-- Bloqueos posteriores a una aprobacion.
-- ---------------------------------------------------------------------------

-- El plan ya no tiene datos propios que proteger: lo unico que cambia en el es su
-- estado, y para eso estan los disparadores de cierre y reapertura. Lo que antes vivia
-- aca (balance, objetivo, riesgos, prioridad, responsable, fecha objetivo) se fue al
-- club o a la nota de la reunion.

CREATE TRIGGER IF NOT EXISTS acta_validada_bloqueada BEFORE UPDATE ON reunion
WHEN OLD.acta_estado = 'Validada' AND NEW.acta_estado = 'Validada'
 AND (IFNULL(NEW.acta, '') <> IFNULL(OLD.acta, '')
   OR IFNULL(NEW.devolucion_club, '') <> IFNULL(OLD.devolucion_club, '')
   OR IFNULL(NEW.proximo_paso, '') <> IFNULL(OLD.proximo_paso, '')
   OR IFNULL(NEW.fecha_recontacto, '') <> IFNULL(OLD.fecha_recontacto, '')
   OR IFNULL(NEW.delegados_presentes, '') <> IFNULL(OLD.delegados_presentes, ''))
BEGIN
  SELECT RAISE(ABORT, 'El acta aprobada esta bloqueada: hay que reabrirla con motivo');
END;

CREATE TRIGGER IF NOT EXISTS reconfirmacion_validada_bloqueada BEFORE UPDATE ON reconfirmacion
WHEN OLD.validada_en IS NOT NULL AND NEW.validada_en IS NOT NULL
 AND (NEW.estado <> OLD.estado
   OR IFNULL(NEW.fecha_contacto, '') <> IFNULL(OLD.fecha_contacto, '')
   OR IFNULL(NEW.canal, '') <> IFNULL(OLD.canal, '')
   OR IFNULL(NEW.interlocutor, '') <> IFNULL(OLD.interlocutor, '')
   OR IFNULL(NEW.respuesta_club, '') <> IFNULL(OLD.respuesta_club, '')
   OR IFNULL(NEW.condiciones, '') <> IFNULL(OLD.condiciones, '')
   OR IFNULL(NEW.evidencia_url, '') <> IFNULL(OLD.evidencia_url, '')
   OR IFNULL(NEW.fecha_prevista, '') <> IFNULL(OLD.fecha_prevista, '')
   OR IFNULL(NEW.proximo_contacto, '') <> IFNULL(OLD.proximo_contacto, ''))
BEGIN
  SELECT RAISE(ABORT, 'El resultado final aprobado esta bloqueado: hay que reabrir la reconfirmacion con motivo');
END;

-- Lo que el club tuvo en 2026 y lo que se le planteó quedan fijos cuando hay un acta
-- aprobada: a partir de ahí es lo que se conversó con el club.
CREATE TRIGGER IF NOT EXISTS detalle_base_bloqueada BEFORE UPDATE ON plan_detalle
WHEN (IFNULL(NEW.tiras_base, -1) <> IFNULL(OLD.tiras_base, -1)
   OR IFNULL(NEW.divisiones_2026, '') <> IFNULL(OLD.divisiones_2026, ''))
 AND EXISTS (SELECT 1 FROM reunion m WHERE m.plan_id = OLD.plan_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'Lo de 2026 quedo fijo al aprobar el acta de este plan');
END;

-- El bloqueo vale también para el alta: con un acta aprobada no entra una disciplina
-- nueva que traiga cantidades de 2026 o pretendidas, porque esas ya se conversaron.
CREATE TRIGGER IF NOT EXISTS detalle_alta_bloqueada BEFORE INSERT ON plan_detalle
WHEN (NEW.tiras_base IS NOT NULL OR NEW.divisiones_2026 IS NOT NULL
   OR NEW.tiras_propuestas IS NOT NULL OR NEW.intencion_2027 IS NOT NULL)
 AND EXISTS (SELECT 1 FROM reunion m WHERE m.plan_id = NEW.plan_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'Ya hay un acta aprobada: lo de 2026 y lo pretendido quedaron fijos');
END;

CREATE TRIGGER IF NOT EXISTS detalle_propuesta_bloqueada BEFORE UPDATE ON plan_detalle
WHEN (IFNULL(NEW.tiras_propuestas, -1) <> IFNULL(OLD.tiras_propuestas, -1)
   OR IFNULL(NEW.intencion_2027, '') <> IFNULL(OLD.intencion_2027, ''))
 AND EXISTS (SELECT 1 FROM reunion m WHERE m.plan_id = OLD.plan_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'Lo pretendido quedo fijo porque ya hay un acta aprobada del plan');
END;

CREATE TRIGGER IF NOT EXISTS detalle_acordada_bloqueada BEFORE UPDATE ON plan_detalle
WHEN (IFNULL(NEW.tiras_acordadas, -1) <> IFNULL(OLD.tiras_acordadas, -1)
   OR IFNULL(NEW.acordado_texto, '') <> IFNULL(OLD.acordado_texto, ''))
 AND OLD.reunion_acuerdo_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM reunion m WHERE m.id = OLD.reunion_acuerdo_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'Lo acordado esta bloqueado por el acta aprobada que lo respalda');
END;

-- Lo acordado no existe suelto: siempre dice de qué reunion salio. La columna
-- tiras_acordadas lo tiene como CHECK de tabla; acordado_texto se agrego despues, y una
-- restriccion de tabla no se puede agregar sin reconstruirla, asi que va como disparador.
CREATE TRIGGER IF NOT EXISTS detalle_acordado_exige_acta BEFORE UPDATE ON plan_detalle
WHEN NEW.acordado_texto IS NOT NULL AND NEW.reunion_acuerdo_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Lo acordado necesita indicar en que reunion se acordo');
END;

CREATE TRIGGER IF NOT EXISTS detalle_alta_acordado_exige_acta BEFORE INSERT ON plan_detalle
WHEN NEW.acordado_texto IS NOT NULL AND NEW.reunion_acuerdo_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'Lo acordado necesita indicar en que reunion se acordo');
END;

CREATE TRIGGER IF NOT EXISTS detalle_final_bloqueada BEFORE UPDATE ON plan_detalle
WHEN IFNULL(NEW.tiras_reconfirmadas, -1) <> IFNULL(OLD.tiras_reconfirmadas, -1)
 AND EXISTS (SELECT 1 FROM reconfirmacion r WHERE r.plan_id = OLD.plan_id AND r.validada_en IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'Las cantidades finales estan bloqueadas por la reconfirmacion aprobada');
END;

CREATE TRIGGER IF NOT EXISTS detalle_plan_cerrado BEFORE UPDATE ON plan_detalle
WHEN EXISTS (SELECT 1 FROM plan p WHERE p.id = OLD.plan_id AND p.estado IN ('Cerrada', 'Archivada'))
BEGIN
  SELECT RAISE(ABORT, 'Las disciplinas de un plan cerrado estan bloqueadas');
END;

CREATE TRIGGER IF NOT EXISTS detalle_alta_plan_cerrado BEFORE INSERT ON plan_detalle
WHEN EXISTS (SELECT 1 FROM plan p WHERE p.id = NEW.plan_id AND p.estado IN ('Cerrada', 'Archivada'))
BEGIN
  SELECT RAISE(ABORT, 'No se agregan disciplinas a un plan cerrado');
END;

-- ---------------------------------------------------------------------------
-- Condiciones de estado que dependen de otras tablas.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS plan_cierre_condiciones BEFORE UPDATE ON plan
WHEN NEW.estado = 'Cerrada' AND OLD.estado <> 'Cerrada'
 AND (NOT EXISTS (SELECT 1 FROM reunion m WHERE m.plan_id = NEW.id AND m.acta_estado = 'Validada')
   OR NOT EXISTS (SELECT 1 FROM reconfirmacion r
                  WHERE r.plan_id = NEW.id AND r.validada_en IS NOT NULL
                    AND r.estado IN ('Confirmado', 'No continua'))
   OR EXISTS (SELECT 1 FROM compromiso c
              JOIN reunion m2 ON m2.id = c.reunion_id
              WHERE m2.plan_id = NEW.id AND c.estado IN ('Pendiente', 'En curso'))
   OR EXISTS (SELECT 1 FROM conflicto k WHERE k.plan_id = NEW.id AND k.estado = 'Abierto'))
BEGIN
  SELECT RAISE(ABORT, 'El plan no cumple todas las condiciones de cierre');
END;

-- Una disciplina vinculada a esta acta tiene que decir que se acordo. Alcanza con las
-- palabras: "mantiene", "baja Femenino", "lo define en diciembre" son acuerdos completos
-- aunque no haya numero. Lo que no se admite es una disciplina atada al acta y en blanco.
CREATE TRIGGER IF NOT EXISTS acta_aprobada_exige_acordadas BEFORE UPDATE ON reunion
WHEN NEW.acta_estado = 'Validada' AND OLD.acta_estado <> 'Validada'
 AND EXISTS (SELECT 1 FROM plan_detalle d
             WHERE d.reunion_acuerdo_id = NEW.id
               AND d.tiras_acordadas IS NULL AND d.acordado_texto IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Hay disciplinas de esta acta sin lo acordado');
END;

CREATE TRIGGER IF NOT EXISTS acta_aprobada_plan_abierto BEFORE UPDATE ON reunion
WHEN NEW.acta_estado = 'Validada' AND OLD.acta_estado <> 'Validada'
 AND EXISTS (SELECT 1 FROM plan p WHERE p.id = NEW.plan_id AND p.estado IN ('Cerrada', 'Archivada'))
BEGIN
  SELECT RAISE(ABORT, 'No se aprueba un acta de un plan cerrado');
END;

CREATE TRIGGER IF NOT EXISTS reconfirmacion_confirmada_exige_cantidades BEFORE UPDATE ON reconfirmacion
WHEN NEW.estado = 'Confirmado' AND NEW.validada_en IS NOT NULL AND OLD.validada_en IS NULL
 AND (NOT EXISTS (SELECT 1 FROM plan_detalle d WHERE d.plan_id = NEW.plan_id)
   OR EXISTS (SELECT 1 FROM plan_detalle d WHERE d.plan_id = NEW.plan_id AND d.tiras_reconfirmadas IS NULL))
BEGIN
  SELECT RAISE(ABORT, 'Confirmar exige al menos una disciplina y todas las cantidades finales completas');
END;

CREATE TRIGGER IF NOT EXISTS reconfirmacion_validada_exige_acta BEFORE UPDATE ON reconfirmacion
WHEN NEW.validada_en IS NOT NULL AND OLD.validada_en IS NULL
 AND NOT EXISTS (SELECT 1 FROM reunion m WHERE m.plan_id = NEW.plan_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'Validar el resultado final exige un acta aprobada del plan');
END;

CREATE TRIGGER IF NOT EXISTS reconfirmacion_validada_sin_conflicto BEFORE UPDATE ON reconfirmacion
WHEN NEW.validada_en IS NOT NULL AND OLD.validada_en IS NULL
 AND EXISTS (SELECT 1 FROM conflicto k WHERE k.plan_id = NEW.plan_id AND k.estado = 'Abierto')
BEGIN
  SELECT RAISE(ABORT, 'El plan tiene un conflicto de duplicados abierto: hay que resolverlo antes de validar');
END;

-- ---------------------------------------------------------------------------
-- Disponibilidad de Direccion para que le agenden reuniones.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS disponibilidad (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  dia_semana  INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  desde       TEXT NOT NULL CHECK (desde GLOB '[0-2][0-9]:[0-5][0-9]'),
  hasta       TEXT NOT NULL CHECK (hasta GLOB '[0-2][0-9]:[0-5][0-9]'),
  nota        TEXT,
  creado_en   TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  CHECK (hasta > desde)
);

CREATE INDEX IF NOT EXISTS disponibilidad_usuario_idx ON disponibilidad (usuario_id, dia_semana);

-- Vacaciones o cualquier tramo en que esa persona no toma reuniones.
CREATE TABLE IF NOT EXISTS ausencia (
  id          TEXT PRIMARY KEY,
  usuario_id  TEXT NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  desde       TEXT NOT NULL,
  hasta       TEXT NOT NULL,
  motivo      TEXT,
  creado_en   TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  CHECK (hasta >= desde)
);

CREATE INDEX IF NOT EXISTS ausencia_usuario_idx ON ausencia (usuario_id, desde);
