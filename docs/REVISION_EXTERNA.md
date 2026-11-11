# FUTSALA Reuniones 2027 — dossier para revisión externa

Documento autocontenido para que un revisor que **no puede ejecutar la aplicación** la
analice. Incluye el proceso real, el modelo de datos con sus restricciones, los permisos,
las máquinas de estado, el estado de los datos cargados y los límites conocidos.

Fecha: 03/11/2026. Versión 0.1.0. Uso interno de FUTSALA.

> Si además querés darle el código, está en el zip que acompaña este documento:
> unas 12.500 líneas de código y documentación, sin una sola dependencia externa.

---

## 1. Para qué es

FUTSALA es una liga de futsal. Entre noviembre y febrero el equipo recorre los clubes para
vender la participación de la temporada siguiente: cuántas **tiras** (equipos inscriptos)
va a presentar cada club en cada disciplina. La aplicación sostiene ese proceso de venta y
la reconfirmación posterior.

Reemplaza un prototipo hecho en **AppSheet sobre Google Sheets**, que se abandonó por
depender de Google, no poder aplicar restricciones reales de integridad y no tener un
historial confiable.

### El proceso real, tal como lo trabaja el equipo

1. El **ayudante** habla con el club, coordina y **agenda** la reunión.
2. La reunión es **en la liga** (45 minutos, una atrás de la otra) o **en el club**
   (unas 3 horas contando viaje, para clubes importantes).
3. **Diego o Facu** (Dirección) toman la reunión. Van con lo pretendido del club impreso
   y entregan las revistas de la liga.
4. El **ayudante toma nota** y después vuelca el acta al sistema.
5. Dirección **aprueba el acta**. Ahí quedan fijas las cantidades acordadas.
6. En **enero-febrero** se **reconfirma** con el club lo que se había hablado.
7. El plan del club se **cierra**.

Hay clubes que **contactan directamente los directivos**: están marcados para que los
ayudantes no los llamen.

---

## 2. Arquitectura y por qué

| Pieza | Elección |
|---|---|
| Servidor | Node.js 24, módulos `node:http`, `node:sqlite`, `node:zlib`, `node:crypto` |
| Dependencias externas | **Ninguna.** No hay `node_modules`. |
| Base de datos | SQLite en un archivo (`data/futsala.db`), modo WAL |
| Interfaz | HTML generado en el servidor. Responsive. **Funciona sin JavaScript.** |
| Sesión | Cookie firmada con HMAC-SHA256 + token anti-CSRF por formulario |
| Despliegue | Copiar la carpeta y `npm start` |

Razones: el requisito era reglas aplicadas en servidor, restricciones reales de base,
transacciones, detección de escrituras concurrentes y exportación propia, **sin contratar
infraestructura ni depender de Google**. Node y SQLite cubren todo eso con cero
instalación. Si más adelante hiciera falta concurrencia alta o varios servidores, la
migración natural es PostgreSQL: el esquema es SQL estándar salvo los disparadores.

```
server/
  esquema.sql        12 tablas, 23 disparadores, 9 índices
  db.js              conexión, transacciones, esquema idempotente
  auth.js            identidad de sesión y autorización por rol
  dominio/           reglas de negocio por entidad + historial + indicadores
  web/               rutas y páginas (HTML generado)
public/              estilos, íconos, 84 líneas de JavaScript opcional
scripts/             seed, importación de Excel, exportación, 152 pruebas
```

### Decisión deliberada: HTML del servidor, sin framework

La aplicación es un flujo de formularios y listas. Así funciona sin JavaScript, carga
rápido en teléfono y no hay dependencias que mantener. El precio es que no hay
interacciones ricas sin recargar la página. El JavaScript que existe (84 líneas) solo
mejora: confirmaciones dentro de la página, abrir la sección de un campo inválido y un
buscador que envía al dejar de tipear.

---

## 3. Modelo de datos

12 tablas. Cada registro tiene un `id` propio (UUID) y una columna `version`.

| Tabla | Qué es |
|---|---|
| `usuario` | Personas del equipo. `rol` es Direccion, Ayudante o Consulta. |
| `club` | Los 245 clubes. `contacto_directo` marca los que contacta Dirección. |
| `plan` | Un plan por club y por ciclo (2026 a 2027). Prioridad 1, 2 o 3. |
| `plan_detalle` | Una fila por disciplina del plan. **Cuatro cantidades de tiras.** |
| `reunion` | La reunión y su acta, en la misma fila. |
| `compromiso` | Tareas que salen del acta, de FUTSALA o del club. |
| `reconfirmacion` | La ficha de enero-febrero. Una por plan. |
| `disponibilidad` | Franjas semanales en que cada Dirección acepta reuniones. |
| `ausencia` | Tramos en que una Dirección no está (vacaciones). |
| `historial` | Auditoría de solo-agregado. |
| `conflicto` | Filas rechazadas en una importación, en cuarentena. |
| `parametros` | Ciclo, ventana de reconfirmación, interruptores de avisos. |

### Las cuatro cantidades, que es el centro del modelo

`plan_detalle` guarda por disciplina:

- `tiras_base` — lo que el club tuvo en **2026** (viene de la planilla).
- `tiras_propuestas` — lo que **pretendemos** para 2027 (lo decide Dirección).
- `tiras_acordadas` — lo que se **acordó en la reunión**, atado al acta que lo aprobó
  vía `reunion_acuerdo_id`.
- `tiras_reconfirmadas` — lo que quedó **reconfirmado** en enero-febrero.

Son columnas separadas y **no se suman entre sí**. Vacío significa "no se sabe" y nunca se
convierte en 0: un club que no jugó Femenino en 2026 no es lo mismo que uno que jugó con
0 tiras.

### Decisiones de modelo que vale discutir

- **El correo del usuario es un atributo único, no una clave.** En AppSheet era la clave
  de la tabla de usuarios y se repetía en cada tabla, así que cambiar un correo rompía el
  historial.
- **Nada se borra.** No hay operación de borrado en la aplicación y todas las claves
  foráneas son `ON DELETE RESTRICT`. Un plan que no va más se **archiva**; una reunión que
  no se hizo se **cancela con motivo**; un compromiso que no corresponde se **cancela con
  motivo**.
- **Reunión y acta en la misma fila.** Una reunión tiene exactamente un acta; separarlas
  habría agregado una tabla sin ganar nada.
- **Los conflictos de importación son una entidad propia.** La unicidad es una restricción
  real, así que un duplicado **no puede entrar**. La fila rechazada se guarda en
  `conflicto`, queda a la vista y **bloquea confirmar y cerrar ese plan** hasta que
  Dirección decida. No se elige un ganador de forma arbitraria.

---

## 4. Qué se aplica en la base, no solo en la pantalla

Esto es lo que más nos interesa que un revisor mire. El esquema completo está en el
**Apéndice A**. Resumen de las 23 reglas con disparador:

**Unicidad real (índices únicos)**

- Un plan por club y ciclo. Una disciplina por plan. Una ficha de reconfirmación por plan.
  Un correo por usuario. Nombres de club normalizados, para que "Boca" y "BOCA " choquen.

**Relaciones fijas después del alta (disparadores BEFORE UPDATE)**

- No se mueve un plan a otro club ni a otro ciclo.
- No se mueve una reunión, una disciplina ni una ficha a otro plan.
- Esto se cumple **incluso ejecutando SQL directo contra el archivo**.

**Bloqueo de lo aprobado**

- `acta_bloqueada`: un acta en estado Validada no se modifica.
- `detalle_base_bloqueada` y `detalle_propuesta_bloqueada`: las cantidades de 2026 y lo
  pretendido para 2027 quedan fijos **cuando el plan tiene un acta aprobada** — el momento
  en que ya se conversaron con el club.
- `detalle_acordada_bloqueada`: una cantidad acordada respaldada por un acta aprobada no
  se toca.
- `detalle_final_bloqueada`: una cantidad reconfirmada con ficha validada no se toca.
- `detalle_alta_bloqueada`: con un acta aprobada tampoco **entra** una disciplina nueva que
  traiga cantidades de 2026 o pretendidas. Una disciplina nueva **sin** cantidades sí se
  puede agregar: lo que queda fijo es lo que ya se conversó con el club, no el catálogo.
- `plan_cerrado_bloqueado`: nada del contenido de un plan Cerrado o Archivado se modifica.

**Condiciones de transición**

- `plan_cierre_condiciones`: un plan cierra solo con acta aprobada, resultado final
  validado, ningún compromiso abierto y ningún conflicto sin resolver.
- `acta_aprobada_exige_acordadas`: no se aprueba un acta sin cantidades acordadas.
- Disparadores de reconfirmación: confirmar exige contacto, respuesta, evidencia, acta
  aprobada y todas las cantidades finales cargadas.

**Historial de solo-agregado**

- `historial_sin_modificar` y `historial_sin_borrar`: UPDATE y DELETE sobre `historial`
  abortan. La aplicación tampoco ofrece la operación.

**Datos**

- Cantidades enteras de 0 o más. Fin de reunión posterior al inicio. Las dos direcciones
  de una reunión, personas distintas. Una reunión en el club exige lugar.

---

## 5. Permisos

Se aplican **en el dominio, no en la visibilidad de los botones**. Cada operación vuelve a
leer el usuario de la base, comprueba que esté activo y evalúa el rol antes de escribir.
Las pruebas incluyen peticiones directas que saltean la pantalla.

| | Dirección | Ayudante | Consulta |
|---|---|---|---|
| Ver todo | sí | sí | sí |
| Crear club y plan | sí | sí | no |
| Agendar y reprogramar | sí | sí, salvo clubes de contacto directo | no |
| Asignar quién toma la reunión | sí | no | no |
| Cantidades pretendidas 2027 | sí | no | no |
| Escribir el acta | sí | sí, la que le asignaron y mientras no esté aprobada | no |
| **Aprobar el acta** | **sí** | no | no |
| Compromisos | sí | crea desde sus actas; resuelve los suyos abiertos | no |
| Resultado final de reconfirmación | sí | no | no |
| **Reabrir con motivo** | **sí** | no | no |
| Alta de usuarios y roles | sí | no | no |
| Su propia disponibilidad | sí, solo la propia | — | — |

Reglas transversales:

- **Nadie cambia su propio rol ni su propio acceso** desde los formularios, ni para
  dejarlo igual.
- **Siempre tiene que quedar al menos una Dirección activa.**
- Usuario inactivo o sin identidad: sin acceso a los datos.

---

## 6. Máquinas de estado

**Plan**: Abierta, Cerrada, Archivada. Nada más. En qué punto del circuito está se **lee de
sus propios registros** (hay reunión, hay acta aprobada, hay resultado final), no de un
campo de estado. Esto se simplificó a propósito: el prototipo AppSheet tenía estados
intermedios ("Listo para presentar", "En seguimiento") y **dos máquinas de estado en
paralelo** sobre el mismo plan.

**Reunión**: Borrador, Programada, Realizada, o Cancelada con motivo.

**Acta**: Borrador, Para revisar, Validada. Devolver un acta **exige un motivo nuevo cada
vez**: al reenviarla se limpia el motivo anterior, así una devolución posterior no
reutiliza la explicación vieja. Un acta aprobada **no se puede devolver**: se reabre, que
es una operación distinta y auditada.

**Compromiso**: Pendiente, En curso, Cumplido, o Cancelado con motivo.

**Reconfirmación**: Pendiente, Contactado, Confirmado, No continua. Además Condicional y
Sin respuesta, que **no son confirmación ni baja**: son estados propios para no forzar un
resultado que no ocurrió.

### Reaperturas

- Exigen **rol Dirección** y **motivo de al menos 10 caracteres**.
- Guardan una **copia íntegra de lo aprobado** antes de tocar nada.
- La auditoría y el cambio ocurren en **una sola transacción**: no queda cambio sin
  registro ni registro sin cambio.
- **Orden obligatorio**: primero el plan, después la reconfirmación, por último el acta.
  La aplicación lo exige y explica por qué si se intenta en otro orden.
- Los sellos (quién validó, cuándo) salen de la sesión y del **reloj del servidor**, nunca
  de un campo del formulario.

### Concurrencia

Cada registro lleva `version`. Los formularios la envían y la escritura es
`UPDATE ... WHERE id = ? AND version = ?`. Si otra persona guardó antes, la segunda
escritura **no pisa nada**: devuelve conflicto y muestra **campo por campo** lo guardado
frente a lo enviado. Las acciones de estado (aprobar, cerrar, reabrir) no dependen de la
versión porque comprueban la condición de negocio en el momento, dentro de la transacción.

---

## 7. Agenda y disponibilidad

- Cada Dirección carga **franjas semanales** en que acepta reuniones y **ausencias**
  (vacaciones). Solo edita las propias.
- Quien agenda ve esa disponibilidad y **recibe un aviso** si elige otro momento, con el
  nombre de la persona y el motivo. **Nunca bloquea**: el aviso informa, la decisión es de
  quien agenda.
- El **fin de la reunión se calcula solo** según dónde sea: 45 minutos en la liga, 180
  minutos en el club (esos 180 ya incluyen el viaje).
- El horario se elige con selectores de hora (08 a 22) y minuto (00 a 59), **sin rueda
  infinita**.
- Una reunión **en el club** se destaca distinto en toda la aplicación, porque ocupa la
  tarde y no se le puede encadenar otra atrás.
- Hay una **hoja de una página para imprimir** antes de ir a la reunión
  (`/clubes/:id/imprimir`), con lo pretendido del club y estilos de impresión.

---

## 8. Fechas y zona horaria

Zona de negocio: `America/Argentina/Buenos_Aires`. Los instantes de auditoría se guardan
con **desplazamiento explícito** (`2026-11-02T14:35:12-03:00`) para que nadie los
reinterprete como UTC. Las fechas sin hora se guardan como `AAAA-MM-DD` y se muestran
día/mes/año.

La ventana de reconfirmación (01/01/2027 a 28/02/2027) es un **parámetro editable**. Una
fecha prevista fuera de la ventana exige motivo de excepción; un contacto **realmente
ocurrido** fuera de la ventana se puede registrar siempre, también con motivo: no se
pierde un hecho real por una regla de calendario.

---

## 9. Qué datos hay cargados hoy

Importados de la hoja `PROYECCION 27` de la planilla de venta, con un lector de XLSX
propio (ZIP, inflate y sharedStrings, sin librerías).

| | |
|---|---|
| Clubes | **245** |
| Planes 2026 a 2027 | **245**, todos Abierta, prioridad 2 por omisión |
| Filas de disciplina | **802** (Masculino, Promocionales, Femenino, Veteranos) |
| Con cantidad de tiras 2026 | 440, que suman **495 tiras** |
| Sin cantidad 2026 porque el club no jugó esa disciplina | 340 |
| Con texto 2026 que no permite deducir el número | **22**, dicen "Disciplinas" sin número |
| Conflictos de importación | **0** |
| Clubes marcados de contacto directo | **0**, falta marcarlos |

El lado 2027 de la planilla está en **palabras, no en números**: 277 "Armar", 216
"Mantener", 22 "AFA", y nombres de división sueltos. Por eso `tiras_propuestas` está
**vacío en las 802 filas**: el importador **no inventa números**. La cantidad pretendida
la decide Dirección desde la aplicación, o se carga de una planilla que la exprese en
números.

**Consecuencia práctica, y es la limitación más importante hoy:** el panel de evolución
2026 a 2027 y la hoja impresa muestran el lado 2026 completo y el lado 2027 vacío.

---

## 10. Verificación

`npm run pruebas` corre **152 comprobaciones** sobre una base temporal aislada, en 11
secciones: circuito completo, permisos (incluidas peticiones directas que saltean la
pantalla), flujo del ayudante, inmutabilidad, reapertura con auditoría transaccional,
unicidad y concurrencia, cantidades y fechas, resultados e indicadores, portabilidad
(exportar y restaurar), disponibilidad, duración según dónde sea la reunión, y clubes de
contacto directo.

Estado: **152 correctas, 0 fallidas.**

Respaldo: la base es un archivo único; copiarlo con la aplicación detenida es un respaldo
completo. `npm run exportar` genera además JSON y CSV, y
`node scripts/importar-paquete.js --json respaldo.json` restaura. **La restauración se
probó**, no es una suposición.

---

## 11. Límites conocidos y lo que falta

Esto está declarado dentro de la propia aplicación, en la pantalla **Estado de la app**.

### Lo que bloquea el uso real

1. **La autenticación es de demostración.** No hay contraseñas ni proveedor de identidad:
   se elige una persona de una lista y el servidor firma una cookie. La **autorización**
   posterior sí es real y de servidor. Por eso el servidor **escucha solo en la máquina
   local** por omisión; abrirlo a la red exige poner `FUTSALA_RED=1` a propósito.
2. **Falta dar de alta a las personas reales.** Hoy hay **una sola identidad provisoria**
   de Dirección. Sin las personas reales no se puede asignar quién toma cada reunión, ni
   quién redacta cada acta, ni probar los roles de verdad.
3. **Faltan las cantidades pretendidas para 2027** (sección 9).
4. **Falta marcar los clubes de contacto directo.**

### Riesgos operativos

5. **La base vive hoy en una carpeta de OneDrive.** Si se sincroniza mientras la
   aplicación escribe, puede corromperse: SQLite en modo WAL usa tres archivos que se
   sincronizan por separado. La aplicación **avisa al arrancar** si detecta OneDrive,
   Drive, Dropbox o iCloud, y la carpeta se mueve con `FUTSALA_DATOS`. Hay que hacerlo.
6. **No hay respaldo automático.** La herramienta existe (`npm run exportar`); falta
   programarla.
7. **Sin HTTPS.** Irrelevante en localhost, obligatorio el día que se publique.
8. **SQLite con un proceso** alcanza para un equipo de esta escala, no para varios
   servidores en paralelo.

### Fuera de alcance a propósito

9. **No hay ningún canal de envío construido.** Los cinco avisos internos previstos (acta
   para revisar, agenda del día siguiente, vencimientos, pendientes de reconfirmación y
   cierre de ventana el 01/03/2027) están **diseñados, no implementados**, y los
   interruptores están apagados. El de avisos a clubes **no se puede encender** desde la
   aplicación.
10. **Las evidencias son enlaces escritos a mano**, sin almacenamiento propio: los
    permisos del archivo enlazado dependen de dónde esté guardado, no de esta aplicación.
11. Cobros, jugadores, torneos y administración deportiva: fuera de alcance.
12. Acceso de los clubes a la aplicación: fuera de alcance en esta versión.
13. Integraciones con Google (calendario, archivos): opcionales y posteriores.
14. **El catálogo definitivo de disciplinas y la definición operativa de "tira"** los tiene
    que fijar FUTSALA.

---

## 12. Qué nos interesa que nos digas

Preguntas concretas para el revisor, en orden de importancia:

1. **Integridad.** Mirá el Apéndice A. ¿Hay alguna forma de perder información aprobada,
   de modificar algo que debería estar bloqueado, o de que un acta aprobada quede sin
   respaldar las cantidades que dice respaldar? ¿Falta algún disparador?
2. **Permisos.** ¿Hay alguna operación de la sección 5 donde un Ayudante pueda hacer algo
   que debería ser solo de Dirección, o donde un usuario de Consulta pueda escribir?
3. **El modelo de las cuatro cantidades.** ¿Es la forma correcta de representar "lo que
   tuvo / lo que queremos / lo que acordamos / lo que reconfirmó"? ¿Qué se rompe cuando un
   club cambia de disciplinas entre 2026 y 2027?
4. **Las máquinas de estado.** ¿Sobra o falta algún estado? ¿El orden obligatorio de
   reapertura (plan, reconfirmación, acta) es el correcto?
5. **Lo que simplificamos de más.** Sacamos la etapa "Cierre 2026" y los estados
   intermedios del plan porque no existían en el proceso real. ¿Perdimos algo?
6. **Concurrencia.** El control por `version` no cubre las acciones de estado, que
   comprueban la condición de negocio dentro de la transacción. ¿Alcanza?
7. **La decisión de arquitectura.** Node y SQLite sin dependencias, HTML del servidor.
   Para un equipo de unas 6 personas y 245 clubes, ¿es razonable o nos vamos a arrepentir?
8. **Qué haríamos distinto** si el objetivo es que esto se use en serio en enero de 2027.

**No nos interesa** que nos propongas cambiar de plataforma, agregar un framework de
interfaz, ni ampliar el alcance a cobros o administración deportiva, salvo que señales una
limitación concreta que lo justifique.

---

## Apéndice A — esquema completo

Es el archivo `server/esquema.sql` tal cual. Se aplica de forma idempotente en cada
arranque: `CREATE ... IF NOT EXISTS` crea lo que falte sin tocar lo que ya existe.

```sql
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
  version       INTEGER NOT NULL DEFAULT 1
);

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
  -- Notas opcionales para llegar leído a la reunión. No son una etapa ni se aprueban:
  -- el repaso del año se conversa en la reunión y queda escrito en el acta.
  balance                 TEXT,
  objetivo                TEXT,
  riesgos                 TEXT,
  -- Prioridad del club en el ciclo: 1 es la más alta. Un club de prioridad 1 suele
  -- ameritar que la reunión sea en el club y no en la liga.
  prioridad               TEXT NOT NULL DEFAULT '2' CHECK (prioridad IN ('1', '2', '3')),
  -- El plan está abierto hasta que se cierra el año con ese club. Los pasos del
  -- circuito (reunión, acta, reconfirmación) se leen de sus propios registros.
  estado                  TEXT NOT NULL DEFAULT 'Abierta'
                            CHECK (estado IN ('Abierta', 'Cerrada', 'Archivada')),
  responsable_id          TEXT REFERENCES usuario(id) ON DELETE RESTRICT,
  fecha_objetivo          TEXT,
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
  delegados_presentes  TEXT,
  acta                 TEXT,
  devolucion_club      TEXT,
  proximo_paso         TEXT,
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

CREATE TRIGGER IF NOT EXISTS plan_cerrado_bloqueado BEFORE UPDATE ON plan
WHEN OLD.estado IN ('Cerrada', 'Archivada') AND NEW.estado = OLD.estado
 AND (IFNULL(NEW.balance, '') <> IFNULL(OLD.balance, '')
   OR IFNULL(NEW.objetivo, '') <> IFNULL(OLD.objetivo, '')
   OR IFNULL(NEW.riesgos, '') <> IFNULL(OLD.riesgos, '')
   OR NEW.prioridad <> OLD.prioridad
   OR IFNULL(NEW.fecha_objetivo, '') <> IFNULL(OLD.fecha_objetivo, '')
   OR IFNULL(NEW.responsable_id, '') <> IFNULL(OLD.responsable_id, ''))
BEGIN
  SELECT RAISE(ABORT, 'El plan cerrado esta bloqueado: hay que reabrirlo con motivo');
END;

CREATE TRIGGER IF NOT EXISTS acta_validada_bloqueada BEFORE UPDATE ON reunion
WHEN OLD.acta_estado = 'Validada' AND NEW.acta_estado = 'Validada'
 AND (IFNULL(NEW.acta, '') <> IFNULL(OLD.acta, '')
   OR IFNULL(NEW.devolucion_club, '') <> IFNULL(OLD.devolucion_club, '')
   OR IFNULL(NEW.proximo_paso, '') <> IFNULL(OLD.proximo_paso, '')
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
WHEN IFNULL(NEW.tiras_acordadas, -1) <> IFNULL(OLD.tiras_acordadas, -1)
 AND OLD.reunion_acuerdo_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM reunion m WHERE m.id = OLD.reunion_acuerdo_id AND m.acta_estado = 'Validada')
BEGIN
  SELECT RAISE(ABORT, 'La cantidad acordada esta bloqueada por el acta aprobada que la respalda');
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

CREATE TRIGGER IF NOT EXISTS acta_aprobada_exige_acordadas BEFORE UPDATE ON reunion
WHEN NEW.acta_estado = 'Validada' AND OLD.acta_estado <> 'Validada'
 AND EXISTS (SELECT 1 FROM plan_detalle d WHERE d.reunion_acuerdo_id = NEW.id AND d.tiras_acordadas IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'Faltan cantidades acordadas en disciplinas vinculadas a esta reunion');
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
```
