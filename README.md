# FUTSALA Reuniones 2027

Aplicación interna para las reuniones de venta 2027 y la reconfirmación de clubes en
enero-febrero de 2027. Reemplaza al prototipo AppSheet: **no depende de Google Sheets
ni de AppSheet.** El único servicio de terceros es optativo: el ingreso con Google por
Firebase (sin sus variables, el botón no aparece).

Trabaja con los clubes reales de la planilla de venta. Se entra con correo y contraseña,
con Google o con un enlace de un solo uso; quien se registra solo queda pendiente hasta
que Dirección lo aprueba. La aplicación no manda correos: los enlaces los reparte Dirección. Sin publicación, sin
invitaciones y sin envíos de ningún tipo.

## Cómo ejecutarla

Hace falta Node.js 22.5 o posterior (probado con Node 24). No hay dependencias que instalar.

```bash
npm run seed     # carga el juego de datos ficticios (solo la primera vez)
npm start        # arranca el servidor en http://localhost:4310
```

En la pantalla de acceso se elige una identidad. Para trabajar con los clubes reales en
lugar de los datos de ejemplo, en vez de `npm run seed`:

```bash
node scripts/preparar-ciclo.js                                          # parámetros + una identidad provisoria de Dirección
node scripts/importar-venta.js --archivo "ruta/VENTA.xlsx" --confirmar  # los clubes
```

Las personas reales se dan de alta después desde **Administración**, y la provisoria se
desactiva.

Otros comandos:

```bash
npm run pruebas      # pruebas de aceptación sobre una base temporal aislada
npm run reiniciar    # borra la base y recrea los datos ficticios
npm run exportar     # respaldo JSON + CSV en exportaciones/<fecha>
```

Importar la planilla de venta (hoja `PROYECCION 27` del Excel):

```bash
node scripts/importar-venta.js --archivo "ruta/VENTA.xlsx"              # simulación
node scripts/importar-venta.js --archivo "ruta/VENTA.xlsx" --confirmar  # escribe
```

Por cada club carga sus cuatro disciplinas (Masculino, Promocionales, Femenino, Veteranos)
con las divisiones que jugó en 2026 y lo que se pretende para 2027 tal como está escrito.
Cuenta una tira por división listada; donde la planilla no permite deducir la cantidad
(por ejemplo "4 Categorías") deja el número vacío y lo informa para revisar. La cantidad
pretendida para 2027 queda vacía: la planilla la expresa en palabras y el número lo decide
Dirección desde la aplicación.

Importar datos (por ejemplo el paquete del prototipo AppSheet):

```bash
node scripts/importar-paquete.js --json ruta/03_Base_actual.json
node scripts/importar-paquete.js --csv  ruta/CSV
node scripts/importar-paquete.js --json archivo.json --simular   # no escribe nada
```

### Respaldo automático

Una tarea de Windows (**«FUTSALA respaldo diario»**) copia la base todos los días a las
21:00 en `exportaciones/respaldos/`, que está dentro de OneDrive: para la base viva eso
sería un riesgo, para una copia que nadie escribe es una copia fuera de esta máquina sin
hacer nada.

Antes de copiar vuelca el WAL, y después **verifica**: que la copia abra, que pase el
chequeo de integridad de SQLite y que tenga las mismas filas que el original. Si algo no
cierra, falla con código de error y queda en `respaldos.log`.

Conserva los **últimos 14 días** y el **primero de cada mes**, que no se borra nunca.

```bash
npm run respaldo            # copia, verifica y rota, ahora mismo
npm run respaldo -- --ver   # lista los respaldos que hay
```

**Para restaurar:** parar la aplicación y copiar el archivo elegido sobre la base viva
(`npm run respaldo -- --ver` dice la ruta exacta).

### Carga masiva de prioridades

La prioridad del club va de 1 a 4: **1 absoluta, 2 importante, 3 normal, 4 baja**.
Para cargarlas de a muchas hay una planilla de ida y vuelta:

```bash
npm run prioridades                                        # saca prioridades.xlsx
npm run prioridades -- "ruta\al\archivo.xlsx"              # dice qué cambiaría, sin tocar nada
npm run prioridades -- "ruta\al\archivo.xlsx" --aplicar    # aplica
```

**Por omisión no escribe**: hay que pedirlo con `--aplicar`, y hace falta el `--` antes
del archivo. npm se queda con los `--loquesea` que no reconoce como suyos, así que una
bandera puede no llegar nunca al script; con este orden, perderla significa que no se
aplica nada, en vez de aplicar sin querer.

La columna PRIORIDAD tiene lista desplegable de 1 a 4. Al volver se acepta `.xlsx` o
`.csv`, por si Excel lo guardó de otra forma. Lo que identifica cada fila es la columna
**ID**: se puede ordenar y filtrar la planilla, pero esa columna no se borra. Si una fila
tiene un error, **no se aplica ninguna**; una fila en blanco deja al club como estaba.

### Cómo se entra

Tres formas, en la pantalla de acceso (`/sesion`):

- **Correo y contraseña.** Quien no tiene cuenta la crea en `/registrarse` y queda
  pendiente: Dirección la aprueba en **Administración → Solicitudes de acceso** eligiendo
  el rol. Quien ya estaba cargado crea su contraseña desde **Mi cuenta** (clic en su nombre).
- **Google**, si están las variables `FUTSALA_FIREBASE_API_KEY`, `FUTSALA_FIREBASE_AUTH_DOMAIN`,
  `FUTSALA_FIREBASE_PROJECT_ID` y `FUTSALA_FIREBASE_APP_ID` (van en `.env`). El dominio
  tiene que estar en Firebase → Authentication → Settings → Authorized domains.
- **Enlace de un solo uso** que vence a los 15 minutos, para recuperar el acceso.

```bash
npm run acceso                       # lista a quién se le puede generar
npm run acceso alguien@ejemplo.com   # imprime su enlace
```

Dirección también los genera desde **Administración**, y ahí mismo ve quién entró por
última vez y puede anular los enlaces pendientes de alguien.

Desde la pantalla de acceso cualquiera puede pedir el suyo escribiendo su correo. La
respuesta es siempre la misma exista o no ese correo —si no, la pantalla serviría para
averiguar quién tiene cuenta—, y el enlace **no se muestra ahí**: sale por la consola del
servidor y queda anotado en `enlaces-de-acceso.log`, dentro de la carpeta de datos.

En la base se guarda solo el **hash** del token: quien pueda leer la base no puede entrar
como nadie. Entrar con un enlace anula los demás pendientes de esa persona, y cada
ingreso queda en el historial.

### Dónde viven los datos

**La base no debe quedar en OneDrive, Drive ni Dropbox.** SQLite en modo WAL usa tres
archivos (`futsala.db`, `-wal` y `-shm`) que se escriben juntos; una carpeta que
sincroniza sola los sube por separado y puede dejar la base corrupta. La aplicación avisa
al arrancar si detecta una de esas carpetas.

Para moverla:

```bash
npm run mover-datos C:\FUTSALA\datos --simular   # muestra qué haría, no toca nada
npm run mover-datos C:\FUTSALA\datos
```

Vuelca el WAL, copia, **verifica integridad y que coincida fila por fila**, anota la ruta
en `datos.ubicacion` (así `npm start` la encuentra sola, sin variables de entorno), lleva
el secreto de sesión para que nadie tenga que volver a entrar, y deja el original
renombrado como respaldo. No borra nada.

### Variables de entorno

| Variable | Para qué |
|---|---|
| `PORT=5000` | Cambia el puerto (por omisión 4310). |
| `FUTSALA_DATOS=C:\FUTSALA\datos` | Carpeta de datos para este arranque. Tiene prioridad sobre `datos.ubicacion`. |
| `FUTSALA_DB=/otra/ruta/futsala.db` | Mueve solo el archivo de base. |
| `FUTSALA_RED=1` | Abre el servidor a la red local. **Por omisión escucha solo en esta máquina**, porque la aplicación va por HTTP sin cifrar: en una red ajena el enlace de acceso y la cookie de sesión viajan a la vista. |

## Arquitectura

| Pieza | Elección |
|---|---|
| Servidor | Node.js con `node:http`. Sin dependencias externas. |
| Base de datos | SQLite mediante `node:sqlite` (incluido en Node). Un archivo: `futsala.db`, fuera de carpetas que sincronicen solas. |
| Interfaz | HTML generado en el servidor. Responsive. Funciona sin JavaScript. |
| Sesión | Cookie firmada (HMAC) + token anti-CSRF por formulario. |

Por qué así: el pedido exige reglas aplicadas en servidor, restricciones reales de base,
transacciones, detección de escrituras concurrentes y exportación propia, sin contratar
infraestructura. Node y SQLite cubren todo eso con cero instalación y un despliegue
reproducible (copiar la carpeta y correr `npm start`).

```
server/
  esquema.sql        restricciones, unicidad, relaciones fijas, bloqueos y triggers
  db.js              conexión, transacciones
  auth.js            identidad de la sesión y autorización por rol
  dominio/           reglas de negocio (una por entidad) + historial + indicadores
  web/               rutas y páginas (HTML generado)
public/              estilos e íconos
scripts/             seed, importación, exportación y pruebas de aceptación
```

## Qué es real, qué es demostración y qué falta

La pantalla **Estado de la app** (`/acerca`) dentro de la aplicación mantiene esta
distinción a la vista de cualquiera que la use. Resumen:

**Funcional, con lógica de servidor y restricciones de base**

- Circuito completo: club → reunión agendada → acta con lo acordado por disciplina y la
  fecha para reconfirmar → reconfirmación de esa acta → cierre del plan.
- **La reconfirmación sale del acta.** La ficha final dice de qué acta aprobada viene y
  arranca con la fecha que el acta fijó; se puede volver a poner fecha las veces que haga
  falta, y cada movida queda en el historial.
- **Lo acordado se escribe una sola vez, en el acta de la reunión donde se acordó**, en el
  mismo formulario y con el mismo botón que el resto del acta. Se escribe en palabras
  ("mantiene Liga de Honor B", "lo define en diciembre"): no se cargan cantidades de
  tiras. La ficha del club lo muestra junto a lo de 2026 y lo pretendido, con enlace al
  acta, pero no lo edita: no hay dos lugares para lo mismo.
- Autorización por rol en cada operación (Dirección, Colaborador, Consulta), aplicada en
  el dominio y no en la visibilidad de los botones.
- **Disponibilidad de Dirección**: cada una carga los días y horarios en que acepta
  reuniones y los tramos en que no está. Quien agenda los ve y recibe un aviso si elige
  otro momento; nunca bloquea.
- Unicidad garantizada por la base: un plan por club y ciclo, una disciplina por plan,
  una ficha final por plan, un correo por usuario.
- Relaciones fijas: no se mueve un plan a otro club, ni una reunión, disciplina o ficha a
  otro plan, ni siquiera con SQL directo.
- Cantidades enteras de 0 o más; vacío se conserva como desconocido y nunca se convierte
  en cero; cada cantidad acordada queda atada al acta que la aprobó.
- Bloqueo de lo aprobado (acta, lo acordado que respalda, cantidades acordadas y
  finales, planes cerrados) con disparadores en la base.
- Reapertura solo de Dirección, con motivo, copia íntegra de lo aprobado, actor y sello
  del reloj del servidor, dentro de una transacción.
- Historial de solo-agregado: la aplicación no ofrece editarlo ni borrarlo y la base lo impide.
- Control de versión por registro: la segunda escritura sobre la misma versión informa
  conflicto y muestra las diferencias, en lugar de pisar la primera.
- Indicadores por clubes únicos, conflictos de duplicados visibles y excluidos del total
  confirmado, retención vacía sin clubes, cobertura de cantidades.
- Exportación JSON y CSV, e importación desde el paquete de AppSheet con registro de conflictos.

**Demostración, identificada como tal**

- **Entrega del enlace de acceso.** La aplicación no manda correos. El enlace queda en la
  consola del servidor y en un registro local, y Dirección se lo pasa a cada uno. Activar
  envíos es una decisión aparte.
- **Cifrado del transporte.** Va por HTTP sin cifrar. En la máquina propia no importa; en
  una red compartida, el enlace y la cookie viajan a la vista.
- Evidencias y adjuntos: por ahora son enlaces escritos a mano, sin almacenamiento propio.

**Pendiente**

- Despliegue con HTTPS, respaldo automático y restauración probada.
- Almacenamiento propio de adjuntos con permisos iguales a los del registro.
- Avisos internos (acta para revisar, agenda, vencimientos, reconfirmación, cierre de
  ventana el 01/03/2027): diseñados, no construidos. No hay canal de envío y los
  interruptores están apagados.
- Catálogo definitivo de disciplinas y definición operativa de "tira".
- Identidad visual definitiva: la actual es una propuesta sobria, sin logo oficial.

## Verificación

`npm run pruebas` recorre los escenarios de 04_Pruebas_de_aceptación sobre una base
temporal: circuito completo, permisos (incluidas peticiones directas que saltean la
pantalla), inmutabilidad, bloqueos, reapertura con auditoría transaccional, unicidad,
concurrencia, cantidades, fechas, ventana de reconfirmación, indicadores y portabilidad.

## Respaldo y restauración

La base es un único archivo (`data/futsala.db`). Con la aplicación detenida, copiarlo es un
respaldo completo. `npm run exportar` genera además JSON y CSV, y
`node scripts/importar-paquete.js --json respaldo.json` restaura sobre una instalación vacía.
