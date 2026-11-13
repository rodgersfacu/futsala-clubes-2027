# Decisiones y límites

Registro de lo que se decidió al pasar del prototipo AppSheet a esta aplicación, para que
nada quede como acuerdo tácito. Actualizado el 02/11/2026.

## Arquitectura

**Node.js + SQLite, sin dependencias externas.** El pedido exige validaciones y permisos en
servidor, restricciones reales de base, transacciones, detección de escrituras concurrentes
y exportación propia, sin contratar infraestructura. `node:http` y `node:sqlite` vienen con
Node y cubren todo eso; el despliegue es copiar la carpeta y correr `npm start`. Si más
adelante hace falta acceso concurrente alto o varios servidores, la migración natural es a
PostgreSQL: el esquema está escrito con SQL estándar salvo los disparadores.

**HTML generado en el servidor, sin framework de interfaz.** La aplicación es un flujo de
formularios y listas. Así funciona sin JavaScript, carga rápido en teléfono y no hay
dependencias que mantener. El precio: no hay interacciones ricas sin recargar; si hiciera
falta, se agregan de a una.

**Una sola base para todo, incluido el historial.** Un archivo es a la vez el respaldo.

## Modelo de datos

- **Identificadores estables.** Cada registro tiene un id propio. El correo de un usuario es
  un atributo único, no una clave foránea: cambiar un correo no rompe el historial.
  (En AppSheet el correo era la clave de `Usuarios` y se repetía en cada tabla.)
- **Cuatro etapas por disciplina** (2026, pretendido, acordado, final) en una fila por
  disciplina, y `reunion_acuerdo_id` para atar lo acordado al acta concreta que lo aprobó.
- **Lo acordado es contenido del acta y se escribe ahí, en el mismo formulario.** El acta
  es un solo documento: lo que se conversó, la fecha para reconfirmar y lo acordado con
  cada disciplina se guardan con un solo botón, en una transacción. Antes había que
  escribir el acta y después ir a la ficha del club a cargar las cantidades a mano,
  eligiendo de qué acta salían.
- **Lo acordado no tiene cantidades: es texto** (`acordado_texto`). En la reunión se
  acuerda qué pasa con cada disciplina ("mantiene Liga de Honor B", "baja Femenino", "lo
  define en diciembre"), no cuántas tiras. El número aparece recién con el club, en la
  cantidad final de la reconfirmación.
- **Nada se borra.** No hay operación de borrado en la aplicación y las claves foráneas son
  `ON DELETE RESTRICT`. Un plan que no va más se archiva; una reunión que no se hizo se
  cancela con motivo; un compromiso que no corresponde se cancela con motivo.
- **Conflictos de importación como entidad propia.** La unicidad es una restricción real, así
  que un duplicado no puede entrar. La fila rechazada se guarda en `conflicto`, queda a la
  vista y bloquea confirmar y cerrar ese plan hasta que Dirección decida. No se elige un
  resultado final de forma arbitraria.

## Reglas que se aplican en la base, no solo en la pantalla

Están en `server/esquema.sql` y se prueban con peticiones directas en `npm run pruebas`:

- Unicidad de plan por club y ciclo, disciplina por plan, ficha final por plan, correo por usuario.
- Cantidades enteras de 0 o más; `NULL` sigue significando "no se sabe".
- Fin de reunión posterior al inicio; las dos direcciones, personas distintas.
- Relaciones fijas después del alta (plan→club y ciclo; reunión, disciplina y ficha→plan).
- Bloqueo de contenido aprobado: acta validada, lo acordado que respalda, cantidades
  acordadas respaldadas por un acta aprobada, cantidades finales con reconfirmación validada,
  y todo el contenido de un plan cerrado o archivado.
- Condiciones de cierre del plan y de validación del resultado final.
- Historial de solo-agregado: `UPDATE` y `DELETE` sobre `historial` están prohibidos.

## El circuito, tal como lo trabaja el equipo

Actualizado el 02/11/2026 después de repasarlo con FUTSALA. El orden es:

**Plan cargado** (viene de la planilla de venta) → **Reunión agendada** (la coordina el
ayudante) → **Reunión realizada** → **Acta aprobada** (Dirección) → **Reconfirmado**
(enero-febrero) → **Cerrado**.

Lo que se sacó respecto del prototipo AppSheet, porque no existe en el proceso real:

- **La etapa "Cierre 2026" con aprobación propia.** El repaso del año se conversa en la
  reunión y queda escrito en el acta; no hace falta un segundo lugar para escribirlo ni
  una aprobación aparte.
- **Las notas de preparación del plan** (balance 2026, objetivo 2027, riesgos). Eran un
  cuarto lugar donde escribir, siempre vacío: lo que hay que llevar a la reunión ya está
  en la cuadrícula 2026 → 2027, y lo que se conversa va al acta. En su lugar cada reunión
  tiene **observaciones**, que es donde de verdad se anota algo.
- **Los datos propios del plan.** El plan no guarda nada para escribir: es el hilo entre
  un club, un ciclo, sus disciplinas y sus reuniones. La prioridad y quién atiende al
  club son del **club** (no cambian porque empiece un año nuevo, y tenerlos también en el
  plan era pedir que dijeran cosas distintas).
- **Los estados intermedios del plan** ("Listo para presentar", "En seguimiento"). El plan
  está Abierta, Cerrada o Archivada; en qué punto del circuito está se lee de sus propios
  registros (hay reunión, hay acta aprobada, hay resultado final).
- **Dos máquinas de estado en paralelo** sobre el mismo plan.

Lo que antes congelaba el cierre aprobado ahora lo congela **el acta aprobada**: las tiras
y divisiones de 2026 y lo pretendido para 2027 quedan fijos cuando hay un acta aprobada
del plan, que es el momento en que ya se conversaron con el club.

Un plan cierra con: acta aprobada, resultado final validado (Confirmado o No continúa),
ningún compromiso abierto y ningún conflicto de duplicados.

## Cómo se entra

- **Tres formas de entrar (desde noviembre de 2026): correo y contraseña, Google y enlace
  de un solo uso.** Las tres terminan en la misma cookie de sesión firmada. Se sumaron para
  replicar el acceso de Futsala Clubes y que nadie dependa de que Dirección le genere un
  enlace cada vez.
- **Registrarse no da permisos.** Quien crea su cuenta (con contraseña o con Google) queda
  como *solicitud pendiente*. Dirección la ve en Administración, corrobora que sea del
  equipo, elige el rol y recién ahí nace el usuario. El correo de una cuenta con contraseña
  no está verificado; el de Google sí.
- **Contraseñas con scrypt y sal individual.** Entre 8 y 128 caracteres con al menos un
  signo. Nunca se guardan en claro. El mensaje de error es el mismo exista o no el correo.
- **Google por Firebase: el único servicio de terceros, y optativo.** Se decidió aceptarlo
  a propósito. Sin las variables `FUTSALA_FIREBASE_*` el botón no aparece y el resto
  funciona igual. El token se verifica en el servidor sin dependencias (node:crypto contra
  las claves públicas de Google). Firebase no deja meter un valor propio en el token, así
  que la pantalla entrega una cookie firmada de un solo uso y se exige que el ingreso en
  Google sea posterior a ella: un token viejo o robado no sirve.
- **Google no se apropia de cuentas por coincidir el correo.** Si Dirección dio de alta el
  correo y la persona no tiene contraseña, el primer ingreso con Google lo vincula. Si ya
  tiene contraseña, tiene que vincular Google desde Mi cuenta confirmándola.
- **Enlaces de un solo uso.** Siguen andando, sobre todo para recuperar el acceso o crear
  la primera contraseña desde Mi cuenta. Para entrar hace falta un enlace generado
  para esa persona, que vence a los 15 minutos y sirve una sola vez. Nadie administra ni
  recuerda contraseñas, y no hay nada que robar guardado: en la base queda el **hash** del
  token, nunca el token.
- **Se confirma con un clic antes de gastarlo.** Los navegadores y los mensajeros abren
  los enlaces por su cuenta para previsualizarlos; si entrar fuera parte de abrir la
  dirección, el enlace se gastaría solo antes de que su dueño lo tocara.
- **La pantalla de acceso no revela quién tiene cuenta.** Contesta lo mismo exista o no el
  correo, y nunca muestra el enlace: sale por la consola del servidor.
- **La aplicación no manda correos.** Dirección reparte los enlaces. Activar envíos es una
  decisión aparte, y toca un solo archivo (`server/lib/entrega.js`).
- **Siempre hay forma de volver a entrar:** `npm run acceso <correo>` desde la máquina que
  tiene los datos. No es una puerta trasera: quien puede correrlo ya tiene la base entera
  en su disco.

## Flujo de aprobaciones y reaperturas

- Los sellos (`validado_por`, `validado_en`) salen de la sesión y del reloj del servidor,
  nunca de un campo del formulario.
- **Reabrir exige motivo** de al menos 10 caracteres, rol Dirección, y guarda una copia
  íntegra de lo aprobado antes de tocar nada. La auditoría y el cambio ocurren en una sola
  transacción: si algo falla, no queda cambio sin registro ni registro sin cambio. Se
  descartó el mecanismo provisional de AppSheet que buscaba una entrada de historial creada
  en el último minuto.
- **La reconfirmación cuelga del acta.** La ficha final guarda de qué acta aprobada sale
  (`reunion_id`): lo que el club confirma es lo que se acordó en esa reunión, y la
  pantalla muestra lo acordado al lado de lo final. Sin acta aprobada no hay ficha.
- **La fecha para reconfirmar la fija el acta** (`reunion.fecha_recontacto`): en la
  reunión se decide cuándo se vuelve a hablar, así que se escribe ahí y la ficha arranca
  con esa fecha en vez de que alguien la retipee. Queda bloqueada al aprobar el acta.
- **Reprogramar es una operación propia.** Correr la fecha no es registrar un contacto ni
  cambiar el estado: se puede hacer las veces que haga falta y cada movida queda en el
  historial con la fecha de la que venía y su motivo, así se ve cuántas veces se corrió.
- **Orden de reapertura:** primero el plan, después la reconfirmación, por último el acta.
  La aplicación lo exige y explica por qué cuando se intenta en otro orden.
- **Devolver un acta exige un motivo nuevo cada vez:** al reenviarla, el motivo anterior se
  limpia, así una devolución posterior no reutiliza la explicación vieja.
- Un acta aprobada no se puede devolver: se reabre, que es una operación distinta y auditada.

## Permisos

- **Dirección:** prepara planes, agenda, asigna, aprueba cierre, actas y resultados finales,
  y reabre con motivo.
- **Colaborador:** escribe el contenido de las actas que le asignaron mientras no estén
  aprobadas; crea compromisos desde esas actas y resuelve los que tiene a cargo mientras
  estén abiertos. No toca agenda, equipo, plan, cantidades ni resultado final.
- **Consulta:** lectura. Usuario inactivo o sin identidad: sin acceso a los datos.
- Nadie cambia su propio rol ni su propio acceso desde los formularios, ni siquiera para
  dejarlo igual. Siempre tiene que quedar al menos una Dirección activa.

**Cambio respecto del prototipo:** en AppSheet los compromisos quedaron como edición
exclusiva de Dirección porque la restricción por responsable no estaba implementada. Acá sí
lo está, aplicada en servidor y probada (usuario activo + rol + ser el responsable + tarea
abierta), así que el colaborador que toma el acta puede cargar y resolver sus propias tareas,
que es el paso 6 del circuito. No se amplió nada más.

## Concurrencia

Cada registro lleva `version`. Los formularios de edición la envían y la escritura es
`UPDATE ... WHERE id = ? AND version = ?`. Si otra persona guardó antes, la segunda
escritura no pisa nada: devuelve conflicto y muestra campo por campo lo guardado frente a lo
enviado. Las acciones de estado (aprobar, cerrar, reabrir) no dependen de la versión porque
comprueban la condición de negocio en el momento, dentro de la transacción.

## Fechas y zona horaria

Zona de negocio: `America/Argentina/Buenos_Aires`. Los instantes de auditoría se guardan con
desplazamiento explícito (`2026-11-02T14:35:12-03:00`) para que nadie los reinterprete como
UTC. Las fechas sin hora se guardan como `AAAA-MM-DD` y se muestran día/mes/año.

La ventana de reconfirmación (01/01/2027–28/02/2027) es un parámetro editable por Dirección.
Una fecha prevista fuera de la ventana exige motivo de excepción; un contacto realmente
ocurrido fuera de la ventana se puede registrar siempre, también con motivo: no se pierde un
hecho real por una regla de calendario.

## Indicadores

- Clubes del ciclo y confirmados cuentan **clubes únicos**, nunca reuniones ni intentos.
- Un plan con conflicto de duplicados abierto queda fuera del total de confirmados y no
  puede cerrarse ni confirmarse.
- Retención = confirmados / clubes del ciclo; vacía (no 0 %) si no hay clubes.
- Las tiras se muestran con cobertura: "4 de 5, faltan 1". Propuesto, acordado y final son
  columnas separadas y no se suman entre sí.
- Cada indicador abre la lista de registros que lo componen.

## Comunicaciones

No hay ningún canal de envío construido. Los interruptores de `parametros` existen para la
etapa siguiente y están apagados; el de avisos a clubes no se puede encender desde la
aplicación. Los cinco avisos internos previstos (acta para revisar, agenda del día siguiente,
vencimientos, pendientes de reconfirmación y cierre de ventana el 01/03/2027) están
diseñados pero no implementados: antes de activarlos hacen falta destinatarios reales,
deduplicación y trazabilidad de cada envío.

## Dónde corre

Decidido el 11/11/2026: **Cloudflare Tunnel desde una máquina de FUTSALA que queda
prendida** (camino A de `DESPLIEGUE.md`), en vez de un servidor pago.

- Es gratis, usa el dominio que ya está en Cloudflare y no abre puertos.
- La base no se muda: sigue donde está, y el respaldo diario sigue siendo local a ella.
  Por eso el pendiente "rehacer el respaldo contra el servidor" desaparece: alcanza con
  registrar la tarea en esa máquina (`scripts/instalar-tareas.ps1`).
- **La aplicación escucha solo en 127.0.0.1** (`FUTSALA_INTERFAZ`). En modo público se le
  cree a las cabeceras del proxy; si la red local pudiera hablarle directo, cualquiera
  ahí podría inventarlas. `npm run tunel` no arranca de otra forma. En Docker es al
  revés (el proxy está en otra máquina), por eso es un parámetro y no un cambio del modo
  público.
- **La configuración vive en `.env`** y solo la leen `npm run tunel` y `npm run acceso`.
  `npm start` no la lee a propósito: en una máquina de desarrollo con un `.env` olvidado,
  arrancar en modo público sin pedirlo sería una sorpresa.
- **El reintento si se cae va en un `.cmd`, no en el Programador de tareas**: Windows
  reintenta una tarea que no arranca, no un programa que termina con error.
- Cloudflare Access (código por correo para entrar) queda sin activar hasta que Facundo
  lo autorice: es un mensaje que le llega a alguien, aunque no lo mande la aplicación.

## Lo que no se hizo a propósito

- Cobros, jugadores, torneos y administración deportiva: fuera de alcance.
- Acceso de los clubes: fuera de alcance en esta versión.
- Integraciones con Google (calendario, archivos): opcionales y posteriores. La aplicación
  funciona sin ellas y ninguna es un requisito.
- Instalación como PWA: evaluable después; no hace falta para probar.

## Riesgos conocidos

- **La aplicación depende de una sola máquina.** Publicada con Cloudflare Tunnel, si esa
  máquina se apaga o se suspende, nadie entra hasta que vuelva. Los datos no se pierden
  (respaldo diario verificado), pero no hay una segunda máquina que la reemplace.
- SQLite con un solo proceso alcanza para un equipo de esta escala, pero no está pensado
  para muchos servidores en paralelo.
- Las evidencias son enlaces: los permisos del archivo enlazado dependen de dónde esté
  guardado, no de esta aplicación.
- El catálogo de disciplinas y la definición de "tira" se cargaron con ejemplos ficticios;
  los términos reales los define FUTSALA.
